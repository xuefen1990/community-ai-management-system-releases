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
  const api = window.api;
  if (!api?.getAiSettings) return;
  let status = { running: false };
  let conversation = [];
  // 保留最近 30 轮（用户与助理各一条），让在线理解服务能够承接上下文。
  const MAX_CONVERSATION_MESSAGES = 60;
  const MAX_RENDERED_CHAT_ITEMS = 80;

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
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  function trimAssistantChat(container) {
    const items = [...container.querySelectorAll('.chat-bubble, .ai-confirmation-card, .ai-query-evidence-card')];
    for (const item of items.slice(0, Math.max(0, items.length - MAX_RENDERED_CHAT_ITEMS))) item.remove();
  }

  function evidenceMoney(cents) {
    const amount = Number(cents || 0) / 100;
    return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function evidenceText(value, fallback = '—') {
    const result = String(value || '').trim();
    return result || fallback;
  }

  function appendQueryEvidenceCard(evidence) {
    if (!evidence || !['payment-evidence', 'record-evidence'].includes(evidence.kind)) return;
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const card = document.createElement('section');
    card.className = 'ai-query-evidence-card';
    const heading = document.createElement('div');
    heading.className = 'ai-query-evidence-heading';
    const title = document.createElement('strong');
    title.textContent = evidence.title || '查询依据';
    const scope = document.createElement('p');
    scope.textContent = `统计口径：${evidenceText(evidence.scope)}`;
    heading.append(title, scope);

    const total = document.createElement('div');
    total.className = 'ai-query-evidence-total';
    const totalLabel = document.createElement('span');
    totalLabel.textContent = evidence.kind === 'payment-evidence' ? '已发放合计' : evidenceText(evidence.metricLabel, '查询结果');
    const totalValue = document.createElement('b');
    totalValue.textContent = evidence.kind === 'payment-evidence' ? evidenceMoney(evidence.paidTotalCents) : evidenceText(evidence.metricValue, '—');
    const count = document.createElement('small');
    count.textContent = evidence.kind === 'payment-evidence' ? `共 ${Number(evidence.paidCount || 0)} 笔已发放记录` : '可展开查看统计依据与原始记录';
    total.append(totalLabel, totalValue, count);
    card.append(heading, total);

    if (evidence.empty) {
      const empty = document.createElement('p');
      empty.className = 'ai-query-evidence-empty';
      empty.textContent = evidenceText(evidence.emptyMessage, '未查到符合条件的记录。');
      card.appendChild(empty);
    }

    const summaryItems = evidence.kind === 'payment-evidence' ? evidence.categorySummary : evidence.summary;
    if (Array.isArray(summaryItems) && summaryItems.length) {
      const summary = document.createElement('div');
      summary.className = 'ai-query-evidence-summary';
      for (const item of summaryItems) {
        const row = document.createElement('div');
        const label = document.createElement('span');
        label.textContent = evidence.kind === 'payment-evidence' ? `${evidenceText(item.name)} · ${Number(item.count || 0)} 笔` : evidenceText(item.name);
        const amount = document.createElement('b');
        amount.textContent = evidence.kind === 'payment-evidence' ? evidenceMoney(item.amountCents) : evidenceText(item.value);
        row.append(label, amount);
        summary.appendChild(row);
      }
      card.appendChild(summary);
    }

    if (Array.isArray(evidence.alerts) && evidence.alerts.length) {
      const alerts = document.createElement('div');
      alerts.className = 'ai-query-evidence-alerts';
      const heading = document.createElement('strong');
      heading.textContent = '待留意（不计入已发放合计）';
      alerts.appendChild(heading);
      for (const item of evidence.alerts) {
        const alert = document.createElement('span');
        alert.textContent = `${evidenceText(item.label)} ${Number(item.count || 0)} 笔 · ${evidenceMoney(item.amountCents)}`;
        alerts.appendChild(alert);
      }
      card.appendChild(alerts);
    }

    const records = Array.isArray(evidence.records) ? evidence.records : [];
    if (records.length) {
      const details = document.createElement('details');
      details.className = 'ai-query-evidence-details';
      const toggle = document.createElement('summary');
      toggle.textContent = `查看 ${records.length} 笔依据和明细`;
      details.appendChild(toggle);
      const list = document.createElement('div');
      list.className = 'ai-query-evidence-record-list';
      for (const record of records) {
        const row = document.createElement('div');
        row.className = 'ai-query-evidence-record';
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = evidenceText(record.title || record.recipientName, evidenceText(record.categoryName));
        const meta = document.createElement('span');
        meta.textContent = evidence.kind === 'payment-evidence'
          ? [record.categoryName, record.groupName, record.date, record.statusLabel].map((item) => evidenceText(item, '')).filter(Boolean).join(' · ')
          : evidenceText(record.meta, '原始台账记录');
        identity.append(name, meta);
        const amount = document.createElement('b');
        amount.textContent = evidence.kind === 'payment-evidence' ? evidenceMoney(record.amountCents) : evidenceText(record.value);
        const source = document.createElement('button');
        source.type = 'button';
        source.className = 'ai-query-evidence-source';
        source.textContent = '查看原始台账';
        source.addEventListener('click', () => runAssistantAction(record.sourceAction));
        row.append(identity, amount, source);
        list.appendChild(row);
      }
      details.appendChild(list);
      card.appendChild(details);
    }
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  function appendPendingChatBubble() {
    const bubble = appendChatBubble('bot', '正在查询…');
    const paragraph = bubble.querySelector('p');
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const seconds = Math.max(1, Math.floor((performance.now() - startedAt) / 1000));
      if (paragraph?.isConnected) paragraph.textContent = `正在查询… 已等待 ${seconds} 秒`;
    }, 500);
    return {
      bubble,
      stop: () => window.clearInterval(timer),
    };
  }

  function assistantGreeting() {
    return `<div class="chat-bubble bot"><p style="font-size:13px;line-height:1.6;margin:0;color:var(--text-primary);">您好，我是 AI 助理。我会先理解您的连续对话，再核对系统中的真实资料；查询、总结和跳转可直接完成，修改前仍会请您确认。</p><p style="font-size:11.5px;line-height:1.55;margin:8px 0 0;color:var(--text-secondary);">例如：先问“薛锋和薛振宇是什么关系”，下一句可继续问“他们今年发了多少钱”。资料不足时我会追问，不会猜测。</p></div>`;
  }

  function startNewAssistantConversation() {
    conversation = [];
    const chat = document.getElementById('aiDesktopChatContainer');
    if (chat) chat.innerHTML = assistantGreeting();
    const input = document.getElementById('aiDesktopInputText');
    input?.focus();
  }

  function appendConfirmationCard(action) {
    if (!action || action.type !== 'confirm') return;
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const highRisk = action.riskLevel === 'high';
    const finalConfirmation = highRisk && action.confirmationStep === 1;
    const card = document.createElement('div');
    card.className = `ai-confirmation-card${highRisk ? ' is-high-risk' : ''}`;
    const title = document.createElement('strong');
    title.textContent = highRisk
      ? (finalConfirmation ? '高风险操作：最终确认' : '高风险操作：第一次确认')
      : '请确认本次修改';
    const hint = document.createElement('p');
    hint.textContent = highRisk
      ? (finalConfirmation ? '确认后将立即执行并写入操作记录。' : '继续后还会要求一次最终确认，当前不会修改系统数据。')
      : '确认后才会修改系统数据，并写入操作记录。';
    const actions = document.createElement('div');
    actions.className = 'ai-confirmation-actions';
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'ai-confirmation-confirm';
    confirm.textContent = highRisk ? (finalConfirmation ? '确认执行' : '继续执行') : '确认执行';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'ai-confirmation-cancel'; cancel.textContent = '取消';
    const reply = (value) => {
      for (const button of actions.querySelectorAll('button')) button.disabled = true;
      sendAiMessage(value);
    };
    confirm.addEventListener('click', () => reply(highRisk ? (finalConfirmation ? '确认执行' : '继续执行') : '确认'));
    cancel.addEventListener('click', () => reply('取消'));
    actions.append(confirm, cancel);
    card.append(title, hint, actions);
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  function runAssistantAction(action) {
    if (!action || action.type !== 'navigate') return;
    if (typeof window.switchTab !== 'function') {
      notify(`未能打开${action.label || '目标页面'}，请从左侧菜单进入。`, 'error');
      return;
    }
    window.switchTab(action.target);
    const menuItem = document.querySelector(`.sidebar-menu .menu-item[data-target="${action.target}"]`);
    if (menuItem) {
      document.querySelectorAll('.sidebar-menu .menu-item').forEach((item) => item.classList.toggle('active', item === menuItem));
    }
    const query = String(action.filters?.query || '').trim();
    if (query && action.target === 'tab-finance') {
      const input = document.getElementById('searchFinanceRecord');
      if (input) {
        input.value = query;
        if (typeof window.filterFinanceRecords === 'function') window.filterFinanceRecords();
      }
    }
    if (query && action.target === 'tab-land') {
      const input = document.getElementById('searchLand');
      if (input) {
        input.value = query;
        if (typeof window.filterLand === 'function') window.filterLand();
      }
    }
    if (query && action.target === 'tab-personnel') {
      const input = document.getElementById('searchPersonnel');
      if (input) {
        input.value = query;
        if (typeof window.filterPersonnel === 'function') window.filterPersonnel();
      }
    }
    if (query && action.target === 'tab-party') {
      const input = document.getElementById('searchPartyKeyword');
      if (input) {
        input.value = query;
        window.currentPartySearchKeyword = query;
        if (typeof window.renderPartyMemberList === 'function') window.renderPartyMemberList();
      }
    }
    if (action.evidenceSource && typeof window.ContractFeeWorkspace?.openEvidenceSource === 'function') {
      window.ContractFeeWorkspace.openEvidenceSource(action.evidenceSource).catch((error) => notify(error.message || '未能打开原始台账', 'error'));
    }
    if (action.recordSource && typeof window.ContractFeeWorkspace?.openRecordSource === 'function') {
      window.ContractFeeWorkspace.openRecordSource(action.recordSource).catch((error) => notify(error.message || '未能打开原始台账', 'error'));
    }
    if (action.recordSource?.kind === 'work' && typeof window.WorkManagement?.openWork === 'function') {
      window.WorkManagement.openWork(action.recordSource.id).catch((error) => notify(error.message || '未能打开原始台账', 'error'));
    }
    if (action.recordSource?.kind === 'document' && typeof window.DocumentDrafting?.openDocument === 'function') {
      window.DocumentDrafting.openDocument(action.recordSource.id).catch((error) => notify(error.message || '未能打开原始台账', 'error'));
    }
    if (action.recordSource?.kind === 'certificate' && typeof window.showCertHistoryModal === 'function') {
      window.showCertHistoryModal();
      window.setTimeout(() => {
        const input = document.getElementById('certHistoryKeyword');
        if (!input) return;
        input.value = String(action.recordSource.query || '');
        if (typeof window.onCertHistoryFilterChange === 'function') window.onCertHistoryFilterChange();
      }, 0);
    }
    if (action.recordSource?.kind === 'duty' && /^\d{4}-\d{2}-\d{2}$/u.test(String(action.recordSource.date || ''))) {
      const targetDate = new Date(`${action.recordSource.date}T12:00:00`);
      const today = new Date();
      const mondayOf = (value) => {
        const monday = new Date(value.getFullYear(), value.getMonth(), value.getDate());
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        return monday;
      };
      const offset = Math.round((mondayOf(targetDate).getTime() - mondayOf(today).getTime()) / (7 * 24 * 60 * 60 * 1000));
      window.dutyFlexibleState = window.dutyFlexibleState || {};
      window.dutyFlexibleState.activeWeekOffset = offset;
      if (typeof window.renderFlexibleDuty === 'function') window.renderFlexibleDuty();
    }
  }

  async function sendAiMessage(preparedContent = '') {
    const input = document.getElementById('aiDesktopInputText');
    const button = document.getElementById('aiDesktopSendBtn');
    // A DOM click handler receives PointerEvent as its first argument. Only
    // confirmation cards intentionally pass a text command; all other entry
    // points must read the value currently shown in the input box.
    const command = typeof preparedContent === 'string' ? preparedContent : '';
    const content = String(command || input.value || '').trim();
    if (!content || button.disabled) return;
    if (!command) input.value = '';
    appendChatBubble('user', content);
    conversation.push({ role: 'user', content });
    if (conversation.length > MAX_CONVERSATION_MESSAGES) conversation = conversation.slice(-MAX_CONVERSATION_MESSAGES);
    button.disabled = true;
    const pending = appendPendingChatBubble();
    try {
      const response = api.converseWithAiAssistant
        ? await api.converseWithAiAssistant(conversation)
        : await api.chatWithAi(conversation);
      pending.stop();
      pending.bubble.remove();
      appendChatBubble('bot', response.content);
      appendQueryEvidenceCard(response.data?.queryEvidence);
      conversation.push({ role: 'assistant', content: response.content });
      if (conversation.length > MAX_CONVERSATION_MESSAGES) conversation = conversation.slice(-MAX_CONVERSATION_MESSAGES);
      appendConfirmationCard(response.action);
      runAssistantAction(response.action);
      const drawerStatus = document.getElementById('aiDrawerModelStatus');
      if (drawerStatus) drawerStatus.textContent = response.provider === 'system' ? '系统数据已核对' : response.provider === 'local' ? '本地 AI 已回复' : '在线 AI 已回复';
    } catch (error) {
      pending.stop();
      const message = cleanOnlineAiError(error);
      pending.bubble.querySelector('p').textContent = `本次未能完成查询：${message}。系统未进行任何修改，您可以稍后重试。`;
      const drawerStatus = document.getElementById('aiDrawerModelStatus');
      if (drawerStatus) drawerStatus.textContent = '服务暂不可用';
    } finally {
      button.disabled = false;
    }
  }

  function configureDesktopAssistant() {
    const toggle = document.getElementById('aiCopilotToggleBtn');
    const drawer = document.getElementById('aiCopilotDrawer');
    if (!toggle || !drawer) return;
    configureSafeDrawerToggle(toggle, drawer);
    const toggleText = toggle.querySelector('.ai-btn-text');
    if (toggleText) toggleText.textContent = 'AI 助理';
    toggle.title = '快捷唤起 AI 助理 (Ctrl+K)';

    const heading = drawer.querySelector('.ai-drawer-header h3');
    if (heading) heading.textContent = 'AI 助理';
    const drawerIdentity = drawer.querySelector('.ai-drawer-header > div');
    if (drawerIdentity && !drawer.querySelector('[data-ai-assistant-records-link]')) {
      const recordsLink = document.createElement('button');
      recordsLink.type = 'button'; recordsLink.className = 'ai-records-link'; recordsLink.dataset.aiAssistantRecordsLink = 'true';
      recordsLink.textContent = '操作记录';
      recordsLink.addEventListener('click', openAssistantOperations);
      drawerIdentity.appendChild(recordsLink);
    }
    if (drawerIdentity && !drawer.querySelector('[data-ai-assistant-new-chat]')) {
      const newChat = document.createElement('button');
      newChat.type = 'button'; newChat.className = 'ai-records-link'; newChat.dataset.aiAssistantNewChat = 'true';
      newChat.textContent = '新建对话';
      newChat.addEventListener('click', startNewAssistantConversation);
      drawerIdentity.appendChild(newChat);
    }
    const chat = document.getElementById('aiDesktopChatContainer');
    if (chat) {
      chat.innerHTML = assistantGreeting();
    }
    const input = document.getElementById('aiDesktopInputText');
    if (input) input.placeholder = '例如：张三这年度共计发了多少钱？';
    const chipDefinitions = [
      ['📊 年度发放查询', '张三这年度共计发了多少钱？'],
      ['👥 查询村民', '查询一组张三的村民档案'],
      ['💰 资金发放', '打开资金发放中心'],
    ];
    const chips = drawer.querySelector('.ai-drawer-footer > div:first-child');
    if (chips) {
      chips.replaceChildren(...chipDefinitions.map(([label, prompt]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ai-chip'; button.textContent = label;
        button.addEventListener('click', () => { if (input) { input.value = prompt; input.focus(); } });
        return button;
      }));
    }
    installDrawerDrag(drawer);
  }

  function configureSafeDrawerToggle(toggle, drawer) {
    const closeButton = drawer.querySelector('.btn-close-ai');
    const resetDrawerPosition = () => {
      drawer.style.left = ''; drawer.style.top = ''; drawer.style.right = ''; drawer.style.bottom = '';
      drawer.classList.remove('ai-assistant-dragging', 'ai-assistant-dragged');
    };
    const closeDrawer = (event) => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      event?.stopPropagation?.();
      resetDrawerPosition();
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
    };
    const openDrawer = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      drawer.classList.remove('hidden');
      drawer.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
    };
    const toggleDrawer = (event) => {
      if (drawer.classList.contains('hidden')) openDrawer(event);
      else closeDrawer(event);
    };

    // The legacy page used an inline handler whose click event could be mistaken for chat text.
    // Replace both entry points with one isolated handler so closing never sends a message.
    window.toggleDesktopAiDrawer = toggleDrawer;
    toggle.removeAttribute('onclick');
    closeButton?.removeAttribute('onclick');
    if (drawer.dataset.safeToggleReady === 'true') return;
    drawer.dataset.safeToggleReady = 'true';
    toggle.addEventListener('click', openDrawer);
    closeButton?.addEventListener('click', closeDrawer, true);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || drawer.classList.contains('hidden')) return;
      event.stopImmediatePropagation();
      closeDrawer(event);
    }, true);
  }

  function switchToAssistantOperations() {
    const target = 'tab-ai-assistant-records';
    if (typeof window.switchTab === 'function') window.switchTab(target);
    const button = document.querySelector(`.sidebar-menu .menu-item[data-target="${target}"]`);
    if (button) document.querySelectorAll('.sidebar-menu .menu-item').forEach((item) => item.classList.toggle('active', item === button));
  }

  async function openAssistantOperations() {
    switchToAssistantOperations();
    const drawer = document.getElementById('aiCopilotDrawer');
    if (drawer && !drawer.classList.contains('hidden') && typeof window.toggleDesktopAiDrawer === 'function') window.toggleDesktopAiDrawer();
    await renderAssistantOperations();
  }

  function formatOperationTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
  }

  function operationSummary(operation) {
    if (operation.type === 'resident_phone_update') return `${operation.object?.name || '居民'}：手机号 ${operation.before?.phone || '未填写'} → ${operation.after?.phone || '未填写'}`;
    if (operation.type === 'resident_address_update') return `${operation.object?.name || '居民'}：住址 ${operation.before?.address || '未填写'} → ${operation.after?.address || '未填写'}`;
    if (operation.type === 'resident_group_update') return `${operation.object?.name || '居民'}：村民组 ${operation.before?.group || '未填写'} → ${operation.after?.group || '未填写'}`;
    if (operation.type === 'land_parcel_create') return `登记地块：${operation.after?.record?.parcel_name || operation.object?.name || '未命名地块'}`;
    if (operation.type === 'visit_record_create') return `新增民情记录：${operation.after?.record?.content || operation.object?.name || '未填写内容'}`;
    if (operation.type === 'duty_schedule_add') return `新增值班安排：${operation.object?.name || '未填写人员'} · ${operation.after?.date || '未填写日期'}`;
    if (operation.type === 'work_item_create') return `新建工作：${operation.object?.name || operation.after?.record?.name || '未命名工作'}`;
    if (operation.type === 'work_item_status_update') return `工作状态：${operation.object?.name || '未命名工作'} ${operation.before?.status || '未填写'} → ${operation.after?.status || '未填写'}`;
    if (operation.type === 'work_item_soft_delete') return `删除工作（可恢复）：${operation.object?.name || '未命名工作'}`;
    if (operation.type === 'work_items_soft_delete_batch') return `批量删除工作（可恢复）：${operation.object?.name || `${operation.object?.numbers?.length || 0} 项`}`;
    if (operation.type === 'database_backup_restore') return `恢复系统备份（可撤销）：${operation.object?.name || operation.after?.backupName || '未指定备份'}`;
    if (operation.type === 'unit_member_disable') return `停用成员登录（可恢复）：${operation.object?.name || operation.object?.phone || '未指定成员'}`;
    if (operation.type === 'finance_records_clear') return `清空财务收支台账（可恢复）：${operation.object?.count || operation.before?.records?.length || 0} 笔`;
    if (operation.type === 'certificate_record_delete') return `删除证明记录（可恢复）：${operation.object?.name || '未编号证明'}`;
    if (operation.type === 'document_draft_archive') return `归档公文：${operation.object?.name || '未命名公文'}`;
    if (operation.type === 'party_member_stage_update') return `${operation.object?.name || '党员'}：党员阶段 ${operation.before?.stage || '未填写'} → ${operation.after?.stage || '未填写'}`;
    if (operation.type === 'resource_contract_create') return `新建合同：${operation.object?.name || operation.after?.record?.name || '未命名合同'}`;
    if (operation.type === 'contract_receipt_create') return `登记承包人到账：${operation.object?.name || '未命名合同'}`;
    if (operation.type === 'finance_record_create') return `登记财务${operation.after?.record?.type === 'income' ? '收入' : '支出'}：${operation.after?.record?.summary || operation.object?.name || '未填写摘要'}`;
    if (operation.type === 'finance_record_update') return `修改财务记录：${operation.before?.record?.voucherNumber || operation.object?.voucherNumber || operation.object?.name || '未编号凭证'}`;
    if (operation.type === 'settings_village_name_update') return `社区名称：${operation.before?.villageName || '未填写'} → ${operation.after?.villageName || '未填写'}`;
    if (operation.type === 'undo') return `${operation.object?.name || '对象'}：已恢复上一项 AI 修改`;
    return operation.type || 'AI 助理操作';
  }

  function compactOperationValue(value) {
    if (value === undefined || value === null || value === '') return '无';
    const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return serialized.length > 1800 ? `${serialized.slice(0, 1800)}\n……内容较长，已截取前 1800 个字符。` : serialized;
  }

  function operationDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '').trim().slice(0, 10);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function operationMatchesFilters(operation, filters) {
    if (filters.module && operation.module !== filters.module) return false;
    if (filters.type && operation.type !== filters.type) return false;
    if (filters.status && operation.status !== filters.status) return false;
    if (filters.date && operationDateKey(operation.completedAt || operation.createdAt) !== filters.date) return false;
    const keyword = filters.keyword.toLocaleLowerCase('zh-CN');
    return !keyword || `${operationSummary(operation)} ${operation.module || ''} ${operation.object?.name || ''}`.toLocaleLowerCase('zh-CN').includes(keyword);
  }

  async function renderAssistantOperations() {
    const section = document.getElementById('tab-ai-assistant-records');
    const list = section?.querySelector('[data-ai-assistant-operation-list]');
    if (!section || !list || !api.listAiAssistantOperations) return;
    list.replaceChildren();
    try {
      const operations = await api.listAiAssistantOperations({ limit: 100 });
      const filters = {
        module: section.querySelector('[data-ai-assistant-operation-module]')?.value || '',
        type: section.querySelector('[data-ai-assistant-operation-type]')?.value || '',
        status: section.querySelector('[data-ai-assistant-operation-status]')?.value || '',
        date: section.querySelector('[data-ai-assistant-operation-date]')?.value || '',
        keyword: section.querySelector('[data-ai-assistant-operation-keyword]')?.value.trim() || '',
      };
      const visibleOperations = operations.filter((operation) => operationMatchesFilters(operation, filters));
      if (!visibleOperations.length) {
        const empty = document.createElement('p'); empty.className = 'ai-operation-empty'; empty.textContent = '还没有由 AI 助理实际执行的操作。查询和页面跳转不会写入这里。'; list.appendChild(empty); return;
      }
      for (const operation of visibleOperations) {
        const row = document.createElement('article'); row.className = 'ai-operation-row';
        const textBlock = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = operationSummary(operation);
        const meta = document.createElement('span'); meta.textContent = `${operation.module || 'AI 助理'} · ${formatOperationTime(operation.completedAt || operation.createdAt)} · ${operation.status === 'undone' ? '已撤销' : operation.status === 'cancelled' ? '已取消' : '已完成'}`;
        textBlock.append(title, meta); row.appendChild(textBlock);
        const actions = document.createElement('div'); actions.className = 'ai-operation-row-actions';
        const details = document.createElement('button'); details.type = 'button'; details.className = 'btn btn-outline ai-operation-details'; details.textContent = '查看详情';
        details.addEventListener('click', () => {
          const expanded = row.classList.toggle('is-expanded');
          details.textContent = expanded ? '收起详情' : '查看详情';
        });
        actions.appendChild(details);
        const detailBlock = document.createElement('pre'); detailBlock.className = 'ai-operation-detail';
        detailBlock.textContent = `操作类型：${operation.type || '未填写'}\n风险等级：${operation.riskLevel === 'high' ? '高风险' : '一般'}\n执行前：${compactOperationValue(operation.before)}\n执行后：${compactOperationValue(operation.after)}${operation.error ? `\n失败原因：${operation.error}` : ''}`;
        row.appendChild(detailBlock);
        if (operation.recoverable && operation.status === 'completed') {
          const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'btn btn-outline ai-operation-undo'; undo.textContent = '撤销此操作';
          undo.addEventListener('click', async () => {
            if (!window.confirm(`确认撤销“${operationSummary(operation)}”吗？系统会恢复到该操作之前的状态。`)) return;
            undo.disabled = true;
            try {
              const result = await api.undoAiAssistantOperation({ operationId: operation.id });
              notify(result.message || '已撤销该操作'); await renderAssistantOperations();
            } catch (error) { notify(error.message || '撤销失败，请人工核对后再试', 'error'); undo.disabled = false; }
          });
          actions.appendChild(undo);
        }
        row.appendChild(actions);
        list.appendChild(row);
      }
    } catch (error) {
      const failure = document.createElement('p'); failure.className = 'ai-operation-empty'; failure.textContent = `读取操作记录失败：${error.message || '请稍后重试'}`; list.appendChild(failure);
    }
  }

  function injectAssistantOperationsDestination() {
    if (document.getElementById('tab-ai-assistant-records')) return;
    const menu = document.querySelector('.sidebar-menu');
    const reference = menu?.querySelector('[data-target="tab-work-management"]') || menu?.firstElementChild;
    if (menu) {
      const button = document.createElement('button'); button.className = 'menu-item'; button.dataset.target = 'tab-ai-assistant-records';
      button.innerHTML = '<span aria-hidden="true">🤖</span><span>AI 助理记录</span>';
      button.addEventListener('click', openAssistantOperations);
      reference?.insertAdjacentElement('afterend', button) || menu.appendChild(button);
    }
    const section = document.createElement('section'); section.className = 'tab-content hidden'; section.id = 'tab-ai-assistant-records';
    section.innerHTML = '<div class="ai-operation-center"><div class="ai-operation-header"><div><h2>AI 助理记录</h2><p>仅保留 AI 实际写入系统或已取消的高风险操作。撤销必须在此页手动确认。</p></div><button type="button" class="btn btn-outline" data-ai-assistant-operation-refresh>刷新</button></div><div class="ai-operation-filters"><input type="search" placeholder="按对象或操作搜索" data-ai-assistant-operation-keyword><select data-ai-assistant-operation-module><option value="">全部模块</option><option value="村民一户一档">村民一户一档</option><option value="土地承包确权">土地承包确权</option><option value="民情记录">民情记录</option><option value="村里值班">村里值班</option><option value="工作管理">工作管理</option><option value="党员管理">党员管理</option><option value="证明开具">证明开具</option><option value="资金发放中心">资金发放中心</option><option value="财务收支">财务收支</option><option value="系统设置">系统设置</option><option value="系统备份">系统备份</option><option value="账号权限">账号权限</option></select><select data-ai-assistant-operation-type><option value="">全部操作</option><option value="resident_phone_update">修改手机号</option><option value="resident_address_update">修改住址</option><option value="resident_group_update">调整村民组</option><option value="land_parcel_create">登记地块</option><option value="visit_record_create">新增民情记录</option><option value="duty_schedule_add">新增值班安排</option><option value="work_item_create">新建工作</option><option value="work_item_status_update">调整工作状态</option><option value="work_item_soft_delete">删除工作</option><option value="work_items_soft_delete_batch">批量删除工作</option><option value="database_backup_restore">恢复系统备份</option><option value="unit_member_disable">停用成员登录</option><option value="certificate_record_delete">删除证明记录</option><option value="document_draft_archive">归档公文</option><option value="party_member_stage_update">调整党员阶段</option><option value="resource_contract_create">新建合同</option><option value="contract_receipt_create">登记承包人到账</option><option value="finance_record_create">登记财务收支</option><option value="finance_record_update">修改财务收支</option><option value="finance_records_clear">清空财务收支台账</option><option value="settings_village_name_update">修改社区名称</option><option value="undo">撤销操作</option></select><input type="date" aria-label="按日期筛选" data-ai-assistant-operation-date><select data-ai-assistant-operation-status><option value="">全部状态</option><option value="completed">已完成</option><option value="undone">已撤销</option><option value="cancelled">已取消</option><option value="failed">未执行</option></select></div><div class="ai-operation-list" data-ai-assistant-operation-list></div></div>';
    section.querySelector('[data-ai-assistant-operation-refresh]')?.addEventListener('click', renderAssistantOperations);
    for (const control of section.querySelectorAll('[data-ai-assistant-operation-keyword], [data-ai-assistant-operation-module], [data-ai-assistant-operation-type], [data-ai-assistant-operation-date], [data-ai-assistant-operation-status]')) {
      control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', renderAssistantOperations);
    }
    document.querySelector('.app-main')?.appendChild(section);
  }

  function installDrawerDrag(drawer) {
    if (drawer.dataset.dragReady === 'true') return;
    drawer.dataset.dragReady = 'true';
    const header = drawer.querySelector('.ai-drawer-header');
    if (!header) return;
    let drag = null;
    const resetPosition = () => {
      drawer.style.left = ''; drawer.style.top = ''; drawer.style.right = ''; drawer.style.bottom = '';
      drawer.classList.remove('ai-assistant-dragged');
    };
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = drawer.getBoundingClientRect();
      drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      drawer.setPointerCapture?.(event.pointerId);
      drawer.classList.add('ai-assistant-dragging');
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const width = drawer.offsetWidth; const height = drawer.offsetHeight;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, event.clientX - drag.offsetX));
      const top = Math.max(12, Math.min(window.innerHeight - height - 12, event.clientY - drag.offsetY));
      drawer.style.left = `${left}px`; drawer.style.top = `${top}px`; drawer.style.right = 'auto'; drawer.style.bottom = 'auto';
      drawer.classList.add('ai-assistant-dragged');
    });
    const finish = () => { drag = null; drawer.classList.remove('ai-assistant-dragging'); };
    header.addEventListener('pointerup', finish);
    header.addEventListener('pointercancel', finish);
    // Closing is handled by configureSafeDrawerToggle, which resets the position
    // before hiding the drawer. Do not observe class changes here: resetting a
    // class from a class observer can schedule another observer callback and
    // leave the renderer busy after the close button is pressed.
  }

  async function initialize() {
    configureDesktopAssistant();
    injectAssistantOperationsDestination();
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
    for (const [id, handler] of [['btnScanModels', scanModels], ['btnToggleInternalAi', toggleLocalRuntime], ['aiDesktopSendBtn', () => sendAiMessage()]]) {
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
