'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { parseFinanceGrid } = require('../../src/main/finance-excel-parser');
const review = require('../../src/shared/finance-import-review');
const chartGroups = require('../../src/shared/finance-chart-groups');
const defaultPeriod = require('../../src/shared/finance-default-period');

function fixture({ aiFails = false, saveFails = false, records = [], role = 'main_account', openingSaveFails = false, charts = false, refinementFails = false, report = null, narrativeResponder = null, realAnalysis = false, ledgerFails = false, balanceData = null, importGrid = null, importSheetName = '1月', importFileName = '财务（2026）.xlsx' } = {}) {
  for (const row of records) { if (!Object.hasOwn(row,'recordDate') && !Object.hasOwn(row,'date')) row.recordDate='2026-02-01'; if (!Object.hasOwn(row,'amountCents')) row.amountCents=1000; if (!row.recordType && !row.type) row.recordType='expense'; }
  const events = new Map(), calls = [], chartInstances = [], chartFilters = {}, typeInput = {}, panel = {scrolls:0, scrollIntoView(){this.scrolls++;}};
  const chartNodes = [{dataset:{finChart:'monthly'}},{dataset:{finChart:'category'}}];
  let sheet = parseFinanceGrid(importGrid || [['日期', '收、支内容摘要', '收入', '支出', '余额'], ['', '期初余额','','',0], ['1.2', '拨款到账', 100, '', 100],
    ['1.3', '购买纸张', '', 10, 90]], { sheetName: importSheetName, fileName: importFileName });
  const results = { innerHTML: '' }, counter = {}, deleteButton = {}, clearButton = {}, jumpInput = { value: '1' }, pageError = {}, searchInput = { value: '', focus() {} };
  let opening = null;
  const periodInputs={};
  const host = { innerHTML: '', querySelector(selector) { if (periodInputs[selector]) return periodInputs[selector];return selector === '[data-chart-filters]' ? chartFilters : selector === '[data-field="type"]' ? typeInput : selector === '[data-ledger-panel]' ? panel : selector === '[data-action="clear-search"]' ? clearButton : selector === '[data-page-jump]' ? jumpInput : selector === '[data-page-error]' ? pageError : selector === '[data-field="search"]' ? searchInput : selector === '[data-ledger-results]' ? results : selector === '[data-ledger-count]' ? counter : selector === '[data-action="batch-delete"]' ? deleteButton : null; }, querySelectorAll() { return charts ? chartNodes : []; }, addEventListener(name, callback) { events.set(name, callback); } };
  const renders=[]; Object.defineProperty(host,'innerHTML',{get:()=>renders.at(-1)||'',set:value=>renders.push(value)});
  const api = {
    getLocalAuthStatus: async () => ({ authenticated: true, account: { role, permissions: { finance: ['view'] } } }),
    businessRequest: async input => { calls.push(input);
      if (input.path.includes('finance-records') && ledgerFails) return {ok:false,error:{message:'主机连接中断'}};
      if (input.path.includes('finance-analysis') && realAnalysis) { const params=new URLSearchParams(input.path.split('?')[1]); return {ok:true,data:require('../../src/main/finance-ledger-analysis').analyzeFinanceRecords(records,{startDate:params.get('startDate'),endDate:params.get('endDate')})}; }
      if (input.path.includes('finance-reclassifications')) return refinementFails ? {ok:false,error:{message:'台账已被修改，请重新分析'}} : {ok:true,data:{count:input.body.rows.length}};
      if (input.path.includes('finance-opening-balance')) {
        if (input.method === 'PATCH') {
          if (openingSaveFails) return { ok: false, error: { message: '期初保存失败' } };
          opening = { ...input.body, version: 1 };
        }
        return { ok: true, data: { openingBalance: opening } };
      }
      if (input.path.includes('finance-balance-review')) return {ok:true,data:balanceData || {items:records,pendingCount:0}};
      if (input.path.includes('finance-balance-preview')) return {ok:true,data:{items:[]}};
      if (input.path.includes('finance-account-balance')) return { ok: true, data: opening ? { status: 'ready', amountCents: opening.amountCents, asOfDate: input.path.split('asOfDate=')[1] } : { status: 'unset' } };
 if (input.method === 'POST') return saveFails ? { ok: false, error: { message: '保存失败测试' } } : { ok: true, data: { count: input.body.rows.length } };
      return { ok: true, data: input.path.includes('finance-analysis') ? report || { startDate:'2026-01-01', endDate:'2026-12-31', totals: {}, records, recordCount: records.length, months:[{month:'2026-02',incomeCents:1000,expenseCents:2000},{month:'2026-03',incomeCents:1000,expenseCents:2000}], categories:[{type:'expense', category:'水费', amountCents:2000,count:2},{type:'income',category:'补贴资金',amountCents:1000,count:1}] } : { items: records } }; },
    generateFinanceNarrative: async input => { calls.push({ method: 'NARRATIVE', ...input }); return narrativeResponder ? narrativeResponder(input) : { content: JSON.stringify({summary:'收支概况',findings:[],sections:[{title:'月度变化',text:'基于完整台账'}],suggestions:[]}) }; },
    remapFinanceSheet: async input => { calls.push({method:'REMAP',...input}); const dateConfirmations={...(sheet.dateConfirmations||{})};if(input.dateConfirmation)dateConfirmations[input.dateConfirmation.headerRowNumber]={...input.dateConfirmation,source:'user'};sheet=parseFinanceGrid(importGrid,{sheetName:importSheetName,fileName:importFileName,headerRowIndex:input.headerRowNumber-1,mapping:input.mapping,dateConfirmations});return structuredClone(sheet); },
    selectFinanceWorkbook: async () => ({ previewId: 'p', fileHash: 'a'.repeat(64), fileName: importFileName, sheets: [structuredClone(sheet)] }),
    previewFinanceCategories: async () => ({startDate:'2026-01-01',endDate:'2026-12-31',total:3,rows:[{id:'1',baseVersion:1,category:'水费'}],groups:[{category:'水费',count:1,amountCents:10000,examples:['水费账单']}],unresolved:[{summary:'报销',reason:'用途不明'}]}),
    classifyFinanceWorkbook: async input => { calls.push({method:'CLASSIFY',...input}); if(aiFails) throw new Error('AI 网络断开'); return {sheets:[structuredClone(sheet)],categories:review.categories,warnings:[]}; },
    createV3ImportSnapshot: async () => ({ success: true }),
    recognizeFinanceWorkbook: async () => { calls.push({method:'HEADERS'}); if (aiFails) throw new Error('AI 网络断开'); return { sheets: [structuredClone(sheet)], warnings: [] }; },
  };
  const context = { window: { echarts: {init: node => {const chart={node,events:{},setOption(options){this.options=options;},on(event,callback){this.events[event]=callback;},dispose(){},resize(){}};chartInstances.push(chart);return chart;}}, api, CommunityFinanceImportReview: review, CommunityFinanceChartGroups: chartGroups, CommunityFinanceDefaultPeriod: defaultPeriod, confirm: () => true, location: { hash: '/finance' },
    showToast: () => { throw new Error('finance messages must not overlap controls as global toasts'); } },
    structuredClone, crypto: { randomUUID }, Date, setTimeout: () => 0, clearTimeout: () => {}, CSS: { escape: value => value } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/renderer/js/finance-workspace-ui.js'), 'utf8'), context);
  const click = async dataset => events.get('click')({ target: { closest: selector => dataset.confirmPeriod && !selector.includes('[data-confirm-period]') ? null : ({ dataset }) } });
  const action = async name => events.get('click')({ target: { closest: () => ({ dataset: { action: name } }) } });
  const confirmBalances=async()=>{for(const row of sheet.rows){const key=`${encodeURIComponent(sheet.sheetName)}:${row.sourceRowNumber}`;events.get('change')({target:{dataset:{balanceReason:key},value:'核对原表，确认真实收支'}});await click({confirmBalance:key});}};
  return { periodInputs, location: context.window.location, confirmBalances, host, renders, calls, chartInstances, chartFilters, typeInput, panel, action, events, click, results, deleteButton, jumpInput, pageError, searchInput, clearButton, mount: () => context.window.CommunityFinanceWorkspace.mount(host) };
}

test('upload automatically selects recognized rows and confirms without manual checks; details are initially collapsed', async () => {
  const ui = fixture(); await ui.mount(); await ui.action('import'); await ui.action('pick-file');
  assert.match(ui.host.innerHTML, /确认导入 2 条/);
  assert.match(ui.host.innerHTML, /data-import-details\s*>/);
  assert.doesNotMatch(ui.host.innerHTML, /class="fin-message"/);
  await ui.confirmBalances(); await ui.action('commit-import');
  const saved = ui.calls.find(call => call.method === 'POST' && call.path.endsWith('/finance-imports'));
  assert.equal(saved.body.rows.length, 2);
  assert.deepEqual(saved.body.rows.map(row => row.recordDate), ['2026-01-02', '2026-01-03']);
  assert.match(ui.host.innerHTML, /role="status"/);
});

test('AI network failure and save failure preserve recognition and allow retry without asking users to check every row', async () => {
  const ui = fixture({ aiFails: true, saveFails: true }); await ui.mount(); await ui.action('import'); await ui.action('pick-file');
  await ui.action('ai-classify');
  assert.match(ui.host.innerHTML, /AI 网络断开/);
  assert.match(ui.host.innerHTML, /确认导入 2 条/);
  await ui.confirmBalances(); await ui.action('commit-import');
  assert.match(ui.host.innerHTML, /保存失败测试/);
  assert.match(ui.host.innerHTML, /确认导入 2 条/);
  await ui.confirmBalances(); await ui.action('commit-import');
  const attempts = ui.calls.filter(call => call.method === 'POST' && call.path.endsWith('/finance-imports'));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].body.batchId, attempts[1].body.batchId);
});


