(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('./finance-category-rules') : root.CommunityFinanceCategoryRules);
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CommunityFinanceImportReview = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (rules) {
  'use strict';
  const categories = rules.categories;
  const clean = value => String(value ?? '').trim();
  const comparable = value => clean(value).toLowerCase().replace(/[\s，,。．.、:：;；（）()\-_]/gu, '');
  const cents = row => Number.isSafeInteger(row.amountCents) ? row.amountCents : Math.round(Number(row.amount || 0) * 100);
  const dateOf = row => clean(row.recordDate || row.record_date || row.date);
  const typeOf = row => clean(row.recordType || row.type);
function parseMoney(value) {
  if (typeof value === 'number') {
    const rounded = Math.round(value * 100);
    return Number.isFinite(value) && Number.isSafeInteger(rounded) && Math.abs(value * 100 - rounded) < 0.000001 ? rounded : null;
  }
  let normalized = clean(value).normalize('NFKC');
    if (/,/u.test(normalized)) {const digits=normalized.replace(/[￥¥元\s()＋+−-]/gu,'');if(!/^[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?$/u.test(digits))return null;}
    let input = normalized.replace(/[￥¥元,，\s\u200b\ufeff]/gu, '').replace(/[−﹣]/gu, '-');
  if (!input || input === '-' || input === '—') return null;
  const negative = /^\(.*\)$/u.test(input);
  if (negative) input = input.slice(1, -1);
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(input)) return null;
  const [integer, fraction = ''] = input.replace(/^[+-]/u, '').split('.');
  if (fraction.slice(2).replace(/0/gu, '')) return null;
  const result = Number(integer) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return Number.isSafeInteger(result) ? (negative || input.startsWith('-') ? -result : result) : null;
}

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || '')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  const sourceSheet = row => clean(row.sourceSheetName || row.sheetName);
  function duplicateMatch(candidate, existing) {
    const hash=clean(candidate.sourceFileHash || candidate.fileHash), sheet=sourceSheet(candidate), sourceRow=candidate.sourceRowNumber;
    const exact=(existing || []).find(item=>hash && hash===item.sourceFileHash && sheet===sourceSheet(item) && sourceRow===item.sourceRowNumber);
    if(exact) return {kind:'exact',reason:'同一文件、工作表和原行已入账',recordIds:[String(exact.id)]};
    const date=dateOf(candidate),amount=cents(candidate),type=typeOf(candidate), matches=[];
    if(!date || !Number.isSafeInteger(amount) || amount<=0) return {kind:'none',reason:'',recordIds:[]};
    for(const item of existing || []) {
      if(hash && hash===item.sourceFileHash) continue;
      // Different physical rows in the current workbook are independent transactions.
      if(!hash && candidate.sheetName && item.sheetName && !item.id) continue;
      if(dateOf(item)!==date || cents(item)!==amount || type && typeOf(item) && typeOf(item)!==type) continue;
      const voucher=comparable(candidate.voucherNo || candidate.voucher_no || candidate.voucherNumber), otherVoucher=comparable(item.voucherNo || item.voucher_no || item.voucherNumber);
      const summary=comparable(candidate.summary),other=comparable(item.summary);
      if(voucher && voucher===otherVoucher || summary && other && (summary===other || Math.min(summary.length,other.length)>=6 && (summary.includes(other) || other.includes(summary)))) matches.push(item);
    }
    return matches.length?{kind:'suspect',reason:'其他来源存在日期、金额、摘要或凭证相似的记录，需确认',recordIds:matches.map(item=>String(item.id))}:{kind:'none',reason:'',recordIds:[]};
  }
  function duplicateReason(candidate,existing) { return duplicateMatch(candidate,existing).reason; }
  function issuesOf(row, categoryCatalog = categories) {
    const issues = [];
    if (!validDate(row.recordDate)) issues.push('日期缺失或无法确定');
    if (!clean(row.summary)) issues.push('摘要未识别');
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) issues.push(row.amountCents===0?'零金额需人工确认':row.issues?.includes('金额格式无法识别')?'金额格式无法识别':'金额无法确定');
    if (!['income', 'expense'].includes(row.recordType)) issues.push('收支方向无法确定');
    else if (!categoryCatalog[row.recordType]?.includes(row.category)) issues.push('科目未识别');
    return issues;
  }
  function review(rows, existing, selectedSheets, categoryCatalog = categories) {
    const selected=new Set(), result={ready:0,unresolved:0,duplicates:0,existing:0,excluded:0,defaults:0,candidates:0,incomeCents:0,expenseCents:0,sourceIncomeCents:0,sourceExpenseCents:0};
    for(const row of rows) {
      if(!selectedSheets.has(row.sheetName)) continue;
      result.candidates++;
      row.issues=issuesOf(row,categoryCatalog);
      const match=duplicateMatch(row,existing);row.duplicate=match.reason;row.duplicateKind=match.kind;row.matchingRecordIds=match.recordIds;
      if(row.excludedByUser) {
        if(clean(row.excludeReason).length<2) {row.reviewStatus='pending';row.issues=['请注明判定为非业务行的原因'];result.unresolved++;}
        else {row.reviewStatus='non-business';result.excluded++;}
        continue;
      }
      if(Number.isSafeInteger(row.amountCents) && ['income','expense'].includes(row.recordType)) result[`source${row.recordType==='income'?'Income':'Expense'}Cents`]+=row.amountCents;
      if(match.kind==='exact') {row.reviewStatus='existing';result.existing++;}
      else if(row.issues.length) {row.reviewStatus='pending';result.unresolved++;continue;}
      else if(match.kind==='suspect' && row.duplicateDecision==='existing') {row.reviewStatus='existing';result.existing++;}
      else if(match.kind==='suspect' && row.duplicateDecision!=='independent' && !row.allowDuplicate) {row.reviewStatus='pending';result.duplicates++;continue;}
      else {row.reviewStatus='import';selected.add(row.key);result.ready++;result[`${row.recordType}Cents`]+=row.amountCents;if(row.categorySource==='default')result.defaults++;}

    }
    result.pending=result.unresolved+result.duplicates;
    return {selected,totals:result};
  }
  function integrityOf(sheets, rows, acknowledgements = {}) {
    const checks=[];let coverageMissing=0;
    for(const sheet of sheets) {
      const handled=[...sheet.rows.map(row=>row.sourceRowNumber),...sheet.skipped.map(row=>row.sourceRowNumber)];
      const coverage=sheet.coverage || handled;
      const handledSet=new Set(handled);
      if(handledSet.size!==handled.length || coverage.some(index=>!handledSet.has(index))) coverageMissing++;
      for(const skipped of sheet.skipped) {
        const check=skipped.totalCheck;if(!check)continue;
        const relevant=rows.filter(row=>row.sheetName===sheet.sheetName && row.sourceRowNumber>=check.startRow && row.sourceRowNumber<=check.endRow && !row.excludedByUser);
        const income=relevant.filter(row=>row.recordType==='income').reduce((sum,row)=>sum+(Number.isSafeInteger(row.amountCents)?row.amountCents:0),0);
        const expense=relevant.filter(row=>row.recordType==='expense').reduce((sum,row)=>sum+(Number.isSafeInteger(row.amountCents)?row.amountCents:0),0);
        const key=`${encodeURIComponent(sheet.sheetName)}:${skipped.sourceRowNumber}`;
        const matches=check.incomeCents===income && check.expenseCents===expense;
        checks.push({key,sheetName:sheet.sheetName,sourceRowNumber:skipped.sourceRowNumber,incomeCents:income,expenseCents:expense,expectedIncomeCents:check.incomeCents,expectedExpenseCents:check.expenseCents,matches,reason:clean(acknowledgements[key]),accepted:matches || clean(acknowledgements[key]).length>=2});
      }
    }
    return {coverageMissing,checks,blocked:coverageMissing>0 || checks.some(check=>!check.accepted) || sheets.some(sheet=>sheet.error)};
  }

  return { categories, parseMoney, validDate, duplicateReason, duplicateMatch, issuesOf, review, integrityOf };
}));
