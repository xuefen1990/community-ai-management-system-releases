'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');
const WorkbenchModel = require('../shared/disbursement-workbench-model');
const ContractFeeModel = require('../shared/contract-fee-model');

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
  constructor({ userDataPath, dialog, store = null }) {
    this.dialog = dialog;
    this.userDataPath = userDataPath;
    this.store = store;
  }

  get attachmentsDirectory() {
    const directory = this.store?.dataDirectory;
    return directory && directory !== path.join(this.userDataPath, 'data')
      ? path.join(directory, 'contract-fee', 'attachments')
      : path.join(this.userDataPath, 'contract-fee', 'attachments');
  }

  async selectAndReadExcel() {
    if (!this.dialog) throw new Error('当前环境无法选择 Excel 文件');
    const selected = await this.dialog.showOpenDialog({ title: '选择承包费发放表', properties: ['openFile'], filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls', 'csv'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, data: this.readExcel(selected.filePaths[0]) };
  }

  readExcel(value, options = {}) {
    const filePath = requestedPath(value);
    if (!filePath) throw new TypeError('未指定 Excel 文件');
    const extension = path.extname(filePath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('请选择 .xlsx、.xls 或 .csv 表格文件');
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false, cellStyles: true });
    if (!workbook.SheetNames.length) throw new Error('表格中没有可读取的工作表');
    const fileName = path.basename(filePath);
    const readSheet = (sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) throw new Error(`没有找到工作表“${sheetName}”`);
      const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
      const parsed = parseContractFeeExcelGrid(grid);
      const widths = Array.isArray(worksheet['!cols']) ? worksheet['!cols'].map((column) => Number(column?.wch || column?.width || 0) || null) : [];
      if (Array.isArray(parsed.outputColumns)) parsed.outputColumns = parsed.outputColumns.map((column, index) => ({ ...column, width: widths[index] || null }));
      return { ...parsed, fileName, sheetName };
    };
    const selectedSheetName = String(options.sheetName || '').trim();
    if (selectedSheetName) return readSheet(selectedSheetName);
    if (workbook.SheetNames.length === 1) return readSheet(workbook.SheetNames[0]);
    return {
      requiresSheetSelection: true,
      fileName,
      sheetNames: workbook.SheetNames.slice(),
      sheets: workbook.SheetNames.map((sheetName) => {
        try { return readSheet(sheetName); }
        catch (error) { return { fileName, sheetName, error: error.message, requiresMapping: true, rawGrid: [] }; }
      }),
    };
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
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
    if (!workbook.SheetNames.length) throw new Error('表格中没有可读取的工作表');
    const fileName = path.basename(filePath);
    const sheets = workbook.SheetNames.map((sheetName) => {
      const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
      try {
        const parsed = parseDisbursementExcelGrid(grid);
        return { ...parsed, sheetName, sections: (parsed.sections || []).map((section) => ({ ...section, sheetName,
          rows: section.rows.map((row) => ({ ...row, sheetName })) })) };
      } catch (error) {
        return { sheetName, error: error.message, rows: [], sections: [], rawGrid: grid, total: 0 };
      }
    });
    const sections = sheets.flatMap((sheet) => sheet.sections || []);
    const rows = sections.flatMap((section) => section.rows);
    const first = sheets[0];
    return { fileName, sheetName: first.sheetName, sheetNames: workbook.SheetNames.slice(), sheets, sections, rows, total: rows.length,
      requiresMapping: !rows.length, columns: first.columns || [], rawGrid: first.rawGrid || [], excludedRows: sheets.flatMap((sheet) => sheet.excludedRows || []) };
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

  async exportContractFeeProjectWorkbook(value = {}) {
    let outputDirectory = requestedPath(value.outputDirectory);
    if (!outputDirectory) {
      if (!this.dialog) throw new Error('当前环境无法选择导出文件夹');
      const selected = await this.dialog.showOpenDialog({ title: '选择承包费成果表保存文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, file: null };
      [outputDirectory] = selected.filePaths;
    }
    const batch = value.batch || {};
    if (!Array.isArray(batch.groups) || !batch.groups.length) throw new Error('承包费项目没有可导出的组别');
    const validation = ContractFeeModel.validateContractFeeDistributionBatch(batch);
    if (!validation.ok) throw new Error(`承包费成果表尚不能导出：${validation.errors.join('；')}`);
    const projectName = String(batch.projectName || batch.parcelName || '承包费项目');
    const settings = batch.planSnapshot?.outputSettings || batch.outputSettings || {};
    const title = String(settings.title || batch.title || `${projectName}发放明细表`);
    const yuan = (cents) => Number(cents || 0) / 100;
    const workbook = XLSX.utils.book_new(); const usedSheetNames = new Set();
    const sheetName = (source) => {
      const base = safeFilePart(source, '承包费').replace(/[\\/?*\[\]:]/gu, '-').slice(0, 28) || '承包费';
      let candidate = base; let suffix = 2;
      while (usedSheetNames.has(candidate)) candidate = `${base.slice(0, 25)}-${suffix++}`;
      usedSheetNames.add(candidate); return candidate;
    };
    const summaryRows = [[`${batch.year || ''} 年${projectName}各组汇总表`], [`编制单位：${settings.organization || ''}　制表人：${settings.preparedBy || ''}　经办人：${settings.handledBy || ''}　审批人：${settings.approvedBy || ''}`], ['序号', '组别', '承包项目', '家庭数（户）', '计算方式', '计发依据合计', '参考单价（元）', '基础金额（元）', '尾差（元）', '最终合计（元）']];
    batch.groups.forEach((group, index) => {
      const active = (group.items || []).filter((item) => item.active !== false);
      const basisLabel = group.allocationType === 'population' ? '按人口' : group.allocationType === 'acreage' ? '按亩数' : group.allocationType === 'fixed' ? '逐户固定金额' : '按自定义依据';
      summaryRows.push([index + 1, group.groupName, projectName, active.length, basisLabel, Number(group.basisTotal || 0), yuan(group.referenceUnitPriceCents), yuan(group.baseAmountTotalCents), yuan(group.tailDifferenceCents), yuan(active.reduce((sum, item) => sum + Number(item.finalAmountCents || 0), 0))]);
    });
    summaryRows.push(['合计', '', projectName, batch.groups.reduce((sum, group) => sum + (group.items || []).filter((item) => item.active !== false).length, 0), '', '', '', yuan(batch.groups.reduce((sum, group) => sum + Number(group.baseAmountTotalCents || 0), 0)), yuan(batch.groups.reduce((sum, group) => sum + Number(group.tailDifferenceCents || 0), 0)), yuan(validation.totalCents)]);
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows); summarySheet['!cols'] = [{ wch: 8 }, { wch: 13 }, { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 16 }, { wch: 17 }, { wch: 17 }, { wch: 13 }, { wch: 17 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, sheetName('各组汇总表'));
    for (const group of batch.groups) {
      const sourceColumns = Array.isArray(group.outputTemplateSnapshot?.columns) ? structuredClone(group.outputTemplateSnapshot.columns) : [];
      const detailColumns = ContractFeeModel.contractFeeOutputColumns(group, { signatureDetail: true });
      const headers = detailColumns.map((column, index) => String(column.header || `未命名列${index + 1}`));
      const rows = [[title], [`年度：${batch.year || ''}　项目：${projectName}　组别：${group.groupName || ''}`], [`编制单位：${settings.organization || ''}　制表人：${settings.preparedBy || ''}　经办人：${settings.handledBy || ''}　审批人：${settings.approvedBy || ''}`], headers];
      const active = (group.items || []).filter((item) => item.active !== false);
      active.forEach((item, index) => rows.push(detailColumns.map((column) => ContractFeeModel.contractFeeOutputValue(group, item, column, index))));
      const finalTotal = active.reduce((sum, item) => sum + Number(item.finalAmountCents || 0), 0);
      const totalValue = (column) => {
        if (column.fieldKey === 'sequence') return '合计';
        if (column.fieldKey === 'groupName') return sourceColumns.length ? '' : group.groupName;
        if (['population', 'acreage', 'basis'].includes(column.fieldKey)) return Number(group.basisTotal || 0);
        if (column.fieldKey === 'baseAmount') return yuan(group.baseAmountTotalCents);
        if (column.fieldKey === 'tailAmount') return yuan(group.tailDifferenceCents);
        if (column.fieldKey === 'amount') return yuan(finalTotal);
        return '';
      };
      rows.push(detailColumns.map(totalValue));
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols'] = detailColumns.map((column, index) => ({ wch: Number(column.width || 0) || (/银行卡|账号/u.test(headers[index]) ? 24 : /备注|签字|签章/u.test(headers[index]) ? 18 : /姓名|项目/u.test(headers[index]) ? 14 : 12) }));
      const cardColumns = detailColumns.map((column, index) => column.fieldKey === 'bankCard' ? index : -1).filter((index) => index >= 0);
      active.forEach((_item, rowIndex) => cardColumns.forEach((columnIndex) => {
        const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 4, c: columnIndex })];
        if (cell) { cell.t = 's'; cell.v = String(cell.v ?? ''); cell.z = '@'; }
      }));
      worksheet['!freeze'] = { xSplit: 0, ySplit: 4 };
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName(`${group.groupName || '未分组'}签字明细`));
    }
    const directory = path.resolve(outputDirectory); await fs.mkdir(directory, { recursive: true });
    const fileName = `${safeFilePart(`${batch.year || '年度'}-${projectName}-承包费成果表`)}.xlsx`; const filePath = await availableFilePath(directory, fileName);
    XLSX.writeFile(workbook, filePath);
    return { ok: true, file: { path: filePath, fileName, sheetNames: workbook.SheetNames }, outputDirectory: directory };
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
    if (batch.workbenchDraft?.ready === false) throw new Error('草稿尚未填写完整，请先核对后导出');
    if (!Array.isArray(batch.items) || !batch.items.length) throw new Error('发放批次没有可导出的明细');
    const custom = !template.builtIn && Array.isArray(template.columns);
    const columns = (template.columns || []).filter((column) => column.visible !== false);
    let headers = custom
      ? ['序号', '姓名', '组别', ...columns.map((column) => column.label), ...(template.showBankCard === false ? [] : ['银行卡号']), '实发金额', '备注']
      : batch.templateKey === 'casual_labor'
        ? ['序号', '用工日期', '姓名', '用工事项', '工日', '单价', '金额', '银行账号', '备注']
        : batch.templateKey === 'public_service'
          ? ['序号', '姓名', '负责区域', '账号', '金额', '备注']
          : ['序号', '姓名', '职务', '元/月', '合计月份', '扣除款', '实发金额', '账号', '备注'];
    const yuan = (cents) => Number(cents || 0) / 100;
    let rows = batch.items.map((item, index) => custom
      ? [index + 1, item.name || '', item.groupName || '', ...columns.map((column) => item.customData?.[column.label] || ''), ...(template.showBankCard === false ? [] : [String(item.bankCard || '')]), yuan(item.amountCents), item.remark || '']
      : batch.templateKey === 'casual_labor'
        ? [index + 1, item.workDate || '', item.name || '', item.workItem || '', item.quantity || '', yuan(item.unitPriceCents), yuan(item.amountCents), String(item.bankCard || ''), item.remark || '']
        : batch.templateKey === 'public_service'
          ? [index + 1, item.name || '', item.responsibilityArea || '', String(item.bankCard || ''), yuan(item.amountCents), item.remark || '']
          : [index + 1, item.name || '', item.role || '', yuan(item.unitPriceCents), item.quantity || '', yuan(item.deductionsCents), yuan(item.amountCents), String(item.bankCard || ''), item.remark || '']);
    const workbenchColumns = batch.visualLayout ? WorkbenchModel.printColumns(template, batch.templateKey, batch.visualLayout) : null;
    if (workbenchColumns) {
      headers = workbenchColumns.map((c) => batch.visualLayout.labels?.[c.key] || c.label);
      rows = batch.items.map((item, index) => {
        const raw = WorkbenchModel.rawItem(item, ContractFeeModel);
        return workbenchColumns.map((c) => c.key === '_sequence' ? index + 1 : c.key.startsWith('custom:') ? raw.customData?.[c.key.slice(7)] ?? '' : c.numeric && String(raw[c.key] ?? '').trim() !== '' ? Number(raw[c.key]) : String(raw[c.key] ?? ''));
      });
    }
    const totalCents = batch.items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const title = String(batch.title || template.title || '资金发放表');
    const dateHeading = `${batch.visualLayout?.showPeriod === false ? '' : `发放期间：${batch.period || ''}　`}发放日期：${batch.batchDate || ''}`;
    const heading = [[title], [`编制单位：${batch.villageName || ''}`], [dateHeading], ...(batch.visualLayout?.headers || []).map((h) => [`${h.label}：${h.value || ''}`]), []];
    const totalRow = Array(headers.length).fill(''); totalRow[0] = headers.length === 1 ? `合计 ¥${yuan(totalCents).toFixed(2)}` : '合计'; if (headers.length > 1) totalRow[headers.length - 1] = yuan(totalCents);
    const worksheet = XLSX.utils.aoa_to_sheet(heading); XLSX.utils.sheet_add_aoa(worksheet, [headers, ...rows, totalRow], { origin: `A${heading.length + 1}` });
    worksheet['!cols'] = headers.map((header) => ({ wch: /卡|账号/u.test(header) ? 24 : /事项|区域|备注/u.test(header) ? 22 : 14 }));
    if (workbenchColumns) {
      worksheet['!cols'] = workbenchColumns.map((c, index) => batch.visualLayout.widths?.[c.key] ? { wpx: Number(batch.visualLayout.widths[c.key]) * 96 / 25.4 } : worksheet['!cols'][index]);
      worksheet['!rows'] = [...Array(heading.length + 1).fill(null), ...batch.items.map((item) => ({ hpt: Number(batch.visualLayout.heights?.[item.id] || batch.visualLayout.rowHeight || 8) * 72 / 25.4 }))];
    }
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
