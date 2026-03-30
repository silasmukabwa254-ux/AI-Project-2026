@echo off
setlocal
start "AI Project 2026 Server" "%~dp0server\run-server.cmd"
timeout /t 2 /nobreak >nul
start "" http://localhost:3001
endlocal
