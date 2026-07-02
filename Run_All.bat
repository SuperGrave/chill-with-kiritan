@echo off
title Tohoku Wallpaper - Integrated Preview
echo Starting the integrated wallpaper preview.
echo.
echo This opens:
echo   01_wallpaper  = VRM + room + embedded 02_ui-overlay
echo   03_companion  = local API / settings / live data
echo.
echo Open the wallpaper URL shown by 01_wallpaper:
echo   http://localhost:5173/
echo.
echo Important:
echo   Run_UI.bat is only the standalone overlay preview.
echo   It is not the integrated wallpaper view.
echo.
start "03_companion (Tauri + API 40313)" cmd /k ""%~dp0Run_Companion.bat""
start "01_wallpaper Integrated Preview (5173)" cmd /k ""%~dp0Run_Wallpaper.bat""
