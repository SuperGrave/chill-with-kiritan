use axum::{
    extract::{Path, State},
    http::{HeaderValue, Method},
    response::Json,
    routing::{get, patch, post, put},
    Router,
};
use serde_json::{json, Value};
use std::{net::SocketAddr, time::Instant};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::models::*;
use crate::services;
use crate::state::Shared;

pub const API_PORT: u16 = 40313;

/// Builds the full axum router (shared by the live server and integration tests).
pub fn build_router(shared: Shared) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let s = origin.to_str().unwrap_or("");
            s.starts_with("http://localhost")
                || s.starts_with("http://127.0.0.1")
                || s == "null" // Wallpaper Engine WebView uses null origin for file://
        }))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers(tower_http::cors::Any);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(get_state))
        // ── Kiritan runtime state (Stage C) ──────────────────────────
        .route("/api/kiritan/state", get(get_kiritan_state).post(post_kiritan_state))
        // ── Display settings + presets ───────────────────────────────
        .route("/api/ui", get(get_ui).put(put_ui))
        .route("/api/presets", get(list_presets).post(create_preset))
        .route("/api/presets/:id", put(update_preset).delete(delete_preset))
        .route("/api/presets/:id/apply", post(apply_preset))
        // ── Config / secrets ─────────────────────────────────────────
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/secrets/status", get(secrets_status))
        .route("/api/secrets", put(put_secrets))
        // ── TODO ─────────────────────────────────────────────────────
        .route("/api/todos", get(list_todos).post(create_todo))
        .route("/api/todos/:id", patch(update_todo).delete(delete_todo))
        // ── Memo ─────────────────────────────────────────────────────
        .route("/api/memos", get(list_memos).post(create_memo))
        .route("/api/memos/:id", patch(update_memo).delete(delete_memo))
        // ── Bookmark ─────────────────────────────────────────────────
        .route("/api/bookmarks", get(list_bookmarks).post(create_bookmark))
        .route("/api/bookmarks/:id", patch(update_bookmark).delete(delete_bookmark))
        // ── Chat ─────────────────────────────────────────────────────
        .route("/api/chat/send", post(chat_send))
        .route("/api/chat/history", get(chat_history))
        .route("/api/chat/clear", post(chat_clear))
        // ── News / Weather / Spotify ─────────────────────────────────
        .route("/api/news", get(get_news))
        .route("/api/news/refresh", post(news_refresh))
        .route("/api/weather/current", get(weather_current))
        .route("/api/weather/refresh", post(weather_refresh))
        .route("/api/spotify/now-playing", get(spotify_now_playing))
        .route("/api/spotify/refresh", post(spotify_refresh))
        .layer(cors)
        .with_state(shared)
}

/// Async HTTP server — runs forever on Tauri's tokio runtime.
pub async fn serve(shared: Shared) {
    let app = build_router(shared);
    let addr = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => {
            println!("[companion] HTTP API ready → http://{}", addr);
            l
        }
        Err(e) => {
            eprintln!("[companion] Failed to bind {} — {}", addr, e);
            return;
        }
    };
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[companion] API server error: {}", e);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Stamp updatedAt and write to disk. Call after any mutation (lock held).
fn touch(s: &mut crate::state::AppState) {
    s.state.updated_at = now_iso();
    s.persist();
}

/// Recursive JSON object merge (incoming overrides base, deep for objects).
fn merge(base: &mut Value, incoming: Value) {
    match (base, incoming) {
        (Value::Object(b), Value::Object(i)) => {
            for (k, v) in i {
                merge(b.entry(k).or_insert(Value::Null), v);
            }
        }
        (b, i) => *b = i,
    }
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "app": "Tohoku Companion", "version": env!("CARGO_PKG_VERSION") }))
}

async fn get_state(State(s): State<Shared>) -> Json<WallpaperState> {
    Json(s.lock().unwrap().state.clone())
}

// ─── Kiritan runtime state ──────────────────────────────────────────────────
// The wallpaper's Motion Director POSTs here on every mode change and on a
// ~30s heartbeat (fire-and-forget — see kiritanPoster.ts). `None`/absent means
// the wallpaper hasn't reported yet (e.g. Companion just started, or the
// wallpaper isn't running); callers should treat that as "unknown", not an error.

async fn get_kiritan_state(State(s): State<Shared>) -> Json<Value> {
    match &s.lock().unwrap().state.kiritan {
        Some(k) => Json(serde_json::to_value(k).unwrap_or(json!(null))),
        None => Json(json!(null)),
    }
}

