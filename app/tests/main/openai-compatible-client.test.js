'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { OpenAiCompatibleClient } = require('../../src/main/openai-compatible-client');

test('client calls an OpenAI-compatible chat completions endpoint', async () => {
  let request;
  const client = new OpenAiCompatibleClient({ fetchImplementation: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '你好' } }] }) };
  } });
  const result = await client.chat({
    baseUrl: 'https://example.test/v1/', apiKey: 'key', model: 'model-a', messages: [{ role: 'user', content: '测试' }],
  });

  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer key');
  assert.equal(result.content, '你好');
});
