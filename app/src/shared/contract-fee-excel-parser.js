'use strict';

(function exposeContractFeeExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalizeHeader = (value) => text(value).replace(/[\s_（）()\-:：]/gu, '').toLowerCase();
  const FIELDS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '村民姓名', '人员姓名', '户名'], required: true },
    { key: 'population', label: '人口', aliases: ['人口', '人口数', '人数', '家庭人口'] },
    { key: 'acreage', label: '亩数', aliases: ['亩数', '面积', '土地面积', '实际亩数'] },
    { key: 'unitPrice', label: '单价', aliases: ['单价', '每人金额', '每亩单价', '标准'] },
    { key: 'amount', label: '金额', aliases: ['金额', '应发金额', '发放金额', '合计金额'], required: true },
    { key: 'bankCard', label: '卡号', aliases: ['卡号', '银行卡号', '银行账号', '账号', '收款卡号'] },
  ];

  function inferredField(header) {
    const normalized = normalizeHeader(header);
    return FIELDS.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === normalized))?.key || '';
  }

  function isFooter(row) {
    const first = text(row?.[0]);
    const joined = (row || []).map(text).join('');
    return /^(合计|总计|共计|制表|填表|审核|备注|说明)/u.test(first) || /^[-—_]*$/u.test(joined);
  }

  function parseNumber(value) {
    const cleaned = text(value).replace(/[￥¥元,，\s人口亩]/gu, '');
    if (!cleaned) return '';
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : text(value);
  }

  function parseContractFeeExcelGrid(grid) {
    if (!Array.isArray(grid) || !grid.length) throw new Error('表格内容为空');
    let headerIndex = -1; let fieldMap = {};
    for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
      const mapped = {};
      (grid[index] || []).forEach((cell, columnIndex) => { const field = inferredField(cell); if (field && mapped[field] === undefined) mapped[field] = columnIndex; });
      if (mapped.name !== undefined && (mapped.amount !== undefined || mapped.population !== undefined || mapped.acreage !== undefined)) { headerIndex = index; fieldMap = mapped; break; }
    }
    if (headerIndex < 0) throw new Error('未识别到承包费表头，请确认表格包含姓名以及金额、人口或亩数列');
    const rows = []; let ignoredRows = 0;
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const source = Array.isArray(grid[index]) ? grid[index] : [];
      if (!source.some((cell) => text(cell)) || isFooter(source)) { ignoredRows += 1; continue; }
      const row = { id: `import-row-${index + 1}`, sourceRowNumber: index + 1 };
      for (const field of FIELDS) {
        const raw = fieldMap[field.key] === undefined ? '' : source[fieldMap[field.key]];
        row[field.key] = ['population', 'acreage', 'unitPrice', 'amount'].includes(field.key) ? parseNumber(raw) : text(raw);
      }
      row.bankCard = text(row.bankCard).replace(/[\s-]/gu, '');
      if (!row.name) { ignoredRows += 1; continue; }
      rows.push(row);
    }
    if (!rows.length) throw new Error('表格中没有可导入的居民记录');
    return { fields: fieldMap, rows, total: rows.length, headerRowNumber: headerIndex + 1, ignoredRows };
  }

  const api = { FIELDS, normalizeHeader, inferredField, parseContractFeeExcelGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContractFeeExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
