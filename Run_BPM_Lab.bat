@echo off
title Kiritan BPM Comparison Lab
pushd "%~dp0\04_bpm-lab"
if not exist node_modules (
  echo Installing BPM Lab dependencies for the first run...
  call npm install
  if errorlevel 1 goto :error
)
echo Starting BPM Comparison Lab at http://127.0.0.1:5190 ...
call npm run dev
goto :end
:error
echo.
echo Failed to install or start BPM Lab.
pause
:end
popd
