'use strict';

(function contractFeeWorkspace(root) {
  const model = root.ContractFeeModel;
  const api = root.api;
  const featureKeys = ['resourceContracts', 'contractFeeLedgers', 'contractFeeBatches', 'contractFeeReceipts', 'contractFeeAdvances', 'disbursementCategories', 'disbursementBatches', 'disbursementProfiles', 'farmlandSubsidyLedgers'];
  const state = { database: null, view: 'overview', modal: null, importDraft: null };

  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const money = (cents) => `¥${model.centsToYuan(cents)}`;
  const yuanValue = (cents) => model.centsToYuan(cents || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  const selected = (left, right) => (String(left ?? '') === String(right ?? '') ? ' selected' : '');
  const checked = (value) => (value ? ' checked' : '');
  const findById = (collection, id) => (state.database?.[collection] || []).find((item) => item.id === id);
  const contractFor = (id) => findById('resourceContracts', id);
  const ledgerForContract = (contractId) => (state.database?.contractFeeLedgers || []).find((item) => item.contractId === contractId);
  const landItems = () => (state.database?.landParcel?.length ? state.database.landParcel : state.database?.lands) || [];
  const landName = (land) => text(land?.land_name || land?.name || land?.parcel_name || land?.code || land?.id);
  const statusLabels = { draft: '草稿', reviewed: '已核对', exported: '已导出', partial: '部分成功', completed: '已完成' };
  const paymentLabels = { pending: '待发放', unpaid: '未发放', failed: '发放失败', paid: '已发放' };

  function notify(message, type = 'success') {
    if (typeof root.showToast === 'function') root.showToast(message, type);
    else root.alert(message);
  }

  function ensureCollections(database) {
    for (const key of featureKeys) if (!Array.isArray(database[key])) database[key] = [];
    if (!Array.isArray(database.personnel)) database.personnel = [];
    model.normalizeDisbursementCollections(database);
    return database;
  }

  async function loadDatabase() {
    if (!api?.readDb) throw new Error('当前环境无法读取业务数据');
    state.database = ensureCollections(await api.readDb());
    return state.database;
  }

  async function saveDatabase(message) {
    const result = await api.writeDb(state.database);
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    try { if (typeof dbState !== 'undefined') dbState = state.database; } catch (_error) { /* legacy renderer may be unavailable in isolated tests */ }
    if (message) notify(message);
  }

  function icon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h4M15 13h2M7 17h4M15 17h2"/></svg>';
  }

  function injectWorkspace() {
    if (document.getElementById('tab-contract-fees')) return;
    const menu = document.querySelector('.sidebar-menu');
    const financeButton = menu?.querySelector('[data-target="tab-finance"]');
    if (menu) {
      const button = document.createElement('button');
      button.className = 'menu-item';
      button.dataset.target = 'tab-contract-fees';
      button.innerHTML = `${icon()}<span>资金发放中心</span>`;
      financeButton?.insertAdjacentElement('afterend', button) || menu.appendChild(button);
    }
    const section = document.createElement('section');
    section.className = 'tab-content hidden';
    section.id = 'tab-contract-fees';
    section.innerHTML = '<div class="cf-shell"><div class="cf-empty">资金发放中心正在加载…</div></div>';
    document.querySelector('.app-main')?.appendChild(section);
  }

  function statusBadge(status) {
    const css = status === 'completed' || status === 'paid' || status === 'reimbursed' ? 'ok' : status === 'failed' ? 'danger' : status === 'draft' || status === 'pending' || status === 'unpaid' || status === 'pending_reimbursement' ? 'warn' : '';
    return `<span class="cf-badge ${css}">${escapeHtml(statusLabels[status] || paymentLabels[status] || ({ pending_reimbursement: '待归还垫付款', reimbursed: '已归还' })[status] || status)}</span>`;
  }

  function stats() {
    return model.summarizeDisbursementDashboard(state.database.disbursementBatches);
  }

  function renderShell() {
    const section = document.querySelector('#tab-contract-fees .cf-shell');
    if (!section || !state.database) return;
    const summary = stats();
    section.innerHTML = `
      <div class="cf-header"><div><h2>资金发放中心</h2><p>统一管理承包费、补贴、工资和其他资金发放；合同仅在承包费办理时按需关联。</p></div>
        <div class="cf-actions"><button class="btn btn-outline" data-cf-action="manage-categories">管理类别</button><button class="btn btn-outline" data-cf-action="manage-profiles">固定人员台账</button><button class="btn btn-outline" data-cf-action="manage-subsidies">地力补贴台账</button><button class="btn btn-primary" data-cf-action="new-disbursement-batch">＋ 新建发放批次</button></div></div>
      <div class="cf-stats"><div class="cf-stat"><span>发放总额</span><strong>${money(summary.totalCents)}</strong></div><div class="cf-stat"><span>待审核批次</span><strong>${summary.pendingReview}</strong></div><div class="cf-stat"><span>已发放批次</span><strong>${summary.completed}</strong></div><div class="cf-stat"><span>资金类别</span><strong>${state.database.disbursementCategories.filter((item) => item.active !== false).length}</strong></div></div>
      <div class="cf-nav">${[['overview', '汇总看板'], ['general-batches', '全部发放批次'], ['profiles', '固定人员台账'], ['subsidies', '年度地力补贴'], ['ledger', '承包费历史台账'], ['batches', '历史承包费记录']].map(([key, label]) => `<button class="${state.view === key ? 'active' : ''}" data-cf-view="${key}">${label}</button>`).join('')}</div>
      <div id="cf-view"></div>`;
    renderView();
  }

  function renderView() {
    const target = document.getElementById('cf-view');
    if (!target) return;
    if (state.view === 'general-batches') target.innerHTML = renderGeneralBatches();
    else if (state.view === 'profiles') target.innerHTML = renderProfiles();
    else if (state.view === 'subsidies') target.innerHTML = renderSubsidyLedgers();
    else if (state.view === 'ledger') target.innerHTML = renderLedgers();
    else if (state.view === 'batches') target.innerHTML = renderBatches();
    else if (state.view === 'issues') target.innerHTML = renderIssues();
    else target.innerHTML = renderOverview();
  }

  function renderOverview() {
    const summary = stats();
    const categoryRows = Object.entries(summary.totalsByCategory).map(([name, total]) => `<tr><td><strong>${escapeHtml(name)}</strong></td><td>${money(total)}</td></tr>`).join('');
    const recentRows = [...state.database.disbursementBatches].sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt))).slice(0, 6).map((batch) => { const batchSummary = model.summarizeDisbursementBatch(batch); return `<tr><td><strong>${escapeHtml(batch.categoryName)}</strong><br><span class="text-secondary">${escapeHtml(batch.period)}</span></td><td>${statusBadge(batch.status)}</td><td>${money(batchSummary.totalCents)}</td><td>${batchSummary.recipientCount} 人</td></tr>`; }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>类别发放汇总</h3><span class="text-secondary">按当前已登记的发放批次统计</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>资金类别</th><th>发放金额</th></tr></thead><tbody>${categoryRows || '<tr><td colspan="2"><div class="cf-empty">暂无发放数据，可先新建发放批次。</div></td></tr>'}</tbody></table></div></div><div class="cf-panel"><div class="cf-panel-head"><h3>最近发放批次</h3></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>类别 / 期间</th><th>状态</th><th>金额</th><th>收款人</th></tr></thead><tbody>${recentRows || '<tr><td colspan="4"><div class="cf-empty">暂无发放批次。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function renderGeneralBatches() {
    const rows = [...state.database.disbursementBatches].sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt))).map((batch) => { const summary = model.summarizeDisbursementBatch(batch); return `<tr><td><strong>${escapeHtml(batch.categoryName)}</strong><br><span class="text-secondary">${escapeHtml(batch.period)} · ${escapeHtml(batch.batchDate || '未填日期')}</span></td><td>${statusBadge(batch.status)}</td><td>${money(summary.totalCents)}</td><td>${summary.paidCount}/${summary.recipientCount} 人</td><td>${escapeHtml(batch.notes || '—')}</td><td><div class="cf-row-actions">${batch.status === 'draft' ? `<button data-cf-action="review-disbursement" data-id="${batch.id}">审核</button>` : ''}${batch.status !== 'completed' ? `<button data-cf-action="pay-disbursement" data-id="${batch.id}">登记已发放</button>` : ''}<button data-cf-action="view-disbursement" data-id="${batch.id}">查看</button></div></td></tr>`; }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>全部发放批次</h3><span class="text-secondary">承包费、补贴、工资和自定义类别统一查询</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>类别 / 期间</th><th>状态</th><th>金额</th><th>收款人</th><th>备注</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="cf-empty">暂无发放批次。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function templateLabel(templateKey) {
    return ({ position_salary: '岗位工资/补贴（A5）', public_service: '公共服务报酬（A5）', casual_labor: '杂工补贴（A5）', contract_fee: '承包费（A4）' })[templateKey] || '通用发放';
  }

  function renderProfiles() {
    const rows = [...state.database.disbursementProfiles].sort((a, b) => text(a.templateKey).localeCompare(text(b.templateKey)) || text(a.name).localeCompare(text(b.name))).map((profile) => `<tr><td>${escapeHtml(templateLabel(profile.templateKey))}</td><td><strong>${escapeHtml(profile.name)}</strong><br><span class="text-secondary">${escapeHtml(profile.groupName || '未分组')}</span></td><td>${escapeHtml(profile.role || profile.responsibilityArea || '—')}</td><td>${money(profile.standardCents)}</td><td>${escapeHtml(profile.bankCard || '未填写')}</td><td>${profile.active === false ? statusBadge('unpaid') : statusBadge('completed')}</td><td><button data-cf-action="edit-profile" data-id="${profile.id}">编辑</button></td></tr>`).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>固定人员基础台账</h3><div class="cf-row-actions"><button data-cf-action="import-profiles">从 Excel 导入</button><button class="btn btn-primary" data-cf-action="new-profile">＋ 新增人员</button></div></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>适用模板</th><th>人员</th><th>岗位 / 负责区域</th><th>默认标准</th><th>银行卡</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="cf-empty">先建立村组干部、党小组长、监督委员或公共服务人员台账，后续发放会自动带出标准。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function renderSubsidyLedgers() {
    const rows = [...state.database.farmlandSubsidyLedgers].sort((a, b) => text(b.year).localeCompare(text(a.year))).map((ledger) => { const summary = model.summarizeFarmlandSubsidyLedger(ledger); const validation = model.validateFarmlandSubsidyLedger(ledger); return `<tr><td><strong>${escapeHtml(ledger.year)} 年</strong><br><span class="text-secondary">${escapeHtml(ledger.villageName || '未填写单位')}</span></td><td>${ledger.records.length} 人<br><span class="text-secondary">村干部 ${summary.villageCadreRecords.length} 人</span></td><td>${money(summary.totalAmountCents)}</td><td>${validation.ok ? '<span class="cf-badge ok">核对通过</span>' : `<button class="cf-badge warn cf-issue-button" data-cf-action="resolve-subsidy-issues" data-id="${ledger.id}">${validation.errors.length} 项待处理 · 去处理</button>`}</td><td>${escapeHtml(ledger.corrections?.length || 0)} 次更正</td><td><div class="cf-row-actions"><button data-cf-action="resolve-subsidy-issues" data-id="${ledger.id}">处理异常</button><button data-cf-action="view-subsidy" data-id="${ledger.id}">主表与附件</button><button data-cf-action="export-subsidy" data-id="${ledger.id}">导出五张表</button></div></td></tr>`; }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>年度地力补贴关联台账</h3><div class="cf-row-actions"><button data-cf-action="import-subsidy">导入整套 Excel</button><button class="btn btn-primary" data-cf-action="new-subsidy">＋ 新建年度台账</button></div></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>年度 / 单位</th><th>对象</th><th>补贴金额</th><th>核对</th><th>更正记录</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="cf-empty">可导入含“地力补贴兑付清册”的整套 Excel；附件将和主表自动关联。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function renderLedgers() {
    const rows = state.database.resourceContracts.map((contract) => {
      const ledger = ledgerForContract(contract.id);
      const groupNames = ledger ? [...new Set(ledger.items.map((item) => item.groupName))].filter(Boolean) : [];
      return `<tr><td><strong>${escapeHtml(contract.name)}</strong><br><span class="text-secondary">${escapeHtml(contract.startDate)} 至 ${escapeHtml(contract.endDate)}</span></td><td>${ledger ? '<span class="cf-badge ok">已建立</span>' : '<span class="cf-badge warn">未建立</span>'}</td><td>${ledger?.items.length || 0} 人</td><td>${escapeHtml(groupNames.join('、') || '—')}</td><td><div class="cf-row-actions">${ledger ? `<button data-cf-action="view-ledger" data-id="${ledger.id}">查看台账</button><button data-cf-action="new-batch" data-id="${ledger.id}">新建发放批次</button>` : `<button data-cf-action="import-ledger" data-id="${contract.id}">首次导入</button>`}</div></td></tr>`;
    }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>合同发放台账</h3><span class="text-secondary">一份合同保留一份长期台账，后续不必重复上传 Excel</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>合同</th><th>状态</th><th>居民数</th><th>涉及组别</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="cf-empty">请先新建合同。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function renderBatches() {
    const rows = [...state.database.contractFeeBatches].sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt))).map((batch) => {
      const summary = model.summarizeBatch(batch);
      const paid = batch.items.filter((item) => item.paymentStatus === 'paid').length;
      return `<tr><td><strong>${escapeHtml(batch.contractName)}</strong><br><span class="text-secondary">${escapeHtml(batch.batchDate || '未填写日期')}</span></td><td>${statusBadge(batch.status)}</td><td>${money(summary.totalCents)}</td><td>${paid}/${batch.items.length} 人</td><td>${summary.differenceCents ? `${money(summary.differenceCents)}<br><span class="text-secondary">${escapeHtml(batch.differenceExplanation || '待说明')}</span>` : '无差额'}</td><td><div class="cf-row-actions"><button data-cf-action="edit-batch" data-id="${batch.id}">${batch.status === 'draft' ? '编辑核对' : '查看'}</button><button data-cf-action="export-batch" data-id="${batch.id}">按组导出</button><button data-cf-action="payment-results" data-id="${batch.id}">登记结果</button><button data-cf-action="advance" data-id="${batch.id}">垫付记录</button></div></td></tr>`;
    }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>发放记录</h3><span class="text-secondary">历史欠发单独保留，不自动并入新批次</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>合同 / 发放日</th><th>状态</th><th>发放总额</th><th>成功人数</th><th>合同差额</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="cf-empty">暂无发放批次。</div></td></tr>'}</tbody></table></div></div>`;
  }

  function renderIssues() {
    const itemRows = state.database.contractFeeBatches.flatMap((batch) => batch.items.filter((item) => ['failed', 'unpaid'].includes(item.paymentStatus)).map((item) => `<tr><td>${escapeHtml(batch.contractName)}</td><td>${escapeHtml(item.groupName)}</td><td>${escapeHtml(item.name)}</td><td>${money(item.finalAmountCents)}</td><td>${statusBadge(item.paymentStatus)}</td><td>${escapeHtml(item.paymentNote || '—')}</td><td><button class="btn btn-outline" data-cf-action="payment-results" data-id="${batch.id}">处理</button></td></tr>`)).join('');
    const advances = state.database.contractFeeAdvances.filter((item) => item.status === 'pending_reimbursement').map((advance) => {
      const contract = contractFor(advance.contractId);
      return `<tr><td>${escapeHtml(contract?.name || '未知合同')}</td><td colspan="2">居委会垫付</td><td>${money(advance.amountCents)}</td><td>${statusBadge(advance.status)}</td><td>${escapeHtml(advance.advancedDate)}</td><td><button class="btn btn-outline" data-cf-action="reimburse" data-id="${advance.id}">登记归还</button></td></tr>`;
    }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>待处理事项</h3><span class="text-secondary">失败、未发放和待归还垫付款持续保留</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>合同</th><th>组别</th><th>姓名 / 类型</th><th>金额</th><th>状态</th><th>说明 / 日期</th><th>操作</th></tr></thead><tbody>${itemRows}${advances}${!itemRows && !advances ? '<tr><td colspan="7"><div class="cf-empty">目前没有待处理事项。</div></td></tr>' : ''}</tbody></table></div></div>`;
  }

  function openModal(title, body, { small = false, footer = '' } = {}) {
    document.getElementById('cf-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'cf-modal-overlay';
    overlay.id = 'cf-modal-overlay';
    overlay.innerHTML = `<div class="cf-modal${small ? ' small' : ''}"><div class="cf-modal-head"><h3>${escapeHtml(title)}</h3><button class="cf-close" data-cf-action="close-modal">×</button></div><div class="cf-modal-body">${body}</div>${footer ? `<div class="cf-modal-foot">${footer}</div>` : ''}</div>`;
    // Modal buttons also bind locally. This keeps actions such as “编辑主表” available
    // when a surrounding page listener is delayed or replaced during a large-table render.
    overlay.addEventListener('click', async (event) => {
      const actionElement = event.target.closest('[data-cf-action]');
      if (!actionElement || !overlay.contains(actionElement)) return;
      event.preventDefault();
      event.stopPropagation();
      try { await handleAction(actionElement.dataset.cfAction, actionElement); }
      catch (error) { notify(error.message || '操作失败', 'error'); }
    });
    overlay.addEventListener('change', async (event) => {
      const pageSizeControl = event.target.closest('[data-cf-page-size-action]');
      if (!pageSizeControl || !overlay.contains(pageSizeControl)) return;
      try { await handleAction(pageSizeControl.dataset.cfPageSizeAction, pageSizeControl); }
      catch (error) { notify(error.message || '操作失败', 'error'); }
    });
    document.body.appendChild(overlay);
  }

  function closeModal() { document.getElementById('cf-modal-overlay')?.remove(); state.modal = null; }
  const field = (label, input, full = false) => `<div class="cf-field${full ? ' full' : ''}"><label>${label}</label>${input}</div>`;

  function contractModal(contract = {}, sourceContract = null) {
    state.modal = { type: 'contract', attachments: [...(contract.attachments || [])], sourceContract };
    const selectedLandIds = new Set(contract.landParcelIds || []);
    const lands = landItems().map((land) => `<label class="cf-check"><input type="checkbox" name="cf-land" value="${escapeHtml(land.id)}"${checked(selectedLandIds.has(land.id))}>${escapeHtml(landName(land))}</label>`).join('');
    const attachments = attachmentListHtml(state.modal.attachments);
    openModal(contract.id ? '编辑合同' : sourceContract ? '续签为新合同' : '新建资源合同', `<form id="cf-contract-form" class="cf-form-grid" data-id="${escapeHtml(contract.id || '')}">
      ${field('合同名称 *', `<input name="name" value="${escapeHtml(contract.name || (sourceContract ? `${sourceContract.name}（续签）` : ''))}" required>`)}
      ${field('合同编号', `<input name="contractNumber" value="${escapeHtml(contract.contractNumber || '')}">`)}
      ${field('承包人 / 缴费方', `<input name="contractorName" value="${escapeHtml(contract.contractorName || sourceContract?.contractorName || '')}">`)}
      ${field('资源类型', `<input name="resourceType" value="${escapeHtml(contract.resourceType || sourceContract?.resourceType || '土地')}">`)}
      ${field('合同金额（元） *', `<input name="amount" type="number" step="0.01" min="0" value="${escapeHtml(contract.id ? yuanValue(contract.amountCents) : sourceContract ? yuanValue(sourceContract.amountCents) : '')}" required>`)}
      ${field('合同开始日期 *', `<input name="startDate" type="date" value="${escapeHtml(contract.startDate || '')}" required>`)}
      ${field('合同结束日期 *', `<input name="endDate" type="date" value="${escapeHtml(contract.endDate || '')}" required>`)}
      ${field('关联土地档案（可不关联）', `<div class="cf-check-grid">${lands || '<span class="text-secondary">暂无土地档案，可先不关联。</span>'}</div>`, true)}
      ${field('备注', `<textarea name="notes">${escapeHtml(contract.notes || '')}</textarea>`, true)}
      ${field('合同附件', `<div><button type="button" class="btn btn-outline" data-cf-action="add-attachments">选择附件</button><div id="cf-attachment-list" class="cf-row-actions" style="margin-top:8px">${attachments}</div></div>`, true)}
      ${sourceContract ? '<div class="cf-hint cf-field full">保存后将创建一份新合同；原合同和原发放记录保持不变。若原合同已有台账，可同时复制作为新合同的长期台账。</div>' : ''}
      ${sourceContract && ledgerForContract(sourceContract.id) ? field('台账处理', '<label class="cf-check"><input type="checkbox" name="copyLedger" checked>复制原合同发放台账</label>', true) : ''}
    </form>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-contract">保存合同</button>' });
  }

  function attachmentListHtml(attachments) {
    return attachments.length ? attachments.map((item) => `<button type="button" data-cf-action="open-attachment" data-path="${escapeHtml(item.path)}">📎 ${escapeHtml(item.name)}</button>`).join('') : '<span class="text-secondary">暂无附件</span>';
  }

  async function addAttachments() {
    const result = await api.importContractFeeAttachments();
    if (!result?.ok) return;
    state.modal.attachments.push(...(result.data || []));
    document.getElementById('cf-attachment-list').innerHTML = attachmentListHtml(state.modal.attachments);
  }

  async function saveContract() {
    const form = document.getElementById('cf-contract-form');
    const existing = findById('resourceContracts', form.dataset.id);
    const data = new FormData(form);
    const value = Object.fromEntries(data.entries());
    value.landParcelIds = [...form.querySelectorAll('[name="cf-land"]:checked')].map((input) => input.value);
    value.attachments = state.modal.attachments;
    const contract = model.createContract(value, existing ? { id: existing.id } : {});
    if (existing) {
      contract.createdAt = existing.createdAt;
      state.database.resourceContracts.splice(state.database.resourceContracts.indexOf(existing), 1, contract);
    } else {
      state.database.resourceContracts.push(contract);
      const source = state.modal.sourceContract;
      if (source && data.get('copyLedger') === 'on') {
        const oldLedger = ledgerForContract(source.id);
        if (oldLedger) state.database.contractFeeLedgers.push(model.copyLedger(oldLedger, contract.id));
      }
    }
    await saveDatabase(existing ? '合同已更新' : '合同已创建');
    closeModal(); renderShell();
  }

  function importStart(preselectedContractId = '') {
    const available = state.database.resourceContracts.filter((contract) => !ledgerForContract(contract.id));
    if (!available.length) return notify('现有合同都已建立长期台账，无需再次上传 Excel。', 'warning');
    const groups = [...new Set(state.database.personnel.map(model.personGroup).filter(Boolean))].sort();
    state.modal = { type: 'import-start' };
    openModal('首次导入承包费发放台账', `<div class="cf-form-grid">
      ${field('对应合同 *', `<select id="cf-import-contract">${available.map((contract) => `<option value="${contract.id}"${selected(contract.id, preselectedContractId)}>${escapeHtml(contract.name)}（${escapeHtml(contract.startDate)} 至 ${escapeHtml(contract.endDate)}）</option>`).join('')}</select>`, true)}
      ${field('表格涉及的组别 *', `<div class="cf-check-grid">${groups.map((group) => `<label class="cf-check"><input type="checkbox" name="cf-import-group" value="${escapeHtml(group)}">${escapeHtml(group)}</label>`).join('') || '<span class="cf-error">居民档案中没有可用组别，请先完善居民档案。</span>'}</div>`, true)}
      ${field('本次分配规则 *', '<div class="cf-check-grid"><label class="cf-check"><input type="radio" name="cf-import-calculation" value="acreage" checked>按地亩数分配</label><label class="cf-check"><input type="radio" name="cf-import-calculation" value="population">按全组人口平均分配</label></div><small class="cf-hint">选择后只使用对应的亩数或人口字段；缺少该字段的表格行不能建立台账。</small>', true)}
      <div class="cf-hint cf-field full">Excel 仅用于第一次建立台账。系统会在所选组别内按姓名匹配居民；之后每年直接从台账生成发放批次。</div>
    </div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="choose-import-excel">选择并识别 Excel</button>' });
  }

  async function chooseImportExcel() {
    const contractId = document.getElementById('cf-import-contract').value;
    const groups = [...document.querySelectorAll('[name="cf-import-group"]:checked')].map((input) => input.value);
    const calculationType = document.querySelector('[name="cf-import-calculation"]:checked')?.value;
    if (!groups.length) throw new Error('请至少选择一个组别');
    if (!calculationType) throw new Error('请选择本次承包费分配规则');
    const result = await api.selectAndReadContractFeeExcel();
    if (!result?.ok) return;
    const matches = model.matchImportedRows({ rows: result.data.rows, personnel: state.database.personnel, selectedGroups: groups });
    state.importDraft = { contractId, groups, calculationType, source: result.data, matches };
    renderImportPreview();
  }

  function renderImportPreview() {
    const draft = state.importDraft;
    const eligible = state.database.personnel.filter((person) => draft.groups.includes(model.personGroup(person)));
    const rows = draft.matches.map((match) => {
      const options = eligible.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), model.personId(match.person))}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person))}</option>`).join('');
      const status = match.matchStatus === 'matched' ? statusBadge('completed') : `<span class="cf-badge ${match.matchStatus === 'missing' ? 'danger' : 'warn'}">${match.matchStatus === 'missing' ? '未匹配' : '姓名重复'}</span>`;
      const cardConfirmation = match.bankCard ? `<label class="cf-check"><input type="checkbox" data-cf-bank-confirm="${match.id}"${checked(!match.bankCardConflict)}>确认使用表格卡号</label>${match.bankCardConflict ? `<br><small class="cf-error">现有：${escapeHtml(match.existingBankCard)}</small>` : ''}` : '—';
      const quantity = draft.calculationType === 'population' ? match.population : match.acreage;
      return `<tr class="${match.matchStatus === 'missing' ? 'cf-danger-row' : match.matchStatus === 'ambiguous' || match.bankCardConflict ? 'cf-warning-row' : ''}"><td>${match.sourceRowNumber || ''}</td><td>${escapeHtml(match.name)}</td><td>${status}</td><td><select class="cf-inline-select" data-cf-resolution="${match.id}"><option value="">请选择居民</option>${options}</select></td><td>${escapeHtml(quantity || '—')}</td><td>${escapeHtml(match.unitPrice || '—')}</td><td>${escapeHtml(match.amount || '—')}</td><td>${escapeHtml(match.bankCard || '—')}</td><td>${cardConfirmation}</td></tr>`;
    }).join('');
    state.modal = { type: 'import-preview' };
    const calculationLabel = draft.calculationType === 'population' ? '按全组人口平均分配' : '按地亩数分配';
    const quantityLabel = draft.calculationType === 'population' ? '人口' : '面积（亩）';
    openModal('核对 Excel 识别与居民匹配', `<div class="cf-hint">文件：${escapeHtml(draft.source.fileName)}；工作表：${escapeHtml(draft.source.sheetName)}；分配规则：<strong>${calculationLabel}</strong>。未匹配或重名必须手动指定居民；卡号冲突必须明确确认。</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>行</th><th>表内姓名</th><th>匹配</th><th>居民档案</th><th>${quantityLabel}</th><th>单价</th><th>金额</th><th>卡号</th><th>冲突处理</th></tr></thead><tbody>${rows}</tbody></table></div>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-import-ledger">确认建立长期台账</button>' });
  }

  async function saveImportedLedger() {
    const resolutions = {};
    document.querySelectorAll('[data-cf-resolution]').forEach((selectElement) => { if (selectElement.value) resolutions[selectElement.dataset.cfResolution] = selectElement.value; });
    const matches = model.matchImportedRows({ rows: state.importDraft.source.rows, personnel: state.database.personnel, selectedGroups: state.importDraft.groups, resolutions });
    if (matches.some((match) => !match.person)) throw new Error('仍有未指定居民的表格行，请逐行处理');
    const personIds = matches.map((match) => model.personId(match.person));
    if (new Set(personIds).size !== personIds.length) throw new Error('同一居民被匹配到多行，请检查表格或重新指定居民');
    for (const match of matches) {
      const confirmation = document.querySelector(`[data-cf-bank-confirm="${CSS.escape(match.id)}"]`);
      if (match.bankCardConflict && !confirmation?.checked) throw new Error(`${match.name}的银行卡号与居民档案不一致，请确认后再保存`);
      if (match.bankCard) model.setDefaultBankCard(match.person, match.bankCard);
    }
    const ledger = model.createLedger({ contractId: state.importDraft.contractId, matches, calculationType: state.importDraft.calculationType, source: state.importDraft.source });
    state.database.contractFeeLedgers.push(ledger);
    await saveDatabase(`已建立长期台账，共 ${ledger.items.length} 人`);
    state.importDraft = null; closeModal(); state.view = 'ledger'; renderShell();
  }

  function ledgerModal(ledger) {
    const contract = contractFor(ledger.contractId);
    const rows = ledger.items.map((item) => {
      const person = state.database.personnel.find((candidate) => model.personId(candidate) === item.personId);
      const changedStatus = person && model.personStatus(person) && !['正常', '在册', ''].includes(model.personStatus(person));
      return `<tr class="${changedStatus ? 'cf-warning-row' : ''}"><td>${escapeHtml(item.groupName)}</td><td><strong>${escapeHtml(item.name)}</strong>${changedStatus ? `<br><span class="cf-badge warn">居民状态：${escapeHtml(model.personStatus(person))}</span>` : ''}</td><td>${item.calculationType === 'population' ? '按人口' : item.calculationType === 'acreage' ? '按亩数' : '直接金额'}</td><td>${escapeHtml(item.quantity)}</td><td>${money(item.unitPriceCents)}</td><td>${money(item.plannedAmountCents)}</td><td>${escapeHtml(item.bankCard || '—')}</td><td><button data-cf-action="replace-person" data-ledger-id="${ledger.id}" data-item-id="${item.id}">更换未来领取人</button></td></tr>`;
    }).join('');
    openModal(`${contract?.name || ''} · 长期发放台账`, `<div class="cf-hint">居民状态变化只提醒，不自动删除。更换领取人只影响以后新建的批次，历史记录保持原样。</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>组别</th><th>姓名</th><th>计算方式</th><th>人口/亩数</th><th>单价</th><th>计划金额</th><th>银行卡号</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`, { footer: `<button class="btn btn-outline" data-cf-action="close-modal">关闭</button><button class="btn btn-primary" data-cf-action="new-batch" data-id="${ledger.id}">从台账新建发放批次</button>` });
  }

  function replacePersonModal(ledgerId, itemId) {
    const ledger = findById('contractFeeLedgers', ledgerId);
    const item = ledger.items.find((entry) => entry.id === itemId);
    const candidates = state.database.personnel.filter((person) => model.personGroup(person) === item.groupName);
    state.modal = { type: 'replace-person', ledgerId, itemId };
    openModal('更换未来批次领取人', `<div class="cf-form-grid">${field('原领取人', `<input value="${escapeHtml(item.name)} · ${escapeHtml(item.groupName)}" disabled>`, true)}${field('新领取人 *', `<select id="cf-replacement-person"><option value="">请选择</option>${candidates.map((person) => `<option value="${escapeHtml(model.personId(person))}">${escapeHtml(model.personName(person))} · ${escapeHtml(model.defaultBankCard(person) || '无卡号')}</option>`).join('')}</select>`, true)}${field('更换原因 *', '<textarea id="cf-replacement-reason" placeholder="例如：家庭协商变更领取人"></textarea>', true)}<div class="cf-hint cf-field full">系统不另外保留“实际领取人身份”字段；新领取人将直接成为今后台账领取人。</div></div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-replacement">确认更换</button>' });
  }

  async function saveReplacement() {
    const ledger = findById('contractFeeLedgers', state.modal.ledgerId);
    const personId = document.getElementById('cf-replacement-person').value;
    const person = state.database.personnel.find((candidate) => model.personId(candidate) === personId);
    if (!person) throw new Error('请选择新领取人');
    const replacement = model.replaceLedgerPerson(ledger, state.modal.itemId, person, document.getElementById('cf-replacement-reason').value);
    state.database.contractFeeLedgers.splice(state.database.contractFeeLedgers.indexOf(ledger), 1, replacement);
    await saveDatabase('未来批次领取人已更换'); closeModal(); renderShell();
  }

  function batchModal(batch, readOnly = false) {
    state.modal = { type: 'batch', batch: structuredClone(batch), readOnly };
    renderBatchModal();
  }

  function renderBatchModal() {
    const batch = state.modal.batch;
    const summary = model.summarizeBatch(batch);
    const rows = batch.items.map((item) => `<tr><td>${escapeHtml(item.groupName)}</td><td>${escapeHtml(item.name)}</td><td>${item.calculationType === 'population' ? '按人口' : item.calculationType === 'acreage' ? '按亩数' : '直接金额'}</td><td>${escapeHtml(item.quantity)}</td><td>${money(item.unitPriceCents)}</td><td>${money(item.calculatedAmountCents)}</td><td><input class="cf-amount-input" type="number" step="0.01" min="0" data-cf-batch-amount="${item.id}" value="${yuanValue(item.finalAmountCents)}"${state.modal.readOnly ? ' disabled' : ''}></td><td><input data-cf-batch-reason="${item.id}" value="${escapeHtml(item.adjustmentReason || '')}" placeholder="金额有改动时必填"${state.modal.readOnly ? ' disabled' : ''}></td><td>${escapeHtml(item.bankCard || '—')}</td></tr>`).join('');
    openModal(`${batch.contractName} · 发放批次`, `<div class="cf-form-grid">${field('实际发放日期 *', `<input id="cf-batch-date" type="date" value="${escapeHtml(batch.batchDate || '')}"${state.modal.readOnly ? ' disabled' : ''}>`)}${field('合同完整期限', `<input value="${escapeHtml(batch.contractStartDate)} 至 ${escapeHtml(batch.contractEndDate)}" disabled>`)}${field('合同金额', `<input value="${money(batch.contractAmountCents)}" disabled>`)}${field('当前发放总额', `<input value="${money(summary.totalCents)}" disabled>`)}${field('差额用途说明', `<textarea id="cf-difference-explanation" placeholder="合同金额与居民总额不一致时必填"${state.modal.readOnly ? ' disabled' : ''}>${escapeHtml(batch.differenceExplanation || '')}</textarea>`, true)}</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>组别</th><th>姓名</th><th>方式</th><th>人口/亩数</th><th>单价</th><th>自动计算</th><th>实际金额</th><th>修改原因</th><th>银行卡号</th></tr></thead><tbody>${rows}</tbody></table></div>`, { footer: state.modal.readOnly ? '<button class="btn btn-primary" data-cf-action="close-modal">关闭</button>' : '<button class="btn btn-outline" data-cf-action="save-batch-draft">保存草稿</button><button class="btn btn-primary" data-cf-action="review-batch">核对完成</button>' });
  }

  function collectBatch() {
    const batch = state.modal.batch;
    batch.batchDate = document.getElementById('cf-batch-date').value;
    batch.differenceExplanation = document.getElementById('cf-difference-explanation').value;
    document.querySelectorAll('[data-cf-batch-amount]').forEach((input) => { batch.items.find((item) => item.id === input.dataset.cfBatchAmount).finalAmountCents = model.amountToCents(input.value); });
    document.querySelectorAll('[data-cf-batch-reason]').forEach((input) => { batch.items.find((item) => item.id === input.dataset.cfBatchReason).adjustmentReason = text(input.value); });
    return batch;
  }

  async function persistBatch(review) {
    let batch = collectBatch();
    if (review) batch = model.reviewBatch(batch);
    const existing = findById('contractFeeBatches', batch.id);
    if (existing) state.database.contractFeeBatches.splice(state.database.contractFeeBatches.indexOf(existing), 1, batch);
    else state.database.contractFeeBatches.push(batch);
    await saveDatabase(review ? '批次已核对，可按组导出' : '批次草稿已保存'); closeModal(); state.view = 'batches'; renderShell();
  }

  async function exportBatch(batchId) {
    let batch = findById('contractFeeBatches', batchId);
    if (batch.status === 'draft') throw new Error('请先打开批次并完成核对');
    const contract = contractFor(batch.contractId);
    const groupMap = new Map();
    batch.items.forEach((item) => { if (!groupMap.has(item.groupName)) groupMap.set(item.groupName, []); groupMap.get(item.groupName).push(item); });
    const result = await api.exportContractFeeGroupFiles({ contract, batch, groups: [...groupMap].map(([groupName, rows]) => ({ groupName, rows })) });
    if (!result?.ok) return;
    batch = model.markBatchExported(batch, { exportedFiles: result.files || [] });
    state.database.contractFeeBatches.splice(state.database.contractFeeBatches.findIndex((item) => item.id === batchId), 1, batch);
    await saveDatabase(`已按 ${result.files.length} 个组分别导出 Excel`); renderShell();
  }

  function paymentResultsModal(batch) {
    if (!batch.exportedAt) throw new Error('请先按组导出银行发放表，再登记银行处理结果');
    state.modal = { type: 'payment-results', batchId: batch.id };
    const rows = batch.items.map((item) => `<tr><td>${escapeHtml(item.groupName)}</td><td>${escapeHtml(item.name)}</td><td>${money(item.finalAmountCents)}</td><td><select class="cf-inline-select" data-cf-payment-status="${item.id}"><option value="pending"${selected(item.paymentStatus, 'pending')}>待发放</option><option value="paid"${selected(item.paymentStatus, 'paid')}>已发放</option><option value="failed"${selected(item.paymentStatus, 'failed')}>发放失败</option><option value="unpaid"${selected(item.paymentStatus, 'unpaid')}>本次未发放</option></select></td><td><input data-cf-payment-note="${item.id}" value="${escapeHtml(item.paymentNote || '')}" placeholder="失败原因或说明"></td></tr>`).join('');
    openModal('登记银行发放结果', `<div class="cf-hint">个别失败或未发放不会影响其他居民；这些记录会继续出现在待处理事项中，不自动并入下一批。</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>组别</th><th>姓名</th><th>金额</th><th>结果</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-payment-results">保存结果</button>' });
  }

  async function savePaymentResults() {
    const batch = findById('contractFeeBatches', state.modal.batchId);
    const results = [...document.querySelectorAll('[data-cf-payment-status]')].map((selectElement) => ({ itemId: selectElement.dataset.cfPaymentStatus, status: selectElement.value, note: document.querySelector(`[data-cf-payment-note="${CSS.escape(selectElement.dataset.cfPaymentStatus)}"]`).value }));
    for (const result of results) if (result.status === 'failed' && !text(result.note)) throw new Error('发放失败必须填写原因');
    const updated = model.updatePaymentResults(batch, results);
    state.database.contractFeeBatches.splice(state.database.contractFeeBatches.indexOf(batch), 1, updated);
    await saveDatabase('发放结果已保存'); closeModal(); renderShell();
  }

  function receiptModal(contract) {
    const existing = state.database.contractFeeReceipts.find((item) => item.contractId === contract.id);
    if (existing) return openModal('承包人缴费记录', `<div class="cf-form-grid">${field('合同', `<input value="${escapeHtml(contract.name)}" disabled>`, true)}${field('到账金额', `<input value="${money(existing.amountCents)}" disabled>`)}${field('实际到账日期', `<input value="${escapeHtml(existing.receivedDate)}" disabled>`)}</div>`, { small: true, footer: '<button class="btn btn-primary" data-cf-action="close-modal">关闭</button>' });
    state.modal = { type: 'receipt', contractId: contract.id };
    openModal('登记承包人缴费到账', `<div class="cf-form-grid">${field('合同', `<input value="${escapeHtml(contract.name)}" disabled>`, true)}${field('应缴金额（不允许多缴少缴）', `<input value="${money(contract.amountCents)}" disabled>`)}${field('实际到账日期 *', `<input id="cf-receipt-date" type="date" value="${today()}">`)}</div><div class="cf-hint">即使居民已由居委会先行垫付，也可在此后补登记承包人到账日期。</div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-receipt">确认到账</button>' });
  }

  async function saveReceipt() {
    const contract = contractFor(state.modal.contractId);
    const receipt = model.createReceipt({ contractId: contract.id, amount: yuanValue(contract.amountCents), receivedDate: document.getElementById('cf-receipt-date').value });
    if (!receipt.receivedDate) throw new Error('请填写实际到账日期');
    state.database.contractFeeReceipts.push(receipt); await saveDatabase('承包人缴费已登记'); closeModal(); renderShell();
  }

  function advanceModal(batch) {
    const existing = state.database.contractFeeAdvances.find((item) => item.batchId === batch.id);
    if (existing) return openModal('居委会垫付记录', `<div class="cf-form-grid">${field('垫付金额', `<input value="${money(existing.amountCents)}" disabled>`)}${field('垫付日期', `<input value="${escapeHtml(existing.advancedDate)}" disabled>`)}${field('状态', `<div>${statusBadge(existing.status)}</div>`, true)}</div>`, { small: true, footer: '<button class="btn btn-primary" data-cf-action="close-modal">关闭</button>' });
    const summary = model.summarizeBatch(batch);
    state.modal = { type: 'advance', batchId: batch.id };
    openModal('登记居委会先行垫付', `<div class="cf-form-grid">${field('本批发放金额', `<input value="${money(summary.totalCents)}" disabled>`)}${field('垫付日期 *', `<input id="cf-advance-date" type="date" value="${today()}">`)}</div><div class="cf-hint">垫付记录较少，但会持续显示到“待处理事项”，直到承包款到账后登记归还。</div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-advance">登记垫付</button>' });
  }

  async function saveAdvance() {
    const batch = findById('contractFeeBatches', state.modal.batchId);
    const amount = model.summarizeBatch(batch).totalCents;
    const advance = model.createAdvance({ contractId: batch.contractId, batchId: batch.id, amount: yuanValue(amount), advancedDate: document.getElementById('cf-advance-date').value });
    if (!advance.advancedDate) throw new Error('请填写垫付日期');
    state.database.contractFeeAdvances.push(advance); await saveDatabase('垫付记录已保存'); closeModal(); renderShell();
  }

  function reimburseModal(advance) {
    state.modal = { type: 'reimburse', advanceId: advance.id };
    openModal('登记垫付款归还', `<div class="cf-form-grid">${field('垫付金额', `<input value="${money(advance.amountCents)}" disabled>`)}${field('实际归还日期 *', `<input id="cf-reimburse-date" type="date" value="${today()}">`)}</div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-reimburse">确认已归还</button>' });
  }

  function categoryModal() {
    const rows = state.database.disbursementCategories.map((category) => `<tr><td>${escapeHtml(category.name)}</td><td>${category.groupExport ? '支持按组导出' : '整体导出'}</td><td>${category.builtIn ? '系统预置' : '自定义'}</td><td>${category.active === false ? '已停用' : '启用中'}</td></tr>`).join('');
    state.modal = { type: 'category' };
    openModal('资金类别管理', `<div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>类别</th><th>导出规则</th><th>来源</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><form id="cf-category-form" class="cf-form-grid" style="margin-top:16px">${field('新增类别名称 *', '<input name="name" placeholder="例如：环境整治劳务费">')}${field('导出方式', '<select name="groupExport"><option value="">整体导出</option><option value="yes">按组导出</option></select>')}</form>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">关闭</button><button class="btn btn-primary" data-cf-action="save-category">新增类别</button>' });
  }

  async function saveCategory() {
    const data = Object.fromEntries(new FormData(document.getElementById('cf-category-form')).entries());
    const category = model.createDisbursementCategory({ name: data.name, groupExport: data.groupExport === 'yes' });
    if (state.database.disbursementCategories.some((item) => text(item.name) === category.name)) throw new Error('该资金类别已经存在');
    state.database.disbursementCategories.push(category); await saveDatabase('资金类别已新增'); closeModal(); renderShell();
  }

  const itemValue = (row, name) => row.querySelector(`[name="${name}"]`)?.value || '';
  const profileFor = (id) => findById('disbursementProfiles', id);

  function profileModal(profile = {}) {
    state.modal = { type: 'profile', profileId: profile.id || '' };
    const people = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), profile.personId)}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    openModal(profile.id ? '编辑固定人员' : '新增固定人员', `<form id="cf-profile-form" class="cf-form-grid">
      ${field('适用模板 *', `<select name="templateKey"><option value="position_salary"${selected(profile.templateKey || 'position_salary', 'position_salary')}>岗位工资 / 补贴（A5）</option><option value="public_service"${selected(profile.templateKey, 'public_service')}>公共服务人员报酬（A5）</option></select>`)}
      ${field('关联居民档案', `<select name="personId"><option value="">不关联，手工填写</option>${people}</select>`)}
      ${field('姓名 *', `<input name="name" value="${escapeHtml(profile.name || '')}">`)}
      ${field('所属组别', `<input name="groupName" value="${escapeHtml(profile.groupName || '')}">`)}
      ${field('岗位', `<input name="role" value="${escapeHtml(profile.role || '')}" placeholder="例如：党小组长、监督委员">`)}
      ${field('负责区域', `<input name="responsibilityArea" value="${escapeHtml(profile.responsibilityArea || '')}" placeholder="公共服务人员填写">`)}
      ${field('固定标准（元）', `<input name="standard" type="number" min="0" step="0.01" value="${profile.standardCents === undefined ? '' : yuanValue(profile.standardCents)}">`)}
      ${field('银行卡号', `<input name="bankCard" value="${escapeHtml(profile.bankCard || '')}">`)}
      ${field('备注', `<textarea name="notes">${escapeHtml(profile.notes || '')}</textarea>`, true)}
    </form>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-profile">保存人员</button>' });
  }

  async function saveProfile() {
    const form = document.getElementById('cf-profile-form'); const values = Object.fromEntries(new FormData(form).entries()); const existing = profileFor(state.modal.profileId);
    const profile = model.normalizeProfile(values, state.database.personnel, existing ? { id: existing.id } : {}); if (existing) profile.createdAt = existing.createdAt;
    if (existing) state.database.disbursementProfiles.splice(state.database.disbursementProfiles.indexOf(existing), 1, profile); else state.database.disbursementProfiles.push(profile);
    await saveDatabase(existing ? '固定人员已更新' : '固定人员已新增'); closeModal(); state.view = 'profiles'; renderShell();
  }

  async function importProfiles() {
    const filePath = await api.selectExcelFile(); if (!filePath) return; const imported = await api.readExcelColumns(filePath); if (imported?.error) throw new Error(imported.error);
    const pick = (row, aliases) => { const key = Object.keys(row || {}).find((column) => aliases.includes(text(column).replace(/[\s（）()]/gu, ''))); return key ? row[key] : ''; };
    let count = 0;
    for (const row of imported?.rows || []) {
      const name = pick(row, ['姓名', '户主姓名', '人员姓名']); if (!text(name)) continue;
      const templateKey = /公共服务|庄台|负责区域/u.test(`${pick(row, ['岗位', '职务'])}${pick(row, ['负责区域'])}`) ? 'public_service' : 'position_salary';
      const profile = model.normalizeProfile({ templateKey, name, role: pick(row, ['岗位', '职务']), responsibilityArea: pick(row, ['负责区域']), bankCard: pick(row, ['银行卡号', '银行账号', '卡号', '一卡通号']), standard: pick(row, ['月工资', '元/月', '实发金额', '标准', '单价']) }, state.database.personnel);
      const existing = state.database.disbursementProfiles.find((item) => item.templateKey === profile.templateKey && item.name === profile.name);
      if (existing) state.database.disbursementProfiles.splice(state.database.disbursementProfiles.indexOf(existing), 1, { ...profile, id: existing.id, createdAt: existing.createdAt }); else state.database.disbursementProfiles.push(profile);
      count += 1;
    }
    if (!count) throw new Error('未识别到姓名列，请确认 Excel 包含姓名和岗位或负责区域'); await saveDatabase(`已导入 ${count} 名固定人员`); state.view = 'profiles'; renderShell();
  }

  function templateChooserModal() {
    openModal('选择发放模板', `<div class="cf-template-choices"><button data-cf-action="new-template-batch" data-template="position_salary"><strong>岗位工资 / 补贴</strong><span>村组干部、党小组长、监督委员；月标准 × 月数</span><em>A5</em></button><button data-cf-action="new-template-batch" data-template="public_service"><strong>公共服务人员报酬</strong><span>负责区域、账号、金额</span><em>A5</em></button><button data-cf-action="new-template-batch" data-template="casual_labor"><strong>杂工补贴</strong><span>用工日期、事项、工日 × 单价</span><em>A5</em></button><button data-cf-action="new-disbursement-generic"><strong>其他资金发放</strong><span>补贴或其他类别的通用明细</span><em>通用</em></button></div>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button>' });
  }

  function templateItemHtml(templateKey, item = {}) {
    const people = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), item.personId)}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    const fixed = templateKey !== 'casual_labor';
    const fields = templateKey === 'position_salary'
      ? `<input name="role" value="${escapeHtml(item.role || '')}" placeholder="职务"><input name="quantity" type="number" min="0" step="1" value="${escapeHtml(item.quantity || '')}" placeholder="月份"><input name="unitPrice" type="number" min="0" step="0.01" value="${item.unitPriceCents === undefined ? '' : yuanValue(item.unitPriceCents)}" placeholder="月标准"><input name="deductions" type="number" min="0" step="0.01" value="${item.deductionsCents === undefined ? '' : yuanValue(item.deductionsCents)}" placeholder="扣除款">`
      : templateKey === 'public_service'
        ? `<input name="responsibilityArea" value="${escapeHtml(item.responsibilityArea || '')}" placeholder="负责区域"><input name="unitPrice" type="number" min="0" step="0.01" value="${item.unitPriceCents === undefined ? '' : yuanValue(item.unitPriceCents)}" placeholder="实发金额">`
        : `<input name="workDate" value="${escapeHtml(item.workDate || '')}" placeholder="用工日期"><input name="workItem" value="${escapeHtml(item.workItem || '')}" placeholder="用工事项"><input name="quantity" type="number" min="0" step="0.1" value="${escapeHtml(item.quantity || '')}" placeholder="工日"><input name="unitPrice" type="number" min="0" step="0.01" value="${item.unitPriceCents === undefined ? '' : yuanValue(item.unitPriceCents)}" placeholder="单价">`;
    return `<div class="cf-template-item"><select name="personId"><option value="">${fixed ? '选择居民档案或手工填写' : '临时人员（可手工填写）'}</option>${people}</select><input name="name" value="${escapeHtml(item.name || '')}" placeholder="姓名">${fields}<input name="bankCard" value="${escapeHtml(item.bankCard || '')}" placeholder="银行账号"><input name="finalAmount" type="number" min="0" step="0.01" value="${item.amountCents === undefined ? '' : yuanValue(item.amountCents)}" placeholder="实发金额（可改）"><input name="remark" value="${escapeHtml(item.remark || '')}" placeholder="备注"></div>`;
  }

  function templateBatchModal(templateKey, batch = null) {
    const key = templateKey || batch?.templateKey; const categoryCode = key === 'casual_labor' ? 'casual_labor' : key === 'public_service' ? 'public_service_salary' : 'salary'; const category = state.database.disbursementCategories.find((item) => item.code === categoryCode) || {};
    const profiles = state.database.disbursementProfiles.filter((item) => item.active !== false && ((key === 'position_salary' && item.templateKey === 'position_salary') || (key === 'public_service' && item.templateKey === 'public_service')));
    const initialItems = batch?.items || (key === 'casual_labor' ? [{}] : profiles.map((profile) => ({ personId: profile.personId, name: profile.name, groupName: profile.groupName, role: profile.role, responsibilityArea: profile.responsibilityArea, bankCard: profile.bankCard, unitPriceCents: profile.standardCents, quantity: key === 'position_salary' ? 1 : 0 })));
    state.modal = { type: 'template-batch', templateKey: key, batchId: batch?.id || '' };
    const title = batch?.title || ({ position_salary: '工资结算单', public_service: '农村公共服务运行维护人员报酬发放表', casual_labor: '村级务工补贴发放表' })[key];
    openModal(batch ? `查看 ${templateLabel(key)}` : `新建 ${templateLabel(key)}`, `<form id="cf-template-batch-form" class="cf-form-grid"><input type="hidden" name="categoryId" value="${escapeHtml(batch?.categoryId || category.id || '')}"><input type="hidden" name="categoryName" value="${escapeHtml(batch?.categoryName || category.name || '')}">
      ${field('表格标题 *', `<input name="title" value="${escapeHtml(title)}">`, true)}${field('发放期间 *', `<input name="period" value="${escapeHtml(batch?.period || `${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月`)}">`)}${field('发放日期', `<input name="batchDate" type="date" value="${escapeHtml(batch?.batchDate || today())}">`)}${field('编制单位 / 村居', `<input name="villageName" value="${escapeHtml(batch?.villageName || state.database.settings?.villageName || '')}">`)}${field('审批人', `<input name="approver" value="${escapeHtml(batch?.signers?.approver || '')}">`)}${field('制表人', `<input name="maker" value="${escapeHtml(batch?.signers?.maker || '')}">`)}${field('经办人', `<input name="handler" value="${escapeHtml(batch?.signers?.handler || '')}">`)}${field('备注', `<input name="notes" value="${escapeHtml(batch?.notes || '')}">`, true)}
      <div class="cf-field full"><label>发放明细</label><div id="cf-template-items">${initialItems.map((item) => templateItemHtml(key, item)).join('')}</div>${batch ? '' : '<button type="button" class="btn btn-outline" data-cf-action="add-template-item">＋ 添加人员</button>'}<p id="cf-template-error" class="cf-error" role="alert" style="display:none"></p></div></form>`, { footer: batch ? `<button class="btn btn-outline" data-cf-action="close-modal">关闭</button><button class="btn btn-primary" data-cf-action="preview-template" data-id="${batch.id}">打印预览</button>` : '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-template-batch">保存并预览</button>' });
  }

  function addTemplateItem() { const target = document.getElementById('cf-template-items'); if (target) target.insertAdjacentHTML('beforeend', templateItemHtml(state.modal.templateKey, {})); }

  async function saveTemplateBatch() {
    const form = document.getElementById('cf-template-batch-form'); const error = document.getElementById('cf-template-error'); if (error) error.style.display = 'none';
    try { const values = Object.fromEntries(new FormData(form).entries()); const items = [...form.querySelectorAll('.cf-template-item')].map((row) => ({ personId: itemValue(row, 'personId'), name: itemValue(row, 'name'), role: itemValue(row, 'role'), responsibilityArea: itemValue(row, 'responsibilityArea'), workDate: itemValue(row, 'workDate'), workItem: itemValue(row, 'workItem'), quantity: itemValue(row, 'quantity'), unitPrice: itemValue(row, 'unitPrice'), deductions: itemValue(row, 'deductions'), bankCard: itemValue(row, 'bankCard'), finalAmount: itemValue(row, 'finalAmount'), remark: itemValue(row, 'remark') })).filter((item) => item.personId || item.name);
      const batch = model.createTemplateDisbursementBatch({ ...values, templateKey: state.modal.templateKey, items }, { personnel: state.database.personnel }); state.database.disbursementBatches.push(batch); await saveDatabase('发放批次已保存，请核对打印预览'); templateBatchModal(batch.templateKey, batch); }
    catch (reason) { if (error) { error.textContent = reason.message || '保存失败'; error.style.display = 'block'; } else throw reason; }
  }

  function subsidyRecordHtml(record = {}) {
    const people = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), record.personId)}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    return `<tr class="cf-subsidy-record" data-id="${escapeHtml(record.id || '')}"><td><select name="personId"><option value="">手工匹配</option>${people}</select></td><td><input name="name" value="${escapeHtml(record.name || '')}"></td><td><input name="groupName" value="${escapeHtml(record.groupName || '')}"></td><td><select name="category"><option value="household"${selected(record.category, 'household')}>普通农户</option><option value="village_cadre"${selected(record.category, 'village_cadre')}>村干部</option></select></td><td><input name="eligibleArea" type="number" min="0" step="0.01" value="${escapeHtml(record.eligibleArea || '')}"></td><td><input name="standard" type="number" min="0" step="0.01" value="${record.standardCents === undefined ? '' : yuanValue(record.standardCents)}"></td><td><input name="idCard" value="${escapeHtml(record.idCard || '')}"></td><td><input name="bankName" value="${escapeHtml(record.bankName || '')}"></td><td><input name="bankCard" value="${escapeHtml(record.bankCard || '')}"></td></tr>`;
  }

  function subsidySheetData(ledger, sheet = 'payment') {
    const records = ledger.records || [];
    const households = records.filter((record) => record.category !== 'village_cadre');
    const cadres = records.filter((record) => record.category === 'village_cadre');
    const amount = (record) => yuanValue(record.amountCents);
    const standard = (record) => yuanValue(record.standardCents);
    const detailRows = (rows) => rows.map((record, index) => [index + 1, record.name, record.groupName || '—', record.ownershipArea, record.excludedArea, record.eligibleArea, standard(record), amount(record), record.phone || '—', '']);
    const groupSummary = Object.entries(model.summarizeFarmlandSubsidyLedger(ledger).groupTotals).filter(([, summary]) => summary.householdCount > 0).map(([groupName, summary], index) => [index + 1, ledger.villageName || '—', groupName, summary.householdCount, summary.ownershipArea, summary.excludedArea, summary.eligibleArea, yuanValue(summary.amountCents), '']);
    if (sheet === 'attachment-1-1') return { label: '附件 1-1 · 分户登记清册', headers: ['序号', '户主姓名', '村民组', '确权面积（亩）', '排除面积（亩）', '应补面积（亩）', '标准（元/亩）', '补贴金额（元）', '联系电话', '签字'], rows: detailRows(households) };
    if (sheet === 'attachment-1-4') return { label: '附件 1-4 · 村干部登记清册', headers: ['序号', '户主姓名', '村民组', '补贴依据面积（亩）', '排除面积（亩）', '应补面积（亩）', '标准（元/亩）', '补贴金额（元）', '联系电话', '签字'], rows: detailRows(cadres) };
    if (sheet === 'attachment-2-1') return { label: '附件 2-1 · 分村汇总表', headers: ['序号', '村（居）', '村民组', '补贴户数', '确权面积（亩）', '排除面积（亩）', '应补面积（亩）', '补贴金额（元）', '备注'], rows: groupSummary };
    if (sheet === 'attachment-2-4') {
      const summary = model.summarizeFarmlandSubsidyLedger(ledger); const area = (key) => cadres.reduce((total, record) => total + Number(record[key] || 0), 0);
      return { label: '附件 2-4 · 村干部分村汇总表', headers: ['序号', '村（居）', '补贴户数', '补贴依据面积（亩）', '排除面积（亩）', '应补面积（亩）', '补贴金额（元）', '备注'], rows: [[1, ledger.villageName || '—', cadres.length, area('ownershipArea'), area('excludedArea'), area('eligibleArea'), yuanValue(summary.villageCadreRecords.reduce((total, record) => total + Number(record.amountCents || 0), 0)), '']] };
    }
    return { label: '地力补贴兑付清册（主表）', headers: ['序号', '户主姓名', '身份证号', '开户行', '一卡通号', '村（居）', '村民组', '应补面积（亩）', '标准（元/亩）', '补贴金额（元）', '备注'], rows: records.map((record, index) => [index + 1, record.name, record.idCard || '—', record.bankName || '—', record.bankCard || '—', ledger.villageName || '—', record.groupName || '—', record.eligibleArea, standard(record), amount(record), record.remark || '']) };
  }

  function subsidyQueryRows(rows, query) { const needle = text(query).toLowerCase(); return needle ? rows.filter((row) => row.some((cell) => text(cell).toLowerCase().includes(needle))) : rows; }

  function subsidyUnresolvedRecords(ledger) { return (ledger?.records || []).filter((record) => record.matchStatus !== 'matched'); }

  function subsidyIssueListModal(ledger, page = 1, query = '', pageSize = 10) {
    if (!ledger) throw new Error('未找到年度地力补贴台账');
    const needle = text(query).toLowerCase(); const all = subsidyUnresolvedRecords(ledger); const matched = needle ? all.filter((record) => [record.name, record.groupName, record.idCard, record.bankCard].some((value) => text(value).toLowerCase().includes(needle))) : all;
    const currentPageSize = pageSizeValue(pageSize); const totalPages = Math.max(1, Math.ceil(matched.length / currentPageSize)); const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages); const rows = matched.slice((currentPage - 1) * currentPageSize, currentPage * currentPageSize);
    state.modal = { type: 'subsidy-issues', ledgerId: ledger.id, page: currentPage, query: text(query), pageSize: currentPageSize };
    const tableRows = rows.map((record, index) => { const candidates = model.farmlandSubsidyPersonCandidates(record, state.database.personnel); const candidateText = candidates.length ? `${candidates.length} 名候选${candidates[0] ? ` · ${model.personName(candidates[0].person)}（${candidates[0].reason}）` : ''}` : '未找到推荐候选'; const status = record.associationStatus === 'deferred' ? '暂不关联，等待核实' : '待关联居民'; return `<tr><td>${(currentPage - 1) * currentPageSize + index + 1}</td><td><strong>${escapeHtml(record.name)}</strong><br><span class="text-secondary">${escapeHtml(record.groupName || '未分组')}</span></td><td>${escapeHtml(record.idCard || '未填写')}</td><td>${escapeHtml(record.eligibleArea)} 亩<br>${money(record.amountCents)}</td><td>${escapeHtml(candidateText)}</td><td>${escapeHtml(status)}</td><td><button class="btn btn-primary" data-cf-action="resolve-subsidy-record" data-id="${escapeHtml(record.id)}">处理</button></td></tr>`; }).join('');
    openModal(`${ledger.year} 年地力补贴 · 待处理项`, `<div class="cf-hint">剩余 <strong>${all.length}</strong> 项未关联居民档案。确认关联不会修改补贴面积和金额；“暂不关联”会保留说明，但在全部处理完成前仍不能导出五张表。</div><div class="cf-subsidy-search"><input id="cf-subsidy-issue-query" value="${escapeHtml(query)}" placeholder="输入姓名、身份证号、银行卡号或组别"><button class="btn btn-primary" data-cf-action="search-subsidy-issues">查询定位</button>${query ? '<button class="btn btn-outline" data-cf-action="clear-subsidy-issues-search">清除</button>' : ''}</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>序号</th><th>补贴对象</th><th>身份证号</th><th>补贴数据</th><th>居民候选</th><th>状态</th><th>操作</th></tr></thead><tbody>${tableRows || '<tr><td colspan="7"><div class="cf-empty">没有符合查询条件的待处理项。</div></td></tr>'}</tbody></table></div>${paginationHtml({ totalItems: matched.length, currentPage, totalPages, pageSize: currentPageSize, pageAction: 'subsidy-issues-page', jumpAction: 'jump-subsidy-issues-page', pageSizeAction: 'subsidy-issues-page-size' })}`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">关闭</button>' });
  }

  function subsidyResolutionModal(ledger, recordId, search = '') {
    const record = ledger?.records?.find((item) => item.id === recordId); if (!record) throw new Error('未找到待处理记录');
    const suggested = model.farmlandSubsidyPersonCandidates(record, state.database.personnel); const needle = text(search).toLowerCase(); const candidates = needle ? state.database.personnel.filter((person) => [model.personName(person), model.personGroup(person), person.id_card || person.idCard].some((value) => text(value).toLowerCase().includes(needle))).map((person) => ({ person, personId: model.personId(person), reason: '手动搜索结果' })) : suggested;
    state.modal = { type: 'subsidy-resolution', ledgerId: ledger.id, recordId, search };
    const candidateOptions = candidates.map((candidate) => `<option value="${escapeHtml(candidate.personId)}">${escapeHtml(model.personName(candidate.person))} · ${escapeHtml(model.personGroup(candidate.person) || '未分组')} · ${escapeHtml(candidate.reason)}</option>`).join('');
    openModal(`处理补贴关联 · ${record.name}`, `<div class="cf-hint">补贴数据保持不变。请只在确认是同一位居民时选择关联对象；同名不代表同一人。</div><div class="cf-form-grid"><div class="cf-field full"><label>补贴记录</label><div class="cf-record-summary"><strong>${escapeHtml(record.name)}</strong> · ${escapeHtml(record.groupName || '未分组')} · 身份证号 ${escapeHtml(record.idCard || '未填写')} · ${escapeHtml(record.eligibleArea)} 亩 · ${money(record.amountCents)}</div></div><div class="cf-field full"><label>搜索居民档案</label><div class="cf-subsidy-search"><input id="cf-subsidy-association-query" value="${escapeHtml(search)}" placeholder="输入居民姓名、身份证号或组别"><button type="button" class="btn btn-outline" data-cf-action="search-subsidy-association">搜索居民</button></div></div><div class="cf-field full"><label>确认关联居民 *</label><select id="cf-subsidy-person-choice"><option value="">请选择居民档案</option>${candidateOptions}</select><small>${search ? `搜索到 ${candidates.length} 名居民` : (suggested.length ? '已按身份证号、同组同名和同名顺序推荐' : '没有推荐候选，请搜索全体居民')}</small></div><div class="cf-field full"><label>处理说明 *</label><input id="cf-subsidy-association-reason" value="${escapeHtml(record.associationNote || '')}" placeholder="例如：已核对身份证号后确认关联；或等待户主核实"></div><p id="cf-subsidy-association-error" class="cf-error" role="alert" style="display:none"></p></div>`, { footer: '<button class="btn btn-outline" data-cf-action="back-subsidy-issues">返回清单</button><button class="btn btn-outline" data-cf-action="defer-subsidy-association">暂不关联</button><button class="btn btn-primary" data-cf-action="confirm-subsidy-association">确认关联</button>' });
  }

  async function saveSubsidyAssociation(deferred = false) {
    const error = document.getElementById('cf-subsidy-association-error'); if (error) error.style.display = 'none';
    try {
      const ledger = findById('farmlandSubsidyLedgers', state.modal?.ledgerId); const record = ledger?.records?.find((item) => item.id === state.modal?.recordId); const reason = text(document.getElementById('cf-subsidy-association-reason')?.value); const personId = text(document.getElementById('cf-subsidy-person-choice')?.value);
      if (!reason) throw new Error('请填写处理说明'); if (!deferred && !personId) throw new Error('请选择确认关联的居民档案');
      const next = model.correctFarmlandSubsidyRecord(ledger, record.id, { ...record, personId: deferred ? '' : personId, associationStatus: deferred ? 'deferred' : 'matched', associationNote: reason, correctionReason: reason }, { personnel: state.database.personnel });
      state.database.farmlandSubsidyLedgers.splice(state.database.farmlandSubsidyLedgers.indexOf(ledger), 1, next); await saveDatabase(deferred ? '已标记为暂不关联，仍会保留在待处理清单中' : '居民档案关联已确认'); subsidyIssueListModal(next);
    } catch (reason) { if (error) { error.textContent = reason.message || '保存失败'; error.style.display = 'block'; } else throw reason; }
  }

  function pageSizeValue(value) { const size = Number(value); return [10, 20, 50].includes(size) ? size : 10; }

  function paginationPages(currentPage, totalPages) {
    const pages = new Set([1, totalPages]);
    for (let page = currentPage - 3; page <= currentPage + 3; page += 1) if (page >= 1 && page <= totalPages) pages.add(page);
    const ordered = [...pages].sort((left, right) => left - right); const result = [];
    ordered.forEach((page, index) => { if (index && page - ordered[index - 1] > 1) result.push(null); result.push(page); });
    return result;
  }

  function paginationHtml({ totalItems, currentPage, totalPages, pageSize, pageAction, jumpAction, pageSizeAction }) {
    if (!totalItems) return '<div class="cf-pager cf-pager-empty"><span>没有符合查询条件的数据。</span></div>';
    const first = (currentPage - 1) * pageSize + 1; const last = Math.min(currentPage * pageSize, totalItems);
    const navigation = paginationPages(currentPage, totalPages).map((page) => page === null ? '<span class="cf-page-ellipsis">…</span>' : `<button class="${page === currentPage ? 'active' : ''}" data-cf-action="${pageAction}" data-page="${page}"${page === currentPage ? ' aria-current="page"' : ''}>${page}</button>`).join('');
    return `<div class="cf-pager"><span>显示第 ${first}–${last} 条，共 ${totalItems} 条</span><div class="cf-pager-controls"><div class="cf-pager-pages"><button data-cf-action="${pageAction}" data-page="1"${currentPage === 1 ? ' disabled' : ''}>首页</button><button data-cf-action="${pageAction}" data-page="${currentPage - 1}"${currentPage === 1 ? ' disabled' : ''}>上一页</button>${navigation}<button data-cf-action="${pageAction}" data-page="${currentPage + 1}"${currentPage === totalPages ? ' disabled' : ''}>下一页</button><button data-cf-action="${pageAction}" data-page="${totalPages}"${currentPage === totalPages ? ' disabled' : ''}>末页</button></div><div class="cf-pager-tools"><label>跳至 <input id="${jumpAction}-input" type="number" min="1" max="${totalPages}" value="${currentPage}"> 页</label><button data-cf-action="${jumpAction}">确定</button><label>每页 <select data-cf-page-size-action="${pageSizeAction}"><option value="10"${selected(pageSize, 10)}>10 条</option><option value="20"${selected(pageSize, 20)}>20 条</option><option value="50"${selected(pageSize, 50)}>50 条</option></select></label></div></div></div>`;
  }

  function subsidyDetailsModal(ledger, sheet = 'payment', page = 1, query = '', pageSize = 10) {
    if (!ledger) throw new Error('未找到年度地力补贴台账');
    const data = subsidySheetData(ledger, sheet); const matchedRows = subsidyQueryRows(data.rows, query); const currentPageSize = pageSizeValue(pageSize); const totalPages = Math.max(1, Math.ceil(matchedRows.length / currentPageSize)); const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages); const first = (currentPage - 1) * currentPageSize; const rows = matchedRows.slice(first, first + currentPageSize);
    const tabs = [['payment', '主表'], ['attachment-1-1', '附件 1-1'], ['attachment-1-4', '附件 1-4'], ['attachment-2-1', '附件 2-1'], ['attachment-2-4', '附件 2-4']];
    state.modal = { type: 'subsidy-detail', ledgerId: ledger.id, sheet, page: currentPage, query: text(query), pageSize: currentPageSize };
    openModal(`${ledger.year} 年地力补贴 · 主表与附件`, `<div class="cf-hint">${escapeHtml(data.label)}。查看不会改动已导入的数据；导出 Excel 时使用同一套关联数据。</div><div class="cf-subsidy-search"><input id="cf-subsidy-query" value="${escapeHtml(query)}" placeholder="输入姓名、身份证号、银行卡号或组别"><button class="btn btn-primary" data-cf-action="search-subsidy-sheet">查询定位</button>${query ? '<button class="btn btn-outline" data-cf-action="clear-subsidy-sheet-search">清除</button>' : ''}</div><div class="cf-sheet-tabs">${tabs.map(([key, label]) => `<button class="${key === sheet ? 'active' : ''}" data-cf-action="view-subsidy-sheet" data-sheet="${key}">${label}</button>`).join('')}</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr>${data.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${data.headers.length}"><div class="cf-empty">没有符合查询条件的数据。</div></td></tr>`}</tbody></table></div>${paginationHtml({ totalItems: matchedRows.length, currentPage, totalPages, pageSize: currentPageSize, pageAction: 'view-subsidy-page', jumpAction: 'jump-subsidy-sheet-page', pageSizeAction: 'subsidy-sheet-page-size' })}`, { footer: `<button class="btn btn-outline" data-cf-action="close-modal">关闭</button><button class="btn btn-primary" data-cf-action="edit-subsidy" data-id="${ledger.id}">编辑主表</button>` });
  }

  function subsidyRecordListModal(ledger, page = 1, query = '', pageSize = 10) {
    if (!ledger) throw new Error('未找到年度地力补贴台账');
    const needle = text(query).toLowerCase(); const all = ledger.records || []; const matched = needle ? all.filter((record) => [record.name, record.idCard, record.bankCard, record.groupName].some((value) => text(value).toLowerCase().includes(needle))) : all; const currentPageSize = pageSizeValue(pageSize); const totalPages = Math.max(1, Math.ceil(matched.length / currentPageSize)); const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages); const rows = matched.slice((currentPage - 1) * currentPageSize, currentPage * currentPageSize);
    state.modal = { type: 'subsidy-editor-list', ledgerId: ledger.id, page: currentPage, query: text(query), pageSize: currentPageSize };
    openModal(`${ledger.year} 年地力补贴 · 编辑主表`, `<div class="cf-hint">请先查询定位人员，再点“编辑”更正单条数据。不会一次性加载全部编辑控件，数据多也保持流畅；保存更正时必须填写原因。</div><div class="cf-subsidy-search"><input id="cf-subsidy-editor-query" value="${escapeHtml(query)}" placeholder="输入姓名、身份证号、银行卡号或组别"><button class="btn btn-primary" data-cf-action="search-subsidy-editor">查询定位</button>${query ? '<button class="btn btn-outline" data-cf-action="clear-subsidy-editor-search">清除</button>' : ''}</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>序号</th><th>姓名</th><th>身份证号</th><th>村民组</th><th>一卡通号</th><th>应补面积</th><th>补贴金额</th><th>操作</th></tr></thead><tbody>${rows.length ? rows.map((record, index) => `<tr><td>${(currentPage - 1) * currentPageSize + index + 1}</td><td><strong>${escapeHtml(record.name)}</strong></td><td>${escapeHtml(record.idCard || '—')}</td><td>${escapeHtml(record.groupName || '—')}</td><td>${escapeHtml(record.bankCard || '—')}</td><td>${escapeHtml(record.eligibleArea)}</td><td>${money(record.amountCents)}</td><td><button data-cf-action="edit-subsidy-record" data-id="${escapeHtml(record.id)}">编辑</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="cf-empty">没有符合查询条件的数据。</div></td></tr>'}</tbody></table></div>${paginationHtml({ totalItems: matched.length, currentPage, totalPages, pageSize: currentPageSize, pageAction: 'subsidy-editor-page', jumpAction: 'jump-subsidy-editor-page', pageSizeAction: 'subsidy-editor-page-size' })}`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">关闭</button>' });
  }

  function subsidyRecordEditModal(ledger, recordId, query = '', page = 1, pageSize = 10) {
    const record = ledger?.records?.find((item) => item.id === recordId); if (!record) throw new Error('未找到需要编辑的补贴记录'); const people = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), record.personId)}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    state.modal = { type: 'subsidy-record-editor', ledgerId: ledger.id, recordId, query, page, pageSize };
    openModal(`更正补贴记录 · ${record.name}`, `<form id="cf-subsidy-record-form" class="cf-form-grid">${field('关联居民', `<select name="personId"><option value="">保持手工资料</option>${people}</select>`)}${field('姓名 *', `<input name="name" value="${escapeHtml(record.name)}">`)}${field('村民组', `<input name="groupName" value="${escapeHtml(record.groupName)}">`)}${field('类别', `<select name="category"><option value="household"${selected(record.category, 'household')}>普通农户</option><option value="village_cadre"${selected(record.category, 'village_cadre')}>村干部</option></select>`)}${field('确权面积（亩）', `<input name="ownershipArea" type="number" min="0" step="0.01" value="${escapeHtml(record.ownershipArea)}">`)}${field('排除面积（亩）', `<input name="excludedArea" type="number" min="0" step="0.01" value="${escapeHtml(record.excludedArea)}">`)}${field('应补面积（亩）', `<input name="eligibleArea" type="number" min="0" step="0.01" value="${escapeHtml(record.eligibleArea)}">`)}${field('补贴标准（元/亩）', `<input name="standard" type="number" min="0" step="0.01" value="${escapeHtml(yuanValue(record.standardCents))}">`)}${field('身份证号', `<input name="idCard" value="${escapeHtml(record.idCard)}">`)}${field('开户行', `<input name="bankName" value="${escapeHtml(record.bankName)}">`)}${field('一卡通号', `<input name="bankCard" value="${escapeHtml(record.bankCard)}">`)}${field('更正原因 *', '<input name="correctionReason" placeholder="例如：核实身份证号、面积或银行卡">', true)}<p id="cf-subsidy-record-error" class="cf-error" role="alert" style="display:none"></p></form>`, { footer: '<button class="btn btn-outline" data-cf-action="back-subsidy-editor">返回列表</button><button class="btn btn-primary" data-cf-action="save-subsidy-record">保存更正</button>' });
  }

  async function saveSubsidyRecordEdit() {
    const form = document.getElementById('cf-subsidy-record-form'); const error = document.getElementById('cf-subsidy-record-error'); if (error) error.style.display = 'none';
    try { const ledger = findById('farmlandSubsidyLedgers', state.modal.ledgerId); const values = Object.fromEntries(new FormData(form).entries()); const next = model.correctFarmlandSubsidyRecord(ledger, state.modal.recordId, values, { personnel: state.database.personnel }); state.database.farmlandSubsidyLedgers.splice(state.database.farmlandSubsidyLedgers.indexOf(ledger), 1, next); await saveDatabase('补贴记录已更正并保留原因'); subsidyRecordListModal(next, state.modal.page, state.modal.query, state.modal.pageSize); }
    catch (reason) { if (error) { error.textContent = reason.message || '保存失败'; error.style.display = 'block'; } else throw reason; }
  }

  function subsidyLedgerModal(ledger = null) {
    const current = ledger || { year: new Date().getFullYear(), villageName: state.database.settings?.villageName || '', streetName: '', records: [{}] }; const validation = ledger ? model.validateFarmlandSubsidyLedger(ledger) : null;
    state.modal = { type: 'subsidy-ledger', ledgerId: ledger?.id || '' };
    openModal(ledger ? `${ledger.year} 年地力补贴主表` : '新建年度地力补贴主表', `<form id="cf-subsidy-form" class="cf-form-grid">${field('补贴年度 *', `<input name="year" value="${escapeHtml(current.year)}">`)}${field('村（居） *', `<input name="villageName" value="${escapeHtml(current.villageName || '')}">`)}${field('街道名称', `<input name="streetName" value="${escapeHtml(current.streetName || '')}">`)}${ledger ? field('本次更正原因', '<input name="correctionReason" placeholder="修改已有数据时必填">') : ''}<div class="cf-field full">${validation && !validation.ok ? `<div class="cf-hint">待处理：${escapeHtml(validation.errors.slice(0, 5).join('；'))}${validation.errors.length > 5 ? '…' : ''}</div>` : ''}<label>年度补贴主表（附件由此表自动生成）</label><div class="cf-table-wrap"><table class="cf-table cf-edit-table"><thead><tr><th>关联居民</th><th>姓名</th><th>组别</th><th>类别</th><th>应补面积</th><th>标准</th><th>身份证号</th><th>开户行</th><th>一卡通号</th></tr></thead><tbody id="cf-subsidy-records">${current.records.map(subsidyRecordHtml).join('')}</tbody></table></div><button type="button" class="btn btn-outline" data-cf-action="add-subsidy-record">＋ 添加人员</button><p id="cf-subsidy-error" class="cf-error" role="alert" style="display:none"></p></div></form>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-subsidy-ledger">保存主表</button>' });
  }

  function addSubsidyRecord() { document.getElementById('cf-subsidy-records')?.insertAdjacentHTML('beforeend', subsidyRecordHtml({})); }

  function subsidyRowsFromForm(form) {
    return [...form.querySelectorAll('.cf-subsidy-record')].map((row) => ({ id: row.dataset.id, personId: itemValue(row, 'personId'), name: itemValue(row, 'name'), groupName: itemValue(row, 'groupName'), category: itemValue(row, 'category'), eligibleArea: itemValue(row, 'eligibleArea'), ownershipArea: itemValue(row, 'eligibleArea'), standard: itemValue(row, 'standard'), idCard: itemValue(row, 'idCard'), bankName: itemValue(row, 'bankName'), bankCard: itemValue(row, 'bankCard') })).filter((row) => row.personId || row.name);
  }

  async function saveSubsidyLedger() {
    const form = document.getElementById('cf-subsidy-form'); const error = document.getElementById('cf-subsidy-error'); if (error) error.style.display = 'none';
    try {
      const values = Object.fromEntries(new FormData(form).entries()); const existing = findById('farmlandSubsidyLedgers', state.modal.ledgerId); const rows = subsidyRowsFromForm(form);
      if (!existing) { const ledger = model.createFarmlandSubsidyLedger({ ...values, records: rows }, { personnel: state.database.personnel }); state.database.farmlandSubsidyLedgers.push(ledger); await saveDatabase('年度地力补贴主表已保存'); closeModal(); state.view = 'subsidies'; renderShell(); return; }
      let next = structuredClone(existing); next.year = text(values.year); next.villageName = text(values.villageName); next.streetName = text(values.streetName); const oldById = new Map(existing.records.map((record) => [record.id, record])); const nextRecords = [];
      for (const row of rows) {
        const old = oldById.get(row.id); if (!old) { nextRecords.push(model.normalizedSubsidyRecord(row, state.database.personnel)); continue; }
        const candidate = model.normalizedSubsidyRecord({ ...old, ...row }, state.database.personnel, { id: old.id }); candidate.createdAt = old.createdAt;
        const changed = ['personId', 'name', 'groupName', 'category', 'eligibleArea', 'standardCents', 'idCard', 'bankName', 'bankCard'].some((key) => String(candidate[key] ?? '') !== String(old[key] ?? ''));
        if (!changed) nextRecords.push(old); else { next.records = existing.records; next = model.correctFarmlandSubsidyRecord(next, old.id, { ...row, correctionReason: values.correctionReason }, { personnel: state.database.personnel }); nextRecords.push(next.records.find((record) => record.id === old.id)); }
      }
      next.records = nextRecords; next.updatedAt = new Date().toISOString(); state.database.farmlandSubsidyLedgers.splice(state.database.farmlandSubsidyLedgers.indexOf(existing), 1, next); await saveDatabase('补贴主表已保存并保留更正记录'); closeModal(); state.view = 'subsidies'; renderShell();
    } catch (reason) { if (error) { error.textContent = reason.message || '保存失败'; error.style.display = 'block'; } else throw reason; }
  }

  async function importSubsidyLedger() {
    const result = await api.selectAndReadFarmlandSubsidyExcel(); if (!result?.ok) return; const imported = result.data; const year = (text(imported.fileName).match(/20\d{2}/u) || [new Date().getFullYear()])[0];
    const ledger = model.createFarmlandSubsidyLedger({ year, villageName: imported.records[0]?.villageName || state.database.settings?.villageName || '', records: imported.records }, { personnel: state.database.personnel });
    const existing = state.database.farmlandSubsidyLedgers.find((item) => text(item.year) === text(ledger.year)); if (existing) throw new Error(`${ledger.year} 年补贴台账已存在，请打开后更正，不会覆盖已有数据`);
    state.database.farmlandSubsidyLedgers.push(ledger); await saveDatabase(`已导入 ${ledger.records.length} 条地力补贴主表记录`); state.view = 'subsidies'; renderShell();
  }

  async function exportSubsidyLedger(id) {
    const ledger = findById('farmlandSubsidyLedgers', id); const validation = model.validateFarmlandSubsidyLedger(ledger); if (!validation.ok) { notify(`请先处理 ${validation.errors.length} 项关联或资料异常后再导出`, 'error'); return subsidyIssueListModal(ledger); }
    const result = await api.exportFarmlandSubsidyWorkbook({ ledger }); if (!result?.ok) { if (!result?.canceled) throw new Error(result?.error || '导出失败'); return; }
    await saveDatabase('已导出地力补贴五张关联表'); notify(`已导出：${result.file.fileName}`);
  }

  function templatePreviewHtml(batch) {
    const headers = batch.templateKey === 'casual_labor' ? ['序号', '用工日期', '姓名', '用工事项', '工日', '单价', '金额', '银行账号', '备注'] : batch.templateKey === 'public_service' ? ['序号', '姓名', '负责区域', '账号', '金额', '备注'] : ['序号', '姓名', '职务', '元/月', '合计月份', '扣除款', '实发金额', '账号', '备注'];
    const rows = batch.items.map((item, index) => { const cells = batch.templateKey === 'casual_labor' ? [index + 1, item.workDate, item.name, item.workItem, item.quantity, yuanValue(item.unitPriceCents), yuanValue(item.amountCents), item.bankCard, item.remark] : batch.templateKey === 'public_service' ? [index + 1, item.name, item.responsibilityArea, item.bankCard, yuanValue(item.amountCents), item.remark] : [index + 1, item.name, item.role, yuanValue(item.unitPriceCents), item.quantity, yuanValue(item.deductionsCents), yuanValue(item.amountCents), item.bankCard, item.remark]; return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell || '')}</td>`).join('')}</tr>`; }).join('');
    const total = model.summarizeDisbursementBatch(batch).totalCents;
    return `<article class="cf-print-sheet ${batch.templateKey === 'contract_fee' ? 'a4' : 'a5'}"><h1>${escapeHtml(batch.title || templateLabel(batch.templateKey))}</h1><div class="cf-print-meta"><span>编制单位：${escapeHtml(batch.villageName || '')}</span><span>期间：${escapeHtml(batch.period || '')}</span><span>日期：${escapeHtml(batch.batchDate || '')}</span><span>单位：元</span></div><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows}<tr><td colspan="${headers.length - 3}">合计</td><td colspan="3">${money(total)}　共 ${batch.items.length} 人</td></tr></tbody></table><div class="cf-print-signers"><span>审批人：${escapeHtml(batch.signers?.approver || '')}</span><span>制表人：${escapeHtml(batch.signers?.maker || '')}</span>${batch.templateKey === 'casual_labor' ? `<span>经办人：${escapeHtml(batch.signers?.handler || '')}</span>` : ''}</div></article>`;
  }

  function templatePreviewModal(batch) { state.modal = { type: 'template-preview', batchId: batch.id }; openModal('打印预览', `<div id="cf-template-preview">${templatePreviewHtml(batch)}</div>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">关闭</button><button class="btn btn-primary" data-cf-action="print-template">打印</button>' }); }

  function printTemplate() { const source = document.getElementById('cf-template-preview')?.innerHTML; if (!source) return; const popup = root.open('', '_blank'); if (!popup) throw new Error('未能打开打印窗口，请允许本软件打开打印预览'); popup.document.write(`<html><head><title>发放表打印</title><style>body{margin:0;font-family:"Songti SC",serif;color:#000}.cf-print-sheet{box-sizing:border-box;margin:0 auto;padding:12mm}.cf-print-sheet.a5{width:148mm;min-height:210mm}.cf-print-sheet.a4{width:210mm;min-height:297mm}.cf-print-sheet h1{text-align:center;font-size:18pt;margin:0 0 8mm}.cf-print-meta,.cf-print-signers{display:flex;justify-content:space-between;gap:8px;margin:4mm 0;font-size:10pt}.cf-print-sheet table{border-collapse:collapse;width:100%;font-size:9pt}.cf-print-sheet th,.cf-print-sheet td{border:1px solid #000;padding:2.2mm 1.5mm;text-align:center;word-break:break-all}@page{size:A5 portrait;margin:0}@media print{.cf-print-sheet{margin:0}.cf-print-sheet.a4{page:landscape}}</style></head><body>${source}<script>window.onload=()=>window.print()<\/script></body></html>`); popup.document.close(); }

  function disbursementBatchModal(batch = null) {
    const categories = state.database.disbursementCategories.filter((item) => item.active !== false);
    const people = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}">${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    state.modal = { type: 'disbursement-batch', attachments: [...(batch?.attachments || [])] };
    const itemRow = (item = {}) => `<div class="cf-form-grid cf-disbursement-item"><select name="personId"><option value="">临时收款人（请填写姓名）</option>${state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), item.personId)}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('')}</select><input name="name" value="${escapeHtml(item.name || '')}" placeholder="临时收款人姓名"><input name="bankCard" value="${escapeHtml(item.bankCard || '')}" placeholder="银行卡号"><input name="amount" type="number" min="0" step="0.01" value="${item.amountCents !== undefined ? yuanValue(item.amountCents) : ''}" placeholder="金额（元）"></div>`;
    openModal(batch ? '查看发放批次' : '新建发放批次', `<form id="cf-disbursement-form" class="cf-form-grid" data-id="${escapeHtml(batch?.id || '')}">
      ${field('资金类别 *', `<select name="categoryId">${categories.map((item) => `<option value="${item.id}"${selected(item.id, batch?.categoryId)}>${escapeHtml(item.name)}</option>`).join('')}</select>`)}
      ${field('发放期间 *', `<input name="period" value="${escapeHtml(batch?.period || `${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月`)}" placeholder="例如：2026 年 9 月">`)}
      ${field('实际发放日期', `<input name="batchDate" type="date" value="${escapeHtml(batch?.batchDate || today())}">`)}
      ${field('关联合同（仅承包费可选）', `<select name="contractId"><option value="">不关联合同</option>${state.database.resourceContracts.map((item) => `<option value="${item.id}"${selected(item.id, batch?.contractId)}>${escapeHtml(item.name)}</option>`).join('')}</select>`)}
      ${field('备注', `<textarea name="notes">${escapeHtml(batch?.notes || '')}</textarea>`, true)}
      ${field('可选附件', '<div><button type="button" class="btn btn-outline" data-cf-action="add-attachments">选择附件</button><div id="cf-attachment-list" class="cf-row-actions" style="margin-top:8px">' + attachmentListHtml(state.modal.attachments) + '</div></div>', true)}
      ${batch ? '' : field('直接登记为已发放', '<label class="cf-check"><input type="checkbox" name="directPaid">临时、小额事项直接完成</label>', true)}
      ${batch ? '' : field('直接发放经办说明', '<input name="directPaymentReason" placeholder="直接登记已发放时必填">', true)}
      <div class="cf-field full"><label>收款明细 *</label><div class="cf-row-actions" style="margin-bottom:8px">${batch ? '' : '<button type="button" class="btn btn-outline" data-cf-action="add-disbursement-item">＋ 添加收款人</button><button type="button" class="btn btn-outline" data-cf-action="import-disbursement-excel">从 Excel 导入</button>'}</div><div id="cf-disbursement-items">${(batch?.items || [{}]).map(itemRow).join('')}</div><p class="cf-hint">优先选择居民档案；未选择居民时可填写临时收款人。Excel 导入后可继续手工修改。选择居民会自动使用其默认银行卡。</p><p id="cf-disbursement-error" class="cf-error" role="alert" style="display:none;margin:8px 0 0"></p></div>
    </form>`, { footer: batch ? '<button class="btn btn-outline" data-cf-action="close-modal">关闭</button>' : '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-disbursement">保存批次</button>' });
  }

  function appendDisbursementItem(item = {}) {
    const target = document.getElementById('cf-disbursement-items'); if (!target) return;
    const options = state.database.personnel.map((person) => `<option value="${escapeHtml(model.personId(person))}">${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person) || '未分组')}</option>`).join('');
    target.insertAdjacentHTML('beforeend', `<div class="cf-form-grid cf-disbursement-item"><select name="personId"><option value="">临时收款人（请填写姓名）</option>${options}</select><input name="name" value="${escapeHtml(item.name || '')}" placeholder="临时收款人姓名"><input name="bankCard" value="${escapeHtml(item.bankCard || '')}" placeholder="银行卡号"><input name="amount" type="number" min="0" step="0.01" value="${escapeHtml(item.amount || '')}" placeholder="金额（元）"></div>`);
  }

  async function importDisbursementExcel() {
    const result = await api.selectAndReadContractFeeExcel(); if (!result?.ok) return;
    const rows = result.data?.rows || []; if (!rows.length) throw new Error('表格中没有可导入的发放明细');
    document.getElementById('cf-disbursement-items').innerHTML = '';
    rows.forEach((row) => appendDisbursementItem({ name: row.name, bankCard: row.bankCard, amount: row.amount }));
    notify(`已导入 ${rows.length} 条明细，请核对后保存`);
  }

  async function saveDisbursementBatch() {
    const form = document.getElementById('cf-disbursement-form');
    const errorTarget = document.getElementById('cf-disbursement-error');
    const button = document.querySelector('[data-cf-action="save-disbursement"]');
    if (errorTarget) { errorTarget.textContent = ''; errorTarget.style.display = 'none'; }
    try {
      if (!form) throw new Error('发放批次表单未加载完成，请关闭后重新新建批次');
      const values = Object.fromEntries(new FormData(form).entries());
      const category = state.database.disbursementCategories.find((item) => item.id === values.categoryId);
      const items = [...form.querySelectorAll('.cf-disbursement-item')].map((row) => ({ personId: row.querySelector('[name="personId"]').value, name: row.querySelector('[name="name"]').value, bankCard: row.querySelector('[name="bankCard"]').value, amount: row.querySelector('[name="amount"]').value })).filter((item) => item.personId || item.name || item.amount);
      if (!items.length) throw new Error('请至少填写一名收款人和金额');
      button?.setAttribute('disabled', 'disabled'); if (button) button.textContent = '正在保存…';
      const batch = model.createDisbursementBatch({ ...values, categoryName: category?.name, items, attachments: state.modal?.attachments || [], directPaid: values.directPaid === 'on' }, { personnel: state.database.personnel });
      state.database.disbursementBatches.push(batch); await saveDatabase('发放批次已保存'); closeModal(); state.view = 'general-batches'; renderShell();
    } catch (error) {
      if (errorTarget) { errorTarget.textContent = error?.message || '保存批次失败'; errorTarget.style.display = 'block'; }
      else notify(error?.message || '保存批次失败', 'error');
      button?.removeAttribute('disabled'); if (button) button.textContent = '保存批次';
    }
  }

  async function reviewDisbursement(id) { const current = findById('disbursementBatches', id); const next = model.reviewDisbursementBatch(current); state.database.disbursementBatches.splice(state.database.disbursementBatches.indexOf(current), 1, next); await saveDatabase('批次已审核'); renderShell(); }
  async function payDisbursement(id) { const current = findById('disbursementBatches', id); const next = model.markDisbursementBatchPaid(current); state.database.disbursementBatches.splice(state.database.disbursementBatches.indexOf(current), 1, next); await saveDatabase('已登记为发放完成'); renderShell(); }

  async function saveReimburse() {
    const advance = findById('contractFeeAdvances', state.modal.advanceId);
    const updated = model.reimburseAdvance(advance, document.getElementById('cf-reimburse-date').value);
    state.database.contractFeeAdvances.splice(state.database.contractFeeAdvances.indexOf(advance), 1, updated);
    await saveDatabase('垫付款已登记归还'); closeModal(); renderShell();
  }

  async function handleAction(action, element) {
    if (action === 'close-modal') return closeModal();
    if (action === 'manage-categories') return categoryModal();
    if (action === 'save-category') return saveCategory();
    if (action === 'manage-profiles') { state.view = 'profiles'; return renderShell(); }
    if (action === 'manage-subsidies') { state.view = 'subsidies'; return renderShell(); }
    if (action === 'new-profile') return profileModal();
    if (action === 'edit-profile') return profileModal(profileFor(element.dataset.id));
    if (action === 'save-profile') return saveProfile();
    if (action === 'import-profiles') return importProfiles();
    if (action === 'new-disbursement-batch') return templateChooserModal();
    if (action === 'new-disbursement-generic') return disbursementBatchModal();
    if (action === 'new-template-batch') return templateBatchModal(element.dataset.template);
    if (action === 'add-template-item') return addTemplateItem();
    if (action === 'save-template-batch') return saveTemplateBatch();
    if (action === 'preview-template') return templatePreviewModal(findById('disbursementBatches', element.dataset.id));
    if (action === 'print-template') return printTemplate();
    if (action === 'new-subsidy') return subsidyLedgerModal();
    if (action === 'import-subsidy') return importSubsidyLedger();
    if (action === 'view-subsidy') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', element.dataset.id));
    if (action === 'resolve-subsidy-issues') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', element.dataset.id));
    if (action === 'search-subsidy-issues') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, document.getElementById('cf-subsidy-issue-query')?.value, state.modal?.pageSize);
    if (action === 'clear-subsidy-issues-search') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, '', state.modal?.pageSize);
    if (action === 'subsidy-issues-page') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), element.dataset.page, state.modal?.query, state.modal?.pageSize);
    if (action === 'jump-subsidy-issues-page') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), document.getElementById('jump-subsidy-issues-page-input')?.value, state.modal?.query, state.modal?.pageSize);
    if (action === 'subsidy-issues-page-size') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, state.modal?.query, element.value);
    if (action === 'resolve-subsidy-record') return subsidyResolutionModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), element.dataset.id);
    if (action === 'search-subsidy-association') return subsidyResolutionModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.recordId, document.getElementById('cf-subsidy-association-query')?.value);
    if (action === 'back-subsidy-issues') return subsidyIssueListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId));
    if (action === 'confirm-subsidy-association') return saveSubsidyAssociation(false);
    if (action === 'defer-subsidy-association') return saveSubsidyAssociation(true);
    if (action === 'view-subsidy-sheet') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), element.dataset.sheet, 1, state.modal?.query, state.modal?.pageSize);
    if (action === 'view-subsidy-page') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.sheet, element.dataset.page, state.modal?.query, state.modal?.pageSize);
    if (action === 'jump-subsidy-sheet-page') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.sheet, document.getElementById('jump-subsidy-sheet-page-input')?.value, state.modal?.query, state.modal?.pageSize);
    if (action === 'subsidy-sheet-page-size') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.sheet, 1, state.modal?.query, element.value);
    if (action === 'search-subsidy-sheet') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.sheet, 1, document.getElementById('cf-subsidy-query')?.value, state.modal?.pageSize);
    if (action === 'clear-subsidy-sheet-search') return subsidyDetailsModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.sheet, 1, '', state.modal?.pageSize);
    if (action === 'edit-subsidy') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', element.dataset.id));
    if (action === 'search-subsidy-editor') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, document.getElementById('cf-subsidy-editor-query')?.value, state.modal?.pageSize);
    if (action === 'clear-subsidy-editor-search') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, '', state.modal?.pageSize);
    if (action === 'subsidy-editor-page') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), element.dataset.page, state.modal?.query, state.modal?.pageSize);
    if (action === 'jump-subsidy-editor-page') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), document.getElementById('jump-subsidy-editor-page-input')?.value, state.modal?.query, state.modal?.pageSize);
    if (action === 'subsidy-editor-page-size') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), 1, state.modal?.query, element.value);
    if (action === 'edit-subsidy-record') return subsidyRecordEditModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), element.dataset.id, state.modal?.query, state.modal?.page, state.modal?.pageSize);
    if (action === 'back-subsidy-editor') return subsidyRecordListModal(findById('farmlandSubsidyLedgers', state.modal?.ledgerId), state.modal?.page, state.modal?.query, state.modal?.pageSize);
    if (action === 'save-subsidy-record') return saveSubsidyRecordEdit();
    if (action === 'add-subsidy-record') return addSubsidyRecord();
    if (action === 'save-subsidy-ledger') return saveSubsidyLedger();
    if (action === 'export-subsidy') return exportSubsidyLedger(element.dataset.id);
    if (action === 'add-disbursement-item') return appendDisbursementItem();
    if (action === 'import-disbursement-excel') return importDisbursementExcel();
    if (action === 'save-disbursement') return saveDisbursementBatch();
    if (action === 'view-disbursement') { const batch = findById('disbursementBatches', element.dataset.id); return batch?.templateKey ? templateBatchModal(batch.templateKey, batch) : disbursementBatchModal(batch); }
    if (action === 'review-disbursement') return reviewDisbursement(element.dataset.id);
    if (action === 'pay-disbursement') return payDisbursement(element.dataset.id);
    if (action === 'new-contract') return contractModal();
    if (action === 'edit-contract') return contractModal(contractFor(element.dataset.id));
    if (action === 'renew') return contractModal({}, contractFor(element.dataset.id));
    if (action === 'add-attachments') return addAttachments();
    if (action === 'open-attachment') return api.openPath(element.dataset.path);
    if (action === 'save-contract') return saveContract();
    if (action === 'import-ledger') return importStart(element.dataset.id);
    if (action === 'choose-import-excel') return chooseImportExcel();
    if (action === 'save-import-ledger') return saveImportedLedger();
    if (action === 'view-ledger') return ledgerModal(findById('contractFeeLedgers', element.dataset.id));
    if (action === 'replace-person') return replacePersonModal(element.dataset.ledgerId, element.dataset.itemId);
    if (action === 'save-replacement') return saveReplacement();
    if (action === 'new-batch') {
      const ledger = findById('contractFeeLedgers', element.dataset.id);
      return batchModal(model.createBatch({ ledger, contract: contractFor(ledger.contractId), batchDate: today() }));
    }
    if (action === 'edit-batch') {
      const batch = findById('contractFeeBatches', element.dataset.id);
      return batchModal(batch, batch.status !== 'draft');
    }
    if (action === 'save-batch-draft') return persistBatch(false);
    if (action === 'review-batch') return persistBatch(true);
    if (action === 'export-batch') return exportBatch(element.dataset.id);
    if (action === 'payment-results') return paymentResultsModal(findById('contractFeeBatches', element.dataset.id));
    if (action === 'save-payment-results') return savePaymentResults();
    if (action === 'receipt') return receiptModal(contractFor(element.dataset.id));
    if (action === 'save-receipt') return saveReceipt();
    if (action === 'advance') return advanceModal(findById('contractFeeBatches', element.dataset.id));
    if (action === 'save-advance') return saveAdvance();
    if (action === 'reimburse') return reimburseModal(findById('contractFeeAdvances', element.dataset.id));
    if (action === 'save-reimburse') return saveReimburse();
    return undefined;
  }

  async function onClick(event) {
    const viewButton = event.target.closest('[data-cf-view]');
    if (viewButton) { state.view = viewButton.dataset.cfView; renderShell(); return; }
    const workspaceButton = event.target.closest('[data-target="tab-contract-fees"]');
    if (workspaceButton) {
      try { await loadDatabase(); renderShell(); } catch (error) { notify(error.message, 'error'); }
      return;
    }
    const actionElement = event.target.closest('[data-cf-action]');
    if (!actionElement) return;
    event.preventDefault();
    try { await handleAction(actionElement.dataset.cfAction, actionElement); } catch (error) { notify(error.message || '操作失败', 'error'); }
  }

  async function init() {
    if (!model) return;
    injectWorkspace();
    document.addEventListener('click', onClick);
  }

  root.ContractFeeWorkspace = Object.freeze({ init, loadDatabase, render: renderShell });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
