'use strict';

const db = require('../database');
const accountScope = require('./mainAccountScope');

function failure(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, maxLength);
}

function cleanMessage(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function organizationId(user) {
  return accountScope.mainAccountIdOf(user);
}

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(item => ['user', 'assistant'].includes(String(item?.role)) && cleanMessage(item?.content))
    .map(item => ({ role: String(item.role), content: cleanMessage(item.content) }));
}

function mergeConversationSummary(previousSummary, messages) {
  const lines = (Array.isArray(messages) ? messages : []).map(item => `${item.role === 'user' ? '用户' : '助理'}：${cleanMessage(item.content, 500)}`);
  return [cleanMessage(previousSummary, 1600), ...lines].filter(Boolean).join('\n').slice(-2400);
}

function compactConversation(messages, previousSummary = '') {
  const safe = sanitizeMessages(messages);
  if (safe.length <= 24) return { messages: safe, summary: cleanMessage(previousSummary, 2400) };
  return { messages: safe.slice(-20), summary: mergeConversationSummary(previousSummary, safe.slice(0, -20)) };
}

function publicConversation(row) {
  return row ? {
    id: row.id,
    title: row.title || '新对话',
    messages: Array.isArray(row.messages) ? structuredClone(row.messages) : [],
    summary: row.summary || '',
    updatedAt: row.updated_at,
  } : null;
}

function getConversation(user, conversationId = '') {
  const rows = db.findAll('ai_assistant_conversations', row => row.user_id === user.id)
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  const found = conversationId ? rows.find(row => row.id === String(conversationId)) : rows[0];
  return publicConversation(found || null);
}

function saveConversation(user, { conversationId, messages, summary = '' } = {}) {
  const id = cleanText(conversationId, 100) || db.genId();
  const existing = db.findOne('ai_assistant_conversations', row => row.id === id && row.user_id === user.id);
  const compacted = compactConversation(messages, summary || existing?.summary || '');
  const safeMessages = compacted.messages;
  const now = db.now();
  const firstUser = safeMessages.find(item => item.role === 'user')?.content || '新对话';
  if (existing) {
    db.updateById('ai_assistant_conversations', existing.id, { messages: safeMessages, summary: compacted.summary, title: existing.title || firstUser.slice(0, 40), updated_at: now });
  } else {
    db.insert('ai_assistant_conversations', {
      id, user_id: user.id, organization_id: user.organization_id || '', main_account_id: organizationId(user), title: firstUser.slice(0, 40), messages: safeMessages, summary: compacted.summary,
      created_at: now, updated_at: now,
    });
  }
  const own = db.findAll('ai_assistant_conversations', row => row.user_id === user.id)
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  for (const old of own.slice(20)) db.removeById('ai_assistant_conversations', old.id);
  return publicConversation(db.findById('ai_assistant_conversations', id));
}

const TASK_STATUSES = new Set(['pending', 'running', 'waiting-input', 'waiting-confirmation', 'completed', 'failed', 'cancelled', 'undone']);
const STEP_STATUSES = new Set(['pending', 'running', 'waiting-input', 'waiting-confirmation', 'completed', 'failed', 'skipped', 'undone']);

function sanitizeTaskSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 20).map((step, index) => ({
    id: cleanText(step?.id, 80) || `step-${index + 1}`,
    title: cleanText(step?.title, 160) || `第 ${index + 1} 步`,
    toolId: cleanText(step?.toolId, 100),
    status: STEP_STATUSES.has(step?.status) ? step.status : 'pending',
    resultSummary: cleanText(step?.resultSummary, 1000),
    error: cleanText(step?.error, 500),
    modelTier: ['basic', 'deep'].includes(step?.modelTier) ? step.modelTier : '',
    modelName: cleanText(step?.modelName, 160),
    estimatedTokens: Math.max(0, Number(step?.estimatedTokens) || 0),
    actualTokens: Math.max(0, Number(step?.actualTokens) || 0),
    aiRequestId: cleanText(step?.aiRequestId, 100),
  }));
}

function sanitizeTaskStructure(value, depth = 0) {
  if (depth > 8 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 12000);
  if (Array.isArray(value)) return value.slice(0, 10000).map(item => sanitizeTaskStructure(item, depth + 1));
  if (typeof value !== 'object') return null;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    const safeKey = cleanText(key, 100);
    if (!safeKey || ['__proto__', 'prototype', 'constructor'].includes(safeKey)) continue;
    result[safeKey] = sanitizeTaskStructure(item, depth + 1);
  }
  return result;
}

