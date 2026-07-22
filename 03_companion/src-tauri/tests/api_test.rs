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

    // memos: create -> list -> pin -> delete
    let created: serde_json::Value = auth(c.post(format!("{base}/api/memos")), &token)
        .json(&serde_json::json!({ "text": "テスト" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["text"], "テスト");

    let memos: serde_json::Value = c
        .get(format!("{base}/api/memos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(memos.as_array().unwrap().len(), 1);

    auth(c.patch(format!("{base}/api/memos/{id}")), &token)
        .json(&serde_json::json!({ "pinned": true }))
        .send()
        .await
        .unwrap();
    let memos: serde_json::Value = c
        .get(format!("{base}/api/memos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(memos[0]["pinned"], true);

    auth(c.delete(format!("{base}/api/memos/{id}")), &token)
        .send()
        .await
        .unwrap();
    let memos: serde_json::Value = c
        .get(format!("{base}/api/memos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(memos.as_array().unwrap().is_empty());

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
    assert!(presets
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == pid && p["name"] == "夜モードv2"));

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
    assert!(!presets.as_array().unwrap().iter().any(|p| p["id"] == pid));

    // secrets never leak into /api/state, but status reports presence
    auth(c.put(format!("{base}/api/secrets")), &token)
        .json(&serde_json::json!({ "spotifyClientSecret": "spotify-secret-test" }))
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
    assert_eq!(status["spotifyClientSecret"], true);
    let state_text = c
        .get(format!("{base}/api/state"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        !state_text.contains("spotify-secret-test"),
        "secrets must not appear in /api/state"
    );
}

#[tokio::test]
async fn backup_export_import_roundtrip_is_atomic_and_secret_opt_in() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;

    auth(c.put(format!("{base}/api/ui")), &token)
        .json(&serde_json::json!({ "settings": { "debugMode": true } }))
        .send()
        .await
        .unwrap();
    let memo: serde_json::Value = auth(c.post(format!("{base}/api/memos")), &token)
        .json(&serde_json::json!({ "text": "backup-roundtrip" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let memo_id = memo["id"].as_str().unwrap().to_string();
    auth(c.post(format!("{base}/api/presets")), &token)
        .json(&serde_json::json!({ "name": "バックアップ確認用" }))
        .send()
        .await
        .unwrap();
    auth(c.put(format!("{base}/api/secrets")), &token)
        .json(&serde_json::json!({ "spotifyClientSecret": "secret-before-backup" }))
        .send()
        .await
        .unwrap();

    let exported: serde_json::Value = auth(c.post(format!("{base}/api/backup/export")), &token)
        .json(&serde_json::json!({ "includeSecrets": false }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(exported["ok"], true);
    let backup_path = exported["path"].as_str().unwrap();
    let backup: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(backup_path).expect("read exported backup"))
            .unwrap();
    assert_eq!(backup["kind"], "companion-backup");
    assert_eq!(backup["includeSecrets"], false);
    assert!(backup.get("secrets").is_none());
    assert_eq!(backup["data"]["ui"]["settings"]["debugMode"], true);
    assert!(backup["data"]["ui"]["presets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|preset| preset["name"] == "バックアップ確認用"));
    assert!(backup["data"]["memos"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["text"] == "backup-roundtrip"));

    // A malformed known field rejects the whole bundle before any valid field
    // beside it can be applied.
    let invalid: serde_json::Value = auth(c.post(format!("{base}/api/backup/import")), &token)
        .json(&serde_json::json!({
            "kind": "companion-backup",
            "data": { "ui": "broken", "memos": [] }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(invalid["ok"], false);
    let memos_after_invalid: serde_json::Value = c
        .get(format!("{base}/api/memos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(memos_after_invalid
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == memo_id));

    auth(c.put(format!("{base}/api/ui")), &token)
        .json(&serde_json::json!({ "settings": { "debugMode": false } }))
        .send()
        .await
        .unwrap();
    auth(c.delete(format!("{base}/api/memos/{memo_id}")), &token)
        .send()
        .await
        .unwrap();
    let imported: serde_json::Value = auth(c.post(format!("{base}/api/backup/import")), &token)
        .json(&backup)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(imported["ok"], true);
    assert!(imported["applied"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field == "ui"));
    let restored_ui: serde_json::Value = c
        .get(format!("{base}/api/ui"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(restored_ui["settings"]["debugMode"], true);
    let restored_memos: serde_json::Value = c
        .get(format!("{base}/api/memos"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(restored_memos
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["text"] == "backup-roundtrip"));

    // Secrets are present only in an explicit opt-in export and are restored
    // when that bundle is imported.
    let secret_export: serde_json::Value =
        auth(c.post(format!("{base}/api/backup/export")), &token)
            .json(&serde_json::json!({ "includeSecrets": true }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    let secret_backup: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(secret_export["path"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        secret_backup["secrets"]["spotifyClientSecret"],
        "secret-before-backup"
    );
    auth(c.put(format!("{base}/api/secrets")), &token)
        .json(&serde_json::json!({ "spotifyClientSecret": "secret-after-backup" }))
        .send()
        .await
        .unwrap();
    let secret_import: serde_json::Value =
        auth(c.post(format!("{base}/api/backup/import")), &token)
            .json(&secret_backup)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(secret_import["ok"], true);
    let re_export: serde_json::Value = auth(c.post(format!("{base}/api/backup/export")), &token)
        .json(&serde_json::json!({ "includeSecrets": true }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let re_exported: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(re_export["path"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        re_exported["secrets"]["spotifyClientSecret"],
        "secret-before-backup"
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
async fn audio_rhythm_state_post_and_get() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;

    // Absent until the overlay reports at least once.
    let empty: serde_json::Value = c
        .get(format!("{base}/api/audio-rhythm/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(empty.is_null(), "audio rhythm starts absent, got {empty}");

    // The overlay's snapshot (schema owned by audioSpectrum.ts) round-trips
    // as-is; a client-echoed receivedAt is replaced by the server stamp.
    let body = serde_json::json!({
        "source": "companion-pcm",
        "method": "pcm-beatroot",
        "stableMs": 5000,
        "bpmOffset": 0,
        "status": "locked",
        "lockedBpm": 128,
        "outputBpm": 128,
        "receivedAt": "1999-01-01T00:00:00.000Z",
        "estimates": [
            { "id": "pcm-beatroot", "status": "locked", "lockedBpm": 128, "detectedBpm": 128.4, "confidence": 0.9, "support": 1 }
        ],
    });
    let posted: serde_json::Value = auth(c.post(format!("{base}/api/audio-rhythm/state")), &token)
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(posted["ok"], true);

    let got: serde_json::Value = c
        .get(format!("{base}/api/audio-rhythm/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(got["method"], "pcm-beatroot");
    assert_eq!(got["estimates"][0]["id"], "pcm-beatroot");
    let received_at = got["receivedAt"].as_str().unwrap_or_default();
    assert!(
        !received_at.is_empty() && !received_at.starts_with("1999"),
        "server clock owns receivedAt, got {received_at}"
    );

    // A non-object body is rejected without touching the stored snapshot.
    let rejected: serde_json::Value =
        auth(c.post(format!("{base}/api/audio-rhythm/state")), &token)
            .json(&serde_json::json!([1, 2, 3]))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(rejected["ok"], false);
    let still: serde_json::Value = c
        .get(format!("{base}/api/audio-rhythm/state"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(still["method"], "pcm-beatroot");

    let before_reset: serde_json::Value = c
        .get(format!("{base}/api/audio-pcm/chunk?after=0"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let reset: serde_json::Value = auth(c.post(format!("{base}/api/audio-rhythm/reset")), &token)
        .json(&serde_json::json!({ "reason": "test-manual" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(reset["ok"], true);
    let after_reset: serde_json::Value = c
        .get(format!("{base}/api/audio-pcm/chunk?after=0"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        after_reset["resetGeneration"].as_u64(),
        before_reset["resetGeneration"]
            .as_u64()
            .map(|value| value + 1)
    );
    assert_eq!(after_reset["resetReason"], "test-manual");
}

#[tokio::test]
async fn background_upload_stores_file_and_serves_lightweight_url() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;
    let payload = b"fake transparent overlay bytes".to_vec();

    let uploaded: serde_json::Value = auth(
        c.post(format!(
            "{base}/api/backgrounds/upload?fileName=light.png&mediaType=overlay"
        )),
        &token,
    )
    .header("content-type", "image/png")
    .body(payload.clone())
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();

    assert_eq!(uploaded["ok"], true);
    assert_eq!(uploaded["item"]["type"], "image");
    assert_eq!(uploaded["item"]["kind"], "overlay");
    assert_eq!(uploaded["item"]["name"], "light.png");
    assert_eq!(uploaded["item"]["size"], payload.len());
    let url = uploaded["item"]["url"].as_str().unwrap();
    assert!(
        url.starts_with(&format!("{base}/api/backgrounds/")),
        "served URL should use the active API host, got {url}"
    );

    let served = c.get(url).send().await.unwrap().bytes().await.unwrap();
    assert_eq!(served.as_ref(), payload.as_slice());
}

#[tokio::test]
async fn vrm_upload_stores_selected_model_and_serves_it_to_the_wallpaper() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();
    let token = fetch_token(&base, &c).await;
    let payload = b"fake vrm bytes for transport test".to_vec();

    let uploaded: serde_json::Value = auth(
        c.post(format!(
            "{base}/api/models/upload?fileName=custom-model.vrm"
        )),
        &token,
    )
    .header("content-type", "application/octet-stream")
    .body(payload.clone())
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();

    assert_eq!(uploaded["ok"], true);
    assert_eq!(uploaded["item"]["name"], "custom-model.vrm");
    assert_eq!(uploaded["item"]["size"], payload.len());
    let url = uploaded["item"]["url"].as_str().unwrap();
    assert!(url.starts_with(&format!("{base}/api/models/")));
    let served = c.get(url).send().await.unwrap().bytes().await.unwrap();
    assert_eq!(served.as_ref(), payload.as_slice());

    let rejected: serde_json::Value = auth(
        c.post(format!("{base}/api/models/upload?fileName=not-a-model.txt")),
        &token,
    )
    .body("not a vrm")
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(rejected["ok"], false);
}

#[tokio::test]
async fn mutating_routes_require_companion_token() {
    let base = spawn_server().await;
    let c = reqwest::Client::new();

    let state = c.get(format!("{base}/api/state")).send().await.unwrap();
    assert_eq!(state.status(), 200, "GET remains open for overlay polling");

    let unauthorized = c
        .post(format!("{base}/api/memos"))
        .json(&serde_json::json!({ "text": "no token" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), 401, "mutating request without token");

    let wrong = c
        .post(format!("{base}/api/memos"))
        .header(API_TOKEN_HEADER, "wrong-token")
        .json(&serde_json::json!({ "text": "wrong token" }))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 401, "mutating request with wrong token");

    let token = fetch_token(&base, &c).await;
    let created = auth(c.post(format!("{base}/api/memos")), &token)
        .json(&serde_json::json!({ "text": "authorized" }))
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), 200, "correct token allows mutation");
}
