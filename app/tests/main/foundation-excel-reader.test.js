'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFoundationGrid } = require('../../src/main/foundation-excel-reader');
test('reference Excel import keeps invalid/missing resident IDs for the preview to report instead of silently dropping rows', () => {
  const result = parseFoundationGrid([['合成导入清单'], ['姓名', '身份证号', '户号'], ['合成甲', 'SYNTHETIC-ID', '001'], ['合成乙', '', '002']]);
  assert.equal(result.headerRowNumber, 2); assert.equal(result.totalRows, 2);
  assert.deepEqual(result.allRows, [{ 姓名: '合成甲', 身份证号: 'SYNTHETIC-ID', 户号: '001' }, { 姓名: '合成乙', 身份证号: '', 户号: '002' }]);
});
test('land imports have independent headers and do not require a resident identity-card column', () => {
  const result = parseFoundationGrid([['合成土地表'], ['地块编号', '地块名称', '面积（亩）', '承包人'], ['0001', '合成地块', '2.5', '合成合作社']]);
  assert.equal(result.headerRowNumber, 2); assert.equal(result.allRows[0]['地块编号'], '0001'); assert.equal(result.totalRows, 1);
});
test('duplicate column labels remain individually mappable', () => {
  assert.deepEqual(parseFoundationGrid([['姓名', '备注', '备注'], ['合成', 'A', 'B']]).headers, ['姓名', '备注', '备注_2']);
});