function publicTask(row) {
  if (!row) return null;
  const steps = Array.isArray(row.steps) ? structuredClone(row.steps) : [];
  const completed = steps.filter(step => ['completed', 'skipped', 'undone'].includes(step.status)).length;
  return {
    id: row.id,
    conversationId: row.conversation_id || '',
    title: row.title || 'AI 任务',
    originalRequest: row.original_request || '',
    clarifiedRequest: row.clarified_request || '',
    status: row.status || 'pending',
    steps,
    progress: { completed, total: steps.length },
    clarification: row.clarification || null,
    requestedExport: row.requested_export === true,
    summary: row.summary || '',
    taskKind: row.task_kind || '',
    artifactIds: Array.isArray(row.artifact_ids) ? structuredClone(row.artifact_ids) : [],
    fileEntries: Array.isArray(row.file_entries) ? structuredClone(row.file_entries) : [],
    pendingAction: row.pending_action ? structuredClone(row.pending_action) : null,
    permissionDecision: row.permission_decision ? structuredClone(row.permission_decision) : null,
    operationId: row.operation_id || '',
    verification: row.verification ? structuredClone(row.verification) : null,
    confirmationHistory: Array.isArray(row.confirmation_history) ? structuredClone(row.confirmation_history) : [],
    modelTier: row.model_tier || '',
    modelName: row.model_name || '',
    estimatedTokens: Number(row.estimated_tokens || 0),
    actualTokens: Number(row.actual_tokens || 0),
    tokenStatus: row.token_status || '',
    aiRequestId: row.ai_request_id || '',
    quotaSnapshot: row.quota_snapshot ? structuredClone(row.quota_snapshot) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTasks(user, { conversationId = '', status = '', limit = 30 } = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  return db.findAll('ai_assistant_tasks', row => row.user_id === user.id
    && (!conversationId || row.conversation_id === String(conversationId))
    && (!status || row.status === String(status)))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, boundedLimit).map(publicTask);
}

function saveTask(user, taskId, value = {}) {
  const id = cleanText(taskId || value.id, 100) || db.genId();
  const existing = db.findOne('ai_assistant_tasks', row => row.id === id && row.user_id === user.id);
  const now = db.now();
  const row = {
    id,
    user_id: user.id,
    organization_id: user.organization_id || '',
    main_account_id: organizationId(user),
    conversation_id: cleanText(value.conversationId ?? existing?.conversation_id, 100),
    title: cleanText(value.title ?? existing?.title, 160) || 'AI 任务',
    original_request: cleanMessage(value.originalRequest ?? existing?.original_request, 4000),
    clarified_request: cleanMessage(value.clarifiedRequest ?? existing?.clarified_request, 4000),
    status: TASK_STATUSES.has(value.status) ? value.status : existing?.status || 'pending',
    steps: sanitizeTaskSteps(value.steps ?? existing?.steps),
    clarification: value.clarification && typeof value.clarification === 'object'
      ? { question: cleanText(value.clarification.question, 500), field: cleanText(value.clarification.field, 80) }
      : null,
    requested_export: value.requestedExport === true,
    summary: cleanText(value.summary, 2000),
    task_kind: cleanText(value.taskKind ?? existing?.task_kind, 80),
    artifact_ids: sanitizeTaskStructure(value.artifactIds ?? existing?.artifact_ids ?? []),
    file_entries: sanitizeTaskStructure(value.fileEntries ?? existing?.file_entries ?? []),
    pending_action: value.pendingAction === null ? null : sanitizeTaskStructure(value.pendingAction ?? existing?.pending_action),
    permission_decision: value.permissionDecision === null ? null : sanitizeTaskStructure(value.permissionDecision ?? existing?.permission_decision),
    operation_id: cleanText(value.operationId ?? existing?.operation_id, 100),
    verification: value.verification === null ? null : sanitizeTaskStructure(value.verification ?? existing?.verification),
    confirmation_history: sanitizeTaskStructure(value.confirmationHistory ?? existing?.confirmation_history ?? []),
    model_tier: ['basic', 'deep'].includes(value.modelTier) ? value.modelTier : existing?.model_tier || '',
    model_name: cleanText(value.modelName ?? existing?.model_name, 160),
    estimated_tokens: Math.max(0, Number(value.estimatedTokens ?? existing?.estimated_tokens) || 0),
    actual_tokens: Math.max(0, Number(value.actualTokens ?? existing?.actual_tokens) || 0),
    token_status: cleanText(value.tokenStatus ?? existing?.token_status, 80),
    ai_request_id: cleanText(value.aiRequestId ?? existing?.ai_request_id, 100),
    quota_snapshot: value.quotaSnapshot === null ? null : sanitizeTaskStructure(value.quotaSnapshot ?? existing?.quota_snapshot),
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (existing) db.updateById('ai_assistant_tasks', existing.id, row);
  else db.insert('ai_assistant_tasks', row);
  const own = db.findAll('ai_assistant_tasks', item => item.user_id === user.id)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  for (const old of own.slice(100)) db.removeById('ai_assistant_tasks', old.id);
  return publicTask(db.findById('ai_assistant_tasks', id));
}

function containsSensitiveValue(content) {
  return /\b\d{17}[\dXx]\b/u.test(content)
    || /\b1\d{10}\b/u.test(content)
    || /\b\d{12,19}\b/u.test(content)
    || /(?:身份证|银行卡|卡号|手机号|电话号码)[：:]?\s*[\dXx*-]{6,}/u.test(content);
}

function publicMemory(row) {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listMemories(user) {
  const unitId = organizationId(user);
  return db.findAll('ai_assistant_memories', row => (
    (row.scope === 'personal' && row.user_id === user.id)
    || (row.scope === 'organization' && unitId && (row.main_account_id === unitId || (row.organization_id && db.findById('organizations', row.organization_id)?.unit_admin_user_id === unitId)))
  )).sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))).map(publicMemory);
}

