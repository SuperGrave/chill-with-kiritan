@echo off
title Tohoku Wallpaper - All Dev Surfaces
echo Starting all development surfaces in separate windows.
echo.
echo This is for component-level development:
echo   01_wallpaper   integrated wallpaper preview
echo   02_ui-overlay  standalone overlay preview only
echo   03_companion   Tauri companion + local API
echo.
echo For normal/latest integrated preview, use Run_All.bat.
echo.
start "01_wallpaper Integrated Preview (5173)" cmd /k ""%~dp0Run_Wallpaper.bat""
start "02_ui-overlay Standalone Preview (5174)" cmd /k ""%~dp0Run_UI.bat""
start "03_companion (Tauri + API 40313)" cmd /k ""%~dp0Run_Companion.bat""
