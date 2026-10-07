'use strict';
const test = require('node:test');
const manifested = require('../helpers/finance-import-manifest.cjs');
const assert = require('node:assert/strict');
const { parseFinanceGrid } = require('../../src/main/finance-excel-parser');
const { analyzeFinanceRecords } = require('../../src/main/finance-ledger-analysis');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FinanceWorkbookService } = require('../../src/main/finance-workbook-service');
const XLSX = require('xlsx');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function createService(initial = {}) {
  let data = structuredClone(initial);
  const store = { read: async () => structuredClone(data), update: async mutate => { const draft = structuredClone(data); const result = await mutate(draft); data = draft; return { result, data: draft }; } };
  return { service: new FoundationBusinessService({ store, authorize: async () => {} }), data: () => structuredClone(data) };
}
const call = (service, path, method = 'GET', body) => service.request({ method, path: `/api/v3${path}`, body: method==='POST' && path==='/finance-imports' ? manifested(body) : body });

test('multi-sheet parser finds headers, skips remarks and subtotals, and automatically assigns financial categories', () => {
  const january = parseFinanceGrid([['一月财务明细'], ['日期', '摘要', '收入金额', '支出金额', '科目'],
    ['2026/01/03', '上级拨款到账', '1200', '', '上级拨款'], ['合计', '', '1200', '', ''], ['备注：以下为附件说明'],
    ['2026/01/08', '办公室物品', '', '38.50', '未知科目']], { sheetName: '1月' });
  const february = parseFinanceGrid([['日期', '摘要', '金额', '类型', '科目'], ['2026-02-02', '捐赠', '500', '收入', '捐赠收入']], { sheetName: '2月' });
  assert.equal(january.headerRowNumber, 2);
  assert.equal(january.rows.length, 2);
  assert.equal(january.skipped.length, 4);
  assert.equal(january.rows[0].recordType, 'income');
  assert.equal(january.rows[1].amountCents, 3850);
  assert.equal(january.rows[1].category, '办公支出');
  assert.equal(february.rows[0].category, '捐赠收入');
});

test('workbook selection keeps separate sheets and remaps a nonstandard header', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-import-'));
  const filePath = path.join(directory, '月份.xlsx');
  try {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['标题'], ['日期', '摘要', '金额', '类型', '科目'], ['2026-01-02', '捐赠', 200, '收入', '捐赠收入']]), '1月');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['时间', '说明文字', '支出元'], ['2026-02-04', '维修水管', 35]]), '2月');
    XLSX.writeFile(book, filePath);
    const service = new FinanceWorkbookService({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }) } });
    const preview = await service.select();
    assert.deepEqual(preview.sheets.map(sheet => sheet.sheetName), ['1月', '2月']);
    assert.equal(preview.sheets[0].rows[0].sourceRowNumber, 3);
    const corrected = service.remap({ previewId: preview.previewId, sheetName: '2月', headerRowNumber: 1, mapping: { date: 0, summary: 1, expense: 2 } });
    assert.equal(corrected.rows[0].recordType, 'expense');
    assert.equal(corrected.rows[0].amountCents, 3500);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('import is atomic, idempotent, checks duplicates and date analysis includes manual rows', async () => {
  const { service, data } = createService({ finances: [{ id: 'manual', recordDate: '2026-01-01', recordType: 'income', summary: '经营收入', category: '集体经营收入', amountCents: 10000 }] });
  const input = { batchId: 'batch-1', fileHash: 'a'.repeat(64), fileName: '财务.xlsx', sheets: ['1月'], rows: [
    { sheetName: '1月', sourceRowNumber: 2, recordDate: '2026-01-02', recordType: 'expense', amountCents: 2500, summary: '购买纸张', category: '办公支出' },
    { sheetName: '1月', sourceRowNumber: 3, recordDate: '', recordType: 'income', amountCents: 5000, summary: '捐赠', category: '捐赠收入' },
  ] };
  assert.equal((await call(service, '/finance-imports', 'POST', input)).ok, false);
  assert.equal(data().finances.length, 1);
  input.rows.pop();
  const saved = await call(service, '/finance-imports', 'POST', input);
  assert.equal(saved.ok, true);
  assert.equal(saved.data.count, 1);
  assert.equal((await call(service, '/finance-imports', 'POST', input)).data.alreadyImported, true);
  assert.equal(data().finances.length, 2);
  const otherBatch = { ...input, batchId: 'batch-2' };
  assert.equal((await call(service, '/finance-imports', 'POST', otherBatch)).data.count, 0);
  assert.equal(data().finances.length, 2);
  const report = await call(service, '/finance-analysis?startDate=2026-01-01&endDate=2026-01-31');
  assert.equal(report.data.totals.incomeCents, 10000);
  assert.equal(report.data.totals.expenseCents, 2500);
  assert.equal(report.data.totals.balanceCents, 7500);
});
