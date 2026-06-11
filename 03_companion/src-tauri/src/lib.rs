mod api;
mod models;

use api::SharedState;
use models::WallpaperState;
use std::sync::{Arc, Mutex};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Shared wallpaper state — owned by Tauri state manager, also cloned for the HTTP server
    let shared_state: SharedState = Arc::new(Mutex::new(WallpaperState::default()));
    let state_for_api = Arc::clone(&shared_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(shared_state)
        .setup(move |app| {
            // ── HTTP API server ──────────────────────────────────────────
            // Runs on Tauri's built-in tokio runtime (multi-thread)
            tauri::async_runtime::spawn(api::serve(state_for_api));

            // ── System tray ──────────────────────────────────────────────
            let _tray = TrayIconBuilder::new()
                .tooltip("Tohoku Companion")
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Close button hides to tray instead of quitting
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![get_state_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Tauri command — React frontend can call this directly (alternative to HTTP polling)
#[tauri::command]
fn get_state_cmd(state: tauri::State<SharedState>) -> Result<WallpaperState, String> {
    state
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}
