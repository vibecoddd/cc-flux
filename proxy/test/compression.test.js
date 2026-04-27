const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compressMessages,
  normalizeCompressionConfig,
  validateCompressionConfig
} = require('../src/adapter/compression');

test('normalizes compression config with safe defaults', () => {
  assert.deepEqual(normalizeCompressionConfig(), {
    enabled: false,
    maxMessages: 40,
    keepRecent: 16
  });
  assert.deepEqual(normalizeCompressionConfig({
    enabled: 'true',
    maxMessages: '12',
    keepRecent: '4'
  }), {
    enabled: true,
    maxMessages: 12,
    keepRecent: 4
  });
});

test('rejects invalid compression config', () => {
  const result = validateCompressionConfig({ enabled: true, maxMessages: 4, keepRecent: 8 });
  assert.equal(result.valid, false);
  assert.match(result.message, /keepRecent/);
});

test('does not compress when disabled', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' }
  ];
  const result = compressMessages(messages, { enabled: false, maxMessages: 2, keepRecent: 1 });
  assert.equal(result.meta.applied, false);
  assert.equal(result.meta.reason, 'disabled');
  assert.deepEqual(result.messages, messages);
});

test('does not compress below threshold', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' }
  ];
  const result = compressMessages(messages, { enabled: true, maxMessages: 3, keepRecent: 1 });
  assert.equal(result.meta.applied, false);
  assert.equal(result.meta.reason, 'below_threshold');
  assert.deepEqual(result.messages, messages);
});

test('compresses older messages while preserving system and recent messages', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old user 1' },
    { role: 'assistant', content: 'old assistant 1' },
    { role: 'user', content: 'old user 2' },
    { role: 'assistant', content: 'old assistant 2' },
    { role: 'user', content: 'recent user' },
    { role: 'assistant', content: 'recent assistant' }
  ];

  const result = compressMessages(messages, { enabled: true, maxMessages: 4, keepRecent: 2 });

  assert.equal(result.meta.applied, true);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages[1].role, 'user');
  assert.equal(result.messages[1].content.startsWith('[CC-Flux compressed conversation history]'), true);
  assert.deepEqual(result.messages.slice(-2), [
    { role: 'user', content: 'recent user' },
    { role: 'assistant', content: 'recent assistant' }
  ]);
});

test('keeps tool call and tool result groups together in recent messages', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old user' },
    {
      role: 'assistant',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'result' },
    { role: 'user', content: 'latest' }
  ];

  const result = compressMessages(messages, { enabled: true, maxMessages: 3, keepRecent: 2 });

  assert.equal(result.meta.applied, true);
  assert.equal(result.messages.at(-3).role, 'assistant');
  assert.equal(result.messages.at(-2).role, 'tool');
  assert.equal(result.messages.at(-1).content, 'latest');
});

test('removes reasoning_content fields from compressed and preserved messages', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant', reasoning_content: 'old hidden thought' },
    { role: 'user', content: 'recent user' },
    { role: 'assistant', content: 'recent assistant', reasoning_content: 'recent hidden thought' }
  ];

  const result = compressMessages(messages, { enabled: true, maxMessages: 3, keepRecent: 2 });

  assert.equal(result.meta.applied, true);
  assert.equal(JSON.stringify(result.messages).includes('reasoning_content'), false);
  assert.equal(JSON.stringify(result.messages).includes('hidden thought'), false);
});
