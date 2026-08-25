'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parsePersonnelExcelGrid } = require('../../src/shared/personnel-excel-parser');

test('recognizes a personnel header after title rows and excludes invalid footer rows', () => {
  const result = parsePersonnelExcelGrid([
    ['青山村 2026 年专项人员花名册'],
    ['填表说明：请核对人员身份证号'],
    ['姓名', '身份证号', '联系电话'],
    ['张三', '11010519491231002X', '13800000000'],
    ['合计', '1 人'],
    ['填表人：王主任'],
  ]);

  assert.equal(result.headerRowNumber, 3);
  assert.equal(result.idCardColumn, '身份证号');
  assert.equal(result.ignoredRows, 2);
  assert.deepEqual(result.rows, [{ 姓名: '张三', 身份证号: '11010519491231002X', 联系电话: '13800000000' }]);
});

test('keeps a standard first-row header and rejects a grid without a personnel header', () => {
  const result = parsePersonnelExcelGrid([
    ['姓名', '身份证号'],
    ['李四', '11010519491231002X'],
  ]);
  assert.equal(result.headerRowNumber, 1);
  assert.equal(result.total, 1);
  assert.throws(() => parsePersonnelExcelGrid([['青山村人员名册'], ['张三', '11010519491231002X']]), /未识别到人员表头/u);
});

test('rejects a recognized header that has no valid personnel rows', () => {
  assert.throws(() => parsePersonnelExcelGrid([
    ['姓名', '身份证号'],
    ['合计', '2 人'],
    ['填表人', '王主任'],
  ]), /没有可导入的有效人员数据/u);
});
