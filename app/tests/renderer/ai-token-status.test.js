'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('所有 AI 输入框共享同一 Token 余额和最近一次消耗', async () => {
  const { createAiTokenStatus } = await import('../../src/renderer/foundation/ai-token-status.mjs');
  const elements = Array.from({ length: 3 }, () => {
    const fields = {
      '[data-ai-token-used]': { textContent: '' },
      '[data-ai-token-remaining]': { textContent: '' },
    };
    return { querySelector: selector => fields[selector], fields, title: '' };
  });
  const documentRef = { querySelectorAll: () => elements };
  const api = { getAiQuota: async () => ({ quota: { remainingTokens: 998_627 } }) };
  const status = createAiTokenStatus({ api, documentRef });

  await status.refresh();
  assert.equal(elements[0].fields['[data-ai-token-remaining]'].textContent, '余量 998,627 Token');
  assert.equal(elements[2].fields['[data-ai-token-remaining]'].textContent, '余量 998,627 Token');

  await status.record({ actualTokens: 96, remainingTokens: 998_531 });
  for (const element of elements) {
    assert.equal(element.fields['[data-ai-token-used]'].textContent, '本次消耗 96 Token');
    assert.equal(element.fields['[data-ai-token-remaining]'].textContent, '余量 998,531 Token');
  }
});

test('积分模式显示一次任务结算值并保留余额尾数', async () => {
 const {createAiTokenStatus}=await import('../../src/renderer/foundation/ai-token-status.mjs');
 const used={},remaining={},element={querySelector:s=>s==='[data-ai-token-used]'?used:remaining};
 const status=createAiTokenStatus({documentRef:{querySelectorAll:()=>[element]},api:{getAiQuota:async()=>({quota:{billingUnit:'credits',remainingCredits:499.1235}})}});
 await status.refresh();assert.equal(remaining.textContent,'余量 499.1235 积分');
 await status.record({billingUnit:'credits',chargedCredits:2,actualTokens:100,remainingCredits:499.1235});assert.equal(used.textContent,'本次消耗 2 积分');assert.equal(remaining.textContent,'余量 499.1235 积分');
});


test('failed quota refresh preserves known credits and local replies reset their cost to zero', async () => {
  const { createAiTokenStatus } = await import('../../src/renderer/foundation/ai-token-status.mjs');
  const used = {}, remaining = {};
  let fail = false;
  const status = createAiTokenStatus({ documentRef: { querySelectorAll: () => [{ querySelector: s => s === '[data-ai-token-used]' ? used : remaining }] },
    api: { getAiQuota: async () => fail ? ({ ok: false, error: '暂不可用' }) : ({ quota: { billingUnit: 'credits', remainingCredits: 499.1235 } }) } });
  await status.refresh();
  await status.record({ billingUnit: 'credits', chargedCredits: 2, actualTokens: 100 });
  fail = true;
  await status.refresh();
  assert.equal(used.textContent, '本次消耗 2 积分');
  assert.equal(remaining.textContent, '余量 499.1235 积分');
  await status.record({ actualTokens: 0 });
  assert.equal(used.textContent, '本次消耗 0 积分');
  assert.equal(remaining.textContent, '余量 499.1235 积分');
});
