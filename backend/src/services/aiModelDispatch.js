'use strict';
const http=require('node:http'),https=require('node:https');
const db=require('../database');
const {decrypt}=require('../utils/crypto');
const {routeCandidates,selectModel}=require('./aiModelRouting');
const policy=require('./aiCreditPolicy');
const tasks=require('./aiCreditTasks');
const {PassThrough}=require('node:stream');
function usesDeepSeekV4(base,model){try{return new URL(base).hostname.toLowerCase()==='api.deepseek.com'&&/^deepseek-(?:v4-(?:flash|pro)|flash)$/iu.test(String(model));}catch{return false;}}
function endpoint(base){const u=new URL(base);u.pathname=u.pathname.replace(/\/+$/,'')+'/chat/completions';return u;}
function visibleText(value) {
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(part=>typeof part==='string'?part:part?.type==='text'||part?.type==='output_text'?visibleText(part.text):'').join('');
 return value&&typeof value.value==='string'?value.value:'';
}
function responseError(code,message){return Object.assign(new Error(message),{statusCode:502,code});}
function request(row,input) {
 return new Promise((resolve,reject)=>{const u=endpoint(row.base_url),model=selectModel({availableModels:JSON.parse(row.available_models||'[]'),defaultModel:row.default_model,supportsVision:row.supports_vision===1,visionModel:row.vision_model},input.model,input.taskTier,policy.imageCount(input.messages)?'vision-document-review':input.taskKind);
 const body={model,messages:input.messages,max_tokens:input.maxTokens,temperature:input.temperature??0.2,stream:!!input.onChunk};
 if(row.thinking_mode==='thinking'||usesDeepSeekV4(row.base_url,model))body.thinking={type:input.taskTier==='deep'?'enabled':'disabled'};
 if(row.thinking_mode==='reasoning_effort'&&input.taskTier==='deep')body.reasoning_effort='high';
 const bytes=JSON.stringify(body),req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+decrypt(row.api_key_encrypted),'Content-Length':Buffer.byteLength(bytes)},timeout:120000},res=>{
 res.setEncoding('utf8');let data='',buffer='',visible='',streamUsage={};
 function frame(text){for(const line of text.split('\n')){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')continue;let chunk;try{chunk=JSON.parse(raw);}catch{throw new Error('流式帧无法解析');}if(chunk.usage)streamUsage=chunk.usage;const delta=chunk.choices?.[0]?.delta;if(delta&&delta.content!==undefined){delta.content=visibleText(delta.content);visible+=delta.content;}input.onChunk?.(chunk);}}
 res.on('data',c=>{data+=c;if(data.length>16*1024*1024)return res.destroy(new Error('模型返回过大'));if(input.onChunk&&res.statusCode===200){buffer+=c;let i;try{while((i=buffer.indexOf('\n\n'))>=0){frame(buffer.slice(0,i));buffer=buffer.slice(i+2);}}catch{res.destroy(new Error('模型流式返回无效'));}}});res.on('error',()=>reject(Object.assign(new Error('模型响应中断'),{statusCode:502})));res.on('end',()=>{
 if(res.statusCode!==200)return reject(Object.assign(new Error(`模型接口返回 ${res.statusCode}`),{statusCode:502}));
 try{if(input.onChunk&&buffer.trim())frame(buffer);let json;try{json=input.onChunk?{model,choices:[{message:{content:visible}}],usage:streamUsage}:JSON.parse(data);}catch{throw responseError('AI_INVALID_RESPONSE','模型返回格式无法解析，请重试');}
 const choice=json.choices?.[0],content=visibleText(choice?.message?.content)||visibleText(choice?.text);
 if(!content.trim())throw responseError('AI_EMPTY_RESPONSE',choice?.finish_reason==='length'?'模型输出达到长度限制，未返回正文，请缩小识别批次后重试':'模型未返回可用正文，请重试或检查模型配置');
 if(content.includes('\uFFFD'))throw responseError('AI_CORRUPTED_RESPONSE','模型正文包含乱码，请重试；财务原始数据已保留');
 choice.message={...(choice.message||{}),content};resolve({json,model});}catch(error){return reject(error.statusCode?error:responseError('AI_INVALID_RESPONSE','模型返回格式无法解析，请重试'));}
 });});input.signal?.addEventListener('abort',()=>req.destroy(new Error('已取消请求')),{once:true});req.on('timeout',()=>req.destroy(new Error('模型请求超时')));req.on('error',()=>reject(Object.assign(new Error('模型网络连接失败'),{statusCode:502})));req.end(bytes);
 });
}
async function runChat(userId,owner,input={}) {
 const implicit=!input.billingTaskId;
 let task=implicit?tasks.start(userId,owner,input):tasks.owned(userId,input.billingTaskId);
 const id=task.id,requestId=input.requestId||db.genId();
 let step;try{step=tasks.beginStep(userId,id,requestId,input);}catch(e){if(implicit)tasks.finish(userId,id);throw e;}
 if(step.cached)return {stream:false,data:step.cached};
 let response;
 try{const candidates=routeCandidates(db.findAll('ai_providers'),{...input,maxTokens:step.maxTokens});let last;
 for(const row of candidates){try{response=await request(row,{...input,onChunk:policy.imageCount(input.messages)&&input.taskTier==='deep'&&!row.supports_deep?undefined:input.onChunk,maxTokens:step.maxTokens});response.row=row;break;}catch(e){last=e;if(input.started?.())break;}}
 if(!response)throw last;
 let {json,model,row}=response; let weight=step.weight,minimum=step.minimum;
 if(policy.imageCount(input.messages)&&input.taskTier==='deep'&&!row.supports_deep){
 const imageUsage=json.usage||{};const imageTokens=Number(imageUsage.total_tokens)||Number(imageUsage.prompt_tokens||0)+Number(imageUsage.completion_tokens||0)||policy.estimateTokens(input.messages,step.maxTokens);
 db.insert('ai_usage',{id:db.genId(),user_id:userId,main_account_id:owner,provider_id:row.id,model,total_tokens:imageTokens,prompt_tokens:Number(imageUsage.prompt_tokens)||0,completion_tokens:Number(imageUsage.completion_tokens)||0,status:'success',charged_credits:0,charged_tokens:0,task_id:id,request_id:requestId+'-vision',created_at:db.now()});
 tasks.completeStep(userId,id,requestId+'-vision',imageTokens,task.policy.imageWeight,json,!imageUsage.total_tokens,task.policy.imageMinimum);
 const analysisInput={...input,onChunk:input.onChunk,messages:[{role:'system',content:'根据提供的图片识别内容完成用户要求的深入分析；不要编造图片中未出现的信息。'},{role:'user',content:policy.textOf(input.messages)+'\n图片识别内容：\n'+String(json.choices[0].message.content)}]};
 try{const deepStep=tasks.beginStep(userId,id,requestId,analysisInput);let analyzed;for(const candidate of routeCandidates(db.findAll('ai_providers'),analysisInput)){try{analyzed=await request(candidate,{...analysisInput,maxTokens:deepStep.maxTokens});analyzed.row=candidate;break;}catch{if(input.started?.())break;}}if(!analyzed)throw new Error('深度模型暂不可用');({json,model,row}=analyzed);weight=deepStep.weight;minimum=deepStep.minimum;}catch(e){tasks.failStep(userId,id);tasks.completeStep(userId,id,requestId,0,0,json,false,1);const partial=implicit?tasks.finish(userId,id):{taskId:id,billingPending:true};json.communityAi={...partial,billingUnit:'credits',partial:true,warning:'图片识别已完成，深度分析未完成：'+e.message};return {stream:false,data:json};}
 }
 const usage=json.usage||{},reported=Number(usage.total_tokens)||Number(usage.prompt_tokens||0)+Number(usage.completion_tokens||0),estimated=!(Number.isSafeInteger(reported)&&reported>0);
 const tokens=estimated?policy.estimateTokens(input.messages,Math.ceil(Buffer.byteLength(String(json.choices?.[0]?.message?.content||''),'utf8')/3)):reported;
 tasks.completeStep(userId,id,requestId,tokens,weight,json,estimated,minimum);
 db.insert('ai_usage',{id:db.genId(),user_id:userId,main_account_id:owner,provider_id:row.id,model,total_tokens:tokens,prompt_tokens:Number(usage.prompt_tokens)||0,completion_tokens:Number(usage.completion_tokens)||0,status:'success',charged_credits:0,charged_tokens:0,task_id:id,request_id:requestId,created_at:db.now()});
 const billing=implicit?tasks.finish(userId,id):{taskId:id,actualTokens:tokens,chargedCredits:null,billingPending:true};
 json.communityAi={...billing,billingUnit:'credits',provider:row.name,model,taskTier:input.taskTier||'basic',actualTokens:billing.actualTokens??tokens,estimatedUsage:billing.estimatedUsage??estimated,routingReason:policy.imageCount(input.messages)?'图片理解':policy.textOf(input.messages).length>9000?'长内容自动分流':input.taskTier==='deep'?'深度分析':'默认文字模型'};
 return {stream:false,data:json};
 }catch(e){tasks.failStep(userId,id);if(implicit)tasks.finish(userId,id);throw e;}
}
function chat(userId,owner,input={}) {
 if(!input.stream)return runChat(userId,owner,input);
 const out=new PassThrough();let started=false;const controller=new AbortController();out.once('close',()=>{if(!out.writableFinished)controller.abort();});
 setImmediate(async()=>{try{const result=await runChat(userId,owner,{...input,stream:false,signal:controller.signal,onChunk:chunk=>{started=true;out.write(`data: ${JSON.stringify(chunk)}\n\n`);},started:()=>started});if(!started)out.write(`data: ${JSON.stringify({choices:[{delta:{content:result.data.choices[0].message.content}}]})}\n\n`);out.end(`data: ${JSON.stringify({choices:[],communityAi:result.data.communityAi})}\n\ndata: [DONE]\n\n`);}catch(e){out.end(`data: ${JSON.stringify({error:e.message,code:e.code||'AI_STREAM_FAILED'})}\n\ndata: [DONE]\n\n`);}});
 return Promise.resolve({stream:true,statusCode:200,responseStream:out});
}
module.exports={chat,request,usesDeepSeekV4};
