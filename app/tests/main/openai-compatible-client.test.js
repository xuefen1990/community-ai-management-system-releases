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

test('client exposes the provider error message when an online request fails', async () => {
  const client = new OpenAiCompatibleClient({ fetchImplementation: async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Authentication Fails' } }),
  }) });

  await assert.rejects(
    client.chat({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'invalid-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '测试' }],
    }),
    /Authentication Fails/u,
  );
});

test('client converts network failures into a user-readable message', async () => {
  const client = new OpenAiCompatibleClient({ fetchImplementation: async () => {
    throw new TypeError('fetch failed');
  } });

  await assert.rejects(
    client.chat({
      baseUrl: 'https://api.example.test',
      apiKey: 'key',
      model: 'model',
      messages: [{ role: 'user', content: '测试' }],
    }),
    /无法连接在线 AI 接口，请检查接口地址和网络/u,
  );
});
