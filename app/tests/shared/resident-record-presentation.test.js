const assert = require('node:assert/strict');
const test = require('node:test');
const presentation = require('../../src/shared/resident-record-presentation.js');

test('把来源编码转换为中文名称并保留原始值', () => {
  assert.equal(presentation.sourceLabel('farmland_subsidy_import'), '土地补贴导入');
  assert.equal(presentation.sourceLabel('disbursement_import'), '发放记录导入');
  assert.equal(presentation.sourceLabel('workbench-c7627b2a'), '工作台发放');
  assert.equal(presentation.sourceLabel('template-disbursement-batch-1788481577735-pic0k59'), '模板发放');
  assert.equal(presentation.sourceLabel('new-source'), '其他来源');
  assert.equal(presentation.sourceDetail('new-source'), 'new-source');
  assert.equal(presentation.sourceDetail(''), '未记录原始来源');
});

test('把日期和费用状态转换为稳定的业务显示文本', () => {
  assert.equal(presentation.dateLabel('2026年09月06日'), '2026-09-06');
  assert.equal(presentation.dateLabel('2026-09-06T23:14:00Z'), '2026-09-06');
  assert.equal(presentation.dateLabel('0000-00-00'), '0000-00-00');
  assert.equal(presentation.dateLabel(''), '未填写');
  assert.equal(presentation.paymentStatusLabel('paid'), '已发放');
  assert.equal(presentation.paymentStatusLabel('completed'), '已完成');
  assert.equal(presentation.paymentStatusLabel('pending'), '未发放');
  assert.equal(presentation.paymentStatusLabel('new-status'), 'new-status');
});

test('费用记录和操作记录提供可读摘要', () => {
  const payment = {
    categoryName: '固定工资',
    role: '东二组组长',
    amountCents: 240000,
    bankName: '交通银行',
    bankCard: '6222000000000731',
    batchId: 'workbench-c7627b2a',
  };
  assert.equal(presentation.paymentItemLabel(payment), '固定工资 · 东二组组长');
  assert.equal(presentation.accountLabel(payment), '交通银行 · 尾号0731');
  assert.equal(presentation.operationLabel({
    type: 'resident_phone_update',
    object: { name: '陆敬辉' },
    before: { phone: '无' },
    after: { phone: '13800000000' },
  }), '修改联系电话');
  assert.equal(presentation.operationResultLabel({ status: 'completed' }), '已完成');
  assert.equal(presentation.operationResultLabel({}), '已完成');
  assert.equal(presentation.batchLabel(payment.batchId), '工作台发放');
});
