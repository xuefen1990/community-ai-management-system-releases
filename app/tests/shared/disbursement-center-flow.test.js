'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../../src/shared/contract-fee-model.js');

test('正式统计会排除测试批次，未完成数包含待继续办理的正式批次', () => {
  const dashboard = model.summarizeDisbursementDashboard([
    { categoryName: '工资', status: 'completed', items: [{ amountCents: 10000 }] },
    { categoryName: '工资', status: 'prepared', items: [{ amountCents: 20000 }] },
    { categoryName: '测试', status: 'completed', isTest: true, items: [{ amountCents: 99999 }] },
  ]);
  assert.equal(dashboard.totalCents, 30000);
  assert.equal(dashboard.completed, 1);
  assert.equal(dashboard.pendingReview, 1);
  assert.equal(dashboard.testCount, 1);
});

test('完成测试批次不会写入居民档案或个人操作记录', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');
  const batch = model.createTemplateDisbursementBatch({
    templateKey: model.DISBURSEMENT_TEMPLATE_KEYS.casualLabor,
    period: '2026年9月', isTest: true,
    items: [{ name: '张三', bankCard: '6222000012345678', quantity: '1', unitPrice: '100', finalAmount: '100' }],
  }, { now, id: 'test-batch' });
  const people = [{ id: 'p-1', name: '张三', village_group: '东一组' }];
  const result = model.completeTemplateDisbursementBatch(batch, { personnel: people, now });
  assert.equal(result.batch.status, 'completed');
  assert.equal(result.batch.items[0].paymentStatus, 'paid');
  assert.deepEqual(result.personnel, people);
  assert.deepEqual(result.operationEntries, []);
});

test('删除后的默认模板仍会被保留为不可选状态，便于恢复且不影响历史快照', () => {
  const database = { disbursementTemplates: [{ key: 'casual_labor', id: 'template-casual-labor', active: false, name: '旧杂工模板', fields: ['事项'] }] };
  model.normalizeDisbursementCollections(database);
  const template = database.disbursementTemplates.find((item) => item.key === 'casual_labor');
  assert.equal(template.active, false);
  assert.equal(template.builtIn, true);
});
