'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { latestMonth } = require('../../src/shared/finance-default-period');
const row = (date, fields = {}) => ({ recordDate: date, recordType: 'expense', amountCents: 100, ...fields });

test('latest month follows transaction date, excludes invalid/future records and ignores upload order', () => {
  const records = [row('2025-12-28'),row('2024-01-03',{importedAt:'2026-10-04'}),row('2026-07-30'),
    row('2026-10-30'),row('2026-09-31'),row('2026-09-20',{amountCents:'100'}),row('2026-09-19',{amountCents:-1}),
    row('2026-09-18',{recordType:'unknown'}),row('2026-09-17',{amountCents:NaN})];
  assert.deepEqual(latestMonth(records,'2026-10-04'),{latestDate:'2026-07-30',startDate:'2026-07-01',endDate:'2026-07-31'});
});

test('current month ends today; historic leap months and cross-year dates use full calendar months', () => {
  assert.equal(latestMonth([row('2026-10-03')],'2026-10-04').endDate,'2026-10-04');
  assert.equal(latestMonth([row('2024-02-29')],'2026-10-04').endDate,'2024-02-29');
  assert.equal(latestMonth([row('2025-12-31')],'2026-01-01').startDate,'2025-12-01');
});

test('supports valid legacy yuan amounts but does not coerce missing, null or invalid integer cents', () => {
  const valid={date:'2025-06-30',type:'income',amount:12.34};
  assert.equal(latestMonth([valid],'2026-10-04').latestDate,'2025-06-30');
  assert.equal(latestMonth([row('2025-07-01',{amountCents:null,amount:10})],'2026-10-04'),null);
  assert.equal(latestMonth([{date:'2025-07-01',type:'expense',amount:''}],'2026-10-04'),null);
  for (const amount of [' ', null, false, {}]) assert.equal(latestMonth([{date:'2025-07-01',type:'expense',amount}],'2026-10-04'),null);
  assert.equal(latestMonth([],'2026-10-04'),null);
});
