@echo off
title OmniStudio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=3210
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node server.js
pause