function createMemory(user, { scope = 'personal', content } = {}) {
  const normalizedScope = scope === 'organization' ? 'organization' : 'personal';
  const safeContent = cleanText(content, 500);
  if (safeContent.length < 2) throw failure(400, '记忆内容不能为空');
  if (containsSensitiveValue(safeContent)) throw failure(400, '身份证、电话和银行卡等敏感号码不能保存为长期记忆');
  const unitId = organizationId(user);
  if (normalizedScope === 'organization' && !unitId) throw failure(403, '当前账号没有主账号归属');
  if (normalizedScope === 'organization' && !['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(user.role)) throw failure(403, '只有主账号可以新增或修改共享规则');
  const existing = db.findOne('ai_assistant_memories', row => row.scope === normalizedScope
    && row.content === safeContent
    && (normalizedScope === 'personal' ? row.user_id === user.id : row.main_account_id === unitId || (row.organization_id && db.findById('organizations', row.organization_id)?.unit_admin_user_id === unitId)));
  if (existing) return publicMemory(existing);
  const now = db.now();
  const row = {
    id: db.genId(), scope: normalizedScope, content: safeContent,
    user_id: normalizedScope === 'personal' ? user.id : '',
    organization_id: normalizedScope === 'organization' ? user.organization_id || '' : '',
    main_account_id: normalizedScope === 'organization' ? unitId : '',
    created_by: user.id, created_at: now, updated_at: now,
  };
  db.insert('ai_assistant_memories', row);
  return publicMemory(row);
}

function deleteMemory(user, memoryId) {
  const row = db.findById('ai_assistant_memories', String(memoryId));
  if (!row) throw failure(404, '没有找到这条记忆');
  const canDeletePersonal = row.scope === 'personal' && row.user_id === user.id;
  const canDeleteOrganization = row.scope === 'organization' && (row.main_account_id === organizationId(user) || (row.organization_id && db.findById('organizations', row.organization_id)?.unit_admin_user_id === organizationId(user))) && ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(user.role);
  if (!canDeletePersonal && !canDeleteOrganization) throw failure(403, '无权删除这条记忆');
  db.removeById('ai_assistant_memories', row.id);
  return { success: true };
}

module.exports = {
  getConversation, saveConversation, listMemories, createMemory, deleteMemory,
  listTasks, saveTask, sanitizeMessages, compactConversation, containsSensitiveValue,
};
