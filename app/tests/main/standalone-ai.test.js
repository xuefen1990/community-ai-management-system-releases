'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AiRouter } = require('../../src/main/ai-router');

test('自用在线模型只校验本机权限，单次调用服务商，不创建或结算平台积分任务', async () => {
  const routes = [], calls = [];
  const authService = { mode: 'standalone', session: { user: {} }, request: async route => { routes.push(route); assert.equal(route, '/auth/profile'); return { user: { role: 'main_account' } }; } };
  const router = new AiRouter({ authService, settingsStore: { readRaw: async () => ({ mode: 'online' }), getOnlineCredentials: async () => ({ baseUrl: 'https://provider.invalid/v1', apiKey: 'test-only-key', model: 'fixture-model' }) }, onlineClient: { chat: async input => { calls.push(input); return { content: '拟写完成', model: input.model, usage: { total_tokens: 45 } }; } } });
  const result = await router.withBillingTask({}, () => router.chat({ messages: [{ role: 'user', content: '测试拟写' }] }));
  assert.equal(result.content, '拟写完成'); assert.equal(result.routing.billingUnit, 'provider'); assert.equal(result.usage.total_tokens, 45);
  assert.equal(calls.length, 1); assert.equal(routes.length, 1); assert.equal(calls[0].baseUrl, 'https://provider.invalid/v1');
  router.onlineClient.chat = async () => { calls.push('failed'); throw new Error('provider failed'); };
  await assert.rejects(router.onlineChat([{ role: 'user', content: '第二次' }]), /provider failed/); assert.equal(calls.length, 2);
});
test('本机模式仍拒绝未登录及被停用 AI 的成员', async () => {
  const authService = { mode: 'standalone', session: null, request: async () => ({ user: { role: 'member', aiAccessEnabled: false } }) };
  const router = new AiRouter({ authService, settingsStore: {} });
  await assert.rejects(router.chat({ messages: [] }), /请先登录/);
  authService.session = { user: {} }; await assert.rejects(router.chat({ messages: [] }), /未授权/);
});
test('成员电脑不读取本机模型或密钥，使用主电脑选定的 AI 服务', async () => {
  const calls = [];
  const hostClient = { config: async () => ({ ownerId: 'owner' }), chat: async (messages, options) => { calls.push({ messages, options }); return { content: '主电脑生成结果' }; }, capabilities: async () => ({ supportsVision: true }) };
  const authService = { mode: 'standalone', hostClient, session: { token: 'member-token' }, request: async () => ({ user: { role: 'member', aiAccessEnabled: true } }) };
  const router = new AiRouter({ authService, settingsStore: { readRaw: async () => ({ mode: 'local' }), getOnlineCredentials: () => { throw Error('child must not read keys'); } }, localRuntime: { chat: () => { throw Error('child must not run own model'); } } });
  assert.equal((await router.chat({ messages: [{ role: 'user', content: '测试' }] })).content, '主电脑生成结果');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.token, 'member-token');
  assert.equal(calls[0].options.hostMode, 'auto');
  await router.onlineChat([{ role: 'user', content: '需要在线识别' }]); assert.equal(calls[1].options.hostMode, 'online');
  assert.equal((await router.getOnlineCapabilities()).supportsVision, true);
});
