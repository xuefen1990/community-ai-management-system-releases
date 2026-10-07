'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFinanceGrid } = require('../../src/main/finance-excel-parser');
const { review, issuesOf } = require('../../src/shared/finance-import-review');
const { recognizeFinanceWorkbook } = require('../../src/main/finance-ai-recognition');

test('monthly ledger recognizes 收、支内容摘要 and derives complete dates from file year and sheet month', () => {
  const grid = [['财务收支明细'], [], ['日期', '收、支内容摘要', '收入', '支出', '余额'],
    ['1.2', '收租金', 1500, '', 1500], [8, '购办公用品', '', 50, 1450],
    ['', '上月结转', '', '', 300], ['', '本月合计', 1500, 50, 1450], ['备注：签字后归档'],
    ['1.9', '日常杂项', '', 20, 1430]];
  const sheet = parseFinanceGrid(grid, { sheetName: '1月', fileName: '财务收支（2026）.xlsx' });
  assert.equal(sheet.mapping.summary, 1);
  assert.equal(sheet.mapping.amount, undefined);
  assert.equal(sheet.rows.length, 3);
  assert.deepEqual(sheet.rows.map(row => row.recordDate), ['2026-01-02', '2026-01-08', '2026-01-09']);
  assert.deepEqual(sheet.rows.map(row => row.amountCents), [150000, 5000, 2000]);
  assert.deepEqual(sheet.rows.map(row => row.category), ['租赁收入', '办公用品费', '其他支出']);
  assert.ok(sheet.rows.every(row => issuesOf(row).length === 0));
  assert.equal(sheet.skipped.length, 5);
});

test('split month/day headers and Excel dates are understood; a missing year or impossible date is never invented', () => {
  const sheet = parseFinanceGrid([['2026年度账本'], ['日期', '', '摘要', '收入', '支出', '余额'], ['月', '日', '', '', '', ''],
    [2, 28, '购买打印纸', '', 12, 88], [2, 30, '购买文具', '', 10, 78]], { sheetName: '2月' });
  assert.equal(sheet.rows[0].recordDate, '2026-02-28');
  assert.equal(sheet.rows[1].recordDate, '');
  const undated = parseFinanceGrid([['日期', '摘要', '支出'], ['3.2', '维修', 10]], { sheetName: '3月' });
  assert.equal(undated.rows[0].recordDate, '');
  assert.ok(issuesOf(undated.rows[0]).length);
});

test('automatic review selects every usable row and excludes duplicate or invalid rows only within selected sheets', () => {
  const source = { recordDate: '2026-01-02', recordType: 'expense', amountCents: 1000, summary: '购买办公打印纸', category: '办公支出' };
  const rows = [{ ...source, key: 'one', sheetName: '1月' }, { ...source, key: 'two', sheetName: '2月' },
    { ...source, key: 'bad', sheetName: '2月', recordDate: '2026-02-30' }];
  const selected = review(rows, [], new Set(['2月']));
  assert.deepEqual([...selected.selected], ['two']);
  assert.equal(selected.totals.unresolved, 1);
  const all = review(rows, [], new Set(['1月', '2月']));
  assert.deepEqual([...all.selected], ['one', 'two']);
  assert.equal(all.totals.duplicates, 0);
});

test('AI re-recognizes raw headers and categories without accepting model supplied dates or money', async () => {
  const grid = [['明细'], ['办理日', '用途描述', '付款数额', '资金结余'], ['2026-01-02', '社区维修', 30, 970]];
  const parsed = parseFinanceGrid(grid, { sheetName: '1月', fileName: '账本2026.xlsx' });
  const preview = { grids: new Map([['1月', grid]]), sheets: new Map([['1月', parsed]]), fileName: '账本2026.xlsx' };
  let calls = 0;
  const aiRouter = { async chat() { calls++; return { content: calls === 1
    ? JSON.stringify({ headerRowNumber: 2, mapping: { date: 0, summary: 1, expense: 2, amount: 3 } })
    : JSON.stringify([{ index: 0, recordType: 'expense', category: '维修维护', recordDate: '2099-01-01', amountCents: 999999 }]) }; } };
  const result = await recognizeFinanceWorkbook({ workbookService: { getPreview: () => preview }, aiRouter, previewId: 'preview', sheetNames: ['1月'] });
  assert.equal(result.sheets[0].mapping.amount, undefined);
  assert.equal(result.sheets[0].rows[0].recordDate, '2026-01-02');
  assert.equal(result.sheets[0].rows[0].amountCents, 3000);
  assert.equal(result.sheets[0].rows[0].categorySource, 'rules');
});

