@echo off
echo Starting Wallpaper (01) + UI Overlay (02) + Companion (03) in separate windows...
start "01_wallpaper Dev Server" cmd /k "cd /d %~dp0..\01_wallpaper && npm run dev"
start "02_ui-overlay Dev Server" cmd /k "cd /d %~dp0..\02_ui-overlay && npm run dev"
start "03_companion (Tauri)" cmd /k "cd /d %~dp0..\03_companion && npm run tauri dev"
