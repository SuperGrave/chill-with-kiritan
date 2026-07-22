use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

// ─── Top-level wallpaper state (public — served by /api/state, NEVER secrets) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperState {
    pub clock: ClockState,
    pub memos: Vec<MemoItem>,
    pub bookmarks: Vec<BookmarkItem>,
    pub spotify: SpotifyState,
    pub weather: WeatherState,
    pub news: Vec<NewsItem>,
    #[serde(default)]
    pub news_feeds: Vec<NewsFeedState>,
    #[serde(default)]
    pub personal_news: PersonalNewsState,
    pub notifications: Vec<NotificationItem>,
    #[serde(default)]
    pub timer: TimerState,
    /// Display settings (layout/settings/presets) owned by the companion.
    pub ui: UiState,
    /// Public (non-secret) configuration for weather/news/spotify.
    pub settings: AppSettings,
    /// Latest kiritanState the wallpaper POSTed (mode/presence/sleepiness).
    /// `None` until the wallpaper has reported at least once. Memory-only —
    /// not written to disk (see `state::Persist`), since it's a live runtime
    /// signal re-sent on every mode change / ~30s heartbeat.
    pub kiritan: Option<KiritanRuntimeState>,
    /// Latest BPM-analyzer snapshot the overlay POSTed (~1 Hz while audio
    /// frames are flowing). Memory-only, same rationale as `kiritan`. The
    /// Companion's スペクトラム settings tab polls this to show what every
    /// detection method is currently reading.
    #[serde(default)]
    pub audio_rhythm: Option<AudioRhythmRuntimeState>,
    pub updated_at: String,
}

