'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { ContractFeeFileService, availableFilePath, safeFilePart } = require('../../src/main/contract-fee-file-service');
const ContractFeeModel = require('../../src/shared/contract-fee-model');

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

test('reads all disbursement worksheets and every repeated table section', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'disbursement-sheets-'));
  try {
    const filePath = path.join(directory, '工资历史.xlsx');
    const workbook = XLSX.utils.book_new();
    const table = [['工资结算单'], ['姓名', '月/元', '月份', '金额'], ['甲', 800, 3, 2400], ['合计', '', '', 2400]];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([...table, ...table.map((row, index) => index === 2 ? ['乙', 2200, 3, 6600] : row)]), '7-9月');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '金额'], ['丙', 100]]), '7-9月(底表)');
    XLSX.writeFile(workbook, filePath);
    const result = new ContractFeeFileService({ userDataPath: directory }).readDisbursementExcel(filePath);
    assert.deepEqual(result.sheetNames, ['7-9月', '7-9月(底表)']);
    assert.deepEqual(result.sheets.map((sheet) => sheet.sections.length), [2, 1]);
    assert.deepEqual(result.rows.map((row) => row.name), ['甲', '乙', '丙']);
    assert.equal(result.sheets[1].sections[0].rows[0].sheetName, '7-9月(底表)');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('returns every worksheet and requires an explicit choice for a multi-year contract workbook', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-sheets-'));
  try {
    const filePath = path.join(directory, '大枣园明细.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '面积', '每亩/元', '租金（元）'], ['张三', 1, 700, 700]]), '2024年');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '面积', '每亩/元', '租金（元）'], ['李四', 2, 750, 1500]]), '2025年');
    XLSX.writeFile(workbook, filePath);
    const service = new ContractFeeFileService({ userDataPath: directory });
    const result = service.readExcel(filePath);
    assert.equal(result.requiresSheetSelection, true);
    assert.deepEqual(result.sheetNames, ['2024年', '2025年']);
    assert.equal(result.sheets[1].rows[0].householderName, '李四');
    const selected = service.readExcel(filePath, { sheetName: '2025年' });
    assert.equal(selected.sheetName, '2025年');
    assert.equal(selected.rows[0].amount, 1500);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
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

test('exports a project workbook with group summary, signature sheet and full text bank cards', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-project-export-'));
  try {
    const plan = ContractFeeModel.createContractFeeDistributionPlan({
      year: '2026', projectName: '大枣园', distributableAmount: '100.00',
      outputSettings: { organization: '陆庄社区', preparedBy: '王会计' },
      groups: [{
        id: 'group-one', groupName: '一组', allocatedAmount: '100.00', allocationType: 'population', tailRecipientItemId: 'household-one',
        fieldDefinitions: [{ id: 'contract-note', label: '地块说明', type: 'text', order: 10 }],
        items: [
          { id: 'household-one', householdId: 'family-one', householderName: '张三', recipientName: '王五', population: 1, bankCard: '00123456789012345678', customData: { 'contract-note': '东地' }, notes: '王五代收' },
          { id: 'household-two', householdId: 'family-two', householderName: '李四', recipientName: '王五', population: 2, bankCard: '00123456789012345678', customData: { 'contract-note': '西地' }, notes: '王五代收' },
        ],
      }],
    }, { id: 'project-one' });
    const batch = ContractFeeModel.createContractFeeDistributionBatch({ plan, batchDate: '2026-09-13' }, { id: 'batch-one' });
    const service = new ContractFeeFileService({ userDataPath: directory });
    const result = await service.exportContractFeeProjectWorkbook({ outputDirectory: directory, batch });
    assert.equal(result.ok, true);
    assert.deepEqual(result.file.sheetNames, ['各组汇总表', '一组签字明细']);
    const workbook = XLSX.readFile(result.file.path, { cellStyles: true });
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets['各组汇总表'], { header: 1, defval: '' });
    assert.equal(summary[3][1], '一组');
    assert.equal(summary[3][9], 100);
    const detailSheet = workbook.Sheets['一组签字明细'];
    const detail = XLSX.utils.sheet_to_json(detailSheet, { header: 1, defval: '' });
    assert.ok(detail[3].includes('户主姓名'));
    assert.ok(detail[3].includes('收款人姓名'));
    assert.ok(detail[3].includes('地块说明'));
    const cardColumn = detail[3].indexOf('完整银行卡号');
    assert.deepEqual(detail.slice(4, 6).map((row) => row[2]), ['张三', '李四']);
    assert.deepEqual(detail.slice(4, 6).map((row) => row[3]), ['王五', '王五']);
    assert.deepEqual(detail.slice(4, 6).map((row) => row[cardColumn]), ['00123456789012345678', '00123456789012345678']);
    assert.equal(detailSheet[XLSX.utils.encode_cell({ r: 4, c: cardColumn })].t, 's');
    assert.equal(detailSheet[XLSX.utils.encode_cell({ r: 5, c: cardColumn })].t, 's');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('exports signature detail with the imported Chinese headers and order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-fee-source-columns-'));
  try {
    const plan = ContractFeeModel.createContractFeeDistributionPlan({
      year: '2025', projectName: '大枣园', distributableAmount: '2625.00',
      groups: [{
        id: 'east-one', groupName: '东一组', allocatedAmount: '2625.00', allocationType: 'acreage', expectedBasisTotal: 3.5,
        outputTemplateSnapshot: { columns: [
          { header: '序号', fieldKey: 'sequence' }, { header: '姓名', fieldKey: 'name' }, { header: '面积', fieldKey: 'acreage' },
          { header: '每亩/元', fieldKey: 'unitPrice' }, { header: '租金\n（元）', fieldKey: 'amount' }, { header: '民丰银行账号', fieldKey: 'bankCard' }, { header: '签章', fieldKey: 'signature' },
        ] },
        items: [
          { id: 'one', householderName: '张三', recipientName: '张三', acreage: 1.5, bankCard: '00123456789012345678' },
          { id: 'two', householderName: '李四', recipientName: '李四', acreage: 2, bankCard: '00123456789012345679' },
        ],
      }],
    }, { id: 'source-columns-plan' });
    const batch = ContractFeeModel.createContractFeeDistributionBatch({ plan, batchDate: '2025-03-15' }, { id: 'source-columns-batch' });
    const service = new ContractFeeFileService({ userDataPath: directory });
    const result = await service.exportContractFeeProjectWorkbook({ outputDirectory: directory, batch });
    const workbook = XLSX.readFile(result.file.path, { cellStyles: true });
    const sheet = workbook.Sheets['东一组签字明细'];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    assert.deepEqual(grid[3], ['序号', '姓名', '面积', '每亩/元', '租金\n（元）', '民丰银行账号', '签章']);
    assert.deepEqual(grid[4].slice(0, 6), [1, '张三', 1.5, 750, 1125, '00123456789012345678']);
    assert.equal(sheet.F5.t, 's');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('exports a template disbursement workbook from the immutable batch snapshot', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'template-disbursement-export-'));
  const service = new ContractFeeFileService({ userDataPath: directory });
  const result = await service.exportTemplateDisbursementWorkbook({ outputDirectory: directory, batch: { title: '杂工补贴发放表', period: '2026 年 9 月', villageName: '陆庄社区', batchDate: '2026-09-03', templateKey: 'casual_labor', templateSnapshot: { builtIn: true }, items: [{ name: '张三', workDate: '9.1', workItem: '保洁', quantity: 2, unitPriceCents: 10000, amountCents: 20000, bankCard: '62220001', remark: '' }] } });
  assert.equal(result.ok, true);
  const workbook = XLSX.readFile(result.file.path); const grid = XLSX.utils.sheet_to_json(workbook.Sheets['发放表'], { header: 1, defval: '' });
  assert.equal(grid[0][0], '杂工补贴发放表'); assert.equal(grid[4][2], '姓名'); assert.equal(grid[5][2], '张三');
  await fs.rm(directory, { recursive: true, force: true });
});

test('exports workbench columns, zero values and text bank cards from copied template schema', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-export-'));
  try {
    const service = new ContractFeeFileService({ userDataPath: directory });
    const result = await service.exportTemplateDisbursementWorkbook({ outputDirectory:directory, batch:{ title:'测试承包费',period:'2026',templateKey:'custom_copy',templateSnapshot:{key:'custom_copy',workbenchKind:'contract_fee',fields:['面积']},visualLayout:{labels:{quantity:'应发面积'},widths:{bankCard:40},heights:{r:12}},items:[{id:'r',name:'测试居民',groupName:'一组',quantity:0,unitPriceCents:12000,amountCents:0,bankCard:'00123456789012345678'}]}});
    const workbook=XLSX.readFile(result.file.path,{cellStyles:true});const sheet=workbook.Sheets['发放表'];const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
    assert.ok(grid[4].includes('应发面积'));assert.ok(grid[5].includes(0));assert.ok(grid[5].includes('00123456789012345678'));
    assert.equal(sheet.F6.t,'s'); assert.ok(sheet['!rows'][5].hpt>33);
    await assert.rejects(()=>service.exportTemplateDisbursementWorkbook({outputDirectory:directory,batch:{workbenchDraft:{ready:false},items:[{}]}}),/草稿尚未填写完整/u);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test('exports only selected print columns and omits hidden period', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-print-columns-'));
  try {
    const service = new ContractFeeFileService({ userDataPath: directory });
    const batch = { title:'报酬发放表', period:'7~9月', batchDate:'2026-09-28', templateKey:'public_service', templateSnapshot:{builtIn:true}, visualLayout:{showPeriod:false, printColumns:[{key:'_sequence',label:'序号'},{key:'name',label:'收款人'},{key:'finalAmount',label:'金额',numeric:true}]}, items:[{name:'张三',groupName:'一组',amountCents:210000,bankCard:'00123'}] };
    const result = await service.exportTemplateDisbursementWorkbook({ outputDirectory:directory, batch });
    const grid = XLSX.utils.sheet_to_json(XLSX.readFile(result.file.path).Sheets['发放表'], {header:1,defval:''});
    assert.ok(!grid[2][0].includes('7~9月'));
    assert.deepEqual(grid[4], ['序号','收款人','金额']);
    assert.deepEqual(grid[5], [1,'张三',2100]);
    assert.deepEqual(grid[6], ['合计','',2100]);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
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
