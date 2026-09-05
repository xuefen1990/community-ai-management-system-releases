'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('resident subsidy profile provides the agreed record tabs', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/resident-subsidy-profile.js'), 'utf8');
  for (const label of ['居民资料标签', '基本信息', '收款账户与扩展资料', '地力补贴记录', '资金与工作记录', '操作记录', '来源与更正记录', '居民档案资料', '扩展字段管理']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /farmlandSubsidyHistory/u);
  assert.match(script, /disbursementHistory/u);
  assert.match(script, /importSources/u);
  assert.match(script, /residentCustomFields/u);
  assert.match(script, /residentOperationLog/u);
  assert.match(script, /data-resident-operation-page-size/u);
});
