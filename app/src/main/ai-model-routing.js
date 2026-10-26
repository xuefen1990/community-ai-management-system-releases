'use strict';

function text(value) { return String(value ?? '').trim(); }

const DEEP_TASK_KINDS = new Set(['cross-module-analysis', 'multi-file-review']);
const WRITING_TASK_KINDS = new Set(['certificate-draft', 'document-draft', 'document-rewrite', 'long-form-generation']);

function requestedText(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  const userMessages = items.filter(item => item?.role === 'user');
  return (userMessages.length ? userMessages : items).map(item => Array.isArray(item?.content)
    ? item.content.filter(part => part?.type === 'text').map(part => text(part.text)).join('\n')
    : text(item?.content)).join('\n');
}

function isWritingTask({ messages = [], taskKind = '' } = {}) {
  return WRITING_TASK_KINDS.has(text(taskKind))
    || /(?:起草|拟写|撰写|写|重写|润色|生成).{0,30}(?:公文|报告|证明|总结|方案|材料|通知|合同|协议)/u.test(requestedText(messages));
}

function classifyAiTask({ messages = [], taskKind = '', requestedTier = '' } = {}) {
  if (['basic', 'deep'].includes(requestedTier)) return requestedTier;
  if (DEEP_TASK_KINDS.has(text(taskKind))) return 'deep';
  const content = requestedText(messages);
  const crossModule = /(跨模块|综合分析|对比|核对).{0,30}(居民|土地|合同|资金|证明|公文)|(居民|土地|合同|资金|证明|公文).{0,30}(同时|以及|并且).{0,30}(居民|土地|合同|资金|证明|公文)/u.test(content);
  const analysis = /深度(?:分析|思考|研究)|深入(?:分析|思考|研究)|详细分析|综合分析|多份文件|多个文件|逐项核对|分步骤(?:分析|推理)/u.test(content);
  const contract = isWritingTask({ messages, taskKind }) && /(合同|协议|甲方|乙方)/u.test(content);
  return crossModule || analysis || contract || content.length > 9000 ? 'deep' : 'basic';
}

function classifyWritingTask({ instructions = '', documentKind = '', referenceCount = 0 } = {}) {
  if (documentKind === 'contract' || referenceCount > 1) return 'deep';
  return classifyAiTask({ messages: [{ role: 'user', content: instructions }], taskKind: 'document-draft' });
}

function defaultAiMaxTokens({ messages = [], taskKind = '', taskTier = 'basic' } = {}) {
  if (taskKind === 'certificate-draft') return 2400;
  // Fast writing must keep the original drafting budget, rather than the short-chat budget.
  return taskTier === 'deep' || isWritingTask({ messages, taskKind }) ? 4096 : 1200;
}

module.exports = { classifyAiTask, classifyWritingTask, defaultAiMaxTokens, DEEP_TASK_KINDS };
