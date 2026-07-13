use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use crate::models::*;

const DATA_FILE: &str = "companion-data.json";
const SECRETS_FILE: &str = "secrets.json";

/// Everything the server owns. The public `state` is what `/api/state` serves;
/// `secrets` and the Spotify token cache never leave the process.
pub struct AppState {
    pub state: WallpaperState,
    pub secrets: Secrets,
    pub data_dir: PathBuf,
    pub api_token: String,
    pub http: reqwest::Client,
    /// Cached Spotify access token (token, expires_at). Not persisted.
    pub spotify_token: Option<(String, Instant)>,
    /// Serializes automatic/manual Spotify sampling so a UI refresh cannot
    /// overlap the background poller and trigger an avoidable rate-limit burst.
    pub spotify_refresh_guard: Arc<tokio::sync::Mutex<()>>,
}

pub type Shared = Arc<Mutex<AppState>>;

/// Serializable snapshot written to disk. Excludes transient/derived fields
/// (weather/news/spotify live data, notifications, http client).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Persist {
    ui: Option<UiState>,
    settings: Option<AppSettings>,
    // Backward-compatible read path only. New writes go to secrets.json.
    #[serde(skip_serializing)]
    secrets: Option<Secrets>,
    memos: Vec<MemoItem>,
    bookmarks: Vec<BookmarkItem>,
    timer: Option<TimerState>,
    #[serde(rename = "personalNews", alias = "personal_news")]
    personal_news: Option<PersonalNewsState>,
}

impl AppState {
    pub fn load() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("tohoku-companion");
        Self::load_from(data_dir)
    }

    /// Load from an explicit data dir (used by tests to avoid touching real data).
    pub fn load_from(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);

        let mut state = WallpaperState::default();
        let api_token = load_or_create_api_token(&data_dir);
        let mut legacy_secrets = None;
        let mut persisted_personal_news = None;

        let path = data_dir.join(DATA_FILE);
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<Persist>(&text) {
                if let Some(ui) = p.ui {
                    state.ui = ui;
                }
                if let Some(settings) = p.settings {
                    state.settings = settings;
                }
                legacy_secrets = p.secrets;
                state.memos = p.memos;
                state.bookmarks = p.bookmarks;
                if let Some(timer) = p.timer {
                    state.timer = timer;
                }
                persisted_personal_news = p.personal_news;
            }
        }
        let secrets = load_or_migrate_secrets(&data_dir, legacy_secrets);

        // Seed default bookmarks on first run so the UI isn't empty.
        if state.bookmarks.is_empty() {
            state.bookmarks = default_bookmarks();
        }

        repair_ui_state(&mut state.ui);
        crate::personal_news::ensure_bundled_samples(&data_dir);
        state.personal_news = crate::personal_news::load_personal_news_state(
            &data_dir,
            persisted_personal_news.as_ref(),
            None,
        );

        AppState {
            state,
            secrets,
            data_dir,
            api_token,
            http: reqwest::Client::builder()
                .user_agent("tohoku-companion/0.1")
                .build()
                .unwrap_or_default(),
            spotify_token: None,
            spotify_refresh_guard: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Persist mutable user data + config to disk (best effort). Secrets are
    /// written separately to secrets.json so the normal data snapshot can be
    /// shared/debugged without carrying API keys.
    ///
    /// Atomic write: serialize to a sibling `.tmp` file, back up whatever is
    /// currently on disk to `.bak`, then rename `.tmp` over the real path.
    /// Rename is atomic on both NTFS and POSIX filesystems, so a crash/power
    /// loss mid-write can only ever leave a stray `.tmp` — the real file is
    /// either the old complete content or the new complete content, never a
    /// half-written one (see docs/COMPLETION_EXECUTION_PLAN_2026-07-01.md §4.4).
    pub fn persist(&self) {
        self.persist_public_data();
        persist_secrets(&self.data_dir, &self.secrets);
    }

    /// Checkpoint non-secret state without rewriting/backing up secrets. The
    /// personal-news worker uses this periodically while playing.
    pub fn persist_public_data(&self) {
        let p = Persist {
            ui: Some(self.state.ui.clone()),
            settings: Some(self.state.settings.clone()),
            secrets: None,
            memos: self.state.memos.clone(),
            bookmarks: self.state.bookmarks.clone(),
            timer: Some(self.state.timer.clone()),
            personal_news: Some(self.state.personal_news.clone()),
        };
        let Ok(text) = serde_json::to_string_pretty(&p) else {
            return;
        };
        write_atomic_with_backup(
            &self.data_dir.join(DATA_FILE),
            &text,
            BackupMode::SanitizeSecrets,
        );
        // touch updatedAt so pollers can detect change
        // (caller already mutated `state`; we just stamp time here is not ideal
        //  because we hold &self — callers stamp updated_at themselves.)
    }
}

#[derive(Debug, Clone, Copy)]
enum BackupMode {
    Raw,
    SanitizeSecrets,
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return path.with_extension(suffix.trim_start_matches('.'));
    };
    path.with_file_name(format!("{name}{suffix}"))
}

