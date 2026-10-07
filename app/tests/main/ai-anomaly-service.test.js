'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiAnomalyService } = require('../../src/main/ai-anomaly-service');

function storeFixture(database) {
  let value = structuredClone(database);
  return {
    read: async () => structuredClone(value),
    update: async mutator => { const draft = structuredClone(value); const result = await mutator(draft); value = draft; return { data: structuredClone(value), result: structuredClone(result) }; },
    value: () => structuredClone(value),
  };
}

test('主动核查身份证和银行卡问题，只生成可解释建议', async () => {
  const store = storeFixture({ personnel: [
    { id: 'p1', name: '张三', idCard: '', bankAccounts: [{ cardNumber: '62220001', status: 'active' }, { cardNumber: '62220002', status: 'active' }] },
    { id: 'p2', name: '李四', idCard: '123', bankCard: '62220001' },
  ], aiAnomalyFindings: [] });
  const service = new AiAnomalyService({ databaseStore: store, now: () => new Date('2026-09-21T08:00:00.000Z') });
  const result = await service.scan();
  assert.ok(result.findings.some(item => item.rule === 'resident-id-missing'));
  assert.ok(result.findings.some(item => item.rule === 'resident-id-invalid'));
  assert.ok(result.findings.some(item => item.rule === 'resident-multiple-cards'));
  assert.ok(result.findings.some(item => item.rule === 'shared-bank-card'));
  assert.equal(store.value().personnel[0].bankAccounts.length, 2);
});

test('同一问题重复核查不新增记录，并保留人工处理状态', async () => {
  const store = storeFixture({ personnel: [{ id: 'p1', name: '张三', idCard: '' }], aiAnomalyFindings: [] });
  const service = new AiAnomalyService({ databaseStore: store, now: () => new Date('2026-09-21T08:00:00.000Z') });
  const first = await service.scan();
  await service.update({ id: first.findings[0].id, status: 'ignored' });
  await service.scan();
  const all = await service.list({ status: '' });
  assert.equal(all.findings.length, 1);
  assert.equal(all.findings[0].status, 'ignored');
});

test('核查发放总额、合同到期、证明模板和导入冲突', async () => {
  const store = storeFixture({ personnel: [], aiAnomalyFindings: [],
    disbursementBatches: [{ id: 'b1', title: '补贴发放', totalAmountCents: 10000, items: [{ amountCents: 9000 }] }],
    resourceContracts: [{ id: 'c1', name: '鱼塘承包', endDate: '2026-09-20' }],
    certificateTemplates: [{ id: 't1', name: '关系证明', content: '兹证明{姓名}', fields: [{ key: 'idCard', label: '身份证号', required: true }] }],
    aiFileIndexEntries: [{ id: 'f1', fileName: '人员表.xlsx', warnings: ['缺少关键字段'] }],
  });
  const service = new AiAnomalyService({ databaseStore: store, now: () => new Date('2026-09-21T08:00:00.000Z') });
  const result = await service.scan();
  const rules = new Set(result.findings.map(item => item.rule));
  for (const rule of ['disbursement-total-mismatch', 'contract-expired', 'certificate-template-fields', 'import-file-review']) assert.equal(rules.has(rule), true);
});

test('问题消失后自动转为已处理但不删除历史记录', async () => {
  const store = storeFixture({ personnel: [{ id: 'p1', name: '张三', idCard: '' }], aiAnomalyFindings: [] });
  const service = new AiAnomalyService({ databaseStore: store, now: () => new Date('2026-09-21T08:00:00.000Z') });
  await service.scan();
  await store.update(database => { database.personnel = []; });
  await service.scan();
  const history = await service.list({ status: '' });
  assert.equal(history.findings[0].status, 'resolved');
  assert.equal(history.findings[0].resolvedAutomatically, true);
});
