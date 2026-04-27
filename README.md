# CC-Flux

CC-Flux is a lightweight LLM gateway for Claude Code. It exposes an Anthropic-compatible `/v1/messages` endpoint locally, translates requests to OpenAI-compatible providers, and lets you hot-switch the active backend without restarting your Claude Code session.

It is designed for developers who want to use Claude Code with providers such as OpenAI-compatible APIs, DeepSeek, MiniMax, Zhipu GLM, or local Ollama models while keeping API keys and routing state on the local machine.

## Features

- **Claude Code gateway**: point Claude Code at `http://localhost:8080` with `ANTHROPIC_BASE_URL`.
- **OpenAI-compatible routing**: converts Anthropic Messages requests to chat completions.
- **Hot switching**: switch provider profiles from CLI or TUI while the proxy keeps running.
- **Restart-stable profile state**: stores only the active profile id in a small local state file.
- **Admin API**: inspect profiles, current runtime config, health, metrics, capabilities, active compression settings, and switch profiles.
- **Local-first controls**: binds to `127.0.0.1` by default and can protect Admin API calls with `CC_FLUX_ADMIN_TOKEN`.
- **Bootstrap and diagnostics**: `cc-flux init` creates local config files, and `cc-flux doctor` checks JSON config plus Admin API reachability.
- **DeepSeek reasoning visibility**: streams `reasoning_content` as readable `<thinking>` text.
- **History compression**: optional deterministic local compression for long sessions.
- **Ollama retry mode**: local-model retry path for malformed tool-call JSON.

## Project Layout

```text
proxy/                 Node.js Fastify gateway
proxy/src/adapter/     Anthropic <-> OpenAI-compatible request/response adapters
proxy/src/config/      Provider profile and state loading
proxy/src/admin.js     Admin API routes
proxy/bin/cc-flux.js   CLI entrypoint
proxy/test/            Node test suite
tui/                   Go Bubble Tea terminal UI
tui/providers.json     Default provider profiles
docs/superpowers/      Design specs and implementation plans
```

## Requirements

- Node.js 18 or newer
- npm
- Go 1.24 or newer for the TUI
- Claude Code CLI

## Install

From a fresh checkout:

```bash
cd proxy
npm install

cd ../tui
go build -o cc-flux .
```

Optional global CLI install from the local package:

```bash
npm install -g ./proxy
```

Create user-level config files:

```bash
cc-flux init
cc-flux doctor
```

Without a global install, run the CLI as:

```bash
node proxy/bin/cc-flux.js <command>
```

## Configuration

### Proxy Environment

`proxy/src/config.js` reads `.env` and process environment values.

Common settings:

```bash
PORT=8080
HOST=127.0.0.1
TARGET_PROVIDER=openai
TARGET_BASE_URL=https://api.openai.com/v1
TARGET_API_KEY=
TARGET_MODEL=
RETRY_ENABLED=false
SOCKET_PATH=
CC_FLUX_ADMIN_TOKEN=
```

Compression settings:

```bash
CC_FLUX_COMPRESSION_ENABLED=false
CC_FLUX_COMPRESSION_MAX_MESSAGES=40
CC_FLUX_COMPRESSION_KEEP_RECENT=16
```

Profile/state path overrides:

```bash
CC_FLUX_HOME=$HOME/.cc-flux
CC_FLUX_PROVIDERS_PATH=/path/to/providers.json
CC_FLUX_STATE_PATH=/path/to/state.json
```

Default lookup:

- Profiles: `tui/providers.json`, `../tui/providers.json`, `providers.json`, then `~/.cc-flux/providers.json`
- State: `~/.cc-flux/state.json`

Set `HOST=0.0.0.0` only when you intentionally want the proxy reachable from other machines. When `CC_FLUX_ADMIN_TOKEN` is set, all `/admin/*` endpoints and legacy `POST /config` require `Authorization: Bearer <token>` or `X-CC-Flux-Admin-Token: <token>`.

The state file stores only:

```json
{
  "activeProviderId": "deepseek-reasoner"
}
```

### Provider Profiles

Edit `tui/providers.json` or point `CC_FLUX_PROVIDERS_PATH` at your own file.

```json
{
  "id": "deepseek-reasoner",
  "name": "DeepSeek - Reasoner (R1)",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "",
  "model": "deepseek-reasoner",
  "retryEnabled": false,
  "capabilities": {
    "reasoning": true,
    "tools": true
  },
  "compression": {
    "enabled": true,
    "maxMessages": 48,
    "keepRecent": 18
  }
}
```

Profile fields:

- `id`: stable profile id used by CLI/TUI/state.
- `name`: human-readable label.
- `provider`: adapter mode, such as `openai`, `deepseek`, or `ollama`.
- `baseUrl`: OpenAI-compatible API base URL.
- `apiKey`: local API key. It is redacted in Admin API and CLI output.
- `model`: upstream model name.
- `retryEnabled`: optional retry mode override.
- `capabilities`: optional capability overrides for status UIs. CC-Flux also infers `streaming`, `tools`, `reasoning`, `local`, `retry`, and `compression`.
- `compression`: optional per-profile compression override.

## Run

Start the proxy:

```bash
cd proxy
npm start
```

Or from the repository root:

```bash
npm start
```

Start the TUI in another terminal:

```bash
cd tui
./cc-flux
```

