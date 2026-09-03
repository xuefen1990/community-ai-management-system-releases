'use strict';

(function exposeDisbursementExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalizeHeader = (value) => text(value).replace(/[\s_（）()\-:：]/gu, '').toLowerCase();
  const FIELDS = [
    ['name', '姓名', ['姓名', '户主姓名', '人员姓名', '收款人']], ['idCard', '身份证号', ['身份证号', '身份证', '证件号码']],
    ['groupName', '组别', ['组别', '村民组', '居民组']], ['bankCard', '银行卡号', ['银行卡号', '银行账号', '一卡通号', '卡号', '账号']],
    ['amount', '金额', ['金额', '实发金额', '发放金额', '应发金额']], ['unitPrice', '单价', ['单价', '月标准', '元月', '元/月', '标准']],
    ['quantity', '数量', ['数量', '工日', '人口', '面积', '亩数']], ['months', '月份', ['月份', '合计月份', '月数']],
    ['role', '职务', ['职务', '岗位']], ['workDate', '用工日期', ['用工日期', '日期']], ['workItem', '用工事项', ['用工事项', '事项', '工作内容']],
    ['responsibilityArea', '负责区域', ['负责区域', '责任区域']], ['phone', '手机号', ['手机号', '电话', '联系电话']], ['remark', '备注', ['备注', '说明']],
  ].map(([key, label, aliases]) => ({ key, label, aliases }));
  const fieldFor = (header) => FIELDS.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(header)))?.key || '';
  const isFooter = (row) => /^(合计|总计|制表|审批|经办|备注|说明)/u.test(text(row?.[0])) || !row?.some((cell) => text(cell));
  function parseDisbursementExcelGrid(grid) {
    if (!Array.isArray(grid) || !grid.length) throw new Error('表格内容为空');
    let headerIndex = -1; let fields = {};
    for (let index = 0; index < Math.min(30, grid.length); index += 1) {
      const mapped = {}; (grid[index] || []).forEach((cell, column) => { const field = fieldFor(cell); if (field && mapped[field] === undefined) mapped[field] = column; });
      if (mapped.name !== undefined && Object.keys(mapped).length >= 2) { headerIndex = index; fields = mapped; break; }
    }
    if (headerIndex < 0) return { requiresMapping: true, columns: (grid.find((row) => row?.some((cell) => text(cell))) || []).map(text), sampleRows: grid.slice(0, 8), rawGrid: grid.slice(0, 80), rows: [] };
    const rows = [];
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const source = grid[index] || []; if (isFooter(source)) continue;
      const row = { id: `disbursement-import-${index + 1}`, sourceRowNumber: index + 1, rawData: {} };
      FIELDS.forEach((field) => { const value = fields[field.key] === undefined ? '' : text(source[fields[field.key]]); row[field.key] = value; row.rawData[field.label] = value; });
      row.bankCard = row.bankCard.replace(/[\s-]/gu, ''); if (row.name) rows.push(row);
    }
    if (!rows.length) throw new Error('表格中没有可导入的发放人员');
    return { requiresMapping: false, headerRowNumber: headerIndex + 1, fields, columns: (grid[headerIndex] || []).map(text), rows, total: rows.length };
  }
  const api = { FIELDS, normalizeHeader, parseDisbursementExcelGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DisbursementExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
