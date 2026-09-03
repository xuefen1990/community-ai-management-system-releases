'use strict';

function cleanOnlineAiError(error) {
  const fallback = '在线 AI 连接失败';
  const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!rawMessage) return fallback;
  return rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .trim() || fallback;
}

function setOnlineAiTestStatus(statusElement, state, message) {
  if (!statusElement) return;
  statusElement.hidden = false;
  statusElement.dataset.state = state;
  statusElement.textContent = message;
}

async function runOnlineAiTest({
  button,
  statusElement,
  saveSettings,
  testOnlineAi,
  notify = () => {},
}) {
  if (!button || button.disabled) return { ok: false, error: '在线 AI 正在测试中' };
  const originalText = button.textContent || '测试在线接口';
  button.disabled = true;
  button.textContent = '正在测试…';
  setOnlineAiTestStatus(statusElement, 'testing', '正在连接在线 AI，请稍候…');

  try {
    await saveSettings();
    const response = await testOnlineAi();
    const model = response?.model || '在线模型';
    const content = String(response?.content || '连接成功').trim();
    setOnlineAiTestStatus(statusElement, 'success', `连接成功：${model}；接口返回：${content}`);
    notify(`在线 AI 连接成功（${model}）`, 'success');
    return { ok: true, response };
  } catch (error) {
    const message = cleanOnlineAiError(error);
    setOnlineAiTestStatus(statusElement, 'error', `连接失败：${message}`);
    notify(`在线 AI 连接失败：${message}`, 'error');
    return { ok: false, error: message };
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanOnlineAiError, runOnlineAiTest, setOnlineAiTestStatus };
}

