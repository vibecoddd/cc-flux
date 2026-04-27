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
