'use strict';

const { categories: CATEGORIES, classifySummary } = require('../shared/finance-category-rules');
const INCOME_CATEGORIES = CATEGORIES.income;
const EXPENSE_CATEGORIES = CATEGORIES.expense;
const ALIASES = Object.freeze({
  date: ['日期', '发生日期', '交易日期', '记账日期', '入账日期', '收支日期', '时间', '业务日期', '月日'],
  month: ['月', '月份', '日期月'],
  day: ['日', '日号', '日期日'],
  type: ['类型', '收支类型', '收入支出', '收支方向', '借贷方向'],
  income: ['收入', '收入金额', '收入元', '贷方金额', '本期收入'],
  expense: ['支出', '支出金额', '支出元', '借方金额', '本期支出'],
  balance: ['余额', '账户余额', '结存余额', '账面余额', '结余余额', '结余'],
  amount: ['金额', '发生金额', '交易金额', '金额元', '收支金额', '本次金额'],
  category: ['科目', '财务科目', '收支科目', '分类', '类别', '项目类别'],
  summary: ['摘要', '收支摘要', '收支内容摘要', '收支内容', '内容摘要', '说明文字', '事由', '用途', '内容', '项目', '项目名称', '交易说明', '业务内容'],
  handler: ['经办人', '经手人', '负责人'],
  counterparty: ['对方单位', '对方单位个人', '收款人', '付款人', '往来单位', '交易对方'],
  voucherNo: ['凭证号', '凭证编号', '单据号', '票据号', '编号'],
  attachmentNote: ['附件说明', '凭证说明', '票据说明'],
  remarks: ['备注', '说明', '附注'],
});
const REQUIRED_HINTS = ['date', 'summary', 'amount', 'income', 'expense'];
const BUSINESS_FIELDS = new Set(['date','month','day','summary','amount','income','expense']);
const clean = value => String(value ?? '').trim();
const normalize = value => clean(value).normalize('NFKC').replace(/[\s（）()【】\[\]：:，,、。._\-\/]/gu, '').toLowerCase();

function headerMapping(header, override = {}) {
  const normalized = header.map(normalize);
  const mapping = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    if (Object.hasOwn(override, field) && (override[field] === null || override[field] === '')) continue;
    const preferred = Number(override[field]);
    const sequenceColumn = value => /^(序号|序列号|行号|流水号|编号|序次|no|序)$/iu.test(normalize(value));
    if (Number.isInteger(preferred) && preferred >= 0 && preferred < header.length && !(BUSINESS_FIELDS.has(field) && sequenceColumn(header[preferred]))) {
      if (['amount', 'income', 'expense'].includes(field) && /余额|结余|累计|合计/u.test(header[preferred])) continue;
      mapping[field] = preferred; continue;
    }
    const eligible = value => !(BUSINESS_FIELDS.has(field) && sequenceColumn(value)) && !(['amount', 'income', 'expense'].includes(field) && /余额|结余|累计|合计/u.test(value));
    const exact = normalized.findIndex(value => eligible(value) && names.includes(value));
    const approximate = normalized.findIndex(value => eligible(value) && names.some(name => value.startsWith(name) && value.length <= name.length + 4));
    if (exact >= 0 || approximate >= 0) mapping[field] = exact >= 0 ? exact : approximate;
  }
  return mapping;
}

function findHeader(grid, overrideIndex) {
  if (Number.isInteger(overrideIndex) && overrideIndex >= 0 && overrideIndex < grid.length) return overrideIndex;
  const candidates = grid.slice(0, 40).map((row, index) => {
    const map = headerMapping(Array.isArray(row) ? row : []);
    const score = Object.keys(map).length + REQUIRED_HINTS.filter(field => map[field] !== undefined).length * 2;
    return { index, score, hasMoney: ['amount', 'income', 'expense'].some(field => map[field] !== undefined) };
  }).filter(item => item.hasMoney && item.score >= 5);
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.index ?? -1;
}

