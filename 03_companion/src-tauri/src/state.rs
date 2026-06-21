use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
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
            http: reqwest::Client::builder()
                .user_agent("tohoku-companion/0.1")
                .build()
                .unwrap_or_default(),
            spotify_token: None,
        }
    }

    /// Persist mutable user data + config + secrets to disk (best effort).
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
        if let Ok(text) = serde_json::to_string_pretty(&p) {
            let path = self.data_dir.join("companion-data.json");
            let _ = std::fs::write(path, text);
        }
        // touch updatedAt so pollers can detect change
        // (caller already mutated `state`; we just stamp time here is not ideal
        //  because we hold &self — callers stamp updated_at themselves.)
    }
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
