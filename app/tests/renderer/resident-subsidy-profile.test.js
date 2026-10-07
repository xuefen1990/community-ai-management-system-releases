'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('resident profile provides the agreed record tabs and filters completed fees', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  for (const label of ['居民资料标签', '基本信息', '收款账户与扩展资料', '费用发放记录', '操作记录', '来源与更正记录', '居民档案资料', '扩展字段管理']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /residentPaymentRecords/u);
  assert.match(script, /resident-payment-category/u);
  assert.match(script, /resident-payment-year/u);
  assert.match(script, /resident-payment-filter/u);
  assert.match(script, /resident-payment-total/u);
  assert.match(script, /disbursementHistory/u);
  assert.match(script, /importSources/u);
  assert.match(script, /residentCustomFields/u);
  assert.match(script, /residentOperationLog/u);
  assert.match(script, /data-resident-operation-page-size/u);
  assert.match(script, /历史银行卡/u);
  assert.match(script, /data-resident-edit-account/u);
  assert.match(script, /data-resident-save-account-edit/u);
  assert.match(script, /data-resident-deactivate-card/u);
  assert.match(script, /updateBankAccount/u);
  assert.match(script, /deactivateBankAccount/u);
});

test('resident records use business labels, expandable technical details and compact pagination', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  const legacyStyle = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/contract-fee-workspace.css'), 'utf8');
  const foundationStyle = fs.readFileSync(path.join(__dirname, '../../src/renderer/foundation/foundation.css'), 'utf8');
  for (const selector of ['resident-record-details', 'resident-payment-status', 'resident-operation-result', 'resident-source-label', 'resident-record-pagination']) assert.match(script, new RegExp(selector, 'u'));
  for (const label of ['发放日期', '事项', '发放金额', '收款账户', '状态', '资料来源', '关联记录', '变更说明', '查看详情']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /sourceLabel/u);
  assert.match(script, /paymentItemLabel/u);
  assert.match(script, /operationLabel/u);
  for (const style of [legacyStyle, foundationStyle]) {
    assert.match(style, /resident-record-pagination/u);
    assert.match(style, /resident-record-details/u);
    assert.match(style, /prefers-reduced-motion/u);
  }
});

test('resident row view and edit entries reuse the original full resident form in the correct mode', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  assert.match(script, /查看个人全套档案与详情/u);
  assert.match(script, /编辑信息/u);
  assert.match(script, /编辑当前人员/u);
  assert.match(script, /label\.includes\('查看个人全套档案与详情'\).*mode = 'read'/u);
  assert.match(script, /label\.includes\('编辑信息'\).*mode = 'edit'/u);
  assert.match(script, /当前为只读查看/u);
  assert.match(script, /window\.openEditModal\('personnel', index\)/u);
  assert.match(script, /enhanceOriginalResidentProfile/u);
  assert.match(script, /resident-profile-embedded/u);
  assert.match(script, /resident-profile-nav-muted/u);
  assert.match(script, /resident-profile-nav-item/u);
  assert.match(script, /residentProfileNavTab/u);
  assert.match(script, /setProfileNavigationActive/u);
  assert.match(script, /clearPlaceholderPhone/u);
  assert.match(script, /isPlaceholderValue/u);
  assert.match(script, /residentPersonKey/u);
  assert.match(script, /residentPersonIndex/u);
  assert.match(script, /event\.stopImmediatePropagation\(\)/u);
  assert.doesNotMatch(script, /返回基础信息编辑/u);
  assert.match(script, /window\.openResidentProfileForPerson/u);
});

test('resident account actions use one delegated handler after each panel refresh', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  assert.match(script, /removeEventListener\('click', overlay\.__residentProfileClickHandler\)/u);
  assert.match(script, /overlay\.addEventListener\('click', overlay\.__residentProfileClickHandler\)/u);
  assert.match(script, /removeEventListener\('change', overlay\.__residentProfileChangeHandler\)/u);
});

test('legacy resident matching stays inside the selected row and prefers record identity', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  assert.match(script, /element\.closest\('tr'\)/u);
  assert.match(script, /entryPersonnelIndex/u);
  assert.match(script, /personIdCard\(person\)/u);
  assert.doesNotMatch(script, /element\.closest\('\.modal-card'\)/u);
  assert.match(script, /const personKey = \(person\) => text\(person\?\.id\) \|\| personIdCard\(person\)/u);
  assert.match(script, /data-resident-profile-person="\$\{escapeHtml\(personKey\(person\)\)\}"/u);
});
