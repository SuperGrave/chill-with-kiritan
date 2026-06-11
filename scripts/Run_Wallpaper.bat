@echo off
title 01_wallpaper Dev Server
echo Starting Wallpaper renderer (01_wallpaper)...
pushd "%~dp0..\01_wallpaper"
npm run dev
popd
pause
