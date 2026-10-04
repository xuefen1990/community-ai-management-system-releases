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