async fn post_kiritan_state(
    State(s): State<Shared>,
    Json(body): Json<KiritanStatePost>,
) -> Json<Value> {
    // Structural validity (required fields, correct types) is already enforced
    // by the Json<KiritanStatePost> extractor — axum returns 422 before this
    // function runs if the body doesn't match. Add the semantic checks the
    // wallpaper's own validateKiritanState() applies on the TS side.
    if body.mode.trim().is_empty() {
        return Json(json!({ "ok": false, "error": "mode must not be empty" }));
    }
    if body.presence != "present" && body.presence != "away" {
        return Json(json!({ "ok": false, "error": "presence must be 'present' or 'away'" }));
    }
    if !(0.0..=1.0).contains(&body.sleepiness) {
        return Json(json!({ "ok": false, "error": "sleepiness out of 0..1" }));
    }

    let mut g = s.lock().unwrap();
    g.state.kiritan = Some(KiritanRuntimeState::from(body));
    // Deliberately NOT touch()/persist(): this is a live runtime signal
    // re-sent every ~30s, not user data — see the `kiritan` field doc comment
    // on WallpaperState and `state::Persist` (which excludes it).
    ok()
}

// ─── UI settings ───────────────────────────────────────────────────────────────

async fn get_ui(State(s): State<Shared>) -> Json<UiState> {
    Json(s.lock().unwrap().state.ui.clone())
}

async fn put_ui(State(s): State<Shared>, Json(body): Json<Value>) -> Json<UiState> {
    let mut g = s.lock().unwrap();
    if let Some(layout) = body.get("layout") {
        g.state.ui.layout = layout.clone();
    }
    if let Some(settings) = body.get("settings") {
        g.state.ui.settings = settings.clone();
    }
    // direct edit detaches from the active preset
    g.state.ui.active_preset_id = None;
    touch(&mut g);
    Json(g.state.ui.clone())
}

// ─── Presets ───────────────────────────────────────────────────────────────────

async fn list_presets(State(s): State<Shared>) -> Json<Vec<UiPreset>> {
    Json(s.lock().unwrap().state.ui.presets.clone())
}

async fn create_preset(State(s): State<Shared>, Json(body): Json<Value>) -> Json<UiPreset> {
    let mut g = s.lock().unwrap();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string();
    // snapshot current ui unless explicit layout/settings provided
    let layout = body.get("layout").cloned().unwrap_or_else(|| g.state.ui.layout.clone());
    let settings = body
        .get("settings")
        .cloned()
        .unwrap_or_else(|| g.state.ui.settings.clone());
    let preset = UiPreset {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        layout,
        settings,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    g.state.ui.presets.push(preset.clone());
    touch(&mut g);
    Json(preset)
}

async fn update_preset(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let found = g.state.ui.presets.iter_mut().find(|p| p.id == id);
    let Some(p) = found else {
        return Json(json!({ "ok": false, "error": "not found" }));
    };
    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        p.name = name.to_string();
    }
    if let Some(layout) = body.get("layout") {
        p.layout = layout.clone();
    }
    if let Some(settings) = body.get("settings") {
        p.settings = settings.clone();
    }
    p.updated_at = now_iso();
    let out = p.clone();
    touch(&mut g);
    Json(json!({ "ok": true, "preset": out }))
}

async fn delete_preset(State(s): State<Shared>, Path(id): Path<String>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let before = g.state.ui.presets.len();
    g.state.ui.presets.retain(|p| p.id != id);
    if g.state.ui.active_preset_id.as_deref() == Some(&id) {
        g.state.ui.active_preset_id = None;
    }
    let removed = before != g.state.ui.presets.len();
    touch(&mut g);
    Json(json!({ "ok": removed }))
}

async fn apply_preset(State(s): State<Shared>, Path(id): Path<String>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let preset = g.state.ui.presets.iter().find(|p| p.id == id).cloned();
    let Some(p) = preset else {
        return Json(json!({ "ok": false, "error": "not found" }));
    };
    g.state.ui.layout = p.layout.clone();
    g.state.ui.settings = p.settings.clone();
    g.state.ui.active_preset_id = Some(id);
    touch(&mut g);
    Json(json!({ "ok": true, "ui": g.state.ui.clone() }))
}

// ─── Settings / secrets ─────────────────────────────────────────────────────────

