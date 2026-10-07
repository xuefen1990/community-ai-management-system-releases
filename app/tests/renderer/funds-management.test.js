'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('发放管理按类别办理，删除前拦截未完成批次，历史发放保持可查', async () => {
  const category = { id: 'salary-category', code: 'salary', name: '固定工资', active: true, defaultTemplateId: 'salary-template' };
  const unconfigured = { id: 'other-category', code: 'other', name: '其他补贴', active: true };
  const template = { id: 'salary-template', key: 'position_salary', categoryCode: 'salary', name: '工资表', active: true };
  const completed = { id: 'paid-batch', categoryId: category.id, categoryName: category.name, templateKey: template.key, templateId: template.id, templateSnapshot: { ...template, title: '旧版工资表' }, title: '九月工资', status: 'completed', period: '2026 年 9 月', batchDate: '2026-09-26', items: [{ name: '张三', amountCents: 20000, paymentStatus: 'paid' }] };
  const pending = { ...completed, id: 'draft-batch', title: '十月工资', status: 'draft' };
  const database = { disbursementCategories: [category, unconfigured], disbursementTemplates: [template], disbursementBatches: [completed, pending], settings: {}, personnel: [] };
  const target = { innerHTML: '' };
  const shell = { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
  const listeners = {};
  const notices = [];
  class Element {}
  const document = {
    body: { appendChild() {} },
    getElementById(id) { return id === 'tab-contract-fees' ? {} : id === 'cf-view' ? target : null; },
    querySelector(selector) { return selector === '#tab-contract-fees .cf-shell' ? shell : null; },
    addEventListener(type, listener) { listeners[type] = listener; },
    createElement() { return { innerHTML: '', addEventListener() {}, remove() {} }; },
  };
  const model = {
    normalizeDisbursementCollections() {},
    summarizeDisbursementBatch(batch) { return { totalCents: batch.items.reduce((sum, item) => sum + item.amountCents, 0), recipientCount: batch.items.length }; },
    disbursementBatchSyncStatus() { return { code: 'pending', label: '待同步' }; },
    centsToYuan(cents) { return (Number(cents) / 100).toFixed(2); },
  };
  const window = { communityFoundation: true, ContractFeeModel: model, ContractFeeExcelParser: {}, ContractFeeLedgerUI: {}, showToast(message) { notices.push(message); }, confirm() { return true; }, communityFoundationApi: { async readDb() { return database; }, async writeDb() { return { ok: true }; } } };
  const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/contract-fee-workspace.js'), 'utf8');
  vm.runInNewContext(source, { window, document, Element, structuredClone, console });
  await window.ContractFeeWorkspace.init(new Element());
  await window.ContractFeeWorkspace.loadDatabase();
  const click = (kind, value, id) => listeners.click({ target: { closest(selector) { return selector === `[data-cf-${kind}]` ? { dataset: { [kind === 'view' ? 'cfView' : 'cfAction']: value, id } } : null; } }, preventDefault() {} });

  await click('view', 'special');
  assert.match(target.innerHTML, /发放管理/u);
  assert.match(target.innerHTML, /固定工资/u);
  assert.match(target.innerHTML, /其他补贴/u);
  assert.match(target.innerHTML, /待配置模板/u);
  await click('action', 'open-management-category', category.id);
  assert.match(target.innerHTML, /待办理批次/u);
  assert.match(target.innerHTML, /十月工资/u);

  await click('action', 'toggle-category', category.id);
  assert.equal(category.active, false);
  await click('action', 'delete-category', category.id);
  assert.equal(category.deletedAt, undefined);
  assert.ok(notices.some((message) => message.includes('未完成批次')));

  database.disbursementBatches.splice(database.disbursementBatches.indexOf(pending), 1);
  await click('action', 'delete-category', category.id);
  assert.ok(category.deletedAt);
  await click('view', 'special');
  assert.doesNotMatch(target.innerHTML, /固定工资/u);
  await click('view', 'all');
  assert.match(target.innerHTML, /九月工资/u);
  assert.match(target.innerHTML, /张三/u);
  assert.equal(completed.templateSnapshot.title, '旧版工资表');
});
