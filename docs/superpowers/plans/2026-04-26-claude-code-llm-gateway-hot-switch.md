# Claude Code LLM Gateway Hot Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restart-stable profile-based hot switching for Claude Code running through CC-Flux as an `ANTHROPIC_BASE_URL` LLM Gateway.

**Architecture:** The proxy owns runtime configuration through one config facade backed by provider profiles and a small state file containing only `activeProviderId`. TUI and CLI switch models by calling the same Admin API, while `/v1/messages` captures the active provider config once at request start.

**Tech Stack:** Node.js 18+, Fastify, axios, Node built-in `node:test`, Go Bubble Tea TUI.

---

## File Structure

- Create `proxy/src/config/profile-store.js`: profile path resolution, JSON loading, profile validation, state loading/saving, redaction helpers.
- Modify `proxy/src/config.js`: runtime config facade with `get`, `getPublic`, `listProfiles`, `switchProfile`, legacy `update`, and `_reloadForTests`.
- Create `proxy/src/admin.js`: Fastify Admin API route registration for profiles, current config, and switching.
- Modify `proxy/src/server.js`: create a testable Fastify app factory, register Admin API, preserve `/config`, and auto-start when run directly.
- Modify `proxy/src/handlers/message.js`: capture current config once per request and add provider/model context to upstream failure logs.
- Modify `proxy/package.json`: replace the current failing test script with `node --test`.
- Create `proxy/test/config.test.js`: config and state behavior tests.
- Create `proxy/test/admin.test.js`: Admin API behavior tests.
- Create `proxy/test/message-config.test.js`: request-start config capture test.
- Modify `proxy/bin/cc-flux.js`: add `profiles`, `current`, and `switch <profile-id>` CLI commands.
- Modify `tui/main.go`: switch by profile id through `POST /admin/switch` instead of posting full secrets to legacy `/config`.
- Modify `README.md`: document LLM Gateway mode, hot switching, state persistence, and the explicit non-goal for `HTTPS_PROXY` interception.

## Task 1: Add Proxy Test Harness

**Files:**
- Modify: `proxy/package.json`
- Create: `proxy/test/config.test.js`

- [ ] **Step 1: Write the first failing config test**

Create `proxy/test/config.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flux-config-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadFreshConfig(env) {
  for (const key of [
    'CC_FLUX_PROVIDERS_PATH',
    'CC_FLUX_STATE_PATH',
    'TARGET_PROVIDER',
    'TARGET_BASE_URL',
    'TARGET_API_KEY',
    'TARGET_MODEL',
    'RETRY_ENABLED'
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/config/profile-store')];
  return require('../src/config');
}

test('restores active profile from state file', () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const statePath = path.join(dir, 'state.json');

  writeJson(providersPath, [
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek - Reasoner (R1)',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-reasoner',
      retryEnabled: true
    }
  ]);
  writeJson(statePath, { activeProviderId: 'deepseek-reasoner' });

  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: statePath,
    TARGET_PROVIDER: 'openai',
    TARGET_BASE_URL: 'https://api.openai.com/v1',
    TARGET_MODEL: 'gpt-4o'
  });

  assert.deepEqual(config.get(), {
    port: 8080,
    targetProvider: 'deepseek',
    targetBaseUrl: 'https://api.deepseek.com',
    targetApiKey: 'sk-test',
    targetModel: 'deepseek-reasoner',
    retryEnabled: true,
    maxRetries: 2,
    socketPath: '',
    activeProviderId: 'deepseek-reasoner'
  });
});
```

- [ ] **Step 2: Enable Node tests**

Change `proxy/package.json` script:

```json
"test": "node --test"
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
cd proxy && npm test -- test/config.test.js
```

Expected: FAIL with an error that `../src/config/profile-store` cannot be found.

- [ ] **Step 4: Commit the failing test harness**

```bash
git add proxy/package.json proxy/test/config.test.js
git commit -m "test: add config hot switch coverage"
```

## Task 2: Implement Profile Store and Runtime Config