fn write_atomic_no_backup(path: &Path, text: &str) -> bool {
    let tmp_path = sibling_with_suffix(path, ".tmp");
    if std::fs::write(&tmp_path, text).is_err() {
        return false; // disk full / permissions — leave the existing file untouched
    }
    if std::fs::rename(&tmp_path, path).is_err() {
        // Rename failed (e.g. cross-device on an unusual setup) — fall back
        // to a direct write so a save attempt is never silently dropped.
        if std::fs::write(path, text).is_err() {
            let _ = std::fs::remove_file(&tmp_path);
            return false;
        }
        let _ = std::fs::remove_file(&tmp_path);
    }
    true
}

fn write_atomic_with_backup(path: &Path, text: &str, backup_mode: BackupMode) {
    if path.exists() {
        let bak_path = sibling_with_suffix(path, ".bak");
        backup_existing_file(path, &bak_path, backup_mode);
    }
    let _ = write_atomic_no_backup(path, text);
}

fn backup_existing_file(path: &Path, bak_path: &Path, backup_mode: BackupMode) {
    match backup_mode {
        BackupMode::Raw => {
            let _ = std::fs::copy(path, bak_path);
        }
        BackupMode::SanitizeSecrets => {
            if !backup_sanitized_persist_file(path, bak_path) {
                // If we cannot prove the backup is free of legacy secrets, do
                // not create a new companion-data backup that may leak API keys.
                let _ = std::fs::remove_file(bak_path);
            }
        }
    }
}

fn backup_sanitized_persist_file(path: &Path, bak_path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let mut had_secrets = false;
    if let Some(obj) = value.as_object_mut() {
        had_secrets = obj.remove("secrets").is_some();
    }
    if had_secrets {
        let Ok(clean) = serde_json::to_string_pretty(&value) else {
            return false;
        };
        write_atomic_no_backup(bak_path, &clean)
    } else {
        std::fs::copy(path, bak_path).is_ok()
    }
}

fn load_or_migrate_secrets(data_dir: &Path, legacy_secrets: Option<Secrets>) -> Secrets {
    let path = data_dir.join(SECRETS_FILE);
    let secrets = read_secrets(&path)
        .or_else(|| legacy_secrets.filter(secrets_has_any))
        .unwrap_or_default();

    if secrets_has_any(&secrets) || path.exists() {
        persist_secrets(data_dir, &secrets);
    }
    sanitize_legacy_secret_fields(data_dir);
    secrets
}

fn read_secrets(path: &Path) -> Option<Secrets> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Secrets>(&text).ok()
}

fn persist_secrets(data_dir: &Path, secrets: &Secrets) {
    let path = data_dir.join(SECRETS_FILE);
    if !secrets_has_any(secrets) && !path.exists() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(secrets) else {
        return;
    };
    write_atomic_with_backup(&path, &text, BackupMode::Raw);
}

fn secrets_has_any(secrets: &Secrets) -> bool {
    !secrets.spotify_client_secret.is_empty() || !secrets.spotify_refresh_token.is_empty()
}

fn sanitize_legacy_secret_fields(data_dir: &Path) {
    sanitize_legacy_secret_field(&data_dir.join(DATA_FILE));
    sanitize_legacy_secret_field(&data_dir.join(format!("{DATA_FILE}.bak")));
}

fn sanitize_legacy_secret_field(path: &Path) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    if obj.remove("secrets").is_none() {
        return;
    }
    let Ok(clean) = serde_json::to_string_pretty(&value) else {
        return;
    };
    let _ = write_atomic_no_backup(path, &clean);
}

fn load_or_create_api_token(data_dir: &Path) -> String {
    let path = data_dir.join("companion-api-token.txt");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let token = text.trim();
        if !token.is_empty() {
            return token.to_string();
        }
    }

    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let tmp_path = data_dir.join("companion-api-token.txt.tmp");
    if std::fs::write(&tmp_path, &token).is_ok() {
        let _ = std::fs::rename(&tmp_path, &path);
    } else {
        let _ = std::fs::write(&path, &token);
    }
    token
}

