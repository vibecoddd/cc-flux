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
  for (const key of [
    'CC_FLUX_PROVIDERS_PATH',
    'CC_FLUX_STATE_PATH',
    'CC_FLUX_COMPRESSION_ENABLED',
    'CC_FLUX_COMPRESSION_MAX_MESSAGES',
    'CC_FLUX_COMPRESSION_KEEP_RECENT'
  ]) {
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

test('GET /admin/compression returns current compression settings', async () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json'),
    CC_FLUX_COMPRESSION_ENABLED: 'true',
    CC_FLUX_COMPRESSION_MAX_MESSAGES: '22',
    CC_FLUX_COMPRESSION_KEEP_RECENT: '9'
  });

  const response = await app.inject({ method: 'GET', url: '/admin/compression' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().compression, {
    enabled: true,
    maxMessages: 22,
    keepRecent: 9
  });
});

test('POST /admin/compression updates current compression settings', async () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/compression',
    payload: { enabled: true, maxMessages: 20, keepRecent: 8 }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().compression, {
    enabled: true,
    maxMessages: 20,
    keepRecent: 8
  });
});

test('POST /admin/compression rejects invalid compression settings', async () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/compression',
    payload: { maxMessages: 10, keepRecent: 99 }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'invalid_compression_config');
});
