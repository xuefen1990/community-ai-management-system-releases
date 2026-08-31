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
  assert.match(script, /selectAndReadContractFeeExcel/u);
  assert.match(script, /exportContractFeeGroupFiles/u);
});
