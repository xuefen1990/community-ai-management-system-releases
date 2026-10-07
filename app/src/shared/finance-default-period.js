(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CommunityFinanceDefaultPeriod = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function latestMonth(records, today) {
    let latestDate = '';
    for (const row of records || []) {
      const date = String(row.recordDate || row.record_date || row.date || '').trim();
      const type = row.recordType || row.type;
      const legacyAmount = row.amount;
      const numericLegacy = typeof legacyAmount === 'number' || typeof legacyAmount === 'string' && legacyAmount.trim() !== '';
      const amount = Object.hasOwn(row, 'amountCents') ? row.amountCents
        : numericLegacy ? Math.round(Number(legacyAmount) * 100) : NaN;
      if (validDate(date) && date <= today && ['income', 'expense'].includes(type)
        && Number.isSafeInteger(amount) && amount >= 0 && date > latestDate) latestDate = date;
    }
    if (!latestDate) return null;
    const end = new Date(`${latestDate.slice(0, 7)}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    const monthEnd = end.toISOString().slice(0, 10);
    return { latestDate, startDate: `${latestDate.slice(0, 7)}-01`, endDate: monthEnd > today ? today : monthEnd };
  }
  return { validDate, latestMonth };
}));
