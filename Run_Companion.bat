@echo off
title 03_companion (Tauri) Dev
echo Starting Companion app (03_companion)...
echo (Tauri: the FIRST run compiles Rust and can take a few minutes)
echo.
echo This provides:
echo   - Tauri settings window
echo   - local API: http://127.0.0.1:40313
echo   - LIVE data for the integrated wallpaper overlay
echo.
pushd "%~dp0\03_companion"
call npm run tauri dev
popd
pause
