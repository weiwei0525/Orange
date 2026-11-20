@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo Starting local server: http://localhost:8080/
echo Close this window to stop.
start "" "http://localhost:8080/"
node tools\serve.js 8080
pause
goto :eof
:nonode
echo Node.js not found. Please install it from https://nodejs.org/
pause