test('ledger paginates records and page selection does not select other pages', async () => {
  const records = Array.from({ length: 65 }, (_, index) => ({ id: String(index + 1), summary: `记录${index + 1}`, recordType: 'expense', category: '办公支出', amountCents: 12345, recordDate: '2026-10-01' }));
  const ui = fixture({ records }); await ui.mount();
  assert.equal((ui.host.innerHTML.match(/data-record-id=/g) || []).length, 20);
  assert.match(ui.host.innerHTML, /1–20 笔/);
  await ui.action('next-ledger-page');
  assert.match(ui.results.innerHTML, /21–40 笔/);
  assert.equal((ui.results.innerHTML.match(/data-record-id=/g) || []).length, 20);
  ui.events.get('change')({ target: { dataset: { action: 'select-all-records' }, checked: true } });
  assert.equal(ui.deleteButton.textContent, '删除所选 (20)');
  await ui.action('next-ledger-page');
  assert.doesNotMatch(ui.results.innerHTML, /data-record-id="41" checked/);
  ui.events.get('change')({ target: { dataset: { field: 'pageSize' }, value: '50' } });
  assert.equal((ui.results.innerHTML.match(/data-record-id=/g) || []).length, 50);
  await ui.action('next-ledger-page');
  assert.equal((ui.results.innerHTML.match(/data-record-id=/g) || []).length, 15);
});