impl Default for WallpaperState {
    fn default() -> Self {
        Self {
            clock: ClockState::default(),
            memos: vec![],
            bookmarks: vec![],
            spotify: SpotifyState::default(),
            weather: WeatherState::default(),
            news: vec![],
            news_feeds: vec![],
            personal_news: PersonalNewsState::default(),
            notifications: vec![],
            timer: TimerState::default(),
            ui: UiState::default(),
            settings: AppSettings::default(),
            kiritan: None,
            audio_rhythm: None,
            updated_at: now_iso(),
        }
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ─── Timer / Pomodoro ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub mode: String,   // "timer" | "pomodoro"
    pub phase: String,  // "focus" | "shortBreak" | "longBreak"
    pub status: String, // "idle" | "running" | "paused" | "finished"
    pub cycle: u32,
    pub duration_ms: u64,
    pub remaining_ms: u64,
    pub started_at: Option<String>,
    pub updated_at: String,
    pub command_seq: u64,
}

impl Default for TimerState {
    fn default() -> Self {
        let duration_ms = 25 * 60 * 1000;
        Self {
            mode: "pomodoro".to_string(),
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
        default_ui_state()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInUiPresetPack {
    default_preset_id: String,
    presets: Vec<UiPreset>,
}

fn default_ui_state() -> UiState {
    let pack =
        serde_json::from_str::<BuiltInUiPresetPack>(include_str!("built_in_ui_presets.json"));
    if let Ok(pack) = pack {
        if let Some(default_preset) = pack
            .presets
            .iter()
            .find(|preset| preset.id == pack.default_preset_id)
        {
            return UiState {
                layout: default_preset.layout.clone(),
                settings: default_preset.settings.clone(),
                presets: pack.presets,
                active_preset_id: Some(pack.default_preset_id),
            };
        }
    }
    legacy_default_ui_state()
}

fn legacy_default_ui_state() -> UiState {
    let id = "builtin-1920x1200-sample".to_string();
    let created_at = "2026-07-07T00:00:00Z".to_string();
    let layout = json!({
        "canvas": { "width": 1920, "height": 1200 },
        "clock": { "dateSize": 76, "timeSize": 129, "width": 642, "x": 0, "y": 0 },
        "weatherCompact": { "barHeight": 22, "fontSize": 24, "rowGap": 10, "width": 531, "x": 16, "y": 216 },
        "newsPanel": { "height": 600, "width": 520, "x": 1396, "y": 6 },
        "musicPanel": { "height": 305, "width": 520, "x": 1396, "y": 611 },
        "timerPanel": { "height": 225, "width": 500, "x": 8, "y": 921 },
        "memoPanel": { "height": 225, "width": 500, "x": 514, "y": 921 },
        "lyricsPanel": { "height": 225, "width": 896, "x": 1020, "y": 921 },
        "personalNewsPanel": { "height": 225, "width": 896, "x": 1020, "y": 921 },
        "audioSpectrumPanel": { "height": 200, "width": 500, "x": 8, "y": 696 },
        "detailPanel": { "height": 900, "width": 420, "x": 1320, "y": 70 },
        "rightDock": { "gap": 16, "width": 110, "x": 1789, "y": 100 },
        "safeArea": { "padding": 40 }
    });
    let settings = json!({
        "baseResolution": "1920x1200",
        "debugMode": false,
        "clock": {
            "showClock": true, "showDate": true, "showSeconds": true, "showWeather": true,
            "showHumidity": true, "showLocation": true, "showBackground": false,
            "backgroundOpacity": 0.28, "paddingX": 0, "paddingY": 0, "dateOffsetX": 10,
            "customLocation": "SAPPORO", "customWeatherTemp": "18°C",
            "customWeatherDesc": "CLOUDY", "customHumidity": "HUMID 62%"
        },
        "weatherCompact": {
            "showCompactWeather": true, "displayMode": "compact", "showLocation": true,
            "showWeather": true, "showTemperature": true, "showHumidity": true,
            "showPressure": true, "showMinMaxLabels": false, "showCurrentMarker": true,
            "showCurrentTriangle": true, "showBackground": false, "backgroundOpacity": 0.28,
            "infoRowPosition": "top", "temperaturePadding": 5, "pattern": "diagonal"
        },
        "weatherDetail": {
            "gap": 10, "fontSize": 1, "paddingTop": 16, "paddingBottom": 7, "paddingX": 11,
            "mainTempSize": 88, "minMaxTempSize": 35, "feelsLikeSize": 23,
            "metricLabelSize": 19, "metricValueSize": 19, "windSunSize": 34,
            "noteSize": 21, "maxNoteLines": 0, "footerSize": 20, "mainIconSize": 92,
            "compassSize": 91, "sunIconSize": 37, "showBackground": false,
            "backgroundOpacity": 0.4, "pattern": "dot"
        },
        "newsPanel": {
            "show": true, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.4,
            "contentTopGap": 12, "itemGap": 18, "indexSize": 26, "timeSize": 15,
            "titleSize": 17, "summarySize": 13, "footerSize": 15, "showIndex": true,
            "showTime": true, "showSource": true, "showSummary": true, "showDivider": true,
            "showFooter": false, "highlightLatest": true, "metaPlacement": "separate",
            "singleLineTitle": true, "maxItems": 4, "maxTitleLines": 2, "maxSummaryLines": 2
        },
        "musicPanel": {
            "show": true, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.4,
            "gap": 20, "showArtwork": true, "artworkMode": "topRight", "artworkScale": 1,
            "artworkCornerSize": 149, "artworkTopGap": 12, "artworkProgressGap": 13,
            "titleSize": 34, "artistSize": 16, "timeSize": 15, "barHeight": 19,
            "showMarker": true, "pattern": "diagonal", "showAlbum": true,
            "showTimeCodes": true, "showControls": false, "controlSize": 24, "showFooter": false
        },
        "lyricsPanel": {
            "show": true, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.34,
            "contentTopGap": 6, "showTrack": true, "showStatus": true, "align": "center",
            "lineOverflowMode": "ellipsis", "currentSize": 38, "sideSize": 18, "metaSize": 12,
            "lineGap": 3, "sideOpacity": 0.45, "currentMaxLines": 2, "sideMaxLines": 1
        },
        "personalNewsPanel": {
            "show": false, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.34,
            "contentTopGap": 18, "autoShowWhenLyricsUnavailable": true,
            "hideLyricsWhenAutoShown": true, "showStatus": false, "personalNewsShowTitle": false,
            "personalNewsShowTopic": true, "personalNewsShowBody": true, "personalNewsShowSource": true,
            "personalNewsShowProgress": false, "personalNewsShowChapterMarks": true,
            "personalNewsTitleSize": 15, "personalNewsTopicSize": 24, "personalNewsBodySize": 35,
            "personalNewsSourceSize": 12, "personalNewsProgressHeight": 10,
            "personalNewsGap": 12, "personalNewsScrollSpeed": 1,
            "personalNewsSupplementColor": "#b8dcff"
        },
        "audioSpectrumPanel": {
            "show": false, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.34,
            "contentTopGap": 12, "barCount": 24, "segmentCount": 14, "barGap": 4,
            "peakHold": true, "peakFallSpeed": 0.008, "sensitivity": 1, "decaySpeed": 0.12,
            "mirror": false, "colorMode": "mono", "showBpm": true,
            "bpmMethod": "pcm-beatroot", "bpmLockSeconds": 5, "bpmOffset": 0,
            "bpmConfidenceThreshold": 0.7, "bpmAnalysisWindowSeconds": 14,
            "bpmAnalysisIntervalSeconds": 3, "bpmChangeConfirmSeconds": 9,
            "bpmPeriodicResetMinutes": 0, "bpmResetOnSpotifyTrackChange": true,
            "rhythmMotionEnabled": true, "rhythmMotionStrength": 0.35,
            "rhythmMotionHoldSeconds": 8,
            "workHeadSyncEnabled": true, "workHeadSyncStrength": 0.35,
            "standbyText": "AUDIO STANDBY"
        },
        "memoPanel": {
            "show": true, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.4,
            "contentTopGap": 9, "textSize": 21, "dateSize": 12, "cardGap": 14,
            "cardPadding": 6, "showDates": false, "showPinnedSection": true,
            "showFooter": false, "maxLines": 0, "maxItems": 0
        },
        "timerPanel": {
            "show": true, "showHeader": true, "showBackground": true, "backgroundOpacity": 0.4,
            "contentTopGap": 18, "mode": "pomodoro", "timerTitle": "Countdown",
            "focusTitle": "Pomodoro", "shortBreakTitle": "Rest", "longBreakTitle": "Long Rest",
            "timerLabel": "TIMER", "focusLabel": "FOCUS", "shortBreakLabel": "BREAK",
            "longBreakLabel": "LONG BREAK", "timerMinutes": 10, "pomodoroMinutes": 25,
            "shortBreakMinutes": 5, "longBreakMinutes": 15, "titleSize": 15,
            "timeSize": 53, "metaSize": 13, "barHeight": 10, "itemGap": 6, "showControls": false,
            "showCycle": true, "timerPresets": []
        },
        "overlay": { "opacity": 1, "fpsLimit": 60 },
        "wallpaper": {
            "backgroundImageEnabled": true, "backgroundImageDataUrl": "/backgrounds/sample-kobe-night.jpg", "backgroundFit": "cover",
            "backgroundMode": "single", "backgroundTransition": "fade", "backgroundQueue": [],
            "backgroundOverlays": [], "backgroundQueueIntervalSeconds": 60, "backgroundQueueFadeSeconds": 1,
            "backgroundVideoMuted": true, "modelLightScale": 2.45, "modelVisible": true,
            "vrmModelPath": "", "propPhoneVisible": true, "propControllerVisible": true,
            "propCupVisible": true, "cameraAdjustmentEnabled": true, "cameraX": -0.25,
            "cameraY": 0, "cameraZ": -0.05, "cameraYaw": -2, "cameraPitch": -2,
            "cameraRoll": 0, "cameraMoveStep": 0.05, "cameraRotateStep": 1,
            "objectLayout": {
                "character": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
                "desk": { "position": [0, 0, 0.47], "rotation": [0, 3.14, 0], "scale": [0.927, 0.927, 0.927] },
                "chair": { "position": [-9.066, 0, 5.627], "rotation": [0, 0, 0], "scale": [0.027, 0.027, 0.027] },
                "laptop": { "position": [-0.03, 0.72, 0.24], "rotation": [0, 1.569, 0], "scale": [0.34, 0.34, 0.34] }
            },
            "itemLayout": {
                "item:cup": { "position": [0.28, 0.73, 0.2], "rotation": [0, 3.13, 0], "scale": [0.037, 0.037, 0.037] },
                "item:phone": { "position": [0.39, 0.73, 0.21], "rotation": [0, 0.6, 0], "scale": [0.66578, 0.66578, 0.66578] },
                "item:controller": { "position": [0.31, 0.74, 0.36], "rotation": [0, 2.35, 1.53], "scale": [0.017, 0.016, 0.017] },
                "item:book": { "position": [-0.5, 0.7511, 0.28], "rotation": [0, 0, 0], "scale": [0.23976, 0.23976, 0.23976] },
                "item:headphones": { "position": [-0.6214, 0.7363, 0.52], "rotation": [0, 0, 0], "scale": [0.17767, 0.17767, 0.17767] },
                "item:snack_plate": { "position": [0.1208, 0.7271, 0.1475], "rotation": [0, 0, 0], "scale": [0.48711, 0.48711, 0.48711] }
            }
        },
        "motion": {
            "directorMode": "fixed", "fixedMode": "work_normal", "modeMinMinutes": 15,
            "modeMaxMinutes": 30, "motionMinSeconds": 90, "motionMaxSeconds": 240,
            "disabledModes": [], "disabledMotions": []
        }
    });
    let preset = UiPreset {
        id: id.clone(),
        name: "1920x1200用サンプル".to_string(),
        layout: layout.clone(),
        settings: settings.clone(),
        created_at: created_at.clone(),
        updated_at: created_at,
    };
    UiState {
        layout,
        settings,
        presets: vec![preset],
        active_preset_id: Some(id),
    }
}

pub fn repair_ui_state(ui: &mut UiState) {
    let defaults = default_ui_state();

    let mut layout = defaults.layout.clone();
    merge_json(&mut layout, ui.layout.clone());
    ui.layout = layout;

    let mut settings = defaults.settings.clone();
    merge_json(&mut settings, ui.settings.clone());
    repair_wallpaper_settings(&mut settings, &defaults.settings);
    ui.settings = settings;

    for preset in &mut ui.presets {
        let mut preset_layout = defaults.layout.clone();
        merge_json(&mut preset_layout, preset.layout.clone());
        preset.layout = preset_layout;

        let mut preset_settings = defaults.settings.clone();
        merge_json(&mut preset_settings, preset.settings.clone());
        repair_wallpaper_settings(&mut preset_settings, &defaults.settings);
        preset.settings = preset_settings;
    }
}

fn merge_json(base: &mut Value, incoming: Value) {
    match (base, incoming) {
        (Value::Object(b), Value::Object(i)) => {
            for (k, v) in i {
                merge_json(b.entry(k).or_insert(Value::Null), v);
            }
        }
        (b, i) => *b = i,
    }
}

fn repair_wallpaper_settings(settings: &mut Value, default_settings: &Value) {
    let Some(default_wallpaper) = default_settings.get("wallpaper").cloned() else {
        return;
    };
    let Some(settings_obj) = settings.as_object_mut() else {
        *settings = default_settings.clone();
        return;
    };
    if !settings_obj
        .get("wallpaper")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        settings_obj.insert("wallpaper".to_string(), default_wallpaper);
        return;
    }

    let default_wallpaper = default_settings
        .get("wallpaper")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let Some(wallpaper) = settings_obj
        .get_mut("wallpaper")
        .and_then(Value::as_object_mut)
    else {
        return;
    };

    for key in [
        "cameraAdjustmentEnabled",
        "cameraX",
        "cameraY",
        "cameraZ",
        "cameraYaw",
        "cameraPitch",
        "cameraRoll",
        "cameraMoveStep",
        "cameraRotateStep",
    ] {
        repair_scalar(wallpaper, &default_wallpaper, key);
    }

    let camera_looks_reset = wallpaper
        .get("cameraAdjustmentEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && ["cameraX", "cameraZ", "cameraYaw", "cameraPitch"]
            .iter()
            .all(|k| wallpaper.get(*k).and_then(Value::as_f64) == Some(0.0));
    if camera_looks_reset {
        for key in [
            "cameraX",
            "cameraY",
            "cameraZ",
            "cameraYaw",
            "cameraPitch",
            "cameraRoll",
        ] {
            if let Some(default) = default_wallpaper.get(key) {
                wallpaper.insert(key.to_string(), default.clone());
            }
        }
    }

    repair_transform_map(wallpaper, &default_wallpaper, "objectLayout", true);
    repair_transform_map(wallpaper, &default_wallpaper, "itemLayout", false);
}

fn repair_scalar(obj: &mut Map<String, Value>, defaults: &Map<String, Value>, key: &str) {
    let valid = match obj.get(key) {
        Some(Value::Bool(_)) if key == "cameraAdjustmentEnabled" => true,
        Some(v) if key != "cameraAdjustmentEnabled" => v.as_f64().is_some(),
        _ => false,
    };
    if !valid {
        if let Some(default) = defaults.get(key) {
            obj.insert(key.to_string(), default.clone());
        }
    }
}

fn repair_transform_map(
    wallpaper: &mut Map<String, Value>,
    default_wallpaper: &Map<String, Value>,
    key: &str,
    reset_identity_map: bool,
) {
    let Some(default_map) = default_wallpaper.get(key).cloned() else {
        return;
    };
    if !wallpaper.get(key).map(|v| v.is_object()).unwrap_or(false) {
        wallpaper.insert(key.to_string(), default_map);
        return;
    }
    if reset_identity_map && transform_map_looks_identity_reset(wallpaper.get(key)) {
        wallpaper.insert(key.to_string(), default_map);
        return;
    }

    let Some(default_entries) = default_map.as_object() else {
        return;
    };
    let Some(map) = wallpaper.get_mut(key).and_then(Value::as_object_mut) else {
        return;
    };
    for (id, default_entry) in default_entries {
        match map.get_mut(id) {
            Some(entry) => repair_transform_entry(entry, default_entry),
            None => {
                map.insert(id.clone(), default_entry.clone());
            }
        }
    }
}

fn repair_transform_entry(entry: &mut Value, default_entry: &Value) {
    if !entry.is_object() {
        *entry = default_entry.clone();
        return;
    }
    let Some(default_obj) = default_entry.as_object() else {
        return;
    };
    let Some(entry_obj) = entry.as_object_mut() else {
        return;
    };
    for key in ["position", "rotation", "scale"] {
        if !vec3_valid(entry_obj.get(key)) {
            if let Some(default) = default_obj.get(key) {
                entry_obj.insert(key.to_string(), default.clone());
            }
        }
    }
}

fn vec3_valid(value: Option<&Value>) -> bool {
    let Some(arr) = value.and_then(Value::as_array) else {
        return false;
    };
    arr.len() == 3 && arr.iter().all(|v| v.as_f64().is_some())
}

fn transform_map_looks_identity_reset(value: Option<&Value>) -> bool {
    let Some(map) = value.and_then(Value::as_object) else {
        return false;
    };
    ["desk", "chair", "laptop"]
        .iter()
        .all(|id| transform_entry_is_identity(map.get(*id)))
}

fn transform_entry_is_identity(value: Option<&Value>) -> bool {
    let Some(obj) = value.and_then(Value::as_object) else {
        return false;
    };
    vec3_eq(obj.get("position"), [0.0, 0.0, 0.0])
        && vec3_eq(obj.get("rotation"), [0.0, 0.0, 0.0])
        && vec3_eq(obj.get("scale"), [1.0, 1.0, 1.0])
}

fn vec3_eq(value: Option<&Value>, expected: [f64; 3]) -> bool {
    let Some(arr) = value.and_then(Value::as_array) else {
        return false;
    };
    arr.len() == 3
        && arr
            .iter()
            .zip(expected)
            .all(|(v, expected)| v.as_f64() == Some(expected))
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
#[serde(default)]
pub struct AppSettings {
    pub weather: WeatherConfig,
    pub news: NewsConfig,
    pub spotify: SpotifyConfig,
    pub startup: StartupConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            weather: WeatherConfig::default(),
            news: NewsConfig::default(),
            spotify: SpotifyConfig::default(),
            startup: StartupConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct StartupConfig {
    pub launch_at_login: bool,
    pub launch_with_highest_privileges: bool,
}

impl Default for StartupConfig {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            launch_with_highest_privileges: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SpotifyConfig {
    pub client_id: String, // public part only; secret lives in Secrets
    /// Normal polling cadence. Clamped again by the worker so old or manually
    /// edited config can never hammer Spotify's API.
    pub poll_interval_ms: u64,
    /// When enabled, schedule one poll for roughly 0.8 seconds after the
    /// currently sampled track is expected to finish.
    pub refresh_on_track_end: bool,
}

impl Default for SpotifyConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            poll_interval_ms: 2_000,
            refresh_on_track_end: false,
        }
    }
}

// ─── Secrets (NEVER serialized into /api/state) ──────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Secrets {
    pub spotify_client_secret: String,
    pub spotify_refresh_token: String,
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
    pub lyrics: SpotifyLyricsState,
    pub error: Option<String>,
}

impl Default for SpotifyState {
    fn default() -> Self {
        Self {
            connected: false,
            status: "unconfigured".to_string(),
            track: None,
            lyrics: SpotifyLyricsState::default(),
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyLyricsState {
    pub track_id: Option<String>,
    pub source: Option<String>,
    pub status: String, // "idle" | "synced" | "plain" | "empty" | "error"
    pub synced: bool,
    pub lines: Vec<LyricLine>,
    pub error: Option<String>,
}

impl Default for SpotifyLyricsState {
    fn default() -> Self {
        Self {
            track_id: None,
            source: None,
            status: "idle".to_string(),
            synced: false,
            lines: vec![],
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub time: Option<f64>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyTrack {
    pub id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_art_url: Option<String>,
    pub duration_ms: Option<u64>,
    pub progress_ms: Option<u64>,
    pub sampled_at: Option<String>,
    pub is_playing: bool,
}

// ─── Weather ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherState {
    pub source: String, // "live" | "mock"
    pub current: Option<WeatherCurrent>,
    #[serde(default)]
    pub hourly: Vec<WeatherHourly>,
    #[serde(default)]
    pub overview: Option<WeatherOverview>,
    pub updated_at: Option<String>,
    pub error: Option<String>,
}

impl Default for WeatherState {
    fn default() -> Self {
        Self {
            source: "mock".to_string(),
            current: None,
            hourly: vec![],
            overview: None,
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
    pub temperature_min: Option<f64>,
    pub temperature_max: Option<f64>,
    pub humidity: f64,
    pub pressure: f64,
    pub weather_code: i32,
    pub precipitation_probability: Option<f64>,
    pub precipitation: Option<f64>,
    pub rain: Option<f64>,
    pub snowfall: Option<f64>,
    pub cloud_cover: Option<f64>,
    pub uv_index: Option<f64>,
    pub wind_speed: f64,
    pub wind_direction: f64,
    pub wind_gust: Option<f64>,
    pub is_day: bool,
    pub sunrise: Option<String>,
    pub sunset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherHourly {
    pub time: String,
    pub temperature: f64,
    pub humidity: Option<f64>,
    pub weather_code: Option<i32>,
    pub precipitation_probability: Option<f64>,
    pub wind_speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherOverview {
    pub publishing_office: String,
    pub report_datetime: String,
    pub target_area: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct WeatherFetch {
    pub current: WeatherCurrent,
    pub hourly: Vec<WeatherHourly>,
    pub overview: Option<WeatherOverview>,
    pub error: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsFeedState {
    pub feed_url: String,
    pub source: String,
    pub status: String, // "ok" | "empty" | "error"
    #[serde(default)]
    pub items: Vec<NewsItem>,
    pub error: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewsFetch {
    pub items: Vec<NewsItem>,
    pub feeds: Vec<NewsFeedState>,
    pub error: Option<String>,
}

// ─── Personal News script player ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsState {
    #[serde(default)]
    pub scripts: Vec<PersonalNewsScriptSummary>,
    pub current_script: Option<PersonalNewsScript>,
    pub selected_script_id: Option<String>,
    pub status: String, // "idle" | "playing" | "paused" | "finished" | "error"
    pub line_index: usize,
    pub line_started_at: Option<String>,
    pub line_elapsed_ms: u64,
    pub elapsed_ms: u64,
    pub duration_ms: u64,
    pub current_chapter_index: usize,
    pub loop_enabled: bool,
    #[serde(default)]
    pub auto_play_active: bool,
    pub script_dir: Option<String>,
    pub error: Option<String>,
    pub updated_at: String,
}

impl Default for PersonalNewsState {
    fn default() -> Self {
        Self {
            scripts: vec![],
            current_script: None,
            selected_script_id: None,
            status: "idle".to_string(),
            line_index: 0,
            line_started_at: None,
            line_elapsed_ms: 0,
            elapsed_ms: 0,
            duration_ms: 0,
            current_chapter_index: 0,
            loop_enabled: true,
            auto_play_active: false,
            script_dir: None,
            error: None,
            updated_at: now_iso(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsScriptSummary {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub description: Option<String>,
    pub chapter_count: usize,
    pub line_count: usize,
    pub source_count: usize,
    #[serde(default)]
    pub supplement_count: usize,
    pub estimated_duration_ms: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsScript {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub description: Option<String>,
    pub chapters: Vec<PersonalNewsChapter>,
    pub lines: Vec<PersonalNewsLine>,
    #[serde(default)]
    pub supplements: Vec<PersonalNewsSupplement>,
    #[serde(default)]
    pub sources: Vec<PersonalNewsSource>,
    pub estimated_duration_ms: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsChapter {
    pub id: String,
    pub title: String,
    pub line_index: usize,
    pub position_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsLine {
    pub id: String,
    pub kind: String, // "text" | "wait" (legacy may contain "source")
    pub topic: Option<String>,
    pub text: String,
    pub duration_ms: u64,
    pub source_id: Option<String>,
    pub position_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsSupplement {
    pub id: String,
    pub title: String,
    pub text: String,
    pub url: Option<String>,
    pub line_index: usize,
    pub chapter_index: usize,
    pub position_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalNewsSource {
    pub id: String,
    pub title: String,
    pub url: String,
    pub line_index: usize,
    pub chapter_index: usize,
    pub position_ms: u64,
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

// ─── Audio rhythm runtime state (スペクトラム設定タブ, 2026-07-19) ───────────
// The overlay's audioSpectrum service POSTs a live BPM-analyzer snapshot to
// `/api/audio-rhythm/state` about once a second while audio frames are
// flowing. The payload schema is owned by the sender
// (02_ui-overlay/src/services/audioSpectrum.ts — maybePostRhythmState), so it
// is stored as-is and only stamped with the server clock; the Companion UI
// treats a stale `receivedAt` as 停止中 / 旧バージョンの壁紙.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRhythmRuntimeState {
    /// Overlay-sent snapshot (selected method, per-detector estimates, …).
    #[serde(flatten)]
    pub payload: Map<String, Value>,
    pub received_at: String, // ISO, server clock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_ui_defaults_start_with_1080_and_offer_both_samples() {
        let ui = UiState::default();
        assert_eq!(
            ui.active_preset_id.as_deref(),
            Some("builtin-1920x1080-sample")
        );
        assert_eq!(ui.settings["baseResolution"], json!("1920x1080"));
        assert_eq!(ui.layout["canvas"]["width"], json!(1920));
        assert_eq!(ui.layout["canvas"]["height"], json!(1080));
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["bpmMethod"],
            json!("pcm-beatroot")
        );
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["bpmConfidenceThreshold"],
            json!(0.7)
        );
        // 2026-07-19: the samples ship master's live v0.8.9 tuning — panel on,
        // spectrum placed in the right column, quicker 3s lock.
        assert_eq!(ui.settings["audioSpectrumPanel"]["show"], json!(true));
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["bpmLockSeconds"],
            json!(3)
        );
        assert_eq!(ui.settings["audioSpectrumPanel"]["bpmOffset"], json!(0));
        assert_eq!(ui.layout["audioSpectrumPanel"]["x"], json!(1396));
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["rhythmMotionEnabled"],
            json!(true)
        );
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["rhythmMotionHoldSeconds"],
            json!(8)
        );
        assert_eq!(
            ui.settings["audioSpectrumPanel"]["workHeadSyncEnabled"],
            json!(true)
        );
        assert_eq!(ui.presets.len(), 2);
        assert!(ui.presets.iter().any(|preset| {
            preset.id == "builtin-1920x1200-sample"
                && preset.settings["baseResolution"] == json!("1920x1200")
        }));
        assert!(ui.presets.iter().any(|preset| {
            preset.id == "builtin-1920x1080-sample"
                && preset.settings["baseResolution"] == json!("1920x1080")
        }));
    }

    #[test]
    fn repair_ui_state_restores_wallpaper_camera_and_layout_defaults() {
        let mut ui = UiState::default();
        ui.settings["wallpaper"]["cameraX"] = json!(0);
        ui.settings["wallpaper"]["cameraZ"] = json!(0);
        ui.settings["wallpaper"]["cameraYaw"] = json!(0);
        ui.settings["wallpaper"]["cameraPitch"] = json!(0);
        ui.settings["wallpaper"]["objectLayout"] = json!({
            "character": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
            "desk": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
            "chair": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
            "laptop": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }
        });

        repair_ui_state(&mut ui);

        assert_eq!(ui.settings["wallpaper"]["cameraX"].as_f64(), Some(-0.25));
        assert_eq!(ui.settings["wallpaper"]["cameraYaw"].as_f64(), Some(-2.0));
        assert_eq!(
            ui.settings["wallpaper"]["objectLayout"]["desk"]["position"][2].as_f64(),
            Some(0.47)
        );
        assert_eq!(
            ui.settings["wallpaper"]["objectLayout"]["laptop"]["rotation"][1].as_f64(),
            Some(1.569)
        );
    }
}
