use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Host, Path, Query, State},
    http::{HeaderValue, Method, Request, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{Html, IntoResponse, Json, Response},
    routing::{get, patch, post, put},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{net::SocketAddr, path::Path as FsPath, time::Instant};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;

use crate::models::*;
use crate::services;
use crate::startup;
use crate::state::Shared;

pub const API_PORT: u16 = 40313;
pub const API_TOKEN_HEADER: &str = "X-Companion-Token";

pub fn api_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], API_PORT))
}

fn is_allowed_origin(origin: &str) -> bool {
    if origin == "null" || origin == "tauri://localhost" {
        return true; // Wallpaper Engine file:// and Tauri custom protocol.
    }

    for base in [
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ] {
        if let Some(rest) = origin.strip_prefix(base) {
            return rest.is_empty() || rest.starts_with(':');
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin;

    #[test]
    fn allowed_origin_accepts_only_local_webviews() {
        assert!(is_allowed_origin("null"));
        assert!(is_allowed_origin("tauri://localhost"));
        assert!(is_allowed_origin("http://localhost"));
        assert!(is_allowed_origin("http://localhost:5173"));
        assert!(is_allowed_origin("https://tauri.localhost"));
        assert!(is_allowed_origin("https://tauri.localhost:443"));
        assert!(is_allowed_origin("http://127.0.0.1:40313"));

        assert!(!is_allowed_origin("https://example.com"));
        assert!(!is_allowed_origin("http://localhost.evil.test"));
        assert!(!is_allowed_origin("http://127.0.0.10:40313"));
    }
}

/// Builds the full axum router (shared by the live server and integration tests).
pub fn build_router(shared: Shared) -> Router {
    let backgrounds_dir = {
        let g = shared.lock().unwrap();
        g.data_dir.join("backgrounds")
    };
    let _ = std::fs::create_dir_all(&backgrounds_dir);

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let s = origin.to_str().unwrap_or("");
            is_allowed_origin(s)
        }))
        // Wallpaper Engine loads the wallpaper from a file:// page, which some
        // Chromium builds treat as a non-local context for Private Network Access.
        // Keep this header enabled so file:// wallpapers can still talk to the
        // loopback Companion API when PNA preflights are enforced. The v0.8.0
        // camera/reporting outage also had a separate asset cause: the local
        // Wallpaper Engine folder must contain models/kiritan.vrm for the VRM-gated
        // camera application and kiritan state poster to run.
        .allow_private_network(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers(tower_http::cors::Any);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/token", get(auth_token))
        .route("/api/state", get(get_state))
        .route("/api/runtime", get(get_runtime_state))
        .route("/api/timer", get(get_timer))
        .route("/api/timer/control", post(timer_control))
        // ── Kiritan runtime state (Stage C) ──────────────────────────
        .route(
            "/api/kiritan/state",
            get(get_kiritan_state).post(post_kiritan_state),
        )
        // ── Display settings + presets ───────────────────────────────
        .route("/api/ui", get(get_ui).put(put_ui))
        .route("/api/presets", get(list_presets).post(create_preset))
        .route("/api/presets/:id", put(update_preset).delete(delete_preset))
        .route("/api/presets/:id/apply", post(apply_preset))
        // ── Background media ────────────────────────────────────────
        .route("/api/backgrounds/upload", post(background_upload))
        .nest_service("/api/backgrounds", ServeDir::new(backgrounds_dir))
        // ── Config / secrets ─────────────────────────────────────────
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/startup/status", get(startup_status))
        .route("/api/startup/repair", post(startup_repair))
        .route(
            "/api/startup/repair-elevated",
            post(startup_repair_elevated),
        )
        .route("/api/secrets/status", get(secrets_status))
        .route("/api/secrets", put(put_secrets))
        // ── Data folder / backup ─────────────────────────────────────
        .route("/api/data-dir", get(get_data_dir))
        .route("/api/backup/export", post(backup_export))
        .route("/api/backup/import", post(backup_import))
        // ── Memo ─────────────────────────────────────────────────────
        .route("/api/memos", get(list_memos).post(create_memo))
        .route("/api/memos/:id", patch(update_memo).delete(delete_memo))
        // ── Bookmark ─────────────────────────────────────────────────
        .route("/api/bookmarks", get(list_bookmarks).post(create_bookmark))
        .route(
            "/api/bookmarks/:id",
            patch(update_bookmark).delete(delete_bookmark),
        )
        // ── News / Weather / Spotify ─────────────────────────────────
        .route("/api/news", get(get_news))
        .route("/api/news/feeds", get(get_news_feeds))
        .route("/api/news/refresh", post(news_refresh))
        .route("/api/personal-news", get(get_personal_news))
        .route("/api/personal-news/reload", post(personal_news_reload))
        .route("/api/personal-news/select", post(personal_news_select))
        .route("/api/personal-news/control", post(personal_news_control))
        .route("/api/weather/current", get(weather_current))
        .route("/api/weather/refresh", post(weather_refresh))
        .route("/api/spotify/auth-url", get(spotify_auth_url))
        .route("/api/spotify/now-playing", get(spotify_now_playing))
        .route("/api/spotify/refresh", post(spotify_refresh))
        .route("/api/spotify/control", post(spotify_control))
        .route("/spotify/callback", get(spotify_callback))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(from_fn_with_state(shared.clone(), require_mutation_token))
        .layer(cors)
        .with_state(shared)
}

