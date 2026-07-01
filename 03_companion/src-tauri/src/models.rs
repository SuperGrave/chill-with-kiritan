use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ─── Top-level wallpaper state (public — served by /api/state, NEVER secrets) ──

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
    /// Display settings (layout/settings/presets) owned by the companion.
    pub ui: UiState,
    /// Public (non-secret) configuration for weather/news/ai/spotify.
    pub settings: AppSettings,
    /// Latest kiritanState the wallpaper POSTed (mode/presence/sleepiness).
    /// `None` until the wallpaper has reported at least once. Memory-only —
    /// not written to disk (see `state::Persist`), since it's a live runtime
    /// signal re-sent on every mode change / ~30s heartbeat.
    pub kiritan: Option<KiritanRuntimeState>,
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
            ui: UiState::default(),
            settings: AppSettings::default(),
            kiritan: None,
            updated_at: now_iso(),
        }
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
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

// ─── UI display settings + presets ───────────────────────────────────────────
// `layout` and `settings` are opaque JSON objects matching the overlay's own
// schema (02_ui-overlay/src/config/{layout,uiSettings}.ts). Keeping them opaque
// lets the overlay evolve its shape without churning the Rust types.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiState {
    pub layout: Value,
    pub settings: Value,
    pub presets: Vec<UiPreset>,
    pub active_preset_id: Option<String>,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            // Empty objects: until the overlay first PUTs its defaults, the
            // overlay keeps using its own built-in defaults (merge semantics).
            layout: json!({}),
            settings: json!({}),
            presets: vec![],
            active_preset_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPreset {
    pub id: String,
    pub name: String,
    pub layout: Value,
    pub settings: Value,
    pub created_at: String,
    pub updated_at: String,
}

// ─── App settings (public config) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub weather: WeatherConfig,
    pub news: NewsConfig,
    pub ai: AiConfig,
    pub spotify: SpotifyConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            weather: WeatherConfig::default(),
            news: NewsConfig::default(),
            ai: AiConfig::default(),
            spotify: SpotifyConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: String,
    pub location_label: String,
    pub jma_office: String,
}

impl Default for WeatherConfig {
    fn default() -> Self {
        // Sapporo (matches the overlay's original default).
        Self {
            latitude: 43.0642,
            longitude: 141.3469,
            timezone: "Asia/Tokyo".to_string(),
            location_label: "SAPPORO".to_string(),
            jma_office: "016000".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsConfig {
    pub feeds: Vec<String>,
    pub max_items: usize,
}

impl Default for NewsConfig {
    fn default() -> Self {
        Self {
            feeds: vec![
                // NHK main news (no API key required).
                "https://www.nhk.or.jp/rss/news/cat0.xml".to_string(),
            ],
            max_items: 12,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: String, // "openai" | "google" | "none"
    pub model: String,
    pub system_prompt: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "none".to_string(),
            model: "gpt-4o-mini".to_string(),
            system_prompt:
                "あなたは東北きりたん。やさしく、少し砕けた口調で短めに返事をします。".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyConfig {
    pub client_id: String, // public part only; secret lives in Secrets
}

impl Default for SpotifyConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
        }
    }
}

// ─── Secrets (NEVER serialized into /api/state) ──────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Secrets {
    pub openai_key: String,
    pub google_key: String,
    pub spotify_client_secret: String,
    pub spotify_refresh_token: String,
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
    pub status: String, // "idle" | "playing" | "paused" | "error" | "unconfigured"
    pub track: Option<SpotifyTrack>,
    pub error: Option<String>,
}

impl Default for SpotifyState {
    fn default() -> Self {
        Self {
            connected: false,
            status: "unconfigured".to_string(),
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
    pub is_playing: bool,
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
    pub location: String,
    pub temperature: f64,
    pub apparent_temperature: f64,
    pub humidity: f64,
    pub pressure: f64,
    pub weather_code: i32,
    pub wind_speed: f64,
    pub wind_direction: f64,
    pub is_day: bool,
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

// ─── Kiritan runtime state (Stage C, 2026-07-01) ─────────────────────────────
// Wire schema mirrors 01_wallpaper/src/lib/motion/director/types.ts's
// `KiritanState` exactly (that TS type is the source of truth — the wallpaper
// is the sender). `POST /api/kiritan/state` accepts this shape directly, so a
// malformed/incomplete body fails Json extraction (axum 400) before the
// handler even runs.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiritanAmbient {
    pub id: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiritanAway {
    pub reason: String,
    pub expected_return_at: String,
}

/// Body accepted by `POST /api/kiritan/state` — exactly the wallpaper's wire
/// object, no server-generated fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiritanStatePost {
    pub mode: String,
    pub mode_label: String,
    pub since: String, // ISO
    pub prev_mode: Option<String>,
    pub presence: String, // "present" | "away"
    pub ambient: Option<KiritanAmbient>,
    pub interrupt_policy: String,
    pub chat_delay_ms_range: Option<(u32, u32)>,
    pub sleepiness: f64, // 0..1
    pub away: Option<KiritanAway>,
}

/// Stored/served shape — the posted body plus a server-stamped `receivedAt` so
/// consumers (Companion UI, AI context) can tell a live signal from a stale one
/// if the wallpaper stops posting (e.g. closed) without a graceful "offline" message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiritanRuntimeState {
    pub mode: String,
    pub mode_label: String,
    pub since: String,
    pub prev_mode: Option<String>,
    pub presence: String,
    pub ambient: Option<KiritanAmbient>,
    pub interrupt_policy: String,
    pub chat_delay_ms_range: Option<(u32, u32)>,
    pub sleepiness: f64,
    pub away: Option<KiritanAway>,
    pub received_at: String, // ISO, server clock
}

impl From<KiritanStatePost> for KiritanRuntimeState {
    fn from(p: KiritanStatePost) -> Self {
        Self {
            mode: p.mode,
            mode_label: p.mode_label,
            since: p.since,
            prev_mode: p.prev_mode,
            presence: p.presence,
            ambient: p.ambient,
            interrupt_policy: p.interrupt_policy,
            chat_delay_ms_range: p.chat_delay_ms_range,
            sleepiness: p.sleepiness,
            away: p.away,
            received_at: now_iso(),
        }
    }
}
