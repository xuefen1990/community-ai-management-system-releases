'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const XLSX = require('xlsx');
const { parseFinanceGrid, emptyBusinessRow, resolvesNonBusinessRow } = require('./finance-excel-parser');

class FinanceWorkbookService {
  constructor({ dialog }) { this.dialog = dialog; this.previews = new Map(); }

  async select(categoryCatalog) {
    const choice = await this.dialog.showOpenDialog({ title: '选择财务收支 Excel 表格', properties: ['openFile'],
      filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls'] }] });
    if (choice.canceled || !choice.filePaths?.[0]) return null;
    const filePath = choice.filePaths[0];
    if (!['.xlsx', '.xls'].includes(path.extname(filePath).toLowerCase())) throw new Error('请选择 Excel 表格');
    const bytes = await fs.readFile(filePath);
    if (bytes.length > 30 * 1024 * 1024) throw new Error('表格超过 30 MB，请拆分后导入');
    const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, raw: false });
    if (!workbook.SheetNames.length || workbook.SheetNames.length > 60) throw new Error('工作表数量须在 1 至 60 个之间');
    const grids = new Map();
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true, range: 0 });
      // Excel explicitly merged date/summary cells describe every row they span.
      // Never propagate money cells into separate transactions.
      const initial = parseFinanceGrid(grid,{sheetName:name,fileName:path.basename(filePath),categoryCatalog});
      const businessMapping = initial.mapping, rowMappings = new Map([...initial.rows,...initial.skipped].filter(row=>row.fieldColumns).map(row=>[row.sourceRowNumber,row.fieldColumns]));
      const dateOrTextColumn = column => grid.slice(0, 40).some(row => /日期|摘要|内容|月份|^月$|^日$/u.test(String(row[column] || '')));
      for (const merge of sheet['!merges'] || []) {
        const original = grid[merge.s.r]?.[merge.s.c];
        if (merge.s.r === merge.e.r && merge.s.c !== merge.e.c && /^(日期|收入|支出|金额|余额)$/u.test(String(original || '').trim())) {
          for(let column=merge.s.c+1;column<=merge.e.c;column++) if(grid[merge.s.r] && !grid[merge.s.r][column]) grid[merge.s.r][column]=original;
          continue;
        }
        if (merge.s.c !== merge.e.c || !dateOrTextColumn(merge.s.c) || original == null || original === '') continue;
        for (let row = merge.s.r + 1; row <= merge.e.r; row++) {
          if (grid[row] && emptyBusinessRow(grid[row],rowMappings.get(row+1) || businessMapping)) continue;
          if (grid[row] && (grid[row][merge.s.c] == null || grid[row][merge.s.c] === '')) grid[row][merge.s.c] = original;
        }
      }
      if (grid.length > 30000) throw new Error(`“${name}”超过 30000 行，请拆分后导入`);
      grids.set(name, grid);
    }
    const previewId = randomUUID();
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const fileName = path.basename(filePath);
    this.previews.clear();
    const sheets = new Map([...grids].map(([sheetName, grid]) => [sheetName, parseFinanceGrid(grid, { sheetName, fileName, categoryCatalog })]));
    this.previews.set(previewId, { grids, sheets, fileHash, fileName, categoryCatalog });
    return { previewId, fileHash, fileName, categories: categoryCatalog, sheets: [...sheets.values()] };
  }

  getPreview(previewId) {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('预览已失效，请重新选择表格');
    return preview;
  }

  remap({ previewId, sheetName, headerRowNumber, mapping, year }) {
    const preview = this.getPreview(previewId);
    const grid = preview?.grids.get(sheetName);
    if (!grid) throw new Error('预览已失效，请重新选择表格');
    const index = Number(headerRowNumber) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= grid.length) throw new Error('表头行号不正确');
    const result = parseFinanceGrid(grid, { sheetName, fileName: preview.fileName, headerRowIndex: index, mapping, year, categoryCatalog: preview.categoryCatalog });
    const previous=preview.sheets.get(sheetName);
    if(previous?.rows.some(row=>!result.rows.some(candidate=>candidate.sourceRowNumber===row.sourceRowNumber) && !resolvesNonBusinessRow(row,result,grid))) throw new Error('调整会遗漏已有收支行，已保留原识别结果');
    preview.sheets.set(sheetName, result);
    return result;
  }

  async export(records) {
    const choice = await this.dialog.showSaveDialog({ title: '导出财务收支', defaultPath: '财务收支.xlsx', filters: [{ name: 'Excel 表格', extensions: ['xlsx'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const rows = records.map(row => ({ 日期: row.recordDate || row.date || '', 类型: row.recordType === 'income' || row.type === 'income' ? '收入' : '支出',
      科目: row.category || '', 摘要: row.summary || '', 金额: Number.isSafeInteger(row.amountCents) ? row.amountCents / 100 : Number(row.amount || 0),
      余额: Number.isSafeInteger(row.calculatedBalanceCents) ? row.calculatedBalanceCents / 100 : '', 原表余额: Number.isSafeInteger(row.sourceBalanceCents) ? row.sourceBalanceCents / 100 : '', 余额核对: ({matched:'核对一致',mismatch:'余额不一致，待审核','order-review':'交易顺序待审核','invalid-source':'原表余额格式异常','no-source':'无原表余额',unavailable:'暂无法核对'})[row.balanceStatus] || '',
      经办人: row.handler || '', 对方单位: row.counterparty || '', 凭证号: row.voucherNo || row.voucherNumber || '', 备注: row.remarks || '' }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), '财务收支');
    XLSX.writeFile(book, choice.filePath);
    return { canceled: false, filePath: choice.filePath };
  }
}

module.exports = { FinanceWorkbookService };