/// Async HTTP server — runs forever on Tauri's tokio runtime. Returns `Err`
/// only on a bind failure (e.g. a stale process still holding the port) or if
/// the server itself errors out; the caller surfaces this to the user instead
/// of leaving the wallpaper/overlay silently stuck on "offline" with no
/// visible cause (see docs/COMPLETION_EXECUTION_PLAN_2026-07-01.md §4.2).
pub async fn serve(shared: Shared) -> Result<(), String> {
    let app = build_router(shared);
    let addr = api_addr();
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind {addr} — {e}"))?;
    println!("[companion] HTTP API ready → http://{}", addr);
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("API server error: {e}"))
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundUploadQuery {
    file_name: Option<String>,
    media_type: Option<String>,
}

fn safe_background_extension(file_name: Option<&str>, media_type: Option<&str>) -> String {
    let ext = file_name
        .and_then(|name| FsPath::new(name).extension())
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            ext.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(12)
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|ext| !ext.is_empty());

    ext.unwrap_or_else(|| match media_type {
        Some("video") => "mp4".to_string(),
        Some("image") | Some("overlay") => "png".to_string(),
        _ => "bin".to_string(),
    })
}

fn background_public_type(media_type: Option<&str>, ext: &str) -> &'static str {
    if media_type == Some("video") {
        return "video";
    }
    if media_type == Some("image") || media_type == Some("overlay") {
        return "image";
    }
    match ext {
        "mp4" | "webm" | "mov" | "m4v" | "mkv" | "avi" => "video",
        _ => "image",
    }
}

async fn require_mutation_token(
    State(shared): State<Shared>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(req).await;
    }

    let expected = shared.lock().unwrap().api_token.clone();
    let provided = req
        .headers()
        .get(API_TOKEN_HEADER)
        .and_then(|h| h.to_str().ok());
    if provided == Some(expected.as_str()) {
        return next.run(req).await;
    }

    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "ok": false,
            "error": "missing or invalid companion token",
        })),
    )
        .into_response()
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "app": "Tohoku Companion", "version": env!("CARGO_PKG_VERSION") }))
}

async fn auth_token(State(s): State<Shared>) -> Json<Value> {
    let token = s.lock().unwrap().api_token.clone();
    Json(json!({
        "token": token,
        "header": API_TOKEN_HEADER,
    }))
}

async fn get_state(State(s): State<Shared>) -> Json<WallpaperState> {
    let g = s.lock().unwrap();
    let mut state = g.state.clone();
    repair_ui_state(&mut state.ui);
    state.timer = materialize_timer(&state.timer, &state.ui.settings);
    Json(state)
}

async fn get_runtime_state(State(s): State<Shared>) -> Json<Value> {
    let g = s.lock().unwrap();
    let mut ui = g.state.ui.clone();
    repair_ui_state(&mut ui);
    let timer = materialize_timer(&g.state.timer, &ui.settings);
    let personal_news = crate::personal_news::materialize_personal_news(&g.state.personal_news);
    Json(json!({
        "news": g.state.news.clone(),
        "newsFeeds": g.state.news_feeds.clone(),
        "personalNews": personal_news,
        "spotify": g.state.spotify.clone(),
        "weather": g.state.weather.clone(),
        "memos": g.state.memos.clone(),
        "timer": timer,
        "updatedAt": g.state.updated_at.clone(),
    }))
}

#[derive(Debug, Clone)]
struct TimerDurations {
    mode: String,
    timer_ms: u64,
    focus_ms: u64,
    short_break_ms: u64,
    long_break_ms: u64,
}

fn timer_minutes(settings: &Value, key: &str, fallback: u64) -> u64 {
    settings
        .get("timerPanel")
        .and_then(|p| p.get(key))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_f64().map(|n| n.round().max(1.0) as u64))
        })
        .unwrap_or(fallback)
        .max(1)
}

