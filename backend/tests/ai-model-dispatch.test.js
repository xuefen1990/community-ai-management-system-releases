'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-test-')),'db');process.env.ADMIN_PASSWORD='test-only-password';process.env.AI_CREDITS_ENABLED='1';
const db=require('../src/database'),ai=require('../src/services/aiService'),dispatch=require('../src/services/aiModelDispatch'),q=require('../src/services/aiQuotaService');
test('real HTTP fallback preserves Chinese and bills a logical request only once',async t=>{
 const bodies=[];const server=http.createServer((req,res)=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{const b=JSON.parse(text);bodies.push(b);if(req.url.startsWith('/fail')){res.writeHead(503);res.end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:b.model,choices:[{message:{content:'中文报告完成 ✅'}}],usage:{total_tokens:100}}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 ai.createProvider({name:'失败模型',baseUrl:base+'/fail',apiKey:'test-only',defaultModel:'chat',availableModels:['chat'],defaultText:true,contextTokens:20000});
 ai.createProvider({name:'候选模型',baseUrl:base+'/ok',apiKey:'test-only',defaultModel:'chat',availableModels:['chat'],contextTokens:20000});
 const owner=db.findAll('users')[0].id;q.ensureOrganizationQuota(owner);const before=q.getQuotaSummary(owner).remainingCredits,input={messages:[{role:'user',content:'写一段报告'}],maxTokens:1000,approvedMaxCredits:3,requestId:'same-request'};
 const response=await dispatch.chat(owner,owner,input);assert.equal(response.data.choices[0].message.content,'中文报告完成 ✅');assert.equal(response.data.communityAi.chargedCredits,1);assert.equal(bodies.length,2);
 const again=await dispatch.chat(owner,owner,input);assert.equal(again.data.communityAi.chargedCredits,1);assert.equal(bodies.length,2);assert.equal(q.getQuotaSummary(owner).remainingCredits,before-1);
 assert.equal(ai.listProviders().some(p=>'apiKey' in p),false);
});

test('stream frames preserve split Chinese and settle reported usage before DONE',async t=>{
 const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{res.setHeader('Content-Type','text/event-stream');const bytes=Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:'图片结果 中文'}}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{total_tokens:100}})+'\n\ndata: [DONE]\n\n');let i=0;const timer=setInterval(()=>{if(i===bytes.length){clearInterval(timer);res.end();}else res.write(bytes.subarray(i,++i));},1);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 for(const row of db.findAll('ai_providers'))db.updateById('ai_providers',row.id,{is_active:0});
 ai.createProvider({name:'流式测试',baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test-only',defaultModel:'chat',availableModels:['chat'],contextTokens:20000});
 const owner=db.findAll('users')[0].id;const response=await dispatch.chat(owner,owner,{messages:[{role:'user',content:'测试'}],maxTokens:1000,approvedMaxCredits:3,stream:true});let output='';response.responseStream.on('data',c=>output+=c);await new Promise((r,j)=>{response.responseStream.on('end',r);response.responseStream.on('error',j);});
 assert.match(output,/图片结果 中文/);assert.match(output,/"chargedCredits":1/);assert.match(output,/\[DONE\]/);assert.equal(output.indexOf('chargedCredits')<output.indexOf('[DONE]'),true);
});

