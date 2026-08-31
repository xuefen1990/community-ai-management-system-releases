'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { ContractFeeFileService, availableFilePath, safeFilePart } = require('../../src/main/contract-fee-file-service');

test('sanitizes exported file name parts', () => {
  assert.equal(safeFilePart('某地/合同:*?'), '某地-合同---');
});

test('does not silently overwrite an earlier grouped export', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-name-'));
  const first = path.join(directory, '一组.xlsx');
  await fs.writeFile(first, 'existing');
  assert.equal(await availableFilePath(directory, '一组.xlsx'), path.join(directory, '一组（2）.xlsx'));
  await fs.rm(directory, { recursive: true, force: true });
});

test('reads a contract fee workbook through the dedicated parser', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-read-'));
  const filePath = path.join(directory, '发放表.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '人口', '单价', '金额', '卡号'], ['张三', 2, 100, 200, '6222']]), '发放表');
  XLSX.writeFile(workbook, filePath);
  const service = new ContractFeeFileService({ userDataPath: directory });
  const result = service.readExcel(filePath);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].name, '张三');
  await fs.rm(directory, { recursive: true, force: true });
});

test('exports one real workbook per group with totals', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-export-'));
  const service = new ContractFeeFileService({ userDataPath: directory });
  const result = await service.exportGroupedFiles({
    outputDirectory: directory,
    contract: { name: '土地/租赁合同', startDate: '2026-01-01', endDate: '2030-12-31' },
    batch: { batchDate: '2026-09-01' },
    groups: [
      { groupName: '一组', rows: [{ name: '张三', groupName: '一组', calculationType: 'population', quantity: 2, unitPriceCents: 10000, finalAmountCents: 20000, bankCard: '6222' }] },
      { groupName: '二组', rows: [{ name: '李四', groupName: '二组', calculationType: 'direct', quantity: 0, unitPriceCents: 0, finalAmountCents: 30000, bankCard: '6333' }] },
    ],
  });
  assert.equal(result.files.length, 2);
  const exported = XLSX.readFile(result.files[0].path);
  const grid = XLSX.utils.sheet_to_json(exported.Sheets['承包费发放表'], { header: 1, defval: '' });
  assert.equal(grid[0][0], '合同：土地/租赁合同');
  assert.equal(grid.at(-1)[1], '合计');
  assert.equal(grid.at(-1)[6], 200);
  await fs.rm(directory, { recursive: true, force: true });
});

test('returns cancellation without writing files', async () => {
  const service = new ContractFeeFileService({ userDataPath: '/tmp', dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } });
  assert.deepEqual(await service.exportGroupedFiles({ groups: [] }), { ok: false, canceled: true, files: [] });
});

test('reads a complete farmland subsidy workbook and exports the five connected attachments', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'farmland-subsidy-'));
  const sourcePath = path.join(directory, '补贴.xlsx'); const source = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([['序号', '户主姓名', '补贴金额（元）'], [1, '李四', 120]]), '附件1-4');
  XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([['序号', '户主姓名', '身份证号', '开户行', '一卡通号', '村', '村民组', '应享受补贴面积（亩）', '补贴标准（元/亩）', '补贴金额（元）', '备注'], [1, '张三', '320000199001010011', '农商行', '62220001', '陆庄', '东一组', 2, 120, 240, ''], [2, '李四', '320000199001010022', '农商行', '62220002', '陆庄', '东一组', 1, 120, 120, '']]), '地力补贴兑付清册');
  XLSX.writeFile(source, sourcePath); const service = new ContractFeeFileService({ userDataPath: directory }); const imported = service.readFarmlandSubsidyExcel(sourcePath);
  assert.equal(imported.records.length, 2); assert.equal(imported.records[1].category, 'village_cadre');
  const exported = await service.exportFarmlandSubsidyWorkbook({ outputDirectory: directory, ledger: { year: 2026, villageName: '陆庄', streetName: '晓店街道', records: imported.records.map((row) => ({ ...row, ownershipArea: row.eligibleArea, excludedArea: 0, standardCents: Math.round(row.standard * 100), amountCents: Math.round(row.amount * 100) })) } });
  assert.equal(exported.file.sheetNames.length, 5); assert.deepEqual(exported.file.sheetNames, ['附件1-1', '附件1-4', '附件2-1', '附件2-4', '地力补贴兑付清册']);
  await fs.rm(directory, { recursive: true, force: true });
});