test('Chinese composition keeps the input mounted and filters only after characters are committed', async () => {
  const ui = fixture({ records: [{ id: '1', summary: '购买办公用品', recordType: 'expense' }, { id: '2', summary: '维修水管', recordType: 'expense' }] });
  await ui.mount();
  const markup = ui.host.innerHTML, target = { dataset: { field: 'search' }, value: 'ban' };
  ui.events.get('compositionstart')({ target });
  ui.events.get('input')({ target, isComposing: true });
  assert.equal(ui.host.innerHTML, markup);
  assert.equal(ui.results.innerHTML, '');
  target.value = '办公';
  ui.events.get('compositionend')({ target });
  assert.equal(ui.host.innerHTML, markup);
  assert.match(ui.results.innerHTML, /购买办公用品/);
  assert.doesNotMatch(ui.results.innerHTML, /维修水管/);
  target.value = '不存在'; ui.events.get('input')({ target });
  assert.match(ui.results.innerHTML, /没有符合搜索条件的记录/);
});


test('numeric pagination jumps to selected pages and validates manual jumps', async () => {
  const ui = fixture({ records: Array.from({ length: 180 }, (_, index) => ({ id: String(index + 1), summary: '办公用品', recordType: 'expense' })) });
  await ui.mount();
  assert.match(ui.host.innerHTML, /data-ledger-page="1" class="active" aria-current="page"/);
  assert.match(ui.host.innerHTML, /data-ledger-page="9"/);
  await ui.click({ ledgerPage: '5' }); assert.match(ui.results.innerHTML, /81–100 笔/);
  ui.jumpInput.value = '9'; await ui.action('jump-ledger-page'); assert.match(ui.results.innerHTML, /161–180 笔/);
  ui.jumpInput.value = '10'; await ui.action('jump-ledger-page'); assert.match(ui.pageError.textContent, /1 至 9/);
  ui.jumpInput.value = '1.5'; await ui.action('jump-ledger-page'); assert.match(ui.results.innerHTML, /161–180 笔/);
});

test('clear resets keyword and page without changing date, type or balance cutoff', async () => {
  const ui = fixture({ records: Array.from({ length: 45 }, (_, index) => ({ id: String(index + 1), summary: '办公用品', recordType: 'expense' })) });
  await ui.mount();
  ui.events.get('change')({ target: { dataset: { field: 'type' }, value: 'expense' } });
  ui.searchInput.value = '办公'; ui.events.get('input')({ target: { dataset: { field: 'search' }, value: '办公' } });
  assert.equal(ui.clearButton.hidden, false);
  await ui.click({ ledgerPage: '3' });
  const balanceCalls = ui.calls.filter(call => call.path.includes('finance-account-balance')).length;
  await ui.action('clear-search');
  assert.equal(ui.searchInput.value, ''); assert.equal(ui.clearButton.hidden, true);
  assert.match(ui.results.innerHTML, /1–20 笔/);
  assert.equal(ui.calls.filter(call => call.path.includes('finance-account-balance')).length, balanceCalls);
  assert.equal((ui.results.innerHTML.match(/data-record-id=/g) || []).length, 20);
});

test('opening settings save updates balance; default cutoff is today and date queries use the selected end', async () => {
  const ui = fixture(); await ui.mount();
  assert.match(ui.host.innerHTML, /账户余额/); assert.match(ui.host.innerHTML, /待设置/);
  assert.ok(ui.calls.some(call => call.path.includes(`asOfDate=${new Date().toLocaleDateString('sv-SE')}`)));
  await ui.action('set-opening-balance');
  ui.events.get('input')({ target: { dataset: { opening: 'amount' }, value: '1234.56' } });
  ui.events.get('input')({ target: { dataset: { opening: 'startDate' }, value: '2026-01-01' } });
  await ui.action('save-opening');
  assert.match(ui.host.innerHTML, /1,234.56/);
  assert.equal(ui.calls.find(call => call.method === 'PATCH').body.amountCents, 123456);
  ui.events.get('change')({ target: { dataset: { field: 'startDate' }, value: '2026-02-01' } });
  ui.events.get('change')({ target: { dataset: { field: 'endDate' }, value: '2026-02-28' } });
  await ui.action('apply-dates');
  assert.ok(ui.calls.some(call => call.path.includes('finance-account-balance?asOfDate=2026-02-28')));
});

