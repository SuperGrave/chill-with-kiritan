use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use crate::models::*;

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
}

pub type Shared = Arc<Mutex<AppState>>;

/// Serializable snapshot written to disk. Excludes transient/derived fields
/// (weather/news/spotify live data, notifications, http client).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Persist {
    ui: Option<UiState>,
    settings: Option<AppSettings>,
    secrets: Option<Secrets>,
    todos: Vec<TodoItem>,
    memos: Vec<MemoItem>,
    bookmarks: Vec<BookmarkItem>,
    chat: Vec<ChatMessage>,
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
        let mut secrets = Secrets::default();
        let api_token = load_or_create_api_token(&data_dir);

        let path = data_dir.join("companion-data.json");
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<Persist>(&text) {
                if let Some(ui) = p.ui {
                    state.ui = ui;
                }
                if let Some(settings) = p.settings {
                    state.settings = settings;
                }
                if let Some(s) = p.secrets {
                    secrets = s;
                }
                state.todos = p.todos;
                state.memos = p.memos;
                state.bookmarks = p.bookmarks;
                state.ai.messages = p.chat;
            }
        }

        // Seed default bookmarks on first run so the UI isn't empty.
        if state.bookmarks.is_empty() {
            state.bookmarks = default_bookmarks();
        }

        state.ai.provider = state.settings.ai.provider.clone();

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
        }
    }

    /// Persist mutable user data + config + secrets to disk (best effort).
    ///
    /// Atomic write: serialize to a sibling `.tmp` file, back up whatever is
    /// currently on disk to `.bak`, then rename `.tmp` over the real path.
    /// Rename is atomic on both NTFS and POSIX filesystems, so a crash/power
    /// loss mid-write can only ever leave a stray `.tmp` — the real file is
    /// either the old complete content or the new complete content, never a
    /// half-written one (see docs/COMPLETION_EXECUTION_PLAN_2026-07-01.md §4.4).
    pub fn persist(&self) {
        let p = Persist {
            ui: Some(self.state.ui.clone()),
            settings: Some(self.state.settings.clone()),
            secrets: Some(self.secrets.clone()),
            todos: self.state.todos.clone(),
            memos: self.state.memos.clone(),
            bookmarks: self.state.bookmarks.clone(),
            chat: self.state.ai.messages.clone(),
        };
        let Ok(text) = serde_json::to_string_pretty(&p) else {
            return;
        };
        let path = self.data_dir.join("companion-data.json");
        let tmp_path = self.data_dir.join("companion-data.json.tmp");
        let bak_path = self.data_dir.join("companion-data.json.bak");

        if std::fs::write(&tmp_path, &text).is_err() {
            return; // disk full / permissions — leave the existing file untouched
        }
        if path.exists() {
            // Best-effort: a failed backup shouldn't block saving the new data.
            let _ = std::fs::copy(&path, &bak_path);
        }
        if std::fs::rename(&tmp_path, &path).is_err() {
            // Rename failed (e.g. cross-device on an unusual setup) — fall back
            // to a direct write so a save attempt is never silently dropped.
            let _ = std::fs::write(&path, &text);
            let _ = std::fs::remove_file(&tmp_path);
        }
        // touch updatedAt so pollers can detect change
        // (caller already mutated `state`; we just stamp time here is not ideal
        //  because we hold &self — callers stamp updated_at themselves.)
    }
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
        app.state.todos.push(TodoItem {
            id: "1".into(),
            title: "first save".into(),
            done: false,
            priority: None,
            due_at: None,
            created_at: now_iso(),
            updated_at: now_iso(),
        });
        app.persist();
        let first_text = std::fs::read_to_string(dir.join("companion-data.json")).unwrap();

        app.state.todos[0].title = "second save".into();
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
