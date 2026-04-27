# Phase 4 Reasoning and Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Finish Phase 4 by adding tested DeepSeek reasoning streaming, opt-in history compression, and compression controls in Admin API, CLI, TUI, and docs.

**Architecture:** Keep response conversion, request compression, runtime config, Admin API, CLI, and TUI status in separate modules. Compression is deterministic and local: it never calls a model and never persists conversation text. Reasoning is surfaced as ordinary text wrapped in `<thinking>` because CC-Flux cannot generate Anthropic signed thinking blocks.

**Tech Stack:** Node.js 18+, Fastify, axios, Node built-in `node:test`, Go Bubble Tea TUI, Go `testing`/`httptest`.

---

## File Structure

- Create `proxy/src/adapter/compression.js`: pure compression functions and config validation helpers.
- Create `proxy/test/response.test.js`: response adapter reasoning and terminal-event tests.
- Create `proxy/test/compression.test.js`: compression behavior tests.
- Create `proxy/test/cli-compression.test.js`: pure CLI compression parser/formatter tests.
- Modify `proxy/src/adapter/response.js`: harden reasoning wrapper and single-stop emission.
- Modify `proxy/src/config/profile-store.js`: profile compression mapping and redaction.
- Modify `proxy/src/config.js`: runtime compression defaults, profile overrides, update helpers.
- Modify `proxy/src/admin.js`: Admin compression endpoints.
- Modify `proxy/src/handlers/message.js`: apply compression before upstream request and log meta.
- Modify `proxy/bin/cc-flux.js`: compression commands.
- Modify `proxy/test/config.test.js`, `proxy/test/admin.test.js`, `proxy/test/message-config.test.js`: coverage for compression config and upstream payloads.
- Modify `tui/main.go`: status fetch, compression display, `c` toggle.
- Modify `tui/main_test.go`: TUI compression toggle/status tests.
- Modify `README.md`: Phase 4 docs and roadmap completion.

## Task 1: Harden Reasoning Streaming

**Files:**
- Create: `proxy/test/response.test.js`
- Modify: `proxy/src/adapter/response.js`

- [x] **Step 1: Write failing reasoning tests**

Create `proxy/test/response.test.js` with tests that parse SSE events from `StreamAdapter.processChunk()`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const StreamAdapter = require('../src/adapter/response');

function eventNames(events) {
  return events.map((event) => event.match(/^event: ([^\n]+)/)[1]);
}

function payloads(events) {
  return events.map((event) => JSON.parse(event.match(/^data: (.*)$/m)[1]));
}

test('wraps DeepSeek reasoning_content in thinking text markers', () => {
  const adapter = new StreamAdapter();
  const events = adapter.processChunk([
    'data: {"model":"deepseek-reasoner","choices":[{"delta":{"reasoning_content":"first thought"},"finish_reason":null}]}',
    ''
  ].join('\n'));
  const data = payloads(events);
  assert.deepEqual(eventNames(events), [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_delta'
  ]);
  assert.equal(data[2].delta.text, '<thinking>\n');
  assert.equal(data[3].delta.text, 'first thought');
});

test('closes thinking wrapper before final answer content', () => {
  const adapter = new StreamAdapter();
  adapter.processChunk('data: {"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}\n\n');
  const events = adapter.processChunk('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":null}]}\n\n');
  const texts = payloads(events)
    .filter((payload) => payload.delta && payload.delta.text)
    .map((payload) => payload.delta.text);
  assert.deepEqual(texts, ['\n</thinking>\n\n', 'answer']);
});

test('emits one message_stop for finish_reason followed by done', () => {
  const adapter = new StreamAdapter();
  const first = adapter.processChunk('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n');
  const second = adapter.processChunk('data: [DONE]\n\n');
  assert.equal(eventNames([...first, ...second]).filter((name) => name === 'message_stop').length, 1);
});
```

- [x] **Step 2: Run response tests to verify RED**

Run: `cd proxy && npm test -- test/response.test.js`

Expected: FAIL on duplicate `message_stop` or missing reasoning behavior depending on current local `response.js`.

- [x] **Step 3: Implement response adapter state**

Update `proxy/src/adapter/response.js` so `StreamAdapter` has:

```js
this.inReasoning = false;
this.hasStopped = false;
```

Add helper methods inside the class:

```js
closeReasoningIfNeeded(events) { /* emit closing text delta once */ }
emitStop(events) { /* emit message_stop once */ }
```

Use `closeReasoningIfNeeded(events)` before final text/tool/stop transitions, and use `emitStop(events)` for both `finish_reason` and `[DONE]`.

- [x] **Step 4: Run response tests to verify GREEN**

Run: `cd proxy && npm test -- test/response.test.js`

Expected: PASS.

- [x] **Step 5: Commit reasoning streaming**

```bash
git add proxy/src/adapter/response.js proxy/test/response.test.js
git commit -m "feat: harden reasoning stream adapter"
```

## Task 2: Add Deterministic History Compression

**Files:**
- Create: `proxy/src/adapter/compression.js`
- Create: `proxy/test/compression.test.js`

- [x] **Step 1: Write compression behavior tests**

Create `proxy/test/compression.test.js` with tests for disabled mode, threshold behavior, system preservation, recent-message preservation, tool adjacency, and `reasoning_content` removal.

Key assertions:

```js
const { compressMessages, normalizeCompressionConfig } = require('../src/adapter/compression');
assert.equal(compressMessages(messages, { enabled: false }).meta.applied, false);
assert.equal(compressMessages(messages, { enabled: true, maxMessages: 4, keepRecent: 2 }).messages[1].content.startsWith('[CC-Flux compressed conversation history]'), true);
assert.equal(JSON.stringify(result.messages).includes('reasoning_content'), false);
```

- [x] **Step 2: Run compression tests to verify RED**

Run: `cd proxy && npm test -- test/compression.test.js`

Expected: FAIL because `../src/adapter/compression` does not exist.

- [x] **Step 3: Implement compression module**

Create `proxy/src/adapter/compression.js` exporting:

```js
const DEFAULT_COMPRESSION = Object.freeze({ enabled: false, maxMessages: 40, keepRecent: 16 });