test('opening save failures preserve values; members cannot open the settings', async () => {
  const ui = fixture({ openingSaveFails: true }); await ui.mount(); await ui.action('set-opening-balance');
  ui.events.get('input')({ target: { dataset: { opening: 'amount' }, value: '-150.25' } });
  await ui.action('save-opening');
  assert.match(ui.host.innerHTML, /期初保存失败/); assert.match(ui.host.innerHTML, /value="-150.25"/);
  const member = fixture({ role: 'member' }); await member.mount();
  assert.doesNotMatch(member.host.innerHTML, /data-action="set-opening-balance"/);
  await member.action('set-opening-balance'); assert.doesNotMatch(member.host.innerHTML, /data-opening=/);
});


test('first and last page buttons reach boundaries and disable correctly', async () => {
  const ui=fixture({records:Array.from({length:65},(_,i)=>({id:String(i),summary:'记录',recordType:'expense'}))}); await ui.mount();
  assert.match(ui.host.innerHTML,/data-action="first-ledger-page" disabled/); await ui.action('last-ledger-page');
  assert.match(ui.results.innerHTML,/显示 61–65 笔/); assert.match(ui.results.innerHTML,/data-action="last-ledger-page" disabled/);
  await ui.action('first-ledger-page'); assert.match(ui.results.innerHTML,/显示 1–20 笔/);
});
test('chart clicks combine month and category, reset page, preserve report and balance; tooltip shows complete details', async () => {
  const records=[{id:'1',recordDate:'2026-02-01',recordType:'expense',category:'水费',summary:'社区用水',amountCents:1000},{id:'2',recordDate:'2026-03-01',recordType:'expense',category:'水费',summary:'社区用水',amountCents:1000},{id:'3',recordDate:'2026-02-01',recordType:'expense',category:'电费',summary:'社区用电',amountCents:1000},{id:'4',recordDate:'2026-02-01',recordType:'income',category:'补贴资金',summary:'到账',amountCents:1000}];
  const ui=fixture({records,charts:true}); await ui.mount(); const [bar,pie]=ui.chartInstances.slice(-2), fullHTML=ui.host.innerHTML, calls=ui.calls.length;
  assert.match(pie.options.tooltip.formatter({dataIndex:0,percent:100}),/水费.*金额：20.00 元.*占比：100.00%.*记录：2 笔/s); assert.equal(pie.options.series[0].emphasis.label.show,false);
  pie.events.click({componentType:'series',dataIndex:0}); assert.equal((ui.results.innerHTML.match(/data-record-id=/g)||[]).length,2);
  bar.events.click({componentType:'series',dataIndex:0,seriesIndex:1}); assert.match(ui.results.innerHTML,/data-record-id="1"/); assert.doesNotMatch(ui.results.innerHTML,/data-record-id="2"|data-record-id="3"/); assert.match(ui.chartFilters.innerHTML,/2026-02.*水费/s); assert.equal(ui.panel.scrolls,2);
  assert.equal(ui.host.innerHTML,fullHTML); assert.equal(ui.calls.length,calls);
  bar.events.click({componentType:'series',dataIndex:0,seriesIndex:0}); assert.match(ui.results.innerHTML,/data-record-id="4"/); assert.doesNotMatch(ui.chartFilters.innerHTML,/水费/);
  await ui.action('clear-chart-filters'); assert.equal((ui.results.innerHTML.match(/data-record-id=/g)||[]).length,4); assert.equal(ui.typeInput.value,'');
});
test('AI refinement uses grouped confirmation; save failure preserves preview and cancellation does not write', async () => {
  const ui=fixture({refinementFails:true,records:[{id:'1',recordDate:'2026-02-01',recordType:'expense',amountCents:1000,category:'其他支出'}]}); await ui.mount(); await ui.action('refine-categories'); assert.match(ui.host.innerHTML,/水费账单/); assert.match(ui.host.innerHTML,/用途不明/);
  await ui.action('apply-refinement'); assert.match(ui.host.innerHTML,/台账已被修改/); assert.match(ui.host.innerHTML,/确认保存 1 笔/);
  const count=ui.calls.filter(c=>c.method==='PATCH').length; await ui.action('cancel-refinement'); assert.equal(ui.calls.filter(c=>c.method==='PATCH').length,count); assert.match(ui.host.innerHTML,/收支台账/);
  const viewer=fixture({role:'member'}); await viewer.mount(); await viewer.action('refine-categories'); assert.doesNotMatch(viewer.host.innerHTML,/确认保存/);
});

test('upload automatically calls category-only recognition and failed recognition exposes retry without losing import rows',async()=>{
 const ui=fixture({aiFails:true});await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.equal(ui.calls.filter(call=>call.method==='CLASSIFY').length,1);
 assert.match(ui.host.innerHTML,/data-action="retry-classification"/);assert.match(ui.host.innerHTML,/确认导入 2 条/);
 await ui.action('retry-classification');assert.equal(ui.calls.filter(call=>call.method==='CLASSIFY').length,2);assert.match(ui.host.innerHTML,/确认导入 2 条/);
});

