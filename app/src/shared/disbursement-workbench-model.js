'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.DisbursementWorkbenchModel = value;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const copy = (value) => structuredClone(value);
  const text = (value) => String(value ?? '').trim();
  const clamp = (value, min, max, fallback) => text(value) === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(min, Math.min(max, Number(value)));
  const fonts = ['Songti SC', 'SimSun', 'PingFang SC', 'Microsoft YaHei', 'Arial'];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function style(value = {}) {
    return { font: fonts.includes(value.font) ? value.font : 'Songti SC', size: clamp(value.size, 6, 36, 10), bold: Boolean(value.bold), align: ['left', 'center', 'right'].includes(value.align) ? value.align : 'center', vertical: ['top', 'middle', 'bottom'].includes(value.vertical) ? value.vertical : 'middle', wrap: value.wrap !== false };
  }
  function layout(value = {}) {
    return { ...copy(value), table: style(value.table), widths: { ...value.widths }, heights: { ...value.heights }, cells: { ...value.cells }, labels: { ...value.labels }, rowHeight: clamp(value.rowHeight, 5, 50, 8) };
  }
  function cssStyle(value) {
    const s = style(value);
    return `font-family:'${s.font}',serif;font-size:${s.size}pt;font-weight:${s.bold ? 700 : 400};text-align:${s.align};vertical-align:${s.vertical};white-space:${s.wrap ? 'normal' : 'nowrap'};overflow-wrap:anywhere`;
  }
  function columns(template = {}, key = '', visual = template.visualLayout || {}) {
    if (Array.isArray(visual.editorColumns)) return visual.editorColumns.filter((c) => c.visible !== false).map((c) => ({ ...c }));
    const field = (key, label, numeric = false) => ({ key, label, numeric });
    let fields;
    const kind = template.workbenchKind || key;
    if (kind === 'position_salary') fields = [field('role', '职务'), field('unitPrice', '元/月', true), field('quantity', '合计月份', true), field('deductions', '扣除款', true)];
    else if (kind === 'public_service') fields = [field('responsibilityArea', '负责区域')];
    else if (kind === 'casual_labor') fields = [field('workDate', '用工日期'), field('workItem', '用工事项'), field('quantity', '工日', true), field('unitPrice', '单价', true)];
    else if (kind === 'contract_fee') fields = [field('quantity', '面积/人口', true), field('unitPrice', '单价', true)];
    else fields = (template.columns || (template.fields || []).map((label) => ({ label }))).filter((c) => c.visible !== false).map((c) => ({ key: `custom:${c.label}`, label: c.label, source: c.source, residentField: c.residentField, calculation: c.calculation }));
    // 组别是村居发放中最常见的统一填写条件，所有模板都提供它；
    // 即使人员尚未关联居民档案，也可以在本批次中临时修正。
    return [field('name', '姓名'), field('groupName', '组别'), ...fields, field('bankCard', '银行卡号'), field('finalAmount', '实发金额', true), field('remark', '备注')];
  }
  function printColumns(template = {}, key = '', visual = template.visualLayout || {}) {
    if (Array.isArray(visual.printColumns)) return visual.printColumns.map((column) => ({ ...column }));
    const editor = columns(template, key, visual).filter((column) => template.showBankCard !== false || column.key !== 'bankCard');
    return [...(visual.autoSequence === false ? [] : [{ key: '_sequence', label: '序号' }]), ...editor];
  }
  const defaultMetadataFields = [
    { key: 'period', label: '发放期间' }, { key: 'batchDate', label: '发放日期' },
    { key: 'villageName', label: '编制单位' }, { key: 'approver', label: '审批人' },
    { key: 'maker', label: '制表人' }, { key: 'handler', label: '经办人' },
    { key: 'notes', label: '备注' },
  ];
  function metadataFields(visual = {}) {
    return Array.isArray(visual.metadataFields) ? copy(visual.metadataFields) : copy(defaultMetadataFields);
  }
  function totalLabels(pageCount, pageIndex) {
    return pageCount <= 1 ? ['合计'] : pageIndex === pageCount - 1 ? ['本页小计', '总合计'] : ['本页小计'];
  }
  function totalCells(printColumns, label, money, count) {
    const amountIndex = printColumns.findIndex((column) => column.key === 'finalAmount');
    const caption = `${label}（${count}人）`;
    if (amountIndex < 0) return [{ colspan: printColumns.length, text: `${caption}　${money}` }];
    const cells = [];
    if (amountIndex > 0) cells.push({ colspan: amountIndex, text: caption });
    cells.push({ colspan: 1, text: amountIndex === 0 ? `${caption}　${money}` : money });
    if (amountIndex < printColumns.length - 1) cells.push({ colspan: printColumns.length - amountIndex - 1, text: '' });
    return cells;
  }
  function value(row, key) { return key.startsWith('custom:') ? row.customData?.[key.slice(7)] ?? '' : row[key] ?? ''; }
  function assign(row, key, next) { if (key.startsWith('custom:')) { row.customData ||= {}; row.customData[key.slice(7)] = next; } else row[key] = next; }
  function bulk(rows, { ids, key, value: next, onlyEmpty = true }, template, model) {
    if (['name', 'originalAmount', 'id', 'personId', 'bankCard'].includes(key)) throw new Error('姓名、银行卡请逐人核对；原表金额只供对照');
    const column = columns(template, template.workbenchKind || template.key).find((c) => c.key === key);
    if (!column) throw new Error('请选择可填写的字段');
    if (column.numeric && text(next) && (!Number.isFinite(Number(next)) || Number(next) < 0)) throw new Error('请输入非负数字');
    const targets = new Set(ids);
    return rows.map((source) => {
      if (!targets.has(source.id) || (onlyEmpty && text(value(source, key)))) return copy(source);
      const row = copy(source); assign(row, key, next);
      if (key === 'finalAmount') { row.manualAmount = true; row.adjustmentReason = '批量统一填写金额'; }
      return recalculate(row, template.workbenchKind || template.key, model, template.visualLayout?.calculation);
    });
  }
  function rawItem(item = {}, model) {
    const row = { ...copy(item), customData: { ...item.customData } };
    for (const [key, cents] of [['unitPrice', 'unitPriceCents'], ['deductions', 'deductionsCents'], ['finalAmount', 'amountCents']]) {
      if (row[key] === undefined) row[key] = item[cents] === undefined ? '' : model.centsToYuan(item[cents]);
    }
    row.manualAmount = Boolean(item.manualAmount || item.adjustmentReason);
    return row;
  }
  function residentValue(person, key, model) {
    if (['name', '姓名'].includes(key)) return model.personName(person);
    if (['group', 'groupName', '组别', '村民组'].includes(key)) return model.personGroup(person);
    if (['bankCard', 'cardNumber', '银行卡', '银行卡号'].includes(key)) return model.defaultBankCard(person);
    if (['idCard', 'id_card', '身份证', '身份证号'].includes(key)) return text(person.id_card || person.idCard);
    if (['phone', 'mobile', '手机号', '联系电话'].includes(key)) return text(person.phone || person.mobile || person.contact_phone).replace(/^undefined$/u, '');
    return typeof person[key] === 'object' ? '' : text(person[key]);
  }
  function candidates(query, people, model, limit = 20) {
    const q = text(query); if (!q) return { matches: [], exact: [] };
    const exact = people.filter((p) => model.personName(p) === q);
    const matches = [...exact, ...people.filter((p) => model.personName(p) !== q && `${model.personName(p)} ${model.personGroup(p)} ${p.id_card || p.idCard || ''}`.includes(q))];
    return { matches: matches.slice(0, limit), exact, total: matches.length };
  }
  function link(row, person, template, model) {
    const result = { ...copy(row), personId: model.personId(person), name: model.personName(person), groupName: model.personGroup(person), idCard: residentValue(person, 'idCard', model), phone: residentValue(person, 'phone', model), bankCard: model.normalizeBankCard(row.bankCard) || model.defaultBankCard(person), bankName: text(row.bankName || person.bankName || person.bank), customData: { ...row.customData } };
    for (const c of template.columns || []) if (c.source === 'resident') result.customData[c.label] = residentValue(person, c.residentField || c.key, model);
    return result;
  }
  function unlink(row, template) {
    const next = { ...copy(row), personId: '', bankCard: '', bankName: '', groupName: '', idCard: '', phone: '', customData: { ...row.customData } };
    for (const c of template.columns || []) if (c.source === 'resident') next.customData[c.label] = '';
    return next;
  }
  function recalculate(row, key, model, rule) {
    const next = copy(row);
    if (rule && rule.mode !== 'default') {
      if (rule.mode === 'manual') return next;
      const a = value(row, rule.quantity || 'quantity'), b = value(row, rule.price || 'unitPrice');
      const deduction = rule.deduction ? value(row, rule.deduction) : 0;
      const operands = rule.mode === 'uniform' ? [rule.amount] : [a, b];
      const valid = operands.every((v) => text(v) && Number.isFinite(Number(v)) && Number(v) >= 0) && Number.isFinite(Number(deduction || 0)) && Number(deduction || 0) >= 0;
      const cents = !valid ? null : (rule.mode === 'uniform' ? model.amountToCents(rule.amount) : Math.round(Number(a) * model.amountToCents(b))) - model.amountToCents(deduction || 0);
      next.automaticAmount = cents === null || cents < 0 ? '' : model.centsToYuan(cents);
      if (!row.manualAmount) next.finalAmount = next.automaticAmount;
      return next;
    }
    if (['position_salary', 'casual_labor', 'contract_fee'].includes(key)) {
      if (['quantity','unitPrice','deductions'].some((k) => text(row[k]) && !Number.isFinite(Number(row[k])))) {
        next.automaticAmount = ''; if (!row.manualAmount) next.finalAmount = ''; return next;
      }
      const cents = Math.round(Number(row.quantity || 0) * model.amountToCents(row.unitPrice || 0)) - model.amountToCents(row.deductions || 0);
      next.automaticAmount = model.centsToYuan(cents);
      if (!row.manualAmount) next.finalAmount = text(row.quantity) === '' || text(row.unitPrice) === '' ? '' : next.automaticAmount;
    }
    return next;
  }
  function reuse(batch, template, people, model, { preserveAmounts = false, history = [] } = {}) {
    const key = template.workbenchKind || template.key || batch.templateKey;
    const recurring = preserveAmounts || ['position_salary', 'public_service'].includes(key);
    return batch.items.map((item) => {
      let row = rawItem(item, model);
      const explicit = people.find((p) => model.personId(p) === row.personId);
      const direct = explicit ? null : matchResident(row, people, model);
      const confirmed = !explicit && recurring ? matchConfirmedResident(row, history, people, model, { categoryId: batch.categoryId, categoryName: batch.categoryName, templateKey: batch.templateKey || key, excludeBatchId: batch.id }) : null;
      const person = explicit || (direct && confirmed && model.personId(direct) !== model.personId(confirmed) ? null : direct || confirmed);
      if (person) row = link(row, person, template, model);
      row.originalAmount = row.finalAmount; row.automaticAmount = '';
      delete row.id;
      if (!recurring) { row.adjustmentReason = ''; row.manualAmount = false; }
      else if (template.visualLayout?.calculation && template.visualLayout.calculation.mode !== 'default' && text(row.finalAmount)) {
        row.manualAmount = true;
        row.adjustmentReason ||= '沿用上期固定金额';
      }
      row.paymentStatus = 'pending'; row.paymentNote = '';
      if (key === 'casual_labor' && !preserveAmounts) for (const field of ['workDate', 'workItem', 'quantity', 'finalAmount', 'remark']) row[field] = '';
      else if (key === 'contract_fee' && !preserveAmounts) { row.unitPrice = ''; row.finalAmount = ''; }
      // 周期性发放沿用上期标准和实发金额；其他类别按本期重新计算。
      else if (!recurring) row.finalAmount = '';
      return row;
    });
  }
  function matchResident(row, people, model) {
    const sameName = people.filter((person) => model.personName(person) === text(row.name));
    if (!sameName.length) return null;
    const idCard = text(row.idCard || row.id_card).toUpperCase();
    if (idCard) {
      const matches = sameName.filter((person) => text(person.id_card || person.idCard).toUpperCase() === idCard);
      return matches.length === 1 ? matches[0] : null;
    }
    const bankCard = model.normalizeBankCard(row.bankCard);
    if (bankCard) {
      const matches = sameName.filter((person) => (!text(row.groupName) || model.personGroup(person) === text(row.groupName)) && model.bankAccounts(person).some((account) => model.normalizeBankCard(account.cardNumber) === bankCard));
      if (matches.length === 1) return matches[0];
    }
    return null;
  }
  function matchConfirmedResident(row, history, people, model, { categoryId = '', categoryName = '', templateKey = '', excludeBatchId = '' } = {}) {
    const name = text(row.name);
    const card = text(row.bankCard) ? model.normalizeBankCard(row.bankCard) : '';
    const idCard = text(row.idCard || row.id_card).toUpperCase();
    if (!name || (!card && !idCard)) return null;
    const matches = new Map();
    for (const batch of history || []) {
      if (batch.isTest || batch.recycleInfo || text(batch.id) === text(excludeBatchId) || text(batch.templateKey) !== text(templateKey)) continue;
      const sameCategory = categoryId && text(batch.categoryId) ? text(batch.categoryId) === text(categoryId) : Boolean(text(categoryName)) && text(batch.categoryName) === text(categoryName);
      if (!sameCategory) continue;
      for (const item of batch.items || []) {
        if (!text(item.personId) || text(item.name) !== name) continue;
        if (text(row.groupName) && text(item.groupName) && text(row.groupName) !== text(item.groupName)) continue;
        const person = people.find((entry) => model.personId(entry) === text(item.personId) && model.personName(entry) === name);
        if (!person) continue;
        if (text(row.groupName) && model.personGroup(person) && text(row.groupName) !== model.personGroup(person)) continue;
        if (idCard) {
          if (text(person.id_card || person.idCard).toUpperCase() !== idCard) continue;
        } else if (model.normalizeBankCard(item.bankCard) !== card) continue;
        matches.set(model.personId(person), person);
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }
  function build(draft, previous, template, people, model, { strict = false } = {}) {
    const key = template.workbenchKind || draft.templateKey;
    const rule = draft.visualLayout?.calculation;
    const rows = draft.rows.map((r) => rule ? recalculate(r, key, model, rule) : r).filter((r) => ['name','personId','bankCard','finalAmount','quantity','unitPrice','workItem','remark'].some((k) => text(r[k])) || Object.values(r.customData || {}).some((v) => text(v)));
    try {
      for (const row of rows) {
        if (!text(row.finalAmount)) throw new Error(`${row.name || '该行'}尚未填写或计算实发金额`);
        for (const numeric of ['quantity', 'unitPrice', 'deductions', 'finalAmount']) if (text(row[numeric]) && (!Number.isFinite(Number(row[numeric])) || Number(row[numeric]) < 0)) throw new Error(`${row.name}的数值必须为非负数字`);
      }
      const configured = rule && rule.mode !== 'default';
      const items = rows.map((r) => ({ ...r, amount: configured && !r.manualAmount ? (r.automaticAmount || r.finalAmount) : key === 'contract_fee' && !r.manualAmount ? r.automaticAmount || r.finalAmount : r.finalAmount, deductions: configured ? 0 : r.deductions, unitPrice: key === 'public_service' ? r.finalAmount : r.unitPrice }));
      const next = model.createTemplateDisbursementBatch({ ...draft, templateKey: configured ? 'configured_workbench' : key, templateId: draft.templateId || template.id || (configured ? key : ''), templateSnapshot: template, items }, { personnel: people, id: draft.id });
      // Preserve explicit blank cards and stable row ids; the legacy normalizer otherwise restores a default card.
      next.items.forEach((r, i) => { r.bankCard = model.normalizeBankCard(rows[i].bankCard); r.id = rows[i].id || r.id; r.originalAmount = rows[i].originalAmount; r.groupName = text(rows[i].groupName); if (configured) r.deductionsCents = model.amountToCents(rows[i].deductions || 0); });
      return { ...previous, ...next, templateKey: draft.templateKey, createdAt: previous?.createdAt || next.createdAt, visualLayout: layout(draft.visualLayout), metadataValues: copy(draft.metadataValues || {}), workbenchDraft: { ...copy(draft), ready: true }, residentSyncDecisions: {} };
    } catch (error) {
      if (strict) throw error;
      return { ...previous, ...copy(draft), items: [], status: 'draft', templateSnapshot: copy(template), visualLayout: layout(draft.visualLayout), workbenchDraft: { ...copy(draft), ready: false, error: error.message }, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), signers: { approver: draft.approver, maker: draft.maker, handler: draft.handler } };
    }
  }
  function paginate(heights, available, limit = 50) {
    const pages = []; let current = [], used = 0;
    heights.forEach((height, index) => {
      if (height > available) throw new Error(`第 ${index + 1} 行高于单页可用空间，请缩小字号、行高或边距`);
      if (current.length && (used + height > available || current.length >= limit)) { pages.push(current); current = []; used = 0; }
      current.push(index); used += height;
    });
    if (current.length || !pages.length) pages.push(current);
    return pages;
  }
  return Object.freeze({ copy, text, clamp, fonts, esc, style, layout, cssStyle, columns, printColumns, metadataFields, totalLabels, totalCells, value, assign, bulk, rawItem, candidates, residentValue, link, unlink, matchResident, matchConfirmedResident, recalculate, reuse, build, paginate });
});
