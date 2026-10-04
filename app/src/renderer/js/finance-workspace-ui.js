(function () {
  'use strict';
  const api = window.api;
  const reviewModel = window.CommunityFinanceImportReview;
  const chartGroups = window.CommunityFinanceChartGroups;
  const defaultPeriod = window.CommunityFinanceDefaultPeriod;
  const income = [...reviewModel.categories.income], expense = [...reviewModel.categories.expense];
  const categories = { income, expense };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = cents => (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString('sv-SE');
  const dateShift = (year, month, day) => new Date(year, month, day).toLocaleDateString('sv-SE');
  const state = { host: null, mode: 'ledger', records: [], report: null, allReport: null, periodMode: 'recent', latestDate: '', loadError: '', startDate: '', endDate: '', search: '', type: '',
    chartMode: 'auto', chartSelection: null, chartMonth: '', chartCategory: '', categoryType: '', refinement: null, refinementError: '', refinementBusy: false, canRefine: false, accountBalance: null, balanceError: '', balanceCutoff: '', canSetBalance: false, openingForm: null, openingError: '', ledgerPage: 0, pageSize: 20, chartType: 'expense', selectedIds: new Set(), form: null, formError: '', workbook: null, sheets: [], selectedSheets: new Set(), rows: [], selectedRows: new Set(),
    totalAcknowledgements: {}, importIntegrity: null, importPending: 0, importUncertain: 0, importError: '', importBusy: false, importStatus: '', importPage: 0, detailsOpen: false, editingKey: '', importBatchId: '', narrative: '', deepNarrative: '', narrativeRevision: '', deepRevision: '', narrativeError: '', narrativeBusy: false, narrativeBusyMode: '', busy: false, message: '' };
  let messageTimer, composing = false, pendingRender = false;
  let charts = [], resizeObserver, loadSequence = 0, narrativeGeneration = 0;
  state.datesDirty = false; state.balanceReview = null; state.reviewPage = 0; state.reviewReturn = false; state.orderRows = [];
  function clearNarratives() { narrativeGeneration++; state.narrative = ''; state.deepNarrative = ''; state.narrativeRevision = ''; state.deepRevision = ''; state.narrativeError = ''; state.narrativeBusy = false; state.narrativeBusyMode = ''; }
  function clearNarrativeDisplay() { clearNarratives(); const panel = state.host?.querySelector?.('[data-narrative-panel]'); if (panel) { for (const node of panel.querySelectorAll('[data-narrative-content]')) node.innerHTML = ''; } }
  function notify(message, type = 'success') {
    clearTimeout(messageTimer); state.message = message; state.messageType = type; render();
    messageTimer = setTimeout(() => { state.message = ''; render(); }, 6000);
  }
  async function request(method, path, body) {
    const response = await api.businessRequest({ method, path: `/api/v3${path}`, body });
    if (!response?.ok) throw new Error(response?.error?.message || '操作失败');
    return response.data;
  }
  function setPreset(preset) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (preset === 'last') { state.startDate = dateShift(y, m - 1, 1); state.endDate = dateShift(y, m, 0); }
    else if (preset === 'year') { state.startDate = dateShift(y, 0, 1); state.endDate = dateShift(y, 11, 31); }
    else { state.startDate = dateShift(y, m, 1); state.endDate = dateShift(y, m + 1, 0); }
  }
  function resetDateFilters() {
    if (state.chartMonth || state.chartCategory) state.type = '';
    state.chartMonth = ''; state.chartCategory = ''; state.chartSelection = null; state.categoryType = '';
    state.ledgerPage = 0; state.selectedIds.clear();
  }
  async function load() {
    const sequence = ++loadSequence;
    const previousPeriod = `${state.report?.startDate}/${state.report?.endDate}`;
    state.busy = true; state.loadError = ''; render();
    try {
      const [ledger, catalog, balanceReview] = await Promise.all([
        request('GET', '/finance-records?limit=100000'), request('GET', '/finance-categories'), request('GET', '/finance-balance-review'),
      ]);
      if (sequence !== loadSequence) return;
      state.records = ledger.items || []; state.balanceReview = balanceReview;
      const recent = defaultPeriod.latestMonth(state.records, today());
      state.latestDate = recent?.latestDate || '';
      if (state.periodMode === 'recent') {
        if (recent) { state.startDate = recent.startDate; state.endDate = recent.endDate; }
        else { setPreset('month'); state.endDate = today(); }
        state.balanceCutoff = today();
      }
      if (catalog?.categories) { categories.income = catalog.categories.income; categories.expense = catalog.categories.expense; }
      const [report, balance] = await Promise.all([
        request('GET', `/finance-analysis?startDate=${state.startDate}&endDate=${state.endDate}`),
        request('GET', `/finance-account-balance?asOfDate=${state.balanceCutoff || today()}`).then(data => ({data}), error => ({error})),
      ]);
      if (sequence !== loadSequence) return;
      state.report = report; state.datesDirty = false;
      state.accountBalance = balance.data || null; state.balanceError = balance.error?.message || '';
      if (previousPeriod !== `${report.startDate}/${report.endDate}`) { clearNarratives(); resetDateFilters(); }
      state.narrativeError = ''; state.ledgerPage = 0; state.selectedIds.clear();
      if (window.dispatchEvent && typeof Event === 'function') window.dispatchEvent(new Event('community-finance-changed'));
    } catch (error) { if (sequence === loadSequence) state.loadError = error.message; }
    finally { if (sequence === loadSequence) { state.busy = false; render(); } }
  }
  const visible = () => (state.report?.records || []).filter(row => {
    const type = row.recordType || row.type;
    const word = `${row.summary || ''} ${row.category || ''} ${row.voucherNo || ''}`.toLowerCase();
    return (!state.chartMonth || String(row.recordDate || row.date).startsWith(state.chartMonth)) && (!state.chartCategory || (state.chartSelection?.grouped ? chartGroups.groupFor(type, row.category, row.summary) === state.chartCategory : state.chartSelection?.categories?.includes(row.category) || row.category === state.chartCategory)) && (!state.type || state.type === type) && (!state.search || word.includes(state.search.toLowerCase()));
  });
  const options = (type, selected) => (categories[type] || []).map(value => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(value)}</option>`).join('');
  const toolbar = () => `<div class="fin-head"><div><h1>财务收支</h1><p>按日期查看收支、核对台账和导入 Excel 表格</p></div><div class="fin-head-actions"><button data-action="reload">刷新</button><button data-action="export">导出 Excel</button><button class="primary" data-action="import">导入 Excel</button><button class="primary" data-action="add">新增收支</button></div></div>`;
  function pageRows() {
    const rows = visible(), pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.ledgerPage = Math.max(0, Math.min(state.ledgerPage, pages - 1));
    return { rows, pages, items: rows.slice(state.ledgerPage * state.pageSize, (state.ledgerPage + 1) * state.pageSize) };
  }
  function pageNumbers(pages) {
    const current = state.ledgerPage + 1;
    const numbers = pages <= 7 ? Array.from({ length: pages }, (_, i) => i + 1) : [...new Set([1, pages, ...Array.from({ length: 5 }, (_, i) => current - 2 + i).filter(value => value >= 1 && value <= pages)])].sort((a, b) => a - b);
    return numbers.map((value, index) => `${index && value - numbers[index - 1] > 1 ? '<span class="fin-page-gap">…</span>' : ''}<button data-ledger-page="${value}" ${value === current ? 'class="active" aria-current="page"' : ''}>${value}</button>`).join('');
  }
  function ledgerResults() {
    const { rows, pages, items } = pageRows();
    return `<div class="fin-table-wrap"><table><thead><tr><th><input aria-label="选择本页记录" type="checkbox" data-action="select-all-records" ${items.length && items.every(row => state.selectedIds.has(String(row.id))) ? 'checked' : ''}></th><th>日期</th><th>类型</th><th>科目</th><th>摘要</th><th>金额（元）</th><th>余额（元）</th><th>来源</th><th>操作</th></tr></thead><tbody>${items.map(row => `<tr data-ledger-row="${esc(row.id)}"><td><input aria-label="选择记录" type="checkbox" data-record-id="${esc(row.id)}" ${state.selectedIds.has(String(row.id)) ? 'checked' : ''}></td><td>${esc(row.recordDate || row.date)}</td><td><span class="fin-tag ${esc(row.recordType || row.type)}">${(row.recordType || row.type) === 'income' ? '收入' : '支出'}</span></td><td>${esc(row.category)}</td><td class="fin-summary-cell">${esc(row.summary)}</td><td class="fin-amount">${money(row.amountCents ?? Math.round(Number(row.amount || 0) * 100))}</td><td class="fin-balance-cell">${balanceCell(row)}</td><td>${row.importBatchId ? 'Excel' : '手工'}</td><td><button data-edit-id="${esc(row.id)}">编辑</button><button data-delete-id="${esc(row.id)}">删除</button></td></tr>`).join('') || `<tr><td colspan="9" class="fin-empty">${state.search || state.type ? '没有符合搜索条件的记录' : '当前日期范围暂无记录'}</td></tr>`}</tbody></table></div>
      <div class="fin-ledger-pagination"><span>共 ${rows.length} 笔${rows.length ? ` · 显示 ${state.ledgerPage * state.pageSize + 1}–${state.ledgerPage * state.pageSize + items.length} 笔` : ''}</span><label>每页 <select data-field="pageSize" aria-label="每页显示条数">${[20, 50, 100].map(size => `<option value="${size}" ${state.pageSize === size ? 'selected' : ''}>${size} 条</option>`).join('')}</select></label><div class="fin-pages"><button data-action="first-ledger-page" ${state.ledgerPage === 0 ? 'disabled' : ''}>首页</button><button data-action="previous-ledger-page" ${state.ledgerPage === 0 ? 'disabled' : ''}>上一页</button>${pageNumbers(pages)}<button data-action="next-ledger-page" ${state.ledgerPage >= pages - 1 ? 'disabled' : ''}>下一页</button><button data-action="last-ledger-page" ${state.ledgerPage >= pages - 1 ? 'disabled' : ''}>尾页</button></div><div class="fin-page-jump"><label>跳至 <input type="number" min="1" max="${pages}" step="1" value="${state.ledgerPage + 1}" data-page-jump aria-label="跳转页码"> 页</label><button data-action="jump-ledger-page">跳转</button><span data-page-error role="status"></span></div></div>`;
  }
  const balanceLabels = { matched: '核对一致', mismatch: '余额不一致 · 待审核', 'order-review': '交易顺序待审核', 'invalid-source': '原表余额格式异常', 'no-source': '无原表余额', unavailable: '暂无法核对' };
  function balanceCell(row) {
    const amount = Number.isSafeInteger(row.calculatedBalanceCents) ? money(row.calculatedBalanceCents) : '—';
    return `<strong>${amount}</strong><small class="${['mismatch','order-review','invalid-source'].includes(row.balanceStatus) ? 'fin-warn' : 'fin-hint'}" title="${esc(row.balanceReason || '')}">${balanceLabels[row.balanceStatus] || '无原表余额'}</small>`;
  }
  function balanceReviewBanner() {
    const review = state.balanceReview || {}, candidate = review.openingCandidate;
    return `<div class="fin-balance-review-banner"><span>${review.pendingCount ? `完整台账中 ${review.pendingCount} 笔余额待审核。请先核对最早差异，后续差异可能由前面的记录引起。` : '余额依据完整历史台账逐笔计算。'}${review.unavailableCount ? ` ${review.unavailableCount} 笔暂无法核对。` : ''}</span><button data-action="balance-review">查看余额核对</button>${candidate && state.canSetBalance ? '<button data-action="candidate-opening">确认候选期初余额</button>' : ''}</div>`;
  }
  function reviewRows() { return (state.balanceReview?.items || []).filter(row => ['mismatch','order-review','invalid-source'].includes(row.balanceStatus) || row.balanceStatus === 'unavailable' && Number.isSafeInteger(row.sourceBalanceCents)).sort((a,b) => String(a.recordDate || a.date).localeCompare(String(b.recordDate || b.date)) || (a.dayPosition || 0) - (b.dayPosition || 0)); }
  function balanceReviewView() {
    const rows = reviewRows(), pages = Math.max(1, Math.ceil(rows.length / 20)); state.reviewPage = Math.min(state.reviewPage, pages - 1);
    return `<div class="fin-subhead"><button data-action="cancel-balance-review">← 返回台账</button><h1>余额核对与人工审核</h1></div><section class="fin-panel">${balanceReviewBanner()}<p class="fin-hint">按日期从早到晚审核。不自动修改金额或原表余额；调整后会重新计算后续余额。</p><div class="fin-table-wrap"><table><thead><tr><th>日期 / 原表位置</th><th>摘要</th><th>计算余额</th><th>原表余额</th><th>差额（计算 − 原表）</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.slice(state.reviewPage*20,(state.reviewPage+1)*20).map(row => `<tr><td>${esc(row.recordDate || row.date)}<small>${esc(row.sourceFileName || '手工录入')} ${esc(row.sourceSheetName || '')} ${row.sourceRowNumber ? `第 ${row.sourceRowNumber} 行` : ''}</small></td><td class="fin-summary-cell">${esc(row.summary)}</td><td>${Number.isSafeInteger(row.calculatedBalanceCents) ? money(row.calculatedBalanceCents) : '—'}</td><td>${Number.isSafeInteger(row.sourceBalanceCents) ? money(row.sourceBalanceCents) : '—'}</td><td>${Number.isSafeInteger(row.balanceDifferenceCents) ? money(row.balanceDifferenceCents) : '—'}</td><td>${esc(balanceLabels[row.balanceStatus])}<small>${esc(row.balanceReason || '')}</small></td><td><button data-locate-id="${esc(row.id)}">定位数据</button>${state.canRefine ? `<button data-review-edit="${esc(row.id)}">修改数据</button>${row.dayCount > 1 ? `<button data-order-date="${esc(row.recordDate || row.date)}">调整同日顺序</button>` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="fin-empty">暂无需要人工审核的余额差异。没有原表余额的记录仅展示计算余额。</td></tr>'}</tbody></table></div><div class="fin-pages"><button data-action="previous-review-page" ${!state.reviewPage ? 'disabled' : ''}>上一页</button><span>${state.reviewPage+1} / ${pages} 页 · ${rows.length} 笔</span><button data-action="next-review-page" ${state.reviewPage>=pages-1 ? 'disabled' : ''}>下一页</button></div></section>`;
  }
  function orderView() {
    return `<div class="fin-subhead"><button data-action="cancel-order">← 返回余额审核</button><h1>调整 ${esc(state.orderDate)} 的交易顺序</h1></div><section class="fin-panel"><p class="fin-hint">从上到下为当天实际发生顺序。先发生的交易放在前面，保存后逐笔重新计算。</p><div class="fin-table-wrap"><table><thead><tr><th>顺序</th><th>摘要</th><th>金额</th><th>来源</th><th>调整</th></tr></thead><tbody>${state.orderRows.map((row,i) => `<tr><td>${i+1}</td><td>${esc(row.summary)}</td><td>${(row.recordType || row.type)==='income'?'收入':'支出'} ${money(row.amountCents)}</td><td>${esc(row.sourceSheetName || '手工')} ${row.sourceRowNumber ? `第 ${row.sourceRowNumber} 行` : ''}</td><td><button data-order-move="${i}" data-direction="-1" ${i===0?'disabled':''}>上移</button><button data-order-move="${i}" data-direction="1" ${i===state.orderRows.length-1?'disabled':''}>下移</button></td></tr>`).join('')}</tbody></table></div>${state.orderError ? `<p role="alert" class="fin-error">${esc(state.orderError)}</p>` : ''}</section><div class="fin-sticky"><button data-action="cancel-order" ${state.busy?'disabled':''}>取消</button><button class="primary" data-action="save-order" ${state.busy?'disabled':''}>确认交易顺序</button></div>`;
  }
  function refreshLedger() {
    const results = state.host.querySelector?.('[data-ledger-results]');
    if (!results) return render();
    results.innerHTML = ledgerResults();
    const chips = state.host.querySelector('[data-chart-filters]'); if (chips) chips.innerHTML = filterChips();
    const typeInput = state.host.querySelector('[data-field="type"]'); if (typeInput) typeInput.value = state.type;
    const clear = state.host.querySelector('[data-action="clear-search"]'); if (clear) clear.hidden = !state.search;
    const count = state.host.querySelector('[data-ledger-count]');
    if (count) count.textContent = `${visible().length} 笔`;
    const button = state.host.querySelector('[data-action="batch-delete"]');
    if (button) { button.disabled = !state.selectedIds.size; button.textContent = `删除所选 (${state.selectedIds.size})`; }
  }
  function filterChips() {
    if (!state.chartMonth && !state.chartCategory) return '<small class="fin-hint">点击图表可筛选下方台账</small>';
    return `<span>图表筛选：</span>${state.chartMonth ? `<strong>${esc(state.chartMonth)}</strong>` : ''}${state.chartCategory ? `<strong>${esc(state.chartCategory)}</strong>` : ''}<strong>${state.type === 'income' ? '收入' : '支出'}</strong><button data-action="clear-chart-filters">清除图表筛选</button>`;
  }
  function drillDown({ month, category, selection, type }) {
    if (state.type !== type && state.categoryType !== type) { state.chartCategory = ''; state.chartSelection = null; }
    state.type = type;
    if (month) state.chartMonth = month;
    if (category) { state.chartCategory = category; state.chartSelection = selection || { categories: [category] }; state.categoryType = type; }
    state.ledgerPage = 0; state.selectedIds.clear(); refreshLedger();
    state.host.querySelector?.('[data-ledger-panel]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function shareView(result) {
    if (!result.before || !result.after) return '';
    return `<div class="fin-refinement-grid">${['income','expense'].map(type => { const before=result.before[type], after=result.after[type]; return `<article><h2>${type==='income'?'其他收入':'其他支出'}</h2><strong>${Number(before.percent).toFixed(1)}% → ${Number(after.percent).toFixed(1)}%</strong><p>按金额占比 · ${before.otherCount} 笔 → ${after.otherCount} 笔</p><small>¥ ${money(before.otherCents)} → ¥ ${money(after.otherCents)}</small></article>`; }).join('')}</div>`;
  }
  function refinementView() {
    const result = state.refinement;
    return `<div class="fin-subhead"><button data-action="cancel-refinement" ${state.refinementBusy ? 'disabled' : ''}>← 返回台账</button><h1>智能整理收支科目</h1></div><section class="fin-panel"><p class="fin-hint">按当前日期范围的全部收入和支出整理，先识别摘要中的明确用途，再由 AI 分析剩余内容。包括已有科目和手工录入记录；金额、日期、摘要及收支方向保持原值。</p>${state.refinementBusy ? '<p role="status">正在识别摘要与整理科目，请稍候…</p>' : ''}${state.refinementError ? `<p class="fin-error" role="alert">${esc(state.refinementError)}</p>` : ''}${result ? `<p>${esc(result.startDate)} 至 ${esc(result.endDate)} · 共 ${result.total} 笔收支 · 调整 ${result.rows.length} 笔 · 无需调整 ${result.unchanged ?? result.total-result.rows.length} 笔</p>${result.warnings?.length ? `<p class="fin-error">${esc(result.warnings.join('；'))}。已保留规则识别结果，可以确认已有建议或重试。</p>` : ''}${shareView(result)}${['income','expense'].map(type=> { const groups=result.groups.filter(group=>(group.type || 'expense')===type); return groups.length ? `<h2>${type==='income'?'收入科目':'支出科目'}</h2><div class="fin-refinement-grid">${groups.map(group=>`<article><h2>${esc(group.category)}</h2><strong>${group.count} 笔 · ¥ ${money(group.amountCents)}</strong><ul>${group.examples.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></article>`).join('')}</div>` : ''; }).join('')}${result.unresolved.length ? `<details><summary>${result.unresolved.length} 笔未能明确用途，保留原科目</summary><ul>${result.unresolved.map(row=>`<li>${esc(row.summary)}：${esc(row.reason)}</li>`).join('')}</ul></details>` : ''}${!result.rows.length ? '<p class="fin-hint">没有可保存的科目调整。</p>' : ''}` : ''}</section><div class="fin-sticky fin-import-footer"><button data-action="cancel-refinement" ${state.refinementBusy ? 'disabled' : ''}>取消</button><div class="fin-inline"><button data-action="refine-categories" ${state.refinementBusy ? 'disabled' : ''}>重新分析</button><button class="primary" data-action="apply-refinement" ${state.refinementBusy || !result?.rows.length ? 'disabled' : ''}>确认保存 ${result?.rows.length || 0} 笔</button></div></div>`;
  }
  async function refineCategories() {
    if (!state.canRefine || state.refinementBusy || !state.report) return;
    state.mode = 'refine'; state.refinementBusy = true; state.refinementError = ''; render();
    try { state.refinement = await api.previewFinanceCategories({ startDate: state.report.startDate || state.startDate, endDate: state.report.endDate || state.endDate }); }
    catch (error) { state.refinementError = error.message; }
    finally { state.refinementBusy = false; render(); }
  }
  async function applyRefinement() {
    if (!state.canRefine || state.refinementBusy || !state.refinement?.rows.length) return;
    state.refinementBusy = true; state.refinementError = ''; render();
    try {
      const { startDate, endDate, rows } = state.refinement;
      const result = await request('PATCH', '/finance-reclassifications', { startDate, endDate, rows });
      state.refinement = null; state.mode = 'ledger'; await load(); notify(`已为 ${result.count} 笔收支保存具体科目`);
    } catch (error) { state.refinementError = error.message; }
    finally { state.refinementBusy = false; render(); }
  }
  function reportRevision() {
    return JSON.stringify({ start: state.report?.startDate, end: state.report?.endDate, records: state.report?.records, totals: state.report?.totals, balance: state.accountBalance });
  }
  function narrativePanel() { return `<section class="fin-panel fin-analysis" data-narrative-panel><div class="fin-panel-title"><div><h2>AI 财务简报</h2><span>依据当前日期范围的完整台账</span></div><div class="fin-analysis-actions"><button data-action="narrative" ${state.narrativeBusy || state.busy || state.datesDirty || !state.report?.recordCount ? 'disabled' : ''}>${state.narrativeBusyMode === 'brief' ? '生成简报中…' : state.narrative ? '重新生成简报' : '生成简报'}</button><button class="primary" data-action="deep-narrative" ${state.narrativeBusy || state.busy || state.datesDirty || !state.report?.recordCount ? 'disabled' : ''}>${state.narrativeBusyMode === 'deep' ? '深度分析中…' : state.deepNarrative ? '重新深度分析' : '深度分析'}</button></div></div>${state.narrativeError ? `<p class="fin-error" role="alert">${esc(state.narrativeError)}</p>` : ''}<div class="fin-narrative">${narrativeView()}</div>${state.deepNarrative ? `<div class="fin-deep-report"><h3>深度财务报告</h3>${narrativeView('deep')}</div>` : ''}</section>`; }
  function refreshNarrativePanel() { const panel = state.host?.querySelector?.('[data-narrative-panel]'); if (panel) panel.outerHTML = narrativePanel(); }
  function narrativeView(depth = 'brief') {
    const deep = depth === 'deep';
    const text = String((deep ? state.deepNarrative : state.narrative) || '').trim();
    if (!text) return deep ? '' : '<p class="fin-hint">生成简报快速查看要点；按需点击深度分析，进一步了解收支结构、大额记录和需关注的事项。</p>';
    const stale = (deep ? state.deepRevision : state.narrativeRevision) !== reportRevision() ? '<p class="fin-report-stale" role="status">日期范围或台账已变化，以下为此前报告，请重新生成。</p>' : '';
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {}
    if (parsed && typeof parsed.summary === 'string') {
      if (deep) return `${stale}<p class="fin-analysis-summary">${esc(parsed.summary)}</p><div class="fin-deep-sections">${(Array.isArray(parsed.sections) ? parsed.sections : []).filter(item => item && typeof item === 'object').slice(0, 8).map((item, index) => `<details ${index === 0 ? 'open' : ''}><summary>${esc(item.title || '深度分析')}</summary><p>${esc(item.text || '')}</p></details>`).join('')}</div>${Array.isArray(parsed.suggestions) && parsed.suggestions.length ? `<h3>建议</h3><ul class="fin-suggestions">${parsed.suggestions.slice(0, 5).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`;
      return `${stale}<p class="fin-analysis-summary">${esc(parsed.summary)}</p><div class="fin-insight-grid">${(Array.isArray(parsed.findings) ? parsed.findings : []).filter(item => item && typeof item === 'object').slice(0, 3).map(item => `<article><h3>${esc(item.title || '分析要点')}</h3><p>${esc(item.text || '')}</p></article>`).join('')}</div>${Array.isArray(parsed.suggestions) && parsed.suggestions.length ? `<ul class="fin-suggestions">${parsed.suggestions.slice(0, 2).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`;
    }
    const paragraphs = text.replace(/\*\*([^*]+)\*\*/g, '$1').split(/\n+/).filter(Boolean);
    return `${stale}<div class="fin-analysis-summary">${paragraphs.slice(0, 3).map(line => `<p>${esc(line.replace(/^#+\s*/, ''))}</p>`).join('')}</div>${paragraphs.length > 3 ? `<details class="fin-analysis-details"><summary>展开完整分析</summary>${paragraphs.slice(3).map(line => `<p>${esc(line.replace(/^#+\s*/, ''))}</p>`).join('')}</details>` : ''}`;
  }
  function ledgerView() {
    const totals = state.report?.totals || {};
    const datebar = `<section class="fin-datebar"><strong>日期范围</strong><button data-action="recent-data" ${state.busy ? 'disabled' : ''} class="${state.periodMode==='recent'?'active':''}">最近数据</button><button data-preset="month" ${state.busy ? 'disabled' : ''}>本月</button><button data-preset="last" ${state.busy ? 'disabled' : ''}>上月</button><button data-preset="year" ${state.busy ? 'disabled' : ''}>今年</button><label>从 <input type="date" data-field="startDate" value="${state.startDate}"></label><label>至 <input type="date" data-field="endDate" value="${state.endDate}"></label><button class="primary" data-action="apply-dates" ${state.busy ? 'disabled' : ''}>${state.busy ? '加载中…' : '查看分析'}</button></section>${state.periodMode === 'recent' && state.latestDate ? `<p class="fin-recent-hint">最新记录为 ${esc(state.latestDate)}，当前展示 ${Number(state.startDate.slice(0,4))} 年 ${Number(state.startDate.slice(5,7))} 月数据。</p>` : ''}`;
    if (state.busy && !state.report) return `${toolbar()}<section class="fin-panel" role="status">正在读取收支台账并定位最近数据…</section>`;
    if (state.loadError) return `${toolbar()}<section class="fin-panel fin-error" role="alert">读取财务数据失败：${esc(state.loadError)} <button data-action="reload">重试</button></section>`;
    if (!state.busy && (state.periodMode === 'recent' && !state.latestDate || !state.report?.recordCount)) return `${toolbar()}${datebar}${balanceCard()}<section class="fin-panel fin-no-records"><h2>${state.periodMode === 'recent' ? '暂无收支数据' : '所选日期范围暂无收支记录'}</h2><p class="fin-hint">${state.periodMode === 'recent' ? '可新增收支或导入 Excel 表格；仅有未来或无效记录时，不计入最近数据。' : '可以调整日期，或查看最近有记录的月份。'}</p><div class="fin-inline">${state.periodMode !== 'recent' ? '<button data-action="recent-data">查看最近数据</button>' : ''}<button data-action="add">新增收支</button><button class="primary" data-action="import">导入 Excel</button></div></section>`;
    return `${toolbar()}${datebar}
      <div class="fin-stats"><article><span>总收入</span><strong>¥ ${money(totals.incomeCents)}</strong><small>${totals.incomeCount || 0} 笔收入</small></article><article><span>总支出</span><strong>¥ ${money(totals.expenseCents)}</strong><small>${totals.expenseCount || 0} 笔支出</small></article><article class="${totals.balanceCents < 0 ? 'fin-negative' : ''}"><span>期间收支结余</span><strong>¥ ${money(totals.balanceCents)}</strong><small>${totals.balanceCents < 0 ? '支出高于收入' : '收入减去支出'}</small></article><article><span>收支记录</span><strong>${state.report?.recordCount || 0} 笔</strong><small>${esc(state.report?.startDate || state.startDate)} 至 ${esc(state.report?.endDate || state.endDate)}</small></article></div>
      ${balanceCard()}<div class="fin-chart-grid"><section class="fin-panel"><div class="fin-panel-title"><h2>月度收支趋势</h2><span>单位：元</span></div><div class="fin-chart" data-fin-chart="monthly" role="img" aria-label="月度收入和支出柱状图"></div></section>
      <section class="fin-panel"><div class="fin-panel-title"><h2>科目占比</h2>${state.canRefine ? `<button data-action="refine-categories" ${state.busy || !state.report?.recordCount ? 'disabled' : ''}>智能整理收支科目</button>` : ''}<div class="fin-chart-switch"><button data-chart-type="expense" class="${state.chartType === 'expense' ? 'active' : ''}">支出</button><button data-chart-type="income" class="${state.chartType === 'income' ? 'active' : ''}">收入</button></div></div><div class="fin-chart-grouping"><label>展示方式 <select data-field="chartMode" aria-label="科目展示方式">${[['auto','自动'],['summary','汇总大类'],['detail','具体科目']].map(([value,label])=>`<option value="${value}" ${state.chartMode===value?'selected':''}>${label}</option>`).join('')}</select></label><small>${chartGroups.chartCategories(state.report || {}, {type:state.chartType,mode:state.chartMode}).mode==='summary'?'已按用途汇总，点击大类查看包含的台账':'展示具体科目，点击科目筛选台账'}</small></div><div class="fin-chart" data-fin-chart="category" role="img" aria-label="科目金额占比环形图"></div></section></div>
      ${narrativePanel()}
      <section class="fin-panel" data-ledger-panel><div class="fin-panel-title"><h2>收支台账</h2><span data-ledger-count>${visible().length} 笔</span></div><div class="fin-list-tools"><div class="fin-search-box"><input data-field="search" aria-label="搜索收支台账" placeholder="搜索摘要、科目或凭证号" value="${esc(state.search)}"><button data-action="clear-search" aria-label="清空搜索" title="清空搜索" ${state.search ? '' : 'hidden'}>×</button></div><select data-field="type"><option value="">全部类型</option><option value="income" ${state.type === 'income' ? 'selected' : ''}>收入</option><option value="expense" ${state.type === 'expense' ? 'selected' : ''}>支出</option></select><button data-action="batch-delete" ${state.selectedIds.size ? '' : 'disabled'}>删除所选 (${state.selectedIds.size})</button></div><div class="fin-chart-filters" data-chart-filters>${filterChips()}</div>${balanceReviewBanner()}<div data-ledger-results>${ledgerResults()}</div></section>`;
  }
  function balanceCard() {
    const balance = state.accountBalance;
    const text = state.balanceError ? '暂无法读取' : balance?.status === 'ready' ? `¥ ${money(balance.amountCents)}` : balance?.status === 'before-opening' ? '无法计算' : '待设置';
    const hint = state.balanceError || (balance?.status === 'before-opening' ? '早于期初日期，无法计算' : balance?.status === 'ready' ? `截至 ${balance.asOfDate} · 期初余额加累计收支` : '设置期初日期与余额后，自动计算账户余额');
    return `<section class="fin-account-balance"><div><span>账户余额</span><strong class="${balance?.amountCents < 0 ? 'negative' : ''}">${esc(text)}</strong><small>${esc(hint)}</small></div>${state.canSetBalance ? '<button data-action="set-opening-balance">设置期初余额</button>' : ''}</section>`;
  }
  function openingView() {
    const form = state.openingForm || {};
    return `<div class="fin-subhead"><button data-action="cancel-opening">← 返回台账</button><h1>设置期初余额</h1></div><section class="fin-panel fin-opening-form"><p class="fin-hint">${state.openingCandidateHint ? esc(state.openingCandidateHint) + '<br>' : ''}填写起始日期当天开始时的账户余额；该日期起的全部收支将计入累计余额。</p><div class="fin-form-grid"><label>期初日期<input type="date" max="${today()}" data-opening="startDate" value="${esc(form.startDate)}"></label><label>期初余额（元）<input type="text" inputmode="decimal" data-opening="amount" value="${esc(form.amount)}" placeholder="可填写零或负数"></label></div><p class="fin-hint">修改后，财务页与工作台将按新的期初余额重新计算。</p>${state.openingError ? `<p class="fin-error" role="alert">${esc(state.openingError)}</p>` : ''}</section><div class="fin-sticky fin-import-footer"><button data-action="cancel-opening" ${state.busy ? 'disabled' : ''}>取消</button><button class="primary" data-action="save-opening" ${state.busy ? 'disabled' : ''}>${state.busy ? '保存中…' : '保存期初余额'}</button></div>`;
  }
  async function saveOpening() {
    if (state.busy || !state.canSetBalance) return;
    const form = state.openingForm;
    const value = String(form.amount).trim();
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(Math.round(Number(value) * 100))) { state.openingError = '请输入有效的余额，最多两位小数'; return render(); }
    state.busy = true; state.openingError = ''; render();
    try {
      await request('PATCH', '/finance-opening-balance', { startDate: form.startDate, amountCents: Math.round(Number(value) * 100), baseVersion: form.baseVersion });
      state.openingForm = null; state.mode = 'ledger'; await load(); notify('期初余额已保存，账户余额已更新');
    } catch (error) { state.openingError = error.message; }
    finally { state.busy = false; render(); }
  }
  function disposeCharts() { charts.forEach(chart => chart.dispose()); charts = []; resizeObserver?.disconnect(); }
  function mountCharts() {
    if (state.mode !== 'ledger') return;
    const months = state.report?.months || [];
    const parts = chartGroups.chartCategories(state.report || {}, { type: state.chartType, mode: state.chartMode }).parts;
    const nodes = state.host.querySelectorAll?.('[data-fin-chart]') || [];
    for (const node of nodes) {
      const monthly = node.dataset.finChart === 'monthly';
      const data = monthly ? months : parts;
      if (!data.length) { node.innerHTML = '<p class="fin-empty">当前范围暂无' + (monthly ? '月度记录' : state.chartType === 'income' ? '收入' : '支出') + '</p>'; continue; }
      if (!window.echarts) { node.innerHTML = `<div class="fin-chart-fallback">${data.map(item => `<p>${esc(monthly ? item.month : item.category)}：${monthly ? `收入 ${money(item.incomeCents)} / 支出 ${money(item.expenseCents)}` : money(item.amountCents)} 元</p>`).join('')}</div>`; continue; }
      const chart = window.echarts.init(node); charts.push(chart);
      const formatYuan = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 元';
      chart.setOption(monthly ? {
        color: ['#0c9f7a', '#efb260'], aria: { enabled: true },
        tooltip: { trigger: 'axis', appendTo: 'body', confine: true, valueFormatter: formatYuan }, legend: { bottom: 0, icon: 'roundRect' },
        grid: { left: 12, right: 14, top: 24, bottom: 44, containLabel: true },
        xAxis: { type: 'category', data: months.map(item => item.month), axisTick: { show: false }, axisLine: { lineStyle: { color: '#dde7e5' } }, axisLabel: { color: '#647a78' } },
        yAxis: { type: 'value', axisLabel: { color: '#647a78', formatter: value => Math.abs(value) >= 10000 ? `${value / 10000}万` : value }, splitLine: { lineStyle: { color: '#edf3f2', type: 'dashed' } } },
        series: ['income', 'expense'].map(type => ({ name: type === 'income' ? '收入' : '支出', type: 'bar', barMaxWidth: 26, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: months.map(item => item[`${type}Cents`] / 100) }))
      } : {
        color: ['#0c9f7a', '#4ba9c1', '#efb260', '#8d92ce', '#66bbad', '#df8498', '#a7b5be'], aria: { enabled: true },
        tooltip: { trigger: 'item', appendTo: 'body', confine: true, enterable: true, extraCssText: 'max-width:min(320px,80vw);max-height:60vh;overflow-y:auto;white-space:normal;overflow-wrap:anywhere;', formatter: item => { const part = parts[item.dataIndex]; return part ? `<strong>${esc(part.category)}</strong><br>金额：${money(part.amountCents)} 元<br>占比：${Number(item.percent).toFixed(2)}%<br>记录：${part.count} 笔${part.categories.length > 1 || part.categories[0] !== part.category ? `<br>具体科目：${part.categories.map(esc).join('、')}` : ''}<br><small>点击筛选台账</small>` : ''; } }, legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', width: 120, tooltip: { show: true }, textStyle: { color: '#536b69', width: 110, overflow: 'break' } },
        series: [{ type: 'pie', radius: ['48%', '72%'], center: ['33%', '48%'], avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: false }, scaleSize: 6 }, itemStyle: { borderColor: '#fff', borderWidth: 3 }, data: parts.map(item => ({ name: item.category, value: item.amountCents / 100 })) }],
        graphic: [{ type: 'text', left: '18%', top: '85%', style: { text: `${state.chartType === 'income' ? '收入' : '支出'}合计 ${money(parts.reduce((sum, item) => sum + item.amountCents, 0))} 元`, fill: '#536b69', fontSize: 12 } }]
      });
      const partType = state.chartType;
      chart.on('click', event => {
        if (event.componentType !== 'series' || !Number.isInteger(event.dataIndex)) return;
        if (monthly && months[event.dataIndex] && [0, 1].includes(event.seriesIndex)) drillDown({ month: months[event.dataIndex].month, type: event.seriesIndex === 0 ? 'income' : 'expense' });
        else if (!monthly && parts[event.dataIndex]) drillDown({ category: parts[event.dataIndex].category, selection: parts[event.dataIndex], type: partType });
      });
    }
    if (window.ResizeObserver) { resizeObserver = new window.ResizeObserver(() => charts.forEach(chart => chart.resize())); nodes.forEach(node => resizeObserver.observe(node)); }
  }
  function formView() {
    const form = state.form || {}; const original = state.records.find(row => row.id === form.id);
    return `<div class="fin-subhead"><button data-action="cancel-form">← 返回台账</button><h1>${form.id ? '编辑收支' : '新增收支'}</h1></div><section class="fin-panel fin-form">${original ? `<div class="fin-balance-review-banner"><span>计算余额：${Number.isSafeInteger(original.calculatedBalanceCents) ? money(original.calculatedBalanceCents) : '暂无法计算'} 元 · 原表余额：${Number.isSafeInteger(original.sourceBalanceCents) ? money(original.sourceBalanceCents) : '无'} · ${esc(balanceLabels[original.balanceStatus] || '')}</span>${state.canRefine && original.dayCount > 1 ? `<button data-order-date="${esc(original.recordDate || original.date)}">调整同日顺序</button>` : ''}</div>` : ''}<div class="fin-form-grid"><label>日期<input type="date" data-form="recordDate" value="${esc(form.recordDate)}"></label><label>类型<select data-form="recordType"><option value="income" ${form.recordType === 'income' ? 'selected' : ''}>收入</option><option value="expense" ${form.recordType === 'expense' ? 'selected' : ''}>支出</option></select></label><label>科目<select data-form="category">${options(form.recordType || 'income', form.category)}</select></label><label>金额（元）<input type="number" step="0.01" min="0.01" data-form="amount" value="${esc(form.amount)}"></label><label class="span2">摘要<input data-form="summary" value="${esc(form.summary)}" placeholder="写明这笔收支的用途或来源"></label><label>经办人<input data-form="handler" value="${esc(form.handler)}"></label><label>对方单位 / 个人<input data-form="counterparty" value="${esc(form.counterparty)}"></label><label>凭证号<input data-form="voucherNo" value="${esc(form.voucherNo)}"></label><label>备注<input data-form="remarks" value="${esc(form.remarks)}"></label></div>${state.formError ? `<p class="fin-error">${esc(state.formError)}</p>` : ''}</section><div class="fin-sticky"><button data-action="cancel-form">取消</button><button class="primary" data-action="save-form" ${state.busy ? 'disabled' : ''}>${form.id ? '保存修改' : '保存收支'}</button></div>`;
  }
  function importMappingView(sheet) {
    const names = { date: '日期', month: '月', day: '日', summary: '摘要', amount: '单笔金额', income: '收入金额', expense: '支出金额', balance: '原表余额', type: '类型', category: '科目', remarks: '备注' };
    return `<details class="fin-panel fin-mapping"><summary>高级：调整“${esc(sheet.sheetName)}”的识别方式</summary>
      <div class="fin-map-heading"><label>表头行号 <input type="number" min="1" data-header-row="${esc(sheet.sheetName)}" value="${sheet.headerRowNumber || 1}"></label>
      <label>数据年份 <input type="number" min="1900" max="2199" data-map-year="${esc(sheet.sheetName)}" value="${sheet.context?.year || ''}" placeholder="原表未注明时填写"></label></div>
      <div class="fin-map-grid">${Object.entries(names).map(([field, label]) => `<label>${label}<select data-map-field="${field}" data-map-sheet="${esc(sheet.sheetName)}"><option value="">未指定</option>${sheet.headers.map((head, index) => `<option value="${index}" ${sheet.mapping?.[field] === index ? 'selected' : ''}>${esc(head)}</option>`).join('')}</select></label>`).join('')}</div>
      <button data-remap-sheet="${esc(sheet.sheetName)}" ${state.importBusy ? 'disabled' : ''}>应用调整并自动校验</button></details>`;
  }
  function importRowView(row) {
    const included = state.selectedRows.has(row.key);
    const problem = row.reviewStatus==='existing' ? '已入账，不重复导入' : row.reviewStatus==='non-business' ? `人工排除：${row.excludeReason}` : row.issues?.join('、') || (row.reviewStatus==='pending' && row.duplicateKind==='suspect' ? '其他来源相似，待确认' : '自动校验通过');
    return `<tr data-import-row="${esc(row.key)}" class="${included ? '' : 'suspect'}"><td>${esc(row.sheetName)} / ${row.sourceRowNumber}</td><td>${esc(row.recordDate || row.sourceDate || '未识别')}</td>
      <td>${row.recordType === 'income' ? '收入' : row.recordType === 'expense' ? '支出' : '未识别'}</td><td>${esc(row.category || '未识别')}${row.categorySource === 'ai' ? '<small class="fin-source">AI</small>' : ''}</td>
      <td>${esc(row.summary || '未识别')}</td><td>${Number.isSafeInteger(row.amountCents) ? `¥ ${money(row.amountCents)}` : '金额待识别'}${Number.isSafeInteger(row.sourceBalanceCents) ? `<small>原表余额 ${money(row.sourceBalanceCents)}</small><small>${esc(balanceLabels[row.balanceStatus] || '待核对')}${Number.isSafeInteger(row.calculatedBalanceCents) ? ` · 计算 ${money(row.calculatedBalanceCents)}` : ''}${Number.isSafeInteger(row.balanceDifferenceCents) && row.balanceDifferenceCents !== 0 ? ` · 差额 ${money(row.balanceDifferenceCents)}` : ''}</small>` : ''}</td><td><span class="${included ? 'fin-ready' : 'fin-warn'}">${esc(problem)}</span></td>
      <td><button data-edit-import="${esc(row.key)}">${state.editingKey === row.key ? '收起' : '调整'}</button></td></tr>
      ${state.editingKey === row.key ? `<tr class="fin-import-edit"><td colspan="8"><div class="fin-edit-grid">
      <label>日期<input type="date" data-row-key="${esc(row.key)}" data-row-field="recordDate" value="${esc(row.recordDate)}"></label>
      <label>收支<select data-row-key="${esc(row.key)}" data-row-field="recordType"><option value="">请选择</option><option value="income" ${row.recordType === 'income' ? 'selected' : ''}>收入</option><option value="expense" ${row.recordType === 'expense' ? 'selected' : ''}>支出</option></select></label>
      <label>科目<select data-row-key="${esc(row.key)}" data-row-field="category"><option value="">请选择</option>${options(row.recordType, row.category)}</select></label>
      <label>金额（元）<input type="number" min="0.01" step="0.01" data-row-key="${esc(row.key)}" data-row-field="amount" value="${Number.isSafeInteger(row.amountCents) ? row.amountCents / 100 : ''}"></label>
      <label class="span2">摘要<input data-row-key="${esc(row.key)}" data-row-field="summary" value="${esc(row.summary)}"></label>
      <label><input type="checkbox" data-import-key="${esc(row.key)}" ${row.excludedByUser ? '' : 'checked'}> 包含此记录</label><label>非业务行排除原因<input data-exclude-reason="${esc(row.key)}" value="${esc(row.excludeReason)}" placeholder="排除此行时必须填写"></label><details class="span2"><summary>原始单元格内容</summary><p>${esc((row.raw || []).map((value,index)=>`${index+1}列：${value}`).join('；'))}</p></details>
      ${row.duplicateKind === 'suspect' ? `<label>相似记录确认<select data-duplicate-decision="${esc(row.key)}"><option value="">待确认</option><option value="independent" ${row.duplicateDecision==='independent'?'selected':''}>独立交易，正常导入</option><option value="existing" ${row.duplicateDecision==='existing'?'selected':''}>已入账，不重复导入</option></select></label>` : ''}</div></td></tr>` : ''}`;
  }
  function importView() {
    const workbook = state.workbook;
    const totals = reconcileReview();
    const selectedSheets = state.sheets.filter(sheet => state.selectedSheets.has(sheet.sheetName));
    const skipped = selectedSheets.reduce((sum, sheet) => sum + sheet.skipped.length, 0);
    const unresolvedSheets = selectedSheets.filter(sheet => sheet.error);
    const shown = state.rows.filter(row => state.selectedSheets.has(row.sheetName));
    const pages = Math.max(1, Math.ceil(shown.length / 100));
    state.importPage = Math.min(state.importPage, pages - 1);
    const omitted = totals.unresolved + totals.duplicates + totals.excluded;
    return `<div class="fin-subhead"><button data-action="cancel-import" ${state.importBusy ? 'disabled' : ''}>← 返回台账</button><div><h1>导入财务收支 Excel</h1><p class="fin-hint">上传表格后自动识别和校验，确认即可导入。</p></div></div>
      <div class="fin-import-steps"><span class="active">1 上传表格</span><span class="${workbook ? 'active' : ''}">2 自动识别</span><span>3 确认导入</span></div>
      <section class="fin-panel"><div class="fin-panel-title"><h2>财务表格</h2><button data-action="pick-file" ${state.importBusy ? 'disabled' : ''}>${workbook ? '重新选择表格' : '上传 Excel 表格'}</button></div>
      ${workbook ? `<p><strong>${esc(workbook.fileName)}</strong> · ${state.sheets.length} 个工作表</p><div class="fin-sheet-list"><label><input type="checkbox" data-action="all-sheets" ${state.importBusy ? 'disabled' : ''} ${state.selectedSheets.size === state.sheets.length ? 'checked' : ''}> 全选月份</label>${state.sheets.map(sheet => `<label><input type="checkbox" data-sheet="${esc(sheet.sheetName)}" ${state.importBusy ? 'disabled' : ''} ${state.selectedSheets.has(sheet.sheetName) ? 'checked' : ''}> ${esc(sheet.sheetName)} <small>${sheet.rows.length} 条${sheet.error ? ' · 待识别' : ''}</small></label>`).join('')}</div>` : '<p class="fin-hint">支持多个工作表。上传后默认识别全部月份，也可以只选需要的月份。</p>'}</section>
      ${workbook ? `<section class="fin-panel fin-auto-review" aria-busy="${state.importBusy}"><div class="fin-panel-title"><h2>${state.importBusy ? '正在识别与校验…' : '自动识别结果'}</h2><button data-action="ai-classify" ${state.importBusy || !state.selectedSheets.size ? 'disabled' : ''}>${state.importBusy ? '处理中…' : '识别不准？AI 重新识别'}</button></div>
      <p class="fin-hint">${esc(state.importStatus || '每个原表行均已登记处理结果；无法确定的收支行会暂停整批导入。')}</p>
      <div class="fin-stats"><article><span>原表收支候选</span><strong>${totals.candidates} 笔</strong><small>待导入 ${totals.ready} · 已入账 ${totals.existing} · 待处理 ${totals.pending}</small></article><article><span>待导入收入</span><strong>¥ ${money(totals.incomeCents)}</strong><small>原表已识别 ${money(totals.sourceIncomeCents)} 元</small></article><article><span>待导入支出</span><strong>¥ ${money(totals.expenseCents)}</strong><small>原表已识别 ${money(totals.sourceExpenseCents)} 元</small></article><article><span>非业务行</span><strong>${skipped + totals.excluded} 行</strong><small>包含表头、说明及合计，保留原行与原因</small></article></div>
      ${totals.pending || state.importIntegrity.blocked ? '<p class="fin-error">原表还有未解决的行或合计，暂停整批导入，避免漏账。</p><button data-action="locate-import-problem">定位首个待处理行</button>' : ''}
      ${totals.duplicates ? `<div class="fin-inline"><span>${totals.duplicates} 笔与其他来源相似，请确认：</span><button data-action="duplicates-independent">全部为独立交易</button><button data-action="duplicates-existing">全部已入账</button></div>` : ''}
      ${state.importIntegrity.checks.map(check=>`<div class="${check.matches ? 'fin-hint' : 'fin-error'}"><strong>${esc(check.sheetName)} 第 ${check.sourceRowNumber} 行原表合计：${check.matches ? '核对一致' : '存在差异'}</strong><p>原表收入 ${Number.isSafeInteger(check.expectedIncomeCents)?money(check.expectedIncomeCents):'原值无法解析'} / 识别 ${money(check.incomeCents)}；原表支出 ${Number.isSafeInteger(check.expectedExpenseCents)?money(check.expectedExpenseCents):'原值无法解析'} / 识别 ${money(check.expenseCents)}</p>${check.matches ? '' : `<label>若确认原表合计错误，请注明依据<input data-total-reason="${esc(check.key)}" value="${esc(check.reason)}" placeholder="请先核对原表，不自动忽略差异"></label>`}</div>`).join('')}
      ${(state.importPending || state.importError) ? `<p class="fin-hint">${state.importPending ? `${state.importPending} 笔 AI 分类待重试。` : '科目识别未完成。'}<button data-action="retry-classification" ${state.importBusy ? 'disabled' : ''}>重试科目识别</button></p>` : ''}${totals.defaults ? `<p class="fin-hint">${totals.defaults} 条已按收支方向归入“其他收入 / 其他支出”，用途依据不足或 AI 未完成的记录保留原科目，不强行分类。</p>` : ''}
      ${totals.unresolved || unresolvedSheets.length ? `<p class="fin-error">${totals.unresolved} 笔字段待核对；${unresolvedSheets.length} 个工作表表头待识别。可用 AI 重试或在明细中修改。</p>` : ''}
      ${state.importBalanceWarning ? `<p class="fin-error">${esc(state.importBalanceWarning)}</p>` : ''}<p class="fin-hint">原表余额已独立保存；${state.rows.filter(row=>state.selectedRows.has(row.key) && ['mismatch','order-review','invalid-source'].includes(row.balanceStatus)).length} 笔余额待审核。确认后可以导入，稍后在台账点击“查看余额核对”处理。</p><details class="fin-import-details" data-import-details ${state.importBusy ? 'inert' : ''} ${state.detailsOpen ? 'open' : ''}><summary>查看识别明细与可选调整 <small>${shown.length} 条记录</small></summary>
      <div class="fin-table-wrap fin-import-table"><table><thead><tr><th>月份 / 原行号</th><th>日期</th><th>收支</th><th>科目</th><th>摘要</th><th>金额</th><th>校验结果</th><th>操作</th></tr></thead><tbody>${shown.slice(state.importPage * 100, (state.importPage + 1) * 100).map(importRowView).join('') || '<tr><td colspan="8" class="fin-empty">暂无可读取的收支记录，可使用 AI 重新识别</td></tr>'}</tbody></table></div>
      <div class="fin-pages"><button data-action="previous-import-page" ${state.importPage === 0 ? 'disabled' : ''}>上一页</button><span>${state.importPage + 1} / ${pages} 页</span><button data-action="next-import-page" ${state.importPage >= pages - 1 ? 'disabled' : ''}>下一页</button></div>
      <details><summary>非业务行及排除原因（${skipped} 行）</summary>${selectedSheets.map(sheet=>sheet.skipped.map(row=>`<p>${esc(sheet.sheetName)} / ${row.sourceRowNumber} · ${esc(row.reason)} · ${esc((row.raw || []).join(' | '))}</p>`).join('')).join('')}</details><div class="fin-import-batch-tools"><label>批量排除字段待处理行的原因<input data-batch-exclude-reason placeholder="仅用于明确不是交易的行"></label><button data-action="batch-exclude-import">认定为非业务行</button></div><div class="fin-import-batch-tools"><label>批量补全缺失日期<input type="date" data-batch-import-date></label><button data-action="batch-import-date">应用到缺失日期行</button></div>${selectedSheets.map(importMappingView).join('')}</details></section>` : ''}
      ${state.importError ? `<p class="fin-error" role="alert">${esc(state.importError)}</p>` : ''}
      <div class="fin-sticky fin-import-footer"><div><strong>${totals.ready ? `确认后导入 ${totals.ready} 条记录` : totals.existing && !totals.pending ? '所选记录均已入账，无需重复导入' : '上传并完整核对表格后即可确认'}</strong>${omitted ? `<small>${totals.existing} 笔已入账 · ${totals.pending} 笔待处理 · ${totals.excluded} 行人工排除</small>` : ''}</div><div class="fin-inline"><button data-action="cancel-import" ${state.importBusy ? 'disabled' : ''}>取消</button><button class="primary" data-action="commit-import" ${!totals.ready || totals.pending || state.importIntegrity?.blocked || state.importBusy ? 'disabled' : ''}>${state.importBusy ? '处理中…' : `确认导入 ${totals.ready ? totals.ready + ' 条' : ''}`}</button></div></div>`;
  }
  function render() {
    if (!state.host) return;
    if (composing) { pendingRender = true; return; }
    disposeCharts();
    state.host.innerHTML = `<main class="fin-workspace">${state.message ? `<div class="fin-notice ${state.messageType === 'error' ? 'is-error' : ''}" role="status"><span>${esc(state.message)}</span><button data-action="dismiss-message" aria-label="关闭提醒">×</button></div>` : ''}${state.mode === 'balance-review' ? balanceReviewView() : state.mode === 'order' ? orderView() : state.mode === 'refine' ? refinementView() : state.mode === 'import' ? importView() : state.mode === 'form' ? formView() : state.mode === 'opening' ? openingView() : ledgerView()}</main>`;
    mountCharts();
  }
  function rowValid(row) { return row.reviewStatus === 'import'; }
  function reconcileReview() {
    const result = reviewModel.review(state.rows, state.records, state.selectedSheets, categories);
    state.selectedRows = result.selected;
    state.importIntegrity = reviewModel.integrityOf(state.sheets.filter(sheet => state.selectedSheets.has(sheet.sheetName)), state.rows, state.totalAcknowledgements);
    if (result.totals.pending || state.importIntegrity.blocked) state.detailsOpen = true;
    return result.totals;
  }
  function rebuildRows(resetSheets = new Set()) {
    const previous = new Map(state.rows.map(row => [row.key, row]));
    state.rows = state.sheets.flatMap(sheet => sheet.rows.map(item => {
      const key = `${encodeURIComponent(sheet.sheetName)}:${item.sourceRowNumber}`;
      return !resetSheets.has(sheet.sheetName) && previous.get(key) || { ...item, key, sourceFileHash: state.workbook?.fileHash, manualFields: [], duplicate: '', allowDuplicate: false, excludedByUser: false };
    }));
    reconcileReview();
  }
  let importBalanceSequence = 0;
  async function updateImportBalances() {
    const sequence = ++importBalanceSequence; reconcileReview(); const rows = state.rows.filter(row=>state.selectedRows.has(row.key));
    if (!rows.length) return;
    try {
      const result = await request('POST', '/finance-balance-preview', { rows });
      if (sequence !== importBalanceSequence || !state.workbook) return;
      for (const item of result.items || []) { const row = state.rows.find(row=>row.sheetName === item.sheetName && row.sourceRowNumber === item.sourceRowNumber); if (row) for (const field of ['calculatedBalanceCents','balanceStatus','balanceDifferenceCents','balanceReason']) row[field] = item[field]; }
      state.importBalanceWarning = ''; render();
    } catch (error) { if (sequence === importBalanceSequence) { state.importBalanceWarning = `余额预核对未完成：${error.message}。导入后可重试核对。`; render(); } }
  }
  async function flagDuplicates() { reconcileReview(); render(); await updateImportBalances(); }
  async function selectWorkbook() {
    if (state.importBusy) return;
    state.importBusy = true; state.importError = ''; state.importStatus = '正在读取工作表并自动识别…'; state.message = ''; render();
    try {
      const result = await api.selectFinanceWorkbook();
      if (!result) return;
      if (result.categories) { categories.income = result.categories.income; categories.expense = result.categories.expense; }
      state.workbook = result; state.sheets = result.sheets; state.selectedSheets = new Set(result.sheets.map(sheet => sheet.sheetName));
      state.totalAcknowledgements = {}; state.rows = []; state.importBalanceWarning = ''; state.importPending = 0; state.importUncertain = 0; state.importPage = 0; state.detailsOpen = false; state.editingKey = ''; state.importBatchId = '';
      rebuildRows();
      if (reconcileReview().unresolved || state.importIntegrity.blocked && state.sheets.some(sheet=>sheet.error)) await classify(true);
      await autoClassifySelected(); await updateImportBalances();
    } catch (error) { state.importError = error.message; }
    finally { state.importBusy = false; render(); }
  }
  function acceptImportClassification(result) {
    if (result.categories) { categories.income=result.categories.income;categories.expense=result.categories.expense; }
    const sheets=new Map(result.sheets.map(sheet=>[sheet.sheetName,sheet]));
    state.sheets=state.sheets.map(sheet=>sheets.get(sheet.sheetName)||sheet);
    const rows=new Map(result.sheets.flatMap(sheet=>sheet.rows.map(row=>[`${encodeURIComponent(sheet.sheetName)}:${row.sourceRowNumber}`,row])));
    for (const row of state.rows) {
      const recognized=rows.get(row.key);
      if (!recognized || row.summary!==recognized.summary || row.recordType!==recognized.recordType || row.categorySource==='manual') continue;
      for (const key of ['category','categorySource','categoryClassificationKey','categoryClassificationStatus','categoryClassificationReason']) row[key]=recognized[key];
    }
    rebuildRows();
    const selected=state.rows.filter(row=>state.selectedSheets.has(row.sheetName));
    state.importPending=selected.filter(row=>row.categoryClassificationStatus==='failed').length;
    state.importUncertain=selected.filter(row=>row.categoryClassificationStatus==='uncertain').length;
    state.importStatus=`科目识别与自动校验已完成，可以确认导入。${state.importUncertain ? ` ${state.importUncertain} 笔用途依据不足，保留原科目。` : ''}`;
    if (result.warnings?.length) state.importError=`${result.warnings.join('；')}。${state.importPending} 笔 AI 分类未完成；已保留本机识别结果，可重试或确认有效记录。`;
  }
  async function autoClassifySelected(force=false) {
    if (!state.workbook || !state.selectedSheets.size) {state.importPending=0;state.importUncertain=0;return;}
    state.importStatus='正在根据摘要识别具体科目，AI 正在补充未明确的用途…';state.importError='';render();
    try { acceptImportClassification(await api.classifyFinanceWorkbook({previewId:state.workbook.previewId,sheetNames:[...state.selectedSheets],force})); }
    catch (error) { state.importError=`科目自动识别未完成：${error.message}。已保留原始识别结果，可重试或确认有效记录。`; }
  }
  async function classifySelectedSheets() {
    state.importBusy=true;render();
    try {await autoClassifySelected(); await updateImportBalances();} finally {state.importBusy=false;render();}
  }
  function formFromRecord(row) { return { id: row?.id, version: row?.version, recordDate: row?.recordDate || row?.date || today(),
    recordType: row?.recordType || row?.type || 'expense', category: row?.category || expense[0], summary: row?.summary || '',
    amount: row ? (row.amountCents ?? Math.round(Number(row.amount || 0) * 100)) / 100 : '', handler: row?.handler || '',
    counterparty: row?.counterparty || '', voucherNo: row?.voucherNo || row?.voucherNumber || '', remarks: row?.remarks || '' }; }
  function confirmLeave() { return window.confirm('放弃尚未保存的修改吗？'); }
  async function saveForm() {
    try {
      const form = state.form;
      const amountCents = Math.round(Number(form.amount) * 100);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.recordDate) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !String(form.summary).trim() || !categories[form.recordType].includes(form.category)) throw new Error('请填写完整日期、摘要、金额和科目');
      state.busy = true; render();
      const changes = { recordDate: form.recordDate, recordType: form.recordType, category: form.category,
        amountCents, summary: form.summary, handler: form.handler, counterparty: form.counterparty,
        voucherNo: form.voucherNo, remarks: form.remarks };
      await request(form.id ? 'PATCH' : 'POST', `/finance-records${form.id ? `/${encodeURIComponent(form.id)}` : ''}`,
        form.id ? { baseVersion: form.version, changes } : changes);
      state.form = null; state.mode = state.reviewReturn ? 'balance-review' : 'ledger'; state.formError = ''; await load(); notify('收支记录已保存');
    } catch (error) { state.formError = error.message; state.busy = false; render(); }
  }
  async function commitImport() {
    if (state.importBusy || !state.workbook) return;
    const totals = reconcileReview();
    if (totals.pending || state.importIntegrity.blocked) { state.importError = '请先处理所有疑似收支行及合计差异，整批数据尚未完整核对'; render(); return; }
    await updateImportBalances();
    const rows = state.rows.filter(row => state.selectedRows.has(row.key));
    if (!rows.length || rows.some(row => !rowValid(row))) { state.importError = '请先修正所选记录中的必填项'; render(); return; }
    const batchId = state.importBatchId ||= crypto.randomUUID();
    const payload = { batchId, previewId: state.workbook.previewId, reviewRows: structuredClone(state.rows.filter(row => state.selectedSheets.has(row.sheetName))), totalAcknowledgements: structuredClone(state.totalAcknowledgements), fileHash: state.workbook.fileHash, fileName: state.workbook.fileName, sheets: [...state.selectedSheets],
      rows: structuredClone(rows.map(({ key, raw, issues, duplicate, amount, excludedByUser, ...row }) => row)) };
    state.importBusy = true; state.importError = ''; state.importStatus = '正在保存识别通过的记录…'; render();
    try {
      const snapshot = await api.createV3ImportSnapshot({ id: batchId, domain: 'finance' });
      if (snapshot?.success === false) throw new Error(snapshot.warning || '创建导入前备份失败');
      const result = await request('POST', '/finance-imports', payload);
      state.mode = 'ledger'; state.workbook = null; state.rows = []; await load(); notify(`成功导入 ${result.count} 条收支记录${state.balanceReview?.pendingCount ? `，${state.balanceReview.pendingCount} 笔余额待审核，可点击“查看余额核对”定位处理` : ''}`);
    } catch (error) { state.importError = error.message; render(); }
    finally { state.importBusy = false; render(); }
  }
  async function classify(automatic = false) {
    if (state.importBusy && !automatic || !state.workbook || !state.selectedSheets.size) return;
    const previousBusy = state.importBusy;
    state.importBusy = true; state.importError = ''; state.importStatus = 'AI 正在识别所选工作表的表头、收支方向与科目…'; state.message = ''; render();
    try {
      const result = await api.recognizeFinanceWorkbook({ previewId: state.workbook.previewId, sheetNames: [...state.selectedSheets] });
      state.importPending=result.pendingCount || 0;state.importUncertain=result.uncertainCount || 0;
      if (result.categories) { categories.income = result.categories.income; categories.expense = result.categories.expense; }
      const recognized = new Map(result.sheets.map(sheet => [sheet.sheetName, sheet]));
      state.sheets = state.sheets.map(sheet => recognized.get(sheet.sheetName) || sheet);
      const manual = state.rows.filter(row=>row.manualFields?.length || row.excludedByUser || row.duplicateDecision);
      rebuildRows(new Set(recognized.keys()));
      for (const saved of manual) { const row=state.rows.find(item=>item.key===saved.key); if(row) {for(const field of saved.manualFields || []) row[field]=saved[field]; row.manualFields=saved.manualFields; row.excludedByUser=saved.excludedByUser;row.excludeReason=saved.excludeReason;row.duplicateDecision=saved.duplicateDecision;} }
      reconcileReview(); await updateImportBalances();
      state.importStatus = 'AI 识别与自动校验已完成，可以确认导入。';
      if (result.warnings?.length) state.importError = `部分 AI 识别未完成：${result.warnings.join('；')}。已保留完整原行清单，待处理行解决后方可确认。`;
    } catch (error) { state.importError = `AI 识别未完成：${error.message}。本机已保留完整原行清单，待处理行解决后方可确认。`; state.importStatus = '已保留本机识别结果。'; }
    finally { state.importBusy = previousBusy; render(); }
  }
  async function onAction(action, target) {
    if (action === 'locate-import-problem') {
      const shown=state.rows.filter(row=>state.selectedSheets.has(row.sheetName)), index=shown.findIndex(row=>row.reviewStatus==='pending');
      if(index>=0) {state.importPage=Math.floor(index/100);state.editingKey=shown[index].key;state.detailsOpen=true;render();const node=state.host.querySelector?.(`[data-import-row="${CSS.escape(shown[index].key)}"]`);node?.classList.add('fin-row-highlight');node?.scrollIntoView({block:'center'});} return;
    }
    if (action === 'duplicates-independent' || action === 'duplicates-existing') { for(const row of state.rows) if(state.selectedSheets.has(row.sheetName) && row.duplicateKind==='suspect') {row.duplicateDecision=action==='duplicates-independent'?'independent':'existing';row.allowDuplicate=false;} return flagDuplicates(); }
    if (action === 'batch-exclude-import') {const reason=String(state.host.querySelector?.('[data-batch-exclude-reason]')?.value || '').trim(), rows=state.rows.filter(row=>state.selectedSheets.has(row.sheetName) && row.reviewStatus==='pending' && row.issues.length);if(reason.length<2 || !rows.length || !window.confirm(`将 ${rows.length} 行认定为非业务行并排除？原因：${reason}`))return;for(const row of rows){row.excludedByUser=true;row.excludeReason=reason;}return flagDuplicates();}
    if (action === 'batch-import-date') {const value=state.host.querySelector?.('[data-batch-import-date]')?.value;if(!reviewModel.validDate(value)) return;for(const row of state.rows) if(state.selectedSheets.has(row.sheetName) && !reviewModel.validDate(row.recordDate)) {row.recordDate=value;row.manualFields=[...new Set([...(row.manualFields || []),'recordDate'])];} return flagDuplicates();}
    if (action === 'balance-review') { state.reviewPage = 0; state.mode = 'balance-review'; return render(); }
    if (action === 'cancel-balance-review') { state.mode = 'ledger'; return render(); }
    if (action === 'previous-review-page') { state.reviewPage = Math.max(0, state.reviewPage-1); return render(); }
    if (action === 'next-review-page') { state.reviewPage++; return render(); }
    if (action === 'cancel-order') { if (state.busy) return; if (JSON.stringify(state.orderRows.map(row=>row.id)) !== state.orderInitial && !confirmLeave()) return; state.mode = 'balance-review'; return render(); }
    if (action === 'save-order') {
      if (state.busy || !state.canRefine) return;
      state.busy = true; state.orderError = ''; render();
      try { await request('PATCH', '/finance-transaction-order', { recordDate: state.orderDate, rows: state.orderRows.map(row => ({ id: row.id, baseVersion: row.version })) }); state.mode = 'balance-review'; await load(); notify('交易顺序已保存，后续余额已重新计算'); }
      catch(error) { state.orderError = error.message; state.busy = false; render(); } return;
    }
    if (action === 'candidate-opening') {
      const candidate = state.balanceReview?.openingCandidate;
      if (!candidate || !state.canSetBalance) return;
      state.openingForm = { startDate: candidate.startDate, amount: (candidate.amountCents/100).toFixed(2), baseVersion: state.balanceReview.openingVersion || 0 };
      state.openingCandidateHint = `由 ${candidate.sourceFileName || '原表'} ${candidate.sourceSheetName || ''} 第 ${candidate.sourceRowNumber || '首'} 行余额倒推，仅供参考，请核对银行或原始账目后确认。首笔原表余额是推算依据，不能作为独立核对证明。`;
      state.openingInitial = JSON.stringify(state.openingForm); state.openingError = ''; state.mode = 'opening'; return render();
    }

    if (action === 'refine-categories') return refineCategories();
    if (action === 'apply-refinement') return applyRefinement();
    if (action === 'cancel-refinement') { if (state.refinementBusy) return; state.refinement = null; state.refinementError = ''; state.mode = 'ledger'; return render(); }
    if (action === 'clear-chart-filters') { state.chartMonth = ''; state.chartCategory = ''; state.chartSelection = null; state.categoryType = ''; state.type = ''; state.ledgerPage = 0; state.selectedIds.clear(); return refreshLedger(); }
    if (action === 'first-ledger-page') { state.ledgerPage = 0; return refreshLedger(); }
    if (action === 'last-ledger-page') { state.ledgerPage = pageRows().pages - 1; return refreshLedger(); }
    if (action === 'clear-search') {
      state.search = ''; state.ledgerPage = 0; state.selectedIds.clear();
      const input = state.host.querySelector?.('[data-field="search"]'); if (input) { input.value = ''; input.focus(); }
      return refreshLedger();
    }
    if (action === 'jump-ledger-page') {
      const input = state.host.querySelector?.('[data-page-jump]'), value = Number(input?.value), pages = pageRows().pages;
      if (!Number.isInteger(value) || value < 1 || value > pages) { const error = state.host.querySelector?.('[data-page-error]'); if (error) error.textContent = `请输入 1 至 ${pages} 的整数页码`; return; }
      state.ledgerPage = value - 1; return refreshLedger();
    }
    if (action === 'set-opening-balance') { state.openingCandidateHint = '';
      if (!state.canSetBalance || state.busy) return;
      try { const { openingBalance: opening } = await request('GET', '/finance-opening-balance');
        state.openingForm = { startDate: opening?.startDate || today(), amount: opening ? (opening.amountCents / 100).toFixed(2) : '', baseVersion: opening?.version || 0 };
        state.openingInitial = JSON.stringify(state.openingForm); state.openingError = ''; state.mode = 'opening'; render();
      } catch (error) { notify(error.message, 'error'); } return;
    }
    if (action === 'cancel-opening') { if (state.busy) return; if (JSON.stringify(state.openingForm) === state.openingInitial || confirmLeave()) { state.openingForm = null; state.mode = 'ledger'; render(); } return; }
    if (action === 'save-opening') return saveOpening();
    if (action === 'previous-ledger-page') { state.ledgerPage--; return refreshLedger(); }
    if (action === 'next-ledger-page') { state.ledgerPage++; return refreshLedger(); }
    if (action === 'dismiss-message') { state.message = ''; return render(); }
    if (action === 'previous-import-page') { state.importPage = Math.max(0, state.importPage - 1); return render(); }
    if (action === 'next-import-page') { state.importPage++; return render(); }
    if (action === 'reload') return load();
    if (action === 'recent-data') { if (state.busy) return; clearNarratives(); state.periodMode = 'recent'; resetDateFilters(); return load(); }
    if (action === 'apply-dates') { if (state.busy) return; clearNarratives(); state.periodMode = 'manual'; state.balanceCutoff = state.endDate; resetDateFilters(); return load(); }
    if (action === 'add') { state.reviewReturn = false; state.form = formFromRecord(); state.formError = ''; state.mode = 'form'; return render(); }
    if (action === 'import') { state.mode = 'import'; return render(); }
    if (action === 'cancel-form') { if (confirmLeave()) { state.mode = state.reviewReturn ? 'balance-review' : 'ledger'; state.form = null; render(); } return; }
    if (action === 'cancel-import') { if (state.importBusy) return; if (!state.workbook || confirmLeave()) { state.mode = 'ledger'; state.workbook = null; state.rows = []; render(); } return; }
    if (action === 'save-form') return saveForm();
    if (action === 'pick-file') return selectWorkbook();
    if (action === 'retry-classification') { if (state.importBusy) return; return classifySelectedSheets(); }
    if (action === 'ai-classify') return classify();
    if (action === 'select-valid') { state.selectedRows = new Set(state.rows.filter(row => rowValid(row)).map(row => row.key)); return render(); }
    if (action === 'clear-rows') { state.selectedRows.clear(); return render(); }
    if (action === 'commit-import') return commitImport();
    if (action === 'narrative' || action === 'deep-narrative') {
      if (state.narrativeBusy || state.busy || state.datesDirty || !state.report?.recordCount) return;
      const depth = action === 'deep-narrative' ? 'deep' : 'brief';
      state.narrativeBusy = true; state.narrativeBusyMode = depth; state.narrativeError = ''; render();
      const period = { startDate: state.report.startDate || state.startDate, endDate: state.report.endDate || state.endDate, analysisDepth: depth };
      const generation = ++narrativeGeneration, activeReport = state.report, revision = reportRevision(), activeHost = state.host;
      try {
        let result = await api.generateFinanceNarrative(period);
        if (generation !== narrativeGeneration || state.report !== activeReport || state.host !== activeHost) return;
        if (result.requiresConfirmation) {
          const estimate = result.estimate || {};
          const message = `本次${depth === 'deep' ? '深度分析' : '简报'}预计使用 ${estimate.estimatedTokens || '较多'} Token${Number.isFinite(estimate.remainingTokens) ? `，剩余 ${estimate.remainingTokens} Token` : ''}，是否继续？`;
          const confirmed = window.communityConfirm ? await window.communityConfirm(message, 'AI 用量提示') : window.confirm(message);
          if (!confirmed || generation !== narrativeGeneration || state.report !== activeReport || state.host !== activeHost) return;
          result = await api.generateFinanceNarrative({ ...period, usageConfirmed: true });
        }
        if (generation === narrativeGeneration && state.report === activeReport && state.host === activeHost) {
          if (!String(result.content || '').trim()) throw new Error('AI 没有返回分析内容，请重试');
          if (depth === 'deep') { state.deepNarrative = result.content; state.deepRevision = revision; }
          else { state.narrative = result.content; state.narrativeRevision = revision; }
        }
      } catch (error) { if (generation === narrativeGeneration && state.report === activeReport && state.host === activeHost) state.narrativeError = `AI 分析未完成：${error.message}。已有报告和本机统计已保留。`; }
      finally { if (generation === narrativeGeneration) { state.narrativeBusy = false; state.narrativeBusyMode = ''; render(); } }
      return;
    }
    if (action === 'export') { try { const result = await api.exportFinanceRecords({ ids: visible().map(row => row.id) }); if (!result.canceled) notify('已导出 Excel'); } catch (error) { notify(error.message, 'error'); } return; }
    if (action === 'batch-delete') { const ids = [...state.selectedIds]; if (!ids.length || !window.confirm(`确定删除选中的 ${ids.length} 条收支记录吗？`)) return;
      try { for (const id of ids) { const row = state.records.find(item => String(item.id) === id); await request('DELETE', `/finance-records/${encodeURIComponent(id)}`, { baseVersion: row.version }); } await load(); notify('所选记录已删除'); }
      catch (error) { await load(); notify(error.message, 'error'); } return; }
  }
  async function click(event) {
    const el = event.target.closest('[data-locate-id], [data-review-edit], [data-order-date], [data-order-move], [data-action], [data-ledger-page], [data-chart-type], [data-preset], [data-edit-id], [data-delete-id], [data-remap-sheet], [data-edit-import]');
    if (!el) return;
    if (el.dataset.ledgerPage) { state.ledgerPage = Number(el.dataset.ledgerPage) - 1; return refreshLedger(); }
    if (el.dataset.chartType) { state.chartType = el.dataset.chartType; return render(); }
    if (el.dataset.editImport) { state.editingKey = state.editingKey === el.dataset.editImport ? '' : el.dataset.editImport; return render(); }
    if (el.dataset.reviewEdit) { if (!state.canRefine) return; state.reviewReturn = true; state.form = formFromRecord(state.records.find(row => String(row.id) === el.dataset.reviewEdit)); state.mode = 'form'; return render(); }
    if (el.dataset.locateId) {
      const row = state.records.find(row => String(row.id) === el.dataset.locateId); if (!row) return;
      clearNarratives(); resetDateFilters(); state.search = ''; state.type = ''; state.periodMode = 'manual'; state.startDate = state.endDate = row.recordDate || row.date; state.balanceCutoff = state.endDate; state.mode = 'ledger'; await load();
      const index = visible().findIndex(item => String(item.id) === String(row.id)); state.ledgerPage = Math.max(0, Math.floor(index/state.pageSize)); refreshLedger();
      const node = state.host.querySelector?.(`[data-ledger-row="${CSS.escape(String(row.id))}"]`); node?.classList.add('fin-row-highlight'); node?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
    }
    if (el.dataset.orderDate) { if (!state.canRefine) return; if (state.mode === 'form' && !confirmLeave()) return;
      state.orderDate = el.dataset.orderDate; state.orderRows = state.records.filter(row => (row.recordDate || row.date) === state.orderDate && defaultPeriod.latestMonth([row], today())).sort((a,b) => (a.dayPosition || 0) - (b.dayPosition || 0));
      state.orderInitial = JSON.stringify(state.orderRows.map(row=>row.id)); state.orderError = ''; state.mode = 'order'; return render(); }
    if (el.dataset.orderMove !== undefined) { if (state.busy) return; const index = Number(el.dataset.orderMove), next = index + Number(el.dataset.direction); if (state.orderRows[next]) { [state.orderRows[index],state.orderRows[next]] = [state.orderRows[next],state.orderRows[index]]; render(); } return; }
    if (el.dataset.preset) { if (state.busy) return; clearNarratives(); state.periodMode = 'manual'; setPreset(el.dataset.preset); state.balanceCutoff = state.endDate; resetDateFilters(); return load(); }
    if (el.dataset.editId) { state.reviewReturn = false; state.form = formFromRecord(state.records.find(row => String(row.id) === el.dataset.editId)); state.mode = 'form'; return render(); }
    if (el.dataset.deleteId) { const row = state.records.find(item => String(item.id) === el.dataset.deleteId); if (!window.confirm('确定删除这条收支记录吗？')) return;
      try { await request('DELETE', `/finance-records/${encodeURIComponent(row.id)}`, { baseVersion: row.version }); await load(); notify('记录已删除'); } catch (error) { notify(error.message, 'error'); } return; }
    if (el.dataset.remapSheet) {
      const sheetName = el.dataset.remapSheet;
      const headerRowNumber = Number(state.host.querySelector(`[data-header-row="${CSS.escape(sheetName)}"]`)?.value);
      const mapping = Object.fromEntries([...state.host.querySelectorAll('[data-map-sheet]')].filter(node => node.dataset.mapSheet === sheetName).map(node => [node.dataset.mapField, node.value === '' ? null : Number(node.value)]));
      try { const sheet = await api.remapFinanceSheet({ previewId: state.workbook.previewId, sheetName, headerRowNumber, mapping, year: state.host.querySelector(`[data-map-year=\"${CSS.escape(sheetName)}\"]`)?.value });
        state.sheets = state.sheets.map(item => item.sheetName === sheetName ? sheet : item); rebuildRows(new Set([sheetName])); flagDuplicates(); }
      catch (error) { state.importError = error.message; render(); }
      return;
    }
    if (el.dataset.action) return onAction(el.dataset.action, el);
  }
  function change(event) {
    const el = event.target;
    if (state.importBusy && (el.dataset.sheet || el.dataset.action==='all-sheets')) return render();
    if (el.dataset.action === 'all-sheets') { state.selectedSheets = new Set(el.checked ? state.sheets.map(s => s.sheetName) : []); rebuildRows(); return classifySelectedSheets(); }
    if (el.dataset.action === 'select-all-records') { for (const row of pageRows().items) el.checked ? state.selectedIds.add(String(row.id)) : state.selectedIds.delete(String(row.id)); return refreshLedger(); }
    if (el.dataset.sheet) { el.checked ? state.selectedSheets.add(el.dataset.sheet) : state.selectedSheets.delete(el.dataset.sheet); rebuildRows(); return classifySelectedSheets(); }
    if (el.dataset.recordId) { el.checked ? state.selectedIds.add(el.dataset.recordId) : state.selectedIds.delete(el.dataset.recordId); return refreshLedger(); }
    if (el.dataset.duplicateDecision) {const row=state.rows.find(item=>item.key===el.dataset.duplicateDecision);if(row) row.duplicateDecision=el.value;return flagDuplicates();}
    if (el.dataset.totalReason) { state.totalAcknowledgements[el.dataset.totalReason] = el.value; return render(); }
    if (el.dataset.excludeReason) { const row=state.rows.find(item=>item.key===el.dataset.excludeReason); if(row) row.excludeReason=el.value; return flagDuplicates(); }
    if (el.dataset.importKey) { const row = state.rows.find(item => item.key === el.dataset.importKey); if (row) row.excludedByUser = !el.checked; return flagDuplicates(); }
    if (el.dataset.allowDuplicate) { const row = state.rows.find(item => item.key === el.dataset.allowDuplicate); row.allowDuplicate = el.checked; if (!el.checked) state.selectedRows.delete(row.key); return render(); }
    if (el.dataset.rowKey) { const row = state.rows.find(item => item.key === el.dataset.rowKey); if (!row) return;
      row.manualFields = [...new Set([...(row.manualFields || []), el.dataset.rowField === 'amount' ? 'amountCents' : el.dataset.rowField])];
      if (el.dataset.rowField === 'amount') row.amountCents = reviewModel.parseMoney(el.value);
      else row[el.dataset.rowField] = el.value;
      if (el.dataset.rowField === 'category') row.categorySource = 'manual';
      if (el.dataset.rowField === 'recordType') { row.category = categories[row.recordType]?.includes(row.category) ? row.category : (row.recordType === 'income' ? '其他收入' : '其他支出'); row.categorySource = 'manual'; }
      flagDuplicates(); return; }
    if (el.dataset.form) { state.form[el.dataset.form] = el.value; if (el.dataset.form === 'recordType') { state.form.category = categories[el.value][0]; render(); } return; }
    if (el.dataset.field === 'chartMode') { state.chartMode = ['auto','summary','detail'].includes(el.value) ? el.value : 'auto'; return render(); }
    if (el.dataset.field === 'pageSize') { state.pageSize = [20, 50, 100].includes(Number(el.value)) ? Number(el.value) : 20; state.ledgerPage = 0; return refreshLedger(); }
    if (el.dataset.field) { if (['startDate','endDate'].includes(el.dataset.field)) { state.datesDirty = true; clearNarrativeDisplay(); refreshNarrativePanel(); } state[el.dataset.field] = el.value; if (el.dataset.field === 'type') { if (state.categoryType !== el.value) { state.chartCategory = ''; state.chartSelection = null; } state.ledgerPage = 0; state.selectedIds.clear(); refreshLedger(); } }
  }
  window.CommunityFinanceWorkspace = { async mount(host) { state.host = host; state.datesDirty = false; clearNarratives(); state.reviewReturn = false; state.periodMode = 'recent'; state.report = null; state.latestDate = ''; state.loadError = ''; state.narrative = ''; state.deepNarrative = ''; state.narrativeRevision = ''; state.deepRevision = ''; state.narrativeError = ''; state.chartSelection = null; state.chartCategory = ''; state.chartMonth = ''; state.type = ''; state.search = ''; state.balanceCutoff = today(); setPreset('month');
    try { const status = await api.getLocalAuthStatus?.(); state.canRefine = status?.authenticated === true && (status.account?.role !== 'member' || status.account?.permissions?.finance?.includes('view') && status.account?.permissions?.finance?.includes('update')); state.canSetBalance = status?.authenticated === true && ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(status.account?.role); } catch { state.canSetBalance = false; state.canRefine = false; } host.addEventListener('click', click); host.addEventListener('change', change);
    host.addEventListener('toggle', event => { if (event.target.hasAttribute('data-import-details')) state.detailsOpen = event.target.open; }, true);
    host.addEventListener('compositionstart', event => { if (event.target.dataset.field === 'search') composing = true; });
    host.addEventListener('compositionend', event => {
      if (event.target.dataset.field !== 'search') return;
      composing = false; state.search = event.target.value; state.ledgerPage = 0; state.selectedIds.clear();
      // Keep the search input in place even when a background update completed.
      if (pendingRender) {
        pendingRender = false;
        const input = event.target, position = input.selectionStart;
        render();
        const replacement = host.querySelector?.('[data-field="search"]'); replacement?.focus(); replacement?.setSelectionRange(position, position);
      } else refreshLedger();
    });
    host.addEventListener('input', event => { if (event.target.dataset.field === 'search') {
      if (composing || event.isComposing) return;
      state.search = event.target.value; state.ledgerPage = 0; state.selectedIds.clear(); refreshLedger(); }
      else if (['startDate','endDate'].includes(event.target.dataset.field)) { state[event.target.dataset.field] = event.target.value; state.datesDirty = true; clearNarrativeDisplay(); refreshNarrativePanel(); }
      else if (event.target.dataset.opening) state.openingForm[event.target.dataset.opening] = event.target.value;
      else if (event.target.dataset.form) state.form[event.target.dataset.form] = event.target.value;
      else if (event.target.dataset.rowKey) { const row = state.rows.find(item => item.key === event.target.dataset.rowKey); if (row) row[event.target.dataset.rowField] = event.target.value; } });
    host.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.hasAttribute?.('data-page-jump')) { event.preventDefault(); onAction('jump-ledger-page'); } });
    await load(); } };
}());
