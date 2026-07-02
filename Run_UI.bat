@echo off
title 02_ui-overlay Standalone Preview
echo Starting standalone UI overlay preview (02_ui-overlay)...
echo.
echo This does NOT show the VRM model or the integrated wallpaper.
echo For the latest integrated wallpaper view, use Run_All.bat or Run_Wallpaper.bat.
echo.
pushd "%~dp0\02_ui-overlay"
call npm run dev
popd
pause
