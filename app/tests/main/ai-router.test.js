'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AiRouter, applyTokenReminderPolicy } = require('../../src/main/ai-router');

test('auto mode prefers a running local model', async () => {
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'auto' }) },
    localRuntime: { getStatus: () => ({ running: true }), chat: async () => ({ content: 'local' }) },
    onlineClient: { chat: async () => ({ content: 'online' }) },
  });
  assert.equal((await router.chat({ messages: [{ role: 'user', content: 'hi' }] })).content, 'local');
});

test('local AI also requires a signed-in community account', async () => {
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'local' }) },
    localRuntime: { chat: async () => ({ content: '不应调用' }) },
    authService: { session: null, request: async () => ({}) },
  });
  await assert.rejects(() => router.chat({ messages: [{ role: 'user', content: '你好' }] }), /请先登录社区账号/u);
});

test('auto mode falls back to configured online AI when local is stopped', async () => {
  const router = new AiRouter({
    settingsStore: {
      readRaw: async () => ({ mode: 'auto' }),
      getOnlineCredentials: async () => ({ baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'm' }),
    },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => ({ content: 'online' }) },
  });
  const result = await router.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'online');
  assert.equal(result.provider, 'online');
});

test('explains how to re-enter an API key for this session when secure storage is unavailable', async () => {
  const router = new AiRouter({
    settingsStore: {
      readRaw: async () => ({ mode: 'online' }),
      getOnlineCredentials: async () => ({ apiKey: '', credentialStatus: 'secure-storage-unavailable' }),
    },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => ({ content: 'unexpected' }) },
  });

  await assert.rejects(() => router.chat({ messages: [{ role: 'user', content: 'hi' }] }), /只在本次打开软件期间有效/u);
});

test('routes online AI through the authenticated backend and clears legacy credentials after success', async () => {
  const calls = [];
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'online' }), clearLegacyOnlineSettings: async () => { calls.push('clear-legacy'); } },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => { throw new Error('不应再直连 Provider'); } },
    authService: { request: async (path, options) => { if(path!=='/ai/credit-tasks/estimate')calls.push({ path, options }); return { model: 'demo', choices: [{ message: { content: '后端已回复' } }], usage: { total_tokens: 12 } }; } },
  });
  const result = await router.chat({ messages: [{ role: 'user', content: '你好' }] });
  assert.equal(result.content, '后端已回复');
  assert.equal(result.provider, 'online');
  assert.equal(calls[0].path, '/ai/chat');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].options.body.messages, [{ role: 'user', content: '你好' }]);
  assert.equal(calls[0].options.body.taskTier, 'basic');
  assert.equal(calls[0].options.body.taskKind, '');
  assert.match(calls[0].options.body.requestId, /^ai-request-/u);
  assert.equal(calls[1], 'clear-legacy');
});

test('routes long-form drafting to deep AI and exposes token settlement metadata', async () => {
  const calls = [];
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'online' }), clearLegacyOnlineSettings: async () => {} },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => ({ content: 'unused' }) },
    authService: { request: async (path, options) => {
      if(path!=='/ai/credit-tasks/estimate')calls.push({ path, options });
      return { model: 'deepseek-reasoner', choices: [{ message: { content: '拟写完成' } }], usage: { total_tokens: 321 }, communityAi: { taskTier: 'deep', actualTokens: 321, remainingTokens: 9000 } };
    } },
  });
  const result = await router.chat({ messages: [{ role: 'user', content: '请拟写一份工作报告' }], task: { taskKind: 'document-draft', taskId: 'doc-1' } });
  assert.equal(calls[0].options.body.taskTier, 'deep');
  assert.equal(calls[0].options.body.taskId, 'doc-1');
  assert.equal(result.routing.actualTokens, 321);
  assert.equal(result.model, 'deepseek-reasoner');
});

test('online estimate uses the same task classification', async () => {
  const calls = [];
  const router = new AiRouter({
    settingsStore: {}, localRuntime: {}, onlineClient: {},
    authService: { request: async (path, options) => { calls.push({ path, options }); return { taskTier: 'deep', estimatedTokens: 5000 }; } },
  });
  const estimate = await router.estimateOnline([{ role: 'user', content: '综合分析居民、土地和资金' }], { taskKind: 'cross-module-analysis' });
  assert.equal(calls[0].path, '/ai/estimate');
  assert.equal(calls[0].options.body.taskTier, 'deep');
  assert.equal(estimate.estimatedTokens, 5000);
});

