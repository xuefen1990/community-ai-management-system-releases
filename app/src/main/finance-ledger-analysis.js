'use strict';

const { parseDate } = require('./finance-excel-parser');
const clean = value => String(value ?? '').trim();
const { duplicateReason } = require('../shared/finance-import-review');
const cents = record => Number.isSafeInteger(record.amountCents) ? record.amountCents : Math.round(Number(record.amount || 0) * 100);
const dateOf = record => clean(record.recordDate || record.record_date || record.date);
const typeOf = record => clean(record.recordType || record.type);

function validPeriod(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/u.test(endDate || '')
    || parseDate(startDate) !== startDate || parseDate(endDate) !== endDate || startDate > endDate) {
    throw new Error('请选择有效的起止日期');
  }
}

function analyzeFinanceRecords(records, { startDate, endDate } = {}) {
  validPeriod(startDate, endDate);
  const relevant = [], excluded = [];
  for (const record of records || []) {
    const date = dateOf(record);
    if (parseDate(date) !== date) { excluded.push(record); continue; }
    if (date >= startDate && date <= endDate) relevant.push(record);
  }
  const totals = { incomeCents: 0, expenseCents: 0, balanceCents: 0, incomeCount: 0, expenseCount: 0 };
  const grouped = new Map();
  const byMonth = new Map();
  for (const record of relevant) {
    const type = typeOf(record), amount = cents(record);
    if (!['income', 'expense'].includes(type) || !Number.isSafeInteger(amount) || amount < 0) continue;
    totals[`${type}Cents`] += amount;
    totals[`${type}Count`]++;
    const category = clean(record.category) ? clean(record.category) : '未分类';
    const key = `${type}:${category}`;
    const item = grouped.get(key) || { type, category, amountCents: 0, count: 0 };
    item.amountCents += amount; item.count++; grouped.set(key, item);
    const month = dateOf(record).slice(0, 7);
    const monthly = byMonth.get(month) || { month, incomeCents: 0, expenseCents: 0 };
    monthly[`${type}Cents`] += amount; byMonth.set(month, monthly);
  }
  totals.balanceCents = totals.incomeCents - totals.expenseCents;
  const categories = [...grouped.values()].sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category, 'zh-CN'));
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { startDate, endDate, totals, categories, months, recordCount: relevant.length, excludedUndatedCount: excluded.length,
    records: relevant.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.dayPosition || 0) - (a.dayPosition || 0) || clean(b.createdAt).localeCompare(clean(a.createdAt))) };
}

module.exports = { duplicateReason, analyzeFinanceRecords, cents, dateOf, typeOf, validPeriod };
