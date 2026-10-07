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
  let conversationId = '';
  let conversationSummary = '';
  let currentTask = null;
  let restoredFileEntries = [];
  let pendingAttachments = [];
  let attachmentBusy = false;
  let conversationRestored = false;
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
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <select id="communityAiMode" style="padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-input);color:var(--text-primary);"><option value="local">仅本地 AI</option><option value="online">仅在线 AI</option><option value="auto">自动：本地优先</option></select>
        <span style="padding:8px 10px;border:1px solid var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;">本次消耗和账户余量显示在对话框底部</span>
        <span id="communityAiBackendInfo" style="padding:8px 10px;border:1px solid var(--border-color);border-radius:7px;color:var(--text-secondary);font-size:12px;">在线模型由账号后端统一提供</span>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <button id="communityAiImportModel" class="btn btn-outline">📥 导入 GGUF</button><button id="communityAiSave" class="btn btn-primary">保存配置</button><button id="communityAiTestOnline" class="btn btn-outline">测试在线 AI（消耗少量额度）</button>
      </div>
      <div id="communityAiTestStatus" class="community-ai-test-status" hidden aria-live="polite"></div>
      <p style="margin:10px 0 0;font-size:11px;color:var(--text-secondary);">本地模式不联网；在线模式通过账号后端调用，单位内账号共用永久 Token 额度。桌面端不填写 API 密钥。</p>`;
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

  function formatStorageBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatStorageTime(value) {
    if (!value) return '尚未执行';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '尚未执行' : date.toLocaleString('zh-CN', { hour12: false });
  }

  async function refreshAiStoragePanel(panel) {
    const content = panel?.querySelector('[data-ai-storage-content]');
    if (!content || typeof api.getAiStorageOverview !== 'function') return;
    content.innerHTML = '<p class="ai-storage-loading">正在统计本机存储，请稍候…</p>';
    try {
      const overview = await api.getAiStorageOverview();
      const categories = Object.values(overview.categories || {});
      content.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'ai-storage-grid';
      for (const category of categories) {
        const item = document.createElement('article');
        item.className = 'ai-storage-metric';
        const name = document.createElement('span');
        name.textContent = category.label;
        const size = document.createElement('strong');
        size.textContent = formatStorageBytes(category.bytes);
        const detail = document.createElement('small');
        detail.textContent = `${Number(category.count || 0).toLocaleString('zh-CN')} 项${category.note ? ` · ${category.note}` : ''}`;
        item.append(name, size, detail);
        grid.appendChild(item);
      }
      content.appendChild(grid);
      const status = document.createElement('div');
      status.className = 'ai-storage-status';
      const maintenance = overview.maintenance || {};
      status.textContent = `上次清理：${formatStorageTime(maintenance.lastCleanupAt)}　｜　上次重建索引：${formatStorageTime(maintenance.lastRebuildAt)}`;
      content.appendChild(status);
      if (overview.anomalyCount) {
        const warning = document.createElement('div');
        warning.className = 'ai-storage-warning';
        warning.textContent = `发现 ${overview.anomalyCount} 项需要留意：${(overview.anomalies || []).slice(0, 3).map(item => item.message).join('；')}`;
        content.appendChild(warning);
      } else {
        const healthy = document.createElement('div');
        healthy.className = 'ai-storage-healthy';
        healthy.textContent = '✓ 存储检查正常，正式档案与 AI 索引关联完整';
        content.appendChild(healthy);
      }
    } catch (error) {
      content.innerHTML = '';
      const warning = document.createElement('div');
      warning.className = 'ai-storage-warning';
      warning.textContent = `暂时无法读取存储状态：${cleanOnlineAiError(error)}`;
      content.appendChild(warning);
    }
  }

  function mountAiStoragePanel() {
    if (typeof api.getAiStorageOverview !== 'function') return;
    const host = document.querySelector('[data-testid="ai-settings-panel"] .card-body')
      || document.querySelector('[data-testid="ai-settings-panel"]');
    if (!host || host.querySelector('[data-ai-storage-panel]')) return;
    const panel = document.createElement('section');
    panel.className = 'ai-storage-panel';
    panel.dataset.aiStoragePanel = 'true';
    panel.innerHTML = `
      <div class="ai-storage-heading">
        <div><h4>AI 存储与索引</h4><p>清理只处理 AI 临时文件；正式业务数据、电子档案和现有备份不会被删除。</p></div>
        <button type="button" class="btn btn-outline" data-ai-storage-refresh>刷新统计</button>
      </div>
      <div data-ai-storage-content></div>
      <div class="ai-storage-actions">
        <button type="button" class="btn btn-outline" data-ai-storage-clean>清理临时缓存</button>
        <button type="button" class="btn btn-primary" data-ai-storage-rebuild>从正式档案重建 AI 索引</button>
      </div>`;
    host.appendChild(panel);
    panel.querySelector('[data-ai-storage-refresh]').addEventListener('click', () => refreshAiStoragePanel(panel));
    panel.querySelector('[data-ai-storage-clean]').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api.cleanAiTemporaryCache();
        notify(`临时缓存已清理：${result.removedCount || 0} 个文件，释放 ${formatStorageBytes(result.removedBytes)}`);
        await refreshAiStoragePanel(panel);
      } catch (error) { notify(cleanOnlineAiError(error), 'error'); }
      finally { button.disabled = false; }
    });
    panel.querySelector('[data-ai-storage-rebuild]').addEventListener('click', async event => {
      if (!window.confirm('将从正式档案重新生成 AI 检索索引。正式档案和业务数据不会改变，是否继续？')) return;
      const button = event.currentTarget;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '正在重建…';
      try {
        const result = await api.rebuildAiFileIndex();
        const message = `AI 索引重建完成：成功 ${result.rebuiltCount || 0} 项${result.failedCount ? `，${result.failedCount} 项需人工核对` : ''}`;
        notify(message, result.failedCount ? 'error' : 'success');
        await refreshAiStoragePanel(panel);
      } catch (error) { notify(cleanOnlineAiError(error), 'error'); }
      finally { button.disabled = false; button.textContent = original; }
    });
    refreshAiStoragePanel(panel);
  }

  async function renderAiAnomalyFindings(panel, { scan = false } = {}) {
    const content = panel?.querySelector('[data-ai-anomaly-content]');
    if (!content) return;
    content.innerHTML = '<p class="ai-storage-loading">正在核查业务数据，请稍候…</p>';
    try {
      if (scan) await api.scanAiAnomalies();
      const result = await api.listAiAnomalyFindings({ status: 'open' });
      const findings = Array.isArray(result.findings) ? result.findings : [];
      content.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = findings.length ? 'ai-anomaly-summary has-findings' : 'ai-anomaly-summary';
      summary.textContent = findings.length
        ? `发现 ${findings.length} 项待核对内容。系统没有自动修改任何业务数据。`
        : '✓ 本次核查未发现待处理异常';
      content.appendChild(summary);
      for (const finding of findings.slice(0, 50)) {
        const card = document.createElement('article');
        card.className = 'ai-anomaly-item';
        card.dataset.severity = finding.severity || 'warning';
        const main = document.createElement('div');
        main.className = 'ai-anomaly-main';
        const title = document.createElement('strong');
        title.textContent = finding.title || '待核对事项';
        const description = document.createElement('p');
        description.textContent = finding.summary || '请人工核对';
        main.append(title, description);
        const evidence = document.createElement('div');
        evidence.className = 'ai-anomaly-evidence';
        for (const item of (finding.evidence || []).slice(0, 6)) {
          const chip = document.createElement('span');
          chip.textContent = `${item.label}：${item.value}`;
          evidence.appendChild(chip);
        }
        main.appendChild(evidence);
        const actions = document.createElement('div');
        actions.className = 'ai-anomaly-actions';
        for (const [status, label] of [['resolved', '已处理'], ['ignored', '暂时忽略'], ['not-applicable', '规则不适用']]) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try { await api.updateAiAnomalyFinding({ id: finding.id, status }); await renderAiAnomalyFindings(panel); }
            catch (error) { notify(cleanOnlineAiError(error), 'error'); }
            finally { button.disabled = false; }
          });
          actions.appendChild(button);
        }
        card.append(main, actions);
        content.appendChild(card);
      }
      const time = document.createElement('small');
      time.className = 'ai-anomaly-last-scan';
      time.textContent = `最近核查：${formatStorageTime(result.scan?.lastScannedAt)}`;
      content.appendChild(time);
    } catch (error) {
      content.innerHTML = `<div class="ai-storage-warning">核查未完成：${cleanOnlineAiError(error)}</div>`;
    }
  }

  function mountAiAnomalyPanel() {
    if (typeof api.scanAiAnomalies !== 'function') return;
    const host = document.querySelector('[data-testid="ai-settings-panel"] .card-body')
      || document.querySelector('[data-testid="ai-settings-panel"]');
    if (!host || host.querySelector('[data-ai-anomaly-panel]')) return;
    const panel = document.createElement('section');
    panel.className = 'ai-storage-panel ai-anomaly-panel';
    panel.dataset.aiAnomalyPanel = 'true';
    panel.innerHTML = `
      <div class="ai-storage-heading">
        <div><h4>AI 主动核查</h4><p>核查身份证、银行卡、发放金额、承包费、合同期限、证明模板和导入文件；只提醒，不自动修改。</p></div>
        <button type="button" class="btn btn-primary" data-ai-anomaly-scan>立即重新核查</button>
      </div>
      <div data-ai-anomaly-content></div>`;
    host.appendChild(panel);
    panel.querySelector('[data-ai-anomaly-scan]').addEventListener('click', async event => {
      const button = event.currentTarget; const original = button.textContent;
      button.disabled = true; button.textContent = '正在核查…';
      try { await renderAiAnomalyFindings(panel, { scan: true }); }
      finally { button.disabled = false; button.textContent = original; }
    });
    renderAiAnomalyFindings(panel, { scan: true });
  }

  function observeAiStorageSettings() {
    mountAiStoragePanel();
    mountAiAnomalyPanel();
    if (document.documentElement.dataset.aiStorageObserver === 'installed') return;
    document.documentElement.dataset.aiStorageObserver = 'installed';
    const observer = new MutationObserver(() => { mountAiStoragePanel(); mountAiAnomalyPanel(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function saveSettings({ showSuccess = true } = {}) {
    const settings = await api.saveAiSettings({
      mode: document.getElementById('communityAiMode').value,
      localModelPath: document.getElementById('internalModelSelect')?.value || '',
    });
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

  function compactRestoredAssistantMessage(content) {
    const source = String(content || '').trim();
    if (!source.startsWith('已保存并检查您附加的文件：')) return source;
    const fileName = source.match(/\n\s*\d+\.\s*([^：:\n]+)[：:]/u)?.[1]?.trim() || '上传材料';
    return `已接收文件：${fileName}\n识别和归档结果请查看电子档案柜。`;
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

  function taskStatusLabel(status) {
    return ({ pending: '待开始', running: '办理中', 'waiting-input': '等待补充', 'waiting-confirmation': '等待确认', completed: '已完成', failed: '未完成', cancelled: '已取消', undone: '已撤销' })[status] || '办理中';
  }

  function appendTaskProgressCard(task) {
    if (!task || !Array.isArray(task.steps) || !task.steps.length) return;
    currentTask = task;
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    container.querySelector('[data-ai-task-progress]')?.remove();
    const card = document.createElement('section');
    card.className = 'ai-task-progress-card';
    card.dataset.aiTaskProgress = task.id || 'current';
    const completed = Number(task.progress?.completed ?? task.steps.filter(step => ['completed', 'skipped', 'undone'].includes(step.status)).length);
    const heading = document.createElement('div');
    heading.className = 'ai-task-progress-heading';
    const title = document.createElement('strong');
    title.textContent = task.title || 'AI 办理任务';
    const badge = document.createElement('span');
    badge.dataset.status = task.status || 'running';
    badge.textContent = taskStatusLabel(task.status);
    const headingActions = document.createElement('div');
    headingActions.className = 'ai-task-progress-heading-actions';
    const detailsToggle = document.createElement('button');
    detailsToggle.type = 'button';
    detailsToggle.className = 'ai-task-progress-toggle';
    const expandedByDefault = !['completed', 'cancelled', 'undone'].includes(task.status);
    detailsToggle.setAttribute('aria-expanded', String(expandedByDefault));
    detailsToggle.textContent = expandedByDefault ? '收起详情' : '查看详情';
    headingActions.append(badge, detailsToggle);
    heading.append(title, headingActions);
    const progress = document.createElement('p');
    progress.textContent = `已完成 ${completed}/${task.steps.length} 步`;
    card.append(heading, progress);
    const details = document.createElement('div');
    details.className = 'ai-task-progress-details';
    details.hidden = !expandedByDefault;
    const list = document.createElement('ol');
    for (const step of task.steps) {
      const item = document.createElement('li');
      item.dataset.status = step.status;
      const mark = document.createElement('span');
      mark.textContent = step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : step.status === 'waiting-input' ? '?' : step.status === 'waiting-confirmation' ? '待' : '·';
      const label = document.createElement('span');
      label.textContent = step.resultSummary ? `${step.title}：${step.resultSummary}` : step.title;
      item.append(mark, label);
      list.appendChild(item);
    }
    details.append(list);
    if (task.verification?.message) {
      const verification = document.createElement('p');
      verification.className = `ai-task-verification ${task.verification.passed ? 'is-passed' : 'is-failed'}`;
      verification.textContent = `${task.verification.passed ? '自动复核通过' : '需要人工核对'}：${task.verification.message}`;
      details.appendChild(verification);
    }
    card.append(details);
    detailsToggle.addEventListener('click', () => {
      const expanded = detailsToggle.getAttribute('aria-expanded') === 'true';
      detailsToggle.setAttribute('aria-expanded', String(!expanded));
      detailsToggle.textContent = expanded ? '查看详情' : '收起详情';
      details.hidden = expanded;
    });
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  function fileStatusLabel(file) {
    return file.status === 'reviewed' ? '已人工核对' : file.status === 'needs-review' ? '需要核对' : file.status === 'failed' ? '识别失败' : '已识别';
  }

  function archiveStatusLabel(file) {
    if (file.archiveState === 'archived') return `已归档：${file.finalCategory || '电子档案柜'}`;
    if (file.archiveState === 'deferred') return '暂不归档';
    return '待归档';
  }

  function replacePendingAttachment(file) {
    if (!file?.id) return;
    pendingAttachments = pendingAttachments.map(item => item.id === file.id ? { ...item, ...file } : item);
    renderPendingAttachments();
  }

  function refreshFileRecognitionRows(file) {
    if (!file?.id) return;
    for (const row of document.querySelectorAll('[data-ai-file-id]')) {
      if (row.dataset.aiFileId === String(file.id)) renderFileRecognitionRow(row, file);
    }
  }

  async function applyFileCategoryDecision(file, action, categoryName, button, row) {
    if (!api.applyAiFileCategory || button?.disabled) return;
    const original = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = '处理中…'; }
    try {
      const result = await api.applyAiFileCategory({ fileId: file.id, action, categoryName });
      replacePendingAttachment(result.file);
      renderFileRecognitionRow(row, result.file);
      appendChatBubble('bot', result.message || '档案分类已处理完成。');
    } catch (error) {
      notify(error.message || '档案分类处理失败', 'error');
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  async function undoFileCategoryDecision(file, button, row) {
    if (!api.undoAiFileCategory || button?.disabled) return;
    const original = button?.textContent || '';
    button.disabled = true; button.textContent = '撤销中…';
    try {
      const result = await api.undoAiFileCategory({ fileId: file.id });
      replacePendingAttachment(result.file);
      renderFileRecognitionRow(row, result.file);
      appendChatBubble('bot', result.message || '本次归档已经撤销。');
    } catch (error) {
      notify(error.message || '撤销归档失败', 'error');
      button.disabled = false; button.textContent = original;
    }
  }

  function renderFileRecognitionRow(row, file) {
    row.replaceChildren();
    row.className = 'ai-file-recognition-row';
    row.dataset.aiFileId = file.id || '';
    const main = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = file.fileName || '未命名文件';
    const summary = document.createElement('span');
    summary.textContent = file.documentClassification?.name || '材料已保存';
    const archive = document.createElement('span');
    archive.className = 'ai-file-archive-status';
    archive.dataset.state = file.archiveState || 'pending';
    archive.textContent = archiveStatusLabel(file);
    main.append(name, summary, archive);
    if (file.previewUrl && ['image', 'pdf'].includes(file.format)) {
      const previewMedia = document.createElement('button'); previewMedia.type = 'button'; previewMedia.className = 'ai-file-media-preview';
      if (file.format === 'image') { const image = document.createElement('img'); image.src = file.previewUrl; image.alt = `${file.fileName || '材料'}缩略图`; previewMedia.appendChild(image); }
      else previewMedia.textContent = `PDF · ${file.pageCount || '?'} 页`;
      previewMedia.title = '查看原文件'; previewMedia.addEventListener('click', () => window.AiFileViewer?.open(file)); row.appendChild(previewMedia);
    }
    const badge = document.createElement('em');
    badge.dataset.status = file.status || 'parsed';
    badge.textContent = fileStatusLabel(file);
    row.append(main, badge);

    const actions = document.createElement('div');
    actions.className = 'ai-file-recognition-actions';
    if (file.format === 'excel' && file.detectedModule !== 'unknown') {
      const preview = document.createElement('button');
      preview.type = 'button'; preview.className = 'ai-file-preview-button'; preview.textContent = '查看导入预览';
      preview.addEventListener('click', () => openFileImportPreview(file.id, preview));
      actions.appendChild(preview);
    }
    if (['image', 'pdf', 'word', 'text'].includes(file.format)) {
      const review = document.createElement('button');
      review.type = 'button'; review.className = 'ai-file-preview-button';
      review.textContent = file.status === 'reviewed' ? '查看核对结果' : '核对材料内容';
      review.addEventListener('click', () => openOcrReview(file.id, review));
      actions.appendChild(review);
    }
    if (file.format === 'image') {
      const vision = document.createElement('button'); vision.type = 'button'; vision.className = 'ai-file-preview-button'; vision.textContent = '识别图片版面';
      vision.addEventListener('click', async () => {
        if (!window.confirm('这会把当前图片发送给后台配置的在线视觉模型，用于识别版面、表格、勾选项、印章和签字位置。是否继续？')) return;
        const original = vision.textContent; vision.disabled = true; vision.textContent = '正在识别…';
        try { const result = await api.describeAiImage({ fileId: file.id, confirmed: true }); appendChatBubble('bot', result.description || result.message); vision.textContent = result.status === 'completed' ? '图片版面已识别' : '当前仅支持文字提取'; }
        catch (error) { vision.disabled = false; vision.textContent = original; notify(error.message || '图片版面识别失败', 'error'); }
      });
      actions.appendChild(vision);
    }

    if (file.archiveState === 'archived' && file.categoryDecision && !file.categoryDecision.undoneAt) {
      const undo = document.createElement('button');
      undo.type = 'button'; undo.className = 'ai-file-preview-button'; undo.textContent = '撤销本次归档';
      undo.addEventListener('click', () => undoFileCategoryDecision(file, undo, row));
      actions.appendChild(undo);
    } else {
      const recommendation = file.suggestedCategory || {};
      const categoryRow = document.createElement('div');
      categoryRow.className = 'ai-file-category-actions';
      if (recommendation.status === 'missing' && recommendation.name) {
        const create = document.createElement('button');
        create.type = 'button'; create.className = 'ai-file-category-primary';
        create.textContent = `创建“${recommendation.name}”并归档`;
        create.addEventListener('click', () => applyFileCategoryDecision(file, 'create-and-archive', recommendation.name, create, row));
        categoryRow.appendChild(create);
      }
      const candidates = Array.isArray(recommendation.candidates) ? recommendation.candidates : [];
      if (candidates.length) {
        const select = document.createElement('select');
        select.setAttribute('aria-label', '选择其他档案分类');
        const placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = '选择其他分类';
        select.appendChild(placeholder);
        for (const candidate of candidates) {
          const option = document.createElement('option'); option.value = candidate.name; option.textContent = candidate.name;
          select.appendChild(option);
        }
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'ai-file-preview-button'; choose.textContent = '按所选分类归档';
        choose.addEventListener('click', () => {
          if (!select.value) { notify('请先选择档案分类', 'error'); return; }
          applyFileCategoryDecision(file, 'archive-existing', select.value, choose, row);
        });
        categoryRow.append(select, choose);
      }
      if (file.archiveState !== 'deferred') {
        const defer = document.createElement('button');
        defer.type = 'button'; defer.className = 'ai-file-preview-button'; defer.textContent = '暂不归档';
        defer.addEventListener('click', () => applyFileCategoryDecision(file, 'defer', '', defer, row));
        categoryRow.appendChild(defer);
      }
      if (recommendation.message && recommendation.status === 'uncertain') {
        const recommendationText = document.createElement('p');
        recommendationText.className = 'ai-file-category-recommendation';
        recommendationText.textContent = '暂时无法确定归档分类，请选择一个分类。';
        actions.appendChild(recommendationText);
      }
      if (categoryRow.childElementCount) actions.appendChild(categoryRow);
    }
    if (actions.childElementCount) row.appendChild(actions);
  }

  function appendFileRecognitionCard(files) {
    if (!Array.isArray(files) || !files.length) return;
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const card = document.createElement('section');
    card.className = 'ai-file-recognition-card';
    const heading = document.createElement('strong');
    heading.textContent = files.length === 1 ? '文件识别结果' : `${files.length} 个文件识别结果`;
    card.appendChild(heading);
    for (const file of files) {
      const row = document.createElement('div');
      renderFileRecognitionRow(row, file);
      card.appendChild(row);
    }
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  function appendOcrReviewCard(preview) {
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const card = document.createElement('section');
    card.className = 'ai-file-import-preview ai-ocr-review-card';
    const heading = document.createElement('div');
    heading.className = 'ai-file-import-heading';
    const title = document.createElement('strong');
    title.textContent = `核对材料内容 · ${preview.file?.fileName || '材料'}`;
    const pageCount = document.createElement('span');
    const structure = preview.structure || {};
    pageCount.textContent = preview.file?.format === 'word'
      ? `${structure.paragraphs?.length || 0} 段 · ${structure.tables?.length || 0} 个表格${structure.hasPageNumber ? ' · 含页码' : ''}`
      : `${(preview.pages || []).length || preview.file?.ocrPageCount || preview.file?.pageCount || 0} 页`;
    heading.append(title, pageCount);
    const note = document.createElement('p');
    note.textContent = preview.confirmed
      ? '此内容已经人工核对。需要修正时可直接修改并再次确认。'
      : '请对照原文件核对。材料内容在确认前不会进入居民档案、证明、公文或资金台账。';
    const fields = document.createElement('div');
    fields.className = 'ai-ocr-field-list';
    for (const field of preview.fields || []) {
      const label = document.createElement('label');
      label.dataset.review = field.requiresReview ? 'true' : 'false';
      const caption = document.createElement('span');
      const percent = Math.round((Number(field.confidence) || 0) * 100);
      caption.textContent = `${field.label}${field.requiresReview ? ` · 重点核对（${percent}%）` : ''}`;
      const input = document.createElement('input');
      input.type = 'text'; input.value = field.value || ''; input.dataset.ocrField = field.key;
      input.dataset.label = field.label; input.dataset.confidence = String(field.confidence || 0);
      label.append(caption, input); fields.appendChild(label);
    }
    if (!fields.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'ai-ocr-empty-fields';
      empty.textContent = '没有自动找到姓名、身份证号等固定字段，请直接核对下方全文。';
      fields.appendChild(empty);
    }
    const textLabel = document.createElement('label');
    textLabel.className = 'ai-ocr-text-label';
    const textCaption = document.createElement('span');
    textCaption.textContent = '识别全文';
    const textarea = document.createElement('textarea');
    textarea.value = preview.text || ''; textarea.rows = 8;
    textarea.placeholder = '没有识别到文字，可在这里按原文件补录。';
    textLabel.append(textCaption, textarea);
    const consent = document.createElement('label');
    consent.className = 'ai-ocr-consent';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = preview.confirmed === true;
    const consentText = document.createElement('span');
    consentText.textContent = '我已对照原文件核对以上内容';
    consent.append(checkbox, consentText);
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'ai-file-import-confirm';
    confirm.textContent = preview.confirmed ? '保存修正后的核对结果' : '确认核对结果';
    confirm.addEventListener('click', async () => {
      if (!checkbox.checked) return notify('请先勾选“我已对照原文件核对以上内容”', 'warning');
      const original = confirm.textContent; confirm.disabled = true; confirm.textContent = '正在保存…';
      const correctedFields = [...fields.querySelectorAll('input[data-ocr-field]')].map(input => ({
        key: input.dataset.ocrField, label: input.dataset.label, value: input.value,
        confidence: Number(input.dataset.confidence) || 0,
      }));
      try {
        const result = await api.confirmAiFileOcrReview({ fileId: preview.file.id, reviewRevision: preview.reviewRevision,
          text: textarea.value, fields: correctedFields, confirmed: true });
        replacePendingAttachment(result.file);
        refreshFileRecognitionRows(result.file);
        confirm.textContent = '已保存核对结果'; confirm.dataset.completed = 'true';
        appendChatBubble('bot', result.message || '材料内容已核对并保存。');
        appendMaterialHandoffButton(card, { ...preview, confirmed: true, classification: result.classification || preview.classification });
      } catch (error) {
        confirm.disabled = false; confirm.textContent = original;
        notify(error.message || '核对结果保存失败', 'error');
      }
    });
    card.append(heading, note, fields, textLabel, consent, confirm);
    if (preview.confirmed) appendMaterialHandoffButton(card, preview);
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  async function openOcrReview(fileId, button) {
    if (!fileId || !api.reviewAiFileOcr || button?.disabled) return;
    const original = button?.textContent || '核对材料内容';
    if (button) { button.disabled = true; button.textContent = '正在读取…'; }
    try {
      appendOcrReviewCard(await api.reviewAiFileOcr({ fileId }));
    } catch (error) {
      notify(error.message || '未能读取识别结果', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  function appendMaterialHandoffButton(card, preview) {
    if (!card || card.querySelector('[data-ai-material-handoff]')) return;
    const moduleId = preview.classification?.module || preview.file?.documentClassification?.module || preview.file?.detectedModule;
    if (!['certificate', 'document-drafting'].includes(moduleId)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ai-file-import-confirm'; button.dataset.aiMaterialHandoff = moduleId;
    button.textContent = moduleId === 'certificate' ? '带入证明管理' : '带入公文拟写';
    button.addEventListener('click', async () => {
      if (button.disabled || !api.prepareAiDocumentHandoff) return;
      const original = button.textContent; button.disabled = true; button.textContent = '正在带入…';
      try {
        const prepared = await api.prepareAiDocumentHandoff({ fileId: preview.file.id, targetModule: moduleId });
        await window.communityFoundationNavigate?.({ type: 'navigate', target: prepared.navigationTarget,
          label: moduleId === 'certificate' ? '证明管理' : '公文拟写' });
        const destination = moduleId === 'certificate' ? window.CertificateManagementUI : window.DocumentDrafting;
        if (typeof destination?.openMaterialHandoff !== 'function') throw new Error('办理页面尚未加载最新材料接收功能，请重新启动开发版');
        await destination.openMaterialHandoff(prepared);
        button.textContent = '已带入办理页面'; button.dataset.completed = 'true';
      } catch (error) {
        button.disabled = false; button.textContent = original;
        notify(error.message || '材料带入失败', 'error');
      }
    });
    card.appendChild(button);
    if (moduleId === 'certificate' && !card.querySelector('[data-ai-certificate-template-preview]')) {
      const templateButton = document.createElement('button');
      templateButton.type = 'button'; templateButton.className = 'ai-file-secondary-action';
      templateButton.dataset.aiCertificateTemplatePreview = preview.file.id;
      templateButton.textContent = '整理为证明模板';
      templateButton.addEventListener('click', async () => {
        const original = templateButton.textContent; templateButton.disabled = true; templateButton.textContent = '正在查重…';
        try { appendCertificateTemplatePreview(await api.previewAiCertificateTemplate({ fileId: preview.file.id })); templateButton.textContent = '模板查重已完成'; }
        catch (error) { templateButton.disabled = false; templateButton.textContent = original; notify(error.message || '证明模板识别失败', 'error'); }
      });
      card.appendChild(templateButton);
    }
  }

  function appendCertificateTemplatePreview(preview) {
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const card = document.createElement('section'); card.className = 'ai-certificate-template-preview';
    const heading = document.createElement('div'); heading.className = 'ai-file-import-heading';
    const title = document.createElement('strong'); title.textContent = `证明模板核对 · ${preview.fileName || '未命名材料'}`;
    const match = document.createElement('span'); match.dataset.level = preview.match?.level || 'none'; match.textContent = preview.message || '请人工核对';
    heading.append(title, match);
    const nameLabel = document.createElement('label'); nameLabel.innerHTML = '<span>模板名称</span>';
    const nameInput = document.createElement('input'); nameInput.value = preview.candidate?.name || ''; nameLabel.appendChild(nameInput);
    const titleLabel = document.createElement('label'); titleLabel.innerHTML = '<span>证明标题</span>';
    const titleInput = document.createElement('input'); titleInput.value = preview.candidate?.title || ''; titleLabel.appendChild(titleInput);
    const contentLabel = document.createElement('label'); contentLabel.innerHTML = '<span>证明正文</span>';
    const contentInput = document.createElement('textarea'); contentInput.rows = 7; contentInput.value = preview.candidate?.content || ''; contentLabel.appendChild(contentInput);
    const fields = document.createElement('p'); fields.className = 'ai-certificate-template-fields';
    fields.textContent = `识别字段：${(preview.candidate?.fields || []).map(item => item.label).join('、') || '暂未识别到动态字段'}`;
    const differences = document.createElement('div'); differences.className = 'ai-certificate-template-differences';
    if (preview.match?.template) {
      const summary = document.createElement('strong'); summary.textContent = `现有模板：${preview.match.template.name}`; differences.appendChild(summary);
      for (const difference of preview.match.differences || []) {
        const item = document.createElement('p'); item.textContent = `${difference.label}不同，请核对后再决定。`; differences.appendChild(item);
      }
    }
    const actions = document.createElement('div'); actions.className = 'ai-file-category-row';
    const candidateValue = () => ({ ...preview.candidate, name: nameInput.value.trim(), title: titleInput.value.trim(), content: contentInput.value });
    const run = async (decision, button) => {
      if (decision === 'update-existing' && !window.confirm(`把“${preview.match?.template?.name || '现有模板'}”发布为新版本吗？`)) return;
      const original = button.textContent; button.disabled = true; button.textContent = '正在处理…';
      try {
        const result = await api.applyAiCertificateTemplate({ fileId: preview.fileId, decision, candidate: candidateValue(),
          templateId: preview.match?.template?.id || '', confirmed: true });
        appendChatBubble('bot', result.message);
        if (result.template?.id && ['draft-created', 'updated'].includes(result.action)) {
          await window.communityFoundationNavigate?.({ type: 'navigate', target: 'tab-certificate', label: '证明管理' });
          await window.CertificateManagementUI?.openTemplateIntake?.({ templateId: result.template.id });
        }
        button.textContent = result.action === 'reused' ? '已复用现有模板' : result.action === 'updated' ? '新版本已发布' : '草稿已建立';
        button.dataset.completed = 'true'; [...actions.querySelectorAll('button')].forEach(item => { item.disabled = true; });
      } catch (error) { button.disabled = false; button.textContent = original; notify(error.message || '模板处理失败', 'error'); }
    };
    const addAction = (label, decision, primary = false) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.className = primary ? 'ai-file-import-confirm' : 'ai-file-secondary-action'; button.addEventListener('click', () => run(decision, button)); actions.appendChild(button); };
    const level = preview.match?.level || 'none';
    if (level === 'exact') addAction('复用现有模板', 'reuse', true);
    else if (level === 'same-name') { addAction('保留并复用现有模板', 'reuse'); addAction('更新为新版本', 'update-existing', true); }
    else if (level === 'similar') { addAction('复用相近模板', 'reuse'); addAction('建立新模板草稿', 'create-draft', true); }
    else addAction('建立模板草稿', 'create-draft', true);
    card.append(heading, nameLabel, titleLabel, contentLabel, fields, differences, actions); container.appendChild(card);
    trimAssistantChat(container); container.scrollTop = container.scrollHeight;
  }

  function importActionLabel(action) {
    return { create: '新增档案', update: '补充资料', conflict: '资料冲突', skip: '不需导入' }[action] || '待核对';
  }

  function appendFileImportPreview(preview) {
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const card = document.createElement('section');
    card.className = 'ai-file-import-preview';
    const heading = document.createElement('div');
    heading.className = 'ai-file-import-heading';
    const title = document.createElement('strong');
    title.textContent = `居民导入预览 · ${preview.file?.fileName || 'Excel 表格'}`;
    const total = document.createElement('span');
    total.textContent = `共 ${Number(preview.total || 0)} 条`;
    heading.append(title, total);
    const stats = document.createElement('div');
    stats.className = 'ai-file-import-stats';
    for (const [key, label] of [['create', '新增'], ['update', '补充'], ['conflict', '冲突'], ['skip', '跳过']]) {
      const item = document.createElement('span');
      item.dataset.kind = key;
      item.textContent = `${label} ${Number(preview.counts?.[key] || 0)}`;
      stats.appendChild(item);
    }
    const note = document.createElement('p');
    note.textContent = '只导入“新增”和“补充”。资料冲突不会覆盖，已存在且没有新内容的记录会跳过。';
    const list = document.createElement('div');
    list.className = 'ai-file-import-list';
    for (const row of (preview.rows || []).slice(0, 8)) {
      const item = document.createElement('div');
      const person = document.createElement('span');
      person.textContent = `${row.name || '未填写姓名'} · ${row.groupName || '未分组'} · ${row.idCard || '无身份证号'}`;
      const result = document.createElement('b');
      result.dataset.kind = row.action;
      result.textContent = `${importActionLabel(row.action)}：${row.reason || '请核对'}`;
      item.append(person, result);
      list.appendChild(item);
    }
    if ((preview.rows || []).length > 8 || preview.truncated) {
      const more = document.createElement('small');
      more.textContent = '这里只展示前 8 条，确认时仍会按完整表格处理。';
      list.appendChild(more);
    }
    card.append(heading, stats, note, list);
    if (preview.canImport) {
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'ai-file-import-confirm';
      confirm.textContent = `确认导入 ${Number(preview.counts?.create || 0) + Number(preview.counts?.update || 0)} 条`;
      confirm.addEventListener('click', () => confirmFileImport(preview, confirm));
      card.appendChild(confirm);
    }
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  function appendBusinessFilePreview(preview) {
    const container = document.getElementById('aiDesktopChatContainer');
    if (!container) return;
    const names = { 'contract-fee': '承包费项目台账', disbursement: '资金发放明细', 'farmland-subsidy': '地力补贴台账', land: '土地台账' };
    const card = document.createElement('section');
    card.className = 'ai-file-import-preview';
    const heading = document.createElement('div');
    heading.className = 'ai-file-import-heading';
    const title = document.createElement('strong');
    title.textContent = names[preview.targetModule] || '业务表格预览';
    const total = document.createElement('span');
    total.textContent = `识别 ${Number(preview.total || 0)} 条`;
    heading.append(title, total);
    const note = document.createElement('p');
    note.textContent = preview.message || '请到对应业务板块继续核对。';
    const fields = document.createElement('p');
    fields.textContent = `识别字段：${(preview.fields || []).slice(0, 12).join('、') || '需要人工核对'}`;
    card.append(heading, note, fields);
    if (preview.navigationTarget) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'ai-file-import-confirm';
      open.textContent = preview.navigationTarget === 'tab-land' ? '打开土地管理' : '带入资金发放中心';
      open.addEventListener('click', () => continueBusinessFile(preview, open));
      card.appendChild(open);
    }
    container.appendChild(card);
    trimAssistantChat(container);
    container.scrollTop = container.scrollHeight;
  }

  async function openFileImportPreview(fileId, button) {
    if (!fileId || !api.previewAiFileImport || button?.disabled) return;
    const original = button?.textContent || '查看导入预览';
    if (button) { button.disabled = true; button.textContent = '正在核对…'; }
    try {
      const preview = await api.previewAiFileImport({ fileId, targetModule: 'auto' });
      if (preview?.requiresBusinessContext) appendBusinessFilePreview(preview);
      else appendFileImportPreview(preview);
    } catch (error) {
      notify(error.message || '未能生成导入预览', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  async function continueBusinessFile(preview, button) {
    if (!preview?.file?.id || button?.disabled) return;
    if (preview.navigationTarget === 'tab-land') {
      runAssistantAction({ type: 'navigate', target: 'tab-land', label: '土地管理' });
      return;
    }
    if (!api.prepareAiBusinessFile) return notify('开发版尚未加载最新文件交接功能，请关闭后重新运行 npm run dev', 'error');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在带入…';
    try {
      const prepared = await api.prepareAiBusinessFile({ fileId: preview.file.id, targetModule: preview.targetModule });
      if (!prepared?.ok) throw new Error(prepared?.error || '文件带入失败');
      if (typeof window.communityFoundationNavigate === 'function') {
        await window.communityFoundationNavigate({ type: 'navigate', target: 'tab-contract-fees', label: '资金发放中心' });
      } else if (typeof window.switchTab === 'function') {
        window.switchTab('tab-contract-fees');
        await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      }
      if (!window.ContractFeeWorkspace?.openAiBusinessFile) throw new Error('资金发放页面尚未加载最新功能，请关闭开发版后重新启动');
      await window.ContractFeeWorkspace.openAiBusinessFile(prepared);
      button.textContent = '已带入办理页面';
      button.dataset.completed = 'true';
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      notify(error.message || '未能把文件带入资金发放页面', 'error');
    }
  }

  async function confirmFileImport(preview, button) {
    if (!preview?.file?.id || !api.confirmAiFileImport || button?.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在备份并导入…';
    try {
      const result = await api.confirmAiFileImport({ fileId: preview.file.id, targetModule: preview.targetModule,
        previewRevision: preview.previewRevision, confirmed: true });
      appendChatBubble('bot', result.message || '居民资料导入完成。');
      button.textContent = '已完成导入';
      button.dataset.completed = 'true';
      if (typeof window.loadDatabase === 'function') await window.loadDatabase();
      if (typeof window.renderOverview === 'function') window.renderOverview();
      if (typeof window.filterPersonnel === 'function') window.filterPersonnel();
    } catch (error) {
      notify(error.message || '居民资料导入失败', 'error');
      button.disabled = false;
      button.textContent = original;
    }
  }

  function renderPendingAttachments() {
    const tray = document.querySelector('[data-ai-attachment-tray]');
    if (!tray) return;
    tray.replaceChildren();
    tray.hidden = pendingAttachments.length === 0;
    for (const file of pendingAttachments) {
      const chip = document.createElement('div');
      chip.className = 'ai-attachment-chip';
      const preview = file.format === 'image' && file.previewUrl ? document.createElement('img') : document.createElement('span');
      preview.className = 'ai-attachment-chip-preview';
      if (preview.tagName === 'IMG') {
        preview.src = file.previewUrl; preview.alt = `${file.fileName || '图片'}缩略图`;
        preview.title = '查看原图'; preview.addEventListener('click', () => window.AiFileViewer?.open(file));
      } else {
        preview.textContent = file.format === 'excel' ? '表' : file.format === 'word' ? '文' : file.format === 'pdf' ? 'PDF' : '图';
      }
      const details = document.createElement('span');
      details.className = 'ai-attachment-chip-details';
      const label = document.createElement('strong'); label.textContent = file.fileName || '未命名材料'; label.title = file.fileName || '';
      const state = document.createElement('small');
      state.textContent = file.status === 'needs-review' ? '需要核对' : file.status === 'reviewed' ? '已完成' : file.status === 'failed' ? '识别失败' : '已识别';
      details.append(label, state);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'ai-attachment-chip-remove'; remove.title = '从本次提问中移除'; remove.setAttribute('aria-label', `移除 ${file.fileName || '附件'}`); remove.textContent = '×';
      remove.addEventListener('click', () => { pendingAttachments = pendingAttachments.filter(item => item.id !== file.id); renderPendingAttachments(); });
      chip.append(preview, details, remove);
      tray.appendChild(chip);
    }
  }

  async function selectAssistantFiles(selectionKind = 'file') {
    if (attachmentBusy || !api.selectAiAssistantFiles) return;
    if (!conversationId) conversationId = window.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const buttons = [...document.querySelectorAll('[data-ai-attachment-kind]')];
    const button = buttons.find(item => item.dataset.aiAttachmentKind === selectionKind);
    attachmentBusy = true;
    buttons.forEach(item => { item.disabled = true; });
    button?.classList.add('is-busy');
    try {
      const response = await api.selectAiAssistantFiles({ conversationId, selectionKind });
      if (response?.canceled) return;
      const files = Array.isArray(response?.files) ? response.files : [];
      pendingAttachments = [...pendingAttachments, ...files.filter(file => !pendingAttachments.some(item => item.id === file.id))];
      renderPendingAttachments();
      appendFileRecognitionCard(files);
      if (files.some(file => file.archiveState === 'archived') && typeof window.loadDatabase === 'function') await window.loadDatabase();
      if (files.length) {
        const input = document.getElementById('aiDesktopInputText');
        input?.focus();
      }
    } catch (error) {
      notify(error.message || '文件识别失败，请重新选择', 'error');
    } finally {
      attachmentBusy = false;
      buttons.forEach(item => { item.disabled = false; item.classList.remove('is-busy'); });
    }
  }

  function assistantGreeting() {
    return `<div class="chat-bubble bot"><p style="font-size:13px;line-height:1.6;margin:0;color:var(--text-primary);">您好，我是 AI 助理。我会先理解您的连续对话，再核对系统中的真实资料；查询、总结和跳转可直接完成，修改前仍会请您确认。</p><p style="font-size:11.5px;line-height:1.55;margin:8px 0 0;color:var(--text-secondary);">虚构示例：先问“示例居民甲和示例居民乙是什么关系”，下一句可继续问“他们今年发了多少钱”。使用时请换成档案中的真实姓名；资料不足时我会追问，不会猜测。</p></div>`;
  }

  function startNewAssistantConversation() {
    conversation = [];
    conversationSummary = '';
    currentTask = null;
    restoredFileEntries = [];
    pendingAttachments = [];
    conversationId = window.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    conversationRestored = true;
    const chat = document.getElementById('aiDesktopChatContainer');
    if (chat) chat.innerHTML = assistantGreeting();
    const input = document.getElementById('aiDesktopInputText');
    renderPendingAttachments();
    input?.focus();
  }

  function renderRestoredConversation() {
    const chat = document.getElementById('aiDesktopChatContainer');
    if (!chat) return;
    chat.innerHTML = assistantGreeting();
    const hasArchivedFile = restoredFileEntries.some(file => file.archiveState === 'archived');
    for (const message of conversation) {
      if (hasArchivedFile && String(message.content || '').includes('未登记的 AI 工具：document.category-assign')) continue;
      appendChatBubble(message.role === 'user' ? 'user' : 'bot', message.role === 'assistant'
        ? compactRestoredAssistantMessage(message.content) : message.content);
    }
    if (currentTask) appendTaskProgressCard(currentTask);
  }

  async function restoreAssistantConversation() {
    if (conversationRestored || !api.getAiAssistantConversation) return;
    conversationRestored = true;
    try {
      const response = await api.getAiAssistantConversation({});
      const saved = response?.conversation;
      conversationId = saved?.id || window.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      conversation = Array.isArray(saved?.messages) ? saved.messages.slice(-MAX_CONVERSATION_MESSAGES) : [];
      conversationSummary = String(saved?.summary || '');
      currentTask = response?.task || null;
      if (api.listAiAssistantFiles) {
        const files = await api.listAiAssistantFiles({ limit: 100 }).catch(() => []);
        restoredFileEntries = Array.isArray(files) ? files : [];
        if (Array.isArray(files) && files.some(file => file.archiveState === 'archived') && typeof window.loadDatabase === 'function') {
          await window.loadDatabase();
        }
        const refreshed = await api.getAiAssistantConversation({ conversationId }).catch(() => null);
        currentTask = refreshed?.task || null;
      }
      renderRestoredConversation();
    } catch (error) {
      conversationId = window.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      conversationRestored = false;
      if (/局域网|主电脑/u.test(String(error?.message || ''))) window.showToast?.(error.message, 'error');
    }
  }

  async function openAssistantMemories() {
    const chat = document.getElementById('aiDesktopChatContainer');
    if (!chat || !api.listAiAssistantMemories) return;
    chat.innerHTML = '<div class="ai-memory-view"><div class="ai-memory-view-head"><strong>AI 长期记忆</strong><button type="button" data-ai-memory-back>返回对话</button></div><p>个人习惯只属于当前账号；单位规则供本单位成员共同使用。身份证、电话和银行卡等号码不会保存到这里。</p><div data-ai-memory-list>正在读取…</div><div class="ai-memory-help">虚构示例：“记住：以后称呼我为陈主任”<br>单位管理员也可以说：“单位规则：承包费先核对各组固定总额”</div></div>';
    chat.querySelector('[data-ai-memory-back]')?.addEventListener('click', renderRestoredConversation);
    const list = chat.querySelector('[data-ai-memory-list]');
    try {
      const response = await api.listAiAssistantMemories();
      const memories = Array.isArray(response?.memories) ? response.memories : [];
      list.innerHTML = memories.length ? '' : '<div class="ai-memory-empty">目前还没有长期记忆。</div>';
      for (const memory of memories) {
        const row = document.createElement('div');
        row.className = 'ai-memory-row';
        const content = document.createElement('div');
        const badge = document.createElement('span');
        badge.className = `ai-memory-scope ${memory.scope === 'organization' ? 'organization' : 'personal'}`;
        badge.textContent = memory.scope === 'organization' ? '单位规则' : '个人';
        const textNode = document.createElement('p');
        textNode.textContent = memory.content;
        content.append(badge, textNode);
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = '删除';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            await api.deleteAiAssistantMemory({ memoryId: memory.id });
            row.remove();
            notify('记忆已删除', 'success');
          } catch (error) {
            remove.disabled = false;
            notify(error.message || '删除记忆失败', 'error');
          }
        });
        row.append(content, remove);
        list.appendChild(row);
      }
    } catch (error) {
      list.textContent = error.message || '暂时无法读取长期记忆';
    }
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
    if (typeof window.communityFoundationNavigate === 'function') {
      window.communityFoundationNavigate(action).catch(error => notify(error.message || '未能打开目标页面', 'error'));
      return;
    }
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
    if (!conversationId) conversationId = window.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (!command) input.value = '';
    appendChatBubble('user', content);
    conversation.push({ role: 'user', content });
    if (conversation.length > MAX_CONVERSATION_MESSAGES) conversation = conversation.slice(-MAX_CONVERSATION_MESSAGES);
    button.disabled = true;
    const pending = appendPendingChatBubble();
    try {
      const response = api.converseWithAiAssistant
        ? await api.converseWithAiAssistant({ conversationId, conversationSummary, messages: conversation, attachmentIds: pendingAttachments.map(file => file.id) })
        : await api.chatWithAi(conversation);
      pending.stop();
      pending.bubble.remove();
      appendChatBubble('bot', response.content);
      const assistantTask = response.task || {};
      const assistantRouting = response.routing || assistantTask.routing || {};
      window.communityAiTokenStatus?.record({
        ...(assistantRouting || {}),
        actualTokens: assistantTask.actualTokens ?? assistantRouting.actualTokens ?? response.usage?.total_tokens
          ?? (['local', 'system'].includes(response.provider || assistantRouting.provider) ? 0 : undefined),
        remainingTokens: assistantTask.quotaSnapshot?.remainingTokens ?? assistantRouting.remainingTokens,
      });
      appendQueryEvidenceCard(response.data?.queryEvidence);
      appendTaskProgressCard(response.task);
      if (response.data?.fileEntry?.id) {
        replacePendingAttachment(response.data.fileEntry);
        refreshFileRecognitionRows(response.data.fileEntry);
      }
      if (response.data?.documentCategoryChanged === true && typeof window.loadDatabase === 'function') {
        await window.loadDatabase();
      }
      conversation.push({ role: 'assistant', content: response.content });
      if (conversation.length > MAX_CONVERSATION_MESSAGES) conversation = conversation.slice(-MAX_CONVERSATION_MESSAGES);
      if (api.saveAiAssistantConversation) {
        api.saveAiAssistantConversation({ conversationId, summary: conversationSummary, messages: conversation })
          .then(saved => { conversationSummary = String(saved?.conversation?.summary || conversationSummary); })
          .catch((error) => {
            console.error('AI 会话保存失败', error);
            notify('会话保存失败，请重试', 'error');
          });
      }
      appendConfirmationCard(response.action);
      runAssistantAction(response.action);
      const drawerStatus = document.getElementById('aiDrawerModelStatus');
      if (drawerStatus) {
        if (response.provider === 'system') drawerStatus.textContent = '系统数据已核对';
        else if (response.provider === 'local') drawerStatus.textContent = '本地 AI 已回复';
        else {
          const routing = response.routing || {};
          const tier = routing.taskTier === 'deep' ? '深度 AI' : '基础 AI';
          drawerStatus.textContent = `在线 ${tier} 已回复`;
        }
      }
      pendingAttachments = [];
      renderPendingAttachments();
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
    if (!window.communityFoundationFloating) configureSafeDrawerToggle(toggle, drawer);
    const toggleText = toggle.querySelector('.ai-btn-text');
    if (toggleText) toggleText.textContent = 'AI 助理';
    toggle.title = '快捷唤起 AI 助理 (Ctrl+K)';
    if (!toggle.dataset.aiConversationRestoreBound) {
      toggle.dataset.aiConversationRestoreBound = 'true';
      toggle.addEventListener('click', () => restoreAssistantConversation());
    }

    const heading = drawer.querySelector('.ai-drawer-header h3');
    if (heading) heading.textContent = 'AI 助理';
    const headerActions = drawer.querySelector('.ai-assistant-header-actions') || drawer.querySelector('.ai-drawer-header > div');
    if (headerActions && !drawer.querySelector('[data-ai-assistant-records-link]')) {
      const recordsLink = document.createElement('button');
      recordsLink.type = 'button'; recordsLink.className = 'ai-records-link'; recordsLink.dataset.aiAssistantRecordsLink = 'true';
      recordsLink.textContent = '操作记录';
      recordsLink.addEventListener('click', openAssistantOperations);
      headerActions.appendChild(recordsLink);
    }
    if (headerActions && !drawer.querySelector('[data-ai-assistant-new-chat]')) {
      const memories = document.createElement('button');
      memories.type = 'button'; memories.className = 'ai-records-link'; memories.dataset.aiAssistantMemories = 'true';
      memories.textContent = '记忆';
      memories.addEventListener('click', openAssistantMemories);
      headerActions.appendChild(memories);
      const newChat = document.createElement('button');
      newChat.type = 'button'; newChat.className = 'ai-records-link'; newChat.dataset.aiAssistantNewChat = 'true';
      newChat.textContent = '新建对话';
      newChat.addEventListener('click', startNewAssistantConversation);
      headerActions.appendChild(newChat);
    }
    const chat = document.getElementById('aiDesktopChatContainer');
    if (chat) {
      chat.innerHTML = assistantGreeting();
    }
    restoreAssistantConversation();
    const input = document.getElementById('aiDesktopInputText');
    if (input) input.placeholder = '例如：某位居民这年度共计发了多少钱？请填写档案中的真实姓名';
    const chipDefinitions = [
      ['📊 年度发放查询', '查询某位居民这年度共计发了多少钱？'],
      ["👥 查询居民", "查询某位居民的居民档案"],
      ['💰 资金发放', '打开资金发放中心'],
    ];
    const chips = drawer.querySelector('.ai-assistant-shortcuts') || drawer.querySelector('.ai-drawer-footer > div:first-child');
    if (chips) {
      chips.replaceChildren(...chipDefinitions.map(([label, prompt]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ai-chip'; button.textContent = label;
        button.addEventListener('click', () => { if (input) { input.value = prompt; input.focus(); } });
        return button;
      }));
    }
    const footer = drawer.querySelector('.ai-drawer-footer');
    const inputRow = document.getElementById('aiDesktopInputText')?.parentElement;
    if (footer && inputRow && !footer.querySelector('[data-ai-attachment-tools]')) {
      const tools = document.createElement('div');
      tools.className = 'ai-attachment-tools'; tools.dataset.aiAttachmentTools = 'true';
      const toolDefinitions = [
        ['file', '上传文件', 'Word、PDF、Excel 和文本', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'],
        ['image', '上传图片', 'PNG、JPG 等图片', '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'],
        ['scan', '扫描材料', '扫描版 PDF 或图片', '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'],
      ];
      for (const [kind, label, title, icon] of toolDefinitions) {
        const attach = document.createElement('button');
        attach.type = 'button'; attach.className = `ai-attachment-tool-button${kind === 'file' ? ' is-primary' : ''}`;
        attach.dataset.aiAttachmentKind = kind; attach.title = title;
        attach.innerHTML = `<svg class="ai-attachment-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span><span class="ai-attachment-busy-label">识别中</span>`;
        attach.addEventListener('click', () => selectAssistantFiles(kind));
        tools.appendChild(attach);
      }
      const tray = document.createElement('div');
      tray.className = 'ai-attachment-tray'; tray.dataset.aiAttachmentTray = 'true'; tray.hidden = true;
      footer.insertBefore(tools, inputRow);
      footer.insertBefore(tray, inputRow);
    }
    if (input && !input.dataset.aiAutoGrowBound) {
      input.dataset.aiAutoGrowBound = 'true';
      const resizeInput = () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 92)}px`;
      };
      input.addEventListener('input', resizeInput);
      resizeInput();
    }
    if (!window.communityFoundationFloating) installDrawerDrag(drawer);
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
    if (window.communityFoundationNavigate) {
      await window.communityFoundationNavigate({ type: 'navigate', target: 'tab-ai-assistant-records' });
      await renderAssistantOperations();
      return;
    }
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
    if (operation.type === 'resident_group_update') return `${operation.object?.name || '居民'}：居民组 ${operation.before?.group || '未填写'} → ${operation.after?.group || '未填写'}`;
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
    if (operation.type === 'settings_village_name_update') return `村居名称：${operation.before?.villageName || '未填写'} → ${operation.after?.villageName || '未填写'}`;
    if (operation.type === 'document_category_assign') return `档案归类：${operation.object?.name || '未命名材料'} → ${operation.after?.category || '待归档'}`;
    if (operation.type === 'document_category_create_and_archive') return `新建分类并归档：${operation.object?.name || '未命名材料'} → ${operation.after?.category || '新分类'}`;
    if (operation.type === 'certificate_template_draft_create') return `建立证明模板草稿：${operation.object?.name || '未命名模板'}`;
    if (operation.type === 'certificate_template_update') return `更新证明模板版本：${operation.object?.name || '未命名模板'}`;
    if (operation.type === 'certificate_template_reuse') return `复用证明模板：${operation.object?.name || '未命名模板'}`;
    if (operation.type === 'undo') return `${operation.object?.name || '对象'}：已恢复上一项 AI 修改`;
    return operation.object?.name ? `处理${operation.object.name}的业务资料` : 'AI 业务操作';
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
        const meta = document.createElement('span'); meta.textContent = `${operation.module || 'AI 助理'} · ${formatOperationTime(operation.completedAt || operation.createdAt)} · ${window.AiOperationPresentation.status(operation)} · 操作人：${window.AiOperationPresentation.operator(operation)}`;
        textBlock.append(title, meta); row.appendChild(textBlock);
        const actions = document.createElement('div'); actions.className = 'ai-operation-row-actions';
        const details = document.createElement('button'); details.type = 'button'; details.className = 'btn btn-outline ai-operation-details'; details.textContent = '查看详情';
        details.addEventListener('click', () => {
          const expanded = row.classList.toggle('is-expanded');
          details.textContent = expanded ? '收起详情' : '查看详情';
        });
        actions.appendChild(details);
        const detailBlock = document.createElement('div'); detailBlock.className = 'ai-operation-detail';
        const table = document.createElement('table');
        const head = document.createElement('thead'); head.innerHTML = '<tr><th>修改内容</th><th>修改前</th><th>修改后</th></tr>';table.appendChild(head);
        const body = document.createElement('tbody');
        for (const change of window.AiOperationPresentation.changes(operation)) {
          const tr=document.createElement('tr');for(const value of [change.label,change.before,change.after]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}body.appendChild(tr);
        }
        table.appendChild(body);
        if(body.children.length)detailBlock.appendChild(table);
        else { const note=document.createElement('p');note.textContent='此历史记录未提供可展示的字段对照，可根据上方操作说明核对。';detailBlock.appendChild(note); }
        if(operation.error){const error=document.createElement('p');error.textContent='执行未成功，请核对资料或权限后重试。';detailBlock.appendChild(error);}
        if(operation.permissionDecision?.allowed){const permission=document.createElement('p');permission.className='ai-operation-check is-passed';permission.textContent='权限核对：执行前已通过当前账号权限检查。';detailBlock.appendChild(permission);}
        if(Array.isArray(operation.confirmationHistory)&&operation.confirmationHistory.length){const confirmation=document.createElement('p');confirmation.className='ai-operation-check is-passed';confirmation.textContent=`确认记录：已完成 ${operation.confirmationHistory.length} 次确认。`;detailBlock.appendChild(confirmation);}
        if(operation.verification?.message){const verification=document.createElement('p');verification.className=`ai-operation-check ${operation.verification.passed?'is-passed':'is-failed'}`;verification.textContent=`${operation.verification.passed?'自动复核通过':'需要人工核对'}：${operation.verification.message}`;detailBlock.appendChild(verification);}
        const reason=window.AiOperationPresentation.undoReason(operation);
        if(reason){const note=document.createElement('p');note.className='ai-operation-unavailable';note.textContent=reason;detailBlock.appendChild(note);}
        row.appendChild(detailBlock);
        if (operation.recoverable && operation.status === 'completed') {
          const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'btn btn-outline ai-operation-undo'; undo.textContent = '撤销此操作';
          undo.addEventListener('click', async () => {
            const impact = window.AiOperationPresentation.changes(operation).map(item => `${item.label}：${item.after} → ${item.before}`).join('\n');
            const message = `确认撤销“${operationSummary(operation)}”吗？\n${impact}\n若相关资料已有新的修改，系统会拒绝覆盖并提示。`;
            const confirmed = window.communityConfirm ? await window.communityConfirm(message, '撤销本次操作') : window.confirm(message);
            if (!confirmed) return;
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

  function injectAssistantOperationsDestination(container) {
    if (document.getElementById('tab-ai-assistant-records')) return;
    const menu = document.querySelector('.sidebar-menu');
    const reference = menu?.querySelector('[data-target="tab-work-management"]') || menu?.firstElementChild;
    if (menu && !container) {
      const button = document.createElement('button'); button.className = 'menu-item'; button.dataset.target = 'tab-ai-assistant-records';
      button.innerHTML = '<span aria-hidden="true">🤖</span><span>AI 助理记录</span>';
      button.addEventListener('click', openAssistantOperations);
      reference?.insertAdjacentElement('afterend', button) || menu.appendChild(button);
    }
    const section = document.createElement('section'); section.className = 'tab-content hidden'; section.id = 'tab-ai-assistant-records';
    section.innerHTML = "<div class=\"ai-operation-center\"><div class=\"ai-operation-header\"><div><h2>AI 助理记录</h2><p>用中文记录 AI 实际完成的归档、草稿和业务修改。可恢复项目会显示撤销按钮。</p></div><button type=\"button\" class=\"btn btn-outline\" data-ai-assistant-operation-refresh>刷新</button></div><div class=\"ai-operation-filters\"><input type=\"search\" placeholder=\"按对象或操作搜索\" data-ai-assistant-operation-keyword><select data-ai-assistant-operation-module><option value=\"\">全部模块</option><option value=\"电子档案柜\">电子档案柜</option><option value=\"证明管理\">证明管理</option><option value=\"居民一户一档\">居民一户一档</option><option value=\"土地承包确权\">土地承包确权</option><option value=\"民情记录\">民情记录</option><option value=\"村里值班\">村里值班</option><option value=\"工作管理\">工作管理</option><option value=\"党员管理\">党员管理</option><option value=\"证明开具\">证明开具</option><option value=\"资金发放中心\">资金发放中心</option><option value=\"财务收支\">财务收支</option><option value=\"系统设置\">系统设置</option><option value=\"系统备份\">系统备份</option><option value=\"账号权限\">账号权限</option></select><select data-ai-assistant-operation-type><option value=\"\">全部操作</option><option value=\"document_category_assign\">档案归类</option><option value=\"document_category_create_and_archive\">创建分类并归档</option><option value=\"certificate_template_draft_create\">建立模板草稿</option><option value=\"certificate_template_update\">更新模板版本</option><option value=\"certificate_template_reuse\">复用现有模板</option><option value=\"resident_phone_update\">修改手机号</option><option value=\"resident_address_update\">修改住址</option><option value=\"resident_group_update\">调整居民组</option><option value=\"land_parcel_create\">登记地块</option><option value=\"visit_record_create\">新增民情记录</option><option value=\"duty_schedule_add\">新增值班安排</option><option value=\"work_item_create\">新建工作</option><option value=\"work_item_status_update\">调整工作状态</option><option value=\"work_item_soft_delete\">删除工作</option><option value=\"work_items_soft_delete_batch\">批量删除工作</option><option value=\"database_backup_restore\">恢复系统备份</option><option value=\"unit_member_disable\">停用成员登录</option><option value=\"certificate_record_delete\">删除证明记录</option><option value=\"document_draft_archive\">归档公文</option><option value=\"party_member_stage_update\">调整党员阶段</option><option value=\"resource_contract_create\">新建合同</option><option value=\"contract_receipt_create\">登记承包人到账</option><option value=\"finance_record_create\">登记财务收支</option><option value=\"finance_record_update\">修改财务收支</option><option value=\"finance_records_clear\">清空财务收支台账</option><option value=\"settings_village_name_update\">修改村居名称</option><option value=\"undo\">撤销操作</option></select><input type=\"date\" aria-label=\"按日期筛选\" data-ai-assistant-operation-date><select data-ai-assistant-operation-status><option value=\"\">全部状态</option><option value=\"completed\">已完成</option><option value=\"undone\">已撤销</option><option value=\"cancelled\">已取消</option><option value=\"failed\">未执行</option></select></div><div class=\"ai-operation-list\" data-ai-assistant-operation-list></div></div>";
    section.querySelector('[data-ai-assistant-operation-refresh]')?.addEventListener('click', renderAssistantOperations);
    for (const control of section.querySelectorAll('[data-ai-assistant-operation-keyword], [data-ai-assistant-operation-module], [data-ai-assistant-operation-type], [data-ai-assistant-operation-date], [data-ai-assistant-operation-status]')) {
      control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', renderAssistantOperations);
    }
    if (container) section.classList.remove('hidden');
    (container || document.querySelector('.app-main'))?.appendChild(section);
  }

  function installDrawerDrag(drawer) {
    if (drawer.dataset.dragReady === 'true') return;
    drawer.dataset.dragReady = 'true';
    const header = drawer.querySelector('.ai-drawer-header');
    if (!header) return;
    let drag = null;
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

  async function initialize({ assistantOnly = false } = {}) {
    configureDesktopAssistant();
    if (assistantOnly) {
      await api.getAiSettings().catch(() => null);
      await window.communityAiTokenStatus?.refresh();
      window.sendDesktopAiMessage = sendAiMessage;
      document.getElementById('aiDesktopSendBtn')?.addEventListener('click', () => sendAiMessage());
      document.getElementById('aiDesktopInputText')?.addEventListener('keydown', event => {
        // Enter sends; Shift+Enter keeps the native textarea newline behavior.
        // Ignore IME confirmation keystrokes so Chinese composition is not sent early.
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        sendAiMessage();
      });
      return;
    }
    injectAssistantOperationsDestination();
    buildSettingsPanel();
    const settings = await api.getAiSettings();
    document.getElementById('communityAiMode').value = settings.mode;
    await window.communityAiTokenStatus?.refresh();
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

  window.CommunityAiUi = { mountAssistant: async () => { await initialize({ assistantOnly: true }); observeAiStorageSettings(); },
    mountOperations: async container => { injectAssistantOperationsDestination(container); await renderAssistantOperations(); } };
  if (!window.communityFoundation) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }

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

  if (!window.communityFoundation) loadWorkManagementModule();
}());
