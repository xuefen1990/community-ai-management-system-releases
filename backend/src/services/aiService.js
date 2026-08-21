'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../database');
const { encrypt, decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');

function getActiveProvider() {
  const row = db.findOne('ai_providers', p => p.is_active === 1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKey: decrypt(row.api_key_encrypted),
    defaultModel: row.default_model,
    availableModels: JSON.parse(row.available_models || '[]'),
  };
}

function getProviderById(id) {
  const row = db.findById('ai_providers', id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKey: decrypt(row.api_key_encrypted),
    defaultModel: row.default_model,
    availableModels: JSON.parse(row.available_models || '[]'),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProviders() {
  return db.findAll('ai_providers')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(row => {
      const p = getProviderById(row.id);
      p.apiKey = undefined;
      return p;
    });
}

function createProvider({ name, providerType, baseUrl, apiKey, defaultModel, availableModels }) {
  const now = db.now();
  const id = db.genId();

  const record = {
    id, name,
    provider_type: providerType || 'custom',
    base_url: baseUrl,
    api_key_encrypted: encrypt(apiKey),
    default_model: defaultModel,
    available_models: JSON.stringify(availableModels || [defaultModel]),
    is_active: 1,
    created_at: now, updated_at: now,
  };

  db.insert('ai_providers', record);
  logger.info('创建 AI Provider', { id, name, providerType });
  return getProviderById(id);
}

function updateProvider(id, { name, baseUrl, apiKey, defaultModel, availableModels, isActive }) {
  const row = db.findById('ai_providers', id);
  if (!row) {
    const err = new Error('AI Provider 不存在');
    err.statusCode = 404;
    throw err;
  }

  const patch = { updated_at: db.now() };
  if (name !== undefined) patch.name = name;
  if (baseUrl !== undefined) patch.base_url = baseUrl;
  if (apiKey !== undefined) patch.api_key_encrypted = encrypt(apiKey);
  if (defaultModel !== undefined) patch.default_model = defaultModel;
  if (availableModels !== undefined) patch.available_models = JSON.stringify(availableModels);
  if (isActive !== undefined) patch.is_active = isActive ? 1 : 0;

  db.updateById('ai_providers', id, patch);
  return getProviderById(id);
}

function deleteProvider(id) {
  db.removeById('ai_providers', id);
  return { success: true };
}

function listModels() {
  const provider = getActiveProvider();
  if (!provider) return { models: [] };
  return { models: provider.availableModels, defaultModel: provider.defaultModel };
}

function chat(userId, { messages, model, temperature, maxTokens, stream }) {
  const provider = getActiveProvider();
  if (!provider) {
    const err = new Error('未配置可用的 AI 大模型');
    err.statusCode = 503;
    throw err;
  }

  const useModel = model || provider.defaultModel;
  const url = new URL('/chat/completions', provider.baseUrl);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const body = JSON.stringify({
    model: useModel,
    messages,
    temperature: temperature !== undefined ? temperature : 0.7,
    max_tokens: maxTokens || undefined,
    stream: !!stream,
  });

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
        resolve({
          stream: true,
          statusCode: res.statusCode,
          responseStream: res,
        });
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - startTime;

        if (res.statusCode !== 200) {
          recordUsage(userId, provider.id, useModel, 0, 0, 0, latency, 'error', data);
          const err = new Error(`AI 接口返回错误 (${res.statusCode}): ${data}`);
          err.statusCode = 502;
          reject(err);
          return;
        }

        try {
          const json = JSON.parse(data);
          const usage = json.usage || {};
          recordUsage(userId, provider.id, useModel,
            usage.prompt_tokens || 0,
            usage.completion_tokens || 0,
            usage.total_tokens || 0,
            latency, 'success');
          resolve({ stream: false, data: json });
        } catch (e) {
          recordUsage(userId, provider.id, useModel, 0, 0, 0, latency, 'error', e.message);
          const err = new Error('AI 接口返回数据解析失败');
          err.statusCode = 502;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Date.now() - startTime;
      recordUsage(userId, provider && provider.id, useModel, 0, 0, 0, latency, 'error', '请求超时');
      const err = new Error('AI 接口请求超时');
      err.statusCode = 504;
      reject(err);
    });

    req.on('error', (e) => {
      const latency = Date.now() - startTime;
      recordUsage(userId, provider && provider.id, useModel, 0, 0, 0, latency, 'error', e.message);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

function recordUsage(userId, providerId, model, promptTokens, completionTokens, totalTokens, latencyMs, status, errorMessage) {
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
      error_message: errorMessage || '',
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

module.exports = {
  getActiveProvider,
  getProviderById,
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  listModels,
  chat,
  getUsageStats,
};