fn default_bookmarks() -> Vec<BookmarkItem> {
    let mk = |i: i32, title: &str, url: &str, cat: &str| BookmarkItem {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        url: url.to_string(),
        icon: None,
        category: Some(cat.to_string()),
        order: Some(i),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    vec![
        mk(0, "ChatGPT", "https://chat.openai.com", "AI"),
        mk(1, "Gemini", "https://gemini.google.com", "AI"),
        mk(2, "GitHub", "https://github.com", "Dev"),
        mk(3, "Spotify Web", "https://open.spotify.com", "Music"),
        mk(4, "Google Calendar", "https://calendar.google.com", "Util"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "tohoku-companion-persist-test-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        dir
    }

    #[test]
    fn first_persist_writes_the_file_with_no_backup_yet() {
        let dir = temp_dir("first");
        let app = AppState::load_from(dir.clone());
        app.persist();

        assert!(
            dir.join("companion-data.json").exists(),
            "main file written"
        );
        assert!(
            !dir.join("companion-data.json.bak").exists(),
            "no prior content to back up"
        );
        assert!(
            !dir.join("companion-data.json.tmp").exists(),
            "tmp file cleaned up (renamed away)"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn second_persist_backs_up_the_previous_content() {
        let dir = temp_dir("second");
        let mut app = AppState::load_from(dir.clone());
        app.state.memos.push(MemoItem {
            id: "1".into(),
            text: "first save".into(),
            pinned: false,
            created_at: now_iso(),
            updated_at: now_iso(),
        });
        app.persist();
        let first_text = std::fs::read_to_string(dir.join("companion-data.json")).unwrap();

        app.state.memos[0].text = "second save".into();
        app.persist();
        let second_text = std::fs::read_to_string(dir.join("companion-data.json")).unwrap();
        let bak_text = std::fs::read_to_string(dir.join("companion-data.json.bak")).unwrap();

        assert!(
            second_text.contains("second save"),
            "main file has the newest content"
        );
        assert!(
            bak_text.contains("first save"),
            ".bak has the previous content"
        );
        assert_eq!(
            bak_text, first_text,
            ".bak is byte-identical to what was on disk before this save"
        );
        assert!(
            !dir.join("companion-data.json.tmp").exists(),
            "no stray tmp file after a successful save"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn persisted_data_round_trips_through_load() {
        let dir = temp_dir("roundtrip");
        let mut app = AppState::load_from(dir.clone());
        app.state.memos.push(MemoItem {
            id: "m1".into(),
            text: "覚えておく".into(),
            pinned: true,
            created_at: now_iso(),
            updated_at: now_iso(),
        });
        app.persist();

        let reloaded = AppState::load_from(dir.clone());
        assert_eq!(reloaded.state.memos.len(), 1);
        assert_eq!(reloaded.state.memos[0].text, "覚えておく");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn secrets_are_persisted_to_a_separate_file_only() {
        let dir = temp_dir("separate-secrets");
        let mut app = AppState::load_from(dir.clone());
        app.secrets.spotify_client_secret = "cs-separated".into();
        app.secrets.spotify_refresh_token = "spotify-refresh".into();
        app.persist();

        let data_text = std::fs::read_to_string(dir.join("companion-data.json")).unwrap();
        let secrets_text = std::fs::read_to_string(dir.join("secrets.json")).unwrap();
        assert!(
            !data_text.contains("cs-separated") && !data_text.contains("\"secrets\""),
            "normal data file must not contain secrets"
        );
        assert!(secrets_text.contains("cs-separated"));
        assert!(secrets_text.contains("spotify-refresh"));

        let reloaded = AppState::load_from(dir.clone());
        assert_eq!(reloaded.secrets.spotify_client_secret, "cs-separated");
        assert_eq!(reloaded.secrets.spotify_refresh_token, "spotify-refresh");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_embedded_secrets_are_migrated_and_sanitized() {
        let dir = temp_dir("legacy-secrets");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("companion-data.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "secrets": {
                    // Retired fields (pre-v0.8.3 AI scaffolding) must parse
                    // harmlessly and vanish with the embedded secrets object.
                    "openaiKey": "sk-retired",
                    "googleKey": "",
                    "spotifyClientSecret": "spotify-secret",
                    "spotifyRefreshToken": ""
                },
                // Retired top-level fields tolerated on read, dropped on save.
                "todos": [],
                "chat": [],
                "memos": [{
                    "id": "m1",
                    "text": "legacy memo",
                    "pinned": false,
                    "createdAt": "2026-07-01T00:00:00Z",
                    "updatedAt": "2026-07-01T00:00:00Z"
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.join("companion-data.json.bak"),
            serde_json::to_string_pretty(&serde_json::json!({
                "secrets": { "spotifyClientSecret": "cs-backup" },
                "todos": []
            }))
            .unwrap(),
        )
        .unwrap();

        let app = AppState::load_from(dir.clone());
        assert_eq!(app.secrets.spotify_client_secret, "spotify-secret");
        assert_eq!(app.state.memos[0].text, "legacy memo");

        let secrets_text = std::fs::read_to_string(dir.join("secrets.json")).unwrap();
        assert!(secrets_text.contains("spotify-secret"));
        assert!(!secrets_text.contains("sk-retired"));

        let data_text = std::fs::read_to_string(dir.join("companion-data.json")).unwrap();
        let bak_text = std::fs::read_to_string(dir.join("companion-data.json.bak")).unwrap();
        assert!(!data_text.contains("spotify-secret"));
        assert!(!data_text.contains("sk-retired"));
        assert!(!data_text.contains("\"secrets\""));
        assert!(!bak_text.contains("cs-backup"));
        assert!(!bak_text.contains("\"secrets\""));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn api_token_is_generated_once_and_reused() {
        let dir = temp_dir("token");
        let app = AppState::load_from(dir.clone());
        assert_eq!(app.api_token.len(), 64);
        assert!(dir.join("companion-api-token.txt").exists());

        let reloaded = AppState::load_from(dir.clone());
        assert_eq!(reloaded.api_token, app.api_token);

        let _ = std::fs::remove_dir_all(dir);
    }
}
