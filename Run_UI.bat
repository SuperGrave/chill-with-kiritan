@echo off
title 02_ui-overlay Dev Server
echo Starting UI Overlay (02_ui-overlay)...
pushd "%~dp0\02_ui-overlay"
call npm run dev
popd
pause
