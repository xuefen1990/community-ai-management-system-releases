'use strict';

(function contractFeeLedgerUi(root) {
  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const state = { host: null, context: null, mode: 'overview', year: '', draft: null, expected: null, groupId: '', query: '', page: 1, pageSize: 20, selected: new Set(), showRemoved: false, wizardSource: 'excel', importPreview: null, preparedImport: null };
  const allocationLabels = { population: '按人口', acreage: '按亩数', custom: '按自定义依据', fixed: '逐户固定金额' };
  const operatorLabels = { add: '加', subtract: '减', multiply: '乘', divide: '除' };
  const model = () => state.context.model;
  const money = (cents) => `¥${model().centsToYuan(Number(cents || 0))}`;
  const identifier = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function plans() {
    return (state.context.database.contractFeeDistributionPlans || []).map((raw) => {
      try { return model().normalizeContractFeeDistributionPlan(raw, { id: raw.id }); } catch (_error) { return raw; }
    });
  }
  function batches() { return state.context.database.contractFeeDistributionBatches || []; }
  function selectedYear() {
    if (state.year) return state.year;
    const available = plans().map((plan) => text(plan.year)).filter(Boolean).sort().reverse();
    return available[0] || String(new Date().getFullYear());
  }
  function calculateGroup(group) {
    try { return model().recalculateContractFeeBatchGroup({ ...structuredClone(group), tailRecipientItemId: text(group.tailRecipientItemId) }); }
    catch (error) { return { ...structuredClone(group), calculationError: error.message, referenceUnitPriceCents: 0, basisTotal: 0, baseAmountTotalCents: 0, tailDifferenceCents: Number(group.allocatedAmountCents || 0), unallocatedCents: Number(group.allocatedAmountCents || 0) }; }
  }
  function calculationUnit(group) {
    if (group.allocationType === 'acreage') return '元/亩';
    if (group.allocationType === 'population') return '元/人';
    const field = (group.fieldDefinitions || []).find((item) => item.id === group.basisFieldId);
    return field ? `元/${field.label}` : '元/单位';
  }
  function projectStatus(plan) {
    const related = batches().filter((batch) => batch.planId === plan.id);
    if (related.some((batch) => batch.status === 'completed')) return { label: '已完成', css: 'done' };
    if (related.length) return { label: '办理中', css: 'working' };
    return { label: '待核对', css: 'pending' };
  }

  function overviewHtml() {
    const year = selectedYear(); const current = plans().filter((plan) => text(plan.year) === year);
    const calculated = current.flatMap((plan) => (plan.groups || []).map((group) => ({ plan, group: calculateGroup(group) })));
    const totalCents = calculated.reduce((sum, entry) => sum + Number(entry.group.allocatedAmountCents || 0), 0);
    const assignedCents = calculated.reduce((sum, entry) => sum + Number(entry.group.allocatedAmountCents || 0) - Math.max(0, Number(entry.group.unallocatedCents || 0)), 0);
    const tailCents = calculated.reduce((sum, entry) => sum + Math.max(0, Number(entry.group.unallocatedCents || 0)), 0);
    const groups = new Map();
    calculated.forEach((entry) => { const key = text(entry.group.groupName) || '未分组'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); });
    const years = [...new Set([year, String(new Date().getFullYear()), ...plans().map((plan) => text(plan.year)).filter(Boolean)])].sort().reverse();
    const groupSections = [...groups].map(([groupName, entries]) => `<section class="cfl-group-section"><header><div><span class="cfl-group-mark">${escapeHtml(groupName.slice(0, 1))}</span><div><h3>${escapeHtml(groupName)}</h3><p>${entries.length} 个独立承包项目</p></div></div><strong>${money(entries.reduce((sum, entry) => sum + Number(entry.group.allocatedAmountCents || 0), 0))}</strong></header><div class="cfl-project-grid">${entries.map(({ plan, group }) => projectCard(plan, group)).join('')}</div></section>`).join('');
    return `<div class="cfl-overview">
      <div class="cfl-titlebar"><div><p class="cfl-eyebrow">承包费项目台账</p><h2>先定各组总额，再按户计算到分</h2><p>每个地块、鱼塘或其他承包项目分别建账；同一组的不同项目不会混在一起。</p></div><div class="cfl-title-actions"><label>年度<select data-cfl-change="year">${years.map((item) => `<option${item === year ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label><button class="btn btn-primary" data-cfl-action="open-wizard">＋ 新建承包项目</button></div></div>
      <div class="cfl-summary"><article><span>本年度承包费</span><strong>${money(totalCents)}</strong><small>${current.length} 个项目</small></article><article><span>已分配到户</span><strong>${money(assignedCents)}</strong><small>含已指定尾差</small></article><article class="${tailCents ? 'attention' : ''}"><span>尚待人工补入</span><strong>${money(tailCents)}</strong><small>${calculated.filter((entry) => Number(entry.group.unallocatedCents || 0) > 0).length} 个组待处理</small></article><article><span>待完成项目</span><strong>${current.filter((plan) => projectStatus(plan).label !== '已完成').length}</strong><small>通常每项目每年一次</small></article><article><span>涉及组别</span><strong>${groups.size}</strong><small>按组查看项目</small></article></div>
      <div class="cfl-viewbar"><div><button class="active">按组看项目</button><button data-cfl-action="show-year-summary">年度汇总</button><button data-cfl-action="show-history">历史年度</button></div><span>点击项目卡可进入全屏编辑</span></div>
      ${groupSections || `<div class="cfl-empty"><strong>${escapeHtml(year)} 年还没有承包项目</strong><p>建立项目后，可以上传 Excel 基础台账，也可以从空白表开始。</p><button class="btn btn-primary" data-cfl-action="open-wizard">＋ 建立第一个承包项目</button></div>`}
    </div>`;
  }

  function projectCard(plan, group) {
    const status = projectStatus(plan); const active = (group.items || []).filter((item) => item.active !== false);
    const tail = Math.max(0, Number(group.unallocatedCents ?? group.tailDifferenceCents ?? 0));
    return `<button class="cfl-project-card" data-cfl-action="open-project" data-plan-id="${escapeHtml(plan.id)}" data-group-id="${escapeHtml(group.id)}">
      <span class="cfl-project-status ${status.css}">${status.label}</span><div class="cfl-project-name"><span>项目</span><strong>${escapeHtml(plan.projectName || plan.parcelName)}</strong></div>
      <dl><div><dt>本组固定总额</dt><dd>${money(group.allocatedAmountCents)}</dd></div><div><dt>计算方式</dt><dd>${allocationLabels[group.allocationType] || '自定义'}</dd></div><div><dt>计发依据</dt><dd>${Number(group.basisTotal || 0).toFixed(group.allocationType === 'population' ? 0 : 2)}</dd></div><div><dt>参考单价</dt><dd>${money(group.referenceUnitPriceCents)} <small>${calculationUnit(group)}</small></dd></div></dl>
      <div class="cfl-project-foot"><span>${active.length} 户</span><span class="${tail ? 'tail' : ''}">${tail ? `尾差 ${money(tail)} 待补入` : '金额已平账'}</span><b>进入办理 →</b></div>
    </button>`;
  }

  function wizardHtml() {
    const currentYear = selectedYear();
    const useExcel = state.wizardSource !== 'blank';
    const prepared = state.preparedImport;
    const sourceChooser = prepared
      ? `<div class="cfl-callout"><strong>AI 已带入：${escapeHtml(prepared.fileName || '承包费 Excel')}</strong><span>无需再次上传。填写项目信息后，下一步直接核对原表字段和明细。</span></div>`
      : `<div class="cfl-wizard-step"><span>1</span><div><h3>选择建立方式</h3><p>已有基础台账时，建议直接上传 Excel，原表字段和顺序会保留下来。</p></div></div><div class="cfl-source-choice" role="radiogroup" aria-label="项目建立方式"><button class="${useExcel ? 'active' : ''}" data-cfl-action="select-wizard-source" data-source="excel" role="radio" aria-checked="${useExcel ? 'true' : 'false'}"><span class="cfl-source-icon">表</span><span><strong>上传 Excel 建立 <em>推荐</em></strong><small>保留户主、收款人、银行卡、人口、亩数和原表字段</small></span><b>${useExcel ? '已选择' : '选择'}</b></button><button class="${useExcel ? '' : 'active'}" data-cfl-action="select-wizard-source" data-source="blank" role="radio" aria-checked="${useExcel ? 'false' : 'true'}"><span class="cfl-source-icon">＋</span><span><strong>空白建立</strong><small>先建立项目，再手工添加家庭和需要的字段</small></span><b>${useExcel ? '选择' : '已选择'}</b></button></div>`;
    return `<div class="cfl-fullscreen cfl-wizard-page"><header class="cfl-editor-head"><button class="cfl-back" data-cfl-action="back-overview">← 返回承包费台账</button><div><p class="cfl-eyebrow">建立年度项目</p><h2>新建承包项目</h2><p>一个入口完成建账；可以上传 Excel，也可以从空白表开始。</p></div></header><main class="cfl-wizard"><section>${sourceChooser}<div class="cfl-wizard-divider"></div><div class="cfl-wizard-step"><span>${prepared ? '1' : '2'}</span><div><h3>填写项目基本信息</h3><p>大枣园、鱼塘等分别建账；同一项目可以包含多个组。</p></div></div><div class="cfl-form-grid"><label>年度<input id="cfl-wizard-year" value="${escapeHtml(currentYear)}" inputmode="numeric"></label><label>项目名称<input id="cfl-wizard-name" placeholder="例如：大枣园承包费"></label><label>组别<input id="cfl-wizard-group" placeholder="例如：一组"></label><label>本组必须发满的总额${useExcel ? '（可由 Excel 带入）' : ''}<input id="cfl-wizard-total" placeholder="例如：20000.00" inputmode="decimal"></label><label>计算方式<select id="cfl-wizard-type"><option value="population">按人口</option><option value="acreage">按实际亩数</option><option value="custom">按自定义计算字段</option><option value="fixed">逐户固定金额</option></select></label></div><div class="cfl-callout"><strong>每个项目单独上传、单独建立</strong><span>相同收款人或银行卡号仍保留为两户、两条发放记录；上传后可继续增加、删除、改名和批量填写字段。</span></div><div class="cfl-wizard-actions"><button class="btn btn-outline" data-cfl-action="back-overview">取消</button><button class="btn btn-primary" data-cfl-action="create-project" data-import="${useExcel ? 'true' : 'false'}">${prepared ? '下一步：核对 Excel' : useExcel ? '下一步：选择 Excel' : '建立并进入编辑'}</button></div></section></main></div>`;
  }

  function currentGroup() { return state.draft?.groups?.find((group) => group.id === state.groupId) || state.draft?.groups?.[0]; }
  function groupRows(group) {
    const needle = text(state.query).toLowerCase();
    return (group.items || []).filter((item) => state.showRemoved || item.active !== false).filter((item) => !needle || [item.householderName, item.recipientName, item.bankCard, item.notes, ...Object.values(item.customData || {})].some((value) => text(value).toLowerCase().includes(needle)));
  }
  function mappingColumns(row = []) {
    const used = new Map();
    return row.map((value, index) => {
      const base = text(value) || `未命名列${index + 1}`; const count = (used.get(base) || 0) + 1; used.set(base, count);
      return count === 1 ? base : `${base}（${count}）`;
    });
  }
  function mappingDialogHtml() {
    const preview = state.importPreview; const parser = root.ContractFeeExcelParser;
    if (!preview || !parser) return '';
    if (preview.requiresSheetSelection) {
      const available = (preview.sheets || []).filter((sheet) => !sheet.error);
      const selectedName = text(preview.selectedSheetName) || available.at(-1)?.sheetName || '';
      return `<div class="cfl-mapping-layer"><section class="cfl-mapping-dialog cfl-sheet-dialog"><header><div><p class="cfl-eyebrow">多年度 Excel</p><h3>选择需要导入的工作表</h3><p>这份文件包含多个工作表，系统不会再自动读取第一张。</p></div><button data-cfl-action="cancel-mapping" aria-label="关闭">×</button></header><div class="cfl-mapping-content"><label class="cfl-header-row">本次导入<select id="cfl-import-sheet">${available.map((sheet) => `<option value="${escapeHtml(sheet.sheetName)}"${sheet.sheetName === selectedName ? ' selected' : ''}>${escapeHtml(sheet.sheetName)} · ${Number(sheet.total || 0)} 户</option>`).join('')}</select></label>${(preview.sheets || []).filter((sheet) => sheet.error).map((sheet) => `<p class="cfl-error">${escapeHtml(sheet.sheetName)}：${escapeHtml(sheet.error)}</p>`).join('')}<div class="cfl-mapping-note">选择后再核对原表字段、核定总数和本组固定总额。</div></div><footer><button class="btn btn-outline" data-cfl-action="cancel-mapping">取消</button><button class="btn btn-primary" data-cfl-action="confirm-sheet-selection">读取这个工作表</button></footer></section></div>`;
    }
    if (preview.confirmationReady) {
      const group = currentGroup(); const isAcreage = group.allocationType === 'acreage';
      const basisKey = isAcreage ? 'acreage' : group.allocationType === 'population' ? 'population' : '';
      const rowBasisTotal = basisKey ? (preview.rows || []).reduce((sum, row) => sum + Number(row[basisKey] || 0), 0) : 0;
      const expectedBasis = preview.controlTotals?.[basisKey] ?? rowBasisTotal;
      const sourceAmount = preview.controlTotals?.amount;
      const totalAmount = sourceAmount ?? (Number(group.allocatedAmountCents || 0) / 100);
      const sourceHeaders = (preview.outputColumns || []).map((column) => column.header).join('、');
      const basisLabel = isAcreage ? '核定总亩数' : group.allocationType === 'population' ? '核定总人口' : '核定计发依据总数';
      return `<div class="cfl-mapping-layer"><section class="cfl-mapping-dialog cfl-import-confirm-dialog"><header><div><p class="cfl-eyebrow">导入前核对</p><h3>确认控制数和来源字段</h3><p>${escapeHtml(preview.sheetName || '')} · 识别 ${Number(preview.total || 0)} 户</p></div><button data-cfl-action="cancel-mapping" aria-label="关闭">×</button></header><div class="cfl-mapping-content"><div class="cfl-import-summary"><label>${basisLabel}<input id="cfl-import-expected-basis" value="${escapeHtml(expectedBasis || '')}" inputmode="decimal"></label><label>明细合计<input value="${escapeHtml(rowBasisTotal)}" readonly></label><label>本组固定总额<input id="cfl-import-total" value="${escapeHtml(totalAmount || '')}" inputmode="decimal"></label><label>来源单价<input value="${escapeHtml(preview.controlTotals?.unitPrice ?? '')}" readonly></label></div><div class="cfl-source-fields"><strong>来源字段</strong><p>${escapeHtml(sourceHeaders || '未识别')}</p><small>编辑页可以显示更多核对字段；打印预览和导出将按这些原表字段及顺序生成。</small></div></div><footer><button class="btn btn-outline" data-cfl-action="cancel-mapping">取消</button><button class="btn btn-primary" data-cfl-action="confirm-import">确认并导入</button></footer></section></div>`;
    }
    const headerRowNumber = Math.max(1, Math.min((preview.rawGrid || []).length, Number(preview.mappingHeaderRow || preview.headerRowNumber || 1)));
    const columns = mappingColumns(preview.rawGrid?.[headerRowNumber - 1] || []);
    const options = (fieldKey) => `<option value="">不对应</option>${columns.map((label, index) => `<option value="${index}"${parser.inferredField(label) === fieldKey ? ' selected' : ''}>第 ${index + 1} 列 · ${escapeHtml(label)}</option>`).join('')}`;
    const fields = parser.FIELDS.filter((field) => !['sequence', 'signature'].includes(field.key));
    const sample = (preview.rawGrid || []).slice(headerRowNumber - 1, headerRowNumber + 4);
    return `<div class="cfl-mapping-layer"><section class="cfl-mapping-dialog"><header><div><p class="cfl-eyebrow">Excel 字段对应</p><h3>请告诉系统每一列是什么</h3><p>只需对应这一次，未对应的原表列仍会完整保留，进入编辑页后可改名或参与计算。</p></div><button data-cfl-action="cancel-mapping" aria-label="关闭">×</button></header><div class="cfl-mapping-content"><label class="cfl-header-row">表头在第几行<input type="number" min="1" max="${Math.max(1, (preview.rawGrid || []).length)}" value="${headerRowNumber}" data-cfl-change="mapping-header"></label><div class="cfl-mapping-fields">${fields.map((field) => `<label>${escapeHtml(field.key === 'name' ? '姓名（户主和收款人相同时）' : field.label)}<select data-cfl-map-field="${escapeHtml(field.key)}">${options(field.key)}</select></label>`).join('')}</div><div class="cfl-mapping-note">户主姓名、收款人或“姓名”至少对应一项。人口、亩数、银行卡等没有的列可以保持“不对应”。</div><div class="cfl-mapping-sample"><strong>原表预览</strong><div><table><tbody>${sample.map((row, rowIndex) => `<tr class="${rowIndex === 0 ? 'header' : ''}">${columns.map((_column, columnIndex) => `<td>${escapeHtml(row?.[columnIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div><footer><button class="btn btn-outline" data-cfl-action="cancel-mapping">取消</button><button class="btn btn-primary" data-cfl-action="confirm-mapping">确认对应并导入</button></footer></section></div>`;
  }
  function editorHtml() {
    const group = calculateGroup(currentGroup());
    const groupIndex = state.draft.groups.findIndex((entry) => entry.id === group.id); state.draft.groups[groupIndex] = group;
    const rows = groupRows(group); const pages = Math.max(1, Math.ceil(rows.length / state.pageSize)); state.page = Math.min(Math.max(1, state.page), pages);
    const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const visibleFields = (group.fieldDefinitions || []).filter((field) => field.visibleInEditor !== false && field.type !== 'calculated');
    const basisField = (group.fieldDefinitions || []).find((field) => field.id === group.basisFieldId);
    const activeCount = (group.items || []).filter((item) => item.active !== false).length;
    const finalCents = (group.items || []).filter((item) => item.active !== false).reduce((sum, item) => sum + Number(item.finalAmountCents || 0), 0);
    const basisDecimals = group.allocationType === 'population' ? 0 : 2;
    const expectedBasis = group.expectedBasisTotal ?? group.actualBasisTotal ?? group.basisTotal ?? 0;
    const basisDifference = Number(group.basisDifference || 0);
    const expectedBasisLabel = group.allocationType === 'acreage' ? '核定总亩数' : group.allocationType === 'population' ? '核定总人口' : '核定依据总数';
    return `<div class="cfl-fullscreen cfl-editor" data-plan-id="${escapeHtml(state.draft.id)}"><header class="cfl-editor-head"><button class="cfl-back" data-cfl-action="back-overview">← 返回项目总览</button><div><p class="cfl-eyebrow">${escapeHtml(state.draft.year)} 年承包项目</p><h2>${escapeHtml(state.draft.projectName)}</h2><p>一户一行 · 户主、收款人和银行卡分别保存</p></div><div class="cfl-editor-head-actions"><span class="cfl-unsaved">编辑中</span><button class="btn btn-outline" data-cfl-action="save-project">保存台账</button></div></header>
      <div class="cfl-group-tabs">${state.draft.groups.map((entry) => `<button class="${entry.id === group.id ? 'active' : ''}" data-cfl-action="switch-group" data-group-id="${escapeHtml(entry.id)}">${escapeHtml(entry.groupName)}<small>${money(entry.allocatedAmountCents)}</small></button>`).join('')}<button class="add" data-cfl-action="add-group">＋ 增加组别</button></div>
      <div class="cfl-metrics"><label><span>本组必须发满</span><input data-cfl-group-field="allocatedAmount" value="${model().centsToYuan(group.allocatedAmountCents)}" inputmode="decimal"></label><label><span>计算依据</span><select data-cfl-group-field="basisFieldId">${(group.fieldDefinitions || []).filter((field) => field.type !== 'text').map((field) => `<option value="${escapeHtml(field.id)}"${field.id === group.basisFieldId ? ' selected' : ''}>${escapeHtml(field.label)}</option>`).join('')}</select></label><label><span>${expectedBasisLabel}</span><input data-cfl-group-field="expectedBasisTotal" value="${Number(expectedBasis || 0).toFixed(basisDecimals)}" inputmode="decimal"></label><div><span>明细合计</span><strong>${Number(group.actualBasisTotal ?? group.basisTotal ?? 0).toFixed(basisDecimals)}</strong></div><div class="${basisDifference ? 'attention' : ''}"><span>差额</span><strong>${Math.abs(basisDifference).toFixed(basisDecimals)}</strong></div><div><span>参考单价</span><strong>${money(group.referenceUnitPriceCents)}</strong><small>${calculationUnit(group)}</small></div><div class="${group.unallocatedCents ? 'attention' : ''}"><span>尚待人工补入</span><strong>${money(group.unallocatedCents)}</strong></div></div>
      ${group.calculationError ? `<div class="cfl-error">${escapeHtml(group.calculationError)}</div>` : basisDifference ? `<div class="cfl-error">${escapeHtml(expectedBasisLabel)}与家庭明细合计相差 ${Math.abs(basisDifference).toFixed(basisDecimals)}，请先核对面积或人口。</div>` : ''}
      <div class="cfl-editor-body"><main class="cfl-table-pane"><div class="cfl-table-tools"><div><input data-cfl-input="query" value="${escapeHtml(state.query)}" placeholder="搜索户主、收款人、卡号或备注"><button data-cfl-action="search">查询</button></div><div><label><input type="checkbox" data-cfl-change="show-removed"${state.showRemoved ? ' checked' : ''}> 显示已移出家庭</label><button data-cfl-action="add-household">＋ 添加家庭</button></div></div><div class="cfl-household-table-wrap"><table class="cfl-household-table"><thead><tr><th class="select"><input type="checkbox" data-cfl-action="select-page"></th><th>序号</th><th>户主</th><th>收款人</th>${visibleFields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}<th>基础金额</th><th>尾差</th><th>最终金额</th><th>完整银行卡号</th><th>备注</th><th>操作</th></tr></thead><tbody>${pageRows.map((item, index) => householdRow(group, item, visibleFields, (state.page - 1) * state.pageSize + index + 1)).join('') || '<tr><td colspan="20"><div class="cfl-table-empty">当前没有家庭。可以添加家庭或重新导入项目表。</div></td></tr>'}</tbody></table></div><div class="cfl-pagination"><span>共 ${rows.length} 户，显示第 ${rows.length ? (state.page - 1) * state.pageSize + 1 : 0} 至 ${Math.min(rows.length, state.page * state.pageSize)} 户</span><label>每页<select data-cfl-change="page-size">${[20, 50, 100].map((size) => `<option value="${size}"${size === state.pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select>户</label><button data-cfl-action="page" data-page="${state.page - 1}"${state.page <= 1 ? ' disabled' : ''}>上一页</button><strong>${state.page} / ${pages}</strong><button data-cfl-action="page" data-page="${state.page + 1}"${state.page >= pages ? ' disabled' : ''}>下一页</button></div></main>${sidebarHtml(group, basisField)}</div>
      <footer class="cfl-editor-footer"><div><span>本项目合计</span><strong>${money(state.draft.groups.reduce((sum, entry) => sum + Number(entry.allocatedAmountCents || 0), 0))}</strong><span>${activeCount} 户</span><span>本组已分配 ${money(finalCents)}</span><b class="${group.unallocatedCents || basisDifference ? 'warn' : 'ok'}">${basisDifference ? `依据差 ${Math.abs(basisDifference).toFixed(basisDecimals)}` : group.unallocatedCents ? `金额差 ${money(group.unallocatedCents)}` : '本组已平账'}</b></div><div><button class="btn btn-outline" data-cfl-action="export-project">${group.outputTemplateSnapshot?.columns?.length ? '按原表字段导出' : '导出表格'}</button><button class="btn btn-outline" data-cfl-action="save-project">保存台账</button><button class="btn btn-primary" data-cfl-action="create-batch"${group.calculationError || state.draft.groups.some((entry) => { const calculated = calculateGroup(entry); return Number(calculated.unallocatedCents || 0) !== 0 || Math.abs(Number(calculated.basisDifference || 0)) > 0.0000001; }) ? ' disabled' : ''}>核对并生成发放表</button></div></footer>${mappingDialogHtml()}</div>`;
  }

  function householdRow(group, item, fields, sequence) {
    return `<tr class="${item.active === false ? 'removed' : ''}" data-item-id="${escapeHtml(item.id)}"><td class="select"><input type="checkbox" data-cfl-select-item="${escapeHtml(item.id)}"${state.selected.has(item.id) ? ' checked' : ''}></td><td>${sequence}</td><td><input data-cfl-item-field="householderName" value="${escapeHtml(item.householderName)}"></td><td><input data-cfl-item-field="recipientName" value="${escapeHtml(item.recipientName)}"></td>${fields.map((field) => `<td><input data-cfl-item-field="${escapeHtml(field.sourceKey || `custom:${field.id}`)}" value="${escapeHtml(field.sourceKey ? item[field.sourceKey] : item.customData?.[field.id])}"${field.type === 'number' ? ' inputmode="decimal"' : ''}></td>`).join('')}<td class="money">${money(item.baseAmountCents)}</td><td class="money tail">${Number(item.tailAmountCents || 0) ? `+${money(item.tailAmountCents)}` : '—'}</td><td class="money final">${money(item.finalAmountCents)}</td><td><input class="bank" data-cfl-item-field="bankCard" value="${escapeHtml(item.bankCard)}"></td><td><input data-cfl-item-field="notes" value="${escapeHtml(item.notes)}"></td><td>${item.active === false ? `<button data-cfl-action="restore-household" data-item-id="${escapeHtml(item.id)}">恢复</button>` : `<button data-cfl-action="remove-household" data-item-id="${escapeHtml(item.id)}">移出</button>`}</td></tr>`;
  }

  function sidebarHtml(group, basisField) {
    const numericFields = (group.fieldDefinitions || []).filter((field) => field.type !== 'text');
    const activeItems = (group.items || []).filter((item) => item.active !== false);
    return `<aside class="cfl-sidebar"><details open><summary>批量填写</summary><div class="cfl-side-content"><label>要填写的字段<select id="cfl-bulk-field">${(group.fieldDefinitions || []).filter((field) => field.type !== 'calculated').map((field) => `<option value="${escapeHtml(field.sourceKey || `custom:${field.id}`)}">${escapeHtml(field.label)}</option>`).join('')}<option value="bankCard">银行卡号</option><option value="notes">备注</option></select></label><label>统一填写为<input id="cfl-bulk-value" placeholder="输入内容或数字"></label><label>填写范围<select id="cfl-bulk-target"><option value="selected">已勾选家庭</option><option value="filtered">当前搜索结果</option><option value="all">全部启用家庭</option></select></label><button class="btn btn-outline" data-cfl-action="bulk-fill">应用批量填写</button><small>批量填写只改当前项目，不会修改居民档案。</small></div></details>
      <details open><summary>字段与计算规则</summary><div class="cfl-side-content"><div class="cfl-field-list">${(group.fieldDefinitions || []).map((field) => `<div><span><b>${escapeHtml(field.label)}</b><small>${field.type === 'calculated' ? '计算字段' : field.type === 'number' ? '数字字段' : '文字字段'}${field.id === group.basisFieldId ? ' · 当前依据' : ''}</small></span><button data-cfl-action="rename-field" data-field-id="${escapeHtml(field.id)}">改名</button>${field.builtIn ? '' : `<button data-cfl-action="remove-field" data-field-id="${escapeHtml(field.id)}">删除</button>`}</div>`).join('')}</div><label>新增字段名称<input id="cfl-new-field-label" placeholder="例如：不计发人口"></label><label>字段类型<select id="cfl-new-field-type"><option value="number">数字字段</option><option value="text">文字字段</option></select></label><button class="btn btn-outline" data-cfl-action="add-field">＋ 新增字段</button><hr><strong>新增计算字段</strong><label>名称<input id="cfl-formula-label" placeholder="例如：计发人口"></label><div class="cfl-formula-row"><select id="cfl-formula-left">${numericFields.map((field) => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)}</option>`).join('')}</select><select id="cfl-formula-operator">${Object.entries(operatorLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><select id="cfl-formula-right">${numericFields.map((field) => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)}</option>`).join('')}</select></div><button class="btn btn-outline" data-cfl-action="add-formula">建立中文计算字段</button></div></details>
      <details open><summary>尾差补入</summary><div class="cfl-side-content cfl-tail-box"><p>参考单价向下保留到分后，剩余 <strong>${money(group.tailDifferenceCents)}</strong>。</p><label>全部补入哪一户<select id="cfl-tail-recipient"><option value="">请选择家庭</option>${activeItems.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === group.tailRecipientItemId ? ' selected' : ''}>${escapeHtml(item.householderName)}户 · ${escapeHtml(item.recipientName)}收款</option>`).join('')}</select></label><button class="btn btn-primary" data-cfl-action="assign-tail"${Number(group.tailDifferenceCents || 0) === 0 ? ' disabled' : ''}>确认补入全部尾差</button><small>修改总额、依据或家庭数据后，需要重新确认尾差。</small></div></details>
      <details><summary>输出表格设置</summary><div class="cfl-side-content"><label>表格标题<input data-cfl-output="title" value="${escapeHtml(state.draft.outputSettings?.title || `${state.draft.projectName}发放明细表`)}"></label><label>编制单位<input data-cfl-output="organization" value="${escapeHtml(state.draft.outputSettings?.organization || state.context.database.settings?.villageName || '')}"></label><label>制表人<input data-cfl-output="preparedBy" value="${escapeHtml(state.draft.outputSettings?.preparedBy || '')}"></label><label>经办人<input data-cfl-output="handledBy" value="${escapeHtml(state.draft.outputSettings?.handledBy || '')}"></label><label>审批人<input data-cfl-output="approvedBy" value="${escapeHtml(state.draft.outputSettings?.approvedBy || '')}"></label><p>签字明细表和各组汇总表均显示完整银行卡号。</p></div></details></aside>`;
  }

  function render() {
    if (!state.host) return;
    state.host.innerHTML = state.mode === 'wizard' ? wizardHtml() : state.mode === 'editor' ? editorHtml() : overviewHtml();
  }
  function openWizard(importExcel = false, preparedImport = null) {
    if (!state.host || !state.context) throw new Error('承包费项目编辑器尚未加载');
    state.mode = 'wizard';
    state.wizardSource = importExcel ? 'excel' : 'excel';
    state.draft = null;
    state.expected = null;
    state.importPreview = null;
    state.preparedImport = preparedImport;
    render();
  }
  function openProject(planId, groupId) {
    const raw = state.context.database.contractFeeDistributionPlans.find((plan) => plan.id === planId); if (!raw) throw new Error('未找到承包项目');
    state.draft = model().normalizeContractFeeDistributionPlan(raw, { id: raw.id }); state.expected = JSON.stringify(raw); state.groupId = groupId || state.draft.groups[0]?.id; state.mode = 'editor'; state.page = 1; state.query = ''; state.importPreview = null; state.selected.clear(); render();
  }
  function updatePlanTotal() { state.draft.distributableAmountCents = state.draft.groups.reduce((sum, group) => sum + Number(group.allocatedAmountCents || 0), 0) + Number(state.draft.retainedAmountCents || 0); }
  function clearGroupTail(group) { group.tailRecipientItemId = ''; group.items.forEach((item) => { item.tailAmountCents = 0; }); }
  function itemFor(element) { const id = element.closest('[data-item-id]')?.dataset.itemId || element.dataset.itemId; return currentGroup()?.items.find((item) => item.id === id); }

  async function saveProject({ quiet = false } = {}) {
    updatePlanTotal(); state.draft.groups = state.draft.groups.map((group) => calculateGroup(group));
    const normalized = model().createContractFeeDistributionPlan(state.draft, { id: state.draft.id });
    const saved = await state.context.savePlan(normalized, state.expected); state.draft = model().normalizeContractFeeDistributionPlan(saved, { id: saved.id }); state.expected = JSON.stringify(saved);
    if (!quiet) state.context.notify('承包费项目台账已保存'); render(); return saved;
  }
  async function createProject(importAfterCreate) {
    const year = text(document.getElementById('cfl-wizard-year')?.value); const projectName = text(document.getElementById('cfl-wizard-name')?.value); const groupName = text(document.getElementById('cfl-wizard-group')?.value);
    const amount = text(document.getElementById('cfl-wizard-total')?.value); const allocationType = document.getElementById('cfl-wizard-type')?.value || 'population';
    if (!year || !projectName || !groupName || (!importAfterCreate && !amount)) throw new Error(`请把年度、项目名称、组别${importAfterCreate ? '' : '和本组总额'}填写完整`);
    const initialAmount = amount || '0';
    const id = identifier('contract-fee-plan'); const plan = model().createContractFeeDistributionPlan({ year, projectName, distributableAmount: initialAmount, groups: [{ groupName, allocatedAmount: initialAmount, allocationType, items: [] }] }, { id });
    const saved = await state.context.savePlan(plan, null); openProject(saved.id, saved.groups[0].id);
    if (importAfterCreate) {
      const prepared = state.preparedImport;
      state.preparedImport = null;
      if (prepared?.requiresSheetSelection) {
        state.importPreview = prepared;
        state.context.notify('这份表包含多个工作表，请选择本次要导入的年度');
        render();
      } else if (prepared) prepareImportedData(prepared);
      else await importExcel();
    }
  }
  function importedFieldDefinitions(data) {
    return (data.customColumns || []).map((label, index) => ({ id: `import-${index + 1}-${label.replace(/\W/gu, '').slice(0, 12) || index + 1}`, label, type: (data.rows || []).every((row) => text(row.customData?.[label]) === '' || Number.isFinite(Number(row.customData?.[label]))) ? 'number' : 'text', order: index + 10 }));
  }
  function applyImportedData(data) {
    const group = currentGroup(); const fields = importedFieldDefinitions(data); const fieldMap = new Map(fields.map((field) => [field.label, field.id]));
    const items = data.rows.map((row) => model().contractFeeDistributionItem({ ...row, householdId: identifier('household'), customData: Object.fromEntries(Object.entries(row.customData || {}).map(([label, value]) => [fieldMap.get(label) || label, value])) }));
    const previousImportedIds = new Set((group.importMetadata?.customFieldIds || []));
    const retainedFields = (group.fieldDefinitions || []).filter((field) => !previousImportedIds.has(field.id));
    group.items = items;
    group.fieldDefinitions = model().normalizeContractFeeFieldDefinitions([...retainedFields, ...fields]);
    group.outputTemplateSnapshot = {
      fileName: data.fileName, sheetName: data.sheetName, titleRows: structuredClone(data.titleRows || []),
      headerRowNumber: data.headerRowNumber,
      columns: (data.outputColumns || []).map((column) => ({
        ...structuredClone(column),
        customFieldId: column.fieldKey ? '' : (fieldMap.get(column.sourceKey) || ''),
      })),
    };
    group.importMetadata = {
      fileName: data.fileName, sheetName: data.sheetName, headerRowNumber: data.headerRowNumber,
      fields: data.fields, columns: data.columns, controlTotals: structuredClone(data.controlTotals || {}),
      outputColumns: structuredClone(data.outputColumns || []), customFieldIds: fields.map((field) => field.id),
      importedAt: new Date().toISOString(), excludedRows: data.excludedRows,
    };
    state.importPreview = null; clearGroupTail(group); state.context.notify(`已导入 ${items.length} 户，原表其他字段也已保留`); render();
  }
  function prepareImportedData(data) {
    if (!data) throw new Error('没有找到所选工作表的数据');
    if (data.error) throw new Error(data.error);
    if (data.requiresMapping) {
      state.importPreview = { ...data, mappingHeaderRow: data.headerRowNumber || 1 };
      state.context.notify('请在窗口中对应 Excel 表头和业务字段', 'warning');
    } else {
      state.importPreview = { ...data, confirmationReady: true };
      state.context.notify('表格识别完成，请核对总数、总额和来源字段');
    }
    render();
  }
  async function importExcel() {
    const result = await state.context.selectExcel(); if (!result?.ok) { if (!result?.canceled) throw new Error(result?.error || '读取 Excel 失败'); return; }
    if (result.data.requiresSheetSelection) {
      state.importPreview = result.data;
      state.context.notify('这份表包含多个工作表，请选择本次要导入的年度');
      return render();
    }
    prepareImportedData(result.data);
  }

  async function action(name, element) {
    if (name === 'open-wizard') return openWizard(element.dataset.import === 'true');
    if (name === 'select-wizard-source') { state.wizardSource = element.dataset.source === 'blank' ? 'blank' : 'excel'; return render(); }
    if (name === 'back-overview') { state.mode = 'overview'; state.draft = null; state.expected = null; state.importPreview = null; state.preparedImport = null; state.context.refreshDatabase?.(); return render(); }
    if (name === 'create-project') return createProject(element.dataset.import === 'true');
    if (name === 'open-project') return openProject(element.dataset.planId, element.dataset.groupId);
    if (name === 'switch-group') { state.groupId = element.dataset.groupId; state.page = 1; state.selected.clear(); return render(); }
    if (name === 'add-group') { const groupName = text(root.prompt('请输入组别名称，例如：二组')); if (!groupName) return; const amount = text(root.prompt('请输入本组必须发满的总额，例如：10000.00')); if (!amount) return; const id = identifier('contract-fee-group'); state.draft.groups.push(model().normalizeContractFeeGroup({ groupName, allocatedAmount: amount, allocationType: 'population', items: [] }, { id })); state.groupId = id; updatePlanTotal(); return render(); }
    if (name === 'cancel-mapping') { state.importPreview = null; return render(); }
    if (name === 'confirm-sheet-selection') {
      const sheetName = text(document.getElementById('cfl-import-sheet')?.value);
      const selectedSheet = state.importPreview?.sheets?.find((sheet) => text(sheet.sheetName) === sheetName);
      if (!selectedSheet) throw new Error('请选择一个可以读取的工作表');
      return prepareImportedData(selectedSheet);
    }
    if (name === 'confirm-mapping') {
      if (!root.ContractFeeExcelParser || !state.importPreview) throw new Error('Excel 导入工具尚未加载，请重新选择表格');
      const fields = {}; document.querySelectorAll('[data-cfl-map-field]').forEach((select) => { if (select.value !== '') fields[select.dataset.cflMapField] = Number(select.value); });
      if (!['householderName', 'recipientName', 'name'].some((key) => fields[key] !== undefined)) throw new Error('请至少对应“户主姓名”“收款人”或“姓名”中的一项');
      const source = state.importPreview; const parsed = root.ContractFeeExcelParser.parseContractFeeExcelGrid(source.rawGrid, { headerRowNumber: source.mappingHeaderRow || 1, fields });
      return prepareImportedData({ ...parsed, fileName: source.fileName, sheetName: source.sheetName });
    }
    if (name === 'confirm-import') {
      const source = state.importPreview; const group = currentGroup();
      if (!source?.confirmationReady) throw new Error('请重新选择需要导入的工作表');
      const expectedInput = text(document.getElementById('cfl-import-expected-basis')?.value);
      const totalInput = text(document.getElementById('cfl-import-total')?.value);
      if (group.allocationType !== 'fixed' && (!expectedInput || !Number.isFinite(Number(expectedInput)) || Number(expectedInput) <= 0)) throw new Error('请填写大于零的核定总人口或总亩数');
      if (!totalInput || !Number.isFinite(Number(totalInput)) || Number(totalInput) < 0) throw new Error('请填写正确的本组固定总额');
      group.expectedBasisTotal = group.allocationType === 'fixed' ? null : Number(expectedInput);
      group.allocatedAmountCents = model().amountToCents(totalInput);
      updatePlanTotal();
      return applyImportedData(source);
    }
    if (name === 'save-project') return saveProject();
    if (name === 'search') { state.query = document.querySelector('[data-cfl-input="query"]')?.value || ''; state.page = 1; return render(); }
    if (name === 'page') { state.page = Math.max(1, Number(element.dataset.page || 1)); return render(); }
    if (name === 'select-page') { groupRows(currentGroup()).slice((state.page - 1) * state.pageSize, state.page * state.pageSize).forEach((item) => state.selected.add(item.id)); return render(); }
    if (name === 'add-household') { const group = currentGroup(); const id = identifier('contract-fee-item'); group.items.push({ id, householdId: identifier('household'), householderName: '', recipientName: '', name: '', personId: '', recipientPersonId: '', householdPersonId: '', bankCard: '', bankName: '', population: 0, acreage: 0, customData: {}, sourceData: {}, active: true, notes: '' }); clearGroupTail(group); state.page = Math.ceil(groupRows(group).length / state.pageSize); return render(); }
    if (name === 'remove-household' || name === 'restore-household') { const item = itemFor(element); if (!item) return; item.active = name === 'restore-household'; item.removedAt = item.active ? null : new Date().toISOString(); clearGroupTail(currentGroup()); return render(); }
    if (name === 'bulk-fill') {
      const field = document.getElementById('cfl-bulk-field')?.value; const value = document.getElementById('cfl-bulk-value')?.value ?? ''; const target = document.getElementById('cfl-bulk-target')?.value;
      const items = target === 'all' ? currentGroup().items.filter((item) => item.active !== false) : target === 'filtered' ? groupRows(currentGroup()).filter((item) => item.active !== false) : currentGroup().items.filter((item) => state.selected.has(item.id));
      if (!items.length) throw new Error('请先勾选要批量填写的家庭，或更换填写范围');
      items.forEach((item) => { if (field.startsWith('custom:')) item.customData[field.slice(7)] = value; else item[field] = value; }); clearGroupTail(currentGroup()); state.context.notify(`已批量填写 ${items.length} 户`); return render();
    }
    if (name === 'add-field') { const label = text(document.getElementById('cfl-new-field-label')?.value); if (!label) throw new Error('请填写字段名称'); const type = document.getElementById('cfl-new-field-type')?.value || 'text'; const id = identifier('field'); currentGroup().fieldDefinitions.push(model().normalizeContractFeeFieldDefinition({ id, label, type, order: currentGroup().fieldDefinitions.length })); currentGroup().items.forEach((item) => { item.customData[id] = ''; }); return render(); }
    if (name === 'add-formula') { const label = text(document.getElementById('cfl-formula-label')?.value); if (!label) throw new Error('请填写计算字段名称'); const id = identifier('formula'); currentGroup().fieldDefinitions.push(model().normalizeContractFeeFieldDefinition({ id, label, type: 'calculated', formula: { leftFieldId: document.getElementById('cfl-formula-left').value, operator: document.getElementById('cfl-formula-operator').value, rightFieldId: document.getElementById('cfl-formula-right').value }, order: currentGroup().fieldDefinitions.length })); currentGroup().basisFieldId = id; currentGroup().allocationType = 'custom'; clearGroupTail(currentGroup()); return render(); }
    if (name === 'rename-field') { const field = currentGroup().fieldDefinitions.find((entry) => entry.id === element.dataset.fieldId); const label = text(root.prompt('请输入新的中文字段名称', field?.label)); if (field && label) field.label = label; return render(); }
    if (name === 'remove-field') { const next = model().removeContractFeeField(currentGroup(), element.dataset.fieldId); state.draft.groups.splice(state.draft.groups.indexOf(currentGroup()), 1, next); return render(); }
    if (name === 'assign-tail') { const itemId = document.getElementById('cfl-tail-recipient')?.value; if (!itemId) throw new Error('请选择一户补入尾差'); currentGroup().tailRecipientItemId = itemId; return render(); }
    if (name === 'create-batch') { const saved = await saveProject({ quiet: true }); return state.context.createBatch(saved.id); }
    if (name === 'export-project') { const saved = await saveProject({ quiet: true }); return state.context.exportProject(saved.id); }
    if (name === 'show-year-summary') { state.context.notify('年度汇总已显示在顶部，本次导出还会生成各组汇总表'); return; }
    if (name === 'show-history') { const available = [...new Set(plans().map((plan) => plan.year))].sort().reverse(); state.context.notify(`已有年度：${available.join('、') || '暂无'}`); }
  }

  async function onClick(event) {
    const element = event.target.closest('[data-cfl-action]'); if (!element || !state.host?.contains(element)) return;
    event.preventDefault(); try { await action(element.dataset.cflAction, element); } catch (error) { state.context.notify(error.message || '操作失败', 'error'); }
  }
  function onChange(event) {
    if (!state.host?.contains(event.target)) return;
    const element = event.target;
    if (element.dataset.cflChange === 'year') { state.year = element.value; return render(); }
    if (element.dataset.cflChange === 'page-size') { state.pageSize = Number(element.value) || 20; state.page = 1; return render(); }
    if (element.dataset.cflChange === 'show-removed') { state.showRemoved = element.checked; state.page = 1; return render(); }
    if (element.dataset.cflChange === 'mapping-header') { state.importPreview.mappingHeaderRow = Math.max(1, Number(element.value || 1)); return render(); }
    if (element.dataset.cflSelectItem) { if (element.checked) state.selected.add(element.dataset.cflSelectItem); else state.selected.delete(element.dataset.cflSelectItem); return; }
    if (element.dataset.cflGroupField) {
      const group = currentGroup(); const key = element.dataset.cflGroupField;
      if (key === 'allocatedAmount') group.allocatedAmountCents = model().amountToCents(element.value);
      else if (key === 'expectedBasisTotal') {
        const value = text(element.value);
        if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) return state.context.notify('核定总数必须是非负数字', 'error');
        group.expectedBasisTotal = value === '' ? null : Number(value);
      } else {
        group.basisFieldId = element.value;
        group.allocationType = element.value === 'population' ? 'population' : element.value === 'acreage' ? 'acreage' : 'custom';
        if (group.expectedBasisTotal === null || group.expectedBasisTotal === undefined) group.expectedBasisTotal = Number(calculateGroup(group).actualBasisTotal || 0);
      }
      clearGroupTail(group); updatePlanTotal(); return render();
    }
    if (element.dataset.cflItemField) { const item = itemFor(element); if (!item) return; const key = element.dataset.cflItemField; if (key.startsWith('custom:')) item.customData[key.slice(7)] = element.value; else { item[key] = element.value; if (key === 'recipientName') item.name = element.value; } clearGroupTail(currentGroup()); return render(); }
    if (element.dataset.cflOutput) { state.draft.outputSettings ||= {}; state.draft.outputSettings[element.dataset.cflOutput] = element.value; }
  }

  function mount(host, context) {
    state.host = host; state.context = context; state.year = context.year || state.year; state.mode = 'overview'; state.draft = null; state.importPreview = null; state.preparedImport = null;
    if (!host.__contractFeeLedgerEvents) { host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.__contractFeeLedgerEvents = true; }
    render();
  }

  root.ContractFeeLedgerUI = Object.freeze({ mount, openWizard });
})(window);
