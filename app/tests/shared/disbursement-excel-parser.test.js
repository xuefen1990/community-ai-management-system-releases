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
