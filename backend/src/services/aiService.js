'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../database');
const { encrypt, decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');
const aiQuotaService = require('./aiQuotaService');
const { providerOptions, routingOptions, routeCandidates, normalizeTaskTier, selectModel } = require('./aiModelRouting');

function getActiveProvider() {
  const row = db.findOne('ai_providers', p => p.is_active === 1);
  if (!row) return null;
  return {
    ...providerOptions(row),
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKey: decrypt(row.api_key_encrypted),
    defaultModel: row.default_model,
    availableModels: JSON.parse(row.available_models || '[]'),
    supportsVision: row.supports_vision === 1,
    visionModel: row.vision_model || '',
  };
}

function getProviderById(id) {
  const row = db.findById('ai_providers', id);
  if (!row) return null;
  return {
    ...providerOptions(row),
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    availableModels: JSON.parse(row.available_models || '[]'),
    supportsVision: row.supports_vision === 1,
    visionModel: row.vision_model || '',
    hasApiKey: Boolean(row.api_key_encrypted),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProviders() {
  return db.findAll('ai_providers')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(row => getProviderById(row.id));
}

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function chatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const root = url.pathname.replace(/\/+$/u, '');
  url.pathname = `${root}/chat/completions`.replace(/\/{2,}/gu, '/');
  return url;
}

function extractVisibleText(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    return typeof part.text === 'string' ? part.text : (typeof part.content === 'string' ? part.content : '');
  }).join('').trim();
}

function usesDeepSeekV4(baseUrl, model) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
      && /^deepseek-v4-(?:flash|pro)$/iu.test(String(model));
  } catch {
    return false;
  }
}

function resolveProviderTestInput({ providerId, baseUrl, apiKey, defaultModel, supportsVision, visionModel, testVision } = {}) {
  const saved = providerId ? db.findById('ai_providers', String(providerId)) : null;
  if (providerId && !saved) throw serviceError(404, 'AI 模型服务不存在');
  const resolved = {
    id: saved?.id || null,
    baseUrl: String(baseUrl || saved?.base_url || '').trim(),
    apiKey: String(apiKey || (saved?.api_key_encrypted ? decrypt(saved.api_key_encrypted) : '')).trim(),
    model: String(defaultModel || saved?.default_model || '').trim(),
    supportsVision: supportsVision === undefined ? saved?.supports_vision === 1 : supportsVision === true,
    visionModel: String(visionModel || saved?.vision_model || '').trim(),
    testVision: testVision === true,
  };
  assertProviderInput({ baseUrl: resolved.baseUrl, defaultModel: resolved.model });
  if (!resolved.apiKey) throw serviceError(400, 'API 密钥不能为空');
  return resolved;
}

function safeProviderMessage(value, apiKey) {
  const message = String(value || '').replaceAll(apiKey, '***').trim();
  return message.slice(0, 500);
}

