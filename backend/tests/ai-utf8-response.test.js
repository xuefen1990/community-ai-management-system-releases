'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

function service(baseUrl) {
  const provider = { id:'fixture',is_active:1,base_url:baseUrl,api_key_encrypted:'test-only',default_model:'fixture',available_models:'["fixture"]' };
  const db = { findOne:()=>provider,findById:()=>null,insert:()=>{},genId:()=> 'request-test',now:()=>new Date().toISOString() };
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/aiService'),'utf8'),{module,exports:module.exports,Buffer,setTimeout,clearTimeout,require:name=>{
    if(name==='../database')return db;
    if(name==='../utils/crypto')return {encrypt:v=>v,decrypt:v=>v};
    if(name==='../utils/logger')return {error:()=>{}};
    if(name==='./aiQuotaService')return {};
    if(name==='./mainAccountScope')return {requireMainAccountId:()=>null};
    if(name==='./aiModelRouting')return require('../src/services/aiModelRouting');
    return require(name);
  }});
  return module.exports;
}

test('AI responses preserve Chinese, punctuation and emoji across every byte boundary in chat and provider checks',async t=>{
  const expected='兹证明：居民信息属实。拆除劳务收入、会议保障经费收入、泵房改造工程费。✅';
  const payload=JSON.stringify({choices:[{message:{content:expected}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  const bytes=Buffer.from(payload);
  // Reproduces the old coercion bug even though JSON itself remains parseable.
  assert.notEqual(JSON.parse([...bytes].map(b=>Buffer.from([b]).toString()).join('')).choices[0].message.content,expected);
  const server=http.createServer(async(req,res)=>{
    for await(const ignored of req){}
    res.setHeader('Content-Type','application/json; charset=utf-8');res.flushHeaders();
    for(const byte of bytes){res.write(Buffer.from([byte]));await delay(1);}
    res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const ai=service(`http://127.0.0.1:${server.address().port}`);
  const response=await ai.chat('test-user',{messages:[{role:'user',content:'脱敏测试'}],maxTokens:100});
  assert.equal(response.data.choices[0].message.content,expected);
  const checked=await ai.testProviderConnection({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test-only',defaultModel:'fixture'});
  assert.equal(checked.reply,expected);
});
