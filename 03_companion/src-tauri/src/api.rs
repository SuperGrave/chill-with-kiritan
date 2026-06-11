use axum::{
    extract::State,
    http::{HeaderValue, Method, StatusCode},
    response::Json,
    routing::{delete, get, patch, post},
    Router,
};
use serde_json::{json, Value};
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::models::WallpaperState;

pub type SharedState = Arc<Mutex<WallpaperState>>;

pub const API_PORT: u16 = 40313;

/// Async HTTP server — runs forever on Tauri's tokio runtime.
pub async fn serve(shared_state: SharedState) {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let s = origin.to_str().unwrap_or("");
            // Allow wallpaper (localhost Vite dev / file://) and Companion React UI
            s.starts_with("http://localhost")
                || s.starts_with("http://127.0.0.1")
                || s == "null" // Wallpaper Engine WebView uses null origin for file://
        }))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        // ── Core ──────────────────────────────────────────────────────
        .route("/api/health", get(health))
        .route("/api/state", get(get_state))
        // ── TODO stubs (Phase B-3) ────────────────────────────────────
        .route("/api/todos", get(stub_ok).post(stub_ok))
        .route("/api/todos/{id}", patch(stub_ok).delete(stub_ok))
        // ── Memo stubs ────────────────────────────────────────────────
        .route("/api/memos", get(stub_ok).post(stub_ok))
        .route("/api/memos/{id}", patch(stub_ok).delete(stub_ok))
        // ── Bookmark stubs ────────────────────────────────────────────
        .route("/api/bookmarks", get(stub_ok).post(stub_ok))
        .route("/api/bookmarks/{id}", patch(stub_ok).delete(stub_ok))
        .route("/api/bookmarks/{id}/open", post(stub_ok))
        // ── Chat stubs (Phase B-4) ────────────────────────────────────
        .route("/api/chat/send", post(stub_ok))
        .route("/api/chat/history", get(stub_ok))
        .route("/api/chat/clear", post(stub_ok))
        // ── Weather / News / Spotify stubs (Phase B-5) ───────────────
        .route("/api/weather/current", get(stub_ok))
        .route("/api/weather/refresh", post(stub_ok))
        .route("/api/news", get(stub_ok))
        .route("/api/spotify/status", get(stub_ok))
        .route("/api/spotify/now-playing", get(stub_ok))
        .layer(cors)
        .with_state(shared_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], API_PORT));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => {
            println!("[companion] HTTP API ready → http://{}", addr);
            l
        }
        Err(e) => {
            eprintln!("[companion] Failed to bind {}:{} — {}", addr.ip(), addr.port(), e);
            return;
        }
    };

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[companion] API server error: {}", e);
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({
        "ok": true,
        "app": "Tohoku Companion",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn get_state(State(state): State<SharedState>) -> Result<Json<WallpaperState>, StatusCode> {
    let s = state
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(s.clone()))
}

async fn stub_ok() -> Json<Value> {
    Json(json!({ "ok": true, "note": "not yet implemented" }))
}