function testProviderConnection(input, { timeoutMs = 30000 } = {}) {
  const provider = resolveProviderTestInput(input);
  const url = chatCompletionsUrl(provider.baseUrl);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  if (provider.testVision && !provider.supportsVision) throw serviceError(400, '请先勾选“支持图片理解”');
  if (provider.testVision && !provider.visionModel) throw serviceError(400, '请先填写视觉模型名称');
  const requestBody = {
    model: provider.testVision ? provider.visionModel : provider.model,
    messages: provider.testVision ? [{ role: 'user', content: [
      { type: 'text', text: '请用中文简短说明图片中的主要颜色。' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0cAAAAASUVORK5CYII=' } },
    ] }] : [{ role: 'user', content: '请只回复：连接成功' }],
    temperature: 0,
    max_tokens: 16,
    stream: false,
  };
  if (usesDeepSeekV4(provider.baseUrl, requestBody.model)) {
    requestBody.thinking = { type: 'disabled' };
  }
  const body = JSON.stringify(requestBody);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let finished = false;
    let timedOut = false;
    const finish = callback => value => {
      if (finished) return;
      finished = true;
      callback(value);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: Math.max(1000, Number(timeoutMs) || 30000),
    }, res => {
      // Keep partial UTF-8 characters between network chunks instead of
      // coercing each Buffer to a separate (potentially truncated) string.
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = data ? JSON.parse(data) : {}; } catch {
          fail(serviceError(502, '模型服务返回了无法识别的数据'));
          return;
        }
        const providerMessage = safeProviderMessage(json?.error?.message || json?.message, provider.apiKey);
        if (res.statusCode < 200 || res.statusCode >= 300 || providerMessage) {
          fail(serviceError(502, `模型服务测试失败：${providerMessage || `接口返回 ${res.statusCode}`}`));
          return;
        }
        const choice = Array.isArray(json.choices) ? json.choices[0] : null;
        const reply = extractVisibleText(choice?.message?.content) || extractVisibleText(choice?.text);
        if (!reply) {
          fail(serviceError(502, '模型服务已响应，但没有返回可用文字'));
          return;
        }
        const usage = json.usage || {};
        const promptTokens = Number(usage.prompt_tokens || 0);
        const completionTokens = Number(usage.completion_tokens || 0);
        succeed({
          success: true,
          model: String(json.model || requestBody.model),
          visionSupported: provider.testVision ? true : undefined,
          latencyMs: Date.now() - startedAt,
          promptTokens,
          completionTokens,
          totalTokens: Number(usage.total_tokens || 0) || promptTokens + completionTokens,
          reply: reply.slice(0, 200),
        });
      });
    });
    req.on('timeout', () => { timedOut = true; req.destroy(); });
    req.on('error', error => {
      if (timedOut) fail(serviceError(504, '模型服务连接超时，请检查地址、网络或模型状态'));
      else fail(serviceError(502, `无法连接模型服务：${safeProviderMessage(error.message, provider.apiKey) || '网络错误'}`));
    });
    req.write(body);
    req.end();
  });
}

