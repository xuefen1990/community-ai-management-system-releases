'use strict';
const { CATEGORIES } = require('./finance-excel-parser');
const { domainRows, mutateDomain } = require('./foundation-domains');
const { analyzeFinanceRecords, validPeriod } = require('./finance-ledger-analysis');
const { fail } = require('./foundation-data-model');
const { validCategory, canonicalCategory } = require('../shared/finance-category-rules');
const { classifySummaries, generic } = require('./finance-summary-classifier');
function catalogOf(db) {
  const result = { income: [...CATEGORIES.income], expense: [...CATEGORIES.expense] };
  for (const row of [...(db.financeCategories || []), ...domainRows(db, '/finance-records')]) {
    const type = row.recordType || row.type, name = row.name || row.category;
    if (result[type] && validCategory(name) && !result[type].includes(name)) result[type].push(name);
  }
  return result;
}
function registerCategories(db, rows) {
  const catalog = catalogOf({ ...db, finances: [], financeRecords: [] });
  for (const row of rows) {
    const type = row.recordType || row.type, name = row.category;
    if (!catalog[type] || !validCategory(name) || catalog[type].includes(name)) continue;
    (db.financeCategories ||= []).push({ id: `${type}:${name}`, type, name }); catalog[type].push(name);
  }
}
function otherShares(records) {
  const result = {};
  for (const type of ['income','expense']) {
    const rows = records.filter(row => row.recordType === type), totalCents = rows.reduce((sum,row)=>sum+row.amountCents,0);
    const others = rows.filter(row=>generic(row.category)), otherCents = others.reduce((sum,row)=>sum+row.amountCents,0);
    result[type] = { totalCount:rows.length,otherCount:others.length,totalCents,otherCents,percent:totalCents ? otherCents/totalCents*100 : 0 };
  }
  return result;
}
async function previewCategories(db, period, aiRouter) {
  const report = analyzeFinanceRecords(domainRows(db, '/finance-records'), period);
  const targets = report.records.filter(row => ['income','expense'].includes(row.recordType) && Number.isSafeInteger(row.amountCents) && row.amountCents > 0);
  const result = await classifySummaries(targets, {catalog:catalogOf(db),aiRouter});
  const rows = [], unresolved = [], groups = new Map(), after = [];
  for (const {row,result:classification} of result.classified) {
    const category = classification.category || row.category;
    after.push({...row,category});
    if (!classification.category) unresolved.push({id:row.id,recordType:row.recordType,summary:row.summary,reason:classification.reason,status:classification.status});
    if (category === row.category) continue;
    rows.push({id:row.id,baseVersion:row.version,recordType:row.recordType,previousCategory:row.category,category,categorySource:classification.categorySource});
    const key = `${row.recordType}:${category}`, group = groups.get(key) || {type:row.recordType,category,count:0,amountCents:0,examples:[]};
    group.count++;group.amountCents+=row.amountCents;
    if (group.examples.length<3 && !group.examples.includes(row.summary)) group.examples.push(row.summary);
    groups.set(key,group);
  }
  return {...period,rows,groups:[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||b.amountCents-a.amountCents),unresolved,total:targets.length,
    unchanged:targets.length-rows.length, warnings:result.warnings, before:otherShares(targets), after:otherShares(after)};
}
function applyCategories(db, body, options) {
  validPeriod(body.startDate, body.endDate);
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 20000) fail('INVALID_INPUT', '请选择有效的科目识别结果');
  const existing = new Map(domainRows(db, '/finance-records').map(row => [String(row.id), row])), ids = new Set();
  for (const item of body.rows) {
    const row = existing.get(String(item.id));
    if (ids.has(String(item.id)) || !validCategory(item.category) || generic(item.category)) fail('INVALID_INPUT', '科目识别结果不正确');
    ids.add(String(item.id));
    if (!row || row.version !== item.baseVersion || !['income','expense'].includes(row.recordType) || (item.recordType && item.recordType !== row.recordType) || (item.previousCategory !== undefined && item.previousCategory !== row.category) || row.recordDate < body.startDate || row.recordDate > body.endDate) fail('VERSION_CONFLICT', '台账已被修改，请重新分析科目后确认');
  }
  for (const item of body.rows) mutateDomain(db, 'PATCH', `/finance-records/${encodeURIComponent(item.id)}`, { baseVersion: item.baseVersion, changes: { category: item.category, categorySource: item.categorySource === 'rules' ? 'rules' : 'ai' } }, options);
  registerCategories(db, body.rows.map(row => ({ ...row, recordType: existing.get(String(row.id)).recordType })));
  return { count: body.rows.length, recordIds: [...ids] };
}
module.exports = { validCategory, catalogOf, canonicalCategory, registerCategories, previewCategories, applyCategories };