fn timer_durations(settings: &Value) -> TimerDurations {
    let mode = settings
        .get("timerPanel")
        .and_then(|p| p.get("mode"))
        .and_then(|v| v.as_str())
        .filter(|v| *v == "timer" || *v == "pomodoro")
        .unwrap_or("pomodoro")
        .to_string();
    TimerDurations {
        mode,
        timer_ms: timer_minutes(settings, "timerMinutes", 10) * 60 * 1000,
        focus_ms: timer_minutes(settings, "pomodoroMinutes", 25) * 60 * 1000,
        short_break_ms: timer_minutes(settings, "shortBreakMinutes", 5) * 60 * 1000,
        long_break_ms: timer_minutes(settings, "longBreakMinutes", 15) * 60 * 1000,
    }
}

fn duration_for_timer_phase(settings: &TimerDurations, mode: &str, phase: &str) -> u64 {
    if mode == "timer" {
        settings.timer_ms
    } else {
        match phase {
            "shortBreak" => settings.short_break_ms,
            "longBreak" => settings.long_break_ms,
            _ => settings.focus_ms,
        }
    }
}

fn reset_timer_from_settings(settings: &TimerDurations) -> TimerState {
    let duration_ms = duration_for_timer_phase(settings, &settings.mode, "focus");
    TimerState {
        mode: settings.mode.clone(),
        phase: "focus".to_string(),
        status: "idle".to_string(),
        cycle: 1,
        duration_ms,
        remaining_ms: duration_ms,
        started_at: None,
        updated_at: now_iso(),
        command_seq: 0,
    }
}

fn advance_timer_phase(timer: &mut TimerState, settings: &TimerDurations) {
    let mode = if timer.mode == "timer" || timer.mode == "pomodoro" {
        timer.mode.clone()
    } else {
        settings.mode.clone()
    };
    if mode == "timer" {
        timer.mode = mode;
        timer.phase = "focus".to_string();
        timer.status = "finished".to_string();
        timer.duration_ms = settings.timer_ms;
        timer.remaining_ms = 0;
        timer.started_at = None;
        return;
    }

    timer.mode = "pomodoro".to_string();
    if timer.phase == "focus" {
        let current_cycle = timer.cycle.max(1);
        timer.phase = if current_cycle % 4 == 0 {
            "longBreak".to_string()
        } else {
            "shortBreak".to_string()
        };
        timer.cycle = current_cycle + 1;
    } else {
        timer.phase = "focus".to_string();
        timer.cycle = timer.cycle.max(1);
    }
    timer.duration_ms = duration_for_timer_phase(settings, &timer.mode, &timer.phase);
    timer.remaining_ms = timer.duration_ms;
    timer.started_at = None;
}

fn materialize_timer(timer: &TimerState, ui_settings: &Value) -> TimerState {
    let settings = timer_durations(ui_settings);
    let mut out = timer.clone();
    if out.mode != "timer" && out.mode != "pomodoro" {
        out.mode = settings.mode.clone();
    }
    if out.phase != "focus" && out.phase != "shortBreak" && out.phase != "longBreak" {
        out.phase = "focus".to_string();
    }
    if out.duration_ms == 0 {
        out.duration_ms = duration_for_timer_phase(&settings, &out.mode, &out.phase);
    }
    if out.remaining_ms > out.duration_ms {
        out.remaining_ms = out.duration_ms;
    }
    if out.status != "running" {
        return out;
    }

    let started_at = out
        .started_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    let Some(started_at) = started_at else {
        out.status = "paused".to_string();
        out.started_at = None;
        return out;
    };

    let now = chrono::Utc::now();
    let mut elapsed_ms = (now - started_at).num_milliseconds().max(0) as u64;
    let mut remaining = out.remaining_ms.max(1);
    while elapsed_ms >= remaining {
        elapsed_ms -= remaining;
        advance_timer_phase(&mut out, &settings);
        if out.status == "finished" {
            out.updated_at = now.to_rfc3339();
            return out;
        }
        remaining = out.remaining_ms.max(1);
    }

    out.remaining_ms = remaining.saturating_sub(elapsed_ms);
    out.started_at = Some(now.to_rfc3339());
    out.updated_at = now.to_rfc3339();
    out
}

async fn get_timer(State(s): State<Shared>) -> Json<TimerState> {
    let g = s.lock().unwrap();
    Json(materialize_timer(&g.state.timer, &g.state.ui.settings))
}

