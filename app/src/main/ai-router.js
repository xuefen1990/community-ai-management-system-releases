'use strict';

const crypto = require('node:crypto');
const { classifyAiTask } = require('./ai-model-routing');

function checkTextIntegrity(response) {
  if (String(response?.content || '').includes('\uFFFD')) {
    throw new Error('AI 返回的文字含有损坏字符，请重新生成；原有内容已保留');
  }
  return response;
}

function applyTokenReminderPolicy(estimate = {}, mode = 'high_cost_only') {
  const normalizedMode = ['high_cost_only', 'always', 'insufficient_only'].includes(mode) ? mode : 'high_cost_only';
  const insufficient = estimate.sufficient === false;
  const highCost = estimate.highCost === true || Number(estimate.estimatedTokens || 0) >= 4000;
  const requiresConfirmation = insufficient || normalizedMode === 'always' || (normalizedMode === 'high_cost_only' && highCost);
  return { ...estimate, highCost, reminderMode: normalizedMode, requiresConfirmation,
    reminderReason: insufficient ? '额度不足' : normalizedMode === 'always' ? '已设置为每次提醒' : highCost ? (estimate.reminderReason || '预计用量较高') : '' };
}

class AiRouter {
  constructor({ settingsStore, localRuntime, onlineClient, authService = null }) {
    this.settingsStore = settingsStore;
    this.localRuntime = localRuntime;
    this.onlineClient = onlineClient;
    this.authService = authService;
  }

  async assertAiAccess() {
    if (!this.authService?.request) return;
    if (!this.authService.session) {
      if ('session' in this.authService) throw new Error('请先登录社区账号');
      return;
    }
    const { user } = await this.authService.request('/auth/profile');
    this.authService.session.user = user;
    if (user.role === 'member' && user.aiAccessEnabled === false) throw new Error('单位管理员未授权当前账号使用 AI');
  }

  async chat({ messages, task = {} }) {
    await this.assertAiAccess();
    const taskTier = classifyAiTask({ messages, taskKind: task.taskKind, requestedTier: task.taskTier });
    const settings = await this.settingsStore.readRaw();
    if (settings.mode === 'local') return { ...checkTextIntegrity(await this.localRuntime.chat(messages)), routing: { taskTier, provider: 'local' } };
    if (settings.mode === 'online') return this.onlineChat(messages, { ...task, taskTier });
    if (this.localRuntime.getStatus().running) {
      try {
        return { ...checkTextIntegrity(await this.localRuntime.chat(messages)), routing: { taskTier, provider: 'local' } };
      } catch (error) {
        if (!this.authService && !(await this.settingsStore.getOnlineCredentials()).apiKey) throw error;
      }
    }
    return this.onlineChat(messages, { ...task, taskTier });
  }

  async estimateOnline(messages, options = {}) {
    const taskTier = classifyAiTask({ messages, taskKind: options.taskKind, requestedTier: options.taskTier });
    if (this.authService) {
      return this.authService.request('/ai/estimate', {
        method: 'POST',
        body: { messages, maxTokens: options.maxTokens, taskTier, taskKind: options.taskKind || '', taskId: options.taskId || '', attachmentCount: Number(options.attachmentCount || 0) },
      });
    }
    const promptTokens = Math.ceil(Buffer.byteLength(JSON.stringify(messages || []), 'utf8') / 3);
    const outputTokens = Math.min(8192, Math.max(16, Number(options.maxTokens) || (taskTier === 'deep' ? 4096 : 1200)));
    const estimatedTokens = promptTokens + outputTokens;
    const highCost = estimatedTokens >= 4000 || options.taskKind === 'vision-document-review' || Number(options.attachmentCount || 0) >= 3;
    return { taskTier, estimatedTokens, remainingTokens: null, sufficient: true, highCost, requiresConfirmation: highCost };
  }

  async estimate({ messages = [], options = {} } = {}) {
    await this.assertAiAccess();
    const taskTier = classifyAiTask({ messages, taskKind: options.taskKind, requestedTier: options.taskTier });
    const settings = await this.settingsStore.readRaw();
    if (settings.mode === 'local' || (settings.mode === 'auto' && this.localRuntime.getStatus().running)) {
      return { provider: 'local', taskTier, estimatedTokens: 0, remainingTokens: null, sufficient: true, requiresConfirmation: false };
    }
    return applyTokenReminderPolicy(await this.estimateOnline(messages, { ...options, taskTier }), settings.tokenReminderMode);
  }

  async getOnlineCapabilities() {
    if (this.authService) {
      const response = await this.authService.request('/ai/models', { method: 'GET' });
      const data = response?.data || response || {};
      return { supportsVision: data.supportsVision === true, visionModel: data.visionModel || '', models: data.models || [] };
    }
    return { supportsVision: false, visionModel: '', models: [] };
  }

  async onlineChat(messages, { maxTokens, temperature = 0.2, taskTier = '', taskKind = '', taskId = '', requestId = '' } = {}) {
    await this.assertAiAccess();
    const resolvedTier = classifyAiTask({ messages, taskKind, requestedTier: taskTier });
    const resolvedMaxTokens = Math.min(8192, Math.max(16, Number(maxTokens) || (resolvedTier === 'deep' ? 4096 : 1200)));
    const resolvedRequestId = requestId || `ai-request-${crypto.randomUUID()}`;
    if (this.authService) {
      const response = await this.authService.request('/ai/chat', {
        method: 'POST',
        body: { messages, maxTokens: resolvedMaxTokens, temperature, taskTier: resolvedTier, taskKind, taskId, requestId: resolvedRequestId },
      });
      const data = response?.data || response || {};
      const choice = Array.isArray(data.choices) ? data.choices[0] : null;
      const content = choice?.message?.content ?? choice?.text ?? response?.content ?? '';
      checkTextIntegrity({ content });
      try { await this.settingsStore.clearLegacyOnlineSettings?.(); } catch { /* legacy cleanup must not block a successful request */ }
      return {
        content: String(content || ''),
        provider: 'online',
        model: data.model || response?.model || '',
        usage: data.usage || response?.usage || null,
        routing: data.communityAi || response?.communityAi || { requestId: resolvedRequestId, taskTier: resolvedTier },
        data,
      };
    }

    const credentials = await this.settingsStore.getOnlineCredentials();
    if (!credentials.apiKey && credentials.credentialStatus === 'secure-storage-unavailable') {
      throw new Error('macOS 安全存储不可用。请在“系统设置 → AI 配置”重新输入 API 密钥；密钥只在本次打开软件期间有效，关闭软件后会自动清除。');
    }
    const response = await this.onlineClient.chat({
      ...credentials,
      messages,
      maxTokens: resolvedMaxTokens,
      temperature,
    });
    return { ...checkTextIntegrity(response), provider: 'online', routing: { requestId: resolvedRequestId, taskTier: resolvedTier, model: response?.model || credentials.model || '' } };
  }
}

module.exports = { AiRouter, applyTokenReminderPolicy };
