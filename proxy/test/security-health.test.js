const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flux-security-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadServer(env) {
  for (const key of [
    'CC_FLUX_PROVIDERS_PATH',
    'CC_FLUX_STATE_PATH',
    'CC_FLUX_ADMIN_TOKEN',
    'HOST'
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  for (const modulePath of [
    '../src/config',
    '../src/admin',
    '../src/metrics',
    '../src/server'
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
  return require('../src/server').buildServer({ logger: false });
}

test('config defaults TCP host to localhost', () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });
  const config = require('../src/config');
  assert.equal(config.get().host, '127.0.0.1');
  assert.ok(app);
});

test('admin token protects admin routes and legacy config route', async () => {
  const dir = tempDir();
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: path.join(dir, 'providers.json'),
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json'),
    CC_FLUX_ADMIN_TOKEN: 'secret'
  });

  const unauthenticated = await app.inject({ method: 'GET', url: '/admin/current' });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.json().error.code, 'admin_auth_required');

  const legacy = await app.inject({ method: 'POST', url: '/config', payload: {} });
  assert.equal(legacy.statusCode, 401);

  const authenticated = await app.inject({
    method: 'GET',
    url: '/admin/current',
    headers: { authorization: 'Bearer secret' }
  });
  assert.equal(authenticated.statusCode, 200);
});

test('admin health returns redacted runtime status and profile count', async () => {
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

  const response = await app.inject({ method: 'GET', url: '/admin/health' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.profileCount, 1);
  assert.equal(body.config.apiKeyConfigured, false);
  assert.equal('targetApiKey' in body.config, false);
});

test('metrics endpoint tracks profile switches', async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  writeJson(providersPath, [
    {
      id: 'openai-gpt4o',
      name: 'OpenAI - GPT-4o',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
  ]);
  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json')
  });

  await app.inject({ method: 'POST', url: '/admin/switch', payload: { id: 'openai-gpt4o' } });
  const response = await app.inject({ method: 'GET', url: '/admin/metrics' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().metrics.profileSwitches, 1);
});