Quick-start scripts are also available:

```bash
./start_cc_flux.sh
```

```cmd
start_cc_flux.bat
```

## Connect Claude Code

Use CC-Flux as an LLM gateway:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Some Claude Code versions also recognize `CLAUDE_BASE_URL`; use `/status` inside Claude Code to verify the active base URL.

Do not use `HTTPS_PROXY` for protocol translation. A normal HTTPS proxy can tunnel encrypted traffic but cannot rewrite Anthropic request bodies into OpenAI-compatible requests without local TLS inspection.

## CLI

If installed globally:

```bash
cc-flux <command>
```

From the repository without global install:

```bash
node proxy/bin/cc-flux.js <command>
```

Commands:

```bash
cc-flux start
cc-flux init
cc-flux doctor
cc-flux profiles
cc-flux current
cc-flux health
cc-flux metrics
cc-flux switch deepseek-reasoner
cc-flux compression
cc-flux compression on
cc-flux compression set --max-messages 32 --keep-recent 12
cc-flux compression off
cc-flux tui
```

For a proxy on a non-default port:

```bash
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 cc-flux current
```

For a token-protected Admin API:

```bash
CC_FLUX_ADMIN_TOKEN=secret cc-flux health
```

## TUI

The TUI loads local provider profiles and talks to the running proxy Admin API.

Controls:

- `up` / `down` or `k` / `j`: move selection
- `enter`: switch to selected profile
- `r`: refresh runtime status
- `c`: toggle compression for future requests
- `q` or `ctrl+c`: quit

The status area shows the active provider/model and compression state when the proxy is reachable. If the Admin API is token-protected, start the TUI with the same `CC_FLUX_ADMIN_TOKEN`.

## Admin API

The proxy exposes local Admin API endpoints:

```http
GET  /admin/profiles
GET  /admin/current
GET  /admin/health
GET  /admin/metrics
GET  /admin/compression
POST /admin/compression
POST /admin/switch
POST /config
```

Examples:

```bash
curl -fsS http://localhost:8080/admin/profiles
curl -fsS http://localhost:8080/admin/current
curl -fsS http://localhost:8080/admin/health
curl -fsS http://localhost:8080/admin/metrics
curl -fsS -X POST http://localhost:8080/admin/switch \
  -H 'Content-Type: application/json' \
  -d '{"id":"deepseek-reasoner"}'
curl -fsS -X POST http://localhost:8080/admin/compression \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"maxMessages":32,"keepRecent":12}'
```

Admin responses redact API keys.

With `CC_FLUX_ADMIN_TOKEN=secret`:

```bash
curl -fsS http://localhost:8080/admin/health \
  -H 'Authorization: Bearer secret'
```

## Reasoning Output

DeepSeek R1 streams `reasoning_content` separately from answer text. CC-Flux emits that reasoning as ordinary Anthropic-compatible text:

```text
<thinking>
reasoning tokens from the provider
</thinking>

final answer
```

CC-Flux does not emit Anthropic-native thinking blocks because those require Anthropic signature deltas that third-party providers cannot generate.

## History Compression

Compression is disabled by default. When enabled, CC-Flux compresses old converted messages before sending the request upstream.

The deterministic compressor:

- preserves leading system messages
- preserves recent messages exactly
- keeps assistant tool calls and matching tool results together
- removes `reasoning_content` fields from upstream-shaped messages
- summarizes older plain turns into one synthetic context message
- does not write conversation contents to disk

Enable through environment, provider profiles, CLI, TUI, or Admin API.

## Local Models

For Ollama/local providers:

- Use a profile with `provider: "ollama"`.
- Use an OpenAI-compatible base URL such as `http://localhost:11434/v1`.
- Retry mode is automatically enabled for `ollama`, or can be forced with `RETRY_ENABLED=true`.

## Development

Run the proxy tests:

```bash
cd proxy
npm test
```

Run TUI tests and build:

```bash
cd tui
GOCACHE=/tmp/go-build-cache go test -count=1 ./...
GOCACHE=/tmp/go-build-cache go build -o cc-flux .
```

Full local smoke example:

```bash
cd proxy
PORT=18080 CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start
```

In another terminal:

```bash
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js profiles
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js switch deepseek-reasoner
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js compression on
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js health
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js metrics
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js current
```

## Roadmap

- [x] Phase 1: Core Node.js proxy and Anthropic-to-OpenAI mapping.
- [x] Phase 2: Go-based interactive model selector.
- [x] Phase 3: Ollama/local-model optimization and retry behavior.
- [x] Phase 4: DeepSeek reasoning visibility and deterministic history compression.
- [x] Phase 5: Localhost-safe defaults, Admin API auth, health/metrics, setup/doctor commands, and provider capabilities.

## Security

- API keys stay local in environment variables or provider profile files.
- Admin API, CLI, and TUI status responses redact API keys.
- TCP mode binds to `127.0.0.1` by default. Use `HOST=0.0.0.0` only for deliberate LAN/container exposure.
- Set `CC_FLUX_ADMIN_TOKEN` to require bearer-token auth for `/admin/*` and legacy `POST /config`.
- `~/.cc-flux/state.json` stores only the active profile id.
- Compression summaries are sent only to the selected upstream provider as part of the active request and are not persisted by CC-Flux.

## License

MIT
