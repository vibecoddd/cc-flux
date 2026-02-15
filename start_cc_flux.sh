#!/bin/bash

# Define colors
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting CC-Flux Proxy...${NC}"

# Start Proxy in background and save PID
cd proxy
npm start > /dev/null 2>&1 &
PROXY_PID=$!
cd ..

# Ensure Proxy is killed when script exits
cleanup() {
    echo -e "${GREEN}Stopping Proxy (PID: $PROXY_PID)...${NC}"
    kill $PROXY_PID
}
trap cleanup EXIT

# Wait a moment for Proxy to initialize
sleep 2

echo -e "${GREEN}Starting TUI Controller...${NC}"
cd tui

# Check if binary exists, if not, build it
if [ ! -f "cc-flux" ]; then
    echo "Building TUI..."
    go build -o cc-flux .
fi

# Run TUI
./cc-flux
