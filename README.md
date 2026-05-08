# CC-Flux

**Local-first Claude Code gateway with OpenAI-compatible routing and hot-switchable providers.**

CC-Flux exposes an Anthropic-compatible `/v1/messages` endpoint locally, translates requests to OpenAI-compatible providers (DeepSeek, Ollama, OpenAI, etc.), and lets you hot-switch the active backend without restarting your Claude Code session.

---

## Quick Start

### 1. Install dependencies

```bash
# Install proxy dependencies
cd proxy && npm install

# Build TUI (optional but recommended)
cd ../tui && go build -o cc-flux .
```

### 2. Initialize config

```bash
cc-flux init
```

### 3. Add your API key

Edit `~/.cc-flux/providers.json` and add your API key to the profile you want to use.

### 4. Start the proxy

```bash
cc-flux start
```

### 5. Connect Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

### 6. Verify everything works

```bash
cc-flux doctor
```

---

## Install Options

### Global CLI install

```bash
cd proxy && npm install -g ./
```

This installs `cc-flux` globally so you can run it from anywhere.

### Local development

Run without installing:

```bash
# Proxy
cd proxy && npm start

# CLI (in another terminal)
node proxy/bin/cc-flux.js <command>

# TUI (in another terminal)
cd tui && ./cc-flux
```

### Platform-specific startup

```bash
# Linux/macOS
./start_cc_flux.sh

# Windows
start_cc_flux.bat
```

---

## Configure Providers

### Provider profiles

Edit `~/.cc-flux/providers.json` to configure your model providers:

```json
{
  "id": "deepseek-reasoner",
  "name": "DeepSeek - Reasoner (R1)",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-your-key-here",
  "model": "deepseek-reasoner",
  "retryEnabled": true
}
```

### Environment variables

Alternatively, configure via environment variables:

```bash
PORT=8080
TARGET_PROVIDER=deepseek
TARGET_BASE_URL=https://api.deepseek.com
TARGET_API_KEY=sk-your-key-here
TARGET_MODEL=deepseek-reasoner
```

See `.env.example` in the proxy directory for all available options.

### Compression settings

Control history compression to manage token usage:

```bash
CC_FLUX_COMPRESSION_ENABLED=true
CC_FLUX_COMPRESSION_MAX_MESSAGES=40
CC_FLUX_COMPRESSION_KEEP_RECENT=16
```

---

## Connect Claude Code

Set the `ANTHROPIC_BASE_URL` environment variable to point Claude Code at CC-Flux:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Some Claude Code versions also recognize `CLAUDE_BASE_URL`.

Verify the connection inside Claude Code:

```
/status
```

> **Note:** Do not use `HTTPS_PROXY` for protocol translation. A plain HTTPS proxy can tunnel encrypted traffic but cannot rewrite request bodies.

---

## Daily Commands

### List available profiles

```bash
cc-flux profiles
```

### Show current configuration

```bash
cc-flux current
```

### Switch to a different provider

```bash
cc-flux switch deepseek-reasoner
```

### Check proxy health

```bash
cc-flux health
```

### View metrics

```bash
cc-flux metrics
```

### Control compression

```bash
cc-flux compression        # Show current settings
cc-flux compression on     # Enable compression
cc-flux compression off    # Disable compression
cc-flux compression set --max-messages 32 --keep-recent 12  # Custom settings
```

### Run diagnostics

```bash
cc-flux doctor             # Basic checks
cc-flux doctor --with-tui  # Include TUI/Go checks
```

### Start the TUI

```bash
cc-flux tui
```

---

## TUI Controls

- `↑` / `↓` or `k` / `j`: Move selection
- `Enter`: Switch to selected profile
- `r`: Refresh runtime status
- `c`: Toggle compression
- `q` or `Ctrl+C`: Quit

---

## Troubleshooting

### Proxy not reachable

1. Start the proxy first: `cc-flux start`
2. Check if it's running on the expected port: `cc-flux health`

### Doctor shows "not reachable"

1. Verify the proxy is running on the expected port
2. Check for port conflicts: `cc-flux doctor`
3. Make sure PORT matches between proxy and CLI

### Missing API key

```bash
# Find your providers file
cc-flux doctor | grep providers

# Edit the file
nano ~/.cc-flux/providers.json
```

### Claude Code not connecting

1. Verify the base URL inside Claude Code: `/status`
2. Make sure `ANTHROPIC_BASE_URL` is set correctly
3. Check proxy health: `cc-flux health`

### Port already in use

```bash
# Find what's using the port
lsof -i :8080  # macOS/Linux

# Change the port
PORT=8081 cc-flux start
```

---

## Development

### Run tests

```bash
# Proxy tests
cd proxy && npm test

# TUI tests
cd tui && go test -count=1 ./...
```

### Build TUI

```bash
cd tui && go build -o cc-flux .
```

### Run local CI

```bash
./scripts/ci.sh
```

### Local smoke test

```bash
# Terminal 1: Start proxy
cd proxy && PORT=18080 CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start

# Terminal 2: Run CLI commands
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js profiles
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js current
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js switch deepseek-reasoner
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js health
```

---

## Admin API

CC-Flux exposes a local Admin API:

```http
GET  /admin/profiles     # List provider profiles
GET  /admin/current      # Show current config
GET  /admin/health       # Show health status
GET  /admin/metrics      # Show metrics counters
GET  /admin/compression  # Show compression settings
POST /admin/compression  # Update compression
POST /admin/switch       # Switch to a profile
```

With token protection:

```bash
curl -fsS http://localhost:8080/admin/health \
  -H 'Authorization: Bearer your-token'
```

---

## Features

- **Claude Code gateway**: Point Claude Code at `http://localhost:8080`
- **OpenAI-compatible routing**: Converts Anthropic requests to chat completions
- **Hot switching**: Switch providers without restarting Claude Code
- **Restart-stable state**: Active profile persists across restarts
- **DeepSeek reasoning**: Streams `reasoning_content` as readable `<thinking>` text
- **History compression**: Deterministic local compression for long sessions
- **Ollama support**: Built-in retry mode for local models
- **Security**: Binds to `127.0.0.1` by default, optional Admin token protection

---

## Roadmap

- [x] Phase 1: Core Node.js proxy and Anthropic-to-OpenAI mapping
- [x] Phase 2: Go-based interactive model selector
- [x] Phase 3: Ollama/local-model optimization and retry behavior
- [x] Phase 4: DeepSeek reasoning visibility and history compression
- [x] Phase 5: Security defaults, Admin API auth, health/metrics, setup/doctor
- [ ] Phase 6: Productization and developer experience improvements

---

## License

MIT