test('默认只对高消耗调用显示 Token 确认', () => {
  assert.equal(applyTokenReminderPolicy({ estimatedTokens: 1200, sufficient: true }, 'high_cost_only').requiresConfirmation, false);
  assert.equal(applyTokenReminderPolicy({ estimatedTokens: 5200, sufficient: true }, 'high_cost_only').requiresConfirmation, true);
  assert.equal(applyTokenReminderPolicy({ estimatedTokens: 1200, sufficient: true }, 'always').requiresConfirmation, true);
  assert.equal(applyTokenReminderPolicy({ estimatedTokens: 5200, sufficient: true }, 'insufficient_only').requiresConfirmation, false);
  assert.equal(applyTokenReminderPolicy({ estimatedTokens: 1200, sufficient: false }, 'insufficient_only').requiresConfirmation, true);
});

test('普通在线问答估算不会因任务被归为深度而自动打断', async () => {
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'online', tokenReminderMode: 'high_cost_only' }) },
    localRuntime: { getStatus: () => ({ running: false }) }, onlineClient: {},
    authService: { request: async () => ({ taskTier: 'deep', estimatedTokens: 1800, sufficient: true, highCost: false }) },
  });
  const result = await router.estimate({ messages: [{ role: 'user', content: '帮我润色这句话' }], options: { taskKind: 'assistant-conversation' } });
  assert.equal(result.requiresConfirmation, false);
});

test('AI text integrity rejects replacement characters in local and online output without deleting ordinary question marks',async()=>{
  for(const mode of ['local','online']){
    let content='兹证明：信息属实，是否用于申请？';
    const router=new AiRouter({settingsStore:{readRaw:async()=>({mode}),getOnlineCredentials:async()=>({apiKey:'test-only'})},localRuntime:{chat:async()=>({content})},onlineClient:{chat:async()=>({content})}});
    assert.equal((await router.chat({messages:[{role:'user',content:'脱敏证明测试'}]})).content,content);
    content='兹证明：居\uFFFD民信息属实';
    await assert.rejects(router.chat({messages:[{role:'user',content:'脱敏证明测试'}]}),/损坏字符.*重新生成/u);
  }
  const router=new AiRouter({settingsStore:{readRaw:async()=>({mode:'online'})},authService:{request:async()=>({choices:[{message:{content:'泵\uFFFD房改造工程费'}}]})}});
  await assert.rejects(router.chat({messages:[{role:'user',content:'脱敏科目测试'}]}),/损坏字符/u);
});

test('credits group multiple requests, confirm the upper bound, and settle once',async()=>{
 const calls=[];const router=new AiRouter({settingsStore:{readRaw:async()=>({mode:'online'})},localRuntime:{getStatus:()=>({running:false})},confirmCredits:async e=>{assert.equal(e.approvedMaxCredits,5);return true;},authService:{request:async(path,{body}={})=>{calls.push({path,body});if(path.endsWith('/estimate'))return {billingUnit:'credits',estimatedCredits:5};if(path==='/ai/credit-tasks')return {id:'credit-task'};if(path.endsWith('/finish'))return {chargedCredits:2,remainingCredits:498};return {choices:[{message:{content:'结果'}}],communityAi:{billingPending:true}};}}});
 const result=await router.withBillingTask({messages:[{content:'长报告'}],maxTokens:5000},async()=>{await router.onlineChat([{content:'第一步'}]);return router.onlineChat([{content:'第二步'}]);});
 assert.equal(result.routing.chargedCredits,2);assert.equal(calls.filter(c=>c.path.endsWith('/finish')).length,1);assert.equal(calls.filter(c=>c.path==='/ai/chat').every(c=>c.body.billingTaskId==='credit-task'),true);
});
test('declining a costly credit operation does not reserve or call the model',async()=>{
 let calls=0;const router=new AiRouter({settingsStore:{readRaw:async()=>({mode:'online'})},confirmCredits:async()=>false,authService:{request:async()=>{calls++;return {billingUnit:'credits',estimatedCredits:6};}}});
 await assert.rejects(()=>router.onlineChat([{content:'分析'}]),/取消/);assert.equal(calls,1);
});
