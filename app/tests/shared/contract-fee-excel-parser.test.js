'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseContractFeeExcelGrid } = require('../../src/shared/contract-fee-excel-parser');

test('recognizes a contract fee header after title rows and filters totals', () => {
  const result = parseContractFeeExcelGrid([
    ['某某地方土地租金发放表'],
    ['序号', '姓名', '人口数', '单价', '应发金额', '银行卡号'],
    [1, '张三', 3, 100, 300, '6222 0001'],
    [2, '李四', 2, 100, 200, '6222-0002'],
    ['合计', '', 5, '', 500, ''],
    ['填表人：王主任'],
  ]);
  assert.equal(result.headerRowNumber, 2);
  assert.equal(result.total, 2);
  assert.equal(result.ignoredRows, 2);
  assert.equal(result.rows[0].householderName, '张三');
  assert.equal(result.rows[0].recipientName, '张三');
  assert.equal(result.rows[0].population, 3);
  assert.equal(result.rows[0].bankCard, '62220001');
  assert.equal(result.excludedRows[0].reason, '合计、签字或说明行');
});

test('keeps a group column for mixed-group contract fee worksheets', () => {
  const parsed = parseContractFeeExcelGrid([
    ['地块承包费发放明细'],
    ['组别', '姓名', '人口', '金额', '银行卡号'],
    ['东一组', '张三', 3, 300, '62220001'],
    ['东二组', '李四', 2, 200, '62220002'],
  ]);
  assert.deepEqual(parsed.rows.map((row) => row.groupName), ['东一组', '东二组']);
});

test('recognizes acreage aliases and numeric text', () => {
  const result = parseContractFeeExcelGrid([
    ['户名', '实际亩数', '每亩单价', '发放金额', '账号'],
    ['王五', '2.5亩', '120元', '300.00元', '6222 0003'],
  ]);
  assert.equal(result.rows[0].acreage, 2.5);
  assert.equal(result.rows[0].unitPrice, 120);
  assert.equal(result.rows[0].amount, 300);
});

test('rejects unrelated and empty sheets', () => {
  assert.equal(parseContractFeeExcelGrid([['普通名单'], ['张三']]).requiresMapping, true);
  assert.throws(() => parseContractFeeExcelGrid([['姓名', '金额'], ['合计', 0]]), /没有可导入/u);
});

test('keeps custom columns, repeated headings, source rows and full bank-card text', () => {
  const result = parseContractFeeExcelGrid([
    ['户主', '收款人', '村民组', '人数', '银行卡号', '开户行', '果树棵数', '果树棵数', ''],
    ['李四', '张三', '一组', 4, '00123456789012345678', '农商行', 12, 3, '代收'],
    ['王五', '张三', '一组', 2, '00123456789012345678', '农商行', 8, 1, '代收'],
  ]);
  assert.deepEqual(result.columns.slice(6), ['果树棵数', '果树棵数（2）', '未命名列9']);
  assert.equal(result.rows[0].rawData['果树棵数（2）'], '3');
  assert.equal(result.rows[0].customData['未命名列9'], '代收');
  assert.equal(result.rows[0].sourceRowNumber, 2);
  assert.equal(result.rows[0].bankCard, '00123456789012345678');
  assert.equal(result.rows.length, 2);
});

test('accepts explicit Chinese column mapping without guessing positions', () => {
  const grid = [['基础台账'], ['甲', '乙', '丙'], ['一组', '赵六', '00001234']];
  const preview = parseContractFeeExcelGrid(grid);
  assert.equal(preview.requiresMapping, true);
  const result = parseContractFeeExcelGrid(grid, { headerRowNumber: 2, fields: { groupName: 0, householderName: 1, bankCard: 2 } });
  assert.equal(result.requiresMapping, false);
  assert.equal(result.rows[0].householderName, '赵六');
  assert.equal(result.rows[0].bankCard, '00001234');
});

test('keeps the imported column template and reads acreage control totals from a rent ledger', () => {
  const result = parseContractFeeExcelGrid([
    ['2025年度东一组大枣园土地租金发放明细'],
    ['', '', '', '', '', '2025.3.15-2026.3.15'],
    ['序号', '姓名', '面积', '每亩/元', '租金\n（元）', '民丰银行账号', '签章'],
    [1, '张三', 1.5, 750, 1125, '00123456789012345678', ''],
    [2, '李四', 2, 750, 1500, '00123456789012345679', ''],
    ['合计', '', 3.5, '', 2625, '', ''],
    ['分配方案：共2625元，按照各家土地进行分配，共3.5亩，每亩750元'],
  ]);
  assert.equal(result.fields.sequence, 0);
  assert.equal(result.fields.unitPrice, 3);
  assert.equal(result.fields.amount, 4);
  assert.equal(result.fields.signature, 6);
  assert.deepEqual(result.controlTotals, { population: null, acreage: 3.5, amount: 2625, unitPrice: 750 });
  assert.deepEqual(result.outputColumns.map((column) => column.header), ['序号', '姓名', '面积', '每亩/元', '租金\n（元）', '民丰银行账号', '签章']);
  assert.deepEqual(result.outputColumns.map((column) => column.fieldKey), ['sequence', 'name', 'acreage', 'unitPrice', 'amount', 'bankCard', 'signature']);
  assert.equal(result.titleRows[0][0], '2025年度东一组大枣园土地租金发放明细');
});

test('drops formatting-only trailing columns but keeps unnamed columns that contain data', () => {
  const result = parseContractFeeExcelGrid([
    ['姓名', '面积', '银行卡号', '', '', ''],
    ['张三', 1.5, '00123', '需要保留', '', ''],
    ['合计', 1.5, '', '', '', ''],
  ]);
  assert.deepEqual(result.outputColumns.map((column) => column.header), ['姓名', '面积', '银行卡号', '未命名列4']);
  assert.equal(result.rows[0].customData['未命名列4'], '需要保留');
});