function normalizeCompressionConfig(input = {}) { /* parse booleans/numbers, return defaults */ }
function validateCompressionConfig(input = {}) { /* return { valid, message, config } */ }
function compressMessages(messages, settings = {}) { /* deterministic compression */ }

module.exports = { DEFAULT_COMPRESSION, normalizeCompressionConfig, validateCompressionConfig, compressMessages };
```

Implement compression by preserving leading system messages, expanding the recent window backward across assistant `tool_calls` and following `tool` messages, summarizing older non-system messages into one synthetic user message, and stripping any `reasoning_content` fields from cloned messages.

- [x] **Step 4: Run compression tests to verify GREEN**

Run: `cd proxy && npm test -- test/compression.test.js`

Expected: PASS.

- [x] **Step 5: Commit compression module**

```bash
git add proxy/src/adapter/compression.js proxy/test/compression.test.js
git commit -m "feat: add deterministic history compression"
```

## Task 3: Add Compression Runtime Config and Admin API

**Files:**
- Modify: `proxy/src/config/profile-store.js`
- Modify: `proxy/src/config.js`
- Modify: `proxy/src/admin.js`
- Modify: `proxy/test/config.test.js`
- Modify: `proxy/test/admin.test.js`

- [x] **Step 1: Write failing config/admin tests**

Add config tests proving env defaults and profile overrides:

```js
assert.deepEqual(config.get().compression, { enabled: true, maxMessages: 12, keepRecent: 4 });
assert.equal(config.getPublic().compression.enabled, true);
```

Add Admin tests for:

```js
GET /admin/compression
POST /admin/compression { enabled: true, maxMessages: 20, keepRecent: 8 }
POST /admin/compression { keepRecent: 99, maxMessages: 10 } -> 400 invalid_compression_config
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
cd proxy && npm test -- test/config.test.js test/admin.test.js
```

Expected: FAIL because compression config/admin endpoints do not exist.

- [x] **Step 3: Implement runtime compression config**

Update config/profile modules to include `compression`, `getCompression()`, and `updateCompression(updates)`. Use `validateCompressionConfig()` from `adapter/compression.js`. Redacted public config includes compression settings and no secrets.

- [x] **Step 4: Implement Admin endpoints**

Add:

```js
fastify.get('/admin/compression', async () => ({ compression: config.getCompression() }));
fastify.post('/admin/compression', async (request, reply) => { /* partial update with validation */ });
```

- [x] **Step 5: Run config/admin tests to verify GREEN**

Run:

```bash
cd proxy && npm test -- test/config.test.js test/admin.test.js
```

Expected: PASS.

- [x] **Step 6: Commit runtime/Admin compression config**

```bash
git add proxy/src/config.js proxy/src/config/profile-store.js proxy/src/admin.js proxy/test/config.test.js proxy/test/admin.test.js
git commit -m "feat: add compression admin config"
```

## Task 4: Integrate Compression in Requests and CLI

**Files:**
- Modify: `proxy/src/handlers/message.js`
- Modify: `proxy/test/message-config.test.js`
- Modify: `proxy/bin/cc-flux.js`
- Create: `proxy/test/cli-compression.test.js`

- [x] **Step 1: Write failing message-handler compression test**

Extend `proxy/test/message-config.test.js` to configure compression via env/profile and assert upstream `calls[0].data.messages.length` is reduced and includes `[CC-Flux compressed conversation history]`.

- [x] **Step 2: Write failing CLI parser/formatter tests**

Create `proxy/test/cli-compression.test.js` that imports pure helpers from `bin/cc-flux.js` or a small exported CLI helper and asserts:

```js
parseCompressionCommand(['compression', 'on']).body.enabled === true
parseCompressionCommand(['compression', 'set', '--max-messages', '32', '--keep-recent', '12']).body.keepRecent === 12
formatCompressionStatus({ enabled: true, maxMessages: 32, keepRecent: 12 }).includes('enabled')
```

- [x] **Step 3: Run tests to verify RED**

Run:

```bash
cd proxy && npm test -- test/message-config.test.js test/cli-compression.test.js
```

Expected: FAIL because message handler does not compress and CLI helpers do not exist.

- [x] **Step 4: Apply compression before upstream call**

In `messageHandler`, after `convertRequest`, call:

```js
const compressionResult = compressMessages(targetBody.messages, cfg.compression);
targetBody.messages = compressionResult.messages;
```

Log `compressionResult.meta` when applied or skipped with a non-disabled reason.

- [x] **Step 5: Add CLI compression commands**

Add `compression` command support:

```bash
cc-flux compression
cc-flux compression on
cc-flux compression off
cc-flux compression set --max-messages 32 --keep-recent 12
```

Use `/admin/compression` for reads/writes.

- [x] **Step 6: Run message/CLI tests to verify GREEN**

Run:

```bash
cd proxy && npm test -- test/message-config.test.js test/cli-compression.test.js
```

Expected: PASS.

- [x] **Step 7: Commit message/CLI compression**

```bash
git add proxy/src/handlers/message.js proxy/bin/cc-flux.js proxy/test/message-config.test.js proxy/test/cli-compression.test.js
git commit -m "feat: apply compression and add cli controls"
```

## Task 5: Add TUI Compression Status and Toggle

**Files:**
- Modify: `tui/main.go`
- Modify: `tui/main_test.go`

- [x] **Step 1: Write failing TUI tests**

Add Go tests proving `updateProxyConfig` refreshes status and `toggleCompression` posts to `/admin/compression` with the opposite enabled value.

Use `httptest.NewServer` and set `apiBaseUrl = server.URL`.

- [x] **Step 2: Run TUI tests to verify RED**

Run: `cd tui && GOCACHE=/tmp/go-build-cache go test -count=1 ./...`

Expected: FAIL until status/toggle helpers exist.

- [x] **Step 3: Implement status model and commands**

Add:

```go
type CompressionStatus struct { Enabled bool `json:"enabled"`; MaxMessages int `json:"maxMessages"`; KeepRecent int `json:"keepRecent"` }
type CurrentResponse struct { Config struct { Provider string `json:"provider"`; Model string `json:"model"`; ActiveProviderID string `json:"activeProviderId"`; Compression CompressionStatus `json:"compression"` } `json:"config"` }
```

Add `fetchCurrentStatus()` and `toggleCompression(current bool)` tea commands. On `c`, call toggle. Render compression status and active provider/model.

- [x] **Step 4: Run TUI tests and build**

Run:

```bash
cd tui && GOCACHE=/tmp/go-build-cache go test -count=1 ./...
cd tui && GOCACHE=/tmp/go-build-cache go build -o cc-flux .
```

Expected: both commands exit 0.

- [x] **Step 5: Commit TUI compression controls**

```bash
git add tui/main.go tui/main_test.go
git commit -m "feat: add tui compression controls"
```

## Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`