**Files:**
- Create: `proxy/src/config/profile-store.js`
- Modify: `proxy/src/config.js`
- Test: `proxy/test/config.test.js`

- [ ] **Step 1: Add complete profile-store implementation**

Create `proxy/src/config/profile-store.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function resolveProvidersPath(cwd = process.cwd()) {
  if (process.env.CC_FLUX_PROVIDERS_PATH) {
    return process.env.CC_FLUX_PROVIDERS_PATH;
  }

  return firstExisting([
    path.resolve(cwd, 'tui', 'providers.json'),
    path.resolve(cwd, '..', 'tui', 'providers.json'),
    path.resolve(cwd, 'providers.json'),
    homePath('.cc-flux', 'providers.json')
  ]);
}

function resolveStatePath() {
  return process.env.CC_FLUX_STATE_PATH || homePath('.cc-flux', 'state.json');
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { value: fallback, error: null };
  }

  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { value: fallback, error };
  }
}

function loadProfiles() {
  const providersPath = resolveProvidersPath();
  const result = readJson(providersPath, []);
  const profiles = Array.isArray(result.value) ? result.value : [];
  return { profiles, providersPath, error: result.error };
}

function loadState(statePath = resolveStatePath()) {
  const result = readJson(statePath, {});
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  return { state: value, statePath, error: result.error };
}

function saveState(activeProviderId, statePath = resolveStatePath()) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ activeProviderId }, null, 2) + '\n');
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return { valid: false, message: 'Profile must be an object.' };
  }
  if (!profile.id || typeof profile.id !== 'string') {
    return { valid: false, message: 'Profile id is required.' };
  }
  if (!profile.provider || typeof profile.provider !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing provider.` };
  }
  if (!profile.baseUrl || typeof profile.baseUrl !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing baseUrl.` };
  }
  if (!profile.model || typeof profile.model !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing model.` };
  }
  return { valid: true, message: '' };
}

function profileToRuntime(profile, baseState) {
  return {
    ...baseState,
    targetProvider: profile.provider,
    targetBaseUrl: profile.baseUrl,
    targetApiKey: profile.apiKey || '',
    targetModel: profile.model,
    retryEnabled: profile.retryEnabled !== undefined ? Boolean(profile.retryEnabled) : baseState.retryEnabled,
    activeProviderId: profile.id
  };
}

function redactRuntimeConfig(config) {
  return {
    provider: config.targetProvider,
    baseUrl: config.targetBaseUrl,
    model: config.targetModel,
    retryEnabled: config.retryEnabled,
    socketPath: config.socketPath,
    activeProviderId: config.activeProviderId || null,
    apiKeyConfigured: Boolean(config.targetApiKey)
  };
}

function redactProfile(profile) {
  return {
    id: profile.id,
    name: profile.name || profile.id,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    retryEnabled: Boolean(profile.retryEnabled),
    apiKeyConfigured: Boolean(profile.apiKey)
  };
}

function createConfigError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  createConfigError,
  loadProfiles,
  loadState,
  profileToRuntime,
  redactProfile,
  redactRuntimeConfig,
  resolveProvidersPath,
  resolveStatePath,
  saveState,
  validateProfile
};
```

- [ ] **Step 2: Replace runtime config facade**

Replace `proxy/src/config.js` with:

```js
require('dotenv').config();

const store = require('./config/profile-store');

function envBool(value) {
  return value === 'true';
}

function baseStateFromEnv() {
  return {
    port: Number(process.env.PORT || 8080),
    targetProvider: process.env.TARGET_PROVIDER || 'openai',
    targetBaseUrl: process.env.TARGET_BASE_URL || 'https://api.openai.com/v1',
    targetApiKey: process.env.TARGET_API_KEY || '',
    targetModel: process.env.TARGET_MODEL || '',
    retryEnabled: envBool(process.env.RETRY_ENABLED),
    maxRetries: 2,
    socketPath: process.env.SOCKET_PATH || '',
    activeProviderId: null
  };
}

let profiles = [];
let providersPath = '';
let providersError = null;
let statePath = '';
let stateError = null;
let runtimeState = baseStateFromEnv();

