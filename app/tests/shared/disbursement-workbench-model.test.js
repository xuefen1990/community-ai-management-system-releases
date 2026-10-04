'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../src/shared/disbursement-workbench-model');
const model = require('../../src/shared/contract-fee-model');
const people = [{ id:'p1', name:'张三', group:'一组', id_card:'320100199001010011', bankCard:'1234567890123456' }, { id:'p2', name:'张三', group:'二组', id_card:'320100199001010022' }];
const template = { id:'t', key:'casual_labor', name:'杂工', fields:['工日'], builtIn:true };
test('resident candidates bounded, duplicates never silently selected', () => {
  const result = W.candidates('张三',people,model); assert.equal(result.exact.length,2);
  assert.equal(W.candidates('',people,model).matches.length,0);
  assert.equal(W.candidates('张',Array.from({length:1000}, (_,i)=>({...people[0],id:String(i)})),model).matches.length,20);
});
test('historical reuse links duplicate names only with a unique identifier and keeps the original bank card', () => {
  const source = { items: [{ name: '张三', groupName: '一组', bankCard: '1234567890123456', amountCents: 10000 }] };
  const linked = W.reuse(source, { key: 'position_salary' }, people, model)[0];
  assert.equal(linked.personId, 'p1');
  assert.equal(linked.bankCard, '1234567890123456');
  const ambiguous = W.reuse({ items: [{ name: '张三', groupName: '一组', amountCents: 10000 }] }, { key: 'position_salary' }, people, model)[0];
  assert.equal(ambiguous.personId || '', '');
  assert.equal(W.matchResident({ name: '张三', idCard: '320100199001010022' }, people, model).id, 'p2');
  assert.equal(W.matchResident({ name: '张三', groupName: '二组', bankCard: '1234567890123456' }, people, model), null);
  assert.equal(W.matchResident({ name: '张三', idCard: 'wrong', bankCard: '1234567890123456' }, people, model), null);
});
test('a recurring batch can reuse a previously confirmed same-name identity without trusting the name alone', () => {
  const row = { name: '张三', groupName: '一组', bankCard: '9999888877776666' };
  const history = [{ id: 'confirmed', categoryId: 'salary', templateKey: 'position_salary', status: 'completed', items: [{ ...row, personId: 'p1' }] }];
  const scope = { categoryId: 'salary', templateKey: 'position_salary' };
  assert.equal(W.matchConfirmedResident(row, history, people, model, scope)?.id, 'p1');
  assert.equal(W.matchConfirmedResident({ name: '张三', groupName: '一组' }, history, people, model, scope), null);
  assert.equal(W.matchConfirmedResident({ ...row, groupName: '二组' }, history, people, model, scope), null);
  assert.equal(W.matchConfirmedResident(row, history, people, model, { ...scope, categoryId: 'other' }), null);
  assert.equal(W.matchConfirmedResident(row, [...history, { ...history[0], id: 'other', items: [{ ...row, personId: 'p2' }] }], [people[0], { ...people[1], group: '一组' }], model, scope), null);
  const source = { id: 'old', categoryId: 'salary', templateKey: 'position_salary', items: [{ ...row, amountCents: 10000 }] };
  assert.equal(W.reuse(source, { key: 'position_salary' }, people, model, { history })[0].personId, 'p1');
  const conflicting = [{ ...history[0], items: [{ ...row, bankCard: '1234567890123456', personId: 'p2' }] }];
  const conflictPeople = [people[0], { ...people[1], group: '一组' }];
  assert.equal(W.reuse({ ...source, items: [{ ...row, bankCard: '1234567890123456', amountCents: 10000 }] }, { key: 'position_salary' }, conflictPeople, model, { history: conflicting })[0].personId || '', '');
});
test('switching person clears old identifying and bank data including resident custom fields', () => {
  const t = {...template, columns:[{label:'手机',source:'resident',residentField:'phone'}]};
  const row = W.unlink({personId:'p1',name:'张三',bankCard:'old',phone:'old',customData:{手机:'old',事项:'保留'}},t);
  assert.equal(row.bankCard,''); assert.equal(row.personId,''); assert.equal(row.customData.手机,''); assert.equal(row.customData.事项,'保留');
  const linked = W.link(row,people[1],t,model); assert.equal(linked.bankCard,''); assert.equal(linked.personId,'p2');
});
test('labor reuse drops work data; recurring salary retains amount; rent requires rate', () => {
  const batch = {items:[{name:'临时',workDate:'旧日期',workItem:'旧事项',quantity:5,unitPriceCents:10000,amountCents:50000,bankCard:'abc',remark:'旧备注'}]};
  const labor = W.reuse(batch,template,[],model)[0]; assert.equal(labor.workDate,''); assert.equal(labor.workItem,''); assert.equal(labor.quantity,''); assert.equal(labor.finalAmount,''); assert.equal(labor.unitPrice,'100.00');
  const salary = W.reuse(batch,{key:'position_salary'},[],model)[0]; assert.equal(salary.quantity,5); assert.equal(salary.finalAmount,'500.00'); assert.equal(salary.unitPrice,'100.00');
  const recurringCustom = W.reuse(batch,{key:'custom_allowance'},[],model,{preserveAmounts:true})[0]; assert.equal(recurringCustom.finalAmount,'500.00');
  const configuredRecurring = W.reuse(batch,{key:'custom_allowance',visualLayout:{calculation:{mode:'uniform',amount:100}}},[],model,{preserveAmounts:true})[0];
  assert.equal(configuredRecurring.finalAmount,'500.00'); assert.equal(configuredRecurring.manualAmount,true);
  const oneOffCustom = W.reuse(batch,{key:'custom_allowance'},[],model)[0]; assert.equal(oneOffCustom.finalAmount,'');
  const rent = W.reuse(batch,{key:'contract_fee'},[],model)[0]; assert.equal(rent.quantity,5); assert.equal(rent.unitPrice,'');
  assert.equal(batch.items[0].workItem,'旧事项');
});
test('money auto calculation and manual override use integer cents', () => {
  const row = W.recalculate({quantity:5.5,unitPrice:100},'casual_labor',model); assert.equal(row.finalAmount,'550.00');
  assert.equal(W.recalculate({...row,manualAmount:true,finalAmount:'540'},'casual_labor',model).finalAmount,'540');
});
test('incomplete drafts preserved but strict actions fail', () => {
  const draft={id:'b',templateId:'t',templateKey:'casual_labor',period:'本期',rows:[{id:'r',name:'临时',bankCard:'123',quantity:'',finalAmount:''}],visualLayout:{}};
  const result=W.build(draft,null,template,[],model); assert.equal(result.workbenchDraft.ready,false); assert.equal(result.workbenchDraft.rows[0].bankCard,'123');
  assert.throws(()=>W.build(draft,null,template,[],model,{strict:true}),/实发金额/u);
});
test('valid draft permits no card and keeps stable id; manual amount needs reason', () => {
  const draft={id:'b',templateId:'t',templateKey:'casual_labor',period:'本期',rows:[{id:'r',name:'临时',bankCard:'',quantity:1,unitPrice:100,finalAmount:100}],visualLayout:{}};
  const result=W.build(draft,null,template,[],model,{strict:true}); assert.equal(result.items[0].bankCard,''); assert.equal(result.items[0].id,'r');
  draft.rows[0].finalAmount=90; assert.throws(()=>W.build(draft,null,template,[],model,{strict:true}),/调整原因/u);
  draft.rows[0].adjustmentReason='核对调整'; assert.equal(W.build(draft,null,template,[],model,{strict:true}).items[0].amountCents,9000);
});
test('pagination respects content height and count; oversized row blocks printing', () => {
  assert.deepEqual(W.paginate([10,10,15,10],25,10),[[0,1],[2,3]]);
  assert.deepEqual(W.paginate([10,10,10],100,2),[[0,1],[2]]);
  assert.throws(()=>W.paginate([101],100),/第 1 行/u);
});
test('printed columns can omit business fields without removing editor data', () => {
  const visualLayout = { editorColumns: [{ key:'name', label:'姓名' }, { key:'groupName', label:'组别' }, { key:'finalAmount', label:'金额', numeric:true }], printColumns: [{ key:'name', label:'收款人' }, { key:'finalAmount', label:'应发金额', numeric:true }], showPeriod:false };
  assert.deepEqual(W.printColumns(template, 'casual_labor', visualLayout).map((column) => column.label), ['收款人', '应发金额']);
  assert.deepEqual(W.columns(template, 'casual_labor', visualLayout).map((column) => column.key), ['name', 'groupName', 'finalAmount']);
  const draft = { id:'printing', templateId:'t', templateKey:'casual_labor', period:'7~9月', rows:[{ id:'r', name:'张三', groupName:'一组', finalAmount:'100', adjustmentReason:'人工核定' }], visualLayout };
  const saved = W.build(draft, null, template, [], model, { strict:true });
  assert.equal(saved.items[0].groupName, '一组');
  assert.equal(saved.visualLayout.showPeriod, false);
  assert.equal(saved.visualLayout.printColumns.length, 2);
});

