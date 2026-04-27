#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running proxy tests"
(
  cd "$ROOT_DIR/proxy"
  npm test
)

echo "Running TUI tests"
(
  cd "$ROOT_DIR/tui"
  GOCACHE="${GOCACHE:-/tmp/go-build-cache}" go test -count=1 ./...
)

echo "Building TUI"
(
  cd "$ROOT_DIR/tui"
  GOCACHE="${GOCACHE:-/tmp/go-build-cache}" go build -o cc-flux .
)
