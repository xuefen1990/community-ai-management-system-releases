'use strict';

(function documentDraftingModule() {
  const api = window.api;
  if (!api) return;

  const state = {
    view: 'report',
    templates: [],
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
        <div><h2>公文拟写 <span class="header-sub-tag">AI 辅助拟写，重要内容请人工核验</span></h2><p class="text-secondary">从模板开始，主动选择参考资料，生成可追溯、可编辑的报告与合同。</p></div>
        <div class="document-header-actions"><button class="btn btn-outline" id="documentProfileBtn">我的写作偏好</button><button class="btn btn-outline" id="documentNewDraftBtn">新建公文</button><button class="btn btn-primary" id="documentSaveDraftBtn">保存草稿</button></div>
      </div>
      <div class="document-page-tabs" role="tablist"><button class="document-page-tab active" data-document-view="report">拟写报告</button><button class="document-page-tab" data-document-view="contract">拟写合同</button><button class="document-page-tab" data-document-view="history">历史记录</button></div>
      <div id="documentWorkspaceView" class="document-workspace-view">
        <div class="document-stepper"><span class="active">1 选择模板</span><i>→</i><span>2 填写内容</span><i>→</i><span>3 选择参考</span><i>→</i><span>4 生成与定稿</span></div>
        <div class="document-workspace-grid">
          <aside class="document-compose-sidebar">
            <div class="document-card"><div class="document-card-title"><span>基础信息</span><span id="documentDraftStatus" class="badge badge-info">新公文</span></div><label class="document-field-label" for="documentTemplateSelect">公文模板</label><select id="documentTemplateSelect" class="document-control"></select><div id="documentCustomTypeWrap" class="hidden"><label class="document-field-label" for="documentCustomType">自定义类型名称</label><input id="documentCustomType" class="document-control" placeholder="例如：专项简报"></div><div id="documentDynamicFields" class="document-dynamic-fields"></div><label class="document-field-label" for="documentVisibility">可见范围</label><select id="documentVisibility" class="document-control"><option value="shared">社区共享</option><option value="private">仅自己可见</option></select></div>
            <div class="document-card"><div class="document-card-title"><span>参考资料</span><span id="documentReferenceCount" class="badge badge-info">已选 0 项</span></div><p class="document-help">AI 只会使用你勾选的资料，推荐项不会自动选中。</p><div id="documentRecommendedReferences" class="document-reference-list"><div class="document-empty-small">保存草稿后可获取历史推荐</div></div><button class="btn btn-outline btn-full" id="documentRefreshRecommendationsBtn">刷新历史推荐</button><div class="document-business-picker"><select id="documentBusinessCollection" class="document-control">${Object.entries(BUSINESS_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><button class="btn btn-outline" id="documentLoadBusinessBtn">选择业务数据</button></div><div id="documentBusinessReferences" class="document-reference-list"></div></div>
          </aside>
          <main class="document-editor-panel"><div class="document-editor-toolbar"><div><button type="button" data-editor-command="bold"><b>B</b></button><button type="button" data-editor-command="insertUnorderedList">• 列表</button><button type="button" data-editor-command="justifyLeft">左对齐</button><button type="button" data-editor-command="justifyCenter">居中</button></div><span id="documentAutosaveStatus">尚未保存</span></div><div id="documentContractWarning" class="document-contract-warning hidden">合同内容由 AI 辅助生成，请重点核对主体、金额、期限、付款、违约责任和争议解决条款。</div><div id="documentEditor" class="document-editor" contenteditable="true" data-placeholder="填写左侧内容并选择参考资料，然后点击“开始 AI 拟写”"></div><div id="documentSourceSummary" class="document-source-summary hidden"></div><div class="document-editor-footer"><div><button class="btn btn-outline" id="documentCopyBtn">复制</button><button class="btn btn-outline" id="documentSaveVersionBtn">保存新版本</button><button class="btn btn-outline" id="documentPrintBtn">打印</button><button class="btn btn-outline" id="documentExportWordBtn">导出 Word</button><button class="btn btn-outline" id="documentExportPdfBtn">导出 PDF</button></div><div><button class="btn btn-outline" id="documentFinalizeBtn">标记定稿</button><button class="btn btn-primary" id="documentGenerateBtn">✦ 开始 AI 拟写</button></div></div></main>
        </div>
      </div>
      <div id="documentHistoryView" class="document-history-view hidden"><div class="document-history-filters"><input id="documentHistoryQuery" class="document-control" placeholder="搜索标题或正文"><select id="documentHistoryKind" class="document-control"><option value="">全部类型</option><option value="report">报告</option><option value="contract">合同</option></select><select id="documentHistoryStatus" class="document-control"><option value="">全部状态</option><option value="draft">草稿</option><option value="final">定稿</option></select><button class="btn btn-primary" id="documentHistorySearchBtn">查询</button></div><div id="documentHistoryList" class="document-history-list"><div class="document-empty">暂无公文记录</div></div></div>
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

  function selectedTemplate() {
    return state.templates.find((template) => template.id === document.getElementById('documentTemplateSelect')?.value) || null;
  }

  function renderFields(values = {}) {
    const template = selectedTemplate();
    const container = document.getElementById('documentDynamicFields');
    if (!template || !container) return;
    document.getElementById('documentCustomTypeWrap').classList.toggle('hidden', !template.isCustom);
    container.innerHTML = template.fields.map((field) => {
      const value = values[field.key] ?? '';
      const required = field.required ? '<em>*</em>' : '';
      const common = `class="document-control document-dynamic-input" data-field-key="${escapeHtml(field.key)}"`;
      let control;
      if (field.type === 'textarea') control = `<textarea ${common} rows="3">${escapeHtml(value)}</textarea>`;
      else if (field.type === 'select') control = `<select ${common}><option value="">请选择</option>${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
      else control = `<input ${common} type="${field.type === 'date' ? 'date' : 'text'}" value="${escapeHtml(value)}">`;
      return `<label class="document-dynamic-field"><span>${escapeHtml(field.label)}${required}</span>${control}</label>`;
    }).join('');
  }

  async function loadTemplates(kind, selectedId = null, values = {}) {
    state.templates = await callApi('listDocumentTemplates', kind);
    const select = document.getElementById('documentTemplateSelect');
    select.innerHTML = state.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    if (selectedId && state.templates.some((template) => template.id === selectedId)) select.value = selectedId;
    renderFields(values);
    updateContractWarning();
  }

  function collectFields() {
    return Object.fromEntries([...document.querySelectorAll('#documentDynamicFields [data-field-key]')].map((input) => [input.dataset.fieldKey, input.value]));
  }

  function updateReferenceCount() {
    const count = state.selectedReferences.size;
    document.getElementById('documentReferenceCount').textContent = `已选 ${count} 项`;
  }

  function updateContractWarning() {
    document.getElementById('documentContractWarning')?.classList.toggle('hidden', state.view !== 'contract');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) button.dataset.originalText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : (button.dataset.originalText || button.textContent);
  }

  function updateDraftStatus(documentValue = state.current?.document) {
    const badge = document.getElementById('documentDraftStatus');
    if (!badge) return;
    const isFinal = documentValue?.status === 'final';
    if (!documentValue) badge.textContent = '新公文';
    else badge.textContent = `${isFinal ? '已定稿' : '草稿'} · ${documentValue.visibility === 'private' ? '仅自己' : '社区共享'}`;
    const editor = document.getElementById('documentEditor');
    if (editor) editor.contentEditable = isFinal ? 'false' : 'true';
    const finalizeButton = document.getElementById('documentFinalizeBtn');
    if (finalizeButton) finalizeButton.textContent = isFinal ? '取消定稿后编辑' : '标记定稿';
    for (const id of ['documentSaveDraftBtn', 'documentSaveVersionBtn', 'documentGenerateBtn']) {
      const button = document.getElementById(id);
      if (button) button.disabled = Boolean(isFinal);
    }
  }

  async function createOrSaveDraft({ silent = false } = {}) {
    const template = selectedTemplate();
    if (!template) throw new Error('请选择公文模板');
    const fields = collectFields();
    const payload = { templateId: template.id, fields, visibility: document.getElementById('documentVisibility').value, customTypeName: document.getElementById('documentCustomType').value };
    if (!state.current) {
      state.current = await callApi('createDraftDocument', payload);
    } else {
      const updated = await callApi('saveDraftDocument', { documentId: state.current.document.id, fields, visibility: payload.visibility, contentHtml: document.getElementById('documentEditor').innerHTML, contentText: document.getElementById('documentEditor').innerText });
      state.current.document = updated;
    }
    updateDraftStatus();
    document.getElementById('documentAutosaveStatus').textContent = '已保存';
    if (!silent) showMessage('草稿已保存');
    return state.current;
  }

  async function saveEditorDraft() {
    if (!state.current) return;
    document.getElementById('documentAutosaveStatus').textContent = '保存中…';
    try {
      await createOrSaveDraft({ silent: true });
    } catch (error) {
      document.getElementById('documentAutosaveStatus').textContent = '自动保存失败，请复制正文';
      showMessage(error.message, 'error');
    }
  }

  function queueAutosave() {
    document.getElementById('documentAutosaveStatus').textContent = state.current ? '有未保存修改' : '尚未保存';
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveEditorDraft, 900);
  }

  function renderRecommendations(items) {
    const container = document.getElementById('documentRecommendedReferences');
    container.innerHTML = items.length ? items.map((item) => {
      const key = `document:${item.documentId}:${item.versionId}`;
      return `<label class="document-reference-item"><input type="checkbox" data-reference-key="${escapeHtml(key)}" ${state.selectedReferences.has(key) ? 'checked' : ''}><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.reasons.join(' · ') || '相关历史')}</small></span></label>`;
    }).join('') : '<div class="document-empty-small">没有找到相关历史公文</div>';
    items.forEach((item) => {
      const key = `document:${item.documentId}:${item.versionId}`;
      container.querySelector(`[data-reference-key="${CSS.escape(key)}"]`)?.addEventListener('change', (event) => {
        if (event.target.checked) state.selectedReferences.set(key, { type: 'document', documentId: item.documentId, versionId: item.versionId, selectedBy: 'recommended' });
        else state.selectedReferences.delete(key);
        updateReferenceCount();
      });
    });
  }

  async function refreshRecommendations() {
    await createOrSaveDraft({ silent: true });
    const items = await callApi('recommendDraftReferences', { documentId: state.current.document.id });
    renderRecommendations(items);
  }

  async function loadBusinessSources() {
    const collection = document.getElementById('documentBusinessCollection').value;
    const records = await callApi('listDraftBusinessSources', { collection });
    const container = document.getElementById('documentBusinessReferences');
    container.innerHTML = records.length ? records.map((record) => {
      const key = `business:${collection}:${record.id}`;
      return `<label class="document-reference-item"><input type="checkbox" data-business-key="${escapeHtml(key)}" ${state.selectedReferences.has(key) ? 'checked' : ''}><span><b>${escapeHtml(record.title)}</b><small>${escapeHtml(record.summary)}</small></span></label>`;
    }).join('') : '<div class="document-empty-small">该分类暂无可选数据</div>';
    records.forEach((record) => {
      const key = `business:${collection}:${record.id}`;
      container.querySelector(`[data-business-key="${CSS.escape(key)}"]`)?.addEventListener('change', (event) => {
        if (event.target.checked) state.selectedReferences.set(key, { type: 'business', collection, recordIds: [record.id], title: `${BUSINESS_LABELS[collection]}：${record.title}`, selectedBy: 'user' });
        else state.selectedReferences.delete(key);
        updateReferenceCount();
      });
    });
  }

  function showSourceSummary(result) {
    const container = document.getElementById('documentSourceSummary');
    const references = result.references || [];
    container.classList.toggle('hidden', references.length === 0 && !(result.omitted || []).length);
    container.innerHTML = `<b>本稿参考来源</b>${references.length ? `<ul>${references.map((reference) => `<li>${escapeHtml(reference.sourceTitle)}</li>`).join('')}</ul>` : '<p>本稿未引用历史或业务资料。</p>'}${(result.omitted || []).length ? `<p class="document-warning-text">因上下文长度限制，未使用：${result.omitted.map((item) => escapeHtml(item.sourceTitle)).join('、')}</p>` : ''}`;
  }

  async function generateDocument() {
    const button = document.getElementById('documentGenerateBtn');
    setBusy(button, true, 'AI 正在拟写…');
    try {
      await createOrSaveDraft({ silent: true });
      const result = await callApi('generateDraftDocument', { documentId: state.current.document.id, selectedReferences: [...state.selectedReferences.values()] });
      document.getElementById('documentEditor').innerHTML = result.version.contentHtml;
      state.current.document.currentVersionId = result.version.id;
      state.current.versions = [result.version, ...(state.current.versions || [])];
      document.getElementById('documentAutosaveStatus').textContent = `AI 初稿 · 版本 ${result.version.versionNumber}`;
      showSourceSummary(result);
      showMessage('AI 初稿已生成，请核验并修改');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function saveVersion() {
    if (!state.current) throw new Error('请先保存草稿');
    await createOrSaveDraft({ silent: true });
    const version = await callApi('saveDraftVersion', { documentId: state.current.document.id, contentHtml: document.getElementById('documentEditor').innerHTML, contentText: document.getElementById('documentEditor').innerText, changeOrigin: 'human', changeSummary: '人工保存版本' });
    state.current.document.currentVersionId = version.id;
    state.current.versions = [version, ...(state.current.versions || [])];
    document.getElementById('documentAutosaveStatus').textContent = `已保存版本 ${version.versionNumber}`;
    showMessage('新版本已保存');
  }

  async function finalizeDocument() {
    if (!state.current) throw new Error('请先保存并生成文稿');
    if (!window.confirm('定稿后将用于学习你的写作偏好。确认已完成内容核验吗？')) return;
    await saveVersion();
    state.current.document = await callApi('finalizeDraftDocument', state.current.document.id);
    updateDraftStatus();
    showMessage('文稿已定稿，并更新个人写作偏好');
  }

  async function toggleFinalStatus() {
    if (state.current?.document.status !== 'final') return finalizeDocument();
    if (!window.confirm('取消定稿后才能继续编辑。原定稿版本仍会保留，确认继续吗？')) return;
    state.current.document = await callApi('reopenDraftDocument', state.current.document.id);
    updateDraftStatus();
    showMessage('已取消定稿，可以继续编辑并保存新版本');
  }

  async function exportCurrent(format) {
    if (!state.current) throw new Error('请先保存文稿');
    if (state.current.document.status !== 'final') await saveVersion();
    const result = await callApi('exportDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId, format });
    if (!result.canceled) showMessage(`${format === 'pdf' ? 'PDF' : 'Word'} 已导出`);
  }

  async function printCurrent() {
    if (!state.current) throw new Error('请先保存文稿');
    if (state.current.document.status !== 'final') await saveVersion();
    await callApi('printDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId });
  }

  async function copyCurrent() {
    const text = document.getElementById('documentEditor').innerText.trim();
    if (!text) throw new Error('当前没有可复制的正文');
    await navigator.clipboard.writeText(text);
    showMessage('正文已复制');
  }

  function historyCard(item) {
    return `<article class="document-history-card"><div class="document-history-main"><div class="document-history-title"><span class="badge ${item.documentKind === 'contract' ? 'badge-warning' : 'badge-info'}">${item.documentKind === 'contract' ? '合同' : '报告'}</span><b>${escapeHtml(item.title)}</b></div><p>${escapeHtml(item.templateId)} · ${item.status === 'final' ? '已定稿' : '草稿'} · ${item.visibility === 'private' ? '仅自己' : '社区共享'}</p><small>更新于 ${escapeHtml(new Date(item.updatedAt).toLocaleString('zh-CN'))}</small></div><div class="document-history-actions"><button class="btn btn-outline" data-history-action="open" data-document-id="${escapeHtml(item.id)}">继续编辑</button><button class="btn btn-outline" data-history-action="report" data-document-id="${escapeHtml(item.id)}">基于此文写报告</button><button class="btn btn-outline" data-history-action="contract" data-document-id="${escapeHtml(item.id)}">基于此文写合同</button><button class="btn btn-outline" data-history-action="word" data-document-id="${escapeHtml(item.id)}">Word</button><button class="btn btn-outline" data-history-action="archive" data-document-id="${escapeHtml(item.id)}">归档</button></div></article>`;
  }

  async function loadHistory() {
    const filters = { query: document.getElementById('documentHistoryQuery').value, documentKind: document.getElementById('documentHistoryKind').value, status: document.getElementById('documentHistoryStatus').value };
    const items = await callApi('listDraftDocuments', filters);
    document.getElementById('documentHistoryList').innerHTML = items.length ? items.map(historyCard).join('') : '<div class="document-empty">暂无符合条件的公文记录</div>';
  }

  async function openDocument(documentId) {
    state.current = await callApi('getDraftDocument', documentId);
    state.view = state.current.document.documentKind;
    state.selectedReferences.clear();
    document.querySelectorAll('.document-page-tab').forEach((button) => button.classList.toggle('active', button.dataset.documentView === state.view));
    document.getElementById('documentHistoryView').classList.add('hidden');
    document.getElementById('documentWorkspaceView').classList.remove('hidden');
    await loadTemplates(state.view, state.current.document.templateId, state.current.document.fieldSnapshot);
    document.getElementById('documentVisibility').value = state.current.document.visibility;
    document.getElementById('documentCustomType').value = state.current.document.customTypeName || '';
    const currentVersion = state.current.versions.find((version) => version.id === state.current.document.currentVersionId);
    document.getElementById('documentEditor').innerHTML = state.current.document.workingContentHtml || currentVersion?.contentHtml || '';
    for (const reference of state.current.document.pendingReferences || []) {
      const key = reference.type === 'document' ? `document:${reference.documentId}:${reference.versionId}` : `business:${reference.collection}:${reference.recordIds?.[0]}`;
      state.selectedReferences.set(key, reference);
    }
    updateReferenceCount();
    updateDraftStatus();
    updateContractWarning();
  }

  async function handleHistoryAction(event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const { historyAction: action, documentId } = button.dataset;
    try {
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
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function switchView(view) {
    state.view = view;
    document.querySelectorAll('.document-page-tab').forEach((button) => button.classList.toggle('active', button.dataset.documentView === view));
    document.getElementById('documentHistoryView').classList.toggle('hidden', view !== 'history');
    document.getElementById('documentWorkspaceView').classList.toggle('hidden', view === 'history');
    if (view === 'history') await loadHistory();
    else {
      if (state.current?.document.documentKind !== view) await resetDraft(view);
      updateContractWarning();
    }
  }

  async function resetDraft(kind = state.view === 'contract' ? 'contract' : 'report') {
    state.view = kind;
    state.current = null;
    state.selectedReferences.clear();
    document.getElementById('documentEditor').innerHTML = '';
    document.getElementById('documentSourceSummary').classList.add('hidden');
    document.getElementById('documentRecommendedReferences').innerHTML = '<div class="document-empty-small">保存草稿后可获取历史推荐</div>';
    document.getElementById('documentBusinessReferences').innerHTML = '';
    document.getElementById('documentCustomType').value = '';
    await loadTemplates(kind);
    updateReferenceCount();
    updateDraftStatus(null);
    document.getElementById('documentAutosaveStatus').textContent = '尚未保存';
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
    if (!document.getElementById('tab-document-drafting')) {
      const certificate = document.getElementById('tab-certificate');
      certificate?.insertAdjacentHTML('beforebegin', sectionMarkup());
    }
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

  async function initialize() {
    injectPage();
    if (!document.getElementById('tab-document-drafting')) return;
    bind('documentTemplateSelect', 'change', () => renderFields());
    bind('documentSaveDraftBtn', 'click', () => createOrSaveDraft());
    bind('documentNewDraftBtn', 'click', () => resetDraft());
    bind('documentRefreshRecommendationsBtn', 'click', refreshRecommendations);
    bind('documentLoadBusinessBtn', 'click', loadBusinessSources);
    bind('documentGenerateBtn', 'click', generateDocument);
    bind('documentSaveVersionBtn', 'click', saveVersion);
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
    document.querySelectorAll('.document-page-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.documentView).catch((error) => showMessage(error.message, 'error'))));
    document.getElementById('documentHistoryList').addEventListener('click', handleHistoryAction);
    document.getElementById('documentEditor').addEventListener('input', queueAutosave);
    document.querySelectorAll('[data-editor-command]').forEach((button) => button.addEventListener('click', () => { document.execCommand(button.dataset.editorCommand, false); document.getElementById('documentEditor').focus(); queueAutosave(); }));
    document.querySelector('[data-target="tab-document-drafting"]')?.addEventListener('click', () => { if (!state.templates.length) resetDraft('report').catch((error) => showMessage(error.message, 'error')); });
    await resetDraft('report');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}());