test('summary pie filters all member records, preserves month/search and can switch back to detail without changing data', async () => {
  const records = [
    {id:'water',recordDate:'2026-02-01',recordType:'expense',category:'水费',summary:'用水',amountCents:1000},
    {id:'electric',recordDate:'2026-02-02',recordType:'expense',category:'电费',summary:'用电',amountCents:2000},
    {id:'drink',recordDate:'2026-02-03',recordType:'expense',category:'饮用水费',summary:'桶装水',amountCents:500},
    {id:'other',recordDate:'2026-02-04',recordType:'expense',category:'其他支出',summary:'报销',amountCents:300},
  ];
  const report = require('../../src/main/finance-ledger-analysis').analyzeFinanceRecords(records,{startDate:'2026-01-01',endDate:'2026-12-31'});
  const ui=fixture({records,report,charts:true}); await ui.mount();
  ui.events.get('change')({target:{dataset:{field:'chartMode'},value:'summary'}});
  const pie=ui.chartInstances.at(-1), index=pie.options.series[0].data.findIndex(row=>row.name==='公共服务');
  assert.match(pie.options.tooltip.formatter({dataIndex:index,percent:80}),/具体科目：.*电费.*水费|具体科目：.*水费.*电费/);
  pie.events.click({componentType:'series',dataIndex:index});
  assert.match(ui.results.innerHTML,/data-record-id="water"/);assert.match(ui.results.innerHTML,/data-record-id="electric"/);
  assert.doesNotMatch(ui.results.innerHTML,/data-record-id="drink"|data-record-id="other"/);
  ui.events.get('input')({target:{dataset:{field:'search'},value:'用电'}});
  assert.match(ui.results.innerHTML,/data-record-id="electric"/);assert.doesNotMatch(ui.results.innerHTML,/data-record-id="water"/);
  ui.events.get('change')({target:{dataset:{field:'chartMode'},value:'detail'}});
  assert.equal(ui.chartInstances.at(-1).options.series[0].data.length,4);
  await ui.action('clear-search');await ui.action('clear-chart-filters');
  assert.equal((ui.results.innerHTML.match(/data-record-id=/g)||[]).length,4);
});

test('deep report is opt-in, keeps brief and survives generation failures; changed data marks earlier reports stale', async () => {
  let failing=false;
  const records=[{id:'1',recordDate:'2026-01-01',recordType:'expense',category:'水费',amountCents:1000}];
  const ui=fixture({records,narrativeResponder: input=> {
    if (failing) throw new Error('网络断开');
    return {content:JSON.stringify(input.analysisDepth==='deep'?{summary:'深度总览',sections:[{title:'大额收支',text:'基于完整台账的详细内容'}],suggestions:['核对数据']}:{summary:'简报总览',findings:[],suggestions:[]})};
  }});await ui.mount();
  assert.equal(ui.calls.filter(call=>call.method==='NARRATIVE').length,0);
  await ui.action('narrative');await ui.action('deep-narrative');
  assert.match(ui.host.innerHTML,/简报总览/);assert.match(ui.host.innerHTML,/深度总览/);assert.match(ui.host.innerHTML,/<details open><summary>大额收支/);
  failing=true;await ui.action('deep-narrative');assert.match(ui.host.innerHTML,/网络断开/);assert.match(ui.host.innerHTML,/深度总览/);
  records[0].amountCents=2000;await ui.action('reload');assert.match(ui.host.innerHTML,/以下为此前报告/);
});

test('confirmation reissues analysis only after acceptance and ignores results from a replaced report', async () => {
  let resolve;
  const ui=fixture({records:[{id:'1',recordType:'income'}],narrativeResponder: input=>input.usageConfirmed?{content:'{"summary":"已确认生成","sections":[]}'}:{requiresConfirmation:true,estimate:{estimatedTokens:6000}}});
  await ui.mount();await ui.action('deep-narrative');assert.equal(ui.calls.filter(call=>call.method==='NARRATIVE').length,2);assert.match(ui.host.innerHTML,/已确认生成/);
  const pending=fixture({records:[{id:'1',recordType:'income'}],narrativeResponder:()=>new Promise(done=>{resolve=done;})});await pending.mount();
  const task=pending.action('deep-narrative');await pending.action('reload');resolve({content:'{"summary":"过期内容","sections":[]}'});await task;
  assert.doesNotMatch(pending.host.innerHTML,/过期内容/);
});

test('initial analysis requests the latest historical month and balance today, never the empty current month', async () => {
  const ui=fixture({records:[{id:'1',recordDate:'2025-07-30',recordType:'income',amountCents:10000}],realAnalysis:true});
  await ui.mount();
  assert.match(ui.renders[0],/正在读取收支台账/);assert.doesNotMatch(ui.renders[0],/总收入|暂无收支数据/);
  const calls=ui.calls.filter(call=>call.path?.includes('finance-analysis'));
  assert.equal(calls.length,1);assert.match(calls[0].path,/startDate=2025-07-01&endDate=2025-07-31/);
  assert.match(ui.host.innerHTML,/最新记录为 2025-07-30，当前展示 2025 年 7 月/);
  assert.match(ui.calls.find(call=>call.path.includes('finance-account-balance')).path,new RegExp(`asOfDate=${new Date().toLocaleDateString('sv-SE')}`));
});

