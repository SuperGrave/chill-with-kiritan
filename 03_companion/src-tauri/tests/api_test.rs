// HTTP-level integration test for the companion API. Spins up the real axum
// router on an ephemeral port with a throwaway data dir (so it never touches
// the user's saved data) and exercises the CRUD + preset + UI endpoints that
// power the UI↔app integration. No network needed (live data endpoints excluded).

use std::sync::{Arc, Mutex};
use tohoku_companion_lib::{api::build_router, state::AppState};

async fn spawn_server() -> String {
    let mut dir = std::env::temp_dir();
    dir.push(format!("tohoku-companion-test-{}", uuid::Uuid::new_v4()));
    let app_state = AppState::load_from(dir);
    let shared = Arc::new(Mutex::new(app_state));
    let router = build_router(shared);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    format!("http://{}", addr)
}

#[tokio::test]
async fn crud_presets_and_ui_roundtrip() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();

    // health
    let h: serde_json::Value = c.get(format!("{base}/api/health")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(h["ok"], true);

    // todos: create → list → toggle → delete
    let created: serde_json::Value = c.post(format!("{base}/api/todos"))
        .json(&serde_json::json!({ "title": "テスト" })).send().await.unwrap()
        .json().await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "テスト");

    let todos: serde_json::Value = c.get(format!("{base}/api/todos")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(todos.as_array().unwrap().len(), 1);

    c.patch(format!("{base}/api/todos/{id}"))
        .json(&serde_json::json!({ "done": true })).send().await.unwrap();
    let todos: serde_json::Value = c.get(format!("{base}/api/todos")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(todos[0]["done"], true);

    c.delete(format!("{base}/api/todos/{id}")).send().await.unwrap();
    let todos: serde_json::Value = c.get(format!("{base}/api/todos")).send().await.unwrap()
        .json().await.unwrap();
    assert!(todos.as_array().unwrap().is_empty());

    // UI settings: PUT then GET reflects it
    c.put(format!("{base}/api/ui"))
        .json(&serde_json::json!({
            "layout": { "clock": { "x": 10 } },
            "settings": { "debugMode": true }
        })).send().await.unwrap();
    let ui: serde_json::Value = c.get(format!("{base}/api/ui")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(ui["layout"]["clock"]["x"], 10);
    assert_eq!(ui["settings"]["debugMode"], true);

    // Preset: save current → apply → ui matches preset
    let preset: serde_json::Value = c.post(format!("{base}/api/presets"))
        .json(&serde_json::json!({ "name": "夜モード" })).send().await.unwrap()
        .json().await.unwrap();
    let pid = preset["id"].as_str().unwrap().to_string();
    assert_eq!(preset["name"], "夜モード");

    // change ui away from preset
    c.put(format!("{base}/api/ui"))
        .json(&serde_json::json!({ "settings": { "debugMode": false } }))
        .send().await.unwrap();

    // rename preset
    c.put(format!("{base}/api/presets/{pid}"))
        .json(&serde_json::json!({ "name": "夜モードv2" })).send().await.unwrap();

    // apply preset → ui restored to snapshot (debugMode true) + active id set
    let applied: serde_json::Value = c.post(format!("{base}/api/presets/{pid}/apply"))
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(applied["ok"], true);
    assert_eq!(applied["ui"]["settings"]["debugMode"], true);
    assert_eq!(applied["ui"]["activePresetId"], pid);

    let presets: serde_json::Value = c.get(format!("{base}/api/presets")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(presets[0]["name"], "夜モードv2");

    // delete preset
    c.delete(format!("{base}/api/presets/{pid}")).send().await.unwrap();
    let presets: serde_json::Value = c.get(format!("{base}/api/presets")).send().await.unwrap()
        .json().await.unwrap();
    assert!(presets.as_array().unwrap().is_empty());

    // secrets never leak into /api/state, but status reports presence
    c.put(format!("{base}/api/secrets"))
        .json(&serde_json::json!({ "openaiKey": "sk-test" })).send().await.unwrap();
    let status: serde_json::Value = c.get(format!("{base}/api/secrets/status")).send().await.unwrap()
        .json().await.unwrap();
    assert_eq!(status["openai"], true);
    let state_text = c.get(format!("{base}/api/state")).send().await.unwrap()
        .text().await.unwrap();
    assert!(!state_text.contains("sk-test"), "secrets must not appear in /api/state");
}
