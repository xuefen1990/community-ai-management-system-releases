'use strict';

function normalizeTaskTier(value) {
  return value === 'deep' ? 'deep' : 'basic';
}

function selectModel(provider, requestedModel, taskTier = 'basic', taskKind = '') {
  const available = [...new Set([...(provider?.availableModels || []), provider?.defaultModel].filter(Boolean))];
  if (taskKind === 'vision-document-review') {
    if (!provider?.supportsVision) {
      const error = new Error('当前模型服务未启用图片理解能力');
      error.statusCode = 400;
      throw error;
    }
    const visionModel = String(provider?.visionModel || '').trim();
    if (!visionModel) {
      const error = new Error('请先在模型服务中填写视觉模型名称');
      error.statusCode = 400;
      throw error;
    }
    return visionModel;
  }
  if (requestedModel && available.includes(requestedModel)) return requestedModel;
  if (normalizeTaskTier(taskTier) === 'deep') {
    const deepModel = available.find(name => /(reasoner|reasoning|deepseek-r1|\br1\b|pro|thinking)/iu.test(String(name)));
    if (deepModel) return deepModel;
  }
  const basicModel = available.find(name => /(chat|flash|lite|mini|turbo)/iu.test(String(name)));
  return basicModel || provider?.defaultModel || available[0] || '';
}

module.exports = { normalizeTaskTier, selectModel };

const creditPolicy = require('./aiCreditPolicy');
function providerOptions(row) {
 const available = JSON.parse(row.available_models || '[]');
 return { supportsText: row.supports_text !== false, supportsDeep: row.supports_deep === true || available.some(m=>/reasoner|reasoning|thinking|\bpro\b|deepseek-r1/i.test(m)), supportsLong: row.supports_long === true,
 contextTokens: Number(row.context_tokens)||0, priority: Number(row.priority)||0, thinkingMode: row.thinking_mode||'none', defaultText: row.default_text===true };
}
function routingOptions(input) {
 const patch={};for(const [key,field] of Object.entries({supportsText:'supports_text',supportsDeep:'supports_deep',supportsLong:'supports_long',defaultText:'default_text'}))if(key in input)patch[field]=input[key]===true;
 if('contextTokens' in input){if(!Number.isSafeInteger(Number(input.contextTokens))||Number(input.contextTokens)<128)throw Object.assign(new Error('上下文容量须为至少 128 的整数'),{statusCode:400});patch.context_tokens=Number(input.contextTokens);}
 if('priority' in input){if(!Number.isSafeInteger(Number(input.priority))||Math.abs(Number(input.priority))>1000)throw Object.assign(new Error('优先级须为 -1000 至 1000 的整数'),{statusCode:400});patch.priority=Number(input.priority);}
 if('thinkingMode' in input){if(!['none','thinking','reasoning_effort'].includes(input.thinkingMode))throw Object.assign(new Error('不支持的思考参数'),{statusCode:400});patch.thinking_mode=input.thinkingMode;}
 return patch;
}
function routeCandidates(rows,input={}) {
 const images=creditPolicy.imageCount(input.messages)>0||input.taskKind==='vision-document-review',deep=input.taskTier==='deep';
 const required=creditPolicy.estimateTokens(input.messages,input.maxTokens),long=creditPolicy.textOf(input.messages).length>9000;
 let candidates=rows.filter(r=>r.is_active===1).map(r=>({...r,...providerOptions(r)})).filter(r=>(images?r.supports_vision===1&&r.vision_model:r.supportsText)&&(!r.contextTokens||required<=r.contextTokens));
 if(creditPolicy.enabled()&&deep&&!images)candidates=candidates.filter(r=>r.supportsDeep);
 candidates.sort((a,b)=>Number(b.supportsDeep&&deep)-Number(a.supportsDeep&&deep)||Number(b.supportsLong&&long)-Number(a.supportsLong&&long)||Number(b.defaultText&&!images)-Number(a.defaultText&&!images)||b.priority-a.priority);
 if(!candidates.length)throw Object.assign(new Error(images?'没有可处理图片及当前输入容量的模型，请配置图片模型':'没有可容纳当前内容的文字模型，请配置长文本模型'),{statusCode:503});
 return candidates;
}
module.exports.providerOptions=providerOptions;
module.exports.routingOptions=routingOptions;
module.exports.routeCandidates=routeCandidates;
