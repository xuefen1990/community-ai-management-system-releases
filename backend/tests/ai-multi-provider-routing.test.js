'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeCandidates,routingOptions}=require('../src/services/aiModelRouting');
const providers=[{id:'text',is_active:1,default_text:true,available_models:'["chat"]',default_model:'chat',context_tokens:10000},{id:'image',is_active:1,supports_vision:1,vision_model:'vision',available_models:'["vision"]',context_tokens:50000},{id:'long',is_active:1,supports_long:true,supports_deep:true,available_models:'["thinking"]',context_tokens:100000}];
test('text, image, long text and thinking select compatible providers',()=>{
 assert.equal(routeCandidates(providers,{messages:[{content:'hello'}],maxTokens:100})[0].id,'text');
 assert.equal(routeCandidates(providers,{messages:[{content:[{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]}]})[0].id,'image');
 assert.equal(routeCandidates(providers,{messages:[{content:'字'.repeat(15000)}]})[0].id,'long');
 assert.equal(routeCandidates(providers,{messages:[{content:'分析'}],taskTier:'deep'})[0].id,'long');
});
test('no compatible model must not silently send images to text; invalid capacity fails',()=>{
 assert.throws(()=>routeCandidates([providers[0]],{messages:[{content:[{type:'image_url'}]}]}),/图片/);
 assert.throws(()=>routingOptions({contextTokens:1}),/容量/);assert.throws(()=>routingOptions({thinkingMode:'arbitrary'}),/思考/);
});