function assertProviderInput({ name, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel }, { isCreate = false } = {}) {
  if ((isCreate || name !== undefined) && !String(name || '').trim()) {
    const err = new Error('服务名称不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (isCreate || baseUrl !== undefined) {
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      const err = new Error('请输入有效的 API 地址');
      err.statusCode = 400;
      throw err;
    }
  }
  if (isCreate && !String(apiKey || '').trim()) {
    const err = new Error('API 密钥不能为空');
    err.statusCode = 400;
    throw err;
  }
  if ((isCreate || defaultModel !== undefined) && !String(defaultModel || '').trim()) {
    const err = new Error('默认模型不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (availableModels !== undefined && (!Array.isArray(availableModels) || availableModels.some(model => !String(model || '').trim()))) {
    const err = new Error('可用模型必须是非空模型名称组成的列表');
    err.statusCode = 400;
    throw err;
  }
  if (supportsVision === true && !String(visionModel || '').trim()) {
    const err = new Error('启用图片理解时必须填写视觉模型名称');
    err.statusCode = 400;
    throw err;
  }
}

function createProvider({ name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision = false, visionModel = '', isActive = true, ...routing }) {
  assertProviderInput({ name, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel }, { isCreate: true });
  const now = db.now();
  const id = db.genId();

  const record = {
    id, name,
    provider_type: providerType || 'custom',
    base_url: baseUrl,
    api_key_encrypted: encrypt(apiKey),
    default_model: defaultModel,
    available_models: JSON.stringify(availableModels || [defaultModel]),
    supports_vision: supportsVision ? 1 : 0,
    ...routingOptions(routing),
    vision_model: supportsVision ? String(visionModel || '').trim() : '',
    is_active: isActive ? 1 : 0,
    created_at: now, updated_at: now,
  };

  db.insert('ai_providers', record);
  logger.info('创建 AI Provider', { id, name, providerType });
  return getProviderById(id);
}

function updateProvider(id, { name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel, isActive, ...routing }) {
  const row = db.findById('ai_providers', id);
  if (!row) {
    const err = new Error('AI Provider 不存在');
    err.statusCode = 404;
    throw err;
  }

  assertProviderInput({ name, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel });
  const patch = { ...routingOptions(routing), updated_at: db.now() };
  if (name !== undefined) patch.name = name;
  if (providerType !== undefined) patch.provider_type = providerType || 'custom';
  if (baseUrl !== undefined) patch.base_url = baseUrl;
  if (apiKey !== undefined && String(apiKey).trim()) patch.api_key_encrypted = encrypt(apiKey);
  if (defaultModel !== undefined) patch.default_model = defaultModel;
  if (availableModels !== undefined) patch.available_models = JSON.stringify(availableModels);
  if (supportsVision !== undefined) patch.supports_vision = supportsVision ? 1 : 0;
  if (visionModel !== undefined) patch.vision_model = supportsVision === false ? '' : String(visionModel || '').trim();
  if (isActive !== undefined) patch.is_active = isActive ? 1 : 0;

  db.updateById('ai_providers', id, patch);
  return getProviderById(id);
}

function deleteProvider(id) {
  if (!db.removeById('ai_providers', id)) {
    const err = new Error('AI Provider 不存在');
    err.statusCode = 404;
    throw err;
  }
  return { success: true };
}

function listModels() {
  const provider = getActiveProvider();
  if (!provider) return { models: [] };
  return { models: [...new Set(db.findAll('ai_providers',r=>r.is_active===1).flatMap(r=>[...JSON.parse(r.available_models||'[]'),r.default_model,r.vision_model].filter(Boolean)))], defaultModel: provider.defaultModel,
    supportsVision: db.findAll('ai_providers').some(r=>r.is_active===1&&r.supports_vision===1&&r.vision_model), visionModel: db.findAll('ai_providers').find(r=>r.is_active===1&&r.supports_vision===1&&r.vision_model)?.vision_model || '' };
}

function organizationIdOfUser(userId) {
  return require('./mainAccountScope').requireMainAccountId(db.findById('users', userId));
}

function estimateTokens(messages, maxTokens) {
  const text = JSON.stringify(Array.isArray(messages) ? messages : []);
  const prompt = Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
  const outputReserve = Math.min(4096, Math.max(1024, Number(maxTokens) || 2048));
  return Math.max(1, prompt + outputReserve);
}

function telemetryId(value) {
  const text = String(value || '');
  return /^[a-zA-Z0-9_-]{1,80}$/u.test(text) ? text : '';
}

function estimateTask(userId, { messages, model, maxTokens, taskTier = 'basic', taskKind = '', taskId = '', attachmentCount = 0 } = {}) {
  const row = routeCandidates(db.findAll('ai_providers'), {messages,model,maxTokens,taskTier,taskKind})[0];
  const provider = getProviderById(row.id);
  if (!provider) throw serviceError(503, '未配置可用的 AI 大模型');
  const tier = normalizeTaskTier(taskTier);
  const selectedModel = selectModel(provider, model, tier, taskKind);
  const resolvedMaxTokens = Math.min(8192, Math.max(16, Number(maxTokens) || (tier === 'deep' ? 4096 : 1200)));
  const estimatedTokens = estimateTokens(messages, resolvedMaxTokens);
  const organizationId = organizationIdOfUser(userId);
  const quota = organizationId ? aiQuotaService.getQuotaSummary(organizationId) : null;
  const highCostKinds = new Set(['vision-document-review', 'cross-module-analysis', 'document-draft']);
  const highCost = estimatedTokens >= 4000 || highCostKinds.has(String(taskKind || '')) || Number(attachmentCount || 0) >= 3;
  const lowBalance = Boolean(quota?.totalTokens && quota.remainingTokens / quota.totalTokens <= 0.2);
  return {
    taskTier: tier,
    taskKind: String(taskKind || ''),
    taskId: String(taskId || ''),
    model: selectedModel,
    ...(require('./aiCreditPolicy').enabled() ? {...require('./aiCreditTasks').estimate({messages,maxTokens:resolvedMaxTokens,taskTier,taskKind}), billingUnit:'credits', remainingCredits:quota?.remainingCredits, requiresConfirmation:require('./aiCreditTasks').estimate({messages,maxTokens:resolvedMaxTokens,taskTier,taskKind}).estimatedCredits>3} : {}),
    estimatedTokens,
    remainingTokens: quota?.remainingTokens ?? null,
    totalTokens: quota?.totalTokens ?? null,
    lowBalance,
    highCost,
    reminderReason: highCost ? (String(taskKind || '') === 'vision-document-review' ? '本次需要识别图片内容' : '本次任务预计用量较高') : '',
    sufficient: quota ? (require('./aiCreditPolicy').enabled() ? quota.remainingCredits>=require('./aiCreditTasks').estimate({messages,maxTokens:resolvedMaxTokens,taskTier,taskKind}).estimatedCredits : quota.remainingTokens >= estimatedTokens) : true,
    requiresConfirmation: require('./aiCreditPolicy').enabled() ? require('./aiCreditTasks').estimate({messages,maxTokens:resolvedMaxTokens,taskTier,taskKind}).estimatedCredits>3 : highCost,
  };
}

function legacyChat(userId, input) {
  const { messages, model, temperature, maxTokens, stream, requestId, taskTier = 'basic', taskKind = '', taskId = '' } = input;
  const selectedRow = input._selectedProviderId ? db.findById('ai_providers',input._selectedProviderId) : routeCandidates(db.findAll('ai_providers'), input)[0];
  const provider = {...getProviderById(selectedRow.id), apiKey:decrypt(selectedRow.api_key_encrypted)};
  if (!provider) {
    const err = new Error('未配置可用的 AI 大模型');
    err.statusCode = 503;
    throw err;
  }

  const tier = normalizeTaskTier(taskTier);
  const useModel = selectModel(provider, model, tier, require('./aiCreditPolicy').imageCount(messages)?'vision-document-review':taskKind);
  const organizationId = organizationIdOfUser(userId);
  const resolvedMaxTokens = Math.min(8192, Math.max(16, Number(maxTokens) || (tier === 'deep' ? 4096 : 1200)));
  const reservationTokens = organizationId ? estimateTokens(messages, resolvedMaxTokens) : 0;
  const effectiveRequestId = telemetryId(requestId) || db.genId();
  const taskMetadata = { taskId: telemetryId(taskId), taskKind: telemetryId(taskKind), taskTier: tier, model: useModel };
  if (organizationId) {
    aiQuotaService.reserve(organizationId, reservationTokens, { userId, requestId: effectiveRequestId, metadata: taskMetadata });
  }
  const url = chatCompletionsUrl(provider.baseUrl);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const requestBody = {
    model: useModel,
    messages,
    temperature: temperature !== undefined ? temperature : 0.2,
    max_tokens: resolvedMaxTokens,
    stream: !!stream,
  };
  if (usesDeepSeekV4(provider.baseUrl, useModel)) requestBody.thinking = { type: 'disabled' };
  const body = JSON.stringify(requestBody);

  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 120000,
  };

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      if (stream) {
        let settled = false;
        const settleStream = (actualTokens, status, errorMessage = '') => {
          if (settled) return;
          settled = true;
          const latency = Date.now() - startTime;
          if (organizationId) {
            try {
              if (status === 'success') aiQuotaService.settle(organizationId, reservationTokens, actualTokens || reservationTokens, { userId, requestId: effectiveRequestId, metadata: taskMetadata });
              else aiQuotaService.release(organizationId, reservationTokens, { userId, requestId: effectiveRequestId });
            } catch { logger.error('结算 AI Token 失败', { requestId: effectiveRequestId }); }
          }
          recordUsage(userId, provider.id, useModel, 0, 0, actualTokens || (status === 'success' ? reservationTokens : 0), latency, status, errorMessage, {
            organizationId, requestId: effectiveRequestId, chargedTokens: status === 'success' ? (actualTokens || reservationTokens) : 0, ...taskMetadata,
          });
        };
        res.once('end', () => settleStream(res.statusCode === 200 ? reservationTokens : 0, res.statusCode === 200 ? 'success' : 'error', res.statusCode === 200 ? '' : `AI 接口返回错误 (${res.statusCode})`));
        res.once('error', error => settleStream(0, 'error', error.message));
        res.once('aborted', () => settleStream(0, 'error', 'AI 流式响应中断'));
        resolve({
          stream: true,
          statusCode: res.statusCode,
          responseStream: res,
          requestId: effectiveRequestId,
        });
        return;
      }

      // IncomingMessage buffers partial UTF-8 sequences across chunk boundaries.
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - startTime;

        if (res.statusCode !== 200) {
          if (organizationId) aiQuotaService.release(organizationId, reservationTokens, { userId, requestId: effectiveRequestId, reason: 'AI 接口返回错误，退回预留额度' });
          recordUsage(userId, provider.id, useModel, 0, 0, 0, latency, 'error', data, { organizationId, requestId: effectiveRequestId, ...taskMetadata });
          const err = new Error(`AI 接口返回错误 (${res.statusCode})`);
          err.statusCode = 502;
          reject(err);
          return;
        }

        try {
          const json = JSON.parse(data);
          const usage = json.usage || {};
          const promptTokens = Number(usage.prompt_tokens || 0);
          const completionTokens = Number(usage.completion_tokens || 0);
          const reportedTotal = Number(usage.total_tokens || 0) || promptTokens + completionTokens;
          // 某些兼容接口不返回 usage；此时按预留量计费，避免出现“请求成功但不扣额度”。
          const totalTokens = reportedTotal > 0 ? reportedTotal : reservationTokens;
          if (organizationId) aiQuotaService.settle(organizationId, reservationTokens, totalTokens, { userId, requestId: effectiveRequestId, metadata: taskMetadata });
          recordUsage(userId, provider.id, useModel,
            promptTokens,
            completionTokens,
            totalTokens,
            latency, 'success', '', { organizationId, requestId: effectiveRequestId, chargedTokens: totalTokens, ...taskMetadata });
          const quota = organizationId ? aiQuotaService.getQuotaSummary(organizationId) : null;
          json.communityAi = {
            requestId: effectiveRequestId,
            taskId: taskMetadata.taskId,
            taskKind: taskMetadata.taskKind,
            taskTier: tier,
            model: useModel,
            estimatedTokens: reservationTokens,
            actualTokens: totalTokens,
            remainingTokens: quota?.remainingTokens ?? null,
            totalTokens: quota?.totalTokens ?? null,
            lowBalance: Boolean(quota?.totalTokens && quota.remainingTokens / quota.totalTokens <= 0.2),
          };
          resolve({ stream: false, data: json });
        } catch (e) {
          if (organizationId) {
            const reason = e?.code === 'AI_QUOTA_SETTLE_OVERFLOW'
              ? 'AI 实际用量超过剩余额度，退回预留额度'
              : 'AI 返回数据解析失败，退回预留额度';
            try { aiQuotaService.release(organizationId, reservationTokens, { userId, requestId: effectiveRequestId, reason }); } catch { /* preserve original error */ }
          }
          recordUsage(userId, provider.id, useModel, 0, 0, 0, latency, 'error', e.message, { organizationId, requestId: effectiveRequestId, ...taskMetadata });
          if (e?.code === 'AI_QUOTA_SETTLE_OVERFLOW') {
            reject(e);
            return;
          }
          const err = new Error('AI 接口返回数据解析失败');
          err.statusCode = 502;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Date.now() - startTime;
      if (organizationId) {
        try { aiQuotaService.release(organizationId, reservationTokens, { userId, requestId: effectiveRequestId, reason: 'AI 请求超时，退回预留额度' }); } catch { /* preserve timeout */ }
      }
      recordUsage(userId, provider && provider.id, useModel, 0, 0, 0, latency, 'error', '请求超时', { organizationId, requestId: effectiveRequestId, ...taskMetadata });
      const err = new Error('AI 接口请求超时');
      err.statusCode = 504;
      reject(err);
    });

    req.on('error', (e) => {
      const latency = Date.now() - startTime;
      if (organizationId) {
        try { aiQuotaService.release(organizationId, reservationTokens, { userId, requestId: effectiveRequestId, reason: 'AI 网络错误，退回预留额度' }); } catch { /* preserve network error */ }
      }
      recordUsage(userId, provider && provider.id, useModel, 0, 0, 0, latency, 'error', e.message, { organizationId, requestId: effectiveRequestId, ...taskMetadata });
      const err = new Error('AI 服务网络连接失败');
      err.statusCode = 502;
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

async function chat(userId,input) {
 if(require('./aiCreditPolicy').enabled())return require('./aiModelDispatch').chat(userId,organizationIdOfUser(userId),input);
 const candidates=routeCandidates(db.findAll('ai_providers'),input);let last;
 for(const row of candidates){try{return await legacyChat(userId,{...input,_selectedProviderId:row.id});}catch(e){last=e;if(![502,503,504].includes(e.statusCode))throw e;}}
 throw last;
}

function recordUsage(userId, providerId, model, promptTokens, completionTokens, totalTokens, latencyMs, status, errorMessage, extra = {}) {
  try {
    db.insert('ai_usage', {
      id: db.genId(),
      user_id: userId,
      provider_id: providerId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      latency_ms: latencyMs,
      status,
      error_message: errorMessage ? '模型调用失败' : '',
      organization_id: db.findById('users', userId)?.organization_id || '',
      main_account_id: extra.organizationId || '',
      request_id: extra.requestId || '',
      charged_tokens: Number(extra.chargedTokens ?? (status === 'success' ? totalTokens : 0)),
      charge_source: extra.organizationId ? 'main_account_quota' : 'unmetered',
      task_id: extra.taskId || '',
      task_kind: extra.taskKind || '',
      task_tier: extra.taskTier || 'basic',
      created_at: db.now(),
    });
  } catch (e) {
    logger.error('记录 AI 用量失败', { error: e.message });
  }
}

function getUsageStats(userId, days) {
  days = days || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const records = db.findAll('ai_usage', r => {
    const rTime = r.created_at;
    return rTime && rTime >= sinceStr && (!userId || r.user_id === userId);
  });

  const stats = {
    total_calls: records.length,
    total_tokens: records.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
    avg_latency: records.length > 0 ? Math.round(records.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / records.length) : 0,
    success_count: records.filter(r => r.status === 'success').length,
    error_count: records.filter(r => r.status === 'error').length,
  };

  const modelMap = {};
  for (const r of records) {
    if (!modelMap[r.model]) modelMap[r.model] = { model: r.model, calls: 0, tokens: 0 };
    modelMap[r.model].calls++;
    modelMap[r.model].tokens += (r.total_tokens || 0);
  }
  stats.byModel = Object.values(modelMap).sort((a, b) => b.calls - a.calls);

  return stats;
}

function listUsageDetails({ organizationId, mainAccountId, userId, page = 1, pageSize = 20, days = 30, status = '' } = {}) {
  const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const since = new Date(); since.setDate(since.getDate() - (Number.parseInt(days, 10) || 30));
  const sinceStr = since.toISOString();
  const ownerId = mainAccountId || (organizationId && db.findById('organizations', organizationId)?.unit_admin_user_id) || '';
  let rows = db.findAll('ai_usage', row => row.created_at >= sinceStr
    && (!ownerId || row.main_account_id === ownerId || (row.organization_id && db.findById('organizations', row.organization_id)?.unit_admin_user_id === ownerId))
    && (!organizationId || row.organization_id === organizationId)
    && (!userId || row.user_id === userId)
    && (!status || row.status === status));
  rows = rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const users = new Map(db.findAll('users').map(user => [user.id, user]));
  const providers = new Map(db.findAll('ai_providers').map(provider => [provider.id, provider]));
  const usage = rows.slice((currentPage - 1) * size, currentPage * size).map(row => ({
    id: row.id,
    userId: row.user_id,
    userName: users.get(row.user_id)?.name || '未知账号',
    model: row.model,
    providerName: providers.get(row.provider_id)?.name || '在线 AI',
    promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    chargedTokens: Number(row.charged_tokens ?? row.total_tokens ?? 0),
    chargedCredits: row.charged_credits ?? null,
    latencyMs: Number(row.latency_ms || 0),
    status: row.status,
    errorMessage: row.error_message || '',
    requestId: row.request_id || '',
    taskId: row.task_id || '',
    taskKind: row.task_kind || '',
    taskTier: row.task_tier || 'basic',
    createdAt: row.created_at,
  }));
  return {
    usage,
    pagination: { page: currentPage, pageSize: size, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / size)) },
  };
}

module.exports = {
  getActiveProvider,
  getProviderById,
  listProviders,
  testProviderConnection,
  createProvider,
  updateProvider,
  deleteProvider,
  listModels,
  chat,
  estimateTokens,
  estimateTask,
  getUsageStats,
  listUsageDetails,
};