function parseDate(value, { year: contextYear, month: contextMonth } = {}) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const input = clean(value).normalize('NFKC').replace(/[年月.\/]/gu, '-').replace(/日/u, '').replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/u, '');
  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u);
  if (!match && contextYear) {
    const short = input.match(/^(\d{1,2})-(\d{1,2})$/u);
    const day = input.match(/^(\d{1,2})$/u);
    if (short) match = ['', String(contextYear), short[1], short[2]];
    else if (day && contextMonth) match = ['', String(contextYear), String(contextMonth), day[1]];
  }
  if (!match) return '';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
}

const { parseMoney: parseAmount } = require('../shared/finance-import-review');
function amountState(value) {
  const text = clean(value).normalize('NFKC');
  if (!text || ['-', '—'].includes(text)) return 'empty';
  const amount = parseAmount(value);
  return amount === null ? 'invalid' : amount === 0 ? 'zero' : 'value';
}
function noTransactionAmount(cells, mapping) {
  const fields = ['amount','income','expense'].filter(field => mapping[field] !== undefined);
  // Only trust identified business columns. An unknown header still needs review.
  return mapping.summary !== undefined && (mapping.date !== undefined || mapping.day !== undefined)
    && fields.length > 0 && fields.every(field => amountState(cells[mapping[field]]) === 'empty');
}
function balanceCarryRow(cells, mapping) {
  const label = normalize(cells[mapping.summary]);
  return noTransactionAmount(cells,mapping)
    && /^(?:(?:上|本)?(?:年|年度|月|期)(?:余额|余款|结余|结转)|(?:期|年|月)(?:初|末)(?:余额|结存|结余)|余额结转|结转下(?:月|年|期)|上期结存)$/u.test(label);
}
// Business evidence comes from date/day, summary and transaction amounts only.
// Sequence numbers, balances, vouchers and notes never create a transaction.
function emptyBusinessRow(cells, mapping) {
  const dateFields = mapping.date !== undefined ? ['date'] : mapping.day !== undefined ? ['day'] : [];
  const moneyFields = ['amount','income','expense'].filter(field => mapping[field] !== undefined);
  if (!dateFields.length || mapping.summary === undefined || !moneyFields.length) return false;
  const blank = value => clean(value).replace(/[\u200b\ufeff]/gu,'') === '';
  return dateFields.every(field => blank(cells[mapping[field]]))
    && blank(cells[mapping.summary])
    && moneyFields.every(field => ['empty','zero'].includes(amountState(cells[mapping[field]])));
}
// An explicit template notice is not a transaction. Check mapped business
// cells, never the sequence column; keep any date, amount or balance evidence.
function businessNoticeRow(cells, mapping) {
  if (mapping.summary === undefined) return '';
  const blank = value => clean(value).replace(/[\u200b\ufeff]/gu,'') === '';
  const dateFields = ['date','month','day'].filter(field => mapping[field] !== undefined);
  const moneyFields = ['amount','income','expense'].filter(field => mapping[field] !== undefined);
  if (!dateFields.length || !moneyFields.length
    || !dateFields.every(field => blank(cells[mapping[field]]))
    || !moneyFields.every(field => amountState(cells[mapping[field]]) === 'empty')
    || mapping.balance !== undefined && amountState(cells[mapping.balance]) !== 'empty') return '';
  const label = clean(cells[mapping.summary]).normalize('NFKC').replace(/[\s\u200b\ufeff]/gu,'');
  if (/^(?:本页)?以下(?:空白|无正文|无内容|无数据|无记录)(?:[。.!！:：]*)$/u.test(label)
    || /^(?:此处|本行|本页)空白(?:[。.!！:：]*)$/u.test(label)) return '空白说明行';
  if (/^(?:备注|说明|注)[:：]/u.test(label)) return '说明行';
  return '';
}
function metadataRow(cells, context) {
  const text = cells.map(value=>clean(value).normalize('NFKC')).filter(Boolean);
  if (!text.length || text.some(value=>parseDate(value,context) || /^(收[：:]|付[：:]|支付|支出|收入|购买|报销)/u.test(value))) return false;
  return text.every(value => require('./finance-date-context').periodLabel(value) || /盖章|编制单位|^单位\s*[：:]|财务.*(?:明细表|收.*支)|财务收支明细/u.test(value));
}