async fn timer_control(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if !matches!(action, "start" | "pause" | "reset" | "toggle" | "next") {
        return Json(json!({ "ok": false, "error": "unknown timer action" }));
    }

    let mut g = s.lock().unwrap();
    let settings = timer_durations(&g.state.ui.settings);
    let mut timer = materialize_timer(&g.state.timer, &g.state.ui.settings);
    let was_running = timer.status == "running";
    let resolved_action = if action == "toggle" {
        if was_running {
            "pause"
        } else {
            "start"
        }
    } else {
        action
    };

    match resolved_action {
        "reset" => {
            timer = reset_timer_from_settings(&settings);
        }
        "start" => {
            if timer.status == "finished" || timer.remaining_ms == 0 || timer.mode != settings.mode
            {
                timer = reset_timer_from_settings(&settings);
            }
            timer.status = "running".to_string();
            timer.started_at = Some(chrono::Utc::now().to_rfc3339());
        }
        "pause" => {
            timer.status = "paused".to_string();
            timer.started_at = None;
        }
        "next" => {
            if timer.mode != settings.mode {
                timer = reset_timer_from_settings(&settings);
            }
            let keep_running = was_running;
            advance_timer_phase(&mut timer, &settings);
            if timer.status != "finished" {
                timer.status = if keep_running { "running" } else { "idle" }.to_string();
                timer.started_at = keep_running.then(|| chrono::Utc::now().to_rfc3339());
            }
        }
        _ => {}
    }

    timer.command_seq = timer.command_seq.saturating_add(1);
    timer.updated_at = now_iso();
    g.state.timer = timer.clone();
    touch(&mut g);
    Json(json!({ "ok": true, "timer": timer }))
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
    let mut ui = s.lock().unwrap().state.ui.clone();
    repair_ui_state(&mut ui);
    Json(ui)
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
    repair_ui_state(&mut g.state.ui);
    touch(&mut g);
    Json(g.state.ui.clone())
}

async fn background_upload(
    State(s): State<Shared>,
    Host(host): Host,
    Query(query): Query<BackgroundUploadQuery>,
    body: Bytes,
) -> Json<Value> {
    if body.is_empty() {
        return Json(json!({ "ok": false, "error": "empty background file" }));
    }

    let original_name = query
        .file_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("background")
        .trim()
        .to_string();
    let media_type = query.media_type.as_deref();
    let ext = safe_background_extension(Some(&original_name), media_type);
    let public_type = background_public_type(media_type, &ext);
    let saved_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let dir = {
        let g = s.lock().unwrap();
        g.data_dir.join("backgrounds")
    };
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return Json(
            json!({ "ok": false, "error": format!("failed to prepare backgrounds dir: {e}") }),
        );
    }
    let path = dir.join(&saved_name);
    if let Err(e) = tokio::fs::write(&path, &body).await {
        return Json(
            json!({ "ok": false, "error": format!("failed to save background file: {e}") }),
        );
    }
    let host = if host.trim().is_empty() {
        format!("127.0.0.1:{}", API_PORT)
    } else {
        host
    };

    Json(json!({
        "ok": true,
        "item": {
            "url": format!("http://{}/api/backgrounds/{}", host, saved_name),
            "type": public_type,
            "kind": if media_type == Some("overlay") { "overlay" } else { "background" },
            "name": original_name,
            "fileName": saved_name,
            "size": body.len(),
        }
    }))
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
    let layout = body
        .get("layout")
        .cloned()
        .unwrap_or_else(|| g.state.ui.layout.clone());
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
    g.state.ui.presets.push(preset);
    repair_ui_state(&mut g.state.ui);
    let preset = g.state.ui.presets.last().cloned().unwrap();
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
    repair_ui_state(&mut g.state.ui);
    let out = g
        .state
        .ui
        .presets
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .unwrap();
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
    repair_ui_state(&mut g.state.ui);
    touch(&mut g);
    Json(json!({ "ok": true, "ui": g.state.ui.clone() }))
}

// ─── Settings / secrets ─────────────────────────────────────────────────────────

async fn get_settings(State(s): State<Shared>) -> Json<AppSettings> {
    Json(s.lock().unwrap().state.settings.clone())
}

async fn put_settings(State(s): State<Shared>, Json(body): Json<Value>) -> Json<AppSettings> {
    let mut startup_config = None;
    let mut weather_refresh = None;
    let next_settings = {
        let mut g = s.lock().unwrap();
        let previous_weather = g.state.settings.weather.clone();
        let mut cur = serde_json::to_value(&g.state.settings).unwrap_or(json!({}));
        merge(&mut cur, body);
        if let Ok(parsed) = serde_json::from_value::<AppSettings>(cur) {
            startup_config = Some(parsed.startup.clone());
            if parsed.weather != previous_weather {
                weather_refresh = Some((parsed.weather.clone(), g.http.clone()));
            }
            g.state.settings = parsed;
        }
        touch(&mut g);
        g.state.settings.clone()
    };

    if let Some(config) = startup_config {
        if let Err(e) = startup::reconcile(&config) {
            eprintln!("[companion] launch-at-login update failed: {e}");
        }
    }

    if let Some((cfg, http)) = weather_refresh {
        let shared = s.clone();
        tokio::spawn(async move {
            match services::fetch_weather(&http, &cfg).await {
                Ok(weather) => {
                    let mut g = shared.lock().unwrap();
                    if g.state.settings.weather == cfg {
                        g.state.weather = WeatherState {
                            source: "live".to_string(),
                            current: Some(weather.current),
                            hourly: weather.hourly,
                            overview: weather.overview,
                            updated_at: Some(now_iso()),
                            error: weather.error,
                        };
                        touch(&mut g);
                    }
                }
                Err(e) => {
                    let mut g = shared.lock().unwrap();
                    if g.state.settings.weather == cfg {
                        g.state.weather.error = Some(e);
                        touch(&mut g);
                    }
                }
            }
        });
    }

    Json(next_settings)
}

