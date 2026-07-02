@echo off
title 01_wallpaper Integrated Preview
echo Starting integrated wallpaper preview (01_wallpaper)...
echo.
echo Open this URL with no query string:
echo   http://localhost:5173/
echo.
echo This view contains:
echo   - VRM / room / motion director
echo   - embedded 02_ui-overlay
echo.
echo Use Run_Companion.bat too if COMPANION should show LIVE.
echo Use Run_UI.bat only for the standalone overlay preview.
echo.
pushd "%~dp0\01_wallpaper"
call npm run dev
popd
pause
