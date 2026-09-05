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
test('switching person clears old identifying and bank data including resident custom fields', () => {
  const t = {...template, columns:[{label:'手机',source:'resident',residentField:'phone'}]};
  const row = W.unlink({personId:'p1',name:'张三',bankCard:'old',phone:'old',customData:{手机:'old',事项:'保留'}},t);
  assert.equal(row.bankCard,''); assert.equal(row.personId,''); assert.equal(row.customData.手机,''); assert.equal(row.customData.事项,'保留');
  const linked = W.link(row,people[1],t,model); assert.equal(linked.bankCard,''); assert.equal(linked.personId,'p2');
});
test('labor reuse drops work data; salary requires new months; rent requires rate', () => {
  const batch = {items:[{name:'临时',workDate:'旧日期',workItem:'旧事项',quantity:5,unitPriceCents:10000,amountCents:50000,bankCard:'abc',remark:'旧备注'}]};
  const labor = W.reuse(batch,template,[],model)[0]; assert.equal(labor.workDate,''); assert.equal(labor.workItem,''); assert.equal(labor.quantity,''); assert.equal(labor.finalAmount,''); assert.equal(labor.unitPrice,'100.00');
  const salary = W.reuse(batch,{key:'position_salary'},[],model)[0]; assert.equal(salary.quantity,'');
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
