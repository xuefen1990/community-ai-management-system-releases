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

test('workspace module keeps contract fee screens outside the legacy renderer', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  for (const label of ['资金发放中心', '发放总览', '合同发放台账', '发放记录', '待处理事项']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /selectAndReadContractFeeExcel/u);
  assert.match(script, /exportContractFeeGroupFiles/u);
});