function signatureRow(cells, mapping, context) {
  const text=cells.map(clean).filter(Boolean).join(' ');
  if(!/(?:^|[\s：:])(?:驻村领导|驻村干部|制表人?|审核人?|负责人|填表人?|经办人|审批人|分管领导|村主任|村书记)(?:[\s：:]|$)/u.test(text))return false;
  const hasAmount=['amount','income','expense'].some(f=>mapping[f]!==undefined && ['value','zero'].includes(amountState(cells[mapping[f]])))
    || /^(?:收|付|支付|支出|收入)[：:]?/u.test(clean(cells[mapping.summary]))
      && ['amount','income','expense'].some(f=>mapping[f]!==undefined && amountState(cells[mapping[f]])==='invalid');
  return !hasAmount;
}

function resolvesNonBusinessRow(row, result, grid) {
  const skipped = result.skipped.find(item => item.sourceRowNumber === row.sourceRowNumber);
  if (!skipped || row.recordDate && row.summary && row.amountCents > 0) return false;
  const cells = grid[row.sourceRowNumber-1] || row.raw || [];
  const mapping = skipped.fieldColumns || result.mapping;
  if (skipped.reason === '余额结转行') return balanceCarryRow(cells,mapping);
  if (skipped.reason === '无发生额行') return noTransactionAmount(cells,mapping);
  if (skipped.reason === '业务列空白行') return emptyBusinessRow(cells,skipped.fieldColumns || result.mapping);
  if (['空白说明行','说明行'].includes(skipped.reason)) return businessNoticeRow(cells,skipped.fieldColumns || result.mapping) === skipped.reason;
  if (skipped.reason === '签字说明行') return signatureRow(cells,skipped.fieldColumns || result.mapping,result.context);
  if (skipped.reason === '表头说明行') return metadataRow(cells,result.context);
  return /表头|标题/u.test(skipped.reason) && !(row.raw || []).some(cell=>/[0-9０-９]/u.test(String(cell)));
}

function headerAt(grid, index, overrides = {}) {
  const top = (grid[index] || []).map(clean), topMap = headerMapping(top, overrides);
  const bottom = (grid[index + 1] || []).map(clean), bottomMap = headerMapping(bottom);
  const childHeader = Object.keys(bottomMap).length >= 2 || (bottomMap.month !== undefined && bottomMap.day !== undefined);
  let headers = top, size = 1;
  if (childHeader && Object.keys(topMap).length && !bottom.some(cell => parseDate(cell) || amountState(cell) === 'value')) {
    headers = Array.from({length: Math.max(top.length, bottom.length)}, (_, column) => {
      const parent = top[column] || '', child = bottom[column] || '';
      if (!child) return parent;
      if (['月','月份','日','日号'].includes(normalize(child))) return child;
      return parent && parent !== child && /金额|元|日期/u.test(child) ? parent + child : child;
    }); size = 2;
  }
  const mapping = headerMapping(headers, overrides);
  if (mapping.month !== undefined && mapping.day !== undefined) delete mapping.date;
  const money = ['income','expense','amount'].some(field=>mapping[field] !== undefined);
  const strong = money && mapping.summary !== undefined && (mapping.date !== undefined || mapping.month !== undefined || mapping.day !== undefined);
  return { headers, mapping, size, strong };
}

function inferType(fields, categoryCatalog = CATEGORIES) {
  const explicit = normalize(fields.type);
  const named = /^(income|收入|收|入账|贷方)$/u.test(explicit) ? 'income' : /^(expense|支出|支|出账|借方)$/u.test(explicit) ? 'expense' : '';
  const income = parseAmount(fields.income), expense = parseAmount(fields.expense);
  if (income !== null && income !== 0 && expense !== null && expense !== 0) return { type: '', amountCents: null, issue: '收入和支出列同时有金额' };
  const columnType = income !== null && income !== 0 ? 'income' : expense !== null && expense !== 0 ? 'expense' : '';
  const signed = parseAmount(fields.amount);
  const signType = signed !== null && signed < 0 ? 'expense' : '';
  const categoryType = categoryCatalog.income.includes(fields.category) ? 'income' : categoryCatalog.expense.includes(fields.category) ? 'expense' : '';
  const textType = /^(收[到取入]|收[^支]|入账)|收入|捐赠收入|拨款到账|租金收入/u.test(fields.summary || '') ? 'income'
    : /^(付|支付|支出|购买|购置|报销)|支出/u.test(fields.summary || '') ? 'expense' : '';
  const type = named || columnType || signType || categoryType || textType;
  const amount = columnType ? (columnType === 'income' ? income : expense) : signed;
  if (columnType && amount < 0) return { type: '', amountCents: null, issue: '负数冲销金额暂无法确定收支方向' };
  const conflicts = [named, columnType, signType, categoryType].filter(Boolean);
  return { type: new Set(conflicts).size > 1 ? '' : type, amountCents: amount === null ? null : Math.abs(amount),
    issue: new Set(conflicts).size > 1 ? '原表中的收支方向相互矛盾' : '' };
}

