#![recursion_limit = "256"]

pub mod api;
pub mod models;
pub mod personal_news;
pub mod services;
pub mod startup;
pub mod state;
mod tasks;

use models::WallpaperState;
use state::{AppState, Shared};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Bring the main window to front (used by the single-instance relaunch
/// handler, the tray's "表示" menu item, and its left-click toggle-on branch).
fn show_and_focus(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if startup::handle_cli_args() {
        return;
    }

    // Load persisted data; the shared state is owned by Tauri and cloned for
    // the HTTP server + background pollers.
    let shared: Shared = Arc::new(Mutex::new(AppState::load()));
    let state_for_api = Arc::clone(&shared);
    let state_for_tasks = Arc::clone(&shared);

    tauri::Builder::default()
        // Must be registered first: it needs to intercept a second launch
        // before anything else initializes. A relaunch just focuses the
        // existing window instead of spawning a second API server on the
        // same port (see docs/COMPLETION_EXECUTION_PLAN_2026-07-01.md §4.1).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_and_focus(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(shared)
        .setup(move |app| {
            let startup_config = {
                let g = state_for_tasks.lock().unwrap();
                g.state.settings.startup.clone()
            };
            if let Err(e) = startup::reconcile(&startup_config) {
                eprintln!("[companion] startup registration reconcile failed: {e}");
            }

            // HTTP API server on Tauri's tokio runtime. A bind failure (stale
            // process still holding the port, another app on 40313, ...) is
            // surfaced as a dialog instead of leaving the wallpaper/overlay
            // silently stuck on "offline" with no visible cause.
            let dialog_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = api::serve(state_for_api).await {
                    eprintln!("[companion] {e}");
                    dialog_handle
                        .dialog()
                        .message(format!(
                            "ローカルAPI（ポート{}）の起動に失敗しました。\n\
                             他のTohoku Companionが起動中か、ポートが他のアプリに使われている可能性があります。\n\n詳細: {e}",
                            api::API_PORT
                        ))
                        .title("Tohoku Companion — 起動エラー")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::Ok)
                        .show(|_| {});
                }
            });
            // Background pollers (weather / news / spotify).
            tasks::spawn_all(state_for_tasks);

            // System tray: left-click toggles the window (unchanged); the
            // attached menu (right-click, or the OS default for a tray with a
            // menu) adds "表示" and "完全終了" — the only way to fully quit
            // besides the task manager, previously missing entirely.
            let show_item = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "完全終了", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("Tohoku Companion")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_and_focus(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
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
                                show_and_focus(app);
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Close button hides to tray instead of quitting.
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

/// Tauri command — React frontend can call this directly (alternative to HTTP).
#[tauri::command]
fn get_state_cmd(state: tauri::State<Shared>) -> Result<WallpaperState, String> {
    state
        .lock()
        .map(|s| s.state.clone())
        .map_err(|e| e.to_string())
}
