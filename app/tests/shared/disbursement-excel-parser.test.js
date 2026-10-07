'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDisbursementExcelGrid } = require('../../src/shared/disbursement-excel-parser');

test('reads common disbursement rows and retains bank cards as text', () => {
  const result = parseDisbursementExcelGrid([['村级务工补贴发放表'], ['序号', '姓名', '用工事项', '工日', '单价', '金额', '银行账号'], [1, '张三', '清运', 2, 100, 200, '6230 6673 3100 0001'], ['合计', '', '', '', '', 200, '']]);
  assert.equal(result.requiresMapping, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].bankCard, '6230667331000001');
  assert.equal(result.rows[0].workItem, '清运');
});

test('asks for field mapping rather than guessing an unknown worksheet', () => {
  const result = parseDisbursementExcelGrid([['说明'], ['甲', '乙'], ['张三', 100]]);
  assert.equal(result.requiresMapping, true);
  assert.deepEqual(result.rows, []);
});

test('excludes signature and total rows in the name column with review metadata', () => {
  const result = parseDisbursementExcelGrid([
    ['序号', '姓名', '金额'], [1, '审明', 50], [2, '群众代表签字：', ''],
    ['', '合计', 50], [3, '', 20], [4, '审批华', 40],
  ]);
  assert.deepEqual(result.rows.map((row) => row.name), ['审明', '审批华']);
  assert.deepEqual(result.excludedRows.map((row) => row.sourceRowNumber), [3, 4, 5]);
  assert.equal(result.excludedRows[2].reason, '缺少姓名，待核对');
  assert.deepEqual(result.excludedRows[0].values, [2, '群众代表签字：', '']);
});

test('retains custom and duplicate fields, normalizes only numeric quantities and preserves original text', () => {
  const result = parseDisbursementExcelGrid([
    ['姓名', '面积/人口', '单价', '金额', '银行卡号', '地块名称', '地块名称'],
    ['张三', '1,234.50', '130', '160,485.00', '0012 3456 7890 1234', '北田', '南田'],
  ]);
  const row = result.rows[0];
  assert.equal(row.quantity, '1234.50');
  assert.equal(row.amount, '160485.00');
  assert.equal(row.bankCard, '0012345678901234');
  assert.equal(row.rawData['面积/人口'], '1,234.50');
  assert.equal(row.rawData['金额'], '160,485.00');
  assert.equal(row.rawData['地块名称'], '北田');
  assert.equal(row.rawData['地块名称（2）'], '南田');
});

test('manual mapping retains the whole worksheet beyond eighty rows', () => {
  const grid = [['甲', '乙'], ...Array.from({ length: 150 }, (_, index) => [`居民${index}`, index])];
  const result = parseDisbursementExcelGrid(grid);
  assert.equal(result.requiresMapping, true);
  assert.equal(result.rawGrid.length, 151);
  assert.deepEqual(result.rawGrid[150], ['居民149', 149]);
});

test('recognizes repeated salary tables in one worksheet and uses the final amount column', () => {
  const grid = [
    ['湖滨新区工资结算单'], ['编制单位：陆庄居委会', '', '时间：2026年9月22日'],
    ['序号', '姓 名', '职务', '月/元', '月份', '金额', '账 号', '备注'],
    [1, '张三', '组长', 800, 3, 2400, '0012 3456', ''], ['合计', '', '', '', '', 2400],
    ['审批人：', '', '', '', '', '制单人：'], ['湖滨新区工资结算单'],
    ['编制单位：陆庄居委会', '', '时间：2026年9月22日'],
    ['序号', '姓 名', '职务', '实发金额', '月份', '金额', '账 号', '备注'],
    [1, '李四', '临干', 2200, 3, 6600, '9876 5432', ''], ['合计', '', '', '', '', 6600],
  ];
  const parsed = parseDisbursementExcelGrid(grid);
  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(parsed.rows.map((row) => [row.name, row.amount, row.bankCard]), [['张三', '2400', '00123456'], ['李四', '6600', '98765432']]);
  assert.equal(parsed.sections[0].date, '2026-09-22');
  assert.equal(parsed.sections[1].controlTotal, '6600');
  assert.equal(parsed.sections[1].headerRowNumber, 9);
});
