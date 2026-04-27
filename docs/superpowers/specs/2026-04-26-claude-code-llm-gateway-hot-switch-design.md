# Claude Code LLM Gateway Hot Switch Design

Date: 2026-04-26
Status: Implemented

## Context

CC-Flux already exposes an Anthropic-compatible `/v1/messages` endpoint and translates Claude Code traffic to OpenAI-compatible providers. The project also has a Go TUI that can update the proxy's in-memory target provider through `POST /config`.

The requested feature is to support Claude Code through a proxy-style gateway and hot-switch model settings. We considered `HTTPS_PROXY` interception, but ordinary HTTPS proxying only tunnels encrypted traffic. Without a trusted local CA and TLS inspection, CC-Flux cannot read or rewrite Claude Code's request body. This design therefore uses Claude Code's LLM Gateway pattern: point Claude Code at CC-Flux with `ANTHROPIC_BASE_URL`, then let CC-Flux route and translate model requests.

References:

- Claude Code network proxy variables: https://code.claude.com/docs/en/corporate-proxy
- Claude Code gateway configuration overview: https://code.claude.com/docs/en/bedrock-vertex-proxies

## Goals

- Let Claude Code use CC-Flux as an LLM Gateway via `ANTHROPIC_BASE_URL`.
- Support hot-switching the active provider/model from both TUI and CLI.
- Persist only the active profile id so proxy restarts restore the last selected model.
- Keep provider profiles manually maintained to avoid accidental API key rewrites.
- Preserve existing `/config` behavior for compatibility while moving new flows to Admin API endpoints.

## Non-Goals

- No `HTTPS_PROXY` request-body interception or local CA installation.
- No TUI/CLI editing of provider profiles or API keys in this iteration.
- No interruption or migration of in-flight streaming requests during a switch.

## User Experience

Basic flow:

```bash
cc-flux start
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
cc-flux switch deepseek-reasoner
```

The switch applies to the next `/v1/messages` request. Active streams continue using the provider config captured when that request started.

CLI additions:

```bash
cc-flux profiles
cc-flux current
cc-flux switch <profile-id>
```

- `profiles` lists available profile ids, names, providers, and models.
- `current` shows the proxy's active provider/model without exposing API keys.
- `switch` asks the running proxy to activate a profile and persists that profile id.

The TUI keeps its existing model selection workflow, but it uses the same Admin API as the CLI.

## Configuration Model

Provider profiles remain the source of selectable model definitions:

```json
{
  "id": "deepseek-reasoner",
  "name": "DeepSeek - Reasoner (R1)",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "",
  "model": "deepseek-reasoner",
  "retryEnabled": false
}
```

Profile lookup order:

1. `CC_FLUX_PROVIDERS_PATH`
2. `tui/providers.json` from the project layout
3. `~/.cc-flux/providers.json`

State file lookup:

- Default: `~/.cc-flux/state.json`
- Override: `CC_FLUX_STATE_PATH`

State shape:

```json
{
  "activeProviderId": "deepseek-reasoner"
}
```

Startup config resolution:

1. Load provider profiles.
2. Load `activeProviderId` from state.
3. If the id exists in profiles, activate that profile.
4. Otherwise fall back to `.env` / process environment `TARGET_*` settings.

This keeps existing users working while adding restart-stable profile selection.

## Architecture

The proxy owns runtime configuration through a single config module. That module should expose:

- `get()` for the current request-time provider config.
- `getPublic()` for a redacted status payload.
- `listProfiles()` for CLI/TUI display.
- `switchProfile(id)` for validated profile activation and state persistence.
- `update(updates)` for legacy `/config` compatibility.

New Admin API:

- `GET /admin/profiles`
- `GET /admin/current`
- `POST /admin/switch` with body `{ "id": "<profile-id>" }`

Legacy API:

- `POST /config` remains supported and updates the runtime config directly.
- It should be treated as compatibility surface, not the preferred hot-switch path.

The message handler continues to call `config.get()` at request start. It should not re-read config mid-stream.

## Data Flow

Claude Code request flow:

1. Claude Code sends Anthropic Messages traffic to CC-Flux through `ANTHROPIC_BASE_URL`.
2. `/v1/messages` reads the active provider config once.
3. `adapter/request.js` converts the Anthropic request to OpenAI-compatible chat completions.
4. The handler forwards the request to the active provider.
5. `adapter/response.js` converts streaming provider output back to Anthropic-compatible SSE.

Hot-switch flow:

1. User selects a profile in TUI or runs `cc-flux switch <id>`.
2. Client calls `POST /admin/switch`.
3. Proxy validates the id, updates memory config, and writes `state.json`.
4. Response includes the redacted active config and `statePersisted`.
5. Subsequent model requests use the new profile.

## Error Handling

- Unknown profile id: `404` with code `profile_not_found`.
- Invalid profile, such as missing `baseUrl` or `model`: `400` with code `invalid_profile`.
- Invalid `providers.json`: log the parse error, continue startup, and fall back to `.env`.
- State write failure: switch runtime config, return success with `statePersisted: false` and a warning.
- Upstream provider failure: keep current behavior, but include active provider/model in server logs.
- Admin API responses must redact API keys.

## Testing

Add focused Node tests for the proxy side:

- Profile loading from an explicit path.
- Startup restoration from `state.json`.
- Fallback to environment config when state is missing or stale.
- Successful `switchProfile(id)` updates memory state and persists active id.
- Invalid profile id and invalid profile validation.
- Admin API redacts API keys.
- Legacy `/config` still updates runtime config.
- `/v1/messages` uses the active config captured at request start.

The TUI and CLI can be covered initially with lightweight command-level tests where practical, plus manual smoke testing against the local proxy.

## Security

API keys remain local and are never printed by `profiles`, `current`, Admin API responses, or logs. The state file stores only `activeProviderId`, not provider secrets. This design avoids TLS interception and local CA installation.

## Migration

Existing `.env`-only setups continue to work. Users who want hot-switch persistence add or keep `providers.json`, start the proxy, and switch by profile id. If the persisted id later disappears from profiles, the proxy falls back to `.env` rather than failing to start.
