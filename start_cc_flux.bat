@echo off
echo Starting CC-Flux Proxy...
start "CC-Flux Proxy" cmd /c "cd proxy && npm start"

timeout /t 3 /nobreak >nul

echo Starting TUI Controller...
cd tui
cc-flux.exe