function findProfile(id) {
  return profiles.find((profile) => profile.id === id);
}

function applyInitialState() {
  runtimeState = baseStateFromEnv();

  const loadedProfiles = store.loadProfiles();
  profiles = loadedProfiles.profiles;
  providersPath = loadedProfiles.providersPath;
  providersError = loadedProfiles.error;

  const loadedState = store.loadState();
  statePath = loadedState.statePath;
  stateError = loadedState.error;

  const activeProviderId = loadedState.state.activeProviderId;
  const activeProfile = activeProviderId ? findProfile(activeProviderId) : null;
  if (!activeProfile) return;

  const validation = store.validateProfile(activeProfile);
  if (validation.valid) {
    runtimeState = store.profileToRuntime(activeProfile, runtimeState);
  }
}

function get() {
  return { ...runtimeState };
}

function getPublic() {
  return store.redactRuntimeConfig(runtimeState);
}

function getMeta() {
  return {
    providersPath,
    statePath,
    providersError: providersError ? providersError.message : null,
    stateError: stateError ? stateError.message : null
  };
}

function listProfiles() {
  return profiles.map(store.redactProfile);
}

function switchProfile(id) {
  const profile = findProfile(id);
  if (!profile) {
    throw store.createConfigError(404, 'profile_not_found', `Profile '${id}' was not found.`);
  }

  const validation = store.validateProfile(profile);
  if (!validation.valid) {
    throw store.createConfigError(400, 'invalid_profile', validation.message);
  }

  runtimeState = store.profileToRuntime(profile, runtimeState);
  const persisted = store.saveState(id, statePath || store.resolveStatePath());
  return {
    config: getPublic(),
    statePersisted: persisted.ok,
    warning: persisted.error ? persisted.error.message : null
  };
}

function update(updates) {
  if (updates.targetProvider) runtimeState.targetProvider = updates.targetProvider;
  if (updates.targetBaseUrl) runtimeState.targetBaseUrl = updates.targetBaseUrl;
  if (updates.targetApiKey) runtimeState.targetApiKey = updates.targetApiKey;
  if (updates.targetModel) runtimeState.targetModel = updates.targetModel;
  if (updates.retryEnabled !== undefined) runtimeState.retryEnabled = Boolean(updates.retryEnabled);
  if (updates.socketPath !== undefined) runtimeState.socketPath = updates.socketPath;
  runtimeState.activeProviderId = null;
  console.log('[Config] Updated:', getPublic());
  return get();
}

applyInitialState();

module.exports = {
  get,
  getMeta,
  getPublic,
  listProfiles,
  switchProfile,
  update,
  _reloadForTests: applyInitialState
};
```

- [ ] **Step 3: Expand config tests for fallback, switching, validation, and redaction**

Append to `proxy/test/config.test.js`:

```js
test('falls back to env config when state id is missing from profiles', () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const statePath = path.join(dir, 'state.json');
  writeJson(providersPath, []);
  writeJson(statePath, { activeProviderId: 'missing' });

  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: statePath,
    TARGET_PROVIDER: 'openai',
    TARGET_BASE_URL: 'https://api.openai.com/v1',
    TARGET_API_KEY: 'sk-env',
    TARGET_MODEL: 'gpt-4o'
  });

  assert.equal(config.get().targetProvider, 'openai');
  assert.equal(config.get().targetModel, 'gpt-4o');
  assert.equal(config.get().activeProviderId, null);
});

test('switchProfile updates runtime config and persists activeProviderId', () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const statePath = path.join(dir, 'state.json');
  writeJson(providersPath, [
    {
      id: 'ollama-local',
      name: 'Local - Ollama',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3'
    }
  ]);

  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: statePath
  });

  const result = config.switchProfile('ollama-local');
  assert.equal(result.statePersisted, true);
  assert.equal(config.get().targetProvider, 'ollama');
  assert.equal(config.get().targetModel, 'llama3');
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), {
    activeProviderId: 'ollama-local'
  });
});