async fn startup_status(State(s): State<Shared>) -> Json<Value> {
    let config = s.lock().unwrap().state.settings.startup.clone();
    Json(json!({
        "ok": true,
        "status": startup::status(&config),
    }))
}

async fn startup_repair(State(s): State<Shared>) -> Json<Value> {
    let config = s.lock().unwrap().state.settings.startup.clone();
    match startup::reconcile(&config) {
        Ok(status) => Json(json!({ "ok": true, "status": status })),
        Err(e) => Json(json!({
            "ok": false,
            "error": e.to_string(),
            "status": startup::status(&config),
        })),
    }
}

async fn startup_repair_elevated(State(s): State<Shared>) -> Json<Value> {
    let config = s.lock().unwrap().state.settings.startup.clone();
    match startup::request_elevated_registration(&config) {
        Ok(()) => Json(json!({
            "ok": true,
            "launched": true,
            "status": startup::status(&config),
        })),
        Err(e) => Json(json!({
            "ok": false,
            "launched": false,
            "error": e.to_string(),
            "status": startup::status(&config),
        })),
    }
}

async fn secrets_status(State(s): State<Shared>) -> Json<Value> {
    let g = s.lock().unwrap();
    let sec = &g.secrets;
    Json(json!({
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
    set(
        &mut g.secrets.spotify_client_secret,
        body.get("spotifyClientSecret"),
    );
    set(
        &mut g.secrets.spotify_refresh_token,
        body.get("spotifyRefreshToken"),
    );
    g.spotify_token = None; // force re-auth on next poll
    touch(&mut g);
    ok()
}

/// Location of the Companion data folder (settings, backups, backgrounds).
/// The UI uses this to reveal the folder in the OS file manager.
async fn get_data_dir(State(s): State<Shared>) -> Json<Value> {
    let path = s.lock().unwrap().data_dir.to_string_lossy().to_string();
    Json(json!({ "ok": true, "path": path }))
}

/// Write a settings backup into `<data_dir>/backups/`. Secrets (API keys) are
/// excluded unless `includeSecrets` is explicitly true, so a shared backup does
/// not leak credentials by default. Returns the written file path.
async fn backup_export(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let include_secrets = body
        .get("includeSecrets")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let (bundle, backups_dir) = {
        let g = s.lock().unwrap();
        let mut bundle = json!({
            "app": "tohoku-companion",
            "kind": "companion-backup",
            "version": env!("CARGO_PKG_VERSION"),
            "exportedAt": now_iso(),
            "includeSecrets": include_secrets,
            "data": {
                "ui": g.state.ui,
                "settings": g.state.settings,
                "memos": g.state.memos,
                "bookmarks": g.state.bookmarks,
                "timer": g.state.timer,
            },
        });
        if include_secrets {
            bundle["secrets"] = serde_json::to_value(&g.secrets).unwrap_or(json!({}));
        }
        (bundle, g.data_dir.join("backups"))
    };

    if let Err(e) = std::fs::create_dir_all(&backups_dir) {
        return Json(
            json!({ "ok": false, "error": format!("フォルダを作成できませんでした: {e}") }),
        );
    }
    let stamp = now_iso().replace(':', "-").replace('.', "-");
    let file_name = format!("kiritan-companion-backup-{stamp}.json");
    let path = backups_dir.join(&file_name);
    match serde_json::to_string_pretty(&bundle) {
        Ok(text) => match std::fs::write(&path, text) {
            Ok(()) => Json(json!({
                "ok": true,
                "path": path.to_string_lossy(),
                "fileName": file_name,
                "includeSecrets": include_secrets,
            })),
            Err(e) => Json(json!({ "ok": false, "error": format!("書き込みに失敗しました: {e}") })),
        },
        Err(e) => Json(json!({ "ok": false, "error": format!("シリアライズに失敗しました: {e}") })),
    }
}

/// Restore a settings backup produced by `backup_export`. Accepts the full
/// bundle (`{ data: {...}, secrets? }`) or a bare data object. The current data
/// is written to `.bak` by `persist()` before being replaced, so a bad import
/// can be rolled back. Secrets are only touched when present in the bundle.
async fn backup_import(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let data = body.get("data").cloned().unwrap_or_else(|| body.clone());
    let mut applied: Vec<&str> = Vec::new();
    let startup_config;
    {
        let mut g = s.lock().unwrap();
        if let Some(v) = data.get("ui") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.state.ui = x;
                applied.push("ui");
            }
        }
        if let Some(v) = data.get("settings") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.state.settings = x;
                applied.push("settings");
            }
        }
        if let Some(v) = data.get("memos") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.state.memos = x;
                applied.push("memos");
            }
        }
        if let Some(v) = data.get("bookmarks") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.state.bookmarks = x;
                applied.push("bookmarks");
            }
        }
        if let Some(v) = data.get("timer") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.state.timer = x;
                applied.push("timer");
            }
        }
        if let Some(v) = body.get("secrets") {
            if let Ok(x) = serde_json::from_value(v.clone()) {
                g.secrets = x;
                applied.push("secrets");
            }
        }
        if applied.is_empty() {
            return Json(
                json!({ "ok": false, "error": "有効なバックアップデータが見つかりません" }),
            );
        }
        touch(&mut g);
        startup_config = g.state.settings.startup.clone();
    }

    if let Err(e) = startup::reconcile(&startup_config) {
        eprintln!("[companion] startup reconcile after import failed: {e}");
    }
    Json(json!({ "ok": true, "applied": applied }))
}