test('AI recognizes all candidate descriptions across batches and partial failure preserves local results', async () => {
  const rows = Array.from({ length: 63 }, (_, index) => ({ summary: `杂项-${index}`, sourceCategory: '', recordType: 'expense',
    category: '其他支出', categorySource: 'default', amountCents: 100, recordDate: '2026-01-02', issues: [] }));
  const sheet = { sheetName: '1月', rows, mapping: { date: 0, summary: 1, expense: 2 }, error: '', skipped: [] };
  const grid = [['日期', '摘要', '支出'], ...rows.map(row => [row.recordDate, row.summary, 1])];
  const preview = { grids: new Map([['1月', grid]]), sheets: new Map([['1月', sheet]]) };
  let calls = 0;
  const aiRouter = { async chat({ messages }) { calls++;
    if (messages[0].content.includes('识别财务 Excel')) return { content: JSON.stringify({ headerRowNumber: 1, mapping: { date: 0, summary: 1, expense: 2 } }) };
    const sample = JSON.parse(messages[1].content); return { content: JSON.stringify(sample.map(row => ({ index: row.index, recordType: 'expense', category: '档案整理费', confident:true }))) }; } };
  const input = { workbookService: { getPreview: () => preview }, aiRouter, previewId: 'preview', sheetNames: ['1月'] };
  const result = await recognizeFinanceWorkbook(input);
  assert.equal(calls, 7);
  assert.ok(result.sheets[0].rows.every(row => row.category === '档案整理费'));
  input.aiRouter = { chat: async () => { throw new Error('网络暂不可用'); } };
  const failed = await recognizeFinanceWorkbook(input);
  assert.equal(failed.sheets[0].rows.length, 63);
  assert.equal(failed.sheets[0].rows[0].amountCents, 100);
  assert.ok(failed.warnings.includes('网络暂不可用'));
});

test('automatic checks preserve cents despite floating point noise and exclude ambiguous negative cancellation entries', () => {
  const sheet = parseFinanceGrid([['日期', '摘要', '收入', '支出'],
    ['2026-01-02', '办公支出', '', 0.1 + 0.2], ['2026-01-03', '收入冲销', -12, '']], { sheetName: '1月' });
  assert.equal(sheet.rows[0].amountCents, 30);
  assert.equal(sheet.rows[1].amountCents, null);
  assert.ok(issuesOf(sheet.rows[1]).length);
});

test('AI import proposes specific reusable categories and review accepts the returned catalog', async () => {
  const grid = [['日期','摘要','支出'],['2026-02-02','社区用水账单',80]];
  const sheet = parseFinanceGrid(grid, {sheetName:'2月'}), preview = {fileName:'财务.xlsx',grids:new Map([['2月',grid]]),sheets:new Map([['2月',sheet]])};
  const result = await recognizeFinanceWorkbook({workbookService:{getPreview:()=>preview},previewId:'p',sheetNames:['2月'],aiRouter:{chat:async({task})=>({content:task.taskKind==='finance-header-recognition'?'{"headerRowNumber":1,"mapping":{"date":0,"summary":1,"expense":2}}':'[{"index":0,"recordType":"expense","category":"自来水费"}]'})}});
  assert.equal(result.sheets[0].rows[0].category,'水费'); assert.ok(result.categories.expense.includes('水费'));
  assert.equal(issuesOf(result.sheets[0].rows[0],result.categories).length,0);
  assert.equal(result.sheets[0].rows[0].amountCents,8000); assert.equal(result.sheets[0].rows[0].recordDate,'2026-02-02');
});
