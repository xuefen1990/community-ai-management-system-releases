'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chartCategories, groupFor } = require('../../src/shared/finance-chart-groups');
const { analyzeFinanceRecords } = require('../../src/main/finance-ledger-analysis');

test('automatic mode uses actual period and category count, with manual overrides', () => {
  const report = { startDate: '2026-01-01', endDate: '2026-04-01', categories: Array.from({ length: 9 }, (_, i) => ({ type: 'expense', category: `科目${i}`, amountCents: 100, count: 1 })) };
  assert.equal(chartCategories(report).mode, 'detail');
  report.endDate = '2026-04-02'; assert.equal(chartCategories(report).mode, 'summary');
  assert.equal(chartCategories(report, { mode: 'detail' }).parts.length, 9);
  report.endDate = '2026-01-31'; assert.equal(chartCategories(report).mode, 'detail');
  report.categories.push(...Array.from({ length: 4 }, (_, i) => ({ type: 'expense', category: `新科目${i}`, amountCents: 100, count: 1 })));
  assert.equal(chartCategories(report).mode, 'summary');
  assert.equal(chartCategories(report, { mode: 'summary' }).parts[0].category, '未归类');
});

test('groups preserve complete amounts and member IDs without editing records; broad categories can contain distinct purposes', () => {
  const records = [
    { id: 'water', recordType: 'expense', category: '其他支出', summary: '付：水费，村务卡', amountCents: 7950 },
    { id: 'electric', recordType: 'expense', category: '电费', summary: '付：电费', amountCents: 90600 },
    { id: 'drinking', recordType: 'expense', category: '饮用水费', amountCents: 90000 },
    { id: 'unknown', recordType: 'expense', category: '其他支出', summary: '报销', amountCents: 300 },
    { id: 'income', recordType: 'income', category: '公共运行经费收入', amountCents: 8000000 },
  ].map(row => ({ recordDate: '2026-02-01', ...row }));
  const original = structuredClone(records), report = analyzeFinanceRecords(records, { startDate: '2026-01-01', endDate: '2026-12-31' });
  const parts = chartCategories(report, { mode: 'summary' }).parts;
  assert.equal(parts.reduce((sum, row) => sum + row.amountCents, 0), report.totals.expenseCents);
  assert.deepEqual(parts.find(row => row.category === '公共服务').recordIds.sort(), ['electric', 'water']);
  assert.equal(parts.find(row => row.category === '其他').count, 1);
  assert.equal(chartCategories(report, { mode: 'summary', type: 'income' }).parts[0].category, '拨款与补助');
  assert.deepEqual(records, original);
});

test('specific purposes take precedence; unsupported names stay unclassified', () => {
  for (const [type, category, expected] of [
    ['expense','水费','公共服务'], ['expense','饮用水费','办公与日常'], ['expense','垃圾清运费','环境管护'],
    ['expense','排涝工程支出','工程建设'], ['expense','工资及社保支出','人员与劳务'], ['expense','工伤补偿费','补偿'],
    ['income','土地租金收入','经营与租赁'], ['income','场地管理费收入','服务与管理'], ['income','捐赠收入','捐赠'],
    ['income','特殊专项收入','未归类'],
  ]) assert.equal(groupFor(type, category), expected);
});