async fn get_settings(State(s): State<Shared>) -> Json<AppSettings> {
    Json(s.lock().unwrap().state.settings.clone())
}

async fn put_settings(State(s): State<Shared>, Json(body): Json<Value>) -> Json<AppSettings> {
    let mut g = s.lock().unwrap();
    let mut cur = serde_json::to_value(&g.state.settings).unwrap_or(json!({}));
    merge(&mut cur, body);
    if let Ok(parsed) = serde_json::from_value::<AppSettings>(cur) {
        g.state.settings = parsed;
        g.state.ai.provider = g.state.settings.ai.provider.clone();
    }
    touch(&mut g);
    Json(g.state.settings.clone())
}

async fn secrets_status(State(s): State<Shared>) -> Json<Value> {
    let g = s.lock().unwrap();
    let sec = &g.secrets;
    Json(json!({
        "openai": !sec.openai_key.is_empty(),
        "google": !sec.google_key.is_empty(),
        "spotifyClientSecret": !sec.spotify_client_secret.is_empty(),
        "spotifyRefreshToken": !sec.spotify_refresh_token.is_empty(),
    }))
}

async fn put_secrets(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let set = |dst: &mut String, v: Option<&Value>| {
        if let Some(x) = v.and_then(|v| v.as_str()) {
            if !x.is_empty() {
                *dst = x.to_string();
            }
        }
    };
    set(&mut g.secrets.openai_key, body.get("openaiKey"));
    set(&mut g.secrets.google_key, body.get("googleKey"));
    set(&mut g.secrets.spotify_client_secret, body.get("spotifyClientSecret"));
    set(&mut g.secrets.spotify_refresh_token, body.get("spotifyRefreshToken"));
    g.spotify_token = None; // force re-auth on next poll
    touch(&mut g);
    ok()
}

// ─── TODO ───────────────────────────────────────────────────────────────────────

async fn list_todos(State(s): State<Shared>) -> Json<Vec<TodoItem>> {
    Json(s.lock().unwrap().state.todos.clone())
}