// ─── Memo ────────────────────────────────────────────────────────────────────────

async fn list_memos(State(s): State<Shared>) -> Json<Vec<MemoItem>> {
    Json(s.lock().unwrap().state.memos.clone())
}

async fn create_memo(State(s): State<Shared>, Json(body): Json<Value>) -> Json<MemoItem> {
    let mut g = s.lock().unwrap();
    let item = MemoItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: body
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        pinned: body
            .get("pinned")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
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
        title: body
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        url: body
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        icon: None,
        category: body
            .get("category")
            .and_then(|v| v.as_str())
            .map(String::from),
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

// ─── News ──────────────────────────────────────────────────────────────────────────

async fn get_news(State(s): State<Shared>) -> Json<Vec<NewsItem>> {
    Json(s.lock().unwrap().state.news.clone())
}

async fn get_news_feeds(State(s): State<Shared>) -> Json<Vec<NewsFeedState>> {
    Json(s.lock().unwrap().state.news_feeds.clone())
}

async fn news_refresh(State(s): State<Shared>) -> Json<Value> {
    let (cfg, http) = {
        let g = s.lock().unwrap();
        (g.state.settings.news.clone(), g.http.clone())
    };
    match services::fetch_news(&http, &cfg).await {
        Ok(fetch) => {
            let mut g = s.lock().unwrap();
            if !fetch.items.is_empty() || fetch.error.is_none() {
                g.state.news = fetch.items.clone();
            }
            g.state.news_feeds = fetch.feeds.clone();
            touch(&mut g);
            Json(json!({
                "ok": fetch.error.is_none(),
                "count": g.state.news.len(),
                "news": g.state.news.clone(),
                "newsFeeds": g.state.news_feeds.clone(),
                "error": fetch.error,
            }))
        }
        Err(e) => Json(json!({ "ok": false, "error": e })),
    }
}

// ─── Personal News ───────────────────────────────────────────────────────────

async fn get_personal_news(State(s): State<Shared>) -> Json<PersonalNewsState> {
    let g = s.lock().unwrap();
    Json(crate::personal_news::materialize_personal_news(
        &g.state.personal_news,
    ))
}

async fn personal_news_reload(State(s): State<Shared>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    let next = crate::personal_news::load_personal_news_state(
        &g.data_dir,
        Some(&g.state.personal_news),
        None,
    );
    g.state.personal_news = next.clone();
    touch(&mut g);
    Json(json!({ "ok": next.error.is_none(), "personalNews": next }))
}

async fn personal_news_select(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let Some(script_id) = body.get("scriptId").and_then(|v| v.as_str()) else {
        return Json(json!({ "ok": false, "error": "scriptId is required" }));
    };
    let mut g = s.lock().unwrap();
    let next = crate::personal_news::load_personal_news_state(
        &g.data_dir,
        Some(&g.state.personal_news),
        Some(script_id),
    );
    let ok = next.selected_script_id.as_deref() == Some(script_id);
    g.state.personal_news = next.clone();
    touch(&mut g);
    Json(json!({ "ok": ok, "personalNews": next }))
}

async fn personal_news_control(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let action = body
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("toggle");
    if !matches!(
        action,
        "play"
            | "pause"
            | "toggle"
            | "stop"
            | "restart"
            | "nextLine"
            | "previousLine"
            | "nextChapter"
            | "previousChapter"
            | "setLoop"
            | "jumpChapter"
    ) {
        return Json(json!({ "ok": false, "error": "unknown personal news action" }));
    }
    let loop_enabled = body.get("loopEnabled").and_then(|v| v.as_bool());
    let chapter_index = body
        .get("chapterIndex")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);
    let mut g = s.lock().unwrap();
    let next = crate::personal_news::control_personal_news(
        &g.state.personal_news,
        action,
        loop_enabled,
        chapter_index,
    );
    g.state.personal_news = next.clone();
    touch(&mut g);
    Json(json!({ "ok": true, "personalNews": next }))
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
        Ok(weather) => {
            let mut g = s.lock().unwrap();
            g.state.weather = WeatherState {
                source: "live".to_string(),
                current: Some(weather.current),
                hourly: weather.hourly,
                overview: weather.overview,
                updated_at: Some(now_iso()),
                error: weather.error,
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

#[derive(Debug, Deserialize)]
struct SpotifyCallback {
    code: Option<String>,
    error: Option<String>,
}

async fn spotify_now_playing(State(s): State<Shared>) -> Json<SpotifyState> {
    Json(s.lock().unwrap().state.spotify.clone())
}

async fn spotify_auth_url(State(s): State<Shared>) -> Json<Value> {
    let client_id = s.lock().unwrap().state.settings.spotify.client_id.clone();
    if client_id.trim().is_empty() {
        return Json(json!({ "ok": false, "error": "spotify client_id is empty" }));
    }
    let state = uuid::Uuid::new_v4().to_string();
    match services::spotify_authorize_url(&client_id, &state) {
        Ok(url) => Json(json!({
            "ok": true,
            "authUrl": url,
            "redirectUri": services::SPOTIFY_REDIRECT_URI,
            "scope": services::SPOTIFY_SCOPES,
        })),
        Err(e) => Json(json!({ "ok": false, "error": e })),
    }
}

async fn spotify_callback(
    State(s): State<Shared>,
    Query(query): Query<SpotifyCallback>,
) -> impl IntoResponse {
    if let Some(e) = query.error {
        return Html(format!(
            "<html><body><h1>Spotify authorization failed</h1><p>{}</p></body></html>",
            html_escape(&e)
        ));
    }
    let Some(code) = query.code else {
        return Html(
            "<html><body><h1>Spotify authorization failed</h1><p>No code.</p></body></html>"
                .to_string(),
        );
    };
    let (client_id, client_secret, http) = {
        let g = s.lock().unwrap();
        (
            g.state.settings.spotify.client_id.clone(),
            g.secrets.spotify_client_secret.clone(),
            g.http.clone(),
        )
    };
    if client_id.is_empty() || client_secret.is_empty() {
        return Html("<html><body><h1>Spotify is not configured</h1><p>Set Client ID and Client Secret in Companion first.</p></body></html>".to_string());
    }

    match services::spotify_exchange_code(&http, &client_id, &client_secret, &code).await {
        Ok((token, refresh, expires)) => {
            let mut g = s.lock().unwrap();
            if let Some(refresh) = refresh {
                g.secrets.spotify_refresh_token = refresh;
            }
            let exp = Instant::now() + std::time::Duration::from_secs(expires.saturating_sub(60));
            g.spotify_token = Some((token, exp));
            g.state.spotify.connected = true;
            g.state.spotify.status = "idle".to_string();
            g.state.spotify.error = None;
            touch(&mut g);
            Html("<html><body><h1>Spotify connected</h1><p>You can close this tab and return to Companion.</p></body></html>".to_string())
        }
        Err(e) => Html(format!(
            "<html><body><h1>Spotify authorization failed</h1><p>{}</p></body></html>",
            html_escape(&e)
        )),
    }
}

/// Ensures a valid access token (refreshing via refresh_token if needed),
/// then polls currently-playing and writes it into state.
async fn spotify_refresh(State(s): State<Shared>) -> Json<Value> {
    let (token, http) = match ensure_spotify_token(&s).await {
        Ok(x) => x,
        Err(e) if e == "unconfigured" => {
            let mut g = s.lock().unwrap();
            g.state.spotify = SpotifyState {
                connected: false,
                status: "unconfigured".to_string(),
                track: None,
                lyrics: SpotifyLyricsState::default(),
                error: None,
            };
            touch(&mut g);
            return Json(json!({ "ok": false, "status": "unconfigured" }));
        }
        Err(e) => return Json(json!({ "ok": false, "error": e })),
    };

    match write_spotify_state(&s, &http, &token).await {
        Ok(spotify) => Json(json!({ "ok": true, "spotify": spotify })),
        Err(e) => Json(json!({ "ok": false, "error": e })),
    }
}

async fn spotify_control(State(s): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let requested = body
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let (token, http) = match ensure_spotify_token(&s).await {
        Ok(x) => x,
        Err(e) => return Json(json!({ "ok": false, "error": e })),
    };
    let action = if requested == "toggle" {
        let playing = s.lock().unwrap().state.spotify.status == "playing";
        if playing { "pause" } else { "play" }.to_string()
    } else {
        requested
    };
    if !matches!(action.as_str(), "play" | "pause" | "next" | "previous") {
        return Json(json!({ "ok": false, "error": "unknown spotify action" }));
    }
    match services::spotify_playback_action(&http, &token, &action).await {
        Ok(()) => match write_spotify_state(&s, &http, &token).await {
            Ok(spotify) => Json(json!({ "ok": true, "spotify": spotify })),
            Err(e) => Json(json!({ "ok": true, "warning": e })),
        },
        Err(e) => {
            let mut g = s.lock().unwrap();
            g.state.spotify.status = "error".to_string();
            g.state.spotify.error = Some(e.clone());
            touch(&mut g);
            Json(json!({ "ok": false, "error": e }))
        }
    }
}

async fn ensure_spotify_token(s: &Shared) -> Result<(String, reqwest::Client), String> {
    let (client_id, client_secret, refresh_token, cached, http) = {
        let g = s.lock().unwrap();
        let cached = g
            .spotify_token
            .as_ref()
            .and_then(|(t, exp)| (*exp > Instant::now()).then(|| t.clone()));
        (
            g.state.settings.spotify.client_id.clone(),
            g.secrets.spotify_client_secret.clone(),
            g.secrets.spotify_refresh_token.clone(),
            cached,
            g.http.clone(),
        )
    };
    if client_id.is_empty() || client_secret.is_empty() || refresh_token.is_empty() {
        return Err("unconfigured".to_string());
    }
    if let Some(token) = cached {
        return Ok((token, http));
    }
    match services::spotify_refresh_token(&http, &client_id, &client_secret, &refresh_token).await {
        Ok((token, expires)) => {
            let mut g = s.lock().unwrap();
            let exp = Instant::now() + std::time::Duration::from_secs(expires.saturating_sub(60));
            g.spotify_token = Some((token.clone(), exp));
            Ok((token, http))
        }
        Err(e) => {
            let mut g = s.lock().unwrap();
            g.state.spotify.status = "error".to_string();
            g.state.spotify.error = Some(e.clone());
            touch(&mut g);
            Err(e)
        }
    }
}

async fn write_spotify_state(
    s: &Shared,
    http: &reqwest::Client,
    token: &str,
) -> Result<SpotifyState, String> {
    match services::spotify_now_playing(http, token).await {
        Ok(track) => {
            let previous_lyrics = {
                let mut g = s.lock().unwrap();
                let lyrics = match &track {
                    Some(t) if lyrics_match_track(&g.state.spotify.lyrics, t) => {
                        g.state.spotify.lyrics.clone()
                    }
                    _ => SpotifyLyricsState::default(),
                };
                g.state.spotify = SpotifyState {
                    connected: true,
                    status: spotify_status(&track),
                    track: track.clone(),
                    lyrics: lyrics.clone(),
                    error: None,
                };
                touch(&mut g);
                lyrics
            };

            if let Some(t) = &track {
                let lyrics = services::lyrics_for_track(http, Some(previous_lyrics), t).await;
                let mut g = s.lock().unwrap();
                if current_track_matches(g.state.spotify.track.as_ref(), t) {
                    g.state.spotify.lyrics = lyrics;
                    touch(&mut g);
                }
                Ok(g.state.spotify.clone())
            } else {
                Ok(s.lock().unwrap().state.spotify.clone())
            }
        }
        Err(e) => {
            let mut g = s.lock().unwrap();
            g.state.spotify.status = "error".to_string();
            g.state.spotify.error = Some(e.clone());
            touch(&mut g);
            Err(e)
        }
    }
}

fn spotify_status(track: &Option<SpotifyTrack>) -> String {
    match track {
        Some(t) if t.is_playing => "playing",
        Some(_) => "paused",
        None => "idle",
    }
    .to_string()
}

fn lyrics_match_track(lyrics: &SpotifyLyricsState, track: &SpotifyTrack) -> bool {
    lyrics.track_id == services::spotify_track_key(track) && lyrics.status != "idle"
}

fn current_track_matches(current: Option<&SpotifyTrack>, sampled: &SpotifyTrack) -> bool {
    current
        .and_then(services::spotify_track_key)
        .is_some_and(|key| Some(key) == services::spotify_track_key(sampled))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
