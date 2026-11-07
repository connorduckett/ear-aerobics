@echo off
title Ear Aerobics
echo Starting Ear Aerobics...
echo Your browser will open in a moment. Keep this window open while you practice.
echo Close this window when you are done.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 (
  echo.
  echo Could not start the local server. Opening the app directly instead...
  start "" "%~dp0index.html"
  pause
)
