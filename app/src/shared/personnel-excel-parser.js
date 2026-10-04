'use strict';

(function exposePersonnelExcelParser(root) {
  const FIELD_DEFINITIONS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '村民姓名', '人员姓名', '名字'] },
    { key: 'idCard', label: '身份证号', aliases: ['身份证号', '身份证号码', '公民身份号码', '公民身份证号码', '证件号码'], required: true },
    { key: 'gender', label: '性别', aliases: ['性别'] },
    { key: 'birth_date', label: '出生日期', aliases: ['出生日期', '出生年月', '生日'] },
    { key: 'phone', label: '联系电话', aliases: ['联系电话', '手机号码', '手机号', '电话', '联系方式'] },
    { key: 'household_id', label: '户号', aliases: ['户号', '家庭户号', '家庭编号'] },
    { key: 'village_group', label: '村民小组', aliases: ['村民小组', '村组', '小组', '组别'] },
    { key: 'relation_to_head', label: '与户主关系', aliases: ['与户主关系', '户主关系', '关系'] },
    { key: 'address', label: '住址', aliases: ['住址', '地址', '详细地址'] },
  ];
  const text = (value) => String(value ?? '').trim();
  const normalizeHeader = (value) => text(value).replace(/[\s_（）()\-]/g, '').toLocaleLowerCase('zh-CN');
  const normalizeIdCard = (value) => text(value).replace(/\s/g, '').toUpperCase();
  const idCardWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const idCardChecks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  function isValidIdCard(value) {
    const idCard = normalizeIdCard(value);
    if (!/^\d{17}[\dX]$/u.test(idCard)) return false;
    const sum = idCardWeights.reduce((total, weight, index) => total + Number(idCard[index]) * weight, 0);
    return idCardChecks[sum % 11] === idCard[17];
  }

  function fieldForHeader(value) {
    const header = normalizeHeader(value);
    if (!header) return null;
    return FIELD_DEFINITIONS.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === header)) || null;
  }

  function findHeaderRow(grid) {
    const candidates = (Array.isArray(grid) ? grid : []).slice(0, 20)
      .map((row, index) => {
        const matchedFields = new Set((Array.isArray(row) ? row : []).map(fieldForHeader).filter(Boolean).map((field) => field.key));
        return { index, matchedFields };
      })
      .filter((candidate) => candidate.matchedFields.size > 0)
      .sort((left, right) => right.matchedFields.size - left.matchedFields.size || left.index - right.index);
    const best = candidates[0];
    if (!best || (!best.matchedFields.has('idCard') && best.matchedFields.size < 2)) return null;
    return best.index;
  }

  function uniqueColumns(headerRow) {
    const used = new Set();
    return (Array.isArray(headerRow) ? headerRow : []).map((value, index) => {
      const base = text(value) || `未命名列${index + 1}`;
      let column = base;
      let suffix = 2;
      while (used.has(column)) column = `${base}_${suffix++}`;
      used.add(column);
      return column;
    });
  }

  function parsePersonnelExcelGrid(grid) {
    const table = Array.isArray(grid) ? grid : [];
    const headerRowIndex = findHeaderRow(table);
    if (headerRowIndex === null) throw new Error('未识别到人员表头，请确认表中包含“身份证号”或至少两个支持字段名称');
    const columns = uniqueColumns(table[headerRowIndex]);
    const idCardColumnIndex = columns.findIndex((column) => fieldForHeader(column)?.key === 'idCard');
    if (idCardColumnIndex < 0) throw new Error('未识别到身份证号列，请确认表头字段名称');
    const rows = [];
    let ignoredRows = 0;
    table.slice(headerRowIndex + 1).forEach((values) => {
      const row = Array.isArray(values) ? values : [];
      if (!row.some((value) => text(value))) return;
      if (!isValidIdCard(row[idCardColumnIndex])) {
        ignoredRows += 1;
        return;
      }
      rows.push(Object.fromEntries(columns.map((column, index) => [column, text(row[index])])));
    });
    if (!rows.length) throw new Error('表格没有可导入的有效人员数据');
    return {
      columns,
      rows,
      total: rows.length,
      headerRowIndex,
      headerRowNumber: headerRowIndex + 1,
      idCardColumn: columns[idCardColumnIndex],
      ignoredRows,
    };
  }

  function parseDisbursementRosterExcelGrid(grid) {
    const table = Array.isArray(grid) ? grid : [];
    const nameHeaders = ['姓名', '村民姓名', '人员姓名', '户主姓名', '收款人', '领款人', '名字'];
    const rosterHeaders = new Set([...nameHeaders, '身份证号', '身份证号码', '负责区域', '岗位', '职务', '村民小组', '组别', '所属组别', '账号', '账户', '银行账号', '银行账户', '收款账号', '银行卡号', '卡号', '一卡通号', '金额', '发放金额', '应发金额', '补贴金额', '实发金额', '月工资', '标准', '单价', '备注']);
    const candidates = table.slice(0, 30).map((row, index) => {
      const names = (Array.isArray(row) ? row : []).map(normalizeHeader);
      return { index, score: names.filter((name) => rosterHeaders.has(name)).length, hasName: names.some((name) => nameHeaders.includes(name)) };
    }).filter((candidate) => candidate.hasName && candidate.score >= 2)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const headerRowIndex = candidates[0]?.index;
    if (headerRowIndex === undefined) throw new Error('未识别到发放名单表头，请确认表中包含“姓名”及账号、金额或负责区域等字段');
    const columns = uniqueColumns(table[headerRowIndex]);
    const nameIndex = columns.findIndex((column) => nameHeaders.includes(normalizeHeader(column)));
    const rows = [];
    let ignoredRows = 0;
    for (const values of table.slice(headerRowIndex + 1)) {
      const row = Array.isArray(values) ? values : [];
      if (!row.some((value) => text(value))) continue;
      const name = text(row[nameIndex]);
      if (!name || /^(合\s*计|总\s*计|小\s*计|审批人|制表人|填表人|单位|备注)/u.test(name) || ['姓名', '村民姓名', '人员姓名'].includes(normalizeHeader(name))) { ignoredRows += 1; continue; }
      rows.push(Object.fromEntries(columns.map((column, index) => [column, text(row[index])])));
    }
    if (!rows.length) throw new Error('表格中没有可导入的人员姓名');
    return { columns, rows, total: rows.length, headerRowIndex, headerRowNumber: headerRowIndex + 1, ignoredRows };
  }

  const api = { FIELD_DEFINITIONS, normalizeHeader, normalizeIdCard, isValidIdCard, parsePersonnelExcelGrid, parseDisbursementRosterExcelGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PersonnelExcelParser = api;
}(typeof window !== 'undefined' ? window : null));
