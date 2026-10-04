'use strict';

(function exposeDisbursementExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalizeHeader = (value) => text(value).replace(/[\s_（）()\-:：]/gu, '').toLowerCase();
  const FIELDS = [
    ['name', '姓名', ['姓名', '户主姓名', '人员姓名', '收款人']], ['idCard', '身份证号', ['身份证号', '身份证', '证件号码']],
    ['groupName', '组别', ['组别', '村民组', '居民组']], ['bankCard', '银行卡号', ['银行卡号', '银行账号', '一卡通号', '卡号', '账号']],
    ['amount', '金额', ['金额', '实发金额', '发放金额', '应发金额']], ['unitPrice', '单价', ['单价', '月标准', '元月', '元/月', '月/元', '标准']],
    ['quantity', '数量', ['数量', '工日', '人口', '人数', '人口数', '人口数量', '补贴人口', '面积', '亩数', '面积亩', '承包面积亩', '补贴面积亩', '面积/人口', '人口/面积', '亩数/人口', '人口/亩数', '面积人口', '人口亩数']], ['months', '月份', ['月份', '合计月份', '月数']],
    ['role', '职务', ['职务', '岗位']], ['workDate', '用工日期', ['用工日期', '日期']], ['workItem', '用工事项', ['用工事项', '事项', '工作内容']],
    ['responsibilityArea', '负责区域', ['负责区域', '责任区域']], ['phone', '手机号', ['手机号', '电话', '联系电话']], ['remark', '备注', ['备注', '说明']],
  ].map(([key, label, aliases]) => ({ key, label, aliases }));
  const fieldFor = (header) => FIELDS.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(header)))?.key || '';
  // Only known standalone labels (or labels followed by a colon) count as footers.
  // In particular, a resident name beginning with 审、制 or 经 must remain a person.
  const footerLabel = /^(?:(?:合计|总计|小计)(?:[：:].*)?|(?:群众代表签字|群众代表签名|群众代表|制表人|制表|审批人|审批|审核人|审核|经办人|经办|负责人|签字|签名|备注|说明)(?:[：:].*)?)$/u;
  const numericText = (value) => /^[-+]?\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?$/u.test(value) ? value.replace(/[,，]/gu, '') : value;
  function detectedHeader(source = []) {
    const mapped = {};
    source.forEach((cell, column) => {
      const field = fieldFor(cell);
      if (!field) return;
      // “实发金额 / 月份 / 金额”同时出现时，末列金额才是本期合计。
      if (mapped[field] === undefined || (field === 'amount' && normalizeHeader(cell) === '金额')) mapped[field] = column;
    });
    return mapped.name !== undefined && Object.keys(mapped).length >= 2 ? mapped : null;
  }
  function sectionHeading(grid, headerIndex, previousHeaderIndex) {
    const start = Math.max(previousHeaderIndex + 1, headerIndex - 8);
    const lines = grid.slice(start, headerIndex).map((row) => (row || []).map(text).filter(Boolean).join(' '));
    const title = [...lines].reverse().find((line) => /(?:发放表|结算单|工资表|补贴表)/u.test(line) && !/^(?:合计|总计)/u.test(line)) || '';
    const dateText = [...lines].reverse().find((line) => /20\d{2}\s*[年/-]\s*\d{1,2}/u.test(line)) || '';
    const match = dateText.match(/(20\d{2})\s*[年/-]\s*(\d{1,2})(?:\s*[月/-]\s*(\d{1,2}))?/u);
    const date = match ? `${match[1]}-${match[2].padStart(2, '0')}-${(match[3] || '01').padStart(2, '0')}` : '';
    return { title, date };
  }
  function exclusionReason(source, nameColumn) {
    if (!source.some((cell) => text(cell))) return '空白行';
    const first = source.findIndex((cell) => text(cell));
    if ([first, nameColumn].some((column) => column !== undefined && footerLabel.test(text(source[column])))) return '合计、签字或说明行';
    if (!text(source[nameColumn])) return '缺少姓名，待核对';
    return '';
  }
  function parseDisbursementExcelGrid(grid, mapping) {
    if (!Array.isArray(grid) || !grid.length) throw new Error('表格内容为空');
    const headers = [];
    for (let index = 0; index < grid.length; index += 1) {
      const fields = detectedHeader(grid[index]);
      if (fields) headers.push({ index, fields });
    }
    if (mapping) {
      const index = Math.max(-1, Number(mapping.headerRowNumber || 0) - 1);
      if (mapping.fields?.name === undefined) throw new Error('请对应姓名列');
      const first = headers.findIndex((header) => header.index >= index);
      headers.splice(0, first < 0 ? headers.length : first);
      if (headers[0]?.index === index) headers[0] = { index, fields: mapping.fields };
      else headers.unshift({ index, fields: mapping.fields });
    }
    if (!headers.length) return { requiresMapping: true, columns: (grid.find((row) => row?.some((cell) => text(cell))) || []).map(text), sampleRows: grid.slice(0, 8), rawGrid: grid, rows: [], sections: [], excludedRows: [] };
    const rows = []; const excludedRows = []; const sections = [];
    headers.forEach(({ index: headerIndex, fields }, sectionIndex) => {
      const columns = (grid[headerIndex] || []).map(text);
      const heading = sectionHeading(grid, headerIndex, headers[sectionIndex - 1]?.index ?? -1);
      const section = { sectionIndex, headerRowNumber: headerIndex + 1, fields, columns, ...heading, rows: [], excludedRows: [], controlTotal: '' };
      const end = headers[sectionIndex + 1]?.index ?? grid.length;
      for (let index = headerIndex + 1; index < end; index += 1) {
        const source = grid[index] || [];
        const first = source.findIndex((cell) => text(cell));
        if (first >= 0 && /^(?:合计|总计)\s*$/u.test(text(source[first]))) section.controlTotal = numericText(text(source[fields.amount]));
        const reason = exclusionReason(source, fields.name) || (source.filter((cell) => text(cell)).length <= 2 && /(?:发放表|结算单|工资表|补贴表)/u.test(text(source[fields.name])) ? '表格标题' : '');
        if (reason) { const excluded = { sourceRowNumber: index + 1, reason, values: source.slice() }; excludedRows.push(excluded); section.excludedRows.push(excluded); continue; }
        const row = { id: `disbursement-import-${sectionIndex + 1}-${index + 1}`, sectionIndex, sourceRowNumber: index + 1, rawData: {} };
        source.forEach((value, column) => {
          const label = columns[column] || `未命名列${column + 1}`;
          let key = label; let suffix = 2;
          while (Object.prototype.hasOwnProperty.call(row.rawData, key)) key = `${label}（${suffix++}）`;
          row.rawData[key] = text(value);
        });
        FIELDS.forEach((field) => {
          const value = fields[field.key] === undefined ? '' : text(source[fields[field.key]]);
          row[field.key] = ['amount', 'unitPrice', 'quantity', 'months'].includes(field.key) ? numericText(value) : value;
          if (!Object.prototype.hasOwnProperty.call(row.rawData, field.label)) row.rawData[field.label] = value;
        });
        row.bankCard = row.bankCard.replace(/[\s-]/gu, '');
        if (row.name) { section.rows.push(row); rows.push(row); }
      }
      sections.push(section);
    });
    if (!rows.length) throw new Error('表格中没有可导入的发放人员');
    const first = sections[0];
    return { requiresMapping: false, headerRowNumber: first.headerRowNumber, fields: first.fields, columns: first.columns, rows, sections, total: rows.length, rawGrid: grid, excludedRows };
  }
  const api = { FIELDS, normalizeHeader, parseDisbursementExcelGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DisbursementExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