- [x] **Step 1: Update README**

Document reasoning wrapper behavior, compression env vars, profile compression fields, CLI commands, TUI `c` toggle, and mark Phase 4 complete.

- [x] **Step 2: Verify docs terms**

Run:

```bash
rg -n "reasoning_content|<thinking>|CC_FLUX_COMPRESSION_ENABLED|cc-flux compression|Press `c`|Phase 4" README.md
```

Expected: all terms appear.

- [x] **Step 3: Run full proxy tests**

Run: `cd proxy && npm test`

Expected: all Node tests pass.

- [x] **Step 4: Run full TUI tests and build**

Run:

```bash
cd tui && GOCACHE=/tmp/go-build-cache go test -count=1 ./...
cd tui && GOCACHE=/tmp/go-build-cache go build -o cc-flux .
```

Expected: both commands exit 0.

- [x] **Step 5: Manual Admin/CLI smoke**

Start proxy:

```bash
cd proxy && PORT=18080 CC_FLUX_PROVIDERS_PATH=../tui/providers.json CC_FLUX_STATE_PATH=/tmp/cc-flux-phase4-state.json npm start
```

In another command context:

```bash
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js compression
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js compression on
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js compression set --max-messages 32 --keep-recent 12
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js compression off
```

Expected: commands show compression state changes without exposing API keys.

- [x] **Step 6: Commit docs**

```bash
git add README.md
git commit -m "docs: document phase 4 controls"
```

- [x] **Step 7: Final git status**

Run: `git status --short --branch`

Expected: only pre-existing unrelated local items remain if they were intentionally not part of Phase 4.
