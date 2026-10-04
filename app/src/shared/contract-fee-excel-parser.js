'use strict';

(function exposeContractFeeExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalizeHeader = (value) => text(value).replace(/[\s_（）()\-:：/]/gu, '').toLowerCase();
  const FIELDS = [
    { key: 'sequence', label: '序号', aliases: ['序号', '编号', '顺序号'] },
    { key: 'groupName', label: '组别', aliases: ['组别', '村民组', '居民组', '村组', '所属组', '小组'] },
    { key: 'householderName', label: '户主姓名', aliases: ['户主姓名', '户主', '户名', '家庭户主'] },
    { key: 'recipientName', label: '收款人', aliases: ['收款人', '收款人姓名', '领款人', '账户姓名', '开户名'] },
    { key: 'name', label: '姓名', aliases: ['姓名', '村民姓名', '人员姓名'] },
    { key: 'population', label: '家庭人口', aliases: ['人口', '人口数', '人数', '家庭人口', '计发人口'] },
    { key: 'acreage', label: '实际亩数', aliases: ['亩数', '面积', '土地面积', '实际亩数', '计发亩数', '承包面积'] },
    { key: 'unitPrice', label: '单价', aliases: ['单价', '每人金额', '每亩单价', '每亩/元', '每人/元', '标准'] },
    { key: 'amount', label: '金额', aliases: ['金额', '应发金额', '发放金额', '实发金额', '合计金额', '租金', '租金（元）'] },
    { key: 'bankCard', label: '银行卡号', aliases: ['卡号', '银行卡号', '银行账号', '民丰银行账号', '银行账户', '账号', '收款卡号', '一卡通号'] },
    { key: 'bankName', label: '开户行', aliases: ['开户行', '银行名称', '开户银行'] },
    { key: 'notes', label: '备注', aliases: ['备注', '说明', '代收说明'] },
    { key: 'signature', label: '签字', aliases: ['签章', '签字', '签名', '签字/按手印'] },
  ];
  const fieldFor = (header) => FIELDS.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(header)))?.key || '';
  const numericKeys = new Set(['population', 'acreage', 'unitPrice', 'amount']);
  const footerLabel = /^(?:(?:合计|总计|小计|共计)(?:[：:].*)?|(?:群众代表签字|群众代表签名|群众代表|制表人|制表|审批人|审批|审核人|审核|经办人|经办|负责人|签字|签名|备注|说明)(?:[：:].*)?)$/u;

  function inferredField(header) { return fieldFor(header); }
  function parseNumber(value) {
    const cleaned = text(value).replace(/[￥¥元,，\s人口亩]/gu, '');
    if (!cleaned) return '';
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : text(value);
  }
  function exclusionReason(source, nameColumns) {
    if (!source.some((cell) => text(cell))) return '空白行';
    const first = source.findIndex((cell) => text(cell));
    if ([first, ...nameColumns].some((column) => column !== undefined && column >= 0 && footerLabel.test(text(source[column])))) return '合计、签字或说明行';
    if (!nameColumns.some((column) => column !== undefined && text(source[column]))) return '缺少户主或收款人，待核对';
    return '';
  }
  function uniqueColumns(values = []) {
    const used = new Map();
    return values.map((value, index) => {
      const base = text(value) || `未命名列${index + 1}`; const count = (used.get(base) || 0) + 1; used.set(base, count);
      return count === 1 ? base : `${base}（${count}）`;
    });
  }
  function mappingPreview(grid) {
    const firstContent = grid.findIndex((row) => row?.some((cell) => text(cell)));
    const row = firstContent >= 0 ? grid[firstContent] : [];
    return { requiresMapping: true, columns: uniqueColumns(row), sampleRows: grid.slice(Math.max(0, firstContent), Math.max(0, firstContent) + 8), rawGrid: grid, rows: [], excludedRows: [], total: 0 };
  }

  function controlTotalsFor(grid, headerIndex, fields, excludedRows) {
    const totals = { population: null, acreage: null, amount: null, unitPrice: null };
    const totalRow = excludedRows.find((entry) => /合计|总计|小计|共计/u.test(text(entry.values?.[0])));
    for (const key of Object.keys(totals)) {
      const column = fields[key]; const value = column === undefined ? '' : totalRow?.values?.[column];
      const parsed = parseNumber(value);
      if (typeof parsed === 'number') totals[key] = parsed;
    }
    const footerText = grid.slice(headerIndex + 1).flat().map(text).filter(Boolean).join('；');
    if (totals.acreage === null) {
      const match = footerText.match(/(?:共|合计|总计)\s*([0-9]+(?:\.[0-9]+)?)\s*亩/u);
      if (match) totals.acreage = Number(match[1]);
    }
    if (totals.population === null) {
      const match = footerText.match(/(?:共|合计|总计)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:人|口)/u);
      if (match) totals.population = Number(match[1]);
    }
    if (totals.unitPrice === null) {
      const match = footerText.match(/每(?:亩|人|口)\s*(?:为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*元/u);
      if (match) totals.unitPrice = Number(match[1]);
    }
    if (totals.amount === null) {
      const match = footerText.match(/(?:共|合计|总计)\s*([0-9]+(?:\.[0-9]+)?)\s*元/u);
      if (match) totals.amount = Number(match[1]);
    }
    return totals;
  }

  function parseContractFeeExcelGrid(grid, mapping) {
    if (!Array.isArray(grid) || !grid.length) throw new Error('表格内容为空');
    let headerIndex = -1; let fields = {};
    for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
      const mapped = {};
      (grid[index] || []).forEach((cell, column) => { const field = fieldFor(cell); if (field && mapped[field] === undefined) mapped[field] = column; });
      const hasName = mapped.householderName !== undefined || mapped.recipientName !== undefined || mapped.name !== undefined;
      if (hasName && Object.keys(mapped).length >= 2) { headerIndex = index; fields = mapped; break; }
    }
    if (mapping) { headerIndex = Math.max(-1, Number(mapping.headerRowNumber || 0) - 1); fields = structuredClone(mapping.fields || {}); }
    if (headerIndex < 0) return mappingPreview(grid);
    const headerRow = grid[headerIndex] || [];
    let lastMeaningfulColumn = -1;
    for (let column = 0; column < Math.max(headerRow.length, ...grid.slice(headerIndex + 1).map((row) => row?.length || 0)); column += 1) {
      if (grid.slice(headerIndex).some((row) => text(row?.[column]))) lastMeaningfulColumn = column;
    }
    const sourceHeaders = headerRow.slice(0, lastMeaningfulColumn + 1).map(text); const columns = uniqueColumns(sourceHeaders);
    const nameColumns = [fields.householderName, fields.recipientName, fields.name];
    if (!nameColumns.some((column) => column !== undefined)) return mappingPreview(grid);
    const rows = []; const excludedRows = [];
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const source = Array.isArray(grid[index]) ? grid[index] : [];
      const reason = exclusionReason(source, nameColumns);
      if (reason) { excludedRows.push({ sourceRowNumber: index + 1, reason, values: source.slice() }); continue; }
      const rawData = {}; source.forEach((value, column) => { rawData[columns[column] || `未命名列${column + 1}`] = text(value); });
      const row = { id: `import-row-${index + 1}`, sourceRowId: `source-row-${index + 1}`, sourceRowNumber: index + 1, rawData, sourceData: structuredClone(rawData), customData: {} };
      for (const field of FIELDS) {
        const raw = fields[field.key] === undefined ? '' : source[fields[field.key]];
        row[field.key] = numericKeys.has(field.key) ? parseNumber(raw) : text(raw);
      }
      row.householderName = text(row.householderName || row.name || row.recipientName);
      row.recipientName = text(row.recipientName || row.name || row.householderName);
      row.name = row.recipientName;
      row.bankCard = text(row.bankCard).replace(/[\s-]/gu, '');
      columns.forEach((column, columnIndex) => {
        if (!Object.values(fields).includes(columnIndex)) row.customData[column] = text(source[columnIndex]);
      });
      rows.push(row);
    }
    if (!rows.length) throw new Error('表格中没有可导入的家庭记录');
    const mappedColumns = new Set(Object.values(fields));
    const fieldByColumn = new Map(Object.entries(fields).map(([key, column]) => [Number(column), key]));
    const outputColumns = sourceHeaders.map((header, index) => ({
      index, header: header || `未命名列${index + 1}`, sourceKey: columns[index], fieldKey: fieldByColumn.get(index) || '',
    }));
    return {
      requiresMapping: false, fields, columns, customColumns: columns.filter((column, index) => !mappedColumns.has(index)), rows,
      total: rows.length, headerRowNumber: headerIndex + 1, ignoredRows: excludedRows.length, excludedRows, rawGrid: grid,
      titleRows: grid.slice(0, headerIndex).map((row) => Array.isArray(row) ? row.slice() : []), outputColumns,
      controlTotals: controlTotalsFor(grid, headerIndex, fields, excludedRows),
    };
  }

  const api = { FIELDS, normalizeHeader, inferredField, parseContractFeeExcelGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContractFeeExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
