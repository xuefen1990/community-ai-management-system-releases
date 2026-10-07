'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '../../src/renderer');
const script = fs.readFileSync(path.join(renderer, 'js/contract-fee-ledger-ui.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(renderer, 'css/contract-fee-ledger.css'), 'utf8');
const foundation = fs.readFileSync(path.join(renderer, 'foundation/extensions.mjs'), 'utf8');
const workspace = fs.readFileSync(path.join(renderer, 'js/contract-fee-workspace.js'), 'utf8');

test('loads the dedicated contract ledger assets before the workspace in Foundation and legacy entries', () => {
  assert.ok(foundation.indexOf("loadScript('../shared/contract-fee-excel-parser.js')") < foundation.indexOf("loadScript('js/contract-fee-ledger-ui.js')"));
  assert.ok(foundation.indexOf("loadScript('js/contract-fee-ledger-ui.js')") < foundation.indexOf("loadScript('js/contract-fee-workspace.js')"));
  assert.match(workspace, /data-contract-fee-excel-parser/u);
  assert.match(workspace, /data-contract-fee-ledger-ui/u);
  assert.match(fs.readFileSync(path.join(renderer, 'css/contract-fee-workspace.css'), 'utf8'), /contract-fee-ledger\.css/u);
});

test('uses the confirmed Chinese overview and full-screen household editor', () => {
  for (const label of ['承包费项目台账', '先定各组总额，再按户计算到分', '本年度承包费', '已分配到户', '尚待人工补入', '待完成项目', '涉及组别', '按组看项目', '新建承包项目']) assert.match(script, new RegExp(label, 'u'));
  for (const label of ['一户一行', '户主', '收款人', '基础金额', '尾差', '最终金额', '完整银行卡号', '批量填写', '字段与计算规则', '尾差补入', '输出表格设置']) assert.match(script, new RegExp(label, 'u'));
  assert.match(stylesheet, /\.cfl-fullscreen/u);
  assert.match(stylesheet, /\.cfl-household-table-wrap/u);
  assert.match(stylesheet, /position:\s*sticky/u);
});

test('uses one project entry and chooses Excel or blank creation inside the wizard', () => {
  assert.doesNotMatch(script, />上传项目表<\/button>/u);
  for (const label of ['选择建立方式', '上传 Excel 建立', '空白建立', '下一步：选择 Excel']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /data-cfl-action="select-wizard-source"/u);
  assert.match(stylesheet, /\.cfl-source-choice/u);
  assert.match(stylesheet, /background:\s*var\(--bg-main/u);
  assert.doesNotMatch(stylesheet, /@keyframes cfl-enter\s*\{[^}]*opacity/u);
});

test('renders only the selected page and uses delegated events for large ledgers', () => {
  assert.match(script, /rows\.slice\(\(state\.page - 1\) \* state\.pageSize, state\.page \* state\.pageSize\)/u);
  assert.match(script, /\[20, 50, 100\]/u);
  assert.match(script, /host\.addEventListener\('click', onClick\)/u);
  assert.match(script, /host\.addEventListener\('change', onChange\)/u);
  assert.doesNotMatch(script, /forEach\([^\n]*addEventListener/u);
});

test('keeps projects independent and supports custom fields, formulas, removal and recovery', () => {
  for (const marker of ['data-plan-id', 'data-group-id', 'householdId', 'importMetadata', 'customData', 'remove-household', 'restore-household', 'add-formula', 'removeContractFeeField', 'assign-tail']) assert.match(script, new RegExp(marker, 'u'));
  assert.match(script, /相同收款人或银行卡号/u);
  assert.match(script, /每个项目单独上传/u);
});

test('lets an operator map unfamiliar Excel headings in Chinese before importing', () => {
  for (const label of ['Excel 字段对应', '表头在第几行', '户主姓名', '收款人', '人口', '实际亩数', '银行卡号', '原表预览', '确认对应并导入']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /parseContractFeeExcelGrid/u);
  assert.match(script, /data-cfl-map-field/u);
  assert.match(stylesheet, /\.cfl-mapping-dialog/u);
});

test('supports worksheet selection, confirmed control totals and imported output fields', () => {
  for (const label of ['选择需要导入的工作表', '核定总亩数', '明细合计', '差额', '按原表字段导出', '来源字段']) assert.match(script, new RegExp(label, 'u'));
  for (const marker of ['requiresSheetSelection', 'outputTemplateSnapshot', 'expectedBasisTotal', 'controlTotals', 'confirm-sheet-selection', 'confirm-import']) assert.match(script, new RegExp(marker, 'u'));
});
