'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');

const { parseContractFeeExcelGrid } = require('../shared/contract-fee-excel-parser');
const { parseFarmlandSubsidyWorkbook } = require('../shared/farmland-subsidy-excel-parser');
const { parseDisbursementExcelGrid } = require('../shared/disbursement-excel-parser');

function safeFilePart(value, fallback = '未命名') {
  const cleaned = String(value ?? '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/\.+$/u, '').slice(0, 80);
  return cleaned || fallback;
}

function requestedPath(value) { return typeof value === 'string' ? value : value?.filePath || value?.path || null; }

async function availableFilePath(directory, fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  for (let index = 1; ; index += 1) {
    const candidate = path.resolve(directory, index === 1 ? fileName : `${baseName}（${index}）${extension}`);
    try { await fs.access(candidate); } catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
}

class ContractFeeFileService {
  constructor({ userDataPath, dialog }) {
    this.dialog = dialog;
    this.attachmentsDirectory = path.join(userDataPath, 'contract-fee', 'attachments');
  }

  async selectAndReadExcel() {
    if (!this.dialog) throw new Error('当前环境无法选择 Excel 文件');
    const selected = await this.dialog.showOpenDialog({ title: '选择承包费发放表', properties: ['openFile'], filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls', 'csv'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, data: this.readExcel(selected.filePaths[0]) };
  }

  readExcel(value) {
    const filePath = requestedPath(value);
    if (!filePath) throw new TypeError('未指定 Excel 文件');
    const extension = path.extname(filePath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('请选择 .xlsx、.xls 或 .csv 表格文件');
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('表格中没有可读取的工作表');
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
    return { ...parseContractFeeExcelGrid(grid), fileName: path.basename(filePath), sheetName };
  }

  async selectAndReadDisbursementExcel() {
    if (!this.dialog) throw new Error('当前环境无法选择 Excel 文件');
    const selected = await this.dialog.showOpenDialog({ title: '选择现成发放明细', properties: ['openFile'], filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls', 'csv'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, data: this.readDisbursementExcel(selected.filePaths[0]) };
  }

  readDisbursementExcel(value) {
    const filePath = requestedPath(value); if (!filePath) throw new TypeError('未指定 Excel 文件');
    if (!['.xlsx', '.xls', '.csv'].includes(path.extname(filePath).toLowerCase())) throw new Error('请选择 .xlsx、.xls 或 .csv 表格文件');
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false }); const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('表格中没有可读取的工作表');
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
    return { ...parseDisbursementExcelGrid(grid), fileName: path.basename(filePath), sheetName };
  }

  async selectAndReadFarmlandSubsidyExcel() {
    if (!this.dialog) throw new Error('当前环境无法选择 Excel 文件');
    const selected = await this.dialog.showOpenDialog({ title: '选择地力补贴整套 Excel', properties: ['openFile'], filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, data: this.readFarmlandSubsidyExcel(selected.filePaths[0]) };
  }

  readFarmlandSubsidyExcel(value) {
    const filePath = requestedPath(value);
    if (!filePath) throw new TypeError('未指定 Excel 文件');
    const extension = path.extname(filePath).toLowerCase();
    if (!['.xlsx', '.xls'].includes(extension)) throw new Error('请选择 .xlsx 或 .xls 地力补贴表格');
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
    const sheets = Object.fromEntries(workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false })]));
    return { ...parseFarmlandSubsidyWorkbook(sheets), fileName: path.basename(filePath) };
  }

  async importAttachments() {
    if (!this.dialog) throw new Error('当前环境无法选择合同附件');
    const selected = await this.dialog.showOpenDialog({ title: '选择合同附件', properties: ['openFile', 'multiSelections'], filters: [{ name: '合同及常用附件', extensions: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'xls', 'xlsx'] }] });
    if (selected.canceled) return { ok: false, canceled: true, data: [] };
    await fs.mkdir(this.attachmentsDirectory, { recursive: true });
    const importedAt = new Date().toISOString();
    const data = [];
    for (const sourcePath of selected.filePaths) {
      const extension = path.extname(sourcePath).toLowerCase();
      const baseName = safeFilePart(path.basename(sourcePath, extension), '合同附件');
      const targetName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}${extension}`;
      const targetPath = path.join(this.attachmentsDirectory, targetName);
      await fs.copyFile(sourcePath, targetPath);
      const stats = await fs.stat(targetPath);
      data.push({ id: targetName, name: path.basename(sourcePath), path: targetPath, size: stats.size, importedAt });
    }
    return { ok: true, data };
  }

  async exportGroupedFiles(value = {}) {
    let outputDirectory = requestedPath(value.outputDirectory);
    if (!outputDirectory) {
      if (!this.dialog) throw new Error('当前环境无法选择导出文件夹');
      const selected = await this.dialog.showOpenDialog({ title: '选择按组导出的保存文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, files: [] };
      [outputDirectory] = selected.filePaths;
    }
    const resolvedDirectory = path.resolve(outputDirectory);
    await fs.mkdir(resolvedDirectory, { recursive: true });
    const contractName = safeFilePart(value.contract?.name, '承包费');
    const batchDate = safeFilePart(value.batch?.batchDate, '未填写日期');
    const files = [];
    for (const group of value.groups || []) {
      const groupName = safeFilePart(group.groupName, '未分组');
      const rows = (group.rows || []).map((row, index) => ({
        序号: index + 1,
        姓名: row.name,
        组别: row.groupName,
        计算方式: row.calculationType === 'population' ? '按人口' : row.calculationType === 'acreage' ? '按亩数' : '直接金额',
        人口或亩数: Number(row.quantity || 0),
        单价: Number(row.unitPriceCents || 0) / 100,
        发放金额: Number(row.finalAmountCents || 0) / 100,
        银行卡号: String(row.bankCard || ''),
      }));
      const total = rows.reduce((sum, row) => sum + Number(row.发放金额 || 0), 0);
      rows.push({ 序号: '', 姓名: '合计', 组别: group.groupName, 计算方式: '', 人口或亩数: '', 单价: '', 发放金额: total, 银行卡号: '' });
      const heading = [
        [`合同：${value.contract?.name || ''}`],
        [`合同期限：${value.contract?.startDate || ''} 至 ${value.contract?.endDate || ''}`],
        [`发放日期：${value.batch?.batchDate || ''}`],
        [],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(heading);
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A5', skipHeader: false });
      worksheet['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 24 }];
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, '承包费发放表');
      const fileName = `${contractName}-${groupName}-${batchDate}.xlsx`;
      const filePath = await availableFilePath(resolvedDirectory, fileName);
      if (path.dirname(filePath) !== resolvedDirectory) throw new Error('导出文件路径超出所选文件夹');
      XLSX.writeFile(workbook, filePath);
      files.push({ groupName: group.groupName, fileName, path: filePath, rowCount: (group.rows || []).length });
    }
    return { ok: true, files, outputDirectory: resolvedDirectory };
  }

  async exportTemplateDisbursementWorkbook(value = {}) {
    let outputDirectory = requestedPath(value.outputDirectory);
    if (!outputDirectory) {
      if (!this.dialog) throw new Error('当前环境无法选择导出文件夹');
      const selected = await this.dialog.showOpenDialog({ title: '选择发放表 Excel 保存文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, file: null };
      [outputDirectory] = selected.filePaths;
    }
    const batch = value.batch || {}; const template = batch.templateSnapshot || {};
    if (!Array.isArray(batch.items) || !batch.items.length) throw new Error('发放批次没有可导出的明细');
    const custom = !template.builtIn && Array.isArray(template.columns);
    const columns = (template.columns || []).filter((column) => column.visible !== false);
    const headers = custom
      ? ['序号', '姓名', '组别', ...columns.map((column) => column.label), ...(template.showBankCard === false ? [] : ['银行卡号']), '实发金额', '备注']
      : batch.templateKey === 'casual_labor'
        ? ['序号', '用工日期', '姓名', '用工事项', '工日', '单价', '金额', '银行账号', '备注']
        : batch.templateKey === 'public_service'
          ? ['序号', '姓名', '负责区域', '账号', '金额', '备注']
          : ['序号', '姓名', '职务', '元/月', '合计月份', '扣除款', '实发金额', '账号', '备注'];
    const yuan = (cents) => Number(cents || 0) / 100;
    const rows = batch.items.map((item, index) => custom
      ? [index + 1, item.name || '', item.groupName || '', ...columns.map((column) => item.customData?.[column.label] || ''), ...(template.showBankCard === false ? [] : [String(item.bankCard || '')]), yuan(item.amountCents), item.remark || '']
      : batch.templateKey === 'casual_labor'
        ? [index + 1, item.workDate || '', item.name || '', item.workItem || '', item.quantity || '', yuan(item.unitPriceCents), yuan(item.amountCents), String(item.bankCard || ''), item.remark || '']
        : batch.templateKey === 'public_service'
          ? [index + 1, item.name || '', item.responsibilityArea || '', String(item.bankCard || ''), yuan(item.amountCents), item.remark || '']
          : [index + 1, item.name || '', item.role || '', yuan(item.unitPriceCents), item.quantity || '', yuan(item.deductionsCents), yuan(item.amountCents), String(item.bankCard || ''), item.remark || '']);
    const totalCents = batch.items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const title = String(batch.title || template.title || '资金发放表');
    const heading = [[title], [`编制单位：${batch.villageName || ''}`], [`发放期间：${batch.period || ''}　发放日期：${batch.batchDate || ''}`], []];
    const worksheet = XLSX.utils.aoa_to_sheet(heading); XLSX.utils.sheet_add_aoa(worksheet, [headers, ...rows, ['合计', ...Array(Math.max(0, headers.length - 3)).fill(''), yuan(totalCents), '']], { origin: 'A5' });
    worksheet['!cols'] = headers.map((header) => ({ wch: /卡|账号/u.test(header) ? 24 : /事项|区域|备注/u.test(header) ? 22 : 14 }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, '发放表');
    const directory = path.resolve(outputDirectory); await fs.mkdir(directory, { recursive: true });
    const fileName = `${safeFilePart(`${title}-${batch.period || '未填写期间'}`)}.xlsx`; const filePath = await availableFilePath(directory, fileName);
    XLSX.writeFile(workbook, filePath);
    return { ok: true, file: { path: filePath, fileName, sheetNames: workbook.SheetNames }, outputDirectory: directory };
  }

  async exportFarmlandSubsidyWorkbook(value = {}) {
    let outputDirectory = requestedPath(value.outputDirectory);
    if (!outputDirectory) {
      if (!this.dialog) throw new Error('当前环境无法选择导出文件夹');
      const selected = await this.dialog.showOpenDialog({ title: '选择地力补贴 Excel 保存文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, file: null };
      [outputDirectory] = selected.filePaths;
    }
    const ledger = value.ledger || {}; const records = ledger.records || [];
    const households = records.filter((item) => item.category !== 'village_cadre'); const cadres = records.filter((item) => item.category === 'village_cadre');
    const yuan = (cents) => Number(cents || 0) / 100;
    const title = `${ledger.streetName || ''}${ledger.year || ''}年耕地地力保护补贴`;
    const book = XLSX.utils.book_new();
    const groupedHouseholds = new Map(); for (const row of households) { const key = row.groupName || '未分组'; if (!groupedHouseholds.has(key)) groupedHouseholds.set(key, []); groupedHouseholds.get(key).push(row); }
    const attachmentRows = [[`${title}分户登记清册`]];
    for (const [groupName, rows] of groupedHouseholds) {
      attachmentRows.push([`${ledger.villageName || ''} ${groupName}（盖章）`], ['序号', '户主姓名', '土地确权耕地面积（亩）', '采用排除法排除的面积（亩）', '应享受补贴面积', '补贴标准（元/亩）', '补贴金额（元）', '联系电话', '户主签字（章）']);
      rows.forEach((row, index) => attachmentRows.push([index + 1, row.name, row.ownershipArea, row.excludedArea, row.eligibleArea, yuan(row.standardCents), yuan(row.amountCents), row.phone, '']));
      attachmentRows.push(['合计', '', rows.reduce((sum, row) => sum + Number(row.ownershipArea || 0), 0), rows.reduce((sum, row) => sum + Number(row.excludedArea || 0), 0), rows.reduce((sum, row) => sum + Number(row.eligibleArea || 0), 0), '', rows.reduce((sum, row) => sum + yuan(row.amountCents), 0)], []);
    }
    const cadreRows = [[`${title}村干部登记清册`], [`${ledger.villageName || ''}（盖章）`], ['序号', '户主姓名', '补贴依据面积（亩）', '采用排除法排除的面积（亩）', '应享受补贴面积', '补贴标准（元/亩）', '补贴金额（元）', '联系电话', '户主签字（章）']];
    cadres.forEach((row, index) => cadreRows.push([index + 1, row.name, row.ownershipArea, row.excludedArea, row.eligibleArea, yuan(row.standardCents), yuan(row.amountCents), row.phone, '']));
    cadreRows.push(['合计', '', cadres.reduce((sum, row) => sum + Number(row.ownershipArea || 0), 0), cadres.reduce((sum, row) => sum + Number(row.excludedArea || 0), 0), cadres.reduce((sum, row) => sum + Number(row.eligibleArea || 0), 0), '', cadres.reduce((sum, row) => sum + yuan(row.amountCents), 0)]);
    const groupSummary = [[`${title}分村汇总表`], [`${ledger.villageName || ''}（盖章）`], ['序号', '村名', '补贴组数（个）', '补贴户数（户）', '土地确权耕地面积（亩）', '采用排除法排除的面积（亩）', '应享受补贴面积（亩）', '补贴金额（元）', '备注']];
    [...groupedHouseholds].forEach(([groupName, rows], index) => groupSummary.push([index + 1, ledger.villageName, groupName, rows.length, rows.reduce((sum, row) => sum + Number(row.ownershipArea || 0), 0), rows.reduce((sum, row) => sum + Number(row.excludedArea || 0), 0), rows.reduce((sum, row) => sum + Number(row.eligibleArea || 0), 0), rows.reduce((sum, row) => sum + yuan(row.amountCents), 0), '']));
    const cadreSummary = [[`${title}村干部分村汇总表`], [`${ledger.villageName || ''}（盖章）`], ['序号', '村名', '补贴户数（个）', '补贴依据面积（亩）', '采用排除法排除的面积（亩）', '应享受补贴面积（亩）', '补贴金额（元）', '备注'], [1, ledger.villageName, cadres.length, cadres.reduce((sum, row) => sum + Number(row.ownershipArea || 0), 0), cadres.reduce((sum, row) => sum + Number(row.excludedArea || 0), 0), cadres.reduce((sum, row) => sum + Number(row.eligibleArea || 0), 0), cadres.reduce((sum, row) => sum + yuan(row.amountCents), 0), '']];
    const paymentRows = [[`${ledger.streetName || ''} ${ledger.year || ''}年耕地地力保护补贴兑付清册`], ['序号', '户主姓名', '身份证号', '开户行', '一卡通号', '村', '村民组', '应享受补贴面积（亩）', '补贴标准（元/亩）', '补贴金额（元）', '备注']];
    records.forEach((row, index) => paymentRows.push([index + 1, row.name, row.idCard, row.bankName, row.bankCard, ledger.villageName, row.groupName, row.eligibleArea, yuan(row.standardCents), yuan(row.amountCents), row.remark]));
    for (const [name, rows] of [['附件1-1', attachmentRows], ['附件1-4', cadreRows], ['附件2-1', groupSummary], ['附件2-4', cadreSummary], ['地力补贴兑付清册', paymentRows]]) {
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!cols'] = Array.from({ length: Math.max(...rows.map((row) => row.length)) }, () => ({ wch: 18 })); XLSX.utils.book_append_sheet(book, sheet, name);
    }
    const directory = path.resolve(outputDirectory); await fs.mkdir(directory, { recursive: true });
    const fileName = `${safeFilePart(`${ledger.year || '年度'}地力补贴`)}.xlsx`; const filePath = await availableFilePath(directory, fileName); XLSX.writeFile(book, filePath);
    return { ok: true, file: { path: filePath, fileName, sheetNames: book.SheetNames }, outputDirectory: directory };
  }
}

module.exports = { ContractFeeFileService, availableFilePath, safeFilePart };
