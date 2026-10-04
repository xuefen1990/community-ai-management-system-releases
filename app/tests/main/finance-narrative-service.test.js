'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeRequest, generateFinanceNarrative } = require('../../src/main/finance-narrative-service');
const records = [
  { id: 'old', recordDate: '2025-02-01', recordType: 'income', category: '土地租金收入', summary: '合成租赁收入', amountCents: 800000 },
  { id: 'large', recordDate: '2025-01-01', recordType: 'expense', category: '排涝工程支出', summary: '合成排涝工程', amountCents: 700000 },
  ...Array.from({ length: 35 }, (_, i) => ({ id: `new-${i}`, recordDate: '2025-12-01', recordType: 'expense', category: '水费', summary: '合成用水记录', amountCents: 1000 })),
];
const value = { startDate: '2025-01-01', endDate: '2025-12-31' };
const database = { financeOpeningBalance: { startDate: '2025-01-01', amountCents: 500000 } };

test('brief and deep modes share complete statistics; deep includes older large entries, purpose groups and account balance', () => {
  const brief = narrativeRequest(records, database.financeOpeningBalance, value);
  const deep = narrativeRequest(records, database.financeOpeningBalance, { ...value, analysisDepth: 'deep' });
  assert.equal(brief.task.taskTier, 'basic'); assert.equal(deep.task.taskTier, 'deep'); assert.equal(deep.task.maxTokens, 4096);
  const b = JSON.parse(brief.messages[1].content), d = JSON.parse(deep.messages[1].content);
  assert.deepEqual(d.totals, b.totals); assert.equal(d.recordCount, 37);
  assert.equal(d.sample.find(row => row.summary === '合成排涝工程').amount, '7000.00');
  assert.equal(d.accountBalance.amount, '5650.00'); assert.equal(d.totals.balance, '650.00');
  assert.equal(d.groupedCategories.find(row => row.category === '公共服务').amount, '350.00');
  assert.equal(d.months.length, 3); assert.match(d.limitations.unlistedMonths, /不能视为零/);
  assert.doesNotMatch(JSON.stringify(d), /Cents/);
});

test('cost confirmation honors router policy before using AI; insufficiency never calls chat', async () => {
  let chats = 0;
  const aiRouter = { estimate: async () => ({ requiresConfirmation: true, sufficient: true, estimatedTokens: 6000 }), chat: async request => { chats++; assert.equal(request.task.taskTier, 'deep'); return { content: '{"summary":"合成报告","sections":[{"title":"概况","text":"基于完整台账"}]}' }; } };
  const input = { database, records, value: { ...value, analysisDepth: 'deep' }, aiRouter };
  const preview = await generateFinanceNarrative(input);
  assert.equal(preview.requiresConfirmation, true); assert.equal(chats, 0);
  assert.equal((await generateFinanceNarrative({ ...input, value: { ...input.value, usageConfirmed: true } })).analysisDepth, 'deep');
  assert.equal(chats, 1);
  aiRouter.estimate = async () => ({ sufficient: false });
  await assert.rejects(generateFinanceNarrative(input), /额度不足/); assert.equal(chats, 1);
});

test('missing opening settings and no records are handled without fabricating balance or calling AI', async () => {
  const deep = narrativeRequest(records, null, { ...value, analysisDepth: 'deep' });
  assert.deepEqual(JSON.parse(deep.messages[1].content).accountBalance, { status: 'unset' });
  await assert.rejects(generateFinanceNarrative({ database: {}, records: [], value, aiRouter: { estimate() { throw new Error('should not estimate'); } } }), /没有可分析/);
});

test('deep generation rejects incomplete output and changes are not inferred across missing months', async () => {
  const data = JSON.parse(narrativeRequest(records, null, { ...value, analysisDepth: 'deep' }).messages[1].content);
  assert.equal(data.indicators.monthlyChanges[1].expenseChangePercent, -100);
  assert.equal(data.indicators.monthlyChanges[2].expenseChangePercent, null);
  await assert.rejects(generateFinanceNarrative({ database, records, value: { ...value, analysisDepth: 'deep' },
    aiRouter: { estimate: async () => ({ sufficient: true }), chat: async () => ({ content: '{"summary":"缺失章节"}' }) } }), /内容不完整/);
});
