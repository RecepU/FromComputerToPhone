@echo off
setlocal
cd /d "%~dp0"
if not "%~1"=="" set "LAN_IP=%~1"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22.13 or newer, then reopen this script.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22 || v[0]===22 && v[1]>=13 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules\.bin\tsx.cmd goto install
if not exist node_modules\.bin\vite.cmd goto install
goto build
:install
echo Installing dependencies for first use...
call npm.cmd ci
if errorlevel 1 goto failed
:build
echo Building the local frontend...
call npm.cmd run build:local
if errorlevel 1 goto failed
call npm.cmd run start:local -- --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Review the error above.
echo For EBUSY errors, stop other dev servers and pause OneDrive sync before reinstalling dependencies.
pause
exit /b 1
