use serde::{Deserialize, Serialize};

// ─── Top-level wallpaper state ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperState {
    pub clock: ClockState,
    pub ai: AiState,
    pub todos: Vec<TodoItem>,
    pub memos: Vec<MemoItem>,
    pub bookmarks: Vec<BookmarkItem>,
    pub spotify: SpotifyState,
    pub weather: WeatherState,
    pub news: Vec<NewsItem>,
    pub notifications: Vec<NotificationItem>,
    pub updated_at: String,
}

impl Default for WallpaperState {
    fn default() -> Self {
        Self {
            clock: ClockState::default(),
            ai: AiState::default(),
            todos: vec![],
            memos: vec![],
            bookmarks: vec![],
            spotify: SpotifyState::default(),
            weather: WeatherState::default(),
            news: vec![],
            notifications: vec![],
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

// ─── Clock ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockState {
    pub timezone: String,
}

impl Default for ClockState {
    fn default() -> Self {
        Self {
            timezone: "Asia/Tokyo".to_string(),
        }
    }
}

// ─── AI ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiState {
    pub provider: String, // "openai" | "google" | "none"
    pub status: String,   // "idle" | "thinking" | "responding" | "error"
    pub last_user_message: Option<String>,
    pub last_assistant_message: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub error: Option<String>,
}

impl Default for AiState {
    fn default() -> Self {
        Self {
            provider: "none".to_string(),
            status: "idle".to_string(),
            last_user_message: None,
            last_assistant_message: None,
            messages: vec![],
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user" | "assistant" | "system"
    pub text: String,
    pub created_at: String,
}

// ─── TODO ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub priority: Option<String>, // "low" | "normal" | "high"
    pub due_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Memo ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoItem {
    pub id: String,
    pub text: String,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Bookmark ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub order: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── Spotify ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyState {
    pub connected: bool,
    pub status: String, // "idle" | "playing" | "paused" | "error"
    pub track: Option<SpotifyTrack>,
    pub error: Option<String>,
}

impl Default for SpotifyState {
    fn default() -> Self {
        Self {
            connected: false,
            status: "idle".to_string(),
            track: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyTrack {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_art_url: Option<String>,
    pub duration_ms: Option<u64>,
    pub progress_ms: Option<u64>,
}

// ─── Weather ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherState {
    pub source: String, // "live" | "mock"
    pub current: Option<WeatherCurrent>,
    pub updated_at: Option<String>,
    pub error: Option<String>,
}

impl Default for WeatherState {
    fn default() -> Self {
        Self {
            source: "mock".to_string(),
            current: None,
            updated_at: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCurrent {
    pub temperature: f64,
    pub weather_code: i32,
    pub wind_speed: f64,
}

// ─── News ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub source: Option<String>,
    pub url: String,
    pub published_at: Option<String>,
    pub summary: Option<String>,
}

// ─── Notification ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    pub created_at: String,
}
