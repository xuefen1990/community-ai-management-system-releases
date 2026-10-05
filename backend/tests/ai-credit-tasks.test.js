'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-credit-test-'));
process.env.DB_PATH=path.join(root,'db.json');process.env.ADMIN_PASSWORD='test-only-long-password';process.env.AI_CREDITS_ENABLED='1';
const db=require('../src/database'),q=require('../src/services/aiQuotaService'),tasks=require('../src/services/aiCreditTasks'),p=require('../src/services/aiCreditPolicy');
const owner=db.findAll('users')[0].id;
const text={messages:[{role:'user',content:'你好'}],maxTokens:1200};
test('migration preserves fractional balances and historical records without repeated migration',()=>{
 q.getQuotaSummary(owner);q.adjustQuota(owner,1,{event:'adjustment'});const before=q.getQuotaSummary(owner);tasks.migrate(owner);tasks.migrate(owner);
 assert.equal(q.getQuotaSummary(owner).remainingCredits,before.remainingTokens/2000);assert.equal(db.findAll('ai_quota_ledger',r=>r.event==='migration').length,1);assert.ok(fs.existsSync(process.env.DB_PATH+'.before-credits'));
});
test('one operation settles multiple calls once and repeated finish does not charge again',()=>{
 const before=q.getQuotaSummary(owner).remainingCredits;const t=tasks.start(owner,owner,{...text,approvedMaxCredits:3});
 for(const id of ['one','two']){const step=tasks.beginStep(owner,t.id,id,text);tasks.completeStep(owner,t.id,id,100,step.weight,{choices:[{message:{content:'完成'}}]});}
 const done=tasks.finish(owner,t.id);assert.equal(done.chargedCredits,1);assert.deepEqual(tasks.finish(owner,t.id),done);assert.equal(q.getQuotaSummary(owner).remainingCredits,before-1);
 assert.ok(tasks.beginStep(owner,t.id,'one',text).cached);
});
test('image and thinking minimums, cap validation, ownership and cancellation',()=>{
 assert.equal(p.credits(10,2),2);assert.equal(p.workload({...text,taskTier:'deep'}).minimum,3);
 assert.throws(()=>tasks.start(owner,owner,{...text,approvedMaxCredits:5}),/确认/);
 const t=tasks.start(owner,owner,{...text,approvedMaxCredits:3});assert.throws(()=>tasks.beginStep('other',t.id,'x',text),/不存在/);
 assert.equal(tasks.finish(owner,t.id).chargedCredits,0);
});
test('busy requests cannot double reserve; cap extension needs confirmation; failed calls cost zero',()=>{
 const t=tasks.start(owner,owner,{...text,approvedMaxCredits:3});tasks.beginStep(owner,t.id,'x',text);assert.throws(()=>tasks.beginStep(owner,t.id,'y',text),/正在执行/);tasks.failStep(owner,t.id);
 assert.throws(()=>tasks.extend(owner,t.id,6,false),/确认/);tasks.extend(owner,t.id,6,true);assert.equal(tasks.finish(owner,t.id).chargedCredits,0);
});
test('large operation uses weighted token total and locked policy, without extra charge above approval',()=>{
 const t=tasks.start(owner,owner,{...text,approvedMaxCredits:6,usageConfirmed:true});const step=tasks.beginStep(owner,t.id,'x',text);tasks.completeStep(owner,t.id,'x',11000,step.weight,{});
 tasks.updateRates({tokensPerCredit:1000});assert.equal(tasks.finish(owner,t.id).chargedCredits,6);tasks.updateRates({tokensPerCredit:2000});
});
test('policy excludes base64 bytes from token estimates; disabled production mode refuses tasks',()=>{
 const a=p.estimateTokens([{content:[{type:'image_url',image_url:{url:'data:image/png;base64,aaaa'}}]}],100);
 const b=p.estimateTokens([{content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'a'.repeat(10000)}}]}],100);assert.equal(a,b);
 process.env.AI_CREDITS_ENABLED='0';assert.throws(()=>tasks.start(owner,owner,text),/尚未正式启用/);process.env.AI_CREDITS_ENABLED='1';
});