test('switchProfile rejects unknown profile id', () => {
  const dir = tempDir();
  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  assert.throws(
    () => config.switchProfile('missing'),
    (error) => error.statusCode === 404 && error.code === 'profile_not_found'
  );
});

test('switchProfile rejects invalid profile without model', () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  writeJson(providersPath, [
    {
      id: 'broken',
      name: 'Broken',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1'
    }
  ]);

  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  assert.throws(
    () => config.switchProfile('broken'),
    (error) => error.statusCode === 400 && error.code === 'invalid_profile'
  );
});

test('public config and profile list redact API keys', () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  writeJson(providersPath, [
    {
      id: 'openai-gpt4o',
      name: 'OpenAI - GPT-4o',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4o'
    }
  ]);

  const config = loadFreshConfig({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  config.switchProfile('openai-gpt4o');
  assert.equal(config.getPublic().apiKeyConfigured, true);
  assert.equal('targetApiKey' in config.getPublic(), false);
  assert.equal(config.listProfiles()[0].apiKeyConfigured, true);
  assert.equal('apiKey' in config.listProfiles()[0], false);
});
```

- [ ] **Step 4: Run config tests**

Run:

```bash
cd proxy && npm test -- test/config.test.js
```

Expected: PASS for all tests in `config.test.js`.

- [ ] **Step 5: Commit config implementation**

```bash
git add proxy/src/config.js proxy/src/config/profile-store.js proxy/test/config.test.js
git commit -m "feat: add profile-backed runtime config"
```

## Task 3: Add Admin API and Testable Server Factory

**Files:**
- Create: `proxy/src/admin.js`
- Modify: `proxy/src/server.js`
- Create: `proxy/test/admin.test.js`

- [ ] **Step 1: Write Admin API tests first**

Create `proxy/test/admin.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flux-admin-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadServer(env) {
  for (const key of ['CC_FLUX_PROVIDERS_PATH', 'CC_FLUX_STATE_PATH']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/admin')];
  delete require.cache[require.resolve('../src/server')];
  return require('../src/server').buildServer({ logger: false });
}

test('GET /admin/profiles returns redacted profiles', async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  writeJson(providersPath, [
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek - Reasoner (R1)',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      model: 'deepseek-reasoner'
    }
  ]);

  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  const response = await app.inject({ method: 'GET', url: '/admin/profiles' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.profiles[0].id, 'deepseek-reasoner');
  assert.equal(body.profiles[0].apiKeyConfigured, true);
  assert.equal('apiKey' in body.profiles[0], false);
});

test('POST /admin/switch activates a profile and persists state', async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const statePath = path.join(dir, 'state.json');
  writeJson(providersPath, [
    {
      id: 'ollama-local',
      name: 'Local - Ollama',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3'
    }
  ]);

  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: statePath
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/switch',
    payload: { id: 'ollama-local' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'switched');
  assert.equal(response.json().config.activeProviderId, 'ollama-local');
  assert.equal(response.json().statePersisted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), {
    activeProviderId: 'ollama-local'
  });
});

test('POST /admin/switch reports unknown profile id', async () => {
  const dir = tempDir();
  writeJson(path.join(dir, 'providers.json'), []);
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/switch',
    payload: { id: 'missing' }
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'profile_not_found');
});

test('legacy POST /config still updates runtime config', async () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  const response = await app.inject({
    method: 'POST',
    url: '/config',
    payload: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-legacy',
      model: 'example-model',
      retryEnabled: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().config.model, 'example-model');
  assert.equal(response.json().config.apiKeyConfigured, true);
  assert.equal('targetApiKey' in response.json().config, false);
});
```

- [ ] **Step 2: Run Admin API tests and verify failure**

Run:

```bash
cd proxy && npm test -- test/admin.test.js
```

Expected: FAIL with `buildServer is not a function` or missing `/admin/profiles`.

- [ ] **Step 3: Add Admin API route module**

Create `proxy/src/admin.js`:

```js
const config = require('./config');

function sendConfigError(reply, error) {
  const statusCode = error.statusCode || 500;
  return reply.code(statusCode).send({
    error: {
      code: error.code || 'admin_error',
      message: error.message
    }
  });
}

