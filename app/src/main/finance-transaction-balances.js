'use strict';
const { cents, dateOf, typeOf } = require('./finance-ledger-analysis');
const { parseDate } = require('./finance-excel-parser');
const { domainRows, mutateDomain } = require('./foundation-domains');
const { fail } = require('./foundation-data-model');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && parseDate(value) === value;
const amountOf = row => Object.hasOwn(row, 'amountCents') ? row.amountCents : cents(row);
const valid = (row, today) => validDate(dateOf(row)) && dateOf(row) <= today && ['income', 'expense'].includes(typeOf(row)) && Number.isSafeInteger(amountOf(row)) && amountOf(row) >= 0;
const groupKey = row => row.importBatchId ? `${row.importBatchId}/${row.sourceSheetName || row.sheetName}` : `manual/${row.id}`;
const identity = row => String(row.id || `${row.sheetName}:${row.sourceRowNumber}`);

function transactionBalances(records, opening, { today } = {}) {
  today ||= new Date().toLocaleDateString('sv-SE');
  const days = new Map();
  for (const row of records) if (valid(row, today)) { const date = dateOf(row); if (!days.has(date)) days.set(date, []); days.get(date).push(row); }
  let running = opening?.amountCents ?? 0, cumulative = 0;
  const items = [], readyOpening = opening && validDate(opening.startDate) && Number.isSafeInteger(opening.amountCents);
  let candidate = null; const earliestDate = [...days.keys()].sort()[0];
  for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const reviewed = day.every(row => row.orderConfirmed === true && Number.isSafeInteger(row.transactionOrder)) && new Set(day.map(row => row.transactionOrder)).size === day.length;
    const ambiguous = day.length > 1 && new Set(day.map(groupKey)).size > 1 && !reviewed;
    const groupRanks = new Map();
    for (const row of day) { const key = groupKey(row), rank = `${String(row.transactionOrder ?? 0).padStart(16, '0')}/${row.createdAt || ''}/${identity(row)}`; if (!groupRanks.has(key) || rank < groupRanks.get(key)) groupRanks.set(key, rank); }
    day.sort((a, b) => {
      if (reviewed) return a.transactionOrder - b.transactionOrder;
      if (groupKey(a) === groupKey(b) && a.importBatchId) return (a.sourceOrder ?? a.sourceRowNumber) - (b.sourceOrder ?? b.sourceRowNumber) || identity(a).localeCompare(identity(b));
      return groupRanks.get(groupKey(a)).localeCompare(groupRanks.get(groupKey(b))) || groupKey(a).localeCompare(groupKey(b)) || identity(a).localeCompare(identity(b));
    });
    for (const [dayIndex, row] of day.entries()) {
      const delta = typeOf(row) === 'income' ? amountOf(row) : -amountOf(row);
      cumulative += delta;
      if (!Number.isSafeInteger(cumulative)) fail('INVALID_INPUT', '累计金额超出可计算范围');
      const available = readyOpening && date >= opening.startDate;
      if (available) running += delta;
      if (!Number.isSafeInteger(running)) fail('INVALID_INPUT', '账户余额超出可计算范围');
      const source = Number.isSafeInteger(row.sourceBalanceCents) ? row.sourceBalanceCents : null;
      // A candidate is a suggestion only, never an automatically adopted balance.
      if (!candidate && source !== null && !ambiguous) candidate = { startDate: earliestDate, amountCents: source - cumulative, recordId: row.id, sourceFileName: row.sourceFileName || '', sourceSheetName: row.sourceSheetName || '', sourceRowNumber: row.sourceRowNumber };
      const calculated = available ? running : null;
      const difference = calculated !== null && source !== null ? calculated - source : null;
      if (difference !== null && !Number.isSafeInteger(difference)) fail('INVALID_INPUT', '余额差额超出可计算范围');
      const status = !available ? 'unavailable' : ambiguous ? 'order-review' : source === null ? (row.sourceBalanceText ? 'invalid-source' : 'no-source') : difference !== 0 ? 'mismatch' : 'matched';
      items.push({ ...row, calculatedBalanceCents: calculated, sourceBalanceCents: source, balanceDifferenceCents: difference,
        balanceStatus: status, balanceReason: !readyOpening ? '未设置期初余额' : date < opening.startDate ? '早于期初日期' : ambiguous ? '同日交易顺序需要确认' : '', dayPosition: dayIndex + 1, dayCount: day.length, orderNeedsReview: ambiguous });
    }
  }
  const byId = new Map(items.map(row => [identity(row), row]));
  const decorated = records.map(row => byId.get(identity(row)) || { ...row, calculatedBalanceCents: null, balanceDifferenceCents: null, balanceStatus: 'unavailable', balanceReason: '日期、金额或方向无效，或为未来记录' });
  const pending = items.filter(row => ['mismatch', 'order-review', 'invalid-source'].includes(row.balanceStatus));
  const candidateUseful = !readyOpening || items.some(row => validDate(dateOf(row)) && dateOf(row) < opening.startDate);
  return { items: decorated, pendingCount: pending.length, mismatchCount: items.filter(row => row.balanceStatus === 'mismatch').length,
    unavailableCount: decorated.filter(row => row.balanceStatus === 'unavailable').length, firstPendingId: pending[0]?.id || null,
    openingCandidate: candidateUseful && Number.isSafeInteger(candidate?.amountCents) ? candidate : null, openingVersion: opening?.version || 0 };
}

function saveTransactionOrder(database, input, { now, uuid, today }) {
  if (!validDate(input.recordDate) || input.recordDate > today) fail('INVALID_INPUT', '交易日期不正确');
  const day = (domainRows(database, '/finance-records') || []).filter(row => dateOf(row) === input.recordDate && valid(row, today));
  if (!Array.isArray(input.rows) || input.rows.length !== day.length || new Set(input.rows.map(row => String(row.id))).size !== day.length) fail('VERSION_CONFLICT', '当天记录已变化，请重新打开交易顺序');
  const originals = new Map(day.map(row => [String(row.id), row]));
  for (const row of input.rows) { const original = originals.get(String(row.id)); if (!original) fail('VERSION_CONFLICT', '当天记录已变化'); if (row.baseVersion !== original.version) fail('VERSION_CONFLICT', '当天记录已变化，请重新打开交易顺序'); }
  for (const [index, row] of input.rows.entries()) mutateDomain(database, 'PATCH', `/finance-records/${encodeURIComponent(row.id)}`, { baseVersion: row.baseVersion, changes: { transactionOrder: index + 1, orderConfirmed: true } }, { now, uuid });
  return { recordIds: input.rows.map(row => row.id), count: day.length };
}
module.exports = { transactionBalances, saveTransactionOrder };