test('top metadata fields can be renamed or removed without changing saved values', () => {
  const fields = [{ key:'period', label:'所属月份' }, { key:'custom:reason', label:'发放依据' }];
  assert.deepEqual(W.metadataFields({ metadataFields:fields }), fields);
  const draft = { id:'metadata', templateId:'t', templateKey:'casual_labor', period:'', batchDate:'2026-09-29',
    rows:[{ id:'r', name:'张三', finalAmount:'100', adjustmentReason:'人工核定' }], metadataValues:{ reason:'例行发放' },
    visualLayout:{ metadataFields:fields } };
  const saved = W.build(draft, null, template, [], model, { strict:true });
  assert.equal(saved.period, '');
  assert.deepEqual(saved.visualLayout.metadataFields, fields);
  assert.equal(saved.metadataValues.reason, '例行发放');
});
test('removing group from editor schema does not erase a saved recipient group', () => {
  const visualLayout = { editorColumns:[{key:'name',label:'姓名'},{key:'finalAmount',label:'实发金额',numeric:true}], printColumns:[{key:'name',label:'姓名'},{key:'finalAmount',label:'实发金额',numeric:true}] };
  assert.ok(!W.columns(template,'casual_labor',visualLayout).some((column) => column.key === 'groupName'));
  const saved = W.build({id:'no-group',templateId:'t',templateKey:'casual_labor',period:'7~9月',rows:[{id:'r',name:'张三',groupName:'东一组',finalAmount:'100',adjustmentReason:'人工核定'}],visualLayout},null,template,[],model,{strict:true});
  assert.equal(saved.items[0].groupName,'东一组');
});
test('one-page totals have a single 合计 row; multi-page totals show page and grand totals', () => {
  assert.deepEqual(W.totalLabels(1, 0), ['合计']);
  assert.deepEqual(W.totalLabels(3, 0), ['本页小计']);
  assert.deepEqual(W.totalLabels(3, 2), ['本页小计', '总合计']);
});
test('total amount stays under the amount column and recipient count stays out of remarks', () => {
  const printed = [{key:'_sequence'},{key:'name'},{key:'finalAmount'},{key:'remark'}];
  assert.deepEqual(W.totalCells(printed, '合计', '¥14700.00', 7), [
    {colspan:2,text:'合计（7人）'},
    {colspan:1,text:'¥14700.00'},
    {colspan:1,text:''},
  ]);
  assert.deepEqual(W.totalCells([{key:'remark'},{key:'finalAmount'}], '本页小计', '¥100.00', 1).at(-1), {colspan:1,text:'¥100.00'});
});
test('style allowlist and escaping reject CSS/HTML injection', () => {
  const css=W.cssStyle({font:"x';background:url(https://bad)",size:Infinity,align:'evil'});
  assert.ok(!css.includes('url')); assert.ok(!css.includes('Infinity')); assert.equal(W.esc('<script>'), '&lt;script&gt;');
});
test('template copy preserves workbench printing schema and settings', () => {
  const value=model.normalizeDisbursementTemplate({...template,workbenchKind:'casual_labor',visualLayout:{table:{size:12}},workbenchPrintSettings:{paper:'A4',orientation:'landscape'}});
  assert.equal(value.workbenchKind,'casual_labor'); assert.equal(value.visualLayout.table.size,12); assert.equal(value.workbenchPrintSettings.orientation,'landscape');
});
test('copied batch drops original draft identity and remaps cell layout', () => {
  const original={id:'b',status:'completed',items:[{id:'r',name:'临时',amountCents:100}],workbenchDraft:{id:'b',ready:true},visualLayout:{heights:{r:12},cells:{'r:name':{bold:true}}}};
  const next=model.copyDisbursementBatch(original,[],{id:'copy'});
  assert.equal(next.workbenchDraft,undefined);assert.equal(next.visualLayout.heights['copy-item-1'],12);assert.equal(next.visualLayout.cells['copy-item-1:name'].bold,true);
  assert.equal(original.id,'b');
});
test('incomplete drafts cannot be prepared, printed or completed through legacy actions', () => {
  const batch={status:'draft',items:[],workbenchDraft:{ready:false}};
  for(const fn of [model.prepareTemplateDisbursementBatch,model.markTemplateDisbursementPrinted,model.completeTemplateDisbursementBatch]) assert.throws(()=>fn(batch),/草稿尚未填写完整/u);
});
test('intermediate numeric input can be saved for correction without throwing', () => {
  assert.equal(W.recalculate({quantity:'.',unitPrice:100},'casual_labor',model).finalAmount,'');
});

