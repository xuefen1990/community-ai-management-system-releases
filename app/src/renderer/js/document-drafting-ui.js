'use strict';

(function documentDraftingModule() {
  const api = window.api;
  if (!api) return;

  const state = {
    view: 'workspace',
    preferredKind: 'auto',
    current: null,
    selectedReferences: new Map(),
    autosaveTimer: null,
  };

  const BUSINESS_LABELS = {
    personnel: '村民档案', households: '家庭档案', partyMembers: '党员信息',
    visitRecords: '民情记录', dutyRecords: '值班记录', finances: '财务记录',
    landParcel: '土地记录', certificates: '证明记录', documents: '电子档案',
  };

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function sectionMarkup() {
    return `<section class="tab-content hidden" id="tab-document-drafting">
      <div class="content-header document-drafting-header">
        <div><h2>公文拟写 <span class="header-sub-tag">像聊天一样描述，AI 帮你形成公文</span></h2><p class="text-secondary">一句话生成报告或合同，不满意可以继续补充要求，旧版本自动保留。</p></div>
        <div class="document-header-actions"><button class="btn btn-outline" id="documentProfileBtn">我的写作偏好</button><button class="btn btn-outline" id="documentHistoryBtn">历史记录</button><button class="btn btn-primary" id="documentNewDraftBtn">＋ 新建公文</button></div>
      </div>
      <div id="documentWorkspaceView" class="document-workspace-view">
        <div class="document-conversation-grid">
          <aside class="document-chat-panel">
            <div class="document-chat-header"><div><strong>🤖 AI 公文助手</strong><small>直接说清楚事情，我会追问必要信息</small></div><span id="documentDraftStatus" class="badge badge-info">新公文</span></div>
            <div class="document-kind-switch" aria-label="公文类型">
              <button class="active" id="documentKindAuto" data-document-kind="auto">自动识别</button>
              <button id="documentKindReport" data-document-kind="report">报告</button>
              <button id="documentKindContract" data-document-kind="contract">合同</button>
            </div>
            <div id="documentConversationMessages" class="document-conversation-messages"></div>
            <div id="documentUnderstandingSummary" class="document-understanding-summary hidden"></div>
            <div class="document-chat-composer">
              <label for="documentConversationInput" id="documentConversationLabel">描述你想拟写的公文</label>
              <textarea id="documentConversationInput" rows="5" placeholder="例如：写一份申请拨付小杨庄过渡房费用的请示。东七组占地40余亩，每亩900元，合计36000元，请求按期拨付。"></textarea>
              <div class="document-composer-actions"><span id="documentReferenceCount">未引用历史资料</span><button class="btn btn-primary" id="documentConversationSendBtn">✦ 生成公文</button></div>
              <p class="document-chat-hint">生成后可在这里继续告诉 AI 怎么修改，例如“语气更正式，再补充付款依据”。</p>
            </div>
            <details class="document-advanced-settings">
              <summary>参考资料与高级设置</summary>
              <label class="document-field-label" for="documentVisibility">可见范围</label>
              <select id="documentVisibility" class="document-control"><option value="shared">社区共享</option><option value="private">仅自己可见</option></select>
              <label class="document-field-label" for="documentHistoryReferenceQuery">手动查找历史公文</label>
              <div class="document-inline-picker"><input id="documentHistoryReferenceQuery" class="document-control" placeholder="输入标题或事项关键词"><button class="btn btn-outline" id="documentRefreshRecommendationsBtn">查找</button></div>
              <div id="documentRecommendedReferences" class="document-reference-list"></div>
              <label class="document-field-label" for="documentBusinessCollection">选择业务资料</label>
              <div class="document-inline-picker"><select id="documentBusinessCollection" class="document-control">${Object.entries(BUSINESS_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><button class="btn btn-outline" id="documentLoadBusinessBtn">加载</button></div>
              <div id="documentBusinessReferences" class="document-reference-list"></div>
            </details>
          </aside>
          <main class="document-editor-panel">
            <div class="document-editor-toolbar"><div><button type="button" data-editor-command="bold"><b>B</b></button><button type="button" data-editor-command="insertUnorderedList">• 列表</button><button type="button" data-editor-command="justifyLeft">左对齐</button><button type="button" data-editor-command="justifyCenter">居中</button></div><span id="documentAutosaveStatus">等待描述</span></div>
            <div id="documentContractWarning" class="document-contract-warning hidden">合同由 AI 辅助生成，请重点核对主体、金额、期限、付款、违约责任和争议解决条款。</div>
            <div id="documentEditor" class="document-editor" contenteditable="true" data-placeholder="在左侧描述需求后，生成的公文会出现在这里"></div>
            <div id="documentSourceSummary" class="document-source-summary hidden"></div>
            <div class="document-editor-footer"><div><button class="btn btn-outline" id="documentCopyBtn">复制</button><button class="btn btn-outline" id="documentSaveVersionBtn">保存新版本</button><button class="btn btn-outline" id="documentVersionsBtn">版本记录</button><button class="btn btn-outline" id="documentPrintBtn">打印</button><button class="btn btn-outline" id="documentExportWordBtn">导出 Word</button><button class="btn btn-outline" id="documentExportPdfBtn">导出 PDF</button></div><button class="btn btn-primary" id="documentFinalizeBtn">标记定稿</button></div>
          </main>
        </div>
      </div>
      <div id="documentHistoryView" class="document-history-view hidden"><div class="document-history-heading"><button class="btn btn-outline" id="documentBackToWorkspaceBtn">← 返回拟写</button><h3>历史记录</h3></div><div class="document-history-filters"><input id="documentHistoryQuery" class="document-control" placeholder="搜索标题或正文"><select id="documentHistoryKind" class="document-control"><option value="">全部类型</option><option value="report">报告</option><option value="contract">合同</option></select><select id="documentHistoryStatus" class="document-control"><option value="">全部状态</option><option value="draft">草稿</option><option value="final">定稿</option></select><button class="btn btn-primary" id="documentHistorySearchBtn">查询</button></div><div id="documentHistoryList" class="document-history-list"><div class="document-empty">暂无公文记录</div></div></div>
      <div id="documentVersionsPanel" class="document-profile-panel hidden"><div class="document-profile-card"><div class="document-card-title"><span>版本记录</span><button class="btn btn-text" id="documentVersionsCloseBtn">关闭</button></div><div id="documentVersionsList" class="document-version-list"></div></div></div>
      <div id="documentProfilePanel" class="document-profile-panel hidden"><div class="document-profile-card"><div class="document-card-title"><span>我的写作偏好</span><button class="btn btn-text" id="documentProfileCloseBtn">关闭</button></div><p id="documentProfileSummary" class="document-help">尚未从定稿中学习写作偏好。</p><label class="document-field-label">常用语气</label><select id="documentProfileTone" class="document-control"><option value="正式务实">正式务实</option><option value="简洁明确">简洁明确</option><option value="严谨规范">严谨规范</option></select><label class="document-field-label">常用称谓</label><input id="documentProfileSalutation" class="document-control" placeholder="例如：尊敬的各位领导："><label class="document-field-label">常用结尾</label><input id="documentProfileClosing" class="document-control" placeholder="例如：特此报告。"><div class="document-profile-actions"><button class="btn btn-outline" id="documentProfileResetBtn">重置偏好</button><button class="btn btn-primary" id="documentProfileSaveBtn">保存偏好</button></div></div></div>
    </section>`;
  }

  function showMessage(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else if (type === 'error') window.alert(message);
  }

  async function callApi(name, ...args) {
    if (typeof api[name] !== 'function') throw new Error('当前版本缺少公文拟写接口');
    const response = await api[name](...args);
    if (response?.ok === false) throw new Error(response.error || '操作失败');
    return response?.ok === true && Object.hasOwn(response, 'data') ? response.data : response;
  }

  function referenceKey(reference) {
    return reference.type === 'document'
      ? `document:${reference.documentId}:${reference.versionId}`
      : `business:${reference.collection}:${reference.recordIds?.join(',')}`;
  }

  function updateReferenceCount() {
    const count = state.selectedReferences.size;
    document.getElementById('documentReferenceCount').textContent = count ? `已确认引用 ${count} 项资料` : '未引用历史资料';
  }

  function updateKindUi(kind = state.preferredKind) {
    state.preferredKind = kind;
    document.querySelectorAll('[data-document-kind]').forEach((button) => button.classList.toggle('active', button.dataset.documentKind === kind));
    const effectiveKind = state.current?.document?.documentKind || (kind === 'auto' ? null : kind);
    document.getElementById('documentContractWarning')?.classList.toggle('hidden', effectiveKind !== 'contract');
  }

  function updateDraftStatus() {
    const documentValue = state.current?.document;
    const badge = document.getElementById('documentDraftStatus');
    const isFinal = documentValue?.status === 'final';
    badge.textContent = !documentValue ? '新公文' : `${documentValue.documentKind === 'contract' ? '合同' : '报告'} · ${isFinal ? '已定稿' : '草稿'}`;
    document.getElementById('documentEditor').contentEditable = isFinal ? 'false' : 'true';
    document.getElementById('documentFinalizeBtn').textContent = isFinal ? '取消定稿后编辑' : '标记定稿';
    document.getElementById('documentConversationSendBtn').disabled = Boolean(isFinal);
    document.getElementById('documentSaveVersionBtn').disabled = Boolean(isFinal);
    document.getElementById('documentConversationLabel').textContent = documentValue?.workingContentText ? '继续告诉 AI 怎么修改' : '描述你想拟写的公文';
    document.getElementById('documentConversationInput').placeholder = documentValue?.workingContentText
      ? '例如：语气更正式，补充付款依据；或者把这份报告改成合同……'
      : '例如：写一份申请拨付小杨庄过渡房费用的请示。东七组占地40余亩，每亩900元，合计36000元，请求按期拨付。';
    document.getElementById('documentConversationSendBtn').textContent = documentValue?.workingContentText ? '↗ 重新生成' : '✦ 生成公文';
    updateKindUi(state.preferredKind);
  }

  function welcomeMarkup() {
    return `<div class="document-message assistant"><div class="document-message-avatar">AI</div><div class="document-message-bubble"><b>把要办的事情直接告诉我</b><p>我会自动判断是报告还是合同。信息不够时，我只追问必要内容；生成后你可以继续补充要求。</p><div class="document-prompt-examples"><button data-example="写一份申请拨付过渡房费用的请示，说明事项、金额和拨付要求。">费用请示</button><button data-example="写一份社区保洁服务合同，需要包含金额、期限、付款和违约责任。">服务合同</button></div></div></div>`;
  }

  function referenceCandidatesMarkup(items = []) {
    return items.length ? `<div class="document-reference-candidates">${items.map((item) => `<button class="document-reference-candidate" data-confirm-document-id="${escapeHtml(item.documentId)}" data-confirm-version-id="${escapeHtml(item.versionId)}" data-confirm-title="${escapeHtml(item.title)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml((item.reasons || []).join(' · ') || '历史公文')}</small><span>确认引用</span></button>`).join('')}</div>` : '';
  }

  function renderMessages(messages = state.current?.messages || []) {
    const container = document.getElementById('documentConversationMessages');
    if (!messages.length) {
      container.innerHTML = welcomeMarkup();
      return;
    }
    container.innerHTML = messages.map((message) => {
      const user = message.role === 'user';
      return `<div class="document-message ${user ? 'user' : 'assistant'}"><div class="document-message-avatar">${user ? '我' : 'AI'}</div><div class="document-message-bubble"><p>${escapeHtml(message.content).replaceAll('\n', '<br>')}</p>${message.messageType === 'generated' ? '<small>右侧已更新为新版本</small>' : ''}${referenceCandidatesMarkup(message.referenceCandidates)}</div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  function renderSummary(values = state.current?.document?.conversationState?.fields || {}) {
    const container = document.getElementById('documentUnderstandingSummary');
    const labels = { title: '标题', period: '时间', recipient: '报送对象', partyA: '甲方', partyB: '乙方', subject: '事项/标的', amount: '金额', term: '期限', payment: '付款', keyPoints: '重点内容' };
    const entries = Object.entries(values || {}).filter(([key, value]) => labels[key] && value && value !== '待补充').slice(0, 7);
    container.classList.toggle('hidden', entries.length === 0);
    container.innerHTML = entries.length ? `<div class="document-summary-title"><span>AI 已理解</span><small>如有错误，直接在对话中纠正</small></div><div class="document-summary-chips">${entries.map(([key, value]) => `<span><b>${labels[key]}</b>${escapeHtml(String(value).slice(0, 52))}</span>`).join('')}</div>` : '';
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) button.dataset.originalText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : (button.dataset.originalText || button.textContent);
  }

  function showSourceSummary(result) {
    const container = document.getElementById('documentSourceSummary');
    const references = result.references || [];
    container.classList.toggle('hidden', references.length === 0 && !(result.omitted || []).length);
    container.innerHTML = `<b>本稿参考来源</b>${references.length ? `<ul>${references.map((reference) => `<li>${escapeHtml(reference.sourceTitle)}</li>`).join('')}</ul>` : '<p>本稿未引用历史或业务资料。</p>'}${(result.omitted || []).length ? `<p class="document-warning-text">因上下文长度限制，未使用：${result.omitted.map((item) => escapeHtml(item.sourceTitle)).join('、')}</p>` : ''}`;
  }

  async function submitConversation(messageOverride = null) {
    const input = document.getElementById('documentConversationInput');
    const message = messageOverride === null ? input.value.trim() : messageOverride;
    if (!message && state.selectedReferences.size === 0) throw new Error('请先描述需要拟写或修改的内容');
    const button = document.getElementById('documentConversationSendBtn');
    setBusy(button, true, 'AI 正在处理…');
    document.getElementById('documentAutosaveStatus').textContent = 'AI 正在理解并拟写…';
    try {
      const result = await callApi('converseDraftDocument', {
        documentId: state.current?.document?.id || null,
        message,
        preferredKind: state.preferredKind,
        confirmedReferences: [...state.selectedReferences.values()],
      });
      const versions = state.current?.versions || [];
      state.current = {
        document: result.document,
        versions: result.version ? [result.version, ...versions] : versions,
        references: state.current?.references || [],
        messages: result.messages || [],
      };
      input.value = '';
      renderMessages();
      renderSummary(result.summary);
      updateDraftStatus();
      if (result.version) {
        document.getElementById('documentEditor').innerHTML = result.version.contentHtml;
        document.getElementById('documentAutosaveStatus').textContent = `AI 已生成 · 版本 ${result.version.versionNumber}`;
        showSourceSummary(result);
        showMessage('公文已生成，可以继续补充修改要求');
      } else if (result.action === 'reference_confirmation') {
        document.getElementById('documentAutosaveStatus').textContent = '等待确认历史资料';
      } else {
        document.getElementById('documentAutosaveStatus').textContent = '等待补充信息';
      }
      if (result.document?.visibility !== document.getElementById('documentVisibility').value) {
        state.current.document = await callApi('saveDraftDocument', { documentId: result.document.id, visibility: document.getElementById('documentVisibility').value });
      }
    } catch (error) {
      document.getElementById('documentAutosaveStatus').textContent = state.current?.document?.workingContentText ? '现有正文已保留，可重试' : '生成失败，输入内容仍保留';
      showMessage(error.message, 'error');
    } finally {
      setBusy(button, false);
      updateDraftStatus();
    }
  }

  async function confirmReference(button) {
    const reference = { type: 'document', documentId: button.dataset.confirmDocumentId, versionId: button.dataset.confirmVersionId, selectedBy: 'user' };
    state.selectedReferences.set(referenceKey(reference), reference);
    updateReferenceCount();
    button.disabled = true;
    button.querySelector('span').textContent = '已确认';
    await submitConversation('');
  }

  async function refreshRecommendations() {
    if (!state.current?.document?.id) throw new Error('请先描述事项，再查找相关历史公文');
    const query = document.getElementById('documentHistoryReferenceQuery').value.trim();
    const items = await callApi('recommendDraftReferences', { documentId: state.current.document.id, query: { title: query, keyPoints: query } });
    const container = document.getElementById('documentRecommendedReferences');
    container.innerHTML = items.length ? items.slice(0, 6).map((item) => `<label class="document-reference-item"><input type="checkbox" data-reference-document-id="${escapeHtml(item.documentId)}" data-reference-version-id="${escapeHtml(item.versionId)}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml((item.reasons || []).join(' · ') || '相关历史')}</small></span></label>`).join('') : '<div class="document-empty-small">没有找到相关历史公文</div>';
  }

  async function loadBusinessSources() {
    const collection = document.getElementById('documentBusinessCollection').value;
    const records = await callApi('listDraftBusinessSources', { collection });
    const container = document.getElementById('documentBusinessReferences');
    container.innerHTML = records.length ? records.map((record) => `<label class="document-reference-item"><input type="checkbox" data-business-id="${escapeHtml(record.id)}"><span><b>${escapeHtml(record.title)}</b><small>${escapeHtml(record.summary)}</small></span></label>`).join('') : '<div class="document-empty-small">该分类暂无可选数据</div>';
  }

  async function saveEditorDraft() {
    if (!state.current?.document) return;
    document.getElementById('documentAutosaveStatus').textContent = '保存中…';
    try {
      state.current.document = await callApi('saveDraftDocument', {
        documentId: state.current.document.id,
        visibility: document.getElementById('documentVisibility').value,
        contentHtml: document.getElementById('documentEditor').innerHTML,
        contentText: document.getElementById('documentEditor').innerText,
      });
      document.getElementById('documentAutosaveStatus').textContent = '已自动保存';
    } catch (error) {
      document.getElementById('documentAutosaveStatus').textContent = '自动保存失败，请复制正文';
      showMessage(error.message, 'error');
    }
  }

  function queueAutosave() {
    if (!state.current?.document) return;
    document.getElementById('documentAutosaveStatus').textContent = '有未保存修改';
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveEditorDraft, 900);
  }

  async function saveVersion() {
    if (!state.current?.document) throw new Error('请先生成公文');
    await saveEditorDraft();
    const version = await callApi('saveDraftVersion', { documentId: state.current.document.id, contentHtml: document.getElementById('documentEditor').innerHTML, contentText: document.getElementById('documentEditor').innerText, changeOrigin: 'human', changeSummary: '人工保存版本' });
    state.current.document.currentVersionId = version.id;
    state.current.versions = [version, ...(state.current.versions || [])];
    document.getElementById('documentAutosaveStatus').textContent = `已保存版本 ${version.versionNumber}`;
    showMessage('新版本已保存');
  }

  async function toggleFinalStatus() {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status === 'final') {
      if (!window.confirm('取消定稿后才能继续编辑，确认继续吗？')) return;
      state.current.document = await callApi('reopenDraftDocument', state.current.document.id);
      updateDraftStatus();
      return;
    }
    if (!window.confirm('确认已经人工核验内容并标记定稿吗？')) return;
    await saveVersion();
    state.current.document = await callApi('finalizeDraftDocument', state.current.document.id);
    updateDraftStatus();
    showMessage('文稿已定稿，并更新写作偏好');
  }

  async function copyCurrent() {
    const text = document.getElementById('documentEditor').innerText.trim();
    if (!text) throw new Error('当前没有可复制的正文');
    await navigator.clipboard.writeText(text);
    showMessage('正文已复制');
  }

  async function exportCurrent(format) {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status !== 'final') await saveVersion();
    const result = await callApi('exportDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId, format });
    if (!result.canceled) showMessage(`${format === 'pdf' ? 'PDF' : 'Word'} 已导出`);
  }

  async function printCurrent() {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status !== 'final') await saveVersion();
    await callApi('printDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId });
  }

  function showVersions() {
    if (!state.current?.document) throw new Error('当前还没有版本记录');
    const items = state.current.versions || [];
    document.getElementById('documentVersionsList').innerHTML = items.length ? items.map((version) => `<div class="document-version-item"><div><b>版本 ${version.versionNumber}</b><small>${escapeHtml(version.changeSummary || '')} · ${escapeHtml(new Date(version.createdAt).toLocaleString('zh-CN'))}</small></div><button class="btn btn-outline" data-restore-version-id="${escapeHtml(version.id)}">恢复此版本</button></div>`).join('') : '<div class="document-empty-small">暂无版本</div>';
    document.getElementById('documentVersionsPanel').classList.remove('hidden');
  }

  async function restoreVersion(versionId) {
    await callApi('restoreDraftVersion', { documentId: state.current.document.id, versionId });
    document.getElementById('documentVersionsPanel').classList.add('hidden');
    await openDocument(state.current.document.id);
    showMessage('已恢复为一个新的版本');
  }

  function historyCard(item) {
    return `<article class="document-history-card"><div class="document-history-main"><div class="document-history-title"><span class="badge ${item.documentKind === 'contract' ? 'badge-warning' : 'badge-info'}">${item.documentKind === 'contract' ? '合同' : '报告'}</span><b>${escapeHtml(item.title)}</b></div><p>${item.status === 'final' ? '已定稿' : '草稿'} · ${item.visibility === 'private' ? '仅自己' : '社区共享'}</p><small>更新于 ${escapeHtml(new Date(item.updatedAt).toLocaleString('zh-CN'))}</small></div><div class="document-history-actions"><button class="btn btn-outline" data-history-action="open" data-document-id="${escapeHtml(item.id)}">继续编辑</button><button class="btn btn-outline" data-history-action="report" data-document-id="${escapeHtml(item.id)}">基于此文写报告</button><button class="btn btn-outline" data-history-action="contract" data-document-id="${escapeHtml(item.id)}">基于此文写合同</button><button class="btn btn-outline" data-history-action="word" data-document-id="${escapeHtml(item.id)}">Word</button><button class="btn btn-outline" data-history-action="archive" data-document-id="${escapeHtml(item.id)}">归档</button></div></article>`;
  }

  async function loadHistory() {
    const filters = { query: document.getElementById('documentHistoryQuery').value, documentKind: document.getElementById('documentHistoryKind').value, status: document.getElementById('documentHistoryStatus').value };
    const items = await callApi('listDraftDocuments', filters);
    document.getElementById('documentHistoryList').innerHTML = items.length ? items.map(historyCard).join('') : '<div class="document-empty">暂无符合条件的公文记录</div>';
  }

  function switchView(view) {
    state.view = view;
    document.getElementById('documentWorkspaceView').classList.toggle('hidden', view !== 'workspace');
    document.getElementById('documentHistoryView').classList.toggle('hidden', view !== 'history');
    if (view === 'history') return loadHistory();
    return Promise.resolve();
  }

  async function openDocument(documentId) {
    state.current = await callApi('getDraftDocument', documentId);
    state.preferredKind = state.current.document.documentKind;
    state.selectedReferences.clear();
    for (const reference of state.current.document.pendingReferences || []) state.selectedReferences.set(referenceKey(reference), reference);
    const currentVersion = state.current.versions.find((version) => version.id === state.current.document.currentVersionId);
    document.getElementById('documentEditor').innerHTML = state.current.document.workingContentHtml || currentVersion?.contentHtml || '';
    document.getElementById('documentVisibility').value = state.current.document.visibility;
    if (!state.current.messages?.length) state.current.messages = [{ role: 'assistant', messageType: 'text', content: '已打开历史草稿。你可以继续告诉我怎么修改，或者直接编辑右侧正文。' }];
    renderMessages();
    renderSummary();
    updateReferenceCount();
    updateDraftStatus();
    document.getElementById('documentAutosaveStatus').textContent = `已打开 · ${state.current.versions.length} 个版本`;
    await switchView('workspace');
  }

  async function handleHistoryAction(event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const { historyAction: action, documentId } = button.dataset;
    if (action === 'open') await openDocument(documentId);
    else if (action === 'report' || action === 'contract') {
      const result = await callApi('createDraftFromHistory', { sourceDocumentId: documentId, targetTemplateId: action === 'report' ? 'report-work' : 'contract-service' });
      await openDocument(result.document.id);
    } else if (action === 'word') {
      const result = await callApi('exportDraftDocument', { documentId, format: 'docx' });
      if (!result.canceled) showMessage('Word 已导出');
    } else if (action === 'archive' && window.confirm('确认归档这份公文吗？')) {
      await callApi('archiveDraftDocument', documentId);
      await loadHistory();
    }
  }

  function resetDraft() {
    state.current = null;
    state.preferredKind = 'auto';
    state.selectedReferences.clear();
    document.getElementById('documentConversationInput').value = '';
    document.getElementById('documentEditor').innerHTML = '';
    document.getElementById('documentSourceSummary').classList.add('hidden');
    document.getElementById('documentUnderstandingSummary').classList.add('hidden');
    document.getElementById('documentRecommendedReferences').innerHTML = '';
    document.getElementById('documentBusinessReferences').innerHTML = '';
    renderMessages([]);
    updateReferenceCount();
    updateDraftStatus();
    document.getElementById('documentAutosaveStatus').textContent = '等待描述';
    return switchView('workspace');
  }

  async function openProfile() {
    const profile = await callApi('getWritingProfile');
    document.getElementById('documentProfileSummary').textContent = profile ? `已根据 ${profile.finalizedCount || 0} 份定稿学习，最后更新：${profile.updatedAt ? new Date(profile.updatedAt).toLocaleString('zh-CN') : '暂无'}` : '尚未从定稿中学习写作偏好。';
    document.getElementById('documentProfileTone').value = profile?.preferredTone || '正式务实';
    document.getElementById('documentProfileSalutation').value = profile?.preferredSalutation || '';
    document.getElementById('documentProfileClosing').value = profile?.preferredClosing || '';
    document.getElementById('documentProfilePanel').classList.remove('hidden');
  }

  async function saveProfile() {
    await callApi('saveWritingProfile', { preferredTone: document.getElementById('documentProfileTone').value, preferredSalutation: document.getElementById('documentProfileSalutation').value, preferredClosing: document.getElementById('documentProfileClosing').value });
    showMessage('写作偏好已保存');
    document.getElementById('documentProfilePanel').classList.add('hidden');
  }

  function bind(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, async (domEvent) => {
      try { await handler(domEvent); } catch (error) { showMessage(error.message, 'error'); }
    });
  }

  function injectPage() {
    if (!document.getElementById('tab-document-drafting')) document.getElementById('tab-certificate')?.insertAdjacentHTML('beforebegin', sectionMarkup());
    const quickRow = document.querySelector('.wb-quick-buttons-row');
    if (quickRow && !document.getElementById('workbenchDocumentDraftingBtn')) {
      const button = document.createElement('button');
      button.className = 'action-card-btn';
      button.id = 'workbenchDocumentDraftingBtn';
      button.innerHTML = '<span class="icon-circle bg-green">文</span><span>公文拟写</span>';
      button.addEventListener('click', () => window.switchTab?.('tab-document-drafting'));
      quickRow.appendChild(button);
    }
  }

  function bindReferenceLists() {
    document.getElementById('documentRecommendedReferences').addEventListener('change', (event) => {
      const input = event.target.closest('[data-reference-document-id]');
      if (!input) return;
      const reference = { type: 'document', documentId: input.dataset.referenceDocumentId, versionId: input.dataset.referenceVersionId, selectedBy: 'user' };
      if (input.checked) state.selectedReferences.set(referenceKey(reference), reference);
      else state.selectedReferences.delete(referenceKey(reference));
      updateReferenceCount();
    });
    document.getElementById('documentBusinessReferences').addEventListener('change', (event) => {
      const input = event.target.closest('[data-business-id]');
      if (!input) return;
      const collection = document.getElementById('documentBusinessCollection').value;
      const reference = { type: 'business', collection, recordIds: [input.dataset.businessId], title: BUSINESS_LABELS[collection], selectedBy: 'user' };
      if (input.checked) state.selectedReferences.set(referenceKey(reference), reference);
      else state.selectedReferences.delete(referenceKey(reference));
      updateReferenceCount();
    });
  }

  async function initialize() {
    injectPage();
    if (!document.getElementById('tab-document-drafting')) return;
    bind('documentConversationSendBtn', 'click', () => submitConversation());
    bind('documentNewDraftBtn', 'click', resetDraft);
    bind('documentHistoryBtn', 'click', () => switchView('history'));
    bind('documentBackToWorkspaceBtn', 'click', () => switchView('workspace'));
    bind('documentRefreshRecommendationsBtn', 'click', refreshRecommendations);
    bind('documentLoadBusinessBtn', 'click', loadBusinessSources);
    bind('documentSaveVersionBtn', 'click', saveVersion);
    bind('documentVersionsBtn', 'click', showVersions);
    bind('documentVersionsCloseBtn', 'click', () => document.getElementById('documentVersionsPanel').classList.add('hidden'));
    bind('documentFinalizeBtn', 'click', toggleFinalStatus);
    bind('documentCopyBtn', 'click', copyCurrent);
    bind('documentPrintBtn', 'click', printCurrent);
    bind('documentExportWordBtn', 'click', () => exportCurrent('docx'));
    bind('documentExportPdfBtn', 'click', () => exportCurrent('pdf'));
    bind('documentHistorySearchBtn', 'click', loadHistory);
    bind('documentProfileBtn', 'click', openProfile);
    bind('documentProfileCloseBtn', 'click', () => document.getElementById('documentProfilePanel').classList.add('hidden'));
    bind('documentProfileSaveBtn', 'click', saveProfile);
    bind('documentProfileResetBtn', 'click', async () => { if (window.confirm('重置写作偏好不会删除历史公文，确认继续吗？')) { await callApi('resetWritingProfile'); await openProfile(); } });
    document.querySelectorAll('[data-document-kind]').forEach((button) => button.addEventListener('click', () => updateKindUi(button.dataset.documentKind)));
    document.getElementById('documentConversationInput').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitConversation().catch((error) => showMessage(error.message, 'error')); });
    document.getElementById('documentConversationMessages').addEventListener('click', (event) => {
      const example = event.target.closest('[data-example]');
      if (example) document.getElementById('documentConversationInput').value = example.dataset.example;
      const candidate = event.target.closest('[data-confirm-document-id]');
      if (candidate) confirmReference(candidate).catch((error) => showMessage(error.message, 'error'));
    });
    document.getElementById('documentHistoryList').addEventListener('click', (event) => handleHistoryAction(event).catch((error) => showMessage(error.message, 'error')));
    document.getElementById('documentVersionsList').addEventListener('click', (event) => { const button = event.target.closest('[data-restore-version-id]'); if (button) restoreVersion(button.dataset.restoreVersionId).catch((error) => showMessage(error.message, 'error')); });
    document.getElementById('documentEditor').addEventListener('input', queueAutosave);
    document.querySelectorAll('[data-editor-command]').forEach((button) => button.addEventListener('click', () => { document.execCommand(button.dataset.editorCommand, false); document.getElementById('documentEditor').focus(); queueAutosave(); }));
    document.querySelector('[data-target="tab-document-drafting"]')?.addEventListener('click', () => { if (!document.getElementById('documentConversationMessages').innerHTML) resetDraft(); });
    bindReferenceLists();
    await resetDraft();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}());
