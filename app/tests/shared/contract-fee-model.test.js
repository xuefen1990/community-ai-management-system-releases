'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../../src/shared/contract-fee-model');

const now = new Date('2026-08-28T08:00:00.000Z');
const people = [
  { id: 'p-1', name: '张三', village_group: '一组', status: '常住' },
  { id: 'p-2', name: '李四', village_group: '二组', bankAccounts: [{ cardNumber: '62220001', isDefault: true }] },
  { id: 'p-3', name: '张三', village_group: '二组' },
];

test('calculates money in integer cents', () => {
  assert.equal(model.calculateAmount({ calculationType: 'population', quantity: 3, unitPrice: '33.33' }), 9999);
  assert.equal(model.calculateAmount({ calculationType: 'population', quantity: 3, unitPrice: 100 }), 30000);
  assert.equal(model.calculateAmount({ calculationType: 'acreage', quantity: 2.5, unitPrice: '120' }), 30000);
  assert.equal(model.calculateAmount({ calculationType: 'direct', directAmount: '1,000.05元' }), 100005);
});

test('matches imported residents only inside selected groups', () => {
  const oneGroup = model.matchImportedRows({ rows: [{ id: 'r1', name: '张三' }], personnel: people, selectedGroups: ['一组'] });
  assert.equal(oneGroup[0].matchStatus, 'matched');
  assert.equal(oneGroup[0].person.id, 'p-1');
  const twoGroups = model.matchImportedRows({ rows: [{ id: 'r1', name: '张三' }], personnel: people, selectedGroups: ['一组', '二组'] });
  assert.equal(twoGroups[0].matchStatus, 'ambiguous');
  const resolved = model.matchImportedRows({ rows: [{ id: 'r1', name: '张三' }], personnel: people, selectedGroups: ['一组', '二组'], resolutions: { r1: 'p-3' } });
  assert.equal(resolved[0].person.id, 'p-3');
});

test('adds and changes the default bank card without losing earlier cards', () => {
  const person = structuredClone(people[0]);
  model.setDefaultBankCard(person, '6222 0002', { now });
  assert.equal(model.defaultBankCard(person), '62220002');
  model.setDefaultBankCard(person, '62220003', { now });
  assert.equal(model.defaultBankCard(person), '62220003');
  assert.equal(person.bankAccounts.length, 2);
});

test('creates a ledger and keeps completed batch snapshots unchanged after replacement', () => {
  const matches = model.matchImportedRows({ rows: [{ id: 'r1', name: '张三', population: 2, unitPrice: 100, amount: 200, bankCard: '6222' }], personnel: people, selectedGroups: ['一组'] });
  const ledger = model.createLedger({ contractId: 'c-1', matches }, { now, id: 'l-1' });
  const contract = model.createContract({ name: '土地租赁合同', amount: 200, startDate: '2026-01-01', endDate: '2030-12-31' }, { now, id: 'c-1' });
  const batch = model.createBatch({ ledger, contract, batchDate: '2026-09-01' }, { now, id: 'b-1' });
  const changed = model.replaceLedgerPerson(ledger, ledger.items[0].id, people[1], '原领取人变更', { now });
  assert.equal(changed.items[0].name, '李四');
  assert.equal(batch.items[0].name, '张三');
  assert.equal(batch.items[0].bankCard, '6222');
});

test('requires adjustment and contract difference explanations before review', () => {
  const batch = {
    batchDate: '2026-09-01', contractAmountCents: 30000,
    items: [{ name: '张三', groupName: '一组', calculatedAmountCents: 20000, finalAmountCents: 18000, adjustmentReason: '', bankCard: '6222' }],
  };
  let validation = model.validateBatch(batch);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('；'), /调整金额/u);
  assert.match(validation.errors.join('；'), /差额用途/u);
  batch.items[0].adjustmentReason = '人口变动'; batch.differenceExplanation = '留作集体资金';
  validation = model.validateBatch(batch);
  assert.equal(validation.ok, true);
});

test('derives partial and completed payment states', () => {
  const batch = { status: 'exported', exportedAt: now.toISOString(), items: [{ id: 'i1', paymentStatus: 'pending' }, { id: 'i2', paymentStatus: 'pending' }] };
  const partial = model.updatePaymentResults(batch, [{ itemId: 'i1', status: 'paid' }, { itemId: 'i2', status: 'failed', note: '卡号错误' }], { now });
  assert.equal(partial.status, 'partial');
  const completed = model.updatePaymentResults(partial, [{ itemId: 'i2', status: 'paid' }], { now });
  assert.equal(completed.status, 'completed');
});

test('copies a ledger for renewal and tracks advance reimbursement', () => {
  const copied = model.copyLedger({ id: 'l-old', contractId: 'c-old', items: [{ id: 'i-old', name: '张三' }] }, 'c-new', { now, id: 'l-new' });
  assert.equal(copied.contractId, 'c-new');
  assert.equal(copied.copiedFromLedgerId, 'l-old');
  const advance = model.createAdvance({ contractId: 'c-new', batchId: 'b-1', amount: 1000, advancedDate: '2026-09-01' }, { now, id: 'a-1' });
  assert.equal(advance.status, 'pending_reimbursement');
  assert.equal(model.reimburseAdvance(advance, '2026-10-01', { now }).status, 'reimbursed');
});

test('requires real dates for receipts and advance lifecycle records', () => {
  assert.throws(() => model.createReceipt({ contractId: 'c1', amount: 100, receivedDate: '' }), /到账日期/u);
  assert.throws(() => model.createAdvance({ contractId: 'c1', batchId: 'b1', amount: 100, advancedDate: '' }), /垫付日期/u);
  assert.throws(() => model.reimburseAdvance({ id: 'a1' }, ''), /归还日期/u);
});
