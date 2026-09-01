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

test('uses the explicitly selected contract fee allocation rule instead of inferring another field', () => {
  const matches = model.matchImportedRows({ rows: [{ id: 'r1', name: '张三', population: 3, acreage: 1.5, unitPrice: 100 }], personnel: people, selectedGroups: ['一组'] });
  const acreageLedger = model.createLedger({ contractId: 'c-1', matches, calculationType: 'acreage' }, { now, id: 'l-acreage' });
  assert.equal(acreageLedger.items[0].calculationType, 'acreage');
  assert.equal(acreageLedger.items[0].quantity, 1.5);
  const populationLedger = model.createLedger({ contractId: 'c-1', matches, calculationType: 'population' }, { now, id: 'l-population' });
  assert.equal(populationLedger.items[0].calculationType, 'population');
  assert.equal(populationLedger.items[0].quantity, 3);
  assert.throws(() => model.createLedger({ contractId: 'c-1', matches: model.matchImportedRows({ rows: [{ id: 'r2', name: '张三', population: 3, unitPrice: 100 }], personnel: people, selectedGroups: ['一组'] }), calculationType: 'acreage' }, { now }), /缺少亩数数据/u);
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

test('creates general disbursement batches without requiring a contract', () => {
  const categories = model.defaultDisbursementCategories();
  const subsidy = categories.find((item) => item.code === 'subsidy');
  const batch = model.createDisbursementBatch({
    categoryId: subsidy.id, categoryName: subsidy.name, period: '2026 年 9 月', batchDate: '2026-09-01',
    items: [{ personId: 'p-1', amount: '100' }, { name: '临时保洁员', bankCard: '62220009', amount: '80' }],
  }, { personnel: people, now, id: 'general-1' });
  assert.equal(batch.contractId, '');
  assert.equal(batch.items[0].recipientKind, 'resident');
  assert.equal(batch.items[1].recipientKind, 'temporary');
  assert.equal(model.summarizeDisbursementBatch(batch).totalCents, 18000);
  assert.equal(model.reviewDisbursementBatch(batch, { now }).status, 'reviewed');
});

test('requires a reason when a general batch is directly marked paid and preserves category totals', () => {
  const category = model.defaultDisbursementCategories()[2];
  assert.throws(() => model.createDisbursementBatch({ categoryId: category.id, categoryName: category.name, period: '2026 年 9 月', directPaid: true, items: [{ personId: 'p-1', amount: 1 }] }, { personnel: people, now }), /经办说明/u);
  const batch = model.createDisbursementBatch({ categoryId: category.id, categoryName: category.name, period: '2026 年 9 月', directPaid: true, directPaymentReason: '临时支出已现场发放', items: [{ personId: 'p-1', amount: 1 }] }, { personnel: people, now });
  const dashboard = model.summarizeDisbursementDashboard([batch]);
  assert.equal(dashboard.completed, 1);
  assert.equal(dashboard.totalsByCategory['固定工资'], 100);
});

test('creates fixed salary, casual labor and public service records with the approved calculations', () => {
  const profile = model.normalizeProfile({ templateKey: model.DISBURSEMENT_TEMPLATE_KEYS.positionSalary, personId: 'p-2', role: '党小组长', standard: 800 }, people, { now, id: 'profile-1' });
  assert.equal(profile.standardCents, 80000);
  const batch = model.createTemplateDisbursementBatch({
    categoryId: 'category-salary', categoryName: '固定工资', templateKey: model.DISBURSEMENT_TEMPLATE_KEYS.positionSalary, period: '2026年1-3月',
    items: [{ personId: 'p-2', role: '党小组长', unitPrice: 800, months: 3, deductions: 100 }],
  }, { personnel: people, now, id: 'template-1' });
  assert.equal(batch.items[0].calculatedAmountCents, 240000);
  assert.equal(batch.items[0].amountCents, 230000);
  const labor = model.templateItem({ name: '临时工', workDate: '7.22-7.25', workItem: '清理', workDays: 5.5, unitPrice: 100 }, people, model.DISBURSEMENT_TEMPLATE_KEYS.casualLabor, { now });
  assert.equal(labor.amountCents, 55000);
  const service = model.templateItem({ name: '运行人员', responsibilityArea: '东一组庄台', unitPrice: 2100 }, people, model.DISBURSEMENT_TEMPLATE_KEYS.publicService, { now });
  assert.equal(service.amountCents, 210000);
});

test('keeps a farmland subsidy master record authoritative and requires correction reasons', () => {
  const subsidyPeople = [{ id: 'p-4', name: '张三', village_group: '东一组', id_card: '320000199001010011', bankAccounts: [{ cardNumber: '62220001', isDefault: true }] }];
  const ledger = model.createFarmlandSubsidyLedger({ year: 2026, villageName: '陆庄社区', records: [{ name: '张三', groupName: '东一组', idCard: '320000199001010011', bankName: '农商行', bankCard: '62220001', eligibleArea: 2.4, standard: 120 }] }, { personnel: subsidyPeople, now, id: 'subsidy-1' });
  assert.equal(ledger.records[0].amountCents, 28800);
  assert.equal(model.validateFarmlandSubsidyLedger(ledger).ok, true);
  assert.throws(() => model.correctFarmlandSubsidyRecord(ledger, ledger.records[0].id, { eligibleArea: 2.5 }, { personnel: subsidyPeople, now }), /填写原因/u);
  const corrected = model.correctFarmlandSubsidyRecord(ledger, ledger.records[0].id, { eligibleArea: 2.5, correctionReason: '核实面积' }, { personnel: subsidyPeople, now });
  assert.equal(corrected.records[0].amountCents, 30000);
  assert.equal(corrected.corrections.length, 1);
});

test('suggests subsidy residents without automatically binding a same-name record', () => {
  const subsidyPeople = [
    { id: 'p-4', name: '张三', village_group: '东一组', id_card: '320000199001010011' },
    { id: 'p-5', name: '张三', village_group: '东二组', id_card: '320000199001010012' },
  ];
  const ledger = model.createFarmlandSubsidyLedger({ year: 2026, villageName: '陆庄社区', records: [{ name: '张三', groupName: '东一组', idCard: '', bankCard: '62220001', eligibleArea: 1, standard: 120 }] }, { personnel: [], now, id: 'subsidy-candidates' });
  const record = ledger.records[0];
  const candidates = model.farmlandSubsidyPersonCandidates(record, subsidyPeople);
  assert.equal(record.matchStatus, 'missing');
  assert.deepEqual(candidates.map((item) => [item.personId, item.reason]), [['p-4', '同组同名'], ['p-5', '同名待确认']]);
  const deferred = model.correctFarmlandSubsidyRecord(ledger, record.id, { associationStatus: 'deferred', associationNote: '等待核实户主', correctionReason: '等待核实户主' }, { personnel: subsidyPeople, now });
  assert.equal(deferred.records[0].associationStatus, 'deferred');
  assert.match(model.validateFarmlandSubsidyLedger(deferred).errors.join('；'), /暂不关联/u);
});

test('previews and imports subsidy residents by identity card without overwriting existing fields', () => {
  const subsidyPeople = [
    { id: 'p-keep', name: '张三', village_group: '东一组', id_card: '320000199001010011', phone: '13800000000', bankAccounts: [{ cardNumber: '62220001', isDefault: true }] },
    { id: 'p-conflict', name: '李四', village_group: '西一组', id_card: '320000199001010022' },
  ];
  const ledger = model.createFarmlandSubsidyLedger({ year: 2026, villageName: '陆庄社区', records: [
    { name: '张三', groupName: '东一组', idCard: '320000199001010011', bankName: '农商行', bankCard: '62220009', phone: '13900000000', eligibleArea: 2, standard: 120 },
    { name: '王五', groupName: '东二组', idCard: '320000199001010033', bankName: '农商行', bankCard: '62220003', eligibleArea: 1, standard: 120 },
    { name: '李六', groupName: '西二组', idCard: '320000199001010022', bankCard: '62220004', eligibleArea: 1, standard: 120 },
    { name: '赵七', groupName: '东三组', idCard: '', bankCard: '62220005', eligibleArea: 1, standard: 120 },
  ] }, { personnel: [], now, id: 'subsidy-import' });
  const plan = model.subsidyResidentImportPlan(ledger, ledger.records.map((record) => record.id), subsidyPeople);
  assert.deepEqual(plan.map((item) => item.status), ['merge', 'create', 'manual', 'manual']);
  const imported = model.importFarmlandSubsidyResidents({ ledger, selectedRecordIds: ledger.records.map((record) => record.id), personnel: subsidyPeople }, { now });
  assert.deepEqual(imported.summary, { created: 1, merged: 1, manual: 2 });
  const kept = imported.personnel.find((person) => person.id === 'p-keep');
  assert.equal(kept.phone, '13800000000');
  assert.equal(model.defaultBankCard(kept), '62220001');
  assert.equal(kept.farmlandSubsidyHistory.length, 1);
  const added = imported.personnel.find((person) => person.name === '王五');
  assert.equal(added.village_group, '东二组');
  assert.equal(model.defaultBankCard(added), '62220003');
  assert.equal(imported.ledger.records.filter((record) => record.matchStatus === 'matched').length, 2);
  assert.equal(imported.ledger.records.filter((record) => record.matchStatus !== 'matched').length, 2);
});