test('bulk values calculate from custom fields without overwriting a manual amount', () => {
  const configured = {
    ...template,
    visualLayout: {
      editorColumns: [
        { key:'name', label:'姓名' },
        { key:'custom:population', label:'人口', numeric:true },
        { key:'unitPrice', label:'单价', numeric:true },
        { key:'finalAmount', label:'本期金额', numeric:true },
      ],
      calculation: { mode:'multiply', quantity:'custom:population', price:'unitPrice', deduction:'' },
    },
  };
  const rows = [
    { id:'r1', name:'甲', originalAmount:'100', customData:{ population:'13' }, unitPrice:'', finalAmount:'' },
    { id:'r2', name:'乙', originalAmount:'200', customData:{ population:'4' }, unitPrice:'100', finalAmount:'333', manualAmount:true, adjustmentReason:'人工核对' },
  ];
  const next = W.bulk(rows, { ids:['r1','r2'], key:'unitPrice', value:'130', onlyEmpty:false }, configured, model);
  assert.equal(next[0].finalAmount,'1690.00');
  assert.equal(next[1].finalAmount,'333');
  assert.equal(next[0].originalAmount,'100');
  assert.equal(rows[0].unitPrice,'');
  const saved = W.build({ id:'bulk', templateId:'t', templateKey:'casual_labor', period:'本期', rows:next, visualLayout:configured.visualLayout }, null, configured, [], model, { strict:true });
  assert.equal(saved.items[0].amountCents,169000);
  assert.equal(saved.items[1].amountCents,33300);
  assert.equal(saved.items[0].originalAmount,'100');
});

test('bulk filling only blanks keeps existing group values and rejects reference money', () => {
  const rows = [{ id:'a', name:'甲', groupName:'一组', customData:{} }, { id:'b', name:'乙', groupName:'', customData:{} }];
  const next = W.bulk(rows, { ids:['a','b'], key:'groupName', value:'二组', onlyEmpty:true }, { key:'casual_labor' }, model);
  assert.equal(next[0].groupName,'一组');
  assert.equal(next[1].groupName,'二组');
  const contractColumns = W.columns({ key:'contract_fee' }, 'contract_fee').map((column) => column.key);
  assert.equal(contractColumns.filter((key) => key === 'groupName').length, 1);
  assert.throws(() => W.bulk(rows, { ids:['a'], key:'originalAmount', value:'1' }, { key:'casual_labor' }, model), /原表金额/u);
});
