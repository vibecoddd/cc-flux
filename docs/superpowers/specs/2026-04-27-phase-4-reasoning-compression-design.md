# Phase 4 Reasoning and Compression Design

Date: 2026-04-27
Status: Approved for planning

## Context

CC-Flux now works as a Claude Code LLM Gateway with profile-based hot switching. The remaining explicit roadmap item is Phase 4:

- Support thinking/reasoning tokens, especially DeepSeek R1 `reasoning_content`.
- Add conversation history compression.

The current proxy translates Anthropic Messages requests into OpenAI-compatible chat completions and translates OpenAI-style SSE back into Anthropic-compatible SSE. There is also a local, uncommitted `proxy/src/adapter/response.js` change that already starts wrapping DeepSeek `reasoning_content` in `<thinking>` text. This design treats that work as the right direction but requires tests and hardening before it becomes complete.

References checked during design:

- DeepSeek documents streamed `delta.reasoning_content` for `deepseek-reasoner` and warns that `reasoning_content` must not be included in later input messages.
- Anthropic native streaming thinking uses `thinking_delta` and a `signature_delta` before the thinking block closes.

## Goals

- Surface DeepSeek reasoning content to Claude Code users without generating invalid Anthropic signed-thinking blocks.
- Prevent duplicate terminal SSE events when providers emit both `finish_reason` chunks and `data: [DONE]`.
- Add opt-in deterministic local history compression that reduces old context before upstream calls.
- Preserve tool-use/tool-result correctness while compressing or trimming.
- Expose compression status and controls through config, Admin API, CLI, TUI, and docs.
- Keep API keys redacted in every status/control surface.

## Non-Goals

- No model-powered summarization in this phase. It would add latency, cost, provider selection complexity, and failure modes.
- No Anthropic-native `thinking` block output. CC-Flux cannot generate Anthropic thinking signatures, so native thinking blocks would be misleading or invalid.
- No persistence of conversation contents to disk.
- No automatic mutation of `providers.json` from CLI or TUI.
- No interruption or migration of active streaming responses.

## User Experience

Reasoning output:

- DeepSeek reasoning streams before final content.
- CC-Flux emits it as a normal text block formatted as:

```text
<thinking>
...provider reasoning...
</thinking>

...final answer...
```

This keeps the stream Anthropic-compatible while making the reasoning visible.

Compression configuration:

```bash
export CC_FLUX_COMPRESSION_ENABLED=true
export CC_FLUX_COMPRESSION_MAX_MESSAGES=32
export CC_FLUX_COMPRESSION_KEEP_RECENT=12
```

CLI controls:

```bash
cc-flux compression
cc-flux compression on
cc-flux compression off
cc-flux compression set --max-messages 32 --keep-recent 12
```

TUI controls:

- Show active provider/model and compression status in the status area.
- Press `c` to toggle compression on or off through the Admin API.
- Refresh status after successful profile switches and compression toggles.

Compression status includes whether the next requests are eligible for compression and the configured thresholds. Request-level logs include when compression ran and how many messages were reduced.

## Configuration Model

Runtime config gains a `compression` object:

```json
{
  "compression": {
    "enabled": false,
    "maxMessages": 40,
    "keepRecent": 16
  }
}
```

Environment variables:

- `CC_FLUX_COMPRESSION_ENABLED`: `true` or `false`, default `false`.
- `CC_FLUX_COMPRESSION_MAX_MESSAGES`: total message threshold before compression, default `40`.
- `CC_FLUX_COMPRESSION_KEEP_RECENT`: recent-message window to preserve exactly, default `16`.

Provider profiles may override these fields:

```json
{
  "id": "deepseek-reasoner",
  "name": "DeepSeek - Reasoner (R1)",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "",
  "model": "deepseek-reasoner",
  "retryEnabled": false,
  "compression": {
    "enabled": true,
    "maxMessages": 48,
    "keepRecent": 18
  }
}
```

Legacy `/config` may update compression for compatibility, but the preferred control surface is the Admin API.

## Architecture

### Response Adapter

`proxy/src/adapter/response.js` remains responsible for streaming OpenAI-compatible chunks into Anthropic SSE.

Rules:

- Initialize `message_start` once on the first valid provider chunk.
- On `delta.reasoning_content`, open a text content block if needed, emit `<thinking>\n` once, then stream reasoning deltas as text deltas.
- When final `delta.content` starts, close the thinking wrapper with `\n</thinking>\n\n` before streaming answer text.
- If a stream ends while still inside reasoning, close the wrapper before stopping.
- Emit `message_delta` and `message_stop` once. If a provider sends a `finish_reason` chunk and then `data: [DONE]`, the `[DONE]` chunk must not emit a second `message_stop`.

### History Compression

Add `proxy/src/adapter/compression.js` with pure functions so behavior is easy to test.

Input:

- OpenAI-compatible `messages` from `convertRequest`.
- Compression settings from the request-time config.

Output:

```js
{
  messages,
  meta: {
    applied: boolean,
    originalCount: number,
    finalCount: number,
    summaryCount: number,
    reason: string
  }
}
```

Compression strategy:

