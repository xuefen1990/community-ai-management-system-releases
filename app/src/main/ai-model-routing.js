'use strict';

function text(value) { return String(value ?? '').trim(); }

const DEEP_TASK_KINDS = new Set([
  'cross-module-analysis', 'multi-file-review', 'certificate-draft',
  'document-draft', 'document-rewrite', 'long-form-generation',
]);

function classifyAiTask({ messages = [], taskKind = '', requestedTier = '' } = {}) {
  if (['basic', 'deep'].includes(requestedTier)) return requestedTier;
  if (DEEP_TASK_KINDS.has(text(taskKind))) return 'deep';
  const content = (Array.isArray(messages) ? messages : []).map(item => text(item?.content)).join('\n');
  const crossModule = /(跨模块|综合分析|对比|核对).{0,30}(居民|土地|合同|资金|证明|公文)|(居民|土地|合同|资金|证明|公文).{0,30}(同时|以及|并且).{0,30}(居民|土地|合同|资金|证明|公文)/u.test(content);
  const longForm = /(起草|拟写|重写|润色|生成).{0,20}(公文|报告|证明|总结|方案|材料)/u.test(content);
  const multiStep = /(分步骤|逐项|全面|深入|详细分析|多份文件|多个文件)/u.test(content);
  return crossModule || longForm || multiStep || content.length > 9000 ? 'deep' : 'basic';
}

module.exports = { classifyAiTask, DEEP_TASK_KINDS };
