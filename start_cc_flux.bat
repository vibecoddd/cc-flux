@echo off
REM CC-Flux Startup Script for Windows

echo 🔄 Starting CC-Flux...

REM Check if dependencies are installed
if not exist "proxy\node_modules" (
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
if "%PORT%"=="" set PORT=8080
if "%HOST%"=="" set HOST=127.0.0.1
echo 🚀 Starting proxy on %HOST%:%PORT%...
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
echo    Set ANTHROPIC_BASE_URL=http://%HOST%:%PORT%
echo    Then run: claude
echo.
pause
