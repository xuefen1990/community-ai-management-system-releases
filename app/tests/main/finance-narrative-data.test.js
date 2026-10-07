'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { financeNarrativeData } = require('../../src/main/finance-narrative-data');

test('AI data uses yuan consistently including negative balances, categories, months and legacy records', () => {
  const report = { startDate: '2026-01-01', endDate: '2026-10-31',
    totals: { incomeCents: 154679854, expenseCents: 212570736, balanceCents: -57890882, incomeCount: 32, expenseCount: 132 },
    categories: [{ type: 'expense', category: '办公支出', amountCents: 12345, count: 1 }],
    months: [{ month: '2026-01', incomeCents: 12345, expenseCents: 56789 }], recordCount: 164,
    records: [{ amountCents: 12345 }, { amount: 67.89 }] };
  const data = financeNarrativeData(report);
  assert.equal(data.unit, '元');
  assert.equal(data.totals.income, '1546798.54');
  assert.equal(data.totals.balance, '-578908.82');
  assert.equal(data.categories[0].amount, '123.45');
  assert.equal(data.months[0].expense, '567.89');
  assert.equal(data.sample[1].amount, '67.89');
  assert.doesNotMatch(JSON.stringify(data), /Cents/);
  assert.equal(data.months.length, 1); // Do not fabricate unrecorded months.
  assert.equal(report.totals.incomeCents, 154679854);
});
