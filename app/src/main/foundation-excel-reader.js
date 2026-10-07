'use strict';
const path = require('node:path');
const XLSX = require('xlsx');
const { fail } = require('./foundation-data-model');
const HEADER_TERMS = new Set(['姓名', '居民姓名', '村民姓名', '人员姓名', '身份证号', '身份证号码', '户号', '居民小组', '村民小组', '小组', '联系电话', '性别',
  '地块编号', '地块名称', '承包人', '承包方', '面积', '面积亩', '土地类型', '合同开始时间', '合同结束时间', '来访人', '来访日期', '工单编号', '事项内容']);
const normalize = value => String(value ?? '').trim().replace(/[\s（）()]/g, '');
function parseFoundationGrid(grid) {
  if (!Array.isArray(grid)) fail('INVALID_EXCEL', '表格内容不正确');
  const candidates = grid.slice(0, 30).map((row, index) => ({ index, count: row.filter(value => String(value ?? '').trim()).length,
    score: row.reduce((total, value) => total + Number(HEADER_TERMS.has(normalize(value))), 0) })).filter(item => item.count);
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const header = candidates[0];
  if (!header) fail('INVALID_EXCEL', '表格为空');
  const used = new Set();
  const headers = grid[header.index].map((value, index) => {
    const base = String(value ?? '').trim() || `未命名列${index + 1}`; let name = base, suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name); return name;
  });
  const allRows = grid.slice(header.index + 1).filter(row => row.some(value => String(value ?? '').trim()))
    .map(row => Object.fromEntries(headers.map((name, index) => [name, String(row[index] ?? '').trim()])));
  return { headers, allRows, totalRows: allRows.length, headerRowNumber: header.index + 1 };
}
function readFoundationExcel(value) {
  const file = typeof value === 'string' ? value : value?.filePath || value?.path;
  if (!file || !['.xlsx', '.xls', '.csv'].includes(path.extname(file).toLowerCase())) fail('INVALID_EXCEL', '请选择 Excel 或 CSV 表格');
  const workbook = XLSX.readFile(file, { cellDates: true, raw: false });
  if (!workbook.SheetNames.length) fail('INVALID_EXCEL', '表格没有工作表');
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false });
  return { ...parseFoundationGrid(grid), fileName: path.basename(file), sheetNames: workbook.SheetNames, sheetCount: workbook.SheetNames.length };
}
module.exports = { readFoundationExcel, parseFoundationGrid };
