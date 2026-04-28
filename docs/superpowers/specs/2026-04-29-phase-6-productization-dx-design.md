# Phase 6 Productization and Developer Experience Design

Date: 2026-04-29
Status: Proposed

## Context

CC-Flux has reached a capable local LLM Gateway baseline. It can translate Claude Code traffic to OpenAI-compatible providers, hot-switch provider profiles, expose CLI and TUI controls, protect local Admin API routes, report health and metrics, show DeepSeek reasoning output, and apply deterministic history compression.

The next product risk is not missing model features. It is adoption friction: installation, first-run configuration, local diagnostics, cross-platform startup, and repeatable release discipline. Phase 6 focuses on turning the current working tool into something a developer can install, diagnose, and update without reading the codebase.

## Goals

- Make a new user able to install, initialize, start, and connect Claude Code to CC-Flux in about five minutes.
- Make configuration failures diagnosable through `cc-flux doctor` with concrete repair guidance.
- Clarify both local repository development and global CLI installation paths.
- Improve cross-platform startup for Linux, macOS, and Windows users.
- Establish a repeatable release checklist covering versioning, changelog, package contents, CI, smoke tests, and release notes.
- Add only lightweight metadata needed for future product work; do not launch automatic routing in this phase.

## Non-Goals

- No web dashboard.
- No hosted cloud service, account system, or remote config sync.
- No automatic provider fallback or task-based routing.
- No GUI editor for provider profiles or API keys.
- No model-powered setup assistant.
- No persistence of prompt or completion contents.

## Product Direction

Phase 6 is **Productization and Developer Experience**.

The recommended strategy is to lower adoption and maintenance cost before adding advanced routing. Provider-aware routing remains a valuable long-term direction, but automatic model switching can introduce side effects in Claude Code agent workflows. Phase 6 should instead make the current local-first product predictable, documented, and easy to recover when something goes wrong.

## User Segments

### First-Time Developer

This user wants to try Claude Code through a non-Anthropic or local provider. They need clear commands, safe defaults, a minimal provider config, and a final verification step that proves Claude Code can reach the gateway.

### Daily User

This user already has profiles configured. They need reliable startup, quick model switching, status visibility, compression controls, and actionable diagnostics when a provider or local setting breaks.

### Maintainer

This user prepares releases and accepts changes. They need a consistent pre-release process that verifies tests, docs, package metadata, release notes, and smoke behavior before publishing.

## Product Pillars

### Install

Installation should support two clear paths:

- Local repository usage for contributors and advanced users.
- Global CLI usage for users who want `cc-flux` on their PATH.

The docs should show exactly when to run `npm install`, `npm install -g ./proxy`, TUI build commands, and startup scripts. Existing shell and batch scripts should be treated as first-class user entry points, not incidental helpers.

Success criteria:

- README has one short quick-start path and a separate development path.
- Linux/macOS and Windows startup commands are both documented.
- Missing dependency failures name the missing tool and the command or link needed to resolve it.

### Configure

`cc-flux init` should remain the primary setup entry point. It should create local config files without overwriting user edits and explain the next action after each file is created or found.

The initialized setup should guide users toward:

- `~/.cc-flux/providers.json`
- `~/.cc-flux/state.json`
- the active profile id
- provider API key placement
- `ANTHROPIC_BASE_URL=http://localhost:8080`
- optional `CC_FLUX_ADMIN_TOKEN`

Configuration remains local-first. CC-Flux should not upload, sync, or centrally manage provider credentials.

Success criteria:

- A user can identify the active providers file path from CLI output.
- A missing API key, model, or base URL is reported before the user enters Claude Code.
- Existing `.env` fallback behavior stays compatible.

### Diagnose

`cc-flux doctor` should become the primary support artifact. It should distinguish local environment failures, proxy reachability failures, provider profile problems, Admin API authentication issues, and Claude Code environment setup gaps.

Doctor checks should cover:

- Node.js availability and version.
- Optional Go/TUI build availability when relevant.
- Claude Code CLI availability when present on PATH.
- providers file path, parse status, profile count, active profile id, and redacted profile validity.
- state file path and parse status.
- proxy Admin API reachability.
- Admin token mismatch or missing token.
- configured host and port.
- common port conflicts.
- active provider base URL shape and optional reachability probe.
- TUI binary path hints.

Output should stay terminal-friendly. Each failed check should include a short reason and a next step.

Success criteria:

- Every failed doctor check has a concrete repair suggestion.
- Doctor can run offline and still validate local files.
- Doctor can optionally validate a running proxy without exposing API keys.

### Release

Phase 6 should define a repeatable manual release flow before introducing full automation.

