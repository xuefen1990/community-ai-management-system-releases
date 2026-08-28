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
  assert.deepEqual(result.rows[0], { id: 'import-row-3', sourceRowNumber: 3, name: '张三', population: 3, acreage: '', unitPrice: 100, amount: 300, bankCard: '62220001' });
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
  assert.throws(() => parseContractFeeExcelGrid([['普通名单'], ['张三']]), /未识别到承包费表头/u);
  assert.throws(() => parseContractFeeExcelGrid([['姓名', '金额'], ['合计', 0]]), /没有可导入/u);
});