test('image plus deep thinking uses two compatible stages and one minimum charge',async t=>{
 const seen=[];const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const b=JSON.parse(raw);seen.push(b);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:b.model==='vision'?'识别材料':'深入分析'}}],usage:{total_tokens:100}}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());for(const row of db.findAll('ai_providers'))db.updateById('ai_providers',row.id,{is_active:0});
 const base='http://127.0.0.1:'+server.address().port;
 ai.createProvider({name:'图片',baseUrl:base,apiKey:'test-only',defaultModel:'vision',availableModels:['vision'],supportsVision:true,visionModel:'vision',contextTokens:20000});
 ai.createProvider({name:'思考',baseUrl:base,apiKey:'test-only',defaultModel:'thinking',availableModels:['thinking'],supportsDeep:true,thinkingMode:'reasoning_effort',contextTokens:20000});
 const owner=db.findAll('users')[0].id;const result=await dispatch.chat(owner,owner,{messages:[{role:'user',content:[{type:'text',text:'深入分析图片'},{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]}],taskTier:'deep',approvedMaxCredits:3,maxTokens:500});
 assert.deepEqual(seen.map(b=>b.model),['vision','thinking']);assert.equal(seen[1].reasoning_effort,'high');assert.equal(seen[1].messages.some(m=>Array.isArray(m.content)),false);
 assert.equal(result.data.communityAi.chargedCredits,3);assert.equal(result.data.communityAi.actualTokens,200);assert.equal(result.data.choices[0].message.content,'深入分析');
});

test('stream cancellation aborts provider and releases unused reservation',async t=>{
 let started;const ready=new Promise(r=>started=r);const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('Content-Type','text/event-stream');res.flushHeaders();started();});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());for(const row of db.findAll('ai_providers'))db.updateById('ai_providers',row.id,{is_active:0});
 ai.createProvider({name:'取消',baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test-only',defaultModel:'chat',availableModels:['chat'],contextTokens:20000});
 const owner=db.findAll('users')[0].id;const before=q.getQuotaSummary(owner).remainingCredits;
 const result=await dispatch.chat(owner,owner,{messages:[{content:'取消测试'}],approvedMaxCredits:3,maxTokens:300,requestId:'cancel-stream',stream:true});result.responseStream.resume();await ready;result.responseStream.destroy();
 for(let i=0;i<30&&db.findOne('ai_credit_tasks',r=>r.clientRequestId==='cancel-stream')?.status==='running';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(db.findOne('ai_credit_tasks',r=>r.clientRequestId==='cancel-stream').status,'cancelled');assert.equal(q.getQuotaSummary(owner).remainingCredits,before);assert.equal(q.getQuotaSummary(owner).reservedCredits,0);
});

test('compatible visible content formats normalize; reasoning-only replies report a precise recoverable error',async t=>{
 let reply={choices:[{message:{content:[{type:'text',text:'中文'},{type:'text',text:'科目结果'}]}}]};
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const row={base_url:'http://127.0.0.1:'+server.address().port,available_models:'["chat"]',default_model:'chat',api_key_encrypted:require('../src/utils/crypto').encrypt('test-only')};const input={messages:[{role:'user',content:'测试'}],maxTokens:1000};
 assert.equal((await dispatch.request(row,input)).json.choices[0].message.content,'中文科目结果');
 reply={choices:[{text:'旧格式正文'}]};assert.equal((await dispatch.request(row,input)).json.choices[0].message.content,'旧格式正文');
 reply={choices:[{message:{content:'',reasoning_content:'不是正文'},finish_reason:'length'}]};await assert.rejects(dispatch.request(row,input),e=>e.code==='AI_EMPTY_RESPONSE'&&/长度限制/u.test(e.message));
 reply={choices:[{message:{content:'损坏\uFFFD文字'}}]};await assert.rejects(dispatch.request(row,input),e=>e.code==='AI_CORRUPTED_RESPONSE');
});


test('DeepSeek V4 default thinking is detected only for its official model endpoint',()=>{
 assert.equal(dispatch.usesDeepSeekV4('https://api.deepseek.com/v1','deepseek-v4-flash'),true);
 assert.equal(dispatch.usesDeepSeekV4('https://api.deepseek.com','deepseek-v4-pro'),true);
 assert.equal(dispatch.usesDeepSeekV4('https://api.deepseek.com','deepseek-flash'),true);
 assert.equal(dispatch.usesDeepSeekV4('https://api.deepseek.com','deepseek-chat'),false);
 assert.equal(dispatch.usesDeepSeekV4('https://another.example','deepseek-v4-flash'),false);
});
