@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0tools\node;%PATH%"

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

node server/index.js

echo.
echo Server stopped.
pause