function registerAdminRoutes(fastify) {
  fastify.get('/admin/profiles', async () => {
    return {
      profiles: config.listProfiles(),
      meta: config.getMeta()
    };
  });

  fastify.get('/admin/current', async () => {
    return {
      config: config.getPublic(),
      meta: config.getMeta()
    };
  });

  fastify.post('/admin/switch', async (request, reply) => {
    const body = request.body || {};
    if (!body.id || typeof body.id !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'missing_profile_id',
          message: 'Request body must include string field id.'
        }
      });
    }

    try {
      const result = config.switchProfile(body.id);
      return {
        status: 'switched',
        ...result
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });
}

module.exports = registerAdminRoutes;
```

- [ ] **Step 4: Refactor server into app factory and register Admin API**

Replace `proxy/src/server.js` with:

```js
const createFastify = require('fastify');
const config = require('./config');
const registerAdminRoutes = require('./admin');
const messageHandler = require('./handlers/message');

function buildServer(options = {}) {
  const fastify = createFastify({ logger: options.logger !== undefined ? options.logger : true });

  fastify.get('/', async () => {
    const cfg = config.get();
    return {
      status: 'CC-Flux Proxy is running',
      current_config: config.getPublic(),
      port: cfg.port
    };
  });

  registerAdminRoutes(fastify);

  fastify.post('/config', async (request, reply) => {
    const body = request.body;
    if (!body) return reply.code(400).send({ error: 'Missing body' });

    config.update({
      targetProvider: body.provider,
      targetBaseUrl: body.baseUrl,
      targetApiKey: body.apiKey,
      targetModel: body.model,
      retryEnabled: body.retryEnabled
    });

    return { status: 'updated', config: config.getPublic() };
  });

  fastify.post('/v1/messages', messageHandler);

  return fastify;
}

