@echo off
title 03_companion (Tauri) Dev
echo Starting Companion app (03_companion)...
echo (Tauri: the FIRST run compiles Rust and can take a few minutes)
pushd "%~dp0\03_companion"
call npm run tauri dev
popd
pause
