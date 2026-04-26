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
