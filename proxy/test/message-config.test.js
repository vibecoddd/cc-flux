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

test('/v1/messages compresses old converted messages when compression is enabled', async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, 'providers.json');
  const calls = [];
  writeJson(providersPath, [
    {
      id: 'compressed',
      name: 'Compressed',
      provider: 'openai',
      baseUrl: 'https://compressed.example.com/v1',
      apiKey: 'sk-compressed',
      model: 'compressed-model'
    }
  ]);

  const app = loadServer({
    CC_FLUX_PROVIDERS_PATH: providersPath,
    CC_FLUX_STATE_PATH: path.join(dir, 'state.json'),
    CC_FLUX_COMPRESSION_ENABLED: 'true',
    CC_FLUX_COMPRESSION_MAX_MESSAGES: '5',
    CC_FLUX_COMPRESSION_KEEP_RECENT: '2'
  }, calls);

  await app.inject({ method: 'POST', url: '/admin/switch', payload: { id: 'compressed' } });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/messages',
    payload: {
      model: 'claude-sonnet',
      max_tokens: 64,
      stream: true,
      system: 'system',
      messages: [
        { role: 'user', content: 'old user 1' },
        { role: 'assistant', content: 'old assistant 1' },
        { role: 'user', content: 'old user 2' },
        { role: 'assistant', content: 'old assistant 2' },
        { role: 'user', content: 'recent user' },
        { role: 'assistant', content: 'recent assistant' }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].data.messages.length, 4);
  assert.equal(calls[0].data.messages[0].role, 'system');
  assert.equal(calls[0].data.messages[1].content.startsWith('[CC-Flux compressed conversation history]'), true);
  assert.equal(calls[0].data.messages.at(-1).content, 'recent assistant');
});
