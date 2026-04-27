const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatCompressionStatus,
  parseCompressionCommand
} = require('../src/cli/compression-command');

test('parseCompressionCommand reads current settings by default', () => {
  assert.deepEqual(parseCompressionCommand(['compression']), {
    method: 'GET',
    pathname: '/admin/compression',
    body: undefined
  });
});

test('parseCompressionCommand toggles compression on and off', () => {
  assert.deepEqual(parseCompressionCommand(['compression', 'on']), {
    method: 'POST',
    pathname: '/admin/compression',
    body: { enabled: true }
  });
  assert.deepEqual(parseCompressionCommand(['compression', 'off']), {
    method: 'POST',
    pathname: '/admin/compression',
    body: { enabled: false }
  });
});

test('parseCompressionCommand parses threshold settings', () => {
  assert.deepEqual(parseCompressionCommand([
    'compression',
    'set',
    '--max-messages',
    '32',
    '--keep-recent',
    '12'
  ]), {
    method: 'POST',
    pathname: '/admin/compression',
    body: { maxMessages: 32, keepRecent: 12 }
  });
});

test('formatCompressionStatus prints current settings', () => {
  const output = formatCompressionStatus({ enabled: true, maxMessages: 32, keepRecent: 12 });
  assert.match(output, /Compression: enabled/);
  assert.match(output, /Max messages: 32/);
  assert.match(output, /Keep recent: 12/);
});