async fn create_todo(State(s): State<Shared>, Json(body): Json<Value>) -> Json<TodoItem> {
    let mut g = s.lock().unwrap();
    let item = TodoItem {
        id: uuid::Uuid::new_v4().to_string(),
        title: body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        done: false,
        priority: body.get("priority").and_then(|v| v.as_str()).map(String::from),
        due_at: body.get("dueAt").and_then(|v| v.as_str()).map(String::from),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    g.state.todos.push(item.clone());
    touch(&mut g);
    Json(item)
}

async fn update_todo(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let Some(t) = g.state.todos.iter_mut().find(|t| t.id == id) else {
        return Json(json!({ "ok": false }));
    };
    if let Some(v) = body.get("title").and_then(|v| v.as_str()) {
        t.title = v.to_string();
    }
    if let Some(v) = body.get("done").and_then(|v| v.as_bool()) {
        t.done = v;
    }
    if let Some(v) = body.get("priority").and_then(|v| v.as_str()) {
        t.priority = Some(v.to_string());
    }
    t.updated_at = now_iso();
    touch(&mut g);
    ok()
}

async fn delete_todo(State(s): State<Shared>, Path(id): Path<String>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    g.state.todos.retain(|t| t.id != id);
    touch(&mut g);
    ok()
}

// ─── Memo ────────────────────────────────────────────────────────────────────────

async fn list_memos(State(s): State<Shared>) -> Json<Vec<MemoItem>> {
    Json(s.lock().unwrap().state.memos.clone())
}

async fn create_memo(State(s): State<Shared>, Json(body): Json<Value>) -> Json<MemoItem> {
    let mut g = s.lock().unwrap();
    let item = MemoItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: body.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        pinned: body.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    g.state.memos.push(item.clone());
    touch(&mut g);
    Json(item)
}

async fn update_memo(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let Some(m) = g.state.memos.iter_mut().find(|m| m.id == id) else {
        return Json(json!({ "ok": false }));
    };
    if let Some(v) = body.get("text").and_then(|v| v.as_str()) {
        m.text = v.to_string();
    }
    if let Some(v) = body.get("pinned").and_then(|v| v.as_bool()) {
        m.pinned = v;
    }
    m.updated_at = now_iso();
    touch(&mut g);
    ok()
}

async fn delete_memo(State(s): State<Shared>, Path(id): Path<String>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    g.state.memos.retain(|m| m.id != id);
    touch(&mut g);
    ok()
}

// ─── Bookmark ─────────────────────────────────────────────────────────────────────

async fn list_bookmarks(State(s): State<Shared>) -> Json<Vec<BookmarkItem>> {
    Json(s.lock().unwrap().state.bookmarks.clone())
}

async fn create_bookmark(State(s): State<Shared>, Json(body): Json<Value>) -> Json<BookmarkItem> {
    let mut g = s.lock().unwrap();
    let order = g.state.bookmarks.len() as i32;
    let item = BookmarkItem {
        id: uuid::Uuid::new_v4().to_string(),
        title: body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        url: body.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        icon: None,
        category: body.get("category").and_then(|v| v.as_str()).map(String::from),
        order: Some(order),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    g.state.bookmarks.push(item.clone());
    touch(&mut g);
    Json(item)
}

async fn update_bookmark(
    State(s): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let Some(b) = g.state.bookmarks.iter_mut().find(|b| b.id == id) else {
        return Json(json!({ "ok": false }));
    };
    if let Some(v) = body.get("title").and_then(|v| v.as_str()) {
        b.title = v.to_string();
    }
    if let Some(v) = body.get("url").and_then(|v| v.as_str()) {
        b.url = v.to_string();
    }
    if let Some(v) = body.get("category").and_then(|v| v.as_str()) {
        b.category = Some(v.to_string());
    }
    b.updated_at = now_iso();
    touch(&mut g);
    ok()
}

async fn delete_bookmark(State(s): State<Shared>, Path(id): Path<String>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    g.state.bookmarks.retain(|b| b.id != id);
    touch(&mut g);
    ok()
}

// ─── Chat ──────────────────────────────────────────────────────────────────────────

async fn chat_history(State(s): State<Shared>) -> Json<Vec<ChatMessage>> {
    Json(s.lock().unwrap().state.ai.messages.clone())
}

async fn chat_clear(State(s): State<Shared>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    g.state.ai.messages.clear();
    g.state.ai.status = "idle".to_string();
    g.state.ai.error = None;
    touch(&mut g);
    ok()
}

async fn chat_send(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let text = body.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if text.is_empty() {
        return Json(json!({ "ok": false, "error": "empty" }));
    }

    // Push user message + snapshot config/key under lock.
    let (provider, model, system_prompt, key, history, http) = {
        let mut g = s.lock().unwrap();
        g.state.ai.messages.push(ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            text: text.clone(),
            created_at: now_iso(),
        });
        g.state.ai.last_user_message = Some(text.clone());
        g.state.ai.status = "thinking".to_string();
        g.state.ai.error = None;
        let provider = g.state.settings.ai.provider.clone();
        let model = g.state.settings.ai.model.clone();
        let system = g.state.settings.ai.system_prompt.clone();
        let key = match provider.as_str() {
            "openai" => g.secrets.openai_key.clone(),
            "google" => g.secrets.google_key.clone(),
            _ => String::new(),
        };
        let history = g.state.ai.messages.clone();
        let http = g.http.clone();
        touch(&mut g);
        (provider, model, system, key, history, http)
    };

    let result = if provider == "none" || provider.is_empty() {
        Err("AIプロバイダーが未設定です（設定タブで OpenAI/Google を選択しキーを入力）".to_string())
    } else if key.is_empty() {
        Err(format!("{} のAPIキーが未設定です", provider))
    } else if provider == "openai" {
        services::chat_openai(&http, &key, &model, &system_prompt, &history).await
    } else {
        services::chat_gemini(&http, &key, &model, &system_prompt, &history).await
    };

    let mut g = s.lock().unwrap();
    match result {
        Ok(reply) => {
            let msg = ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                text: reply.clone(),
                created_at: now_iso(),
            };
            g.state.ai.messages.push(msg.clone());
            g.state.ai.last_assistant_message = Some(reply);
            g.state.ai.status = "idle".to_string();
            touch(&mut g);
            Json(json!({ "ok": true, "message": msg }))
        }
        Err(e) => {
            g.state.ai.status = "error".to_string();
            g.state.ai.error = Some(e.clone());
            touch(&mut g);
            Json(json!({ "ok": false, "error": e }))
        }
    }
}

// ─── News ──────────────────────────────────────────────────────────────────────────

async fn get_news(State(s): State<Shared>) -> Json<Vec<NewsItem>> {
    Json(s.lock().unwrap().state.news.clone())
}