(function installAiSettingsUi() {
  if (typeof window === 'undefined') return;
  if (!document.querySelector('script[data-settings-tab-ui]')) {
    const settingsTabScript = document.createElement('script');
    settingsTabScript.src = 'js/settings-tab-ui.js';
    settingsTabScript.dataset.settingsTabUi = 'true';
    document.head.appendChild(settingsTabScript);
  }
  const api = window.api;
  if (!api?.getAiSettings) return;
  let status = { running: false };
  let conversation = [];

  function notify(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  }

  function updateRuntimeStatus(nextStatus) {
    status = nextStatus;
    const serviceBadge = document.getElementById('internalAiServiceBadge');
    const ollamaBadge = document.getElementById('aiOllamaStatusBadge');
    const modelBadge = document.getElementById('aiModelStatusBadge');
    const button = document.getElementById('btnToggleInternalAi');
    const drawer = document.getElementById('aiDrawerModelStatus');
    const runningText = nextStatus.running ? '运行中' : nextStatus.loading ? '加载中' : '未启动';
    for (const badge of [serviceBadge, ollamaBadge]) {
      if (!badge) continue;
      badge.textContent = runningText;
      badge.style.background = nextStatus.running ? '#10b981' : nextStatus.loading ? '#f59e0b' : '#64748b';
    }
    if (modelBadge) {
      modelBadge.textContent = nextStatus.modelPath?.split('/').pop() || '未就绪';
      modelBadge.style.background = nextStatus.modelPath ? '#10b981' : '#64748b';
    }
    if (button) button.textContent = nextStatus.running ? '⏹ 停止内置服务' : '⚡ 启动内置服务';
    if (drawer) drawer.textContent = nextStatus.running ? '本地模型运行中' : '按设置选择本地或在线 AI';
  }

  async function scanModels(selectedPath = '') {
    const select = document.getElementById('internalModelSelect');
    if (!select) return [];
    const models = await api.scanLocalModels();
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = models.length ? '请选择本地模型' : '尚未导入 GGUF 模型';
    select.appendChild(empty);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.path;
      option.textContent = `${model.name} · ${(model.size / 1024 / 1024).toFixed(1)} MB`;
      option.selected = model.path === selectedPath;
      select.appendChild(option);
    }
    return models;
  }

  async function toggleLocalRuntime() {
    const button = document.getElementById('btnToggleInternalAi');
    button.disabled = true;
    try {
      if (status.running) updateRuntimeStatus(await api.toggleInternalAiServer({ action: 'stop' }));
      else {
        const modelPath = document.getElementById('internalModelSelect')?.value;
        if (!modelPath) throw new Error('请先选择或导入一个 GGUF 模型');
        updateRuntimeStatus({ ...status, loading: true });
        updateRuntimeStatus(await api.toggleInternalAiServer({ action: 'start', modelPath }));
      }
    } catch (error) {
      notify(error.message || '本地 AI 服务操作失败', 'error');
      updateRuntimeStatus(await api.getInternalAiServerStatus());
    } finally {
      button.disabled = false;
    }
  }

  function buildSettingsPanel() {
    const card = document.querySelector('[data-settings-section="ai-assistant"]');
    const cardBody = card?.querySelector('.card-body');
    if (!cardBody || document.getElementById('communityAiModePanel')) return;
    const heading = card.querySelector('.card-header h3');
    if (heading) heading.textContent = '🤖 本地 + 在线 AI 智能助理配置';
    const panel = document.createElement('div');
    panel.id = 'communityAiModePanel';
    panel.style.cssText = 'border:1px solid var(--border-color);border-radius:12px;padding:16px;margin-bottom:18px;background:var(--bg-body);';
    panel.innerHTML = `
      <h4 style="margin:0 0 12px;font-size:14px;">AI 运行模式</h4>
      <div style="display:grid;grid-template-columns:160px 1fr 1fr;gap:10px;margin-bottom:10px;">
        <select id="communityAiMode" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);"><option value="local">仅本地 AI</option><option value="online">仅在线 AI</option><option value="auto">自动：本地优先</option></select>
        <input id="communityAiBaseUrl" placeholder="OpenAI 兼容接口，如 https://api.openai.com/v1" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);">
        <input id="communityAiModel" placeholder="在线模型名称" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);">
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <input id="communityAiApiKey" type="password" placeholder="API 密钥（已保存时留空即可）" style="flex:1;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);">
        <button id="communityAiImportModel" class="btn btn-outline">📥 导入 GGUF</button><button id="communityAiSave" class="btn btn-primary">保存配置</button><button id="communityAiTestOnline" class="btn btn-outline">测试在线接口</button>
      </div>
      <div id="communityAiTestStatus" class="community-ai-test-status" hidden aria-live="polite"></div>
      <p style="margin:10px 0 0;font-size:11px;color:var(--text-secondary);">本地模式不联网；在线模式仅将您主动提交给 AI 的文本发送到所配置的接口。API 密钥由 macOS 安全存储加密。</p>`;
    cardBody.prepend(panel);

    panel.querySelector('#communityAiImportModel').addEventListener('click', async () => {
      const result = await api.importLocalModel();
      if (result?.ok) {
        await scanModels(result.model.path);
        notify('GGUF 模型已导入');
      }
    });
    panel.querySelector('#communityAiSave').addEventListener('click', saveSettings);
    panel.querySelector('#communityAiTestOnline').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      await runOnlineAiTest({
        button,
        statusElement: panel.querySelector('#communityAiTestStatus'),
        saveSettings: () => saveSettings({ showSuccess: false }),
        testOnlineAi: () => api.testOnlineAi(),
        notify,
      });
    });
  }

  async function saveSettings({ showSuccess = true } = {}) {
    const settings = await api.saveAiSettings({
      mode: document.getElementById('communityAiMode').value,
      localModelPath: document.getElementById('internalModelSelect')?.value || '',
      online: {
        baseUrl: document.getElementById('communityAiBaseUrl').value.trim(),
        model: document.getElementById('communityAiModel').value.trim(),
        apiKey: document.getElementById('communityAiApiKey').value.trim(),
      },
    });
    document.getElementById('communityAiApiKey').value = '';
    document.getElementById('communityAiApiKey').placeholder = settings.online.hasApiKey ? 'API 密钥已安全保存；留空表示不更改' : 'API 密钥';
    if (showSuccess) notify('AI 配置已保存');
    return settings;
  }

  function appendChatBubble(kind, content) {
    const container = document.getElementById('aiDesktopChatContainer');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${kind}`;
    const paragraph = document.createElement('p');
    paragraph.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.6;margin:0;';
    paragraph.textContent = content;
    bubble.appendChild(paragraph);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  async function sendAiMessage() {
    const input = document.getElementById('aiDesktopInputText');
    const button = document.getElementById('aiDesktopSendBtn');
    const content = input.value.trim();
    if (!content || button.disabled) return;
    input.value = '';
    appendChatBubble('user', content);
    conversation.push({ role: 'user', content });
    button.disabled = true;
    const pending = appendChatBubble('bot', '正在思考...');
    try {
      const response = await api.chatWithAi(conversation.slice(-12));
      pending.remove();
      appendChatBubble('bot', response.content);
      conversation.push({ role: 'assistant', content: response.content });
      const drawerStatus = document.getElementById('aiDrawerModelStatus');
      if (drawerStatus) drawerStatus.textContent = response.provider === 'local' ? '本地 AI 已回复' : '在线 AI 已回复';
    } catch (error) {
      pending.querySelector('p').textContent = `请求失败：${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    buildSettingsPanel();
    const settings = await api.getAiSettings();
    document.getElementById('communityAiMode').value = settings.mode;
    document.getElementById('communityAiBaseUrl').value = settings.online.baseUrl;
    document.getElementById('communityAiModel').value = settings.online.model;
    document.getElementById('communityAiApiKey').placeholder = settings.online.hasApiKey ? 'API 密钥已安全保存；留空表示不更改' : 'API 密钥';
    await scanModels(settings.localModelPath);
    updateRuntimeStatus(await api.getInternalAiServerStatus());

    window.scanAndPopulateModels = scanModels;
    window.toggleInternalAiService = toggleLocalRuntime;
    window.checkLocalAIStatus = async () => updateRuntimeStatus(await api.getInternalAiServerStatus());
    window.sendDesktopAiMessage = sendAiMessage;
    for (const [id, handler] of [['btnScanModels', scanModels], ['btnToggleInternalAi', toggleLocalRuntime], ['aiDesktopSendBtn', sendAiMessage]]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.removeAttribute('onclick');
      button.addEventListener('click', handler);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();

  function loadWorkManagementModule() {
    if (window.WorkManagement || document.querySelector('script[data-work-management-module]')) return;
    const modelScript = document.createElement('script');
    modelScript.src = 'js/modules/work-management-model.js';
    modelScript.dataset.workManagementModule = 'model';
    modelScript.addEventListener('load', () => {
      const uiScript = document.createElement('script');
      uiScript.src = 'js/modules/work-management.js';
      uiScript.dataset.workManagementModule = 'ui';
      document.head.appendChild(uiScript);
    }, { once: true });
    document.head.appendChild(modelScript);
  }

  loadWorkManagementModule();
}());
