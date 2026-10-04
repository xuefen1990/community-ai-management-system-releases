'use strict';
const { parseDate } = require('./finance-excel-parser');
const { cents, dateOf, typeOf } = require('./finance-ledger-analysis');
const { fail } = require('./foundation-data-model');
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && parseDate(value) === value;
const localToday = now => now.toLocaleDateString('sv-SE');

function validateOpeningBalance(value, today) {
  if (!isDate(value?.startDate) || value.startDate > today) fail('INVALID_INPUT', '期初日期必须是今天或之前的有效日期');
  if (!Number.isSafeInteger(value?.amountCents)) fail('INVALID_INPUT', '请输入有效的期初余额，最多两位小数');
}
function calculateAccountBalance(records, opening, { asOfDate, today = localToday(new Date()) } = {}) {
  const requestedDate = asOfDate || today;
  if (!isDate(requestedDate)) fail('INVALID_INPUT', '请选择有效的余额截止日期');
  const cutoff = requestedDate > today ? today : requestedDate;
  if (!opening) return { status: 'unset', asOfDate: cutoff, requestedDate, amountCents: null };
  validateOpeningBalance(opening, today);
  if (cutoff < opening.startDate) return { status: 'before-opening', asOfDate: cutoff, requestedDate, amountCents: null, openingDate: opening.startDate };
  let incomeCents = 0, expenseCents = 0, excludedCount = 0;
  for (const record of records || []) {
    const date = dateOf(record), amount = Object.hasOwn(record, 'amountCents') ? record.amountCents : cents(record), type = typeOf(record);
    if (!isDate(date) || !Number.isSafeInteger(amount) || amount < 0 || !['income', 'expense'].includes(type)) { excludedCount++; continue; }
    if (date < opening.startDate || date > cutoff) continue;
    if (type === 'income') incomeCents += amount; else expenseCents += amount;
    if (![incomeCents, expenseCents].every(Number.isSafeInteger)) fail('INVALID_INPUT', '累计金额超出可计算范围');
  }
  const amountCents = opening.amountCents + incomeCents - expenseCents;
  if (!Number.isSafeInteger(amountCents)) fail('INVALID_INPUT', '账户余额超出可计算范围');
  return { status: 'ready', asOfDate: cutoff, requestedDate, openingDate: opening.startDate,
    openingAmountCents: opening.amountCents, incomeCents, expenseCents, amountCents, excludedCount };
}
module.exports = { calculateAccountBalance, validateOpeningBalance, localToday };
