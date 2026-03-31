@echo off
setlocal
start "Elyra Server" "%~dp0server\run-server.cmd"
timeout /t 2 /nobreak >nul
start "" http://localhost:3001
endlocal
