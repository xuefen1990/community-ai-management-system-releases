'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');

const { parseContractFeeExcelGrid } = require('../shared/contract-fee-excel-parser');

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
}

module.exports = { ContractFeeFileService, availableFilePath, safeFilePart };