function recognitionContext(grid, { sheetName = '', fileName = '', year, headerRowIndex, contextStart = 0, confirmation } = {}) {
  const firstHeader = Number.isInteger(headerRowIndex) ? headerRowIndex : grid.findIndex((_,index)=>headerAt(grid,index).strong);
  const labels = grid.slice(contextStart,firstHeader >= 0 ? firstHeader : 0).flatMap((cells,index)=>metadataRow(cells || [],{}) ? (cells || []).map(text=>({text:clean(text),sourceRowNumber:contextStart+index+1})) : []);
  return require('./finance-date-context').contextOf({sheetName,fileName,labels,year,confirmation});
}

function resolveMonthRange(rows,context) {
  const range=context.monthRange;if(!range || context.needsConfirmation)return;
  const groups=new Map();for(const row of rows){if(!groups.has(row.regionStart))groups.set(row.regionStart,[]);groups.get(row.regionStart).push(row);}
  for(const group of groups.values()){
    const timeline=group.filter(row=>/^(?:\d{1,2}日?|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})$/u.test(clean(row.sourceDate).normalize('NFKC')));
    const dayOf=row=>Number(clean(row.sourceDate).normalize('NFKC').replace(/日$/u,'').split(/[-/.]/u).at(-1));
    const candidates=[];
    if(context.year&&range.start<=range.end)for(const direction of [1,-1]){
      let month=direction===1?range.start:range.end,previous=null;const dates=[];
      for(const row of timeline){const day=dayOf(row);if(previous!==null&&(direction===1?day<previous:day>previous))month+=direction;const date=parseDate(String(day),{year:context.year,month});if(month<range.start||month>range.end||!date||row.recordDate&&row.recordDate!==date){dates.length=0;break;}dates.push(date);previous=day;}
      if(dates.length===timeline.length&&dates.length&&month===(direction===1?range.end:range.start))candidates.push(dates);
    }
    const unique=[...new Map(candidates.map(dates=>[JSON.stringify(dates),dates])).values()];
    for(const [index,row] of timeline.entries()){
      if(row.recordDate)continue;
      if(unique.length===1){row.recordDate=unique[0][index];row.dateRecognitionSource='month-range-sequence';row.issues=row.issues.filter(issue=>issue!=='请填写完整交易日期');}
      else {row.dateRecognitionReason='合并月份无法唯一确定，请核对原表日期';}
    }
  }
}

function classifyCategory(recordType, sourceCategory, summary, categoryCatalog = CATEGORIES) {
  const precise = classifySummary(recordType, summary, categoryCatalog);
  if (precise) return precise;
  if (categoryCatalog[recordType]?.includes(sourceCategory)) return { category: sourceCategory, categorySource: 'source' };
  const text = `${sourceCategory || ''} ${summary || ''}`;
  const specific = (categoryCatalog[recordType] || []).filter(name => !CATEGORIES[recordType]?.includes(name)).sort((a,b) => b.length-a.length).find(name => text.includes(name));
  if (specific) return { category: specific, categorySource: 'rules' };
  const rules = recordType === 'income' ? [
    ['捐赠收入', /捐赠|捐款|捐资/u], ['补贴资金', /补贴|补助|奖补/u], ['上级拨款', /拨款|财政|上级|转移支付/u],
    ['集体经营收入', /租金|租赁|承包|经营|集体收入|土地流转|利息/u],
  ] : recordType === 'expense' ? [
    ['慰问帮扶', /慰问|帮扶|救助|困难|低保/u], ['环境整治', /保洁|垃圾|环卫|环境|清运|绿化/u],
    ['维修维护', /维修|修缮|维护|水管|修理/u], ['工程建设', /工程|建设|施工|道路硬化/u],
    ['公益支出', /公益|文体|文化活动|养老服务/u], ['办公支出', /办公|纸张|文具|打印|复印|电脑|电话费|通信|水电|差旅|报刊|会议/u],
  ] : [];
  const category = rules.find(([, pattern]) => pattern.test(text))?.[0];
  return { category: category || (recordType === 'income' ? '其他收入' : recordType === 'expense' ? '其他支出' : ''),
    categorySource: category ? 'rules' : recordType ? 'default' : '' };
}

