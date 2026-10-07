'use strict';

const path = require('node:path');
const { parseDate } = require('./finance-excel-parser');
const { cents } = require('./finance-ledger-analysis');
const { domainRows, mutateDomain } = require('./foundation-domains');
const { fail } = require('./foundation-data-model');
const { validCategory, registerCategories } = require('./finance-category-service');
const { duplicateMatch } = require('../shared/finance-import-review');
const { validateSourceManifest } = require('./finance-import-integrity');
const clean = value => String(value ?? '').trim();

function importFinanceBatch(database, input = {}, { now, uuid }) {
  const batchId = clean(input.batchId);
  const fileHash = clean(input.fileHash);
  const fileName = path.basename(clean(input.fileName));
  const sheets = [...new Set((Array.isArray(input.sheets) ? input.sheets : []).map(clean).filter(Boolean))];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!batchId || !/^[a-f0-9]{64}$/u.test(fileHash) || !fileName || !sheets.length) fail('INVALID_INPUT', '导入文件信息不完整，请重新选择表格');
  if (rows.length > 20000) fail('INVALID_INPUT', '请选择 1 至 20000 条已核对的收支记录');
  const previous = (database.financeImportBatches || []).find(item => item.id === batchId);
  if (previous) { if (previous.fileHash!==fileHash) fail('INVALID_IMPORT_PREVIEW','导入批次与文件不一致'); return { ...structuredClone(previous), alreadyImported: true }; }
  const manifest=validateSourceManifest(input);
  if (!rows.length && !manifest.decisions.some(row=>row.status==='existing')) fail('INVALID_INPUT','暂无可导入记录');

  const seenSource = new Set();
  const existing = domainRows(database, '/finance-records') || [];
  if(manifest.decisions.some(decision=>decision.status==='existing' && !(decision.recordIds || []).some(id=>existing.some(row=>String(row.id)===String(id))))) fail('INVALID_IMPORT_PREVIEW','已入账记录已变动，请重新核对预览');
  const prepared = [];
  for (const [index, row] of rows.entries()) {
    const sheetName = clean(row.sheetName);
    const sourceRowNumber = Number(row.sourceRowNumber);
    const sourceKey = `${sheetName}\u0000${sourceRowNumber}`;
    if (!sheets.includes(sheetName) || !Number.isInteger(sourceRowNumber) || sourceRowNumber < 1 || seenSource.has(sourceKey)) {
      fail('INVALID_INPUT', `第 ${index + 1} 条记录的工作表来源不正确`);
    }
    seenSource.add(sourceKey);
    const recordDate = clean(row.recordDate);
    const recordType = clean(row.recordType);
    const amountCents = Number(row.amountCents);
    const summary = clean(row.summary);
    const category = clean(row.category);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(recordDate) || parseDate(recordDate) !== recordDate || !['income', 'expense'].includes(recordType)
      || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !summary || !validCategory(category)) {
      fail('INVALID_INPUT', `“${sheetName}”第 ${sourceRowNumber} 行仍有未核对的日期、金额、收支类型或科目`);
    }
    if (row.sourceBalanceCents != null && !Number.isSafeInteger(row.sourceBalanceCents)) fail('INVALID_INPUT', '原表余额必须为整数分');
    const candidate = { sourceFileHash:fileHash,sourceSheetName:sheetName,sourceRowNumber,sourceRaw:Array.isArray(row.sourceRaw)?row.sourceRaw.map(clean):[],sourceBalanceCents: row.sourceBalanceCents ?? null, sourceBalanceText: clean(row.sourceBalanceText), sourceOrder: Number.isSafeInteger(row.sourceOrder) ? row.sourceOrder : sourceRowNumber, recordDate, recordType, amountCents, summary, category, categorySource: ['ai','rules','source','manual','default'].includes(row.categorySource) ? row.categorySource : 'manual',
      originalSourceBalanceCents:row.originalSourceBalanceCents??row.sourceBalanceCents??null,originalSourceBalanceText:clean(row.originalSourceBalanceText||row.sourceBalanceText),importBalanceReview:row.sourceBalanceCheck?{...row.sourceBalanceCheck,confirmation:row.balanceConfirmation||null}:null,importCorrections:row.importCorrections||[],
      handler: clean(row.handler), counterparty: clean(row.counterparty), voucherNo: clean(row.voucherNo),
      attachmentNote: clean(row.attachmentNote), remarks: clean(row.remarks) };
    const match=duplicateMatch(candidate,existing);
    if(match.kind==='exact') continue;
    const duplicate=match.reason;
    if (match.kind==='suspect' && row.duplicateDecision!=='independent' && row.allowDuplicate !== true) fail('DUPLICATE_FINANCE_RECORD', `“${sheetName}”第 ${sourceRowNumber} 行疑似重复：${duplicate}`);
    prepared.push({ ...candidate, sheetName, sourceRowNumber, duplicateOverridden: Boolean(duplicate) });
  }

  registerCategories(database, prepared);
  const importedAt = now().toISOString();
  const recordIds = [];
  let incomeCents = 0, expenseCents = 0;
  for (const row of prepared) {
    const record = mutateDomain(database, 'POST', '/finance-records', {
      ...row, source: 'excel', importBatchId: batchId, sourceFileName: fileName, sourceFileHash: fileHash,
      sourceSheetName: row.sheetName, sourceRowNumber: row.sourceRowNumber,
    }, { now, uuid }).item;
    recordIds.push(record.id);
    if (row.recordType === 'income') incomeCents += cents(row);
    else expenseCents += cents(row);
  }
  const batch = { id: batchId, fileName, fileHash, sheets, recordIds, count: recordIds.length,
    incomeCents, expenseCents, alreadyImportedCount:manifest.decisions.filter(row=>row.status==='existing').length + rows.length-prepared.length, sourceAudit:manifest, createdAt: importedAt };
  (database.financeImportBatches ||= []).push(batch);
  return structuredClone(batch);
}

module.exports = { importFinanceBatch };