The release checklist should cover:

- `scripts/ci.sh`
- package version update
- changelog entry
- README quick-start sanity check
- npm package contents verification
- TUI build verification
- GitHub release notes
- smoke test commands against a local proxy

Success criteria:

- Maintainers have one documented release checklist.
- Release notes can be assembled from the checklist without scanning commits manually.
- CI is treated as a gate for release readiness.

## Core User Flows

### First Install Flow

1. User follows the README quick start.
2. User installs dependencies or a global CLI.
3. User runs `cc-flux init`.
4. User edits provider credentials locally.
5. User starts the proxy.
6. User sets `ANTHROPIC_BASE_URL`.
7. User runs `cc-flux doctor`.
8. User starts Claude Code and confirms the gateway is active.

The flow should avoid requiring users to inspect source files.

### Daily Use Flow

1. User starts CC-Flux.
2. User starts Claude Code with the gateway base URL.
3. User checks the active provider through CLI or TUI.
4. User switches profiles when needed.
5. User toggles compression when useful.
6. On failure, user runs `cc-flux health`, `cc-flux metrics`, or `cc-flux doctor` and receives a next action.

### Maintainer Release Flow

1. Maintainer runs the local CI script.
2. Maintainer updates version and changelog.
3. Maintainer verifies package contents.
4. Maintainer runs local smoke checks.
5. Maintainer writes release notes.
6. Maintainer publishes through the documented path.

## Architecture

Phase 6 should keep the current architecture:

- Node.js proxy and CLI own configuration, diagnostics, Admin API, and packaging metadata.
- Go TUI remains a focused terminal model selector and status surface.
- `docs/superpowers` continues to store design and implementation planning.
- `scripts/ci.sh` remains the local verification entry point.

New work should be organized around existing modules rather than creating a separate product layer:

- Setup and doctor improvements belong in `proxy/src/cli/setup-command.js` and `proxy/bin/cc-flux.js`.
- Runtime health data remains in Admin API and metrics modules.
- Release documentation belongs in repository docs, with small scripts only where they remove repeatable manual mistakes.

## Data and State

Phase 6 should not add sensitive persistent state.

Allowed local state:

- provider profiles in `providers.json`
- active profile id in `state.json`
- optional environment variables and `.env` fallback
- package metadata and release docs in the repository

Disallowed state:

- prompt history
- completions
- uploaded provider credentials
- cloud account tokens
- model-generated summaries

## Error Handling

Setup and diagnostic errors should be explicit and repair-oriented.

Examples:

- Missing providers file: tell the user to run `cc-flux init`.
- Invalid JSON: print the file path and JSON parse error.
- Missing API key: name the profile and explain where to set it.
- Admin API unauthorized: mention `CC_FLUX_ADMIN_TOKEN`.
- Proxy unreachable: show the expected Admin URL and startup command.
- Port conflict: name the port and suggest changing `PORT`.
- Claude Code not found: report it as optional unless the user is validating end-to-end Claude Code setup.

## Testing

Testing should focus on deterministic CLI behavior and documented flows:

- Unit tests for doctor report construction.
- Unit tests for formatting setup and doctor output.
- Tests for non-overwrite behavior in `cc-flux init`.
- Tests for Admin API reachability handling with and without token.
- Tests for package/release helper scripts if added.
- Keep `scripts/ci.sh` as the final verification command.

Manual smoke checks should cover:

- local proxy startup
- CLI `current`, `profiles`, `health`, `metrics`, and `doctor`
- one profile switch
- TUI build and launch path
- README quick-start commands

## Documentation

README should be reorganized around user intent:

- Quick Start
- Install Options
- Configure Providers
- Connect Claude Code
- Daily Commands
- Troubleshooting
- Development
- Release Process

Detailed release or troubleshooting material may live in separate docs if README becomes too long, but the quick path must remain visible.

## Acceptance Criteria

- A new user can follow the documented quick start without reading source code.
- `cc-flux doctor` identifies local config and proxy reachability issues with repair suggestions.
- Windows and Linux/macOS startup paths are documented.
- Release readiness has a documented checklist and local verification command.
- Existing hot-switch, compression, Admin API, and TUI behavior remain compatible.
- No automatic routing, hosted dashboard, or credential sync is introduced.

## Future Work

After Phase 6, the product can safely move toward provider-aware routing. Candidate future phases:

- Provider registry with richer model capability metadata.
- Manual route presets for coding, reasoning, cheap tasks, and local-only work.
- Safer fallback modes that avoid duplicate side effects.
- Structured trace logs for support bundles.
- Optional desktop or web status UI if CLI/TUI adoption exposes a clear need.
