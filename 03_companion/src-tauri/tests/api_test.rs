// HTTP-level integration test for the companion API. Spins up the real axum
// router on an ephemeral port with a throwaway data dir (so it never touches
// the user's saved data) and exercises the CRUD + preset + UI endpoints that
// power the UI↔app integration. No network needed (live data endpoints excluded).

use std::sync::{Arc, Mutex};
use tohoku_companion_lib::{
    api::{api_addr, build_router, API_TOKEN_HEADER},
    state::AppState,
};

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

async fn fetch_token(base: &str, c: &reqwest::Client) -> String {
    let token: serde_json::Value = c
        .get(format!("{base}/api/auth/token"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    token["token"].as_str().unwrap().to_string()
}

fn auth(req: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    req.header(API_TOKEN_HEADER, token)
}

#[test]
fn live_api_address_is_loopback_only() {
    assert!(api_addr().ip().is_loopback());
    assert_eq!(api_addr().port(), 40313);
}

#[tokio::test]
async fn crud_presets_and_ui_roundtrip() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;

    // health
    let h: serde_json::Value = c
        .get(format!("{base}/api/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(h["ok"], true);

    // todos: create → list → toggle → delete
    let created: serde_json::Value = auth(c.post(format!("{base}/api/todos")), &token)
        .json(&serde_json::json!({ "title": "テスト" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "テスト");

    let todos: serde_json::Value = c
        .get(format!("{base}/api/todos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(todos.as_array().unwrap().len(), 1);

    auth(c.patch(format!("{base}/api/todos/{id}")), &token)
        .json(&serde_json::json!({ "done": true }))
        .send()
        .await
        .unwrap();
    let todos: serde_json::Value = c
        .get(format!("{base}/api/todos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(todos[0]["done"], true);

    auth(c.delete(format!("{base}/api/todos/{id}")), &token)
        .send()
        .await
        .unwrap();
    let todos: serde_json::Value = c
        .get(format!("{base}/api/todos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(todos.as_array().unwrap().is_empty());

    // UI settings: PUT then GET reflects it
    auth(c.put(format!("{base}/api/ui")), &token)
        .json(&serde_json::json!({
            "layout": { "clock": { "x": 10 } },
            "settings": { "debugMode": true }
        }))
        .send()
        .await
        .unwrap();
    let ui: serde_json::Value = c
        .get(format!("{base}/api/ui"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ui["layout"]["clock"]["x"], 10);
    assert_eq!(ui["settings"]["debugMode"], true);

    // Preset: save current → apply → ui matches preset
    let preset: serde_json::Value = auth(c.post(format!("{base}/api/presets")), &token)
        .json(&serde_json::json!({ "name": "夜モード" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pid = preset["id"].as_str().unwrap().to_string();
    assert_eq!(preset["name"], "夜モード");

    // change ui away from preset
    auth(c.put(format!("{base}/api/ui")), &token)
        .json(&serde_json::json!({ "settings": { "debugMode": false } }))
        .send()
        .await
        .unwrap();

    // rename preset
    auth(c.put(format!("{base}/api/presets/{pid}")), &token)
        .json(&serde_json::json!({ "name": "夜モードv2" }))
        .send()
        .await
        .unwrap();

    // apply preset → ui restored to snapshot (debugMode true) + active id set
    let applied: serde_json::Value =
        auth(c.post(format!("{base}/api/presets/{pid}/apply")), &token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(applied["ok"], true);
    assert_eq!(applied["ui"]["settings"]["debugMode"], true);
    assert_eq!(applied["ui"]["activePresetId"], pid);

    let presets: serde_json::Value = c
        .get(format!("{base}/api/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(presets[0]["name"], "夜モードv2");

    // delete preset
    auth(c.delete(format!("{base}/api/presets/{pid}")), &token)
        .send()
        .await
        .unwrap();
    let presets: serde_json::Value = c
        .get(format!("{base}/api/presets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(presets.as_array().unwrap().is_empty());

    // secrets never leak into /api/state, but status reports presence
    auth(c.put(format!("{base}/api/secrets")), &token)
        .json(&serde_json::json!({ "openaiKey": "sk-test" }))
        .send()
        .await
        .unwrap();
    let status: serde_json::Value = c
        .get(format!("{base}/api/secrets/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["openai"], true);
    let state_text = c
        .get(format!("{base}/api/state"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        !state_text.contains("sk-test"),
        "secrets must not appear in /api/state"
    );
}

#[tokio::test]
async fn kiritan_state_post_and_get() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;

    // Absent until the wallpaper reports at least once.
    let empty: serde_json::Value = c
        .get(format!("{base}/api/kiritan/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        empty.is_null(),
        "kiritan state starts absent (null), got {empty}"
    );

    // A valid post (matches kiritanPoster.ts's wire object exactly).
    let body = serde_json::json!({
        "mode": "work_normal",
        "modeLabel": "作業中",
        "since": "2026-07-01T12:00:00.000Z",
        "prevMode": null,
        "presence": "present",
        "ambient": null,
        "interruptPolicy": "soft",
        "chatDelayMsRange": [500, 1500],
        "sleepiness": 0.2,
        "away": null,
    });
    let posted: serde_json::Value = auth(c.post(format!("{base}/api/kiritan/state")), &token)
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(posted["ok"], true);

    let got: serde_json::Value = c
        .get(format!("{base}/api/kiritan/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(got["mode"], "work_normal");
    assert_eq!(got["presence"], "present");
    assert_eq!(got["sleepiness"], 0.2);
    assert!(
        got["receivedAt"].as_str().is_some(),
        "server stamps receivedAt"
    );

    // A later post with a nested object + away payload round-trips too.
    let away_body = serde_json::json!({
        "mode": "away_room",
        "modeLabel": "離席中",
        "since": "2026-07-01T12:05:00.000Z",
        "prevMode": "work_normal",
        "presence": "away",
        "ambient": { "id": "amb_work_sip", "endsAt": "2026-07-01T12:06:00.000Z" },
        "interruptPolicy": "none",
        "chatDelayMsRange": null,
        "sleepiness": 0.4,
        "away": { "reason": "snack", "expectedReturnAt": "2026-07-01T12:10:00.000Z" },
    });
    auth(c.post(format!("{base}/api/kiritan/state")), &token)
        .json(&away_body)
        .send()
        .await
        .unwrap();
    let got2: serde_json::Value = c
        .get(format!("{base}/api/kiritan/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(got2["mode"], "away_room");
    assert_eq!(got2["ambient"]["id"], "amb_work_sip");
    assert_eq!(got2["away"]["reason"], "snack");

    // Semantic validation rejects an out-of-range sleepiness even though it's
    // structurally valid JSON.
    let mut bad = body.clone();
    bad["sleepiness"] = serde_json::json!(1.5);
    let rejected: serde_json::Value = auth(c.post(format!("{base}/api/kiritan/state")), &token)
        .json(&bad)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rejected["ok"], false);

    // Structurally malformed body (missing required fields) is rejected by the
    // Json<KiritanStatePost> extractor itself — axum returns 422 (valid JSON,
    // wrong shape) before the handler ever runs.
    let resp = auth(c.post(format!("{base}/api/kiritan/state")), &token)
        .json(&serde_json::json!({ "mode": "work_normal" }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        422,
        "missing required fields → 422, not silently accepted"
    );

    // kiritan must never be persisted to disk (it's excluded from state::Persist).
    let state_text = c
        .get(format!("{base}/api/state"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        state_text.contains("away_room"),
        "kiritan IS served live in /api/state"
    );
}

#[tokio::test]
async fn mutating_routes_require_companion_token() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();

    let state = c.get(format!("{base}/api/state")).send().await.unwrap();
    assert_eq!(state.status(), 200, "GET remains open for overlay polling");

    let unauthorized = c
        .post(format!("{base}/api/todos"))
        .json(&serde_json::json!({ "title": "no token" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), 401, "mutating request without token");

    let wrong = c
        .post(format!("{base}/api/todos"))
        .header(API_TOKEN_HEADER, "wrong-token")
        .json(&serde_json::json!({ "title": "wrong token" }))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 401, "mutating request with wrong token");

    let token = fetch_token(&base, &c).await;
    let created = auth(c.post(format!("{base}/api/todos")), &token)
        .json(&serde_json::json!({ "title": "authorized" }))
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), 200, "correct token allows mutation");
}
