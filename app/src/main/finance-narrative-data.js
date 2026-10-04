'use strict';

// Present every monetary field to the model in yuan so cents cannot be mistaken
// for the unit displayed in the dashboard. Keep integer cents in local storage.
function financeNarrativeData(report, { analysisDepth = 'brief', accountBalance = null } = {}) {
  const yuan = value => (Number(value || 0) / 100).toFixed(2);
  const { cents, dateOf, typeOf } = require('./finance-ledger-analysis');
  const { chartCategories } = require('../shared/finance-chart-groups');
  const serialize = row => ({ date: dateOf(row), type: typeOf(row), category: row.category,
    amount: yuan(cents(row)), summary: String(row.summary || '').slice(0, 180) });
  const valid = report.records.filter(row => ['income', 'expense'].includes(typeOf(row)) && Number.isSafeInteger(cents(row)) && cents(row) > 0);
  const largest = type => valid.filter(row => typeOf(row) === type).sort((a, b) => cents(b) - cents(a)).slice(0, 10);
  const percent = (part, total) => total > 0 ? Number((part / total * 100).toFixed(2)) : null;
  const monthlyChanges = report.months.map((item, index) => {
    const previous = report.months[index - 1];
    const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
    const consecutive = previous && monthIndex(item.month) - monthIndex(previous.month) === 1;
    return { month: item.month, periodSurplus: yuan(item.incomeCents - item.expenseCents),
      incomeChangePercent: consecutive ? percent(item.incomeCents - previous.incomeCents, previous.incomeCents) : null,
      expenseChangePercent: consecutive ? percent(item.expenseCents - previous.expenseCents, previous.expenseCents) : null };
  });
  const representative = [];
  if (analysisDepth === 'deep') {
    // Large entries and one example for each major category cover the whole
    // period rather than only the newest transactions. Amounts stay local.
    const seen = new Set();
    for (const row of [...largest('income'), ...largest('expense'), ...report.categories.slice(0, 24).map(item => valid.find(row => typeOf(row) === item.type && row.category === item.category)).filter(Boolean)]) {
      if (!seen.has(row)) { seen.add(row); representative.push(row); }
    }
  }
  return {
    unit: '元', startDate: report.startDate, endDate: report.endDate,
    totals: { income: yuan(report.totals.incomeCents), expense: yuan(report.totals.expenseCents),
      balance: yuan(report.totals.balanceCents), incomeCount: report.totals.incomeCount, expenseCount: report.totals.expenseCount },
    categories: report.categories.map(item => ({ type: item.type, category: item.category, amount: yuan(item.amountCents), count: item.count })),
    months: report.months.map(item => ({ month: item.month, income: yuan(item.incomeCents), expense: yuan(item.expenseCents) })),
    recordCount: report.recordCount,
    sample: (analysisDepth === 'deep' ? representative : report.records.slice(0, 30)).map(serialize),
    ...(analysisDepth === 'deep' ? {
      groupedCategories: ['income', 'expense'].flatMap(type => chartCategories(report, { type, mode: 'summary' }).parts.map(item => ({
        type, category: item.category, amount: yuan(item.amountCents), count: item.count, categories: item.categories }))),
      largestEntries: { income: largest('income').map(serialize), expense: largest('expense').map(serialize) },
      indicators: {
        expenseToIncomePercent: percent(report.totals.expenseCents, report.totals.incomeCents),
        categoryShares: report.categories.map(item => ({ type: item.type, category: item.category,
          sharePercent: percent(item.amountCents, report.totals[`${item.type}Cents`]) })),
        monthlyChanges,
      },
      accountBalance: accountBalance?.status === 'ready' ? { status: 'ready', asOfDate: accountBalance.asOfDate, amount: yuan(accountBalance.amountCents) } : { status: accountBalance?.status || 'unset' },
      limitations: { excludedUndatedCount: report.excludedUndatedCount || 0, unlistedMonths: '未列出的月份没有台账记录，不能视为零收支',
        unknownChange: '变化百分比为null时，前月无记录或基数为零，不能据此判断环比', sample: '摘要仅为代表性样本，统计依据完整区间台账' },
    } : {}),
  };
}
module.exports = { financeNarrativeData };