async fn news_refresh(State(s): State<Shared>) -> Json<Value> {
    let (cfg, http) = {
        let g = s.lock().unwrap();
        (g.state.settings.news.clone(), g.http.clone())
    };
    match services::fetch_news(&http, &cfg).await {
        Ok(items) => {
            let mut g = s.lock().unwrap();
            g.state.news = items.clone();
            touch(&mut g);
            Json(json!({ "ok": true, "count": items.len(), "news": items }))
        }
        Err(e) => Json(json!({ "ok": false, "error": e })),
    }
}

// ─── Weather ────────────────────────────────────────────────────────────────────────

async fn weather_current(State(s): State<Shared>) -> Json<WeatherState> {
    Json(s.lock().unwrap().state.weather.clone())
}

async fn weather_refresh(State(s): State<Shared>) -> Json<Value> {
    let (cfg, http) = {
        let g = s.lock().unwrap();
        (g.state.settings.weather.clone(), g.http.clone())
    };
    match services::fetch_weather(&http, &cfg).await {
        Ok(cur) => {
            let mut g = s.lock().unwrap();
            g.state.weather = WeatherState {
                source: "live".to_string(),
                current: Some(cur),
                updated_at: Some(now_iso()),
                error: None,
            };
            touch(&mut g);
            Json(json!({ "ok": true, "weather": g.state.weather.clone() }))
        }
        Err(e) => {
            let mut g = s.lock().unwrap();
            g.state.weather.error = Some(e.clone());
            touch(&mut g);
            Json(json!({ "ok": false, "error": e }))
        }
    }
}

// ─── Spotify ────────────────────────────────────────────────────────────────────────

async fn spotify_now_playing(State(s): State<Shared>) -> Json<SpotifyState> {
    Json(s.lock().unwrap().state.spotify.clone())
}

/// Ensures a valid access token (refreshing via refresh_token if needed),
/// then polls currently-playing and writes it into state.
async fn spotify_refresh(State(s): State<Shared>) -> Json<Value> {
    // Snapshot creds + cached token.
    let (client_id, client_secret, refresh_token, cached, http) = {
        let g = s.lock().unwrap();
        let cached = g.spotify_token.as_ref().and_then(|(t, exp)| {
            if *exp > Instant::now() {
                Some(t.clone())
            } else {
                None
            }
        });
        (
            g.state.settings.spotify.client_id.clone(),
            g.secrets.spotify_client_secret.clone(),
            g.secrets.spotify_refresh_token.clone(),
            cached,
            g.http.clone(),
        )
    };

    if client_id.is_empty() || client_secret.is_empty() || refresh_token.is_empty() {
        let mut g = s.lock().unwrap();
        g.state.spotify = SpotifyState {
            connected: false,
            status: "unconfigured".to_string(),
            track: None,
            error: None,
        };
        touch(&mut g);
        return Json(json!({ "ok": false, "status": "unconfigured" }));
    }

    // Get a token: cached, else refresh.
    let token = if let Some(t) = cached {
        t
    } else {
        match services::spotify_refresh_token(&http, &client_id, &client_secret, &refresh_token).await
        {
            Ok((t, expires)) => {
                let mut g = s.lock().unwrap();
                let exp = Instant::now() + std::time::Duration::from_secs(expires.saturating_sub(60));
                g.spotify_token = Some((t.clone(), exp));
                t
            }
            Err(e) => {
                let mut g = s.lock().unwrap();
                g.state.spotify.status = "error".to_string();
                g.state.spotify.error = Some(e.clone());
                touch(&mut g);
                return Json(json!({ "ok": false, "error": e }));
            }
        }
    };

    match services::spotify_now_playing(&http, &token).await {
        Ok(track) => {
            let mut g = s.lock().unwrap();
            let status = match &track {
                Some(t) if t.is_playing => "playing",
                Some(_) => "paused",
                None => "idle",
            };
            g.state.spotify = SpotifyState {
                connected: true,
                status: status.to_string(),
                track,
                error: None,
            };
            touch(&mut g);
            Json(json!({ "ok": true, "spotify": g.state.spotify.clone() }))
        }
        Err(e) => {
            let mut g = s.lock().unwrap();
            g.state.spotify.status = "error".to_string();
            g.state.spotify.error = Some(e.clone());
            touch(&mut g);
            Json(json!({ "ok": false, "error": e }))
        }
    }
}