test('manual empty periods stay selected; recent mode relocates after new rows or deletion, ignoring old reuploads', async () => {
  const records=[{id:'1',recordDate:'2025-07-30',recordType:'income',amountCents:10000}];
  const ui=fixture({records,realAnalysis:true});await ui.mount();
  ui.events.get('change')({target:{dataset:{field:'startDate'},value:'2025-08-01'}});
  ui.events.get('change')({target:{dataset:{field:'endDate'},value:'2025-08-31'}});
  await ui.action('apply-dates');assert.match(ui.host.innerHTML,/所选日期范围暂无收支记录/);assert.match(ui.host.innerHTML,/查看最近数据/);
  records.push({id:'2',recordDate:'2025-09-03',recordType:'expense',amountCents:100});
  await ui.action('reload');assert.match(ui.calls.filter(call=>call.path?.includes('finance-analysis')).at(-1).path,/startDate=2025-08-01&endDate=2025-08-31/);
  await ui.action('recent-data');assert.match(ui.host.innerHTML,/最新记录为 2025-09-03/);
  records.push({id:'old',recordDate:'2024-01-01',recordType:'expense',amountCents:100,importedAt:'2026-10-04'});
  await ui.action('reload');assert.match(ui.host.innerHTML,/最新记录为 2025-09-03/);
  records.splice(1,1);await ui.action('reload');assert.match(ui.host.innerHTML,/最新记录为 2025-07-30/);
});

test('no valid history uses a compact empty state; read failures are displayed separately with retry', async () => {
  const ui=fixture({records:[],realAnalysis:true});await ui.mount();assert.match(ui.host.innerHTML,/暂无收支数据/);assert.doesNotMatch(ui.host.innerHTML,/data-fin-chart/);
  assert.match(ui.host.innerHTML,/data-action="import"/);assert.match(ui.host.innerHTML,/data-action="add"/);
  const broken=fixture({ledgerFails:true});await broken.mount();assert.match(broken.host.innerHTML,/读取财务数据失败.*主机连接中断/);
  assert.match(broken.host.innerHTML,/重试/);assert.doesNotMatch(broken.host.innerHTML,/暂无收支数据|总收入/);
});

test('changing date range clears chart month/category/type and resets pagination', async () => {
  const records=[{id:'water',recordDate:'2026-02-01',recordType:'expense',category:'水费',amountCents:100},
    {id:'income',recordDate:'2026-03-01',recordType:'income',category:'土地租金收入',amountCents:200}];
  const ui=fixture({records,realAnalysis:true,charts:true});await ui.mount();
  ui.chartInstances.findLast(chart=>chart.node.dataset.finChart==='monthly').events.click({componentType:'series',dataIndex:0,seriesIndex:0});
  ui.events.get('change')({target:{dataset:{field:'startDate'},value:'2026-02-01'}});
  ui.events.get('change')({target:{dataset:{field:'endDate'},value:'2026-02-28'}});
  await ui.action('apply-dates');
  assert.match(ui.host.innerHTML,/data-record-id="water"/);assert.doesNotMatch(ui.host.innerHTML,/图表筛选：/);
  assert.match(ui.host.innerHTML,/data-ledger-page="1" class="active"/);
});


test('changing applied month clears brief and deep reports while keyword/type changes retain them', async () => {
  const ui=fixture({records:[{id:'1',recordDate:'2026-02-01',recordType:'income',amountCents:1000}],realAnalysis:true,narrativeResponder:input=>({content:JSON.stringify(input.analysisDepth==='deep'?{summary:'原月份深度报告',sections:[{title:'分析',text:'原月份细节'}]}:{summary:'原月份简报',findings:[]})})});
  await ui.mount(); await ui.action('narrative'); await ui.action('deep-narrative');
  ui.events.get('change')({target:{dataset:{field:'type'},value:'income'}});
  ui.events.get('input')({target:{dataset:{field:'search'},value:'记录'}});
  assert.match(ui.host.innerHTML,/原月份深度报告/);
  await ui.click({preset:'year'}); assert.doesNotMatch(ui.host.innerHTML,/原月份深度报告|原月份简报|原月份细节/);
});

test('date input invalidates pending AI even before apply; new report requires applying dates', async()=>{
  let resolve; const ui=fixture({records:[{id:'1',recordDate:'2026-02-01',recordType:'income',amountCents:1000}],realAnalysis:true,narrativeResponder:()=>new Promise(done=>{resolve=done;})});
  await ui.mount(); const task=ui.action('deep-narrative');
  ui.events.get('input')({target:{dataset:{field:'endDate'},value:'2026-03-31'}});
  await ui.action('narrative'); assert.equal(ui.calls.filter(c=>c.method==='NARRATIVE').length,1);
  resolve({content:'{"summary":"切换前的旧报告","sections":[]}'}); await task;
  await ui.action('apply-dates'); assert.doesNotMatch(ui.host.innerHTML,/切换前的旧报告/);
});

test('ledger shows computed balance and differences can be reviewed and edited without losing source value',async()=>{
  const record={id:'bad',recordDate:'2026-02-01',recordType:'expense',amountCents:1000,summary:'购纸',category:'办公支出',version:123,calculatedBalanceCents:-1000,sourceBalanceCents:-999,balanceDifferenceCents:-1,balanceStatus:'mismatch',dayPosition:1,dayCount:2,sourceSheetName:'2月',sourceRowNumber:3};
  const ui=fixture({records:[record],balanceData:{items:[record],pendingCount:1,mismatchCount:1},realAnalysis:true});
  await ui.mount(); assert.match(ui.host.innerHTML,/余额（元）/); assert.match(ui.host.innerHTML,/-10.00/); assert.match(ui.host.innerHTML,/1 笔余额待审核/);
  await ui.action('balance-review'); assert.match(ui.host.innerHTML,/差额（计算 − 原表）/); assert.match(ui.host.innerHTML,/-9.99/); assert.match(ui.host.innerHTML,/-0.01/);
  await ui.click({reviewEdit:'bad'}); assert.match(ui.host.innerHTML,/原表余额：-9.99/); assert.match(ui.host.innerHTML,/调整同日顺序/);
  await ui.action('cancel-form'); assert.match(ui.host.innerHTML,/余额核对与人工审核/);
});