const start = async () => {
  const fastify = buildServer();

  try {
    const cfg = config.get();

    if (cfg.socketPath) {
      await fastify.listen({ path: cfg.socketPath });
      console.log(`CC-Flux Proxy listening on IPC path: ${cfg.socketPath}`);
    } else {
      await fastify.listen({ port: cfg.port, host: '0.0.0.0' });
      console.log(`CC-Flux Proxy listening on ${fastify.server.address().port}`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

module.exports = { buildServer, start };
```

- [ ] **Step 5: Run Admin API tests**

Run:

```bash
cd proxy && npm test -- test/admin.test.js
```

Expected: PASS for all tests in `admin.test.js`.

- [ ] **Step 6: Run config tests again**

Run:

```bash
cd proxy && npm test -- test/config.test.js
```

Expected: PASS for all tests in `config.test.js`.

- [ ] **Step 7: Commit Admin API**

```bash
git add proxy/src/admin.js proxy/src/server.js proxy/test/admin.test.js
git commit -m "feat: add hot switch admin api"
```

## Task 4: Verify Message Requests Capture Config Once

**Files:**
- Modify: `proxy/src/handlers/message.js`
- Create: `proxy/test/message-config.test.js`

- [ ] **Step 1: Write request-start config capture test**

Create `proxy/test/message-config.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flux-message-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function installAxiosMock(calls) {
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: async (options) => {
      calls.push(options);
      return {
        data: Readable.from([
          'data: {"model":"mock","choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
          'data: {"model":"mock","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  };
}

function loadServer(env, calls) {
  for (const key of ['CC_FLUX_PROVIDERS_PATH', 'CC_FLUX_STATE_PATH']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  installAxiosMock(calls);
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/admin')];
  delete require.cache[require.resolve('../src/handlers/message')];
  delete require.cache[require.resolve('../src/server')];
  return require('../src/server').buildServer({ logger: false });
}

test('/v1/messages uses active config selected before request starts', async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const calls = [];
  writeJson(providersPath, [
    {
      id: 'first',
      name: 'First',
      provider: 'openai',
      baseUrl: 'https://first.example.com/v1',
      apiKey: 'sk-first',
      model: 'first-model'
    },
    {
      id: 'second',
      name: 'Second',
      provider: 'openai',
      baseUrl: 'https://second.example.com/v1',
      apiKey: 'sk-second',
      model: 'second-model'
    }
  ]);

  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  }, calls);

  await app.inject({ method: 'POST', url: '/admin/switch', payload: { id: 'first' } });
  const firstResponse = await app.inject({
    method: 'POST',
    url: '/v1/messages',
    payload: {
      model: 'claude-sonnet',
      max_tokens: 64,
      stream: true,
      system: '',
      messages: [{ role: 'user', content: 'hello' }]
    }
  });
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(calls[0].url, 'https://first.example.com/v1/chat/completions');
  assert.equal(calls[0].data.model, 'first-model');

  await app.inject({ method: 'POST', url: '/admin/switch', payload: { id: 'second' } });
  const secondResponse = await app.inject({
    method: 'POST',
    url: '/v1/messages',
    payload: {
      model: 'claude-sonnet',
      max_tokens: 64,
      stream: true,
      system: '',
      messages: [{ role: 'user', content: 'hello again' }]
    }
  });
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(calls[1].url, 'https://second.example.com/v1/chat/completions');
  assert.equal(calls[1].data.model, 'second-model');
});
```

- [ ] **Step 2: Run message config test**

Run:

```bash
cd proxy && npm test -- test/message-config.test.js
```

Expected: PASS if Task 3 wiring is correct. If it fails because the response stream emits duplicate `message_stop`, keep this task focused on request routing and fix only the minimum needed in `response.js` if the test cannot complete.

- [ ] **Step 3: Add provider/model context to upstream error logging**

In `proxy/src/handlers/message.js`, replace:

```js
request.log.error(err, 'Upstream request failed');
```

with:

```js
request.log.error({
  err,
  provider: cfg.targetProvider,
  model: cfg.targetModel,
  baseUrl: cfg.targetBaseUrl
}, 'Upstream request failed');
```

- [ ] **Step 4: Run all proxy tests**

Run:

```bash
cd proxy && npm test
```

Expected: PASS for `config.test.js`, `admin.test.js`, and `message-config.test.js`.

- [ ] **Step 5: Commit message routing verification**

```bash
git add proxy/src/handlers/message.js proxy/test/message-config.test.js
git commit -m "test: verify message requests use active profile"
```

## Task 5: Add CLI Profile Commands

**Files:**
- Modify: `proxy/bin/cc-flux.js`

- [ ] **Step 1: Update help text**

In `printHelp()` inside `proxy/bin/cc-flux.js`, add these command lines:

```text
  profiles        List configured provider profiles
  current         Show active proxy configuration
  switch <id>     Hot-switch the running proxy to a profile
```

Add this environment line:

```text
  CC_FLUX_ADMIN_URL, CC_FLUX_PROVIDERS_PATH, CC_FLUX_STATE_PATH
```

- [ ] **Step 2: Add Admin API helper functions**

Add these functions after `parseArgs(args)`:

```js
function getAdminBaseUrl() {
  const fileConfig = loadConfig();
  const port = process.env.CC_FLUX_PORT || fileConfig.PORT || process.env.PORT || DEFAULT_PORT;
  return process.env.CC_FLUX_ADMIN_URL || `http://localhost:${port}`;
}

async function adminRequest(pathname, options = {}) {
  const url = getAdminBaseUrl() + pathname;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body.error && body.error.message ? body.error.message : response.statusText;
    const error = new Error(message);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function printProfileTable(profiles) {
  if (!profiles.length) {
    console.log('No provider profiles found.');
    return;
  }

  for (const profile of profiles) {
    const keyStatus = profile.apiKeyConfigured ? 'key configured' : 'no key';
    console.log(`${profile.id}\t${profile.name}\t${profile.provider}\t${profile.model}\t${keyStatus}`);
  }
}

async function listProfiles() {
  const body = await adminRequest('/admin/profiles');
  printProfileTable(body.profiles || []);
}

async function showCurrent() {
  const body = await adminRequest('/admin/current');
  const cfg = body.config;
  console.log(`Provider: ${cfg.provider}`);
  console.log(`Model: ${cfg.model || '(not set)'}`);
  console.log(`Base URL: ${cfg.baseUrl}`);
  console.log(`Retry enabled: ${cfg.retryEnabled}`);
  console.log(`Active profile: ${cfg.activeProviderId || '(runtime config)'}`);
  console.log(`API key: ${cfg.apiKeyConfigured ? 'configured' : 'not set'}`);
}

async function switchProfile(id) {
  if (!id) {
    console.error('Usage: cc-flux switch <profile-id>');
    process.exit(1);
  }

  const body = await adminRequest('/admin/switch', {
    method: 'POST',
    body: { id }
  });

  const cfg = body.config;
  console.log(`Switched to ${cfg.activeProviderId || id}: ${cfg.provider}/${cfg.model}`);
  if (!body.statePersisted) {
    console.log(`Warning: active profile was not persisted: ${body.warning}`);
  }
}

function runAsync(fn) {
  fn().catch((error) => {
    const prefix = error.statusCode ? `HTTP ${error.statusCode}` : 'Error';
    console.error(`${prefix}: ${error.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Wire CLI switch cases**

In the final `switch (command)` block, add cases before `config`:

```js
  case 'profiles':
    runAsync(listProfiles);
    break;

  case 'current':
    runAsync(showCurrent);
    break;

  case 'switch':
    runAsync(() => switchProfile(args[1]));
    break;
```

- [ ] **Step 4: Manual CLI smoke test against local proxy**

Run terminal 1:

```bash
cd proxy && CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start
```

Run terminal 2:

```bash
node proxy/bin/cc-flux.js profiles
node proxy/bin/cc-flux.js current
node proxy/bin/cc-flux.js switch deepseek-reasoner
node proxy/bin/cc-flux.js current
```

Expected:

- `profiles` lists ids from `tui/providers.json`.
- first `current` prints the runtime config.
- `switch deepseek-reasoner` prints `Switched to deepseek-reasoner`.
- second `current` prints `Active profile: deepseek-reasoner`.

- [ ] **Step 5: Commit CLI commands**

```bash
git add proxy/bin/cc-flux.js
git commit -m "feat: add profile switch cli commands"
```

## Task 6: Move TUI Switching to Admin API

**Files:**
- Modify: `tui/main.go`

- [ ] **Step 1: Add retry field and switch payload types**

In `tui/main.go`, replace the `Provider` and `ConfigPayload` structs with:

```go
type Provider struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	Model        string `json:"model"`
	RetryEnabled bool   `json:"retryEnabled"`
}

type SwitchPayload struct {
	ID string `json:"id"`
}
```

- [ ] **Step 2: Switch by id instead of sending full provider secrets**

In `updateProxyConfig(p Provider)`, replace the payload construction:

```go
payload := ConfigPayload{
	Provider: p.Provider,
	BaseURL:  p.BaseURL,
	APIKey:   p.APIKey,
	Model:    p.Model,
}
```

with:

```go
payload := SwitchPayload{
	ID: p.ID,
}
```

Replace the post URL:

```go
resp, err := http.Post(apiBaseUrl + "/config", "application/json", bytes.NewBuffer(jsonData))
```

with:

```go
resp, err := http.Post(apiBaseUrl + "/admin/switch", "application/json", bytes.NewBuffer(jsonData))
```

- [ ] **Step 3: Improve non-200 error text**

Replace:

```go
if resp.StatusCode != 200 {
	return errMsg(fmt.Errorf("proxy returned status: %s", resp.Status))
}
```

with:

```go
if resp.StatusCode != 200 {
	body, _ := ioutil.ReadAll(resp.Body)
	return errMsg(fmt.Errorf("proxy returned status: %s %s", resp.Status, strings.TrimSpace(string(body))))
}
```

- [ ] **Step 4: Build the TUI**

Run:

```bash
cd tui && go build -o cc-flux .
```

Expected: command exits with status 0 and writes `tui/cc-flux`.

- [ ] **Step 5: Manual TUI smoke test**

Run terminal 1:

```bash
cd proxy && CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start
```

Run terminal 2:

```bash
cd tui && ./cc-flux
```

Expected:

- Pressing Enter on a profile shows `Successfully switched to <profile name>`.
- `node proxy/bin/cc-flux.js current` shows the same active profile id after the TUI switch.

- [ ] **Step 6: Commit TUI Admin API migration**

```bash
git add tui/main.go
git commit -m "feat: switch tui through admin api"
```

## Task 7: Update Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Claude Code connection section**

Replace the current “Step 2: Connect Claude Code” section with:

````markdown
### Step 2: Connect Claude Code

CC-Flux is an LLM Gateway for Claude Code. Point Claude Code at the local gateway:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Some Claude Code versions also recognize `CLAUDE_BASE_URL`; use `/status` inside Claude Code to verify which base URL is active.

CC-Flux does not intercept encrypted Claude Code traffic through `HTTPS_PROXY`. A plain HTTPS proxy can only tunnel encrypted traffic and cannot translate Anthropic request bodies to other providers without local TLS inspection.
````

- [ ] **Step 2: Add hot-switch CLI section**

Add this under “Common Operations” before “Switching Models”:

````markdown
### 1. Hot-Switching With CLI

List profiles:

```bash
cc-flux profiles
```

Show the active runtime config:

```bash
cc-flux current
```

Switch to a profile:

```bash
cc-flux switch deepseek-reasoner
```

The switch applies to the next Claude Code model request. Active streaming responses continue with the provider they started with.
````

- [ ] **Step 3: Add state persistence notes**

Add this under “Adding New Model Providers”:

````markdown
CC-Flux stores only the active profile id in `~/.cc-flux/state.json` by default. Provider definitions and API keys remain in `providers.json` or your environment. Override paths with:

```bash
export CC_FLUX_PROVIDERS_PATH=/path/to/providers.json
export CC_FLUX_STATE_PATH=/path/to/state.json
```
````

- [ ] **Step 4: Verify docs mention the new commands**

Run:

```bash
rg -n "cc-flux profiles|cc-flux current|cc-flux switch|HTTPS_PROXY|ANTHROPIC_BASE_URL" README.md
```

Expected: output includes all five terms.

- [ ] **Step 5: Commit docs**

```bash
git add README.md
git commit -m "docs: document gateway hot switching"
```

## Task 8: Final Verification

**Files:**
- Review: all changed files from Tasks 1-7

- [ ] **Step 1: Run proxy tests**

Run:

```bash
cd proxy && npm test
```

Expected: all Node tests pass.

- [ ] **Step 2: Build TUI**

Run:

```bash
cd tui && go build -o cc-flux .
```

Expected: command exits with status 0.

- [ ] **Step 3: Start proxy with project providers**

Run:

```bash
cd proxy && CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start
```

Expected: proxy logs `CC-Flux Proxy listening on 8080`.

- [ ] **Step 4: Verify Admin API manually**

Run in another terminal:

```bash
curl -fsS http://localhost:8080/admin/profiles
curl -fsS http://localhost:8080/admin/current
curl -fsS -X POST http://localhost:8080/admin/switch \
  -H 'Content-Type: application/json' \
  -d '{"id":"deepseek-reasoner"}'
curl -fsS http://localhost:8080/admin/current
```

Expected:

- `/admin/profiles` returns profile ids without API key values.
- `/admin/current` returns `apiKeyConfigured`, not an API key.
- `/admin/switch` returns `status: "switched"` and `statePersisted: true`.
- final `/admin/current` returns `activeProviderId: "deepseek-reasoner"`.

- [ ] **Step 5: Verify Claude Code setup command remains clear**

Run:

```bash
rg -n "export ANTHROPIC_BASE_URL=http://localhost:8080" README.md
```

Expected: command appears in README.

- [ ] **Step 6: Check git status before handoff**

Run:

```bash
git status --short
```

Expected: only intentional changes from the implementation branch are present. Pre-existing unrelated changes such as `proxy/src/adapter/response.js` or `.codex` must not be reverted unless the user explicitly asks.