1. If disabled, return messages unchanged.
2. If `messages.length <= maxMessages`, return messages unchanged.
3. Keep all leading system messages.
4. Preserve the last `keepRecent` non-system messages exactly, expanded backward if needed to avoid splitting a tool-call assistant message from its matching tool result messages.
5. Convert older compressible messages into one synthetic user message:

```text
[CC-Flux compressed conversation history]
- user: ...
- assistant: ...
- tool result for <id>: ...
```

6. Drop old assistant `reasoning_content` fields if they appear in upstream-shaped messages. DeepSeek explicitly rejects them in later input.
7. Never create a summary if doing so would split a required tool-call/tool-result group. In that case, expand the preserved window or skip compression with a meta reason.

The deterministic summary is not semantically perfect, but it is predictable, cheap, and safe. It gives downstream models a compact reminder while preserving recent operational state exactly.

### Message Handler

`proxy/src/handlers/message.js` captures config once per request, converts the incoming Anthropic request, applies compression to the converted OpenAI messages, then forwards the request.

Request logs include compression metadata when compression is applied or skipped due to safety constraints. The response body sent to upstream never includes compression metadata.

### Admin API

Add endpoints:

- `GET /admin/compression`
- `POST /admin/compression` with body:

```json
{
  "enabled": true,
  "maxMessages": 40,
  "keepRecent": 16
}
```

Partial updates are accepted. Validation failures return `400` with code `invalid_compression_config`.

`GET /admin/current` also includes the redacted compression settings.

### CLI

Add commands:

- `cc-flux compression`: print current compression settings.
- `cc-flux compression on`: enable compression.
- `cc-flux compression off`: disable compression.
- `cc-flux compression set --max-messages <n> --keep-recent <n>`: update thresholds.

CLI output is concise and script-friendly enough for terminal use. Failures include the HTTP status and Admin API error message.

### TUI

The existing Bubble Tea app remains a model selector, not a full settings app.

Changes:

- On startup, fetch `/admin/current` if the proxy is reachable.
- Show active provider/model and compression status below the profile list.
- Press `c` to toggle compression through `POST /admin/compression`.
- After profile switch or compression toggle, refresh status from `/admin/current`.
- If the proxy is unreachable, keep the current local providers list and show a status error without crashing.

## Data Flow

Normal request with compression:

1. Claude Code calls `/v1/messages`.
2. Handler reads config once.
3. `request.js` converts Anthropic messages to OpenAI-compatible messages.
4. `compression.js` decides whether to compact old converted messages.
5. Handler calls active provider with compressed messages.
6. `response.js` streams provider chunks back as Anthropic-compatible SSE.

Reasoning stream:

1. Provider emits `delta.reasoning_content`.
2. `response.js` opens a text block and emits `<thinking>`.
3. Provider emits final `delta.content`.
4. `response.js` closes `</thinking>` and streams final answer text.
5. Provider emits finish and/or `[DONE]`.
6. `response.js` emits one terminal stop sequence.

## Error Handling

- Invalid compression thresholds: `400 invalid_compression_config`.
- `keepRecent > maxMessages`: reject as invalid.
- `maxMessages < 2` or `keepRecent < 1`: reject as invalid.
- Compression unable to preserve tool adjacency: skip compression and log the reason.
- Admin status fetch failure in TUI: show an error in status line and allow local profile navigation.
- CLI connection failure: print the connection error and exit non-zero.
- Reasoning JSON parse errors in streaming chunks: keep current behavior and ignore invalid provider chunks.

## Testing

Node tests:

- Response adapter wraps DeepSeek reasoning in `<thinking>` text.
- Response adapter closes thinking before final content.
- Response adapter emits only one `message_stop` for finish plus `[DONE]`.
- Compression is disabled by default.
- Compression triggers over `maxMessages`.
- Compression preserves leading system messages and recent messages.
- Compression keeps tool-call/tool-result groups together.
- Compression removes old `reasoning_content` fields from upstream-shaped messages.
- Config loads compression from env and profile overrides.
- Admin API gets and updates compression with validation.
- Message handler sends compressed messages upstream when enabled.
- CLI compression commands call the Admin API correctly.

Go tests:

- TUI toggles compression through `/admin/compression`.
- TUI refreshes status from `/admin/current`.
- TUI renders compression status without leaking API keys.

Manual smoke:

- Start proxy with project providers.
- Run `cc-flux compression`, `cc-flux compression on`, `cc-flux compression set --max-messages 32 --keep-recent 12`, and `cc-flux compression off`.
- Run TUI, press `c`, and verify `cc-flux compression` reflects the change.
- Send a mocked or local DeepSeek-style stream through `/v1/messages` and verify reasoning appears once, wrapped in `<thinking>`.

## Security

Compression summaries are only sent to the selected upstream provider as part of the active request. They are not written to disk. Admin API and CLI status responses continue to redact API keys. TUI status uses redacted Admin API payloads only.

## Migration

Compression is disabled by default, so existing users see no behavior change unless they opt in through environment variables, profile fields, CLI, or TUI. DeepSeek reasoning support changes only responses that include `reasoning_content`; ordinary providers keep current streaming behavior.
