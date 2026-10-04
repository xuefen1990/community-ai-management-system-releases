(() => {
  'use strict';

  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const personName = (person) => text(person?.name || person?.person_name || person?.resident_name);
  const personGroup = (person) => text(person?.village_group || person?.villageGroup || person?.group || person?.group_name);
  const personIdCard = (person) => {
    const values = [person?.idCard, person?.id_card, person?.identity_card, person?.id_number].map(text);
    return values.find((value) => /^[1-9]\d{16}[\dX]$/iu.test(value)) || values.find(Boolean) || '';
  };
  const personKey = (person) => text(person?.id) || personIdCard(person);
  const isPlaceholderValue = (value) => {
    const normalized = text(value).toLowerCase();
    return !normalized || ['undefined', 'null', 'nan', 'none', 'n/a', '-', '—'].includes(normalized);
  };
  const personPhone = (person) => {
    const value = text(person?.phone || person?.mobile || person?.mobile_phone);
    return isPlaceholderValue(value) ? '' : value;
  };
  const money = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const model = () => window.ContractFeeModel || {};
  const state = { personId: '', activeTab: 'basic', operationPage: 1, operationPageSize: 10, paymentPage: 1, paymentPageSize: 10, paymentCategory: '', paymentYear: '', paymentKeyword: '', mode: 'edit', entryContext: 'standalone', accountEditorCard: '' };
  let foundationDraft = null;
  const database = () => foundationDraft?.database || window.dbState || {};
  const personnel = () => Array.isArray(database().personnel) ? database().personnel : [];
  const close = () => document.getElementById('resident-subsidy-profile-overlay')?.remove();
  const formatTime = (value) => text(value).replace('T', ' ').slice(0, 16) || '—';
  const maskCard = (value) => { const card = text(value); return card.length > 8 ? `${card.slice(0, 4)} **** **** ${card.slice(-4)}` : (card || '—'); };
  const presentation = () => window.ResidentRecordPresentation || {
    dateLabel: (value) => text(value) || '未填写',
    sourceLabel: (value) => text(value) || '居民档案',
    sourceDetail: (value) => text(value) || '未记录原始来源',
    paymentStatusLabel: (value) => text(value) || '未填写',
    paymentItemLabel: (item) => text(item?.categoryName || item?.category || item?.workItem || item?.remark) || '其他发放',
    accountLabel: (item) => maskCard(item?.bankCard || item?.cardNumber),
    operationLabel: (item) => text(item?.action) || '资料更新',
    operationResultLabel: (item) => text(item?.status) || '已完成',
    batchLabel: (value) => text(value) || '未记录批次',
  };
  function recordDetails(items) {
    const rows = Object.entries(items).filter(([, value]) => value !== undefined && value !== null && text(value));
    if (!rows.length) return '';
    return `<details class="resident-record-details"><summary>查看详情</summary><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join('、') : value)}</dd></div>`).join('')}</dl></details>`;
  }
  function statusClass(value) { return text(value).toLowerCase().replace(/[^a-z0-9_-]/gu, '') || 'unknown'; }

  async function persist(message) {
    if (foundationDraft) { foundationDraft.changed = true; return { ok: true }; }
    const api = window.communityFoundationApi || window.api;
    if (!api?.writeDb) throw new Error('当前环境无法保存居民档案');
    const result = await api.writeDb(database());
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    if (message) (window.showToast || window.alert)(message, 'success');
  }

  function accountsFor(person) {
    const accounts = model().bankAccounts?.(person);
    return Array.isArray(accounts) ? accounts : [];
  }

  const accountIsCurrent = (account) => model().isCurrentBankAccount ? model().isCurrentBankAccount(account) : account?.status !== 'historical' && account?.status !== 'disabled';
  const accountKey = (account) => text(account?.id) || text(account?.cardNumber);

  function fieldDefinitions() {
    const value = database().residentCustomFields;
    return Array.isArray(value) ? value : [];
  }

  function fieldInput(field, value, readOnly = false) {
    const key = escapeHtml(field.id);
    const disabled = readOnly ? ' disabled' : '';
    if (field.type === 'number') return `<input type="number" data-resident-custom-field="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.name)}"${disabled}>`;
    if (field.type === 'date') return `<input type="date" data-resident-custom-field="${key}" value="${escapeHtml(value)}"${disabled}>`;
    if (field.type === 'boolean') return `<select data-resident-custom-field="${key}"${disabled}><option value="">未填写</option><option value="是"${text(value) === '是' ? ' selected' : ''}>是</option><option value="否"${text(value) === '否' ? ' selected' : ''}>否</option></select>`;
    if (field.type === 'select' || field.type === 'multi_select') {
      const choices = Array.isArray(field.options) ? field.options : [];
      return `<select data-resident-custom-field="${key}"${disabled}><option value="">未填写</option>${choices.map((item) => `<option value="${escapeHtml(item)}"${text(value) === text(item) ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>`;
    }
    return `<input data-resident-custom-field="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.name)}"${disabled}>`;
  }

  function pagination(total, page, pageSize, prefix = 'operation') {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `<div class="resident-record-pagination" data-resident-record-pagination aria-label="记录分页"><span>共 ${total} 条</span><label>每页 <select aria-label="每页条数" data-resident-${prefix}-page-size>${[10, 20, 50].map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select> 条</label><button class="btn btn-outline" aria-label="上一页" data-resident-${prefix}-page="${Math.max(1, page - 1)}"${page <= 1 ? ' disabled' : ''}>‹</button><span aria-live="polite">${page}/${pages}</span><button class="btn btn-outline" aria-label="下一页" data-resident-${prefix}-page="${Math.min(pages, page + 1)}"${page >= pages ? ' disabled' : ''}>›</button></div>`;
  }

  function paymentDate(item) { return text(item?.batchDate || item?.period || item?.paidAt || item?.importedAt); }
  function paymentYear(item) { return paymentDate(item).match(/(?:19|20)\d{2}/u)?.[0] || ''; }
  function paymentCategory(item) { return text(item?.categoryName) || '其他发放'; }
  function paymentDescription(item) { return text(item?.workItem || item?.role || item?.responsibilityArea || item?.remark || item?.period) || '—'; }
  function residentPaymentRecords(person) {
    return (Array.isArray(person?.disbursementHistory) ? person.disbursementHistory : []).filter((item) => item && item.paymentStatus !== 'cancelled').sort((left, right) => paymentDate(right).localeCompare(paymentDate(left)));
  }

  function paymentRecordsContent(person) {
    const records = residentPaymentRecords(person);
    const categories = [...new Set(records.map(paymentCategory))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const years = [...new Set(records.map(paymentYear).filter(Boolean))].sort((left, right) => right.localeCompare(left));
    const filtered = records.filter((item) => (!state.paymentCategory || paymentCategory(item) === state.paymentCategory) && (!state.paymentYear || paymentYear(item) === state.paymentYear) && (!state.paymentKeyword || `${paymentCategory(item)} ${paymentDescription(item)} ${item.batchId || ''}`.toLowerCase().includes(state.paymentKeyword.toLowerCase())));
    const pages = Math.max(1, Math.ceil(filtered.length / state.paymentPageSize));
    const page = Math.min(state.paymentPage, pages);
    const visible = filtered.slice((page - 1) * state.paymentPageSize, page * state.paymentPageSize);
    const totalCents = filtered.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const p = presentation();
    const rows = visible.map((item) => `<tr><td>${escapeHtml(p.dateLabel(paymentDate(item)))}</td><td><strong>${escapeHtml(p.paymentItemLabel(item))}</strong>${recordDetails({ 发放批次: p.batchLabel(item.batchId), 原始批次号: item.batchId, 记录编号: item.recordId || item.id, 原始状态: item.paymentStatus || item.status })}</td><td class="resident-record-money">${money(item.amountCents)}</td><td>${escapeHtml(p.accountLabel(item))}</td><td><span class="resident-payment-status resident-status-${statusClass(item.paymentStatus || item.status || 'paid')}">${escapeHtml(p.paymentStatusLabel(item.paymentStatus || item.status || 'paid'))}</span></td></tr>`).join('');
    return `<section class="resident-profile-section resident-payment-records"><div class="cf-section-head"><div><h4>费用发放记录</h4><p>仅显示已写入居民档案的费用，原始记录不可直接修改。</p></div><strong class="resident-payment-total">筛选合计：${money(totalCents)}</strong></div><div class="resident-payment-filters"><label>费用类别<select data-resident-payment-category><option value="">全部类别</option>${categories.map((item) => `<option value="${escapeHtml(item)}"${item === state.paymentCategory ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label><label>年度<select data-resident-payment-year><option value="">全部年度</option>${years.map((item) => `<option value="${item}"${item === state.paymentYear ? ' selected' : ''}>${item} 年</option>`).join('')}</select></label><label class="resident-payment-keyword">搜索批次或事项<input data-resident-payment-keyword value="${escapeHtml(state.paymentKeyword)}" placeholder="输入关键词"></label><button class="btn btn-outline" data-resident-payment-filter>筛选</button></div>${filtered.length ? `<div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>发放日期</th><th>事项</th><th>发放金额</th><th>收款账户</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div>${pagination(filtered.length, page, state.paymentPageSize, 'payment')}` : '<div class="cf-empty">暂未找到符合条件的费用。</div>'}</section>`;
  }

  function profileContent(person, tab) {
    const sources = Array.isArray(person.importSources) ? person.importSources : [];
    const definitions = fieldDefinitions().filter((field) => field.active !== false);
    const editable = state.mode === 'edit';
    if (tab === 'accounts') {
      const accounts = accountsFor(person);
      const activeAccounts = accounts.filter(accountIsCurrent);
      const historicalAccounts = accounts.filter((account) => !accountIsCurrent(account));
      const values = person.customFields && typeof person.customFields === 'object' ? person.customFields : {};
      const accountCard = (account, historical = false) => {
        const key = escapeHtml(accountKey(account));
        const editing = editable && !historical && state.accountEditorCard === accountKey(account);
        const badge = account.isDefault && !historical ? '<span class="resident-account-badge">默认收款卡</span>' : (historical ? '<span class="resident-account-badge muted">历史卡</span>' : '<span class="resident-account-badge muted">备用卡</span>');
        if (editing) return `<article class="resident-account-card editing" data-resident-account-card="${key}"><div class="resident-account-card-head"><div><strong>编辑银行卡</strong><span>修改卡号会保留原卡为历史卡。</span></div>${badge}</div><div class="resident-account-edit"><label>银行卡号<input data-resident-edit-card value="${escapeHtml(account.cardNumber)}" inputmode="numeric"></label><label>开户行<input data-resident-edit-bank value="${escapeHtml(account.bankName || '')}" placeholder="可留空"></label><label>开户人<input data-resident-edit-account-name value="${escapeHtml(account.accountName || personName(person) || '')}" placeholder="可留空"></label></div><div class="resident-account-actions"><button class="btn btn-outline" data-resident-cancel-account-edit>取消</button><button class="btn btn-primary" data-resident-save-account-edit="${escapeHtml(account.cardNumber)}">保存修改</button></div></article>`;
        return `<article class="resident-account-card${historical ? ' historical' : ''}"><div class="resident-account-card-head"><div><strong>${escapeHtml(maskCard(account.cardNumber))}</strong><span>${escapeHtml(account.bankName || '未填写开户行')} · ${escapeHtml(account.accountName || personName(person) || '未填写开户人')}</span></div>${badge}</div><div class="resident-account-meta"><span>资料来源：${escapeHtml(account.source || '居民档案')}</span>${historical && account.archivedAt ? `<span>停用时间：${formatTime(account.archivedAt)}</span>` : ''}</div>${editable && !historical ? `<div class="resident-account-actions"><button class="btn btn-outline" data-resident-edit-account="${key}">编辑</button>${account.isDefault ? '' : `<button class="btn btn-outline" data-resident-set-default-card="${escapeHtml(account.cardNumber)}">设为默认卡</button>`}<button class="btn btn-danger" data-resident-deactivate-card="${escapeHtml(account.cardNumber)}">停用</button></div>` : ''}</article>`;
      };
      const addAccount = editable ? `<section class="resident-account-create"><div><h5>新增银行卡</h5><p>新增后可选择作为默认收款卡。</p></div><div class="resident-account-create-grid"><label>银行卡号<input data-resident-new-card placeholder="请输入银行卡号" inputmode="numeric"></label><label>开户行（可选）<input data-resident-new-bank placeholder="例如：农商行"></label><label>开户人（可选）<input data-resident-new-account-name placeholder="默认使用居民姓名"></label><label class="resident-account-default"><input type="checkbox" data-resident-new-default${activeAccounts.length ? '' : ' checked'}> 设为默认收款卡</label><button class="btn btn-primary" data-resident-add-card>添加银行卡</button></div></section>` : '<div class="cf-hint">当前为只读查看。请从居民列表点击“编辑信息”后维护收款账户。</div>';
      const fieldActions = editable ? '<button class="btn btn-outline" data-resident-manage-fields>管理字段</button>' : '';
      const saveFields = editable ? '<div class="cf-row-actions"><button class="btn btn-primary" data-resident-save-custom-fields>保存扩展资料</button></div>' : '';
      return `<section class="resident-profile-section"><div class="cf-section-head"><div><h4>收款账户</h4><p>默认卡会在新建发放时自动带入；停用或改号的银行卡会保留为历史记录。</p></div></div>${activeAccounts.length ? `<div class="resident-account-list">${activeAccounts.map((account) => accountCard(account)).join('')}</div>` : '<div class="cf-empty">暂未登记当前可用银行卡。</div>'}${historicalAccounts.length ? `<details class="resident-account-history"><summary>历史银行卡（${historicalAccounts.length} 张）</summary><div class="resident-account-list">${historicalAccounts.map((account) => accountCard(account, true)).join('')}</div></details>` : ''}${addAccount}</section><section class="resident-profile-section"><div class="cf-section-head"><div><h4>扩展资料</h4><p>管理员创建的字段默认面向全体居民；不适用时可留空。</p></div>${fieldActions}</div>${definitions.length ? `<div class="resident-custom-fields">${definitions.map((field) => `<label><span>${escapeHtml(field.name)}</span>${fieldInput(field, values[field.id], !editable)}</label>`).join('')}</div>${saveFields}` : `<div class="cf-empty">尚未创建扩展字段。${editable ? '可点击“管理字段”创建文字、数字、日期或选择项。' : ''}</div>`}</section>`;
    }
    if (tab === 'payments' || tab === 'subsidy' || tab === 'funds') return paymentRecordsContent(person);
    if (tab === 'operations') {
      const records = Array.isArray(person.residentOperationLog) ? [...person.residentOperationLog] : [];
      const pageSize = state.operationPageSize; const pages = Math.max(1, Math.ceil(records.length / pageSize)); const page = Math.min(state.operationPage, pages); const visible = records.slice((page - 1) * pageSize, page * pageSize);
      const p = presentation();
      return records.length ? `<table class="cf-table"><thead><tr><th>时间</th><th>操作</th><th>结果</th><th>操作人</th></tr></thead><tbody>${visible.map((item) => `<tr><td>${escapeHtml(formatTime(item.occurredAt))}</td><td><strong>${escapeHtml(p.operationLabel(item))}</strong>${recordDetails({ 说明: item.description || item.changedFields?.join('、'), 来源: p.sourceLabel(item.sourceType || item.batchId), 原始来源: item.sourceType, 批次号: item.batchId, 记录编号: item.recordId })}</td><td><span class="resident-operation-result resident-status-${statusClass(item.status || 'completed')}">${escapeHtml(p.operationResultLabel(item))}</span></td><td>${escapeHtml(item.operator || '当前操作员')}</td></tr>`).join('')}</tbody></table>${pagination(records.length, page, pageSize)}` : '<div class="cf-empty">暂未产生操作记录。</div>';
    }
    if (tab === 'sources') {
      const p = presentation();
      return sources.length ? `<table class="cf-table"><thead><tr><th>资料来源</th><th>关联记录</th><th>导入时间</th><th>变更说明</th></tr></thead><tbody>${sources.map((item) => { const source = item.sourceType || item.source || 'resident_profile'; const related = item.recordSummary || item.summary || item.name || (item.recordId || item.batchId ? '关联记录' : '—'); return `<tr><td><span class="resident-source-label">${escapeHtml(p.sourceLabel(source))}</span>${recordDetails({ 原始来源: p.sourceDetail(source), 原始记录号: item.recordId || item.batchId, 批次号: item.batchId })}</td><td>${escapeHtml(related)}</td><td>${escapeHtml(formatTime(item.importedAt || item.createdAt))}</td><td>${escapeHtml(item.changeNote || item.correctionReason || item.description || '—')}</td></tr>`; }).join('')}</tbody></table>` : '<div class="cf-empty">暂未记录资料来源。</div>';
    }
    return `<div class="cf-record-summary"><strong>${escapeHtml(personName(person) || '未填写姓名')}</strong><br>身份证号：${escapeHtml(personIdCard(person) || '未填写')}<br>村民组：${escapeHtml(personGroup(person) || '未填写')}<br>联系电话：${escapeHtml(personPhone(person) || '未填写')}</div>`;
  }

  function showProfile(person, activeTab = state.activeTab) {
    const overlay = document.getElementById('resident-subsidy-profile-overlay'); if (!overlay || !person) return;
    state.personId = personKey(person); state.activeTab = activeTab;
    const tabs = [['basic', '基本信息'], ['accounts', '收款账户与扩展资料'], ['payments', '费用发放记录'], ['operations', '操作记录'], ['sources', '来源与更正记录']];
    overlay.querySelector('.resident-profile-tabs').innerHTML = tabs.map(([key, label]) => `<button data-resident-profile-tab="${key}" class="${key === activeTab ? 'active' : ''}">${label}</button>`).join('');
    overlay.querySelector('.resident-profile-body').innerHTML = profileContent(person, activeTab);
    overlay.querySelectorAll('[data-resident-profile-tab]').forEach((button) => button.addEventListener('click', () => showProfile(person, button.dataset.residentProfileTab)));
    bindProfileActions(overlay, person, activeTab);
  }

  function refreshProfile(person, activeTab = state.activeTab) {
    if (foundationDraft) return foundationDraft.refresh(activeTab);
    const embedded = document.getElementById('resident-profile-embedded');
    if (state.entryContext === 'legacy' && embedded) return showEmbeddedProfile(person, activeTab, embedded);
    return showProfile(person, activeTab);
  }

  async function savePersonChange(person, action, description, changedFields) {
    model().appendResidentOperation?.(person, { action, description, changedFields });
    person.updated_at = new Date().toISOString(); await persist(description); refreshProfile(person, state.activeTab);
  }

  function fieldManager(overlay, person) {
    (overlay.querySelector('.resident-profile-body') || overlay).innerHTML = `<section class="resident-profile-section"><div class="cf-section-head"><div><h4>扩展字段管理</h4><p>字段会对全部居民显示，停用后历史值仍会保留。</p></div><button class="btn btn-outline" data-resident-back-to-accounts>返回资料页</button></div><div class="resident-account-form"><input data-resident-field-name placeholder="字段名称，例如紧急联系人"><select data-resident-field-type><option value="text">文字</option><option value="number">数字</option><option value="date">日期</option><option value="select">单选</option><option value="multi_select">多选</option><option value="boolean">是 / 否</option></select><input data-resident-field-options placeholder="选项用顿号或逗号分隔（选择项时填写）"><button class="btn btn-primary" data-resident-create-field>新建字段</button></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>字段</th><th>类型</th><th>选项</th><th>状态</th><th>操作</th></tr></thead><tbody>${fieldDefinitions().map((field) => `<tr><td>${escapeHtml(field.name)}</td><td>${escapeHtml(({ text: '文字', number: '数字', date: '日期', select: '单选', multi_select: '多选', boolean: '是/否' })[field.type] || field.type)}</td><td>${escapeHtml((field.options || []).join('、') || '—')}</td><td>${field.active === false ? '已停用' : '启用'}</td><td><button class="btn btn-outline" data-resident-toggle-field="${escapeHtml(field.id)}">${field.active === false ? '启用' : '停用'}</button></td></tr>`).join('') || '<tr><td colspan="5">尚未创建字段</td></tr>'}</tbody></table></div></section>`;
    overlay.querySelector('[data-resident-back-to-accounts]').addEventListener('click', () => refreshProfile(person, 'accounts'));
    overlay.querySelector('[data-resident-create-field]').addEventListener('click', async () => {
      const name = text(overlay.querySelector('[data-resident-field-name]')?.value); if (!name) return window.alert('请填写字段名称');
      const type = text(overlay.querySelector('[data-resident-field-type]')?.value) || 'text'; const options = text(overlay.querySelector('[data-resident-field-options]')?.value).split(/[、,，]/u).map(text).filter(Boolean);
      if (['select', 'multi_select'].includes(type) && !options.length) return window.alert('请选择字段需要至少填写一个选项');
      const db = database(); if (!Array.isArray(db.residentCustomFields)) db.residentCustomFields = [];
      db.residentCustomFields.push({ id: `resident-field-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, type, options, active: true, createdAt: new Date().toISOString() });
      await persist(`已新建扩展字段：${name}`); fieldManager(overlay, person);
    });
    overlay.querySelectorAll('[data-resident-toggle-field]').forEach((button) => button.addEventListener('click', async () => { const field = fieldDefinitions().find((item) => text(item.id) === text(button.dataset.residentToggleField)); if (!field) return; field.active = field.active === false; await persist(`已${field.active ? '启用' : '停用'}扩展字段：${field.name}`); fieldManager(overlay, person); }));
  }

  function bindProfileActions(overlay, person, tab) {
    if (overlay.__residentProfileClickHandler) overlay.removeEventListener('click', overlay.__residentProfileClickHandler);
    if (overlay.__residentProfileChangeHandler) overlay.removeEventListener('change', overlay.__residentProfileChangeHandler);
    overlay.__residentProfileClickHandler = async (event) => {
      if (foundationDraft) state.activeTab = tab;
      const button = event.target.closest('button'); if (!button || !overlay.contains(button)) return;
      if (button.dataset.residentEditAccount !== undefined) { state.accountEditorCard = text(button.dataset.residentEditAccount); return refreshProfile(person, 'accounts'); }
      if (button.hasAttribute('data-resident-cancel-account-edit')) { state.accountEditorCard = ''; return refreshProfile(person, 'accounts'); }
      if (button.dataset.residentSaveAccountEdit !== undefined) {
        const card = text(button.dataset.residentSaveAccountEdit); const cardRoot = button.closest('[data-resident-account-card]'); const nextCard = text(cardRoot?.querySelector('[data-resident-edit-card]')?.value); const bankName = text(cardRoot?.querySelector('[data-resident-edit-bank]')?.value); const accountName = text(cardRoot?.querySelector('[data-resident-edit-account-name]')?.value);
        try { const result = model().updateBankAccount?.(person, card, { cardNumber: nextCard, bankName, accountName }, { source: 'resident-profile' }); state.accountEditorCard = ''; await savePersonChange(person, result?.cardChanged ? '修改收款银行卡' : '修改收款账户资料', result?.cardChanged ? `已修改银行卡，原卡尾号 ${card.slice(-4)} 已保留为历史卡` : `已更新卡尾号 ${card.slice(-4)} 的开户资料`, ['银行卡号', '开户行', '开户人']); } catch (error) { window.alert(error.message || '银行卡保存失败'); }
        return;
      }
      if (button.dataset.residentSetDefaultCard !== undefined) { model().setDefaultBankCard?.(person, button.dataset.residentSetDefaultCard, { source: 'resident-profile' }); return savePersonChange(person, '设置默认收款卡', `已将卡尾号 ${text(button.dataset.residentSetDefaultCard).slice(-4)} 设为默认收款卡`, ['默认银行卡']); }
      if (button.dataset.residentDeactivateCard !== undefined) { try { model().deactivateBankAccount?.(person, button.dataset.residentDeactivateCard); await savePersonChange(person, '停用收款银行卡', `已停用卡尾号 ${text(button.dataset.residentDeactivateCard).slice(-4)}，该卡已保留为历史卡`, ['银行卡状态']); } catch (error) { window.alert(error.message || '银行卡停用失败'); } return; }
      if (button.hasAttribute('data-resident-add-card')) { const card = text(overlay.querySelector('[data-resident-new-card]')?.value); if (!card) return window.alert('请填写银行卡号'); const bankName = text(overlay.querySelector('[data-resident-new-bank]')?.value); const accountName = text(overlay.querySelector('[data-resident-new-account-name]')?.value); const makeDefault = Boolean(overlay.querySelector('[data-resident-new-default]')?.checked); model().addBankAccount?.(person, { cardNumber: card, bankName, accountName }, { source: 'resident-profile', makeDefault }); return savePersonChange(person, '新增收款账户', `新增${makeDefault ? '默认' : '备用'}银行卡，卡尾号 ${card.slice(-4)}`, [makeDefault ? '默认银行卡' : '备用银行卡']); }
      if (button.hasAttribute('data-resident-manage-fields')) return fieldManager(overlay, person);
      if (button.hasAttribute('data-resident-save-custom-fields')) { const values = { ...(person.customFields || {}) }; overlay.querySelectorAll('[data-resident-custom-field]').forEach((input) => { values[input.dataset.residentCustomField] = text(input.value); }); person.customFields = values; return savePersonChange(person, '更新扩展资料', '已保存居民扩展资料', ['扩展资料']); }
      if (button.dataset.residentOperationPage !== undefined) { state.operationPage = Number(button.dataset.residentOperationPage) || 1; return refreshProfile(person, 'operations'); }
      if (button.dataset.residentPaymentPage !== undefined) { state.paymentPage = Number(button.dataset.residentPaymentPage) || 1; return refreshProfile(person, 'payments'); }
      if (button.hasAttribute('data-resident-payment-filter')) { state.paymentCategory = text(overlay.querySelector('[data-resident-payment-category]')?.value); state.paymentYear = text(overlay.querySelector('[data-resident-payment-year]')?.value); state.paymentKeyword = text(overlay.querySelector('[data-resident-payment-keyword]')?.value); state.paymentPage = 1; return refreshProfile(person, 'payments'); }
    };
    overlay.__residentProfileChangeHandler = (event) => { if (event.target.matches('[data-resident-operation-page-size]')) { state.operationPageSize = Number(event.target.value) || 10; state.operationPage = 1; refreshProfile(person, 'operations'); } if (event.target.matches('[data-resident-payment-category], [data-resident-payment-year]')) { state.paymentCategory = text(overlay.querySelector('[data-resident-payment-category]')?.value); state.paymentYear = text(overlay.querySelector('[data-resident-payment-year]')?.value); state.paymentPage = 1; refreshProfile(person, 'payments'); } if (event.target.matches('[data-resident-payment-keyword]')) { state.paymentKeyword = text(event.target.value); } if (event.target.matches('[data-resident-payment-page-size]')) { state.paymentPageSize = Number(event.target.value) || 10; state.paymentPage = 1; refreshProfile(person, 'payments'); } };
    overlay.addEventListener('click', overlay.__residentProfileClickHandler);
    overlay.addEventListener('change', overlay.__residentProfileChangeHandler);
  }

  function residentById(value) {
    const key = text(value);
    return personnel().find((person) => text(person.id) === key || personIdCard(person) === key);
  }

  function personFromEntry(element) {
    if (!element) return null;
    const scope = element.closest('tr') || element.closest('[data-person-id]') || element.closest('.personnel-card') || element.parentElement;
    const storedKey = text(scope?.dataset?.residentPersonKey || element.dataset?.residentPersonKey);
    if (storedKey) {
      const matched = personnel().find((person) => text(person.id) === storedKey || personIdCard(person) === storedKey);
      if (matched) return matched;
    }
    const storedIndex = Number(scope?.dataset?.residentPersonIndex);
    if (Number.isInteger(storedIndex) && personnel()[storedIndex]) return personnel()[storedIndex];
    const source = `${text(element.getAttribute?.('onclick'))} ${text(scope?.textContent)}`;
    const byKey = personnel().filter((person) => [text(person.id), personIdCard(person)].filter(Boolean).some((key) => source.includes(key)));
    if (byKey.length === 1) return byKey[0];
    const rowName = text(scope?.querySelector?.('a')?.textContent || scope?.querySelector?.('td')?.textContent);
    const rowGroup = text(scope?.querySelectorAll?.('td')?.[6]?.textContent);
    const byName = personnel().filter((person) => personName(person) === rowName && (!rowGroup || personGroup(person) === rowGroup));
    return byName.length === 1 ? byName[0] : null;
  }

  function entryPersonnelIndex(element, person) {
    const scope = element?.closest?.('tr') || element?.parentElement;
    const storedIndex = Number(scope?.dataset?.residentPersonIndex);
    if (Number.isInteger(storedIndex) && personnel()[storedIndex] === person) return storedIndex;
    const onclick = [element, ...(scope?.querySelectorAll?.('[onclick]') || [])].map((item) => text(item?.getAttribute?.('onclick'))).join(' ');
    const match = onclick.match(/openEditModal\s*\(\s*['"]personnel['"]\s*,\s*(\d+)\s*\)/u);
    if (match) return Number(match[1]);
    return personnel().indexOf(person);
  }

  function setProfileNavigationActive(form, activeTab) {
    if (!form) return;
    form.querySelectorAll('[data-resident-profile-nav-tab]').forEach((item) => {
      const key = item.dataset.residentProfileNavTab;
      const active = key === activeTab;
      item.classList.toggle('resident-profile-nav-active', active);
      item.classList.toggle('resident-profile-nav-muted', !active);
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function clearPlaceholderPhone(form) {
    if (!form) return;
    const phoneInput = [...form.querySelectorAll('input')].find((input) => /phone|mobile|tel|联系电话|手机/u.test(`${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.closest('label')?.textContent || ''}`));
    if (phoneInput && isPlaceholderValue(phoneInput.value)) phoneInput.value = '';
  }

  function showEmbeddedProfile(person, activeTab, embedded = document.getElementById('resident-profile-embedded')) {
    if (!embedded || !person) return;
    state.personId = personKey(person); state.activeTab = activeTab;
    const originalContent = embedded.__originalContent;
    if (originalContent) originalContent.style.display = 'none';
    embedded.style.display = '';
    embedded.querySelector('.resident-profile-body').innerHTML = profileContent(person, activeTab);
    const form = embedded.closest('form');
    setProfileNavigationActive(form, activeTab);
    bindProfileActions(embedded, person, activeTab);
  }

  function restoreOriginalProfileSection(embedded, activeTab = 'basic') {
    if (!embedded) return;
    embedded.style.display = 'none';
    if (embedded.__originalContent) embedded.__originalContent.style.display = embedded.__originalContentDisplay || '';
    const form = embedded.closest('form');
    setProfileNavigationActive(form, activeTab);
  }

  function originalProfileParts() {
    const form = document.getElementById('modalForm');
    if (!form) return {};
    const links = [...form.querySelectorAll('a')];
    const basicLink = links.find((link) => text(link.textContent).includes('基础信息'));
    const specialLink = links.find((link) => text(link.textContent).includes('专项身份'));
    const navigation = basicLink && specialLink && basicLink.parentElement === specialLink.parentElement ? basicLink.parentElement : null;
    const content = navigation?.nextElementSibling || null;
    return { form, basicLink, specialLink, navigation, content };
  }

  function enhanceOriginalResidentProfile(person, mode) {
    const { form, basicLink, specialLink, navigation, content } = originalProfileParts();
    const modal = document.getElementById('dataModal');
    if (!form || !basicLink || !specialLink || !navigation || !content || !modal) return false;

    state.mode = mode === 'read' ? 'read' : 'edit'; state.entryContext = 'legacy'; state.activeTab = 'basic'; state.operationPage = 1; state.paymentPage = 1; state.paymentCategory = ''; state.paymentYear = ''; state.paymentKeyword = ''; state.accountEditorCard = '';
    close();
    form.querySelector('#resident-profile-embedded')?.remove();
    form.querySelectorAll('[data-resident-embedded-tab], [data-resident-profile-nav-tab]:not([data-resident-original-tab])').forEach((item) => item.remove());

    const embedded = document.createElement('section');
    embedded.id = 'resident-profile-embedded'; embedded.className = 'resident-profile-embedded'; embedded.style.display = 'none';
    embedded.__originalContent = content; embedded.__originalContentDisplay = content.style.display;
    embedded.innerHTML = '<div class="resident-profile-body"></div>';
    content.insertAdjacentElement('afterend', embedded);

    const tabs = [
      ['accounts', '💳 收款账户与扩展资料'],
      ['payments', '💰 费用发放记录'],
      ['operations', '🧾 操作记录'],
      ['sources', '🗂️ 来源与更正记录']
    ];
    navigation.classList.add('resident-profile-nav');
    [basicLink, specialLink].forEach((link) => {
      link.classList.add('resident-profile-nav-item');
      link.classList.remove('active');
    });
    basicLink.dataset.residentOriginalTab = 'basic'; specialLink.dataset.residentOriginalTab = 'special';
    basicLink.dataset.residentProfileNavTab = 'basic'; specialLink.dataset.residentProfileNavTab = 'special';
    tabs.forEach(([key, label]) => {
      const link = basicLink.cloneNode(false);
      link.removeAttribute('onclick'); link.href = 'javascript:void(0)'; link.classList.remove('active'); link.classList.add('resident-profile-nav-item'); link.dataset.residentProfileNavTab = key; link.textContent = label;
      link.addEventListener('click', (event) => { event.preventDefault(); showEmbeddedProfile(person, key, embedded); });
      navigation.appendChild(link);
    });
    basicLink.addEventListener('click', () => window.setTimeout(() => restoreOriginalProfileSection(embedded, 'basic'), 0));
    specialLink.addEventListener('click', () => window.setTimeout(() => restoreOriginalProfileSection(embedded, 'special'), 0));
    setProfileNavigationActive(form, 'basic');

    const title = document.getElementById('modalTitle');
    if (title) title.textContent = state.mode === 'read' ? `查看居民档案 · ${personName(person)}` : `编辑登记信息 · ${personName(person)}`;
    const saveButton = document.getElementById('saveModalBtn');
    if (saveButton) saveButton.style.display = state.mode === 'read' ? 'none' : '';
    const cancelButton = modal.querySelector('.modal-footer .btn-outline');
    if (cancelButton) cancelButton.textContent = state.mode === 'read' ? '关闭' : '取消';
    const idInput = [...form.querySelectorAll('input')].find((input) => /idcard|id_card|identity_card|id_number|身份证/u.test(`${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.closest('label')?.textContent || ''}`));
    if (idInput && personIdCard(person)) {
      idInput.value = personIdCard(person);
      idInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    clearPlaceholderPhone(form);
    form.querySelectorAll('input, select, textarea, button').forEach((control) => { control.disabled = state.mode === 'read'; });
    modal.classList.toggle('resident-profile-readonly', state.mode === 'read');
    return true;
  }

  function openProfileDialog(options = {}) {
    const directPerson = residentById(options.personId);
    state.mode = options.mode === 'read' ? 'read' : 'edit'; state.entryContext = options.entryContext || 'standalone'; state.activeTab = 'basic'; state.operationPage = 1; state.paymentPage = 1; state.paymentCategory = ''; state.paymentYear = ''; state.paymentKeyword = ''; state.accountEditorCard = '';
    close(); const overlay = document.createElement('div'); overlay.id = 'resident-subsidy-profile-overlay'; overlay.className = 'cf-modal-overlay';
    const modeLabel = state.mode === 'read' ? '只读查看' : '可编辑';
    const searchArea = directPerson ? '' : '<div class="cf-subsidy-search"><input id="resident-profile-query" placeholder="输入姓名、身份证号或村民组"><button class="btn btn-primary" data-resident-profile-action="search">查询居民</button></div><div id="resident-profile-results" class="cf-row-actions"></div>';
    overlay.innerHTML = `<div class="cf-modal"><div class="cf-modal-head"><h3>${directPerson ? escapeHtml(personName(directPerson)) + ' · ' : ''}居民档案资料 <span class="cf-badge ${state.mode === 'read' ? '' : 'ok'}">${modeLabel}</span></h3><button class="cf-close" data-resident-profile-action="close">×</button></div><div class="cf-modal-body">${searchArea}<div class="resident-profile-tabs"></div><div class="resident-profile-body"><div class="cf-empty">${directPerson ? '正在载入居民档案…' : '请先查询并选择一名居民。'}</div></div></div><div class="cf-modal-foot"><button class="btn btn-outline" data-resident-profile-action="close">关闭</button></div></div>`;
    document.body.appendChild(overlay);
    const search = () => { const needle = text(document.getElementById('resident-profile-query')?.value).toLowerCase(); const matches = personnel().filter((person) => !needle || [personName(person), personIdCard(person), personGroup(person)].some((value) => text(value).toLowerCase().includes(needle))).slice(0, 20); const result = overlay.querySelector('#resident-profile-results'); if (!result) return; result.innerHTML = matches.length ? matches.map((person) => `<button class="btn btn-outline" data-resident-profile-person="${escapeHtml(personKey(person))}">${escapeHtml(personName(person))} · ${escapeHtml(personGroup(person) || '未分组')}</button>`).join('') : '<span class="text-secondary">未找到居民档案。</span>'; result.querySelectorAll('[data-resident-profile-person]').forEach((button) => button.addEventListener('click', () => { state.operationPage = 1; state.paymentPage = 1; showProfile(residentById(button.dataset.residentProfilePerson)); })); };
    overlay.querySelectorAll('[data-resident-profile-action="close"]').forEach((button) => button.addEventListener('click', close)); overlay.querySelector('[data-resident-profile-action="search"]')?.addEventListener('click', search); overlay.querySelector('#resident-profile-query')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); }); overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    if (directPerson) showProfile(directPerson, 'basic');
  }

  function openPersonInOriginalForm(person, mode, index = personnel().indexOf(person)) {
    if (!person) return false;
    if (index < 0 || typeof window.openEditModal !== 'function') {
      openProfileDialog({ personId: personKey(person), mode, entryContext: 'direct' });
      return true;
    }
    close(); window.openEditModal('personnel', index);
    window.setTimeout(() => enhanceOriginalResidentProfile(person, mode), 0);
    return true;
  }

  function openFromLegacyEntry(element, mode) {
    const person = personFromEntry(element); if (!person) return false;
    return openPersonInOriginalForm(person, mode, entryPersonnelIndex(element, person));
  }

  function handleResidentEntryClick(event) {
    const element = event.target.closest('button, a'); if (!element || element.closest('#resident-subsidy-profile-overlay')) return;
    const label = `${text(element.getAttribute('title'))} ${text(element.getAttribute('aria-label'))} ${text(element.textContent)}`;
    let mode = '';
    if (label.includes('查看个人全套档案与详情')) mode = 'read';
    if (label.includes('编辑信息') || label.includes('编辑当前人员')) mode = 'edit';
    if (!mode) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!openFromLegacyEntry(element, mode)) (window.showToast || window.alert)('未能准确识别该居民，请刷新列表后重试', 'warning');
  }

  function ensureEntry() { const tab = document.getElementById('tab-personnel'); if (!tab || tab.querySelector('[data-resident-subsidy-profile-entry]')) return; const anchor = tab.querySelector('h2, h3'); if (!anchor) return; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.dataset.residentSubsidyProfileEntry = 'true'; button.textContent = '居民资料标签'; button.addEventListener('click', openProfileDialog); anchor.parentElement?.appendChild(button); }

  window.createResidentEditorDraft = (person, definitions, refresh) => {
    foundationDraft = { database: { personnel: [person], residentCustomFields: definitions }, refresh, changed: false };
    state.mode = 'edit'; state.personId = personKey(person); state.accountEditorCard = ''; state.operationPage = 1; state.paymentPage = 1;
    state.paymentCategory = ''; state.paymentYear = ''; state.paymentKeyword = '';
    const draft = foundationDraft;
    return {
      database: draft.database,
      render(host, tab) { state.activeTab = tab; host.innerHTML = profileContent(person, tab); bindProfileActions(host, person, tab); },
      collect(root) {
        if (text(root.querySelector('[data-resident-field-name]')?.value)) throw new Error('请先点击“新建字段”完成扩展字段创建，再确认保存');
        const values = { ...(person.customFields || {}) };
        root.querySelectorAll('[data-resident-custom-field]').forEach(input => { values[input.dataset.residentCustomField] = text(input.value); });
        person.customFields = values;
        const editor = root.querySelector('[data-resident-save-account-edit]');
        if (editor) {
          const card = editor.closest('[data-resident-account-card]');
          model().updateBankAccount(person, editor.dataset.residentSaveAccountEdit, { cardNumber: text(card.querySelector('[data-resident-edit-card]').value), bankName: text(card.querySelector('[data-resident-edit-bank]').value), accountName: text(card.querySelector('[data-resident-edit-account-name]').value) }, { source: 'resident-profile' });
          state.accountEditorCard = '';
        }
        const newCard = text(root.querySelector('[data-resident-new-card]')?.value);
        if (newCard) {
          model().addBankAccount(person, { cardNumber: newCard, bankName: text(root.querySelector('[data-resident-new-bank]')?.value), accountName: text(root.querySelector('[data-resident-new-account-name]')?.value) }, { source: 'resident-profile', makeDefault: !!root.querySelector('[data-resident-new-default]')?.checked });
          root.querySelector('[data-resident-new-card]').value = '';
        }
      },
      dispose() { if (foundationDraft === draft) foundationDraft = null; },
    };
  };
  window.openResidentSubsidyProfile = () => openProfileDialog();
  window.openResidentProfileForPerson = (personId, mode = 'read') => openPersonInOriginalForm(residentById(personId), mode);
  if (!window.communityFoundation) {
    document.addEventListener('click', handleResidentEntryClick, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureEntry, { once: true }); else ensureEntry();
    new MutationObserver(ensureEntry).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
