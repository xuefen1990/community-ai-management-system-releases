(() => {
  'use strict';

  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const personName = (person) => text(person?.name || person?.person_name || person?.resident_name);
  const personGroup = (person) => text(person?.village_group || person?.villageGroup || person?.group || person?.group_name);
  const personIdCard = (person) => text(person?.id_card || person?.idCard || person?.identity_card || person?.id_number);
  const personPhone = (person) => text(person?.phone || person?.mobile || person?.mobile_phone);
  const money = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const model = () => window.ContractFeeModel || {};
  const state = { personId: '', activeTab: 'basic', operationPage: 1, operationPageSize: 10 };
  const database = () => window.dbState || {};
  const personnel = () => Array.isArray(database().personnel) ? database().personnel : [];
  const close = () => document.getElementById('resident-subsidy-profile-overlay')?.remove();
  const formatTime = (value) => text(value).replace('T', ' ').slice(0, 16) || '—';
  const maskCard = (value) => { const card = text(value); return card.length > 8 ? `${card.slice(0, 4)} **** **** ${card.slice(-4)}` : (card || '—'); };

  async function persist(message) {
    const api = window.api;
    if (!api?.writeDb) throw new Error('当前环境无法保存居民档案');
    const result = await api.writeDb(database());
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    if (message) (window.showToast || window.alert)(message, 'success');
  }

  function accountsFor(person) {
    const accounts = model().bankAccounts?.(person);
    return Array.isArray(accounts) ? accounts : [];
  }

  function fieldDefinitions() {
    const value = database().residentCustomFields;
    return Array.isArray(value) ? value : [];
  }

  function fieldInput(field, value) {
    const key = escapeHtml(field.id);
    if (field.type === 'number') return `<input type="number" data-resident-custom-field="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.name)}">`;
    if (field.type === 'date') return `<input type="date" data-resident-custom-field="${key}" value="${escapeHtml(value)}">`;
    if (field.type === 'boolean') return `<select data-resident-custom-field="${key}"><option value="">未填写</option><option value="是"${text(value) === '是' ? ' selected' : ''}>是</option><option value="否"${text(value) === '否' ? ' selected' : ''}>否</option></select>`;
    if (field.type === 'select' || field.type === 'multi_select') {
      const choices = Array.isArray(field.options) ? field.options : [];
      return `<select data-resident-custom-field="${key}"><option value="">未填写</option>${choices.map((item) => `<option value="${escapeHtml(item)}"${text(value) === text(item) ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>`;
    }
    return `<input data-resident-custom-field="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.name)}">`;
  }

  function pagination(total, page, pageSize) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `<div class="cf-row-actions resident-operation-pagination"><span>共 ${total} 条</span><label>每页 <select data-resident-operation-page-size>${[10, 20, 50].map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select> 条</label><button class="btn btn-outline" data-resident-operation-page="${Math.max(1, page - 1)}"${page <= 1 ? ' disabled' : ''}>上一页</button><span>第 ${page}/${pages} 页</span><button class="btn btn-outline" data-resident-operation-page="${Math.min(pages, page + 1)}"${page >= pages ? ' disabled' : ''}>下一页</button></div>`;
  }

  function profileContent(person, tab) {
    const histories = Array.isArray(person.farmlandSubsidyHistory) ? person.farmlandSubsidyHistory : [];
    const disbursementHistories = Array.isArray(person.disbursementHistory) ? person.disbursementHistory : [];
    const sources = Array.isArray(person.importSources) ? person.importSources : [];
    const definitions = fieldDefinitions().filter((field) => field.active !== false);
    if (tab === 'accounts') {
      const accounts = accountsFor(person);
      const values = person.customFields && typeof person.customFields === 'object' ? person.customFields : {};
      return `<section class="resident-profile-section"><div class="cf-section-head"><div><h4>收款账户</h4><p>可保存多张银行卡；默认卡会在新建发放时自动带入。</p></div></div>${accounts.length ? `<div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>银行卡号</th><th>开户行 / 开户人</th><th>默认卡</th><th>资料来源</th><th>操作</th></tr></thead><tbody>${accounts.map((account) => `<tr><td>${escapeHtml(maskCard(account.cardNumber))}</td><td>${escapeHtml(account.bankName || '未填写')}<br><span class="text-secondary">${escapeHtml(account.accountName || personName(person) || '—')}</span></td><td>${account.isDefault ? '是' : '否'}</td><td>${escapeHtml(account.source || '居民档案')}</td><td>${account.isDefault ? '当前默认卡' : `<button class="btn btn-outline" data-resident-set-default-card="${escapeHtml(account.cardNumber)}">设为默认卡</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="cf-empty">暂未登记银行卡资料。</div>'}<div class="resident-account-form"><strong>添加银行卡</strong><input data-resident-new-card placeholder="银行卡号"><input data-resident-new-bank placeholder="开户行（可选）"><input data-resident-new-account-name placeholder="开户人（可选）"><label class="cf-check"><input type="checkbox" data-resident-new-default${accounts.length ? '' : ' checked'}> 设为默认卡</label><button class="btn btn-outline" data-resident-add-card>添加银行卡</button></div></section><section class="resident-profile-section"><div class="cf-section-head"><div><h4>扩展资料</h4><p>管理员创建的字段默认面向全体居民；不适用时可留空。</p></div><button class="btn btn-outline" data-resident-manage-fields>管理字段</button></div>${definitions.length ? `<div class="resident-custom-fields">${definitions.map((field) => `<label><span>${escapeHtml(field.name)}</span>${fieldInput(field, values[field.id])}</label>`).join('')}</div><div class="cf-row-actions"><button class="btn btn-primary" data-resident-save-custom-fields>保存扩展资料</button></div>` : '<div class="cf-empty">尚未创建扩展字段。可点击“管理字段”创建文字、数字、日期或选择项。</div>'}</section>`;
    }
    if (tab === 'subsidy') return histories.length ? `<table class="cf-table"><thead><tr><th>年度</th><th>村民组</th><th>应补面积</th><th>标准</th><th>补贴金额</th><th>导入时间</th></tr></thead><tbody>${histories.map((item) => `<tr><td>${escapeHtml(item.ledgerYear || '—')}</td><td>${escapeHtml(item.groupName || '—')}</td><td>${escapeHtml(item.eligibleArea || 0)} 亩</td><td>${money(item.standardCents)}</td><td>${money(item.amountCents)}</td><td>${formatTime(item.importedAt)}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未导入地力补贴记录。</div>';
    if (tab === 'funds') return disbursementHistories.length ? `<table class="cf-table"><thead><tr><th>日期</th><th>类别 / 事项</th><th>金额</th><th>收款账户</th><th>来源批次</th></tr></thead><tbody>${disbursementHistories.map((item) => `<tr><td>${escapeHtml(item.batchDate || item.period || '—')}</td><td>${escapeHtml(item.categoryName || '其他发放')}<br><span class="text-secondary">${escapeHtml(item.workItem || item.role || item.responsibilityArea || item.remark || item.period || '—')}</span></td><td>${money(item.amountCents)}</td><td>${escapeHtml(maskCard(item.bankCard || ''))}</td><td>${escapeHtml(item.batchId || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">发放完成后，工资、承包费、杂工、补贴等会自动显示在这里。</div>';
    if (tab === 'operations') {
      const records = Array.isArray(person.residentOperationLog) ? [...person.residentOperationLog] : [];
      const pageSize = state.operationPageSize; const pages = Math.max(1, Math.ceil(records.length / pageSize)); const page = Math.min(state.operationPage, pages); const visible = records.slice((page - 1) * pageSize, page * pageSize);
      return records.length ? `<table class="cf-table"><thead><tr><th>时间</th><th>操作</th><th>说明</th><th>来源</th><th>操作人</th></tr></thead><tbody>${visible.map((item) => `<tr><td>${formatTime(item.occurredAt)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.description || item.changedFields?.join('、') || '—')}</td><td>${escapeHtml(item.batchId || item.sourceType || '居民档案')}</td><td>${escapeHtml(item.operator || '当前操作员')}</td></tr>`).join('')}</tbody></table>${pagination(records.length, page, pageSize)}` : '<div class="cf-empty">暂未产生操作记录。</div>';
    }
    if (tab === 'sources') return sources.length ? `<table class="cf-table"><thead><tr><th>资料来源</th><th>关联记录</th><th>导入时间</th></tr></thead><tbody>${sources.map((item) => `<tr><td>${escapeHtml(item.sourceType || '居民档案')}</td><td>${escapeHtml(item.recordId || item.batchId || '—')}</td><td>${formatTime(item.importedAt)}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未记录资料来源。</div>';
    return `<div class="cf-record-summary"><strong>${escapeHtml(personName(person) || '未填写姓名')}</strong><br>身份证号：${escapeHtml(personIdCard(person) || '未填写')}<br>村民组：${escapeHtml(personGroup(person) || '未填写')}<br>联系电话：${escapeHtml(personPhone(person) || '未填写')}</div>`;
  }

  function showProfile(person, activeTab = state.activeTab) {
    const overlay = document.getElementById('resident-subsidy-profile-overlay'); if (!overlay || !person) return;
    state.personId = text(person.id); state.activeTab = activeTab;
    const tabs = [['basic', '基本信息'], ['accounts', '收款账户与扩展资料'], ['subsidy', '地力补贴记录'], ['funds', '资金与工作记录'], ['operations', '操作记录'], ['sources', '来源与更正记录']];
    overlay.querySelector('.resident-profile-tabs').innerHTML = tabs.map(([key, label]) => `<button data-resident-profile-tab="${key}" class="${key === activeTab ? 'active' : ''}">${label}</button>`).join('');
    overlay.querySelector('.resident-profile-body').innerHTML = profileContent(person, activeTab);
    overlay.querySelectorAll('[data-resident-profile-tab]').forEach((button) => button.addEventListener('click', () => showProfile(person, button.dataset.residentProfileTab)));
    bindProfileActions(overlay, person, activeTab);
  }

  async function savePersonChange(person, action, description, changedFields) {
    model().appendResidentOperation?.(person, { action, description, changedFields });
    person.updated_at = new Date().toISOString(); await persist(description); showProfile(person, state.activeTab);
  }

  function fieldManager(overlay, person) {
    overlay.querySelector('.resident-profile-body').innerHTML = `<section class="resident-profile-section"><div class="cf-section-head"><div><h4>扩展字段管理</h4><p>字段会对全部居民显示，停用后历史值仍会保留。</p></div><button class="btn btn-outline" data-resident-back-to-accounts>返回资料页</button></div><div class="resident-account-form"><input data-resident-field-name placeholder="字段名称，例如紧急联系人"><select data-resident-field-type><option value="text">文字</option><option value="number">数字</option><option value="date">日期</option><option value="select">单选</option><option value="multi_select">多选</option><option value="boolean">是 / 否</option></select><input data-resident-field-options placeholder="选项用顿号或逗号分隔（选择项时填写）"><button class="btn btn-primary" data-resident-create-field>新建字段</button></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>字段</th><th>类型</th><th>选项</th><th>状态</th><th>操作</th></tr></thead><tbody>${fieldDefinitions().map((field) => `<tr><td>${escapeHtml(field.name)}</td><td>${escapeHtml(({ text: '文字', number: '数字', date: '日期', select: '单选', multi_select: '多选', boolean: '是/否' })[field.type] || field.type)}</td><td>${escapeHtml((field.options || []).join('、') || '—')}</td><td>${field.active === false ? '已停用' : '启用'}</td><td><button class="btn btn-outline" data-resident-toggle-field="${escapeHtml(field.id)}">${field.active === false ? '启用' : '停用'}</button></td></tr>`).join('') || '<tr><td colspan="5">尚未创建字段</td></tr>'}</tbody></table></div></section>`;
    overlay.querySelector('[data-resident-back-to-accounts]').addEventListener('click', () => showProfile(person, 'accounts'));
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
    overlay.querySelectorAll('[data-resident-set-default-card]').forEach((button) => button.addEventListener('click', async () => { model().setDefaultBankCard?.(person, button.dataset.residentSetDefaultCard, { source: 'resident-profile' }); await savePersonChange(person, '设置默认收款卡', `已将卡尾号 ${text(button.dataset.residentSetDefaultCard).slice(-4)} 设为默认收款卡`, ['默认银行卡']); }));
    overlay.querySelector('[data-resident-add-card]')?.addEventListener('click', async () => { const card = text(overlay.querySelector('[data-resident-new-card]')?.value); if (!card) return window.alert('请填写银行卡号'); const bankName = text(overlay.querySelector('[data-resident-new-bank]')?.value); const accountName = text(overlay.querySelector('[data-resident-new-account-name]')?.value); const makeDefault = Boolean(overlay.querySelector('[data-resident-new-default]')?.checked); model().addBankAccount?.(person, { cardNumber: card, bankName, accountName }, { source: 'resident-profile', makeDefault }); await savePersonChange(person, '新增收款账户', `新增${makeDefault ? '默认' : '备用'}银行卡，卡尾号 ${card.slice(-4)}`, [makeDefault ? '默认银行卡' : '备用银行卡']); });
    overlay.querySelector('[data-resident-manage-fields]')?.addEventListener('click', () => fieldManager(overlay, person));
    overlay.querySelector('[data-resident-save-custom-fields]')?.addEventListener('click', async () => { const values = { ...(person.customFields || {}) }; overlay.querySelectorAll('[data-resident-custom-field]').forEach((input) => { values[input.dataset.residentCustomField] = text(input.value); }); person.customFields = values; await savePersonChange(person, '更新扩展资料', '已保存居民扩展资料', ['扩展资料']); });
    overlay.querySelector('[data-resident-operation-page-size]')?.addEventListener('change', (event) => { state.operationPageSize = Number(event.target.value) || 10; state.operationPage = 1; showProfile(person, 'operations'); });
    overlay.querySelectorAll('[data-resident-operation-page]').forEach((button) => button.addEventListener('click', () => { state.operationPage = Number(button.dataset.residentOperationPage) || 1; showProfile(person, 'operations'); }));
  }

  function openProfileDialog() {
    close(); const overlay = document.createElement('div'); overlay.id = 'resident-subsidy-profile-overlay'; overlay.className = 'cf-modal-overlay';
    overlay.innerHTML = `<div class="cf-modal"><div class="cf-modal-head"><h3>居民档案资料</h3><button class="cf-close" data-resident-profile-action="close">×</button></div><div class="cf-modal-body"><div class="cf-subsidy-search"><input id="resident-profile-query" placeholder="输入姓名、身份证号或村民组"><button class="btn btn-primary" data-resident-profile-action="search">查询居民</button></div><div id="resident-profile-results" class="cf-row-actions"></div><div class="resident-profile-tabs"></div><div class="resident-profile-body"><div class="cf-empty">请先查询并选择一名居民。</div></div></div><div class="cf-modal-foot"><button class="btn btn-outline" data-resident-profile-action="close">关闭</button></div></div>`;
    document.body.appendChild(overlay);
    const search = () => { const needle = text(document.getElementById('resident-profile-query')?.value).toLowerCase(); const matches = personnel().filter((person) => !needle || [personName(person), personIdCard(person), personGroup(person)].some((value) => text(value).toLowerCase().includes(needle))).slice(0, 20); const result = overlay.querySelector('#resident-profile-results'); result.innerHTML = matches.length ? matches.map((person) => `<button class="btn btn-outline" data-resident-profile-person="${escapeHtml(person.id)}">${escapeHtml(personName(person))} · ${escapeHtml(personGroup(person) || '未分组')}</button>`).join('') : '<span class="text-secondary">未找到居民档案。</span>'; result.querySelectorAll('[data-resident-profile-person]').forEach((button) => button.addEventListener('click', () => { state.operationPage = 1; showProfile(personnel().find((person) => text(person.id) === text(button.dataset.residentProfilePerson))); })); };
    overlay.querySelectorAll('[data-resident-profile-action="close"]').forEach((button) => button.addEventListener('click', close)); overlay.querySelector('[data-resident-profile-action="search"]').addEventListener('click', search); overlay.querySelector('#resident-profile-query').addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); }); overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  function ensureEntry() { const tab = document.getElementById('tab-personnel'); if (!tab || tab.querySelector('[data-resident-subsidy-profile-entry]')) return; const anchor = tab.querySelector('h2, h3'); if (!anchor) return; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.dataset.residentSubsidyProfileEntry = 'true'; button.textContent = '居民资料标签'; button.addEventListener('click', openProfileDialog); anchor.parentElement?.appendChild(button); }

  window.openResidentSubsidyProfile = openProfileDialog;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureEntry, { once: true }); else ensureEntry();
  new MutationObserver(ensureEntry).observe(document.documentElement, { childList: true, subtree: true });
})();
