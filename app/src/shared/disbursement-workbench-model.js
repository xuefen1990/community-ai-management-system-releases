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
  function columns(template = {}, key = '') {
    const field = (key, label, numeric = false) => ({ key, label, numeric });
    let fields;
    const kind = template.workbenchKind || key;
    if (kind === 'position_salary') fields = [field('role', '职务'), field('unitPrice', '元/月', true), field('quantity', '合计月份', true), field('deductions', '扣除款', true)];
    else if (kind === 'public_service') fields = [field('responsibilityArea', '负责区域')];
    else if (kind === 'casual_labor') fields = [field('workDate', '用工日期'), field('workItem', '用工事项'), field('quantity', '工日', true), field('unitPrice', '单价', true)];
    else if (kind === 'contract_fee') fields = [field('groupName', '组别'), field('quantity', '面积/人口', true), field('unitPrice', '单价', true)];
    else fields = (template.columns || (template.fields || []).map((label) => ({ label }))).filter((c) => c.visible !== false).map((c) => ({ key: `custom:${c.label}`, label: c.label, source: c.source, residentField: c.residentField, calculation: c.calculation }));
    return [field('name', '姓名'), ...fields, field('bankCard', '银行卡号'), field('finalAmount', '实发金额', true), field('remark', '备注')];
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
    const result = { ...copy(row), personId: model.personId(person), name: model.personName(person), groupName: model.personGroup(person), idCard: residentValue(person, 'idCard', model), phone: residentValue(person, 'phone', model), bankCard: model.defaultBankCard(person), bankName: text(person.bankName || person.bank), customData: { ...row.customData } };
    for (const c of template.columns || []) if (c.source === 'resident') result.customData[c.label] = residentValue(person, c.residentField || c.key, model);
    return result;
  }
  function unlink(row, template) {
    const next = { ...copy(row), personId: '', bankCard: '', bankName: '', groupName: '', idCard: '', phone: '', customData: { ...row.customData } };
    for (const c of template.columns || []) if (c.source === 'resident') next.customData[c.label] = '';
    return next;
  }
  function recalculate(row, key, model) {
    const next = copy(row);
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
  function reuse(batch, template, people, model) {
    const key = template.workbenchKind || template.key || batch.templateKey;
    return batch.items.map((item) => {
      let row = rawItem(item, model);
      const person = people.find((p) => model.personId(p) === row.personId);
      if (person) row = link(row, person, template, model);
      delete row.id; row.adjustmentReason = ''; row.manualAmount = false;
      row.paymentStatus = 'pending'; row.paymentNote = '';
      if (key === 'casual_labor') for (const field of ['workDate', 'workItem', 'quantity', 'finalAmount', 'remark']) row[field] = '';
      else if (key === 'position_salary') { row.quantity = ''; row.deductions = ''; row.finalAmount = ''; }
      else if (key === 'contract_fee') { row.unitPrice = ''; row.finalAmount = ''; }
      else if (key !== 'public_service') row.finalAmount = '';
      return row;
    });
  }
  function build(draft, previous, template, people, model, { strict = false } = {}) {
    const key = template.workbenchKind || draft.templateKey;
    const rows = draft.rows.filter((r) => ['name','personId','bankCard','finalAmount','quantity','unitPrice','workItem','remark'].some((k) => text(r[k])) || Object.values(r.customData || {}).some((v) => text(v)));
    try {
      for (const row of rows) {
        if (!text(row.finalAmount)) throw new Error(`${row.name || '该行'}尚未填写或计算实发金额`);
        for (const numeric of ['quantity', 'unitPrice', 'deductions', 'finalAmount']) if (text(row[numeric]) && (!Number.isFinite(Number(row[numeric])) || Number(row[numeric]) < 0)) throw new Error(`${row.name}的数值必须为非负数字`);
      }
      const items = rows.map((r) => ({ ...r, amount: key === 'contract_fee' ? r.automaticAmount || r.finalAmount : r.finalAmount, unitPrice: key === 'public_service' ? r.finalAmount : r.unitPrice }));
      const next = model.createTemplateDisbursementBatch({ ...draft, templateKey: key, templateSnapshot: template, items }, { personnel: people, id: draft.id });
      // Preserve explicit blank cards and stable row ids; the legacy normalizer otherwise restores a default card.
      next.items.forEach((r, i) => { r.bankCard = model.normalizeBankCard(rows[i].bankCard); r.id = rows[i].id || r.id; });
      return { ...previous, ...next, templateKey: draft.templateKey, createdAt: previous?.createdAt || next.createdAt, visualLayout: layout(draft.visualLayout), workbenchDraft: { ...copy(draft), ready: true }, residentSyncDecisions: {} };
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
  return Object.freeze({ copy, text, clamp, fonts, esc, style, layout, cssStyle, columns, rawItem, candidates, residentValue, link, unlink, recalculate, reuse, build, paginate });
});