function refineBalanceColumn(rows,skipped,grid,headers,mapping) {
  rows=rows.filter(row=>['date','summary','income','expense','amount'].every(f=>row.fieldColumns[f]===mapping[f]));
  const columns=headers.map((name,index)=>({name,index})).filter(c=>/余额|结余|结存|balance/iu.test(c.name) && !/序号|编号/u.test(c.name)).map(c=>c.index);
  if(columns.length<2)return;
  const scores=columns.map(column=>{let prev=null,region=null,matched=0,wrong=0;
    for(const row of rows){if(region!==row.regionStart){region=row.regionStart;prev=null;const anchor=skipped.filter(a=>a.reason==='余额结转行'&&a.sourceRowNumber>=region&&a.sourceRowNumber<row.sourceRowNumber).at(-1);if(anchor)prev=parseAmount(anchor.raw[column]);}
      const balance=parseAmount(grid[row.sourceRowNumber-1]?.[column]);
      if(prev!==null && balance!==null && row.amountCents>0 && row.recordType){if(prev+(row.recordType==='income'?row.amountCents:-row.amountCents)===balance)matched++;else wrong++;}prev=balance;
    }return {column,matched,wrong};});
  const eligible=scores.filter(s=>s.matched>=2 && s.wrong===0);if(eligible.length!==1 || eligible[0].column===mapping.balance)return;
  const column=eligible[0].column;mapping.balance=column;
  for(const row of rows){row.fieldColumns.balance=column;row.sourceBalanceCents=parseAmount(grid[row.sourceRowNumber-1]?.[column]);row.sourceBalanceText=clean(grid[row.sourceRowNumber-1]?.[column]);row.balanceMappingSource='continuous-balance';}
  for(const anchor of skipped.filter(r=>r.reason==='余额结转行'))anchor.sourceBalanceCents=parseAmount(anchor.raw[column]);
}