test('unresolved original transaction blocks whole save and opens details; manual repair restores single-confirm import',async()=>{
 const ui=fixture({aiFails:true,importGrid:[['日期','摘要','收入','支出','余额'],['2026-01-02','收：捐款',100,'',100],['2026-01-03','付：水费','','10.001',90]]});
 await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.match(ui.host.innerHTML,/暂停整批导入/u);assert.match(ui.host.innerHTML,/data-import-details[^>]*open/u);assert.match(ui.host.innerHTML,/data-action="commit-import" disabled/u);
 await ui.confirmBalances(); await ui.action('commit-import');assert.equal(ui.calls.filter(call=>call.path?.endsWith('/finance-imports')).length,0);
 ui.events.get('change')({target:{dataset:{rowKey:'1%E6%9C%88:3',rowField:'amount'},value:'10.00'}});
 await ui.confirmBalances(); await ui.action('commit-import');const saved=ui.calls.find(call=>call.path?.endsWith('/finance-imports'));
 assert.equal(saved.body.rows.length,2);assert.equal(saved.body.reviewRows.length,2);assert.equal(saved.body.previewId,'p');assert.ok(saved.body.reviewRows[1].manualFields.includes('amountCents'));
});
test('cross-file similarities pause import until grouped independent/existing choice, never deduplicate source rows',async()=>{
 const records=[{id:'old',recordDate:'2026-01-02',recordType:'income',summary:'拨款到账',category:'上级拨款',amountCents:10000,sourceFileHash:'c'.repeat(64)}];
 const ui=fixture({records});await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.match(ui.host.innerHTML,/其他来源相似/u);assert.match(ui.host.innerHTML,/data-action="commit-import" disabled/u);
 await ui.action('duplicates-independent');await ui.confirmBalances(); await ui.action('commit-import');const saved=ui.calls.find(call=>call.path?.endsWith('/finance-imports'));assert.equal(saved.body.rows.length,2);assert.equal(saved.body.reviewRows[0].duplicateDecision,'independent');
 const second=fixture({records});await second.mount();await second.action('import');await second.action('pick-file');await second.action('duplicates-existing');await second.action('commit-import');const remaining=second.calls.find(call=>call.path?.endsWith('/finance-imports'));assert.equal(remaining.body.rows.length,1);assert.equal(remaining.body.reviewRows.length,2);
});
test('explicit source total mismatch pauses whole import until corrected or original-total error explained',async()=>{
 const ui=fixture({importGrid:[['日期','摘要','收入','支出'],['2026-01-02','收：捐款',100,''],['2026-01-03','付：水费','',30],['','本月合计',100,20]]});
 await ui.mount();await ui.action('import');await ui.action('pick-file');assert.match(ui.host.innerHTML,/存在差异/u);await ui.confirmBalances(); await ui.action('commit-import');assert.equal(ui.calls.filter(call=>call.path?.endsWith('/finance-imports')).length,0);
 ui.events.get('change')({target:{dataset:{totalReason:'1%E6%9C%88:4'},value:'已核对凭证，原表合计遗漏10元'}});await ui.confirmBalances(); await ui.action('commit-import');const saved=ui.calls.find(call=>call.path?.endsWith('/finance-imports'));assert.equal(saved.body.rows.length,2);assert.equal(saved.body.totalAcknowledgements['1%E6%9C%88:4'],'已核对凭证，原表合计遗漏10元');
});

test('April numbered template shows exactly 15 importable payments without blank row corrections or AI header retries',async()=>{
 const grid=require('../helpers/finance-april-template.cjs')();
 const ui=fixture({importGrid:grid,importSheetName:'4月',importFileName:'财务2024.xlsx'});await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.match(ui.host.innerHTML,/确认导入 15 条/u);assert.doesNotMatch(ui.host.innerHTML,/data-action="commit-import" disabled/u);assert.match(ui.host.innerHTML,/data-import-blockers hidden/u);
 assert.equal(ui.calls.filter(call=>call.method==='HEADERS').length,0);
 await ui.confirmBalances(); await ui.action('commit-import');const submitted=ui.calls.find(call=>call.path?.endsWith('/finance-imports'));
 assert.equal(submitted.body.rows.length,15);assert.equal(submitted.body.reviewRows.length,15);assert.equal(submitted.body.rows.at(-1).recordDate,'2024-04-16');assert.ok(submitted.body.rows.every(row=>row.sourceRowNumber>=5 && row.sourceRowNumber<=19));
});

test('last-year balance is only an anchor and does not block the confirmation button',async()=>{
 const grid=[['2026年01月'],['序号','日期','摘要','收入','支出','余额'],['','','上年余额','','',100],
 [1,4,'付：水费','',10,90],[2,6,'收：捐款',20,'',110],['','','本月合计',20,10,'']];
 const ui=fixture({importGrid:grid});await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.match(ui.host.innerHTML,/确认导入 2 条/u);assert.doesNotMatch(ui.host.innerHTML,/data-action="commit-import" disabled/u);
 await ui.action('commit-import');const saved=ui.calls.find(call=>call.path?.endsWith('/finance-imports'));
 assert.equal(saved.body.rows.length,2);assert.deepEqual(Array.from(saved.body.rows,row=>row.sourceRowNumber),[4,5]);
});

