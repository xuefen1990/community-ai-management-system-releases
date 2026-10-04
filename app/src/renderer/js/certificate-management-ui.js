'use strict';

(function exposeCertificateManagementUI(root) {
  const model = () => root.CertificateManagementModel;
  const state = { host: null, activeTab: 'issue', templates: [], records: [], selectedTemplate: null, draft: null,
    candidates: {}, searches: {}, searchSequences: {}, searchErrors: {}, loading: false, message: '', messageType: '', recordFilters: { keyword: '', status: '', templateId: '', startDate: '', endDate: '' },
    templateKeyword: '', templateEditor: null, issuedRecord: null, operatorName: '', organizationName: '', aiDraft: null, aiCompletedRecord: null, aiTemplateConflict: null };
  const text = value => value == null ? '' : String(value);
  const escape = value => text(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const certificateBodyHtml = value => text(value).replaceAll(/\r\n?/gu, '\n').split(/\n+/u)
    .map(line => line.trim()).filter(Boolean).map(line => `<p>${escape(line)}</p>`).join('');
  const requestId = () => root.crypto?.randomUUID?.() || `certificate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => model().localIsoDate();
  const chineseDate = value => model().formatCertificateDate(value);

  async function api(method, path, body) {
    const result = await root.api.businessRequest({ method, path: `/api/v3${path}`, ...(body === undefined ? {} : { body }) });
    if (!result?.ok) throw new Error(result?.error?.message || result?.error || '证明资料操作失败');
    return result.data;
  }
  async function ipc(name, value) {
    const result = await root.api[name](value);
    if (!result?.ok) throw new Error(result?.error || `${name} 操作失败`);
    return result.data;
  }

  function notify(message, type = 'success') {
    state.message = message; state.messageType = type; render();
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { state.message = ''; render(); }, 4000);
  }

  async function loadTemplates() {
    const data = await api('GET', '/certificate-templates'); state.templates = data.items || [];
  }

  async function loadRecords() {
    const params = new URLSearchParams({ limit: '100' });
    if (state.recordFilters.keyword) params.set('keyword', state.recordFilters.keyword);
    if (state.recordFilters.status) params.set('status', state.recordFilters.status);
    if (state.recordFilters.templateId) params.set('templateId', state.recordFilters.templateId);
    if (state.recordFilters.startDate) params.set('startDate', state.recordFilters.startDate);
    if (state.recordFilters.endDate) params.set('endDate', state.recordFilters.endDate);
    const data = await api('GET', `/certificate-records?${params}`); state.records = data.items || [];
  }

  function freshAiDraft() {
    return { messages: [], input: '', title: '', content: '', residentNames: [], subjects: {}, candidates: {}, recommendedTemplateId: '',
      draftMode: 'temporary', manualValues: {}, system: { organizationName: state.organizationName, issuedDate: today() },
      needsMoreInfo: false, questions: [], loading: false, error: '', changeSummary: '', sourceMaterial: null, updatedAt: '' };
  }

  function aiForStorage() {
    const draft = state.aiDraft || freshAiDraft();
    return { messages: draft.messages, title: draft.title, content: draft.content, residentNames: draft.residentNames, subjects: draft.subjects,
      candidates: draft.candidates, recommendedTemplateId: draft.recommendedTemplateId, draftMode: draft.draftMode, manualValues: draft.manualValues,
      system: draft.system, needsMoreInfo: draft.needsMoreInfo, questions: draft.questions, changeSummary: draft.changeSummary,
      sourceMaterial: draft.sourceMaterial };
  }

  function scheduleAiSave() {
    clearTimeout(scheduleAiSave.timer);
    scheduleAiSave.timer = setTimeout(() => api('PUT', '/certificate-ai-draft', aiForStorage()).catch(error => {
      state.aiDraft.error = `草稿自动保存失败：${error.message}`; render();
    }), 350);
  }

  async function loadAiDraft() {
    const data = await api('GET', '/certificate-ai-draft');
    const defaults = freshAiDraft();
    state.aiDraft = { ...defaults, ...(data.draft || {}), system: { ...defaults.system, ...(data.draft?.system || {}) } };
  }

  function activeAiTemplate() {
    return state.templates.find(item => item.id === state.aiDraft?.recommendedTemplateId) || null;
  }

  function aiPreviewContent() {
    const draft = state.aiDraft || freshAiDraft();
    let content = String(draft.content || '在左侧说明需要开具的证明和基本情况，AI 拟写后将在这里显示。');
    const replacements = {
      村民姓名: draft.subjects?.person1?.name, 身份证号: draft.subjects?.person1?.idCard, 性别: draft.subjects?.person1?.gender,
      出生日期: draft.subjects?.person1?.birthDate, 村民小组: draft.subjects?.person1?.villageGroup, 户号: draft.subjects?.person1?.householdNo,
      常住地址: draft.subjects?.person1?.address, 第二村民姓名: draft.subjects?.person2?.name, 第二居民: draft.subjects?.person2?.name,
      第二村民身份证号: draft.subjects?.person2?.idCard, 第二居民身份证号: draft.subjects?.person2?.idCard,
      第三村民姓名: draft.subjects?.person3?.name, 第三村民身份证号: draft.subjects?.person3?.idCard,
      ...(draft.manualValues || {}),
    };
    for (const [label, value] of Object.entries(replacements)) if (value != null && text(value)) content = content.split(`{${label}}`).join(text(value));
    return content;
  }

  async function findAiResidentCandidates(names) {
    const entries = await Promise.all((names || []).slice(0, 6).map(async (name, index) => {
      const data = await api('GET', `/certificate-residents?keyword=${encodeURIComponent(name)}`);
      return [`person${index + 1}`, data.items || []];
    }));
    state.aiDraft.candidates = Object.fromEntries(entries);
  }

  async function sendAiCertificateMessage(message) {
    const content = text(message || state.aiDraft?.input);
    if (!content || state.aiDraft?.loading) return;
    state.aiDraft.input = ''; state.aiDraft.error = ''; state.aiDraft.loading = true;
    state.aiDraft.messages.push({ role: 'user', content }); render(); scheduleAiSave();
    try {
      const templates = state.templates.filter(item => !item.aiTemporary).map(item => ({ id: item.id, name: item.name, category: item.category,
        title: item.title, content: item.content, fields: item.fields }));
      const result = await root.api.draftCertificateWithAi({ messages: state.aiDraft.messages, templates });
      const actualTokens = Number(result.routing?.actualTokens || result.usage?.total_tokens || 0);
      root.communityAiTokenStatus?.record({ actualTokens: actualTokens || (result.routing?.provider === 'local' ? 0 : actualTokens), remainingTokens: result.routing?.remainingTokens ?? result.quotaSnapshot?.remainingTokens });
      state.aiDraft.messages.push({ role: 'assistant', content: result.reply, actualTokens });
      Object.assign(state.aiDraft, { title: result.title || state.aiDraft.title, content: result.content || state.aiDraft.content,
        residentNames: result.residentNames || [], recommendedTemplateId: result.recommendedTemplateId || '', draftMode: result.draftMode || 'temporary',
        manualValues: result.manualValues || {}, needsMoreInfo: Boolean(result.needsMoreInfo), questions: result.questions || [], changeSummary: result.changeSummary || '', error: '' });
      await findAiResidentCandidates(state.aiDraft.residentNames);
    } catch (error) { state.aiDraft.error = error.message; }
    finally { state.aiDraft.loading = false; scheduleAiSave(); render(); }
  }

  function activeVersion() {
    const template = state.selectedTemplate; if (!template) return null;
    return template.versions?.find(item => item.versionNumber === state.draft?.templateVersion) || template.versions?.at(-1) || template;
  }

  function selectTemplate(id, preserveSubjects = false) {
    const template = state.templates.find(item => item.id === id); if (!template) return;
    const oldSubjects = preserveSubjects ? state.draft?.subjects || {} : {};
    state.selectedTemplate = template; state.draft = model().createCertificateDraft(template, {
      subjects: oldSubjects, values: {}, system: { issuedDate: today(), organizationName: state.organizationName, operatorName: state.operatorName }
    });
    state.searches = {}; state.candidates = {}; state.searchSequences = {}; state.searchErrors = {}; state.issuedRecord = null; render();
  }

  function templateChooser() {
    const keyword = state.templateKeyword.trim().toLocaleLowerCase();
    const active = state.templates.filter(item => !item.aiTemporary && item.status === 'active' && (!keyword || `${item.name} ${item.category}`.toLocaleLowerCase().includes(keyword)));
    return `<section class="cm-template-chooser"><div class="cm-section-heading"><div><span class="cm-kicker">第一步</span><h2>选择要开具的证明</h2></div><label class="cm-template-search"><input data-template-search value="${escape(state.templateKeyword)}" placeholder="搜索证明名称或分类"><span>共 ${active.length} 个可用模板</span></label></div>
      <div class="cm-template-list">${active.map(item => `<button class="cm-template-card ${state.selectedTemplate?.id === item.id ? 'is-active' : ''}" data-action="select-template" data-id="${escape(item.id)}">
        <strong>${escape(item.name)}</strong><span>${escape(item.category || '其他证明')} · 第 ${item.currentVersion || 1} 版</span></button>`).join('')}</div></section>`;
  }

  function candidateList(subjectKey) {
    const candidates = state.candidates[subjectKey] || [];
    if (state.searchErrors[subjectKey]) return `<div class="cm-candidate-message is-error">${escape(state.searchErrors[subjectKey])}</div>`;
    if (!text(state.searches[subjectKey]).trim()) return '';
    if (!candidates.length) return '<div class="cm-candidate-message">没有找到符合条件的居民，可继续输入身份证号缩小范围。</div>';
    return `<div class="cm-candidates" role="listbox">${candidates.map(item => `<button data-action="choose-resident" data-subject="${escape(subjectKey)}" data-id="${escape(item.id)}"><strong>${escape(item.name)}</strong><span>${escape(item.idCardHint || '身份证号未登记')}</span><em>${escape(item.villageGroup || '未登记村民小组')}</em></button>`).join('')}</div>`;
  }

  function subjectDisplayFields(subjectKey) {
    const version = activeVersion();
    return (version?.fields || []).filter(field => {
      if (field.source === 'manual' || field.source === 'system' || field.type === 'resident' || /\.name$/u.test(field.key || '')) return false;
      if (field.subjectKey === subjectKey || text(field.key).startsWith(`${subjectKey}.`)) return true;
      return subjectKey === 'person1' && ['household', 'land'].includes(field.source);
    });
  }

  function subjectBlock(subject) {
    const selected = state.draft?.subjects?.[subject.key];
    const visibleFields = selected ? subjectDisplayFields(subject.key) : [];
    const missingRequiredArchive = visibleFields.some(field => field.required && !text(fieldValue(field)));
    return `<section class="cm-form-section" data-subject="${escape(subject.key)}"><div class="cm-section-title"><div><span class="cm-step-dot"></span>${escape(subject.label)}</div>${selected ? '<span class="cm-source cm-source-archive">来自一户一档</span>' : ''}</div>
      ${selected ? `<div class="cm-selected-resident"><div><strong>${escape(selected.name)}</strong><span>已从一户一档选入</span></div>
        <button data-action="reselect-resident" data-subject="${escape(subject.key)}">重新选择</button></div>
        ${visibleFields.length ? `<div class="cm-readonly-grid cm-needed-fields">${visibleFields.map(field => `<label><span>${escape(field.label)}</span><input value="${escape(fieldValue(field) || '未登记')}" readonly></label>`).join('')}</div>` : ''}
        ${(!selected.name || missingRequiredArchive) ? '<div class="cm-field-warning">本证明需要的档案资料不完整，请先到“一户一档”更正后重新选择。</div>' : ''}
        <button class="cm-text-action" data-action="open-resident" data-id="${escape(selected.id || '')}">去一户一档查看或更正</button>`
      : `<label class="cm-resident-search"><span>输入姓名、身份证号或户号</span><input data-resident-search="${escape(subject.key)}" value="${escape(state.searches[subject.key] || '')}" autocomplete="off" placeholder="输入第一个字即可实时搜索"></label>
        <div class="cm-candidate-slot" data-candidate-slot="${escape(subject.key)}">${candidateList(subject.key)}</div>
        <button class="cm-text-action" data-action="temporary-resident" data-subject="${escape(subject.key)}">档案里没有？临时人员开具</button>`}
    </section>`;
  }

  function fieldValue(field) { return model().resolveFieldValue(field, state.draft || {}); }
  function manualField(field) {
    const value = state.draft?.values?.[field.key] ?? '';
    const required = field.required ? '<b>*</b>' : '';
    if (field.type === 'textarea') return `<label class="cm-field cm-span-2"><span>${escape(field.label)}${required}</span><textarea data-field="${escape(field.key)}" placeholder="请输入${escape(field.label)}">${escape(value)}</textarea></label>`;
    if (field.type === 'select' && Array.isArray(field.options)) return `<label class="cm-field"><span>${escape(field.label)}${required}</span><select data-field="${escape(field.key)}"><option value="">请选择</option>${field.options.map(option => `<option ${text(value) === text(option) ? 'selected' : ''}>${escape(option)}</option>`).join('')}</select></label>`;
    return `<label class="cm-field"><span>${escape(field.label)}${required}</span><input type="${field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}" data-field="${escape(field.key)}" value="${escape(value)}" placeholder="请输入${escape(field.label)}"></label>`;
  }

  function issueWorkspace() {
    if (!state.selectedTemplate || !state.draft) return `<div class="cm-empty"><span>📄</span><h3>请先选择上方的证明类型</h3><p>选好后，系统会自动生成需要填写的内容。</p></div>`;
    const version = activeVersion(); const validation = model().validateCertificateDraft(state.draft, version); const preview = model().renderCertificateContent(version, state.draft);
    const manual = (version.fields || []).filter(field => field.source === 'manual');
    return `<div class="cm-workspace"><div class="cm-form-column"><div class="cm-workspace-heading"><div><span class="cm-kicker">第二步</span><h2>填写并核对资料</h2></div><span class="cm-version">第 ${version.versionNumber || 1} 版</span></div>
      ${(version.subjects || []).map(subjectBlock).join('')}
      ${manual.length ? `<section class="cm-form-section"><div class="cm-section-title"><div><span class="cm-step-dot"></span>需要人工填写</div><span class="cm-source cm-source-manual">人工填写</span></div><div class="cm-field-grid">${manual.map(manualField).join('')}</div></section>` : ''}
      <section class="cm-form-section"><div class="cm-section-title"><div><span class="cm-step-dot"></span>证明落款</div><span class="cm-source cm-source-system">默认带入，可修改</span></div><div class="cm-field-grid"><label class="cm-field"><span>署名</span><input data-system-field="organizationName" value="${escape(state.draft.system?.organizationName || state.organizationName)}"></label><label class="cm-field"><span>日期</span><input type="date" data-system-field="issuedDate" value="${escape(state.draft.system?.issuedDate || today())}"></label></div></section>
      <section class="cm-check-panel ${validation.ok ? 'is-ok' : ''}"><strong>${validation.ok ? '✓ 资料已填写完整，可以开具' : `还需完成 ${validation.errors.length} 项`}</strong>${validation.ok ? '' : `<ul>${validation.errors.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`}</section></div>
      <aside class="cm-preview-column"><div class="cm-preview-head"><div><span class="cm-kicker">第三步</span><h2>A4 实时预览</h2></div><button data-action="print-preview">打印预览</button></div>
        <article class="cm-a4"><h1>${escape(preview.title)}</h1><div data-preview-content>${certificateBodyHtml(preview.content)}</div><footer><span data-preview-organization>${escape(state.draft.system?.organizationName || '')}</span><br><span data-preview-date>${escape(chineseDate(state.draft.system?.issuedDate || ''))}</span></footer></article></aside></div>
      <div class="cm-actionbar"><div><strong>${escape(state.selectedTemplate.name)}</strong><span>${state.issuedRecord ? `已保存：${escape(state.issuedRecord.internalRecordNo)}` : validation.ok ? '等待确认开具' : '请先补充必填资料'}</span></div><div><button data-action="save-draft">保存草稿</button><button data-action="print-preview">打印预览</button><button class="cm-primary" data-action="issue-print" ${validation.ok ? '' : 'disabled'}>确认开具并打印</button></div></div>`;
  }

  function recordsPage() {
    return `<section class="cm-page"><div class="cm-toolbar"><div><h2>开具记录</h2><p>查询、重打、导出、复制或作废已经办理的证明。</p></div></div><div class="cm-filter cm-record-filter"><input data-testid="input-certificate-record-search" data-filter="keyword" value="${escape(state.recordFilters.keyword)}" placeholder="姓名、身份证号或内部编号"><select data-filter="templateId"><option value="">全部证明类型</option>${state.templates.map(item => `<option value="${escape(item.id)}" ${state.recordFilters.templateId === item.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><select data-filter="status"><option value="">全部状态</option><option ${state.recordFilters.status === '有效' ? 'selected' : ''}>有效</option><option ${state.recordFilters.status === 'draft' ? 'selected' : ''} value="draft">草稿</option><option ${state.recordFilters.status === '已作废' ? 'selected' : ''}>已作废</option></select><input type="date" data-filter="startDate" value="${escape(state.recordFilters.startDate)}" title="开始日期"><span>至</span><input type="date" data-filter="endDate" value="${escape(state.recordFilters.endDate)}" title="结束日期"><button data-action="search-records">查询</button></div>
      <div class="cm-table-wrap"><table><thead><tr><th>证明类型</th><th>当事人</th><th>开具日期</th><th>经办人</th><th>内部编号</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.records.length ? state.records.map(item => `<tr><td><strong>${escape(item.templateName || '历史证明')}</strong><small>${item.templateVersion ? `第 ${item.templateVersion} 版` : '历史资料'}</small></td><td>${escape(item.personName || '-')}<small>${escape(item.idCard || '')}</small></td><td>${escape(text(item.issuedAt || item.createdAt).replace('T', ' ').slice(0, 16))}</td><td>${escape(item.operatorName || '当前操作员')}</td><td>${escape(item.internalRecordNo || '-')}</td><td><span class="cm-status cm-status-${item.status === '已作废' ? 'void' : item.status === 'draft' || item.status === '草稿' ? 'draft' : 'active'}">${escape(item.status === 'draft' ? '草稿' : item.status || '有效')}</span></td><td class="cm-row-actions"><button data-action="view-record" data-id="${escape(item.id)}">查看</button><button data-action="reprint-record" data-id="${escape(item.id)}">重新打印</button><button data-action="export-record" data-format="docx" data-id="${escape(item.id)}">Word</button><button data-action="export-record" data-format="pdf" data-id="${escape(item.id)}">PDF</button><button data-action="copy-record" data-id="${escape(item.id)}">复制开具</button>${item.status !== '已作废' && item.status !== 'draft' ? `<button class="danger" data-action="void-record" data-id="${escape(item.id)}">作废</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="cm-table-empty">暂无符合条件的开具记录</td></tr>'}</tbody></table></div></section>`;
  }

  function templatePage() {
    return `<section class="cm-page"><div class="cm-toolbar"><div><h2>证明模板</h2><p>系统模板和自建模板都可以编辑，发布后形成连续版本。</p></div><div><button data-action="restore-templates">恢复系统模板</button> <button class="cm-primary" data-action="new-template">＋ 新建模板</button></div></div>
      <div class="cm-template-admin">${state.templates.filter(item => !item.aiTemporary).map(item => `<article><div><span class="cm-status ${item.status === 'draft' ? 'cm-status-draft' : item.status === 'inactive' ? 'cm-status-void' : 'cm-status-active'}">${item.status === 'draft' ? '草稿' : item.status === 'inactive' ? '已停用' : '使用中'}</span><strong>${escape(item.name)}</strong><p>${escape(item.category)} · 第 ${item.currentVersion || 1} 版 · ${item.wordPath ? '已配置 Word 版式' : '系统 A4 版式'}</p></div><div><button data-action="edit-template" data-id="${escape(item.id)}">${item.status === 'draft' ? '核对并发布' : '编辑'}</button><button data-action="copy-template" data-id="${escape(item.id)}">复制</button>${item.status === 'draft' ? '' : `<button data-action="toggle-template" data-id="${escape(item.id)}">${item.status === 'inactive' ? '启用' : '停用'}</button>`}${item.builtin ? '' : `<button class="danger" data-action="delete-template" data-id="${escape(item.id)}">删除</button>`}</div></article>`).join('')}</div></section>`;
  }

  function aiResidentPanel(subjectKey, name, index) {
    const selected = state.aiDraft?.subjects?.[subjectKey];
    const candidates = state.aiDraft?.candidates?.[subjectKey] || [];
    if (selected) return `<article class="cm-ai-resident is-confirmed"><div><span>第 ${index + 1} 位居民 · 已确认</span><strong>${escape(selected.name)}</strong><small>${escape(selected.idCard ? `${selected.idCard.slice(0, 6)}……${selected.idCard.slice(-4)}` : '身份证号未登记')} · ${escape(selected.villageGroup || '未登记村民小组')}</small></div><button data-action="ai-reselect-resident" data-subject="${escape(subjectKey)}">重新选择</button></article>`;
    return `<article class="cm-ai-resident"><div><span>AI 识别到第 ${index + 1} 位居民</span><strong>${escape(name)}</strong><small>${candidates.length === 1 ? '找到 1 位，也请人工确认' : candidates.length ? `找到 ${candidates.length} 位同名居民，请选择` : '一户一档中没有找到，请核对姓名'}</small></div></article>
      ${candidates.length ? `<div class="cm-ai-candidates">${candidates.map(item => `<button data-action="ai-choose-resident" data-subject="${escape(subjectKey)}" data-id="${escape(item.id)}"><strong>${escape(item.name)}</strong><span>${escape(item.idCardHint || '身份证号未登记')}</span><em>${escape(item.villageGroup || '未登记村民小组')}</em></button>`).join('')}</div>` : ''}`;
  }

  function aiCertificatePage() {
    state.aiDraft ||= freshAiDraft();
    const draft = state.aiDraft; const matched = activeAiTemplate();
    const residentPanels = (draft.residentNames || []).map((name, index) => aiResidentPanel(`person${index + 1}`, name, index)).join('');
    const unconfirmedResidents = (draft.residentNames || []).filter((_name, index) => !draft.subjects?.[`person${index + 1}`]);
    const ready = Boolean(text(draft.content).trim() && !draft.loading);
    return `<section class="cm-ai-page"><div class="cm-ai-page-head"><div><span class="cm-kicker">智能辅助 · 人工确认后开具</span><h2>AI 开具证明</h2><p>用日常说法说明情况，AI 会匹配模板、追问缺失信息并拟写正文。</p></div><button data-action="ai-new">＋ 新建 AI 开具</button></div>
      ${draft.sourceMaterial ? `<div class="cm-ai-source-material"><strong>已带入人工核对材料：${escape(draft.sourceMaterial.fileName || '未命名材料')}</strong><span>${escape(draft.sourceMaterial.classificationName || '证明材料')} · 仅作为拟写依据，仍需人工确认后开具</span></div>` : ''}
      <div class="cm-ai-layout"><section class="cm-ai-chat"><header><div><strong>连续对话</strong><span>未完成内容会自动保存</span></div></header><div class="cm-ai-messages">${draft.messages.length ? draft.messages.map(item => `<div class="cm-ai-message ${item.role === 'user' ? 'is-user' : 'is-assistant'}"><span>${item.role === 'user' ? '我' : 'AI 助手'}</span><p>${escape(item.content)}</p></div>`).join('') : '<div class="cm-ai-welcome"><strong>可以这样说</strong><p>虚构示例：“请核对示例居民甲和示例居民乙的亲属关系，并拟写用于办理公积金的证明。”实际办理时请填写真实姓名。</p><p>信息不够时，AI 会继续向您询问。</p></div>'}${draft.loading ? '<div class="cm-ai-thinking">AI 正在核对模板并拟写，请稍候…</div>' : ''}</div>
        ${draft.error ? `<div class="cm-ai-error">${escape(draft.error)}</div>` : ''}${draft.questions?.length ? `<div class="cm-ai-questions"><strong>还需补充</strong>${draft.questions.map(item => `<span>${escape(item)}</span>`).join('')}</div>` : ''}
        <div class="cm-ai-composer"><textarea data-ai-input placeholder="继续说明情况，或告诉 AI 需要修改哪里">${escape(draft.input || '')}</textarea><div class="cm-ai-composer-meta"><div class="cm-ai-composer-help"><span>Enter 发送 · Shift + Enter 换行</span><span class="ai-token-status-line" data-ai-token-status aria-live="polite"><span data-ai-token-used>本次消耗 — Token</span><span aria-hidden="true">·</span><span data-ai-token-remaining>余量读取中</span></span></div><button class="cm-primary" data-action="ai-send" ${draft.loading ? 'disabled' : ''}>发送</button></div></div></section>
        <section class="cm-ai-result"><div class="cm-ai-result-head"><div><strong>拟写结果</strong><span>${matched ? `已匹配模板：${escape(matched.name)}` : draft.content ? '本次临时证明' : '等待 AI 拟写'}</span></div><div><button data-action="ai-regenerate" ${draft.loading || !draft.messages.length ? 'disabled' : ''}>重新生成整篇</button></div></div>
          ${residentPanels ? `<div class="cm-ai-residents"><h3>居民确认</h3>${residentPanels}</div>` : ''}
          <div class="cm-ai-edit-preview"><div class="cm-ai-editor"><label><span>证明标题</span><input data-ai-title value="${escape(draft.title || '')}" placeholder="AI 拟写后可人工修改"></label><label><span>证明正文</span><textarea data-ai-content placeholder="AI 拟写后可人工修改">${escape(draft.content || '')}</textarea></label><div class="cm-ai-signature-fields"><label><span>署名</span><input data-ai-system-field="organizationName" value="${escape(draft.system?.organizationName || state.organizationName)}"></label><label><span>日期</span><input type="date" data-ai-system-field="issuedDate" value="${escape(draft.system?.issuedDate || today())}"></label></div>${draft.changeSummary ? `<small>本轮调整：${escape(draft.changeSummary)}</small>` : ''}</div>
            <div class="cm-ai-paper"><article class="cm-a4"><h1 data-ai-preview-title>${escape(draft.title || '证明')}</h1><div data-ai-preview-content>${certificateBodyHtml(aiPreviewContent())}</div><footer><span data-ai-preview-organization>${escape(draft.system?.organizationName || state.organizationName)}</span><br><span data-ai-preview-date>${escape(chineseDate(draft.system?.issuedDate || today()))}</span></footer></article></div></div>
          <div class="cm-ai-actions"><div><strong>${ready ? unconfirmedResidents.length ? '请核对正文；未关联居民档案仍可开具' : '请人工核对正文后开具' : '请先在左侧说明开具事项'}</strong><span>${unconfirmedResidents.length ? `${escape(unconfirmedResidents.join('、'))}尚未关联居民档案；仅作提醒，不会自动补入身份证号、手机号。` : '正式开具后会进入现有开具记录，可重新打印和作废。'}</span></div><div><button data-action="ai-issue-single" ${ready ? '' : 'disabled'}>仅本次开具</button><button class="cm-primary" data-action="ai-save-template-issue" ${ready ? '' : 'disabled'}>保存为模板并开具</button></div></div></section></div></section>`;
  }

  function editorDialog() {
    const item = state.templateEditor; if (!item) return '';
    const version = item.versions?.at(-1) || item; const fields = version.fields || [];
    return `<div class="cm-modal" role="dialog"><div class="cm-dialog"><header><div><span>模板设计</span><h2>${item.id ? '编辑证明模板' : '新建证明模板'}</h2></div><button data-action="close-template-editor">×</button></header><div class="cm-dialog-body"><div class="cm-editor-grid">
      <section><label class="cm-field"><span>模板名称 *</span><input data-template-prop="name" value="${escape(item.name || '')}"></label><label class="cm-field"><span>模板分类</span><input data-template-prop="category" value="${escape(item.category || '')}"></label><label class="cm-field"><span>证明标题 *</span><input data-template-prop="title" value="${escape(version.title || '')}"></label><label class="cm-field"><span>证明正文 *</span><textarea class="cm-content-editor" data-template-prop="content">${escape(version.content || '')}</textarea></label></section>
      <section><div class="cm-section-heading"><div><h3>字段设置</h3><p>字段可改名、排序并插入正文，工作人员无需接触代码。</p></div><button data-action="add-template-field">＋ 新增字段</button></div><div class="cm-field-editor">${fields.map((field, index) => `<div><input class="cm-field-name" data-template-field-label="${index}" value="${escape(field.label)}"><select data-template-field-source="${index}"><option value="manual" ${field.source === 'manual' ? 'selected' : ''}>人工填写</option><option value="archive" ${field.source === 'archive' ? 'selected' : ''}>居民档案</option><option value="household" ${field.source === 'household' ? 'selected' : ''}>家庭档案</option><option value="land" ${field.source === 'land' ? 'selected' : ''}>土地档案</option><option value="system" ${field.source === 'system' ? 'selected' : ''}>系统自动</option></select>${field.source === 'archive' ? `<select data-template-field-subject="${index}" title="该字段属于哪位居民"><option value="person1" ${field.subjectKey === 'person1' ? 'selected' : ''}>第一位居民</option><option value="person2" ${field.subjectKey === 'person2' ? 'selected' : ''}>第二位居民</option><option value="person3" ${field.subjectKey === 'person3' ? 'selected' : ''}>第三位居民</option></select>` : '<span></span>'}<label><input type="checkbox" data-template-field-required="${index}" ${field.required ? 'checked' : ''}>必填</label><span class="cm-field-actions"><button title="上移" data-action="move-template-field" data-direction="-1" data-index="${index}">↑</button><button title="下移" data-action="move-template-field" data-direction="1" data-index="${index}">↓</button><button title="插入正文" data-action="insert-template-field" data-index="${index}">插入</button><button class="danger" data-action="remove-template-field" data-index="${index}">删除</button></span></div>`).join('')}</div><div class="cm-word-panel"><strong>Word 正式版式</strong><span>${item.wordPath ? '已配置，可替换或移除' : '未配置，将使用系统 A4 版式'}</span><span><button data-action="upload-template-word">${item.wordPath ? '替换 Word 版式' : '上传 Word 版式'}</button>${item.wordPath ? '<button data-action="remove-template-word">移除版式</button>' : ''}</span></div></section></div></div><footer><button data-action="close-template-editor">取消</button><button data-action="save-template-draft">保存草稿</button><button class="cm-primary" data-action="publish-template">试开并发布新版本</button></footer></div></div>`;
  }

  function recordDialog(record) {
    const content = record.outputSnapshot?.content || record.content || '该历史记录没有保存正文快照。';
    return `<div class="cm-modal" role="dialog"><div class="cm-dialog cm-record-dialog"><header><div><span>${escape(record.internalRecordNo || '历史证明')}</span><h2>${escape(record.templateName || '证明详情')}</h2></div><button data-action="close-record">×</button></header><div class="cm-dialog-body"><article class="cm-a4"><h1>${escape(record.outputSnapshot?.title || record.title || record.templateName || '证明')}</h1><div>${certificateBodyHtml(content)}</div></article></div><footer><button data-action="close-record">关闭</button><button data-action="reprint-record" data-id="${escape(record.id)}">重新打印</button><button class="cm-primary" data-action="copy-record" data-id="${escape(record.id)}">复制开具</button></footer></div></div>`;
  }

  function aiTemplateConflictDialog() {
    const conflict = state.aiTemplateConflict; if (!conflict) return '';
    return `<div class="cm-modal" role="dialog" aria-modal="true"><div class="cm-dialog cm-conflict-dialog"><header><div><span>发现已有证明模板</span><h2>不再建立重复模板</h2></div><button data-action="ai-conflict-cancel">×</button></header><div class="cm-dialog-body"><p>系统发现“<strong>${escape(conflict.templateName)}</strong>”与本次 AI 拟写的证明相同或属于同一模板。</p><div class="cm-conflict-options"><article><strong>使用现有模板开具</strong><span>保留现有模板，本次证明按右侧已经核对的正文开具。</span><button data-action="ai-conflict-use" data-id="${escape(conflict.templateId)}">使用现有模板</button></article><article><strong>更新现有模板后开具</strong><span>把当前 AI 正文发布为该模板的新版本，以后继续使用新内容。</span><button class="cm-primary" data-action="ai-conflict-update" data-id="${escape(conflict.templateId)}">更新并开具</button></article></div></div><footer><button data-action="ai-conflict-cancel">取消</button></footer></div></div>`;
  }

  function render() {
    if (!state.host) return;
    state.host.innerHTML = `<main class="cm-shell"><header class="cm-header"><div><span class="cm-eyebrow">村居办事工作台</span><h1>证明管理</h1><p>选择证明、关联居民、核对内容，直接开具并打印。</p></div></header>
      <nav class="cm-tabs"><button data-tab="issue" class="${state.activeTab === 'issue' ? 'is-active' : ''}">开具证明</button><button data-tab="ai" class="${state.activeTab === 'ai' ? 'is-active' : ''}">AI 开具</button><button data-tab="records" class="${state.activeTab === 'records' ? 'is-active' : ''}">开具记录</button><button data-tab="templates" class="${state.activeTab === 'templates' ? 'is-active' : ''}">模板管理</button></nav>
      ${state.message ? `<div class="cm-toast cm-toast-${state.messageType}">${escape(state.message)}</div>` : ''}
      ${state.activeTab === 'issue' ? `${templateChooser()}${issueWorkspace()}` : state.activeTab === 'ai' ? aiCertificatePage() : state.activeTab === 'records' ? recordsPage() : templatePage()}
      ${editorDialog()}${state.viewRecord ? recordDialog(state.viewRecord) : ''}${aiTemplateConflictDialog()}</main>`;
    root.communityAiTokenStatus?.sync();
  }

  function renderAndRestoreField(selector, cursor) {
    render(); const field = state.host.querySelector(selector); if (!field) return;
    field.focus(); if (typeof field.setSelectionRange === 'function') field.setSelectionRange(cursor, cursor);
  }

  function updateResidentCandidates(subjectKey) {
    const slot = state.host?.querySelector(`[data-candidate-slot="${CSS.escape(subjectKey)}"]`);
    if (slot) slot.innerHTML = candidateList(subjectKey);
  }

  async function searchResident(subjectKey, value) {
    state.searches[subjectKey] = value; clearTimeout(searchResident.timers?.[subjectKey]); searchResident.timers ||= {};
    const keyword = text(value).trim();
    const sequence = (state.searchSequences[subjectKey] || 0) + 1; state.searchSequences[subjectKey] = sequence;
    state.searchErrors[subjectKey] = '';
    if (!keyword) { state.candidates[subjectKey] = []; updateResidentCandidates(subjectKey); return; }
    searchResident.timers[subjectKey] = setTimeout(async () => {
      try {
        const data = await api('GET', `/certificate-residents?keyword=${encodeURIComponent(keyword)}`);
        if (state.searchSequences[subjectKey] !== sequence) return;
        state.candidates[subjectKey] = data.items || []; state.searchErrors[subjectKey] = ''; updateResidentCandidates(subjectKey);
      } catch (error) {
        if (state.searchSequences[subjectKey] !== sequence) return;
        state.candidates[subjectKey] = []; state.searchErrors[subjectKey] = `查询失败：${error.message}`; updateResidentCandidates(subjectKey);
      }
    }, 120);
  }

  async function issueAiCertificate(saveReusable, duplicateDecision = '', duplicateTemplateId = '') {
    const aiDraft = state.aiDraft; if (!text(aiDraft?.content).trim()) throw new Error('请先让 AI 拟写证明正文');
    const generated = model().createTemplateFromAiDraft({ ...aiDraft, subjects: aiDraft.subjects,
      templateName: saveReusable ? aiDraft.title : `AI 临时证明 · ${aiDraft.title || '未命名'}`, category: saveReusable ? 'AI 自建模板' : 'AI 临时证明' });
    let duplicate = state.templates.find(item => item.id === duplicateTemplateId)
      || model().findDuplicateCertificateTemplate(generated, state.templates, aiDraft.recommendedTemplateId);
    if (saveReusable && duplicate && !duplicateDecision) {
      state.aiTemplateConflict = { templateId: duplicate.id, templateName: duplicate.name };
      render(); return;
    }
    if (saveReusable && !duplicate && !confirm('当前没有相同模板。系统会把真实姓名和身份证号替换成可填写字段，并建立新模板。确认保存并开具吗？')) return;
    let template = duplicate;
    if (duplicate && duplicateDecision === 'update') {
      const updated = await api('POST', `/certificate-templates/${encodeURIComponent(duplicate.id)}/publish`, { baseVersion: duplicate.version,
        changes: { title: generated.title, content: generated.content, fields: generated.fields, subjects: generated.subjects } });
      template = updated.template || updated.item;
    }
    if (!template) {
      const templatePayload = { name: generated.name, category: generated.category, title: generated.title, content: generated.content,
        fields: generated.fields, subjects: generated.subjects, status: saveReusable ? 'active' : 'inactive', aiTemporary: !saveReusable };
      const created = await api('POST', '/certificate-templates', templatePayload); template = created.template || created.item;
    }
    const values = {};
    const generatedManualValues = new Map((generated.fields || []).filter(field => field.source === 'manual')
      .map(field => [field.key, aiDraft.manualValues?.[field.label] || '']));
    const suppliedManualValues = Object.values(aiDraft.manualValues || {}).filter(value => text(value));
    const templateManualFields = (template.fields || []).filter(field => field.source === 'manual');
    for (const field of templateManualFields) values[field.key] = aiDraft.manualValues?.[field.label]
      || generatedManualValues.get(field.key) || (templateManualFields.length === 1 && suppliedManualValues.length === 1 ? suppliedManualValues[0] : '');
    const certificateDraft = model().createCertificateDraft(template, { subjects: aiDraft.subjects, values,
      system: { issuedDate: aiDraft.system?.issuedDate || today(), organizationName: aiDraft.system?.organizationName || state.organizationName, operatorName: state.operatorName } });
    const issued = await api('POST', '/certificate-records', { ...certificateDraft, issue: true, aiReviewed: true, operationUuid: requestId(), operatorName: state.operatorName,
      outputOverride: { title: aiDraft.title || generated.title, content: aiPreviewContent() }, sourceMaterial: aiDraft.sourceMaterial || null });
    state.aiCompletedRecord = issued.record || issued.item;
    state.aiTemplateConflict = null;
    await api('DELETE', '/certificate-ai-draft', {}); clearTimeout(scheduleAiSave.timer);
    state.aiDraft = freshAiDraft(); await Promise.all([loadTemplates(), loadRecords()]);
    notify(`证明已开具，内部编号：${state.aiCompletedRecord.internalRecordNo}`);
    try { await ipc('printCertificateDocument', { recordId: state.aiCompletedRecord.id }); }
    catch (error) { notify(`证明已保存，可从开具记录重新打印：${error.message}`, 'error'); }
  }

  async function handleClick(button) {
    const action = button.dataset.action;
    if (button.dataset.tab) {
      state.activeTab = button.dataset.tab;
      if (state.activeTab === 'records') await loadRecords(); if (state.activeTab === 'templates') await loadTemplates(); render(); return;
    }
    if (action === 'ai-send') { await sendAiCertificateMessage(); return; }
    if (action === 'ai-new') {
      if ((state.aiDraft?.messages?.length || state.aiDraft?.content) && !confirm('新建后会清空当前未完成的 AI 对话和草稿，确认继续吗？')) return;
      await api('DELETE', '/certificate-ai-draft', {}); clearTimeout(scheduleAiSave.timer); state.aiDraft = freshAiDraft(); state.aiCompletedRecord = null; render(); return;
    }
    if (action === 'ai-regenerate') {
      if (!confirm('重新生成会覆盖右侧当前正文，已经人工修改的内容也会被替换。确认继续吗？')) return;
      await sendAiCertificateMessage('请根据已经确认的事实重新生成整篇证明，不要编造任何资料。'); return;
    }
    if (action === 'ai-choose-resident') {
      const data = await api('GET', `/certificate-residents/${encodeURIComponent(button.dataset.id)}/context`);
      state.aiDraft.subjects[button.dataset.subject] = data.snapshot; scheduleAiSave(); render(); return;
    }
    if (action === 'ai-reselect-resident') { delete state.aiDraft.subjects[button.dataset.subject]; scheduleAiSave(); render(); return; }
    if (action === 'ai-issue-single') { await issueAiCertificate(false); return; }
    if (action === 'ai-save-template-issue') { await issueAiCertificate(true); return; }
    if (action === 'ai-conflict-cancel') { state.aiTemplateConflict = null; render(); return; }
    if (action === 'ai-conflict-use') { state.aiTemplateConflict = null; await issueAiCertificate(true, 'use', button.dataset.id); return; }
    if (action === 'ai-conflict-update') { state.aiTemplateConflict = null; await issueAiCertificate(true, 'update', button.dataset.id); return; }
    if (action === 'select-template') {
      const preserve = Boolean(state.draft && Object.keys(state.draft.subjects || {}).length && confirm('保留已经选择的居民资料吗？'));
      selectTemplate(button.dataset.id, preserve); return;
    }
    if (action === 'reselect-resident') { state.draft = model().replaceSubject(state.draft, button.dataset.subject, null); render(); return; }
    if (action === 'open-resident') { root.communityFoundationOpenResident?.(button.dataset.id); return; }
    if (action === 'choose-resident') {
      const data = await api('GET', `/certificate-residents/${encodeURIComponent(button.dataset.id)}/context`);
      state.draft = model().replaceSubject(state.draft, button.dataset.subject, data.snapshot); state.candidates[button.dataset.subject] = []; render(); return;
    }
    if (action === 'temporary-resident') {
      const name = prompt('请输入临时人员姓名'); if (!name) return; const idCard = prompt('请输入身份证号') || '';
      state.draft = model().replaceSubject(state.draft, button.dataset.subject, model().buildSubjectSnapshot({ name, idCard, temporary: true })); render(); return;
    }
    if (action === 'save-draft') {
      const payload = { ...state.draft, status: 'draft' }; const saved = state.draft.id ? await api('PATCH', `/certificate-records/${state.draft.id}`, { baseVersion: state.draft.version, changes: payload }) : await api('POST', '/certificate-records', payload);
      state.draft = { ...(saved.record || saved.item), version: saved.item?.version || saved.record?.version }; notify('草稿已保存'); return;
    }
    if (action === 'print-preview') { document.body.classList.add('cm-printing'); root.print(); setTimeout(() => document.body.classList.remove('cm-printing'), 500); return; }
    if (action === 'issue-print') {
      if (button.disabled) return; button.disabled = true;
      try {
        const operationUuid = state.draft.operationUuid || requestId(); state.draft.operationUuid = operationUuid;
        const data = state.draft.id ? await api('POST', `/certificate-records/${state.draft.id}/issue`, { baseVersion: state.draft.version, operationUuid, changes: state.draft })
          : await api('POST', '/certificate-records', { ...state.draft, issue: true, operationUuid });
        state.issuedRecord = data.record || data.item; notify(`证明已开具，内部编号：${state.issuedRecord.internalRecordNo}`);
        try { await ipc('printCertificateDocument', { recordId: state.issuedRecord.id }); }
        catch (printError) { notify(`证明已保存，可从开具记录重新打印：${printError.message}`, 'error'); }
      } catch (error) { notify(error.message, 'error'); } return;
    }
    if (action === 'search-records') { await loadRecords(); render(); return; }
    if (action === 'view-record') { state.viewRecord = state.records.find(item => item.id === button.dataset.id); render(); return; }
    if (action === 'close-record') { state.viewRecord = null; render(); return; }
    if (action === 'reprint-record') { await ipc('printCertificateDocument', { recordId: button.dataset.id }); return; }
    if (action === 'export-record') {
      const result = await ipc('exportCertificateDocument', { recordId: button.dataset.id, format: button.dataset.format });
      if (!result.canceled) notify(result.archiveWarning || `已导出${button.dataset.format === 'pdf' ? ' PDF' : ' Word'}${result.archived ? '，并归档到原 AI 任务' : ''}`, result.archiveWarning ? 'error' : 'success');
      return;
    }
    if (action === 'copy-record') { const data = await api('POST', `/certificate-records/${encodeURIComponent(button.dataset.id)}/copy`, {}); await loadTemplates(); state.draft = data.draft; state.draft.system = { issuedDate: today(), organizationName: state.organizationName, operatorName: state.operatorName, ...(state.draft.system || {}) }; state.selectedTemplate = state.templates.find(item => item.id === state.draft.templateId); state.activeTab = 'issue'; state.viewRecord = null; render(); return; }
    if (action === 'void-record') { const reason = prompt('请输入作废原因'); if (!reason) return; const record = state.records.find(item => item.id === button.dataset.id); await api('POST', `/certificate-records/${encodeURIComponent(record.id)}/void`, { baseVersion: record.version, reason }); await loadRecords(); notify('证明已作废'); return; }
    if (action === 'new-template') { state.templateEditor = model().normalizeCertificateTemplate({ id: '', name: '', category: '其他证明', title: '', content: '', fields: [] }); render(); return; }
    if (action === 'edit-template') { state.templateEditor = structuredClone(state.templates.find(item => item.id === button.dataset.id)); render(); return; }
    if (action === 'close-template-editor') { state.templateEditor = null; render(); return; }
    if (action === 'copy-template') { const item = state.templates.find(row => row.id === button.dataset.id); await api('POST', `/certificate-templates/${encodeURIComponent(item.id)}/copy`, { baseVersion: item.version }); await loadTemplates(); notify('模板副本已建立'); return; }
    if (action === 'toggle-template') { const item = state.templates.find(row => row.id === button.dataset.id); await api('POST', `/certificate-templates/${encodeURIComponent(item.id)}/status`, { baseVersion: item.version, status: item.status === 'inactive' ? 'active' : 'inactive' }); await loadTemplates(); notify(item.status === 'inactive' ? '模板已启用' : '模板已停用'); return; }
    if (action === 'restore-templates') { if (!confirm('恢复系统模板的默认内容吗？自建模板会保留。')) return; await api('POST', '/certificate-templates/restore-defaults', {}); await loadTemplates(); notify('系统模板已恢复默认'); return; }
    if (action === 'delete-template') { const item = state.templates.find(row => row.id === button.dataset.id); if (!confirm(`删除未使用模板“${item.name}”吗？`)) return; await api('DELETE', `/certificate-templates/${encodeURIComponent(item.id)}`, { baseVersion: item.version }); await loadTemplates(); notify('模板已删除'); return; }
    if (action === 'add-template-field') { const label = prompt('请输入字段名称'); if (!label) return; const version = state.templateEditor.versions.at(-1); version.fields.push(model().defaultFieldForVariable(label)); render(); return; }
    if (action === 'remove-template-field') { state.templateEditor.versions.at(-1).fields.splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'move-template-field') { const fields = state.templateEditor.versions.at(-1).fields; const from = Number(button.dataset.index); const to = from + Number(button.dataset.direction); if (to < 0 || to >= fields.length) return; [fields[from], fields[to]] = [fields[to], fields[from]]; fields.forEach((field, index) => { field.order = index; }); render(); return; }
    if (action === 'insert-template-field') { const field = state.templateEditor.versions.at(-1).fields[Number(button.dataset.index)]; const version = state.templateEditor.versions.at(-1); version.content += `{${field.label}}`; render(); return; }
    if (action === 'upload-template-word') {
      if (!state.templateEditor.id) { notify('请先保存模板，再上传 Word 版式', 'error'); return; }
      const result = await ipc('selectCertificateWordTemplate', { templateId: state.templateEditor.id });
      if (!result.canceled) { state.templateEditor.wordPath = result.path; await loadTemplates(); notify(`Word 版式已保存，识别到 ${result.variables.length} 个字段`); }
      return;
    }
    if (action === 'remove-template-word') {
      const editor = state.templateEditor; await api('PATCH', `/certificate-templates/${encodeURIComponent(editor.id)}`, { baseVersion: editor.version, changes: { wordPath: '', filePath: '' } });
      await loadTemplates(); state.templateEditor = structuredClone(state.templates.find(item => item.id === editor.id)); notify('Word 版式已移除，将使用系统 A4 版式'); return;
    }
    if (action === 'save-template-draft' || action === 'publish-template') {
      const editor = state.templateEditor; const version = editor.versions.at(-1); const changes = { name: editor.name, category: editor.category, title: version.title, content: version.content, fields: version.fields };
      if (!editor.name || !version.title || !version.content) { notify('请填写模板名称、标题和正文', 'error'); return; }
      if (!editor.id) await api('POST', '/certificate-templates', { ...changes, status: action === 'publish-template' ? 'active' : 'draft' });
      else if (action === 'publish-template') await api('POST', `/certificate-templates/${encodeURIComponent(editor.id)}/publish`, { baseVersion: editor.version, changes });
      else await api('PATCH', `/certificate-templates/${encodeURIComponent(editor.id)}`, { baseVersion: editor.version, changes });
      state.templateEditor = null; await loadTemplates(); notify(action === 'publish-template' ? '模板新版本已发布' : '模板草稿已保存'); return;
    }
  }

  function bind() {
    state.host.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; handleClick(button).catch(error => notify(error.message, 'error')); });
    state.host.addEventListener('input', event => {
      if (event.target.dataset.residentSearch) searchResident(event.target.dataset.residentSearch, event.target.value);
      if (event.target.hasAttribute('data-ai-input')) state.aiDraft.input = event.target.value;
      if (event.target.hasAttribute('data-ai-title')) { state.aiDraft.title = event.target.value; const preview = state.host.querySelector('[data-ai-preview-title]'); if (preview) preview.textContent = event.target.value || '证明'; scheduleAiSave(); }
      if (event.target.hasAttribute('data-ai-content')) { state.aiDraft.content = event.target.value; const preview = state.host.querySelector('[data-ai-preview-content]'); if (preview) preview.innerHTML = certificateBodyHtml(aiPreviewContent()); scheduleAiSave(); }
      if (event.target.dataset.aiSystemField) {
        state.aiDraft.system ||= {}; state.aiDraft.system[event.target.dataset.aiSystemField] = event.target.value;
        const preview = state.host.querySelector(event.target.dataset.aiSystemField === 'organizationName' ? '[data-ai-preview-organization]' : '[data-ai-preview-date]');
        if (preview) preview.textContent = event.target.dataset.aiSystemField === 'issuedDate' ? chineseDate(event.target.value) : event.target.value;
        scheduleAiSave();
      }
      if (event.target.dataset.systemField) {
        state.draft.system ||= {}; state.draft.system[event.target.dataset.systemField] = event.target.value;
        const preview = state.host.querySelector(event.target.dataset.systemField === 'organizationName' ? '[data-preview-organization]' : '[data-preview-date]');
        if (preview) preview.textContent = event.target.dataset.systemField === 'issuedDate' ? chineseDate(event.target.value) : event.target.value;
      }
      if (event.target.hasAttribute('data-template-search')) { state.templateKeyword = event.target.value; renderAndRestoreField('[data-template-search]', event.target.selectionStart ?? event.target.value.length); }
      if (event.target.dataset.field) {
        const key = event.target.dataset.field;
        state.draft.values[key] = event.target.value;
        const preview = state.host.querySelector('[data-preview-content]');
        if (preview) preview.innerHTML = certificateBodyHtml(model().renderCertificateContent(activeVersion(), state.draft).content);
      }
      if (event.target.dataset.filter) state.recordFilters[event.target.dataset.filter] = event.target.value;
      if (event.target.dataset.templateProp) { const key = event.target.dataset.templateProp; if (['title', 'content'].includes(key)) state.templateEditor.versions.at(-1)[key] = event.target.value; else state.templateEditor[key] = event.target.value; }
      if (event.target.dataset.templateFieldSource) {
        const field = state.templateEditor.versions.at(-1).fields[Number(event.target.dataset.templateFieldSource)]; field.source = event.target.value; field.readOnly = field.source !== 'manual';
        if (field.source === 'archive') Object.assign(field, model().bindResidentField(field, field.subjectKey || 'person1'));
        render();
      }
      if (event.target.dataset.templateFieldSubject) {
        const field = state.templateEditor.versions.at(-1).fields[Number(event.target.dataset.templateFieldSubject)];
        Object.assign(field, model().bindResidentField(field, event.target.value));
      }
      if (event.target.dataset.templateFieldLabel) {
        const field = state.templateEditor.versions.at(-1).fields[Number(event.target.dataset.templateFieldLabel)]; const oldLabel = field.label; field.label = event.target.value;
        if (oldLabel && oldLabel !== field.label) state.templateEditor.versions.at(-1).content = state.templateEditor.versions.at(-1).content.split(`{${oldLabel}}`).join(`{${field.label}}`);
      }
      if (event.target.dataset.templateFieldRequired) state.templateEditor.versions.at(-1).fields[Number(event.target.dataset.templateFieldRequired)].required = event.target.checked;
    });
    state.host.addEventListener('change', event => {
      if (event.target.dataset.field) { state.draft.values[event.target.dataset.field] = event.target.value; render(); }
      if (event.target.dataset.filter) state.recordFilters[event.target.dataset.filter] = event.target.value;
    });
    state.host.addEventListener('keydown', event => {
      // Enter sends; Shift+Enter inserts a line break in the AI composer.
      // Do not intercept the Enter used to confirm Chinese IME composition.
      if (!event.target.hasAttribute('data-ai-input') || event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); sendAiCertificateMessage().catch(error => { state.aiDraft.error = error.message; state.aiDraft.loading = false; render(); });
    });
  }

  async function mount(host) {
    state.host = host; bind(); state.loading = true; render();
    try {
      const [profile, account] = await Promise.all([api('GET', '/dashboard/profile').catch(() => ({})), root.api.getLocalAuthStatus?.().catch(() => ({}))]);
      const communityName = text(profile?.profile?.villageName).trim();
      state.organizationName = communityName ? (/(?:居民委员会|村民委员会)$/u.test(communityName) ? communityName : `${communityName}居民委员会`) : '';
      state.operatorName = account?.account?.name || account?.account?.phone || '当前操作员';
      await Promise.all([loadTemplates(), loadRecords(), loadAiDraft()]);
    } catch (error) { state.message = error.message; state.messageType = 'error'; }
    finally { state.loading = false; render(); await root.communityAiTokenStatus?.refresh(); }
  }

  async function openRecords(keyword = '') {
    state.activeTab = 'records';
    state.recordFilters.keyword = text(keyword);
    await loadRecords();
    render();
  }

  async function openMaterialHandoff(prepared = {}) {
    const payload = prepared.payload || prepared;
    state.activeTab = 'ai';
    state.aiCompletedRecord = null;
    state.aiDraft ||= freshAiDraft();
    const templateHint = text(payload.classification?.templateHint);
    const matched = templateHint && state.templates.find(item => text(item.name).includes(templateHint));
    state.aiDraft.sourceMaterial = { fileId: payload.sourceFileId || '', fileName: payload.fileName || '',
      classificationName: payload.classification?.name || '证明材料' };
    if (matched) state.aiDraft.recommendedTemplateId = matched.id;
    const excerpt = text(payload.text).slice(0, 12_000);
    state.aiDraft.input = `请根据下面这份已经人工核对的材料拟写证明。不得补造材料中没有的事实；信息不足时先向我提问。\n\n材料名称：${payload.fileName || '未命名材料'}\n识别用途：${payload.classification?.name || '证明材料'}${templateHint ? `\n建议模板：${templateHint}` : ''}\n\n核对内容：\n${excerpt}`;
    scheduleAiSave();
    render();
    state.host?.querySelector('[data-ai-input]')?.focus();
  }

  async function openTemplateIntake({ templateId } = {}) {
    await loadTemplates(); state.activeTab = 'templates';
    const template = state.templates.find(item => item.id === templateId);
    if (!template) throw new Error('模板草稿没有找到，请刷新模板管理后重试');
    state.templateEditor = structuredClone(template); render();
  }

  root.CertificateManagementUI = Object.freeze({ mount, openRecords, openMaterialHandoff, openTemplateIntake });
})(window);
