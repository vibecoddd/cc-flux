@echo off
REM CC-Flux Startup Script for Windows

echo 🔄 Starting CC-Flux...

REM Check if dependencies are installed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    cd proxy
    call npm install
    cd ..
)

REM Check for .env
if not exist "proxy\.env" (
    echo ⚙️  Creating config from .env.example...
    copy proxy\.env.example proxy\.env
)

REM Start the proxy
echo 🚀 Starting proxy on port 8080...
start "CC-Flux Proxy" cmd /k "cd proxy && npm start"

REM Ask to start TUI
echo.
set /p start_tui="Start TUI controller? (y/n): "
if /i "%start_tui%"=="y" (
    echo 🎮 Starting TUI...
    if exist "tui\cc-flux.exe" (
        start "CC-Flux TUI" cmd /k "tui\cc-flux.exe"
    ) else (
        echo ⚠️  TUI not built. Run: cd tui ^&^& go build -o cc-flux .
    )
)

echo ✅ CC-Flux is running!
echo.
echo 📖 Usage:
echo    Set ANTHROPIC_BASE_URL=http://localhost:8080/v1
echo    Then run: claude
echo.
pause