test('ledger keyword search includes both income and expense amounts in yuan, with grouping and fullwidth input',async()=>{
 const ui=fixture({records:[{id:'income',recordDate:'2026-01-02',recordType:'income',amountCents:9800000,summary:'租金',category:'收入'},
 {id:'expense',recordDate:'2026-01-03',recordType:'expense',amountCents:9800000,summary:'工程',category:'支出'},
 {id:'small',recordDate:'2026-01-04',recordType:'expense',amountCents:12345,summary:'水费',category:'支出'}],realAnalysis:true});
 await ui.mount();
 for(const query of ['98000','98,000','98000.00','￥９８，０００．００元']){
  ui.events.get('input')({target:{dataset:{field:'search'},value:query}});
  assert.match(ui.results.innerHTML,/data-ledger-row="income"/u);assert.match(ui.results.innerHTML,/data-ledger-row="expense"/u);assert.doesNotMatch(ui.results.innerHTML,/data-ledger-row="small"/u);
 }
 ui.events.get('input')({target:{dataset:{field:'search'},value:'123.45'}});assert.match(ui.results.innerHTML,/data-ledger-row="small"/u);
});


test('invalid date ranges keep correction and return controls; recent data and corrected dates recover', async () => {
  const ui=fixture({records:[{id:'1',recordDate:'2025-07-30',recordType:'income',amountCents:10000}],realAnalysis:true});await ui.mount();
  const before=ui.calls.length;
  ui.events.get('change')({target:{dataset:{field:'startDate'},value:''}});await ui.action('apply-dates');
  assert.equal(ui.calls.length,before);assert.match(ui.host.innerHTML,/请选择有效的起止日期/);
  assert.match(ui.host.innerHTML,/data-field="startDate"/);assert.match(ui.host.innerHTML,/恢复最近数据/);assert.match(ui.host.innerHTML,/返回工作台/);
  await ui.action('reload');assert.equal(ui.calls.length,before);
  await ui.action('recent-data');assert.doesNotMatch(ui.host.innerHTML,/读取财务数据失败/);assert.match(ui.host.innerHTML,/最新记录为 2025-07-30/);
  ui.events.get('change')({target:{dataset:{field:'startDate'},value:'2025-08-01'}});
  ui.events.get('change')({target:{dataset:{field:'endDate'},value:'2025-07-31'}});await ui.action('apply-dates');assert.match(ui.host.innerHTML,/结束日期不能早于开始日期/);
  ui.events.get('change')({target:{dataset:{field:'endDate'},value:'2025-08-31'}});await ui.action('apply-dates');assert.doesNotMatch(ui.host.innerHTML,/读取财务数据失败/);assert.match(ui.host.innerHTML,/所选日期范围暂无收支记录/);
  const failed=fixture({ledgerFails:true});await failed.mount();await failed.action('return-overview');assert.equal(failed.location.hash,'/overview');
});


test('worksheet period conflict is visible; one confirmation fills days while preserving manually edited records',async()=>{
 const grid=[['2025年11月'],['序号','日期','摘要','收入','支出','余额'],['','','期初余额','','',100],[1,5,'收：经费',10,'',110],[2,12,'收：经费',20,'',130]];
 const ui=fixture({importGrid:grid,importSheetName:'12月',importFileName:'财务2025.xlsx'});await ui.mount();await ui.action('import');await ui.action('pick-file');
 assert.match(ui.host.innerHTML,/确认“12月”的年月/);assert.match(ui.host.innerHTML,/月份依据不一致/);assert.match(ui.host.innerHTML,/原表第 1 行/);
 const change=(key,field,value)=>ui.events.get('change')({target:{dataset:{rowKey:key,rowField:field},value}});
 const first=`${encodeURIComponent('12月')}:4`,second=`${encodeURIComponent('12月')}:5`;
 change(first,'summary','手工核对摘要');change(first,'recordDate','2025-12-06');change(second,'category','其他收入');
 const key=`${encodeURIComponent('12月')}:2`;
 ui.periodInputs[`[data-period-year="${key}"]`]={value:'2025'};ui.periodInputs[`[data-period-month="${key}"]`]={value:'12'};
 await ui.click({confirmPeriod:'12月',periodHeader:'2'});
 assert.doesNotMatch(ui.host.innerHTML,/确认“12月”的年月/);assert.match(ui.host.innerHTML,/2025-12-12/);assert.match(ui.host.innerHTML,/手工核对摘要/);
 await ui.action('commit-import');
 const saved=ui.calls.find(call=>call.method==='POST'&&call.path.endsWith('/finance-imports'));
 assert.deepEqual(saved.body.rows.map(row=>row.recordDate),['2025-12-06','2025-12-12']);assert.equal(saved.body.rows[0].summary,'手工核对摘要');assert.equal(saved.body.rows[1].categorySource,'manual');
 assert.equal(ui.calls.filter(call=>call.method==='REMAP').length,1);
});
