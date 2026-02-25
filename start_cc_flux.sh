#!/bin/bash

# CC-Flux Startup Script for Linux/macOS

echo "🔄 Starting CC-Flux..."

# Check if dependencies are installed
if [ ! -d "proxy/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd proxy
    npm install
    cd ..
fi

# Check for .env
if [ ! -f "proxy/.env" ]; then
    echo "⚙️  Creating config from .env.example..."
    cp proxy/.env.example proxy/.env
    echo "📝 Please edit proxy/.env with your API keys!"
fi

# Check for .env settings
if [ -f "proxy/.env" ]; then
    source proxy/.env
fi

# Default port
PORT=${PORT:-8080}

# Start the proxy in background
echo "🚀 Starting proxy on port $PORT..."
cd proxy
node src/server.js &
PROXY_PID=$!

cd ..

echo "✅ CC-Flux is running!"
echo ""
echo "📖 Usage:"
echo "   export ANTHROPIC_BASE_URL=http://localhost:$PORT/v1"
echo "   claude"
echo ""
echo "🎮 To start TUI: ./tui/cc-flux"
echo ""

# Offer to start TUI
read -p "Start TUI controller? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -f "tui/cc-flux" ]; then
        echo "🎮 Starting TUI..."
        cd tui && ./cc-flux
    else
        echo "⚠️  TUI not built. Run: cd tui && go build -o cc-flux ."
    fi
fi

# Cleanup on exit
trap "kill $PROXY_PID 2>/dev/null" EXIT
