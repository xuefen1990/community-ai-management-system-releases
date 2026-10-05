'use strict';
const db = require('../database');
const quota = require('./aiQuotaService');
const policy = require('./aiCreditPolicy');
const fs = require('node:fs');
const config = require('../config');
const {encrypt,decrypt}=require('../utils/crypto');
function durable(work){return db.atomic(()=>{const value=work();db.flushNow();return value;});}
const fail = (code,message,statusCode=409) => Object.assign(new Error(message),{code,statusCode});
function requireEnabled() { if (!policy.enabled()) throw fail('AI_CREDITS_DISABLED','积分计费尚未正式启用',503); }
function rates() { return {...policy.DEFAULT,...(db.findOne('ai_quota_settings',r=>r.key==='creditPolicy')?.value || {})}; }
function updateRates(next) {
 const p={...rates()};for(const k of Object.keys(policy.DEFAULT))if(k in next)p[k]=Number(next[k]);
 for(const k of Object.keys(policy.DEFAULT)) if(!Number.isFinite(p[k]) || p[k]<=0 || (k.includes('Minimum')||k==='tokensPerCredit')&&!Number.isSafeInteger(p[k])) throw fail('INVALID_CREDIT_POLICY','积分规则须为有效正数',400);
 const row=db.findOne('ai_quota_settings',r=>r.key==='creditPolicy');
 if(row)db.updateById('ai_quota_settings',row.id,{value:p,updated_at:db.now()});else db.insert('ai_quota_settings',{id:db.genId(),key:'creditPolicy',value:p,created_at:db.now()});return p;
}
function owned(userId,id) { const task=db.findById('ai_credit_tasks',id); if(!task||task.userId!==userId)throw fail('AI_TASK_NOT_FOUND','积分任务不存在',404);return task; }
function migrate(owner) {
 requireEnabled(); const row=db.findOne('ai_quotas',r=>r.main_account_id===owner);if(!row||row.credit_migrated_at)return;
 if(row.reserved_tokens)throw fail('AI_MIGRATION_BUSY','已有 AI 请求正在运行，请稍后重试');
 db.flushNow(); const backup=config.dbPath+'.before-credits';if(!fs.existsSync(backup))fs.copyFileSync(config.dbPath,backup);
 durable(()=>{db.updateById('ai_quotas',row.id,{credit_migrated_at:db.now(),credit_scale:policy.SCALE});db.insert('ai_quota_ledger',{id:db.genId(),main_account_id:owner,event:'migration',event_label:'积分迁移',tokens:0,delta_tokens:0,balance_after:row.granted_tokens-row.used_tokens,metadata:JSON.stringify({billingMode:'credits',scale:policy.SCALE,originalGrantedTokens:row.granted_tokens,originalUsedTokens:row.used_tokens}),created_at:db.now()});});
}
function estimate(input) { const p=rates(),w=policy.workload(input,p),tokens=policy.estimateTokens(input.messages,input.maxTokens);return {estimatedTokens:tokens,estimatedCredits:policy.credits(tokens*w.weight,w.minimum,p),minimumCredits:w.minimum,creditPolicy:p}; }
function sweep() { for(const t of db.findAll('ai_credit_tasks',t=>t.status==='running'&&Date.now()-Date.parse(t.updatedAt)>15*60*1000)){db.updateById('ai_credit_tasks',t.id,{busy:false});finish(t.userId,t.id);} }
function start(userId,owner,input={}) {
 requireEnabled();if(input.requestId){const existing=db.findOne('ai_credit_tasks',t=>t.userId===userId&&t.clientRequestId===input.requestId);if(existing)return existing;}
 requireEnabled();sweep();quota.ensureOrganizationQuota(owner);migrate(owner);
 const e=estimate(input),cap=Number(input.approvedMaxCredits ?? e.estimatedCredits);
 if(!Number.isSafeInteger(cap)||cap<e.minimumCredits)throw fail('AI_CREDIT_CAP_INVALID','积分上限低于该任务最低消耗',400);
 if(cap>3&&input.usageConfirmed!==true)throw Object.assign(fail('AI_CREDIT_CONFIRMATION_REQUIRED',`预计消耗 ${e.estimatedCredits} 积分，请先确认上限`,428),{details:e});
 const id=db.genId();return durable(()=>{quota.reserve(owner,cap*policy.SCALE,{userId,requestId:id,metadata:{billingMode:'credits'}});return db.insert('ai_credit_tasks',{id,userId,owner,status:'running',clientRequestId:input.requestId||'',cap,policy:e.creditPolicy,minimum:1,weightedTokens:0,actualTokens:0,steps:[],busy:false,createdAt:db.now(),updatedAt:db.now()});});
}
function beginStep(userId,id,requestId,input) {
 const t=owned(userId,id);const done=t.steps.find(s=>s.requestId===requestId);if(done?.response)return {task:t,cached:{...(done.encrypted?JSON.parse(decrypt(done.response)):done.response),...(t.result?{communityAi:{...t.result,billingUnit:"credits"}}:{})}};
 if(t.status!=='running')throw fail('AI_TASK_FINISHED','任务已结算');
 if(t.busy)throw fail('AI_TASK_BUSY','该积分任务有请求正在执行，请稍后重试');
 const w=policy.workload(input,t.policy),prompt=policy.estimateTokens(input.messages,16)-16;
 const budget=Math.floor((t.cap*t.policy.tokensPerCredit-t.weightedTokens)/w.weight)-prompt;
 if(budget<16 || w.minimum>t.cap)throw Object.assign(fail('AI_CREDIT_CAP_REACHED','已达到确认的积分上限，请重新确认'),{details:{estimatedCredits:Math.max(w.minimum,policy.credits(t.weightedTokens+policy.estimateTokens(input.messages,input.maxTokens)*w.weight,w.minimum,t.policy)),taskId:id}});
 db.updateById('ai_credit_tasks',id,{busy:true,updatedAt:db.now()});
 return {task:t,weight:w.weight,minimum:w.minimum,maxTokens:Math.min(Number(input.maxTokens)||1200,budget)};
}
function completeStep(userId,id,requestId,tokens,weight,response,estimated=false,minimum=1) {
 const t=owned(userId,id);durable(()=>db.updateById('ai_credit_tasks',id,{busy:false,minimum:Math.max(t.minimum,minimum),weightedTokens:t.weightedTokens+tokens*weight,actualTokens:t.actualTokens+tokens,steps:[...t.steps,{requestId,tokens,weight,estimated,response:encrypt(JSON.stringify(response)),encrypted:true}],updatedAt:db.now()}));
}
function failStep(userId,id) { owned(userId,id);db.updateById('ai_credit_tasks',id,{busy:false,updatedAt:db.now()}); }
function finish(userId,id) {
 requireEnabled();const t=owned(userId,id);if(t.status!=='running')return t.result;
 if(t.busy)throw fail('AI_TASK_BUSY','请求仍在执行，暂不能结算');
 return durable(()=>{const charged=t.steps.length?Math.min(t.cap,policy.credits(t.weightedTokens,t.minimum,t.policy)):0;
 const q=charged?quota.settle(t.owner,t.cap*policy.SCALE,charged*policy.SCALE,{userId,requestId:id,metadata:{billingMode:'credits',actualTokens:t.actualTokens,taskId:id}}):quota.release(t.owner,t.cap*policy.SCALE,{userId,requestId:id,metadata:{billingMode:'credits',taskId:id}});
 const result={taskId:id,chargedCredits:charged,actualTokens:t.actualTokens,remainingCredits:q.remainingTokens/policy.SCALE,estimatedUsage:t.steps.some(s=>s.estimated),status:t.steps.length?'completed':'cancelled'};
 const usage=db.findOne('ai_usage',r=>r.task_id===id);if(usage)db.updateById('ai_usage',usage.id,{charged_credits:charged,charged_tokens:charged*policy.SCALE});
 db.updateById('ai_credit_tasks',id,{status:result.status,result,updatedAt:db.now(),steps:t.steps});return result;});
}
function extend(userId,id,cap,confirmed) { const t=owned(userId,id); if(t.status!=='running'||t.busy)throw fail('AI_TASK_BUSY','任务暂不能增加上限'); if(!Number.isSafeInteger(cap)||cap<=t.cap)throw fail('AI_CREDIT_CAP_INVALID','新上限必须大于原上限',400);if(cap>3&&confirmed!==true)throw fail('AI_CREDIT_CONFIRMATION_REQUIRED','增加积分上限须确认',428);return durable(()=>{quota.reserve(t.owner,(cap-t.cap)*policy.SCALE,{userId,requestId:id,metadata:{billingMode:'credits'}});return db.updateById('ai_credit_tasks',id,{cap,updatedAt:db.now()});});}
const cleanup=setInterval(()=>{if(policy.enabled())try{sweep();}catch{}},60000);cleanup.unref();
module.exports={extend,rates,updateRates,migrate,estimate,start,beginStep,completeStep,failStep,finish,owned};
