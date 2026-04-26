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
