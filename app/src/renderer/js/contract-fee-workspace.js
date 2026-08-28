'use strict';

(function contractFeeWorkspace(root) {
  const model = root.ContractFeeModel;
  const api = root.api;
  const featureKeys = ['resourceContracts', 'contractFeeLedgers', 'contractFeeBatches', 'contractFeeReceipts', 'contractFeeAdvances'];
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
    const contracts = state.database.resourceContracts;
    const batches = state.database.contractFeeBatches;
    const paid = batches.reduce((sum, batch) => sum + batch.items.filter((item) => item.paymentStatus === 'paid').reduce((subtotal, item) => subtotal + Number(item.finalAmountCents || 0), 0), 0);
    const pending = batches.reduce((sum, batch) => sum + batch.items.filter((item) => item.paymentStatus !== 'paid').reduce((subtotal, item) => subtotal + Number(item.finalAmountCents || 0), 0), 0);
    const issues = batches.reduce((sum, batch) => sum + batch.items.filter((item) => ['failed', 'unpaid'].includes(item.paymentStatus)).length, 0)
      + state.database.contractFeeAdvances.filter((item) => item.status === 'pending_reimbursement').length;
    return { contracts: contracts.length, paid, pending, issues };
  }

  function renderShell() {
    const section = document.querySelector('#tab-contract-fees .cf-shell');
    if (!section || !state.database) return;
    const summary = stats();
    section.innerHTML = `
      <div class="cf-header"><div><h2>资金发放中心</h2><p>首期为承包费发放；合同、居民长期台账、年度批次和银行结果分别留痕。</p></div>
        <div class="cf-actions"><button class="btn btn-outline" data-cf-action="import-ledger">首次导入发放台账</button><button class="btn btn-primary" data-cf-action="new-contract">＋ 新建合同</button></div></div>
      <div class="cf-stats"><div class="cf-stat"><span>有效合同</span><strong>${summary.contracts}</strong></div><div class="cf-stat"><span>累计已发</span><strong>${money(summary.paid)}</strong></div><div class="cf-stat"><span>待发金额</span><strong>${money(summary.pending)}</strong></div><div class="cf-stat"><span>待处理事项</span><strong>${summary.issues}</strong></div></div>
      <div class="cf-nav">${[['overview', '发放总览'], ['ledger', '合同发放台账'], ['batches', '发放记录'], ['issues', '待处理事项']].map(([key, label]) => `<button class="${state.view === key ? 'active' : ''}" data-cf-view="${key}">${label}</button>`).join('')}</div>
      <div id="cf-view"></div>`;
    renderView();
  }

  function renderView() {
    const target = document.getElementById('cf-view');
    if (!target) return;
    if (state.view === 'ledger') target.innerHTML = renderLedgers();
    else if (state.view === 'batches') target.innerHTML = renderBatches();
    else if (state.view === 'issues') target.innerHTML = renderIssues();
    else target.innerHTML = renderOverview();
  }

  function renderOverview() {
    const rows = state.database.resourceContracts.map((contract) => {
      const ledger = ledgerForContract(contract.id);
      const receipt = state.database.contractFeeReceipts.find((item) => item.contractId === contract.id);
      const batches = state.database.contractFeeBatches.filter((item) => item.contractId === contract.id);
      return `<tr><td><strong>${escapeHtml(contract.name)}</strong><br><span class="text-secondary">${escapeHtml(contract.contractNumber || '未编号')}</span></td><td>${escapeHtml(contract.startDate)} 至 ${escapeHtml(contract.endDate)}</td><td>${money(contract.amountCents)}</td><td>${receipt ? `<span class="cf-badge ok">已到账</span><br>${escapeHtml(receipt.receivedDate)}` : '<span class="cf-badge warn">未到账</span>'}</td><td>${ledger ? `${ledger.items.length} 人` : '<span class="cf-badge warn">未建台账</span>'}</td><td>${batches.length}</td><td><div class="cf-row-actions"><button data-cf-action="edit-contract" data-id="${contract.id}">合同详情</button><button data-cf-action="receipt" data-id="${contract.id}">${receipt ? '查看到账' : '登记到账'}</button><button data-cf-action="renew" data-id="${contract.id}">续签新合同</button></div></td></tr>`;
    }).join('');
    return `<div class="cf-panel"><div class="cf-panel-head"><h3>合同与资金概况</h3><span class="text-secondary">承包人缴费与居民发放相互独立</span></div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>合同</th><th>完整期限</th><th>合同金额</th><th>承包人到账</th><th>长期台账</th><th>发放批次</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="cf-empty">还没有合同，请先新建合同。</div></td></tr>'}</tbody></table></div></div>`;
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
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'cf-modal-overlay';
    overlay.id = 'cf-modal-overlay';
    overlay.innerHTML = `<div class="cf-modal${small ? ' small' : ''}"><div class="cf-modal-head"><h3>${escapeHtml(title)}</h3><button class="cf-close" data-cf-action="close-modal">×</button></div><div class="cf-modal-body">${body}</div>${footer ? `<div class="cf-modal-foot">${footer}</div>` : ''}</div>`;
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
      <div class="cf-hint cf-field full">Excel 仅用于第一次建立台账。系统会在所选组别内按姓名匹配居民；之后每年直接从台账生成发放批次。</div>
    </div>`, { small: true, footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="choose-import-excel">选择并识别 Excel</button>' });
  }

  async function chooseImportExcel() {
    const contractId = document.getElementById('cf-import-contract').value;
    const groups = [...document.querySelectorAll('[name="cf-import-group"]:checked')].map((input) => input.value);
    if (!groups.length) throw new Error('请至少选择一个组别');
    const result = await api.selectAndReadContractFeeExcel();
    if (!result?.ok) return;
    const matches = model.matchImportedRows({ rows: result.data.rows, personnel: state.database.personnel, selectedGroups: groups });
    state.importDraft = { contractId, groups, source: result.data, matches };
    renderImportPreview();
  }

  function renderImportPreview() {
    const draft = state.importDraft;
    const eligible = state.database.personnel.filter((person) => draft.groups.includes(model.personGroup(person)));
    const rows = draft.matches.map((match) => {
      const options = eligible.map((person) => `<option value="${escapeHtml(model.personId(person))}"${selected(model.personId(person), model.personId(match.person))}>${escapeHtml(model.personName(person))} · ${escapeHtml(model.personGroup(person))}</option>`).join('');
      const status = match.matchStatus === 'matched' ? statusBadge('completed') : `<span class="cf-badge ${match.matchStatus === 'missing' ? 'danger' : 'warn'}">${match.matchStatus === 'missing' ? '未匹配' : '姓名重复'}</span>`;
      const cardConfirmation = match.bankCard ? `<label class="cf-check"><input type="checkbox" data-cf-bank-confirm="${match.id}"${checked(!match.bankCardConflict)}>确认使用表格卡号</label>${match.bankCardConflict ? `<br><small class="cf-error">现有：${escapeHtml(match.existingBankCard)}</small>` : ''}` : '—';
      return `<tr class="${match.matchStatus === 'missing' ? 'cf-danger-row' : match.matchStatus === 'ambiguous' || match.bankCardConflict ? 'cf-warning-row' : ''}"><td>${match.sourceRowNumber || ''}</td><td>${escapeHtml(match.name)}</td><td>${status}</td><td><select class="cf-inline-select" data-cf-resolution="${match.id}"><option value="">请选择居民</option>${options}</select></td><td>${escapeHtml(match.population || match.acreage || '—')}</td><td>${escapeHtml(match.unitPrice || '—')}</td><td>${escapeHtml(match.amount || '—')}</td><td>${escapeHtml(match.bankCard || '—')}</td><td>${cardConfirmation}</td></tr>`;
    }).join('');
    state.modal = { type: 'import-preview' };
    openModal('核对 Excel 识别与居民匹配', `<div class="cf-hint">文件：${escapeHtml(draft.source.fileName)}；工作表：${escapeHtml(draft.source.sheetName)}。未匹配或重名必须手动指定居民；卡号冲突必须明确确认。</div><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>行</th><th>表内姓名</th><th>匹配</th><th>居民档案</th><th>人口/亩数</th><th>单价</th><th>金额</th><th>卡号</th><th>冲突处理</th></tr></thead><tbody>${rows}</tbody></table></div>`, { footer: '<button class="btn btn-outline" data-cf-action="close-modal">取消</button><button class="btn btn-primary" data-cf-action="save-import-ledger">确认建立长期台账</button>' });
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
    const ledger = model.createLedger({ contractId: state.importDraft.contractId, matches, source: state.importDraft.source });
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

  async function saveReimburse() {
    const advance = findById('contractFeeAdvances', state.modal.advanceId);
    const updated = model.reimburseAdvance(advance, document.getElementById('cf-reimburse-date').value);
    state.database.contractFeeAdvances.splice(state.database.contractFeeAdvances.indexOf(advance), 1, updated);
    await saveDatabase('垫付款已登记归还'); closeModal(); renderShell();
  }

  async function handleAction(action, element) {
    if (action === 'close-modal') return closeModal();
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
