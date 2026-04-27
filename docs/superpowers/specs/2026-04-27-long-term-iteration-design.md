# Long-Term Iteration Design

Date: 2026-04-27
Status: Implemented

## Context

CC-Flux has reached a working gateway baseline: Anthropic-to-OpenAI-compatible routing, profile hot switching, DeepSeek reasoning visibility, deterministic compression, CLI, TUI, Admin API, and tests. The next long-term direction is to make it safer to run continuously, easier to install, and better prepared for provider-aware routing.

## Goals

- Make the proxy safer by default for local use.
- Add optional Admin API authentication for machines where localhost is not enough isolation.
- Add CI so every push validates proxy and TUI tests.
- Add `cc-flux init` and `cc-flux doctor` for first-run setup and diagnostics.
- Add provider capabilities and health/status surfaces.
- Add lightweight in-memory metrics for operational visibility.
- Improve TUI status controls with refresh behavior.

## Non-Goals

- No automatic network fallback routing in this iteration. Provider failover can multiply side effects in agent workflows, so this phase adds the capability and metrics foundation first.
- No model-powered long-term memory or summaries. Existing deterministic compression remains the safe context-reduction path.
- No multi-user hosted dashboard. The default product remains a local developer gateway.

## Design

### Security

- Default TCP host changes from `0.0.0.0` to `127.0.0.1`.
- `HOST` can explicitly override the bind address.
- `CC_FLUX_ADMIN_TOKEN` enables Admin API protection.
- Protected routes include `/admin/*` and legacy `/config`.
- Token may be supplied as `Authorization: Bearer <token>` or `x-cc-flux-admin-token`.
- `/v1/messages` stays compatible with Claude Code and is not protected by Admin token.

### CI

Add GitHub Actions workflow:

- install proxy dependencies with `npm ci`
- run `npm test` in `proxy`
- set up Go
- run `go test -count=1 ./...` in `tui`
- build `tui/cc-flux`

### Init and Doctor

`cc-flux init` creates local config scaffolding:

- `~/.cc-flux/providers.json` if missing
- `~/.cc-flux/state.json` if missing

`CC_FLUX_HOME` overrides the home directory for tests or scripted installs.

`cc-flux doctor` prints diagnostics:

- Node version
- provider path resolution
- state path resolution
- whether provider JSON parses
- optional Admin API reachability

### Provider Capabilities and Health

Profiles expose inferred capabilities:

- `streaming`
- `tools`
- `reasoning`
- `local`
- `retry`
- `compression`

Profiles may override capabilities through a `capabilities` object. Admin profile responses include redacted capability info.

Add `GET /admin/health`:

- process uptime
- active provider/model
- profile count
- config meta errors
- compression settings

### Metrics

Add in-memory metrics:

- process start time
- message request count
- upstream error count
- compression applied count
- profile switch count
- compression update count

Add `GET /admin/metrics` and `cc-flux metrics`.

Metrics are process-local and reset on restart. They do not include prompt text, completions, or API keys.

### TUI

- `r` refreshes runtime status from `/admin/current`.
- Status copy mentions `r`.
- Existing `c` compression toggle remains.

## Testing

- Node tests for host default, Admin token enforcement, health, metrics, init/doctor helpers, capabilities.
- Existing proxy tests continue to pass.
- Go tests for TUI refresh behavior.
- Final verification runs proxy tests, TUI tests, TUI build, and selected CLI smoke.
