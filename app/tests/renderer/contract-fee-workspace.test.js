'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDirectory = path.join(__dirname, '../../src/renderer');

test('loads the contract fee model, stylesheet and workspace module', () => {
  const html = fs.readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8');
  assert.match(html, /contract-fee-workspace\.css/u);
  assert.match(html, /contract-fee-model\.js/u);
  assert.match(html, /contract-fee-workspace\.js/u);
});

test('workspace module keeps the unified disbursement screens outside the legacy renderer', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  for (const label of ['资金发放中心', '汇总看板', '全部发放批次', '承包费历史台账', '管理类别', '新建发放批次']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /正在保存/u);
  assert.match(script, /cf-disbursement-error/u);
  for (const label of ['固定人员基础台账', '年度地力补贴关联台账', '岗位工资 / 补贴', '杂工补贴', '导出五张表']) assert.match(script, new RegExp(label, 'u'));
  for (const label of ['按地亩数分配', '按全组人口平均分配']) assert.match(script, new RegExp(label, 'u'));
  for (const label of ['主表与附件', '附件 1-1', '附件 1-4', '附件 2-1', '附件 2-4', '首页', '上一页', '下一页', '末页', '跳至', '每页', '10 条', '20 条', '50 条', '查询定位', '身份证号', '待处理 · 去处理', '处理补贴关联', '确认关联', '暂不关联']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /subsidyDetailsModal/u);
  assert.match(script, /view-subsidy-sheet/u);
  assert.match(script, /subsidyRecordListModal/u);
  assert.match(script, /paginationHtml/u);
  assert.match(script, /paginationPages/u);
  assert.match(script, /subsidy-sheet-page-size/u);
  assert.match(script, /jump-subsidy-sheet-page/u);
  assert.match(script, /subsidy-editor-page-size/u);
  assert.match(script, /subsidyIssueListModal/u);
  assert.match(script, /subsidyResolutionModal/u);
  assert.match(script, /resolve-subsidy-issues/u);
  assert.match(script, /confirm-subsidy-association/u);
  for (const label of ['全选本页', '全选全部待处理项', '批量导入居民档案', '批量导入预览', '确认导入并关联', '只补充居民档案空白信息']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /subsidyResidentImportPlan/u);
  assert.match(script, /importFarmlandSubsidyResidents/u);
  assert.match(script, /resident-subsidy-profile\.js/u);
  assert.match(script, /save-subsidy-record/u);
  assert.match(script, /document\.getElementById\('cf-modal-overlay'\)\?\.remove\(\)/u);
  assert.match(script, /overlay\.addEventListener\('click'/u);
  assert.match(script, /event\.stopPropagation\(\)/u);
  assert.match(script, /selectAndReadContractFeeExcel/u);
  assert.match(script, /exportContractFeeGroupFiles/u);
});
