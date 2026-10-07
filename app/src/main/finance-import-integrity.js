'use strict';
const { review, integrityOf } = require('../shared/finance-import-review');
const { fail } = require('./foundation-data-model');
const keyOf = row => `${encodeURIComponent(row.sheetName)}:${row.sourceRowNumber}`;
const CORE = ['recordDate','recordType','amountCents','sourceBalanceCents','sourceOrder'];
const MUTABLE = [...CORE,'summary','category','handler','counterparty','voucherNo','attachmentNote','remarks'];

function prepareFinanceImport(workbookService, input, existing, catalog) {
  const preview = workbookService.getPreview(input.previewId);
  if (preview.fileHash !== input.fileHash || preview.fileName !== input.fileName) fail('INVALID_IMPORT_PREVIEW','文件与预览不一致，请重新上传');
  const selected = new Set(input.sheets || []);
  if (!selected.size || selected.size !== (input.sheets || []).length || [...selected].some(name=>!preview.sheets.has(name))) fail('INVALID_IMPORT_PREVIEW','工作表选择不正确');
  const sheets = [...selected].map(name=>preview.sheets.get(name));
  for(const sheet of sheets) {
    const grid=preview.grids.get(sheet.sheetName), sourceRows=new Set((grid || []).flatMap((cells,index)=>(cells || []).some(cell=>String(cell ?? '').trim())?[index+1]:[]));
    const covered=new Set(sheet.coverage || []);
    if(sourceRows.size!==covered.size || [...sourceRows].some(index=>!covered.has(index))) fail('INVALID_IMPORT_PREVIEW','预览与原表行覆盖范围不一致，请重新识别');
  }
  const original = sheets.flatMap(sheet=>sheet.rows);
  const decisions = Array.isArray(input.reviewRows) ? input.reviewRows : [];
  const byKey = new Map(decisions.map(row=>[keyOf(row),row]));
  if (byKey.size !== decisions.length || decisions.length !== original.length || original.some(row=>!byKey.has(keyOf(row)))) fail('INCOMPLETE_FINANCE_IMPORT','原表存在未处理或重复来源的记录，暂停导入');
  const rows = original.map(source=> {
    const decision=byKey.get(keyOf(source)), row={...structuredClone(source),key:keyOf(source),sourceFileHash:preview.fileHash};
    const edited=new Set(decision.manualFields || []);
    for (const field of MUTABLE) if (Object.hasOwn(decision,field) && decision[field] !== source[field]) {
      if (CORE.includes(field) && !edited.has(field)) fail('INVALID_IMPORT_PREVIEW',`“${source.sheetName}”第 ${source.sourceRowNumber} 行的数据未经人工确认`);
      row[field]=structuredClone(decision[field]);
    }
    row.importCorrections=MUTABLE.filter(field=>row[field]!==source[field]).map(field=>({field,original:source[field],value:row[field]}));
    row.originalSourceBalanceCents=source.sourceBalanceCents;row.originalSourceBalanceText=source.sourceBalanceText;
    row.balanceConfirmation=structuredClone(decision.balanceConfirmation);
    row.categorySource=decision.categorySource==='manual'?'manual':source.categorySource;
    for(const field of ['excludedByUser','excludeReason','duplicateDecision','allowDuplicate']) row[field]=decision[field];
    return row;
  });
  const categoryCatalog={income:[...new Set([...(catalog.income || []),...(preview.categoryCatalog?.income || [])])],expense:[...new Set([...(catalog.expense || []),...(preview.categoryCatalog?.expense || [])])]};
  const checked=review(rows,existing,selected,categoryCatalog,sheets), integrity=integrityOf(sheets,rows,input.totalAcknowledgements || {});
  if (checked.totals.pending || integrity.blocked) fail('INCOMPLETE_FINANCE_IMPORT',`还有 ${checked.totals.pending} 笔记录或合计待核对，暂停整批导入`);
  const approved=rows.filter(row=>checked.selected.has(row.key));
  const submitted=input.rows || [], submittedKeys=new Set(submitted.map(keyOf));
  if (submitted.length !== approved.length || submittedKeys.size !== submitted.length || approved.some(row=>!submittedKeys.has(row.key))) fail('INCOMPLETE_FINANCE_IMPORT','提交记录数与原表核对结果不一致，暂停整批导入');
  const sourceManifest={
    balanceReviewVersion:1,balanceRows:structuredClone(rows), expectedRowKeys: rows.map(keyOf), decisions:rows.map(row=>({key:keyOf(row),status:row.reviewStatus,reason:row.excludeReason || row.duplicate || '',raw:row.raw,corrections:row.importCorrections,balanceCheck:row.sourceBalanceCheck,balanceConfirmation:row.balanceConfirmation,recordIds:row.matchingRecordIds || []})),
    coverage:sheets.map(sheet=>({sheetName:sheet.sheetName,rows:sheet.coverage,nonBusiness:sheet.skipped.map(row=>structuredClone(row))})), totals:integrity.checks,
    counts:checked.totals,
  };
  return {...input,rows:approved.map(row=>({...row,sourceRaw:row.raw,sourceBalanceCheck:row.sourceBalanceCheck})),sourceManifest:JSON.parse(JSON.stringify(sourceManifest))};
}
function validateSourceManifest(input) {
  const manifest=input.sourceManifest;
  if (!manifest || !Array.isArray(manifest.expectedRowKeys) || !Array.isArray(manifest.decisions)) fail('INVALID_IMPORT_PREVIEW','请使用完整识别预览确认导入');
  const expected=new Set(manifest.expectedRowKeys), decisions=new Map(manifest.decisions.map(row=>[row.key,row]));
  if (expected.size!==manifest.expectedRowKeys.length || decisions.size!==manifest.decisions.length || expected.size!==decisions.size || [...expected].some(key=>!decisions.has(key))) fail('INCOMPLETE_FINANCE_IMPORT','原表处理清单存在缺口');
  if (manifest.decisions.some(row=>!['import','existing','non-business'].includes(row.status) || row.status==='non-business' && String(row.reason || '').trim().length<2)) fail('INCOMPLETE_FINANCE_IMPORT','原表存在待处理行');
  if(manifest.decisions.some(row=>row.status==='import'&&row.balanceCheck&&!row.balanceCheck.accepted))fail('INCOMPLETE_FINANCE_IMPORT','原表余额尚未确认');
  if(manifest.balanceReviewVersion===1&&!Array.isArray(manifest.balanceRows))fail('INCOMPLETE_FINANCE_IMPORT','缺少原表余额核对清单');
  if (!Array.isArray(manifest.coverage) || manifest.coverage.length !== input.sheets.length) fail('INCOMPLETE_FINANCE_IMPORT','缺少原表逐行覆盖清单');
  if(manifest.balanceRows){
    const audited=structuredClone(manifest.balanceRows),sheets=manifest.coverage.map(s=>({sheetName:s.sheetName,skipped:s.nonBusiness}));
    const auditedKeys=new Set(audited.map(keyOf));
    if(auditedKeys.size!==audited.length || auditedKeys.size!==expected.size || [...expected].some(key=>!auditedKeys.has(key)) || audited.some(row=>row.reviewStatus!==decisions.get(keyOf(row))?.status))fail('INCOMPLETE_FINANCE_IMPORT','余额核对清单存在漏行或处理状态变化');
    require('../shared/finance-import-review').sourceBalances(audited,sheets);
    for(const row of input.rows||[]){const source=audited.find(r=>keyOf(r)===keyOf(row));if(!source?.sourceBalanceCheck?.accepted || ['recordDate','recordType','amountCents','summary','sourceBalanceCents','sourceOrder'].some(f=>source[f]!==row[f]))fail('INCOMPLETE_FINANCE_IMPORT','交易或原表余额确认已变化，请重新核对');}
  }
  const importKeys=manifest.decisions.filter(row=>row.status==='import').map(row=>row.key), keys=(input.rows || []).map(keyOf);
  if (keys.length!==importKeys.length || new Set(keys).size!==keys.length || keys.some(key=>!importKeys.includes(key))) fail('INCOMPLETE_FINANCE_IMPORT','导入记录与原表清单不一致');
  if (!Array.isArray(manifest.coverage) || manifest.coverage.length !== input.sheets.length) fail('INCOMPLETE_FINANCE_IMPORT','缺少原表逐行覆盖清单');
  const coverageKeys=new Set(), nonBusinessKeys=new Set();
  for (const sheet of manifest.coverage) {
    if(!input.sheets.includes(sheet.sheetName) || !Array.isArray(sheet.rows) || !Array.isArray(sheet.nonBusiness)) fail('INCOMPLETE_FINANCE_IMPORT','原表覆盖清单不正确');
    for(const sourceRowNumber of sheet.rows) {const key=keyOf({sheetName:sheet.sheetName,sourceRowNumber});if(!Number.isInteger(sourceRowNumber) || sourceRowNumber<1 || coverageKeys.has(key)) fail('INCOMPLETE_FINANCE_IMPORT','原表来源行重复或无效');coverageKeys.add(key);}
    for(const row of sheet.nonBusiness) {const key=keyOf({sheetName:sheet.sheetName,sourceRowNumber:row.sourceRowNumber});if(!row.reason || nonBusinessKeys.has(key) || expected.has(key)) fail('INCOMPLETE_FINANCE_IMPORT','非业务行清单不正确');nonBusinessKeys.add(key);}
  }
  if(coverageKeys.size!==expected.size+nonBusinessKeys.size || [...coverageKeys].some(key=>!expected.has(key) && !nonBusinessKeys.has(key)) || [...expected,...nonBusinessKeys].some(key=>!coverageKeys.has(key))) fail('INCOMPLETE_FINANCE_IMPORT','原表覆盖清单存在漏行');
  if ((manifest.totals || []).some(check=>!check.accepted || !check.matches && String(check.reason || '').trim().length<2)) fail('INCOMPLETE_FINANCE_IMPORT','原表合计尚未核对');
  return manifest;
}
module.exports={prepareFinanceImport,validateSourceManifest,keyOf};
