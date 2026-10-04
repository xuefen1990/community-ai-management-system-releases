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
