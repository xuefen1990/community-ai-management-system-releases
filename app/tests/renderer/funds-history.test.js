'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('发放记录按类别展示正式已完成批次，并在类别超过八个时可展开', async () => {
  const categoryNames = ['固定工资', '承包费', '补贴', '杂工工资', '公共服务工资', '奖励', '救助', '福利', '报销', '其他'];
  const categories = categoryNames.map((name, index) => ({ id: `category-${index}`, code: index === 0 ? 'salary' : `category-${index}`, name, active: true }));
  const batch = (id, categoryId, status, extra = {}) => ({
    id, categoryId, categoryName: categories[Number(categoryId.split('-')[1])].name,
    status, period: '2026 年 9 月', batchDate: '2026-09-25',
    items: [{ id: `${id}-item`, name: '张三', groupName: '东一组', amountCents: 120000, paymentStatus: 'paid' }],
    ...extra,
  });
  const database = {
    disbursementCategories: categories,
    disbursementTemplates: [{ id: 'salary-template', key: 'position_salary', name: '工资模板', categoryCode: 'salary' }],
    disbursementBatches: [batch('salary-done', 'category-0', 'completed'), batch('salary-older', 'category-0', 'completed', { batchDate: '2026-01-02', items: [{ id: 'salary-older-item', name: '李四', amountCents: 80000, paymentStatus: 'paid' }] }), batch('salary-draft', 'category-0', 'draft'), batch('salary-test', 'category-0', 'completed', { isTest: true }), batch('fee-done', 'category-1', 'completed')],
    settings: {}, personnel: [{ id: 'person-1', disbursementHistory: [{ batchId: 'salary-done', recordId: 'salary-done-item', paymentStatus: 'paid' }], importSources: [{ batchId: 'salary-done', recordId: 'salary-done-item', paymentStatus: 'paid' }] }],
  };
  const target = { innerHTML: '' };
  const shell = { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
  let workbenchContext;
  const listeners = {};
  class Element {}
  const document = {
    getElementById(id) { return id === 'tab-contract-fees' ? {} : id === 'cf-view' ? target : id === 'cf-modal-overlay' ? modal : null; },
    querySelector(selector) { return selector === '#tab-contract-fees .cf-shell' ? shell : null; },
    addEventListener(type, listener) { listeners[type] = listener; },
    createElement() { return { addEventListener() {}, remove() {} }; },
    head: { appendChild(element) { element.onload?.(); } },
  };
  const model = {
    normalizeDisbursementCollections() {},
    summarizeDisbursementBatch(row) { return { totalCents: row.items.reduce((sum, item) => sum + item.amountCents, 0), recipientCount: row.items.length }; },
    centsToYuan(cents) { return (Number(cents) / 100).toFixed(2); },
    recycleDisbursementBatch(row) { return { ...row, recycleInfo: { deletedAt: '2026-09-29' } }; },
    restoreDisbursementBatch(row) { const { recycleInfo, ...restored } = row; return restored; },
    copyDisbursementBatch(row) { return structuredClone(row); },
    personId(person) { return person.id; },
    personName(person) { return person.name || ''; },
    personGroup(person) { return person.groupName || ''; },
  };
  const window = { communityFoundation: true, ContractFeeModel: model, DisbursementWorkbenchModel: require('../../src/shared/disbursement-workbench-model'), DisbursementWorkbench: { open(context) { workbenchContext = context; } }, confirm() { return true; }, showToast() {}, communityFoundationApi: { async readDb() { return database; }, async writeDb() { return { ok: true }; } }, ContractFeeExcelParser: {}, ContractFeeLedgerUI: {} };
  const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/contract-fee-workspace.js'), 'utf8');
  vm.runInNewContext(source, { window, document, Element, structuredClone, console });
  await window.ContractFeeWorkspace.init(new Element());
  await window.ContractFeeWorkspace.loadDatabase();
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-view]' ? { dataset: { cfView: 'all' } } : null; } } });
  assert.match(shell.innerHTML, /发放记录/u);
  assert.match(target.innerHTML, /查看全部类别（10）/u);
  assert.match(target.innerHTML, /工资.*历史批次/su);
  assert.match(target.innerHTML, /data-cf-action="recycle-disbursement-batch" data-id="salary-done"/u);
  assert.match(target.innerHTML, /<tr[^>]*data-cf-action="history-batch" data-id="salary-done"/u);
  assert.match(target.innerHTML, /data-cf-action="view-disbursement" data-id="salary-done">查看原记录 \/ 打印/u);
  assert.match(target.innerHTML, /data-cf-action="copy-disbursement-batch" data-id="salary-done">复用人员及金额/u);
  assert.equal((target.innerHTML.match(/查看原记录 \/ 打印/gu) || []).length, 2);
  assert.match(target.innerHTML, /张三/u);
  assert.doesNotMatch(target.innerHTML, /salary-draft|salary-test/u);
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-action]' ? { dataset: { cfAction: 'history-batch', id: 'salary-older' } } : null; } }, preventDefault() {} });
  assert.match(target.innerHTML, /salary-older[^>]*tabindex="0"/u);
  assert.match(target.innerHTML, /李四/u);
  assert.match(target.innerHTML, /人员明细/u);
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-action]' ? { dataset: { cfAction: 'history-expand-categories' } } : null; } }, preventDefault() {} });
  assert.match(target.innerHTML, /搜索类别/u);
  assert.match(target.innerHTML, /报销/u);
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-action]' ? { dataset: { cfAction: 'copy-disbursement-batch', id: 'salary-done' } } : null; } }, preventDefault() {} });
  assert.equal(workbenchContext.template.key, 'position_salary');
  assert.equal(workbenchContext.initialItems[0].name, '张三');
  assert.equal(workbenchContext.initialItems[0].finalAmount, '1200.00');
  assert.equal(workbenchContext.initialItems[0].unitPrice, '1200.00');
  assert.equal(database.disbursementBatches.length, 5, '未确认保存前不应生成复制批次');
  workbenchContext.closed();
  assert.match(target.innerHTML, /固定工资 · 历史批次/u, '关闭编辑后应回到发放记录');
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-action]' ? { dataset: { cfAction: 'recycle-disbursement-batch', id: 'salary-done' } } : null; } }, preventDefault() {} });
  assert.equal(database.disbursementBatches.some((item) => item.id === 'salary-done'), false);
  assert.equal(database.disbursementRecycleBin.some((item) => item.id === 'salary-done'), true);
  assert.equal(database.personnel[0].disbursementHistory[0].paymentStatus, 'cancelled');
  assert.equal(database.personnel[0].importSources[0].paymentStatus, 'cancelled');
  await listeners.click({ target: { closest(selector) { return selector === '[data-cf-action]' ? { dataset: { cfAction: 'restore-disbursement-batch', id: 'salary-done' } } : null; } }, preventDefault() {} });
  assert.equal(database.disbursementBatches.some((item) => item.id === 'salary-done'), true);
  assert.equal(database.personnel[0].disbursementHistory[0].paymentStatus, 'paid');
});