function parseFinanceGrid(grid, { sheetName = '', fileName = '', year, dateConfirmations = {}, headerRowIndex, mapping: overrides = {}, categoryCatalog = CATEGORIES } = {}) {
  if (!Array.isArray(grid)) throw new Error('工作表内容不正确');
  const firstStrong = grid.findIndex((_,index)=>headerAt(grid,index).strong);
  const headerIndex = Number.isInteger(headerRowIndex) ? headerRowIndex : firstStrong >= 0 ? firstStrong : findHeader(grid);
  let context = recognitionContext(grid,{sheetName,fileName,year,headerRowIndex:headerIndex,confirmation:dateConfirmations[headerIndex+1]});
  const firstContext = context;
  const rows = [], skipped = [], regions = [];
  let contextStart = headerIndex + 1;
  const firstHeader = headerIndex >= 0 ? headerAt(grid, headerIndex, overrides) : {headers:[],mapping:{},size:0};
  let headers = firstHeader.headers, mapping = firstHeader.mapping, regionStart = headerIndex + firstHeader.size + 1;
  let subtotalStart = regionStart;
  if (headerIndex >= 0) regions.push({headerRowNumber:headerIndex+1,regionStart,context});
  const addSkipped = (index, reason, extra = {}) => skipped.push({sourceRowNumber:index+1, raw:(grid[index] || []).map(clean), reason, ...extra});
  let firstDataRow = headerIndex < 0 ? 0 : headerIndex + firstHeader.size;
  for (let index = 0; index < firstDataRow; index++) {
    if (!(grid[index] || []).some(value=>clean(value))) continue;
    if (index >= headerIndex) { addSkipped(index,'表头'); continue; }
    const cells = grid[index] || [], nonempty = cells.filter(value=>clean(value));
    if (metadataRow(cells,context)) addSkipped(index,'表头说明行');
    else if (emptyBusinessRow(cells,firstHeader.mapping)) addSkipped(index,'业务列空白行',{fieldColumns:{...firstHeader.mapping}});
    else if (nonempty.length <= 2 && !nonempty.some(value=>amountState(value)==='value' || parseDate(value,context) || /^(收[：:]|付[：:]|支付|支出|收入)/u.test(clean(value)))) addSkipped(index,'标题');
    else rows.push({sheetName,sourceRowNumber:index+1,raw:cells.map(clean),recordDate:'',recordType:'',amountCents:null,summary:cells.map(clean).join(' '),category:'',issues:['表头之前存在未确认内容'],sourceBalanceCents:null,fieldColumns:{},regionStart:1});
  }
  for (let index = firstDataRow; index < grid.length; index++) {
    const cells = Array.isArray(grid[index]) ? grid[index] : [];
    const nonempty = cells.map(clean).filter(Boolean);
    if (!nonempty.length) continue;
    const sourceRowNumber = index + 1;
    const localHeader = headerAt(grid,index);
    if (localHeader.strong) {
      if (index !== headerIndex) {
        context = recognitionContext(grid,{sheetName,fileName,year,headerRowIndex:index,contextStart,confirmation:dateConfirmations[index+1]});
        contextStart=index+localHeader.size;
        regions.push({headerRowNumber:index+1,regionStart:index+localHeader.size+1,context});
      }
      regionStart=index+localHeader.size+1;subtotalStart=regionStart;
      mapping = localHeader.mapping; headers = localHeader.headers;
      for (let offset=0;offset<localHeader.size;offset++) addSkipped(index+offset,'重复表头');
      index += localHeader.size-1; continue;
    }
    if (metadataRow(cells,context)) {addSkipped(index,'表头说明行');continue;}
    if(signatureRow(cells,mapping,context)){addSkipped(index,'签字说明行',{fieldColumns:{...mapping}});continue;}
    const notice = businessNoticeRow(cells,mapping);
    if (notice) {addSkipped(index,notice,{fieldColumns:{...mapping}});continue;}
    const fields = Object.fromEntries(Object.entries(mapping).map(([field,column]) => [field, cells[column]]));
    const first = nonempty[0], summaryCell = clean(fields.summary);
    const label = clean(summaryCell || first).normalize('NFKC').replace(/\s/gu,'');
    const rawDate = mapping.date !== undefined ? fields.date : fields.month && fields.day ? `${fields.month}-${fields.day}` : fields.day;
    const total = /^(合计|小计|总计|本[年月期]合计|累计|汇总|本月累计)(?:[：:]|$)/u.test(label)
      && !(parseDate(rawDate,context) && amountState(fields.balance) !== 'empty');
    const balance = balanceCarryRow(cells,mapping);
    const moneyFields = ['amount','income','expense'].filter(field=>mapping[field] !== undefined);
    const moneyStates = moneyFields.map(field=>amountState(fields[field]));
    const note = /^(备注|说明|注[：:]|制表|审核|负责人|填表)/u.test(first) && moneyStates.every(value=>value==='empty' || value==='zero');
    if (total || balance || note) {
      const scope = /^(合计|本月合计|本期合计|小计)(?:[：:]|$)/u.test(label);
      const check = total && scope && mapping.income !== undefined && mapping.expense !== undefined;
      addSkipped(index,total?'合计或汇总行':balance?'余额结转行':'说明行',{fieldColumns:{...mapping},sourceBalanceCents:balance?parseAmount(fields.balance):null,
        totalCheck: check ? {startRow:/^小计(?:[：:]|$)/u.test(label)?subtotalStart:/^本[月期]合计/u.test(label) && context.month ? firstDataRow+1 : regionStart,endRow:index,incomeCents:amountState(fields.income)==='empty'?0:parseAmount(fields.income),expenseCents:amountState(fields.expense)==='empty'?0:parseAmount(fields.expense)} : null});
      if (/^小计(?:[：:]|$)/u.test(label)) subtotalStart=index+2;
      continue;
    }
    if (emptyBusinessRow(cells,mapping)) {addSkipped(index,'业务列空白行',{fieldColumns:{...mapping}});continue;}
    if (noTransactionAmount(cells,mapping)) {addSkipped(index,'无发生额行',{fieldColumns:{...mapping}});continue;}
    const sourceDate = mapping.date !== undefined ? fields.date : fields.month && fields.day ? `${fields.month}-${fields.day}` : fields.day;
    const dayOnly = /^\d{1,2}日?$/u.test(clean(sourceDate).normalize('NFKC'));
    const recordDate = parseDate(sourceDate,dayOnly && context.needsConfirmation ? {} : context);
    const dateRecognitionReason = !recordDate && dayOnly && context.needsConfirmation ? context.conflicts.join('、') || '缺少明确的工作表年月，请确认' : '';
    const dateRecognitionSource = recordDate ? dayOnly ? context.source === 'confirmed' ? 'confirmed-period' : 'sheet-period' : 'original-date' : ''; 
    const summary = clean(fields.summary);
    const inferred = inferType({...fields,summary,category:clean(fields.category)}, categoryCatalog);
    const issues = [];
    if (!recordDate) issues.push('请填写完整交易日期');
    if (!summary) issues.push('请填写收支摘要');
    if (moneyStates.includes('invalid')) issues.push('金额格式无法识别');
    if (!Number.isSafeInteger(inferred.amountCents) || inferred.amountCents <= 0) issues.push(moneyStates.includes('zero')?'零金额需人工确认':'请核对金额');
    if (inferred.issue) issues.push(inferred.issue);
    if (!inferred.type) issues.push('请选择收入或支出');
    const { category, categorySource } = classifyCategory(inferred.type, clean(fields.category), summary, categoryCatalog);
    if (!category) issues.push('请选择现有财务分类');
    const transactionEvidence = { date:!!recordDate, summary:!!summary, amount:Number.isSafeInteger(inferred.amountCents) && inferred.amountCents > 0 && !moneyStates.includes('invalid'), balance:Number.isSafeInteger(parseAmount(fields.balance)) };
    rows.push({sheetName,sourceRowNumber,raw:cells.map(clean),fieldColumns:{...mapping},transactionEvidence,regionStart,recordDate,recordType:inferred.type,
      amountCents:moneyStates.includes('invalid')?null:inferred.amountCents ?? (moneyStates.includes('zero')?0:null),sourceBalanceCents:parseAmount(fields.balance),sourceBalanceText:clean(fields.balance),summary,category,categorySource,
      dateContext:context,dateRecognitionSource,dateRecognitionReason,sourceDate:clean(sourceDate),sourceCategory:clean(fields.category),handler:clean(fields.handler),counterparty:clean(fields.counterparty),voucherNo:clean(fields.voucherNo),attachmentNote:clean(fields.attachmentNote),remarks:clean(fields.remarks),issues});
  }
  for (const region of regions) resolveMonthRange(rows.filter(row=>row.regionStart===region.regionStart),region.context);
  refineBalanceColumn(rows,skipped,grid,headers,mapping);
  const dated=rows.filter(row=>row.recordDate), descending=dated.length>1 && dated[0].recordDate>dated[dated.length-1].recordDate;
  for (const row of rows) row.sourceOrder=descending?-row.sourceRowNumber:row.sourceRowNumber;
  const coverage=grid.flatMap((cells,index)=>(cells || []).some(value=>clean(value))?[index+1]:[]);
  return {sheetName,context:firstContext,dateConfirmations,headerRowNumber:headerIndex>=0?headerIndex+1:null,headers:firstHeader.headers,mapping:firstHeader.mapping,rows,skipped,coverage,regions,error:headerIndex<0?'暂未识别表头，可使用 AI 重新识别':''};
}

module.exports = { INCOME_CATEGORIES, EXPENSE_CATEGORIES, CATEGORIES, ALIASES, parseFinanceGrid, parseDate, parseAmount, recognitionContext, classifyCategory, headerAt, amountState, emptyBusinessRow, resolvesNonBusinessRow };
