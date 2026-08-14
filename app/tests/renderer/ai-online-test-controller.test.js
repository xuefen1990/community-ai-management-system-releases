'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cleanOnlineAiError,
  runOnlineAiTest,
} = require('../../src/renderer/js/ai-settings-ui');

function makeElements() {
  return {
    button: { disabled: false, textContent: '测试在线接口' },
    statusElement: { hidden: true, textContent: '', dataset: {} },
  };
}

test('online AI test shows progress and restores the button after success', async () => {
  const { button, statusElement } = makeElements();
  const notifications = [];

  const result = await runOnlineAiTest({
    button,
    statusElement,
    saveSettings: async () => {
      assert.equal(button.disabled, true);
      assert.equal(button.textContent, '正在测试…');
      assert.equal(statusElement.dataset.state, 'testing');
    },
    testOnlineAi: async () => ({ content: '连接成功', model: 'deepseek-chat' }),
    notify: (message, type) => notifications.push({ message, type }),
  });

  assert.equal(result.ok, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '测试在线接口');
  assert.equal(statusElement.hidden, false);
  assert.equal(statusElement.dataset.state, 'success');
  assert.match(statusElement.textContent, /deepseek-chat/u);
  assert.deepEqual(notifications, [{ message: '在线 AI 连接成功（deepseek-chat）', type: 'success' }]);
});

test('online AI test keeps a readable failure visible and restores the button', async () => {
  const { button, statusElement } = makeElements();
  const notifications = [];

  const result = await runOnlineAiTest({
    button,
    statusElement,
    saveSettings: async () => {},
    testOnlineAi: async () => {
      throw new Error("Error invoking remote method 'test-online-ai': Error: Authentication Fails");
    },
    notify: (message, type) => notifications.push({ message, type }),
  });

  assert.deepEqual(result, { ok: false, error: 'Authentication Fails' });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '测试在线接口');
  assert.equal(statusElement.dataset.state, 'error');
  assert.equal(statusElement.textContent, '连接失败：Authentication Fails');
  assert.deepEqual(notifications, [{ message: '在线 AI 连接失败：Authentication Fails', type: 'error' }]);
});

test('online AI error cleaner removes Electron IPC prefixes', () => {
  assert.equal(cleanOnlineAiError(new Error("Error invoking remote method 'test-online-ai': Error: 在线 AI 请求超时")), '在线 AI 请求超时');
  assert.equal(cleanOnlineAiError(null), '在线 AI 连接失败');
});
