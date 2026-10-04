'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parsePersonnelExcelGrid, parseDisbursementRosterExcelGrid } = require('../../src/shared/personnel-excel-parser');

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

test('recognizes the public identity-card header used by party member spreadsheets', () => {
  const result = parsePersonnelExcelGrid([
    ['姓名', '公民身份证号码', '加入党组织日期'],
    ['张三', '11010519491231002X', '2007/07/01'],
  ]);
  assert.equal(result.idCardColumn, '公民身份证号码');
  assert.equal(result.total, 1);
});

test('rejects a recognized header that has no valid personnel rows', () => {
  assert.throws(() => parsePersonnelExcelGrid([
    ['姓名', '身份证号'],
    ['合计', '2 人'],
    ['填表人', '王主任'],
  ]), /没有可导入的有效人员数据/u);
});

test('accepts a payment roster without identity cards and skips totals and signers', () => {
  const result = parseDisbursementRosterExcelGrid([
    ['2026年第一季度农村公共服务运行维护人员报酬发放表'],
    ['单位：陆庄社区', '', '2026年4月5日', '', '单位：元'],
    ['序号', '姓 名', '负责区域', '账 号', '金额', '备注'],
    [1, '张德侠', '东二组庄台', '3213020321010000046471', '2100', ''],
    [2, '王美华', '东三组庄台', '3213023601109003224697', '2100', ''],
    ['合 计', '', '合计', '', '4200', ''],
    ['审批人：', '', '', '制表人：', '', ''],
  ]);
  assert.equal(result.headerRowNumber, 3);
  assert.equal(result.total, 2);
  assert.equal(result.ignoredRows, 2);
  assert.equal(result.rows[0]['姓 名'], '张德侠');
  assert.equal(result.rows[0]['账 号'], '3213020321010000046471');
  assert.equal(result.rows[1]['金额'], '2100');
  assert.throws(() => parsePersonnelExcelGrid([
    ['姓名', '负责区域', '账号', '金额'],
    ['张德侠', '东二组庄台', '3213020321010000046471', '2100'],
  ]), /身份证号/u);
});
