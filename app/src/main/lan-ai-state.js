'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const text = value => String(value ?? '').trim();
const isAdmin = user => ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(user?.role);
const denied = (message, status = 403) => Object.assign(new Error(message), { status });

function publicTask(row) {
  const steps = Array.isArray(row.steps) ? row.steps : [];
  return { ...row, progress: { completed: steps.filter(step => ['completed', 'skipped', 'undone'].includes(step.status)).length, total: steps.length } };
}

function normalizeImportedState(value = {}) {
  const conversations = (value.conversations || []).map(row => ({
    id: row.id, ownerAccountId: row.ownerAccountId || row.user_id, title: row.title || '新对话',
    messages: row.messages || [], summary: row.summary || '', updatedAt: row.updatedAt || row.updated_at,
  }));
  const memories = (value.memories || []).map(row => ({
    id: row.id, ownerAccountId: row.ownerAccountId || row.user_id,
    scope: row.scope || 'personal', content: row.content || '',
    createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at,
  }));
  const tasks = (value.tasks || []).map(row => {
    if (row.ownerAccountId) return row;
    return {
      id: row.id, ownerAccountId: row.user_id, conversationId: row.conversation_id || '', title: row.title || 'AI 任务',
      originalRequest: row.original_request || '', clarifiedRequest: row.clarified_request || '', status: row.status || 'pending',
      steps: row.steps || [], clarification: row.clarification || null, requestedExport: row.requested_export === true,
      summary: row.summary || '', taskKind: row.task_kind || '', artifactIds: row.artifact_ids || [],
      fileEntries: row.file_entries || [], pendingAction: row.pending_action || null,
      permissionDecision: row.permission_decision || null, operationId: row.operation_id || '',
      verification: row.verification || null, confirmationHistory: row.confirmation_history || [],
      modelTier: row.model_tier || '', modelName: row.model_name || '', estimatedTokens: row.estimated_tokens || 0,
      actualTokens: row.actual_tokens || 0, tokenStatus: row.token_status || '', aiRequestId: row.ai_request_id || '',
      quotaSnapshot: row.quota_snapshot || null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  });
  return { version: 1, conversations, memories, tasks };
}

class LanAiState {
  constructor({ directory }) {
    this.path = path.join(directory, 'ai-state.json');
    this.queue = Promise.resolve();
  }

  async read() {
    try { return normalizeImportedState(JSON.parse(await fs.readFile(this.path, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return normalizeImportedState(); throw error; }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}`;
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, this.path);
  }

  async importLegacy(value) {
    const existing = await this.read();
    if (existing.conversations.length || existing.memories.length || existing.tasks.length) throw new Error('主电脑已有 AI 历史，不能自动覆盖');
    await this.write(normalizeImportedState(value));
  }

  async update(mutator) {
    const work = this.queue.catch(() => {}).then(async () => {
      const state = await this.read();
      const result = mutator(state);
      await this.write(state);
      return result;
    });
    this.queue = work;
    return work;
  }

  assertAiAccess(user) {
    if (user.role === 'member' && (user.aiAccessEnabled === false || user.ai_access_enabled === 0)) throw denied('当前账号没有 AI 使用权限');
  }

  async handle(user, method, pathname, query, body = {}) {
    this.assertAiAccess(user);
    if (pathname === '/api/unit/workspace/ai/conversation') {
      if (method === 'GET') {
        const state = await this.read();
        const own = state.conversations.filter(item => item.ownerAccountId === user.id)
          .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)));
        return { conversation: query.get('conversationId') ? own.find(item => item.id === query.get('conversationId')) || null : own[0] || null };
      }
      if (method === 'PUT') return { conversation: await this.update(state => {
        const id = text(body.conversationId) || randomUUID();
        const index = state.conversations.findIndex(item => item.id === id && item.ownerAccountId === user.id);
        const messages = (Array.isArray(body.messages) ? body.messages : []).filter(item => ['user', 'assistant'].includes(item?.role))
          .slice(-24).map(item => ({ role: item.role, content: String(item.content || '').slice(0, 4000) }));
        const now = new Date().toISOString();
        const item = { id, ownerAccountId: user.id, title: index >= 0 ? state.conversations[index].title : text(messages.find(message => message.role === 'user')?.content).slice(0, 40) || '新对话',
          messages, summary: text(body.summary).slice(0, 2400), updatedAt: now };
        if (index >= 0) state.conversations[index] = item; else state.conversations.push(item);
        return item;
      }) };
    }
    if (pathname === '/api/unit/workspace/ai/memories') {
      if (method === 'GET') {
        const state = await this.read();
        return { memories: state.memories.filter(item => item.scope === 'organization' || item.ownerAccountId === user.id)
          .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt))) };
      }
      if (method === 'POST') return { memory: await this.update(state => {
        const scope = body.scope === 'organization' ? 'organization' : 'personal';
        if (scope === 'organization' && !isAdmin(user)) throw denied('只有主账号可以保存单位记忆');
        const content = text(body.content).replace(/\s+/gu, ' ').slice(0, 500);
        if (content.length < 2) throw denied('记忆内容不能为空', 400);
        const duplicate = state.memories.find(item => item.scope === scope && item.content === content
          && (scope === 'organization' || item.ownerAccountId === user.id));
        if (duplicate) return duplicate;
        const now = new Date().toISOString();
        const item = { id: randomUUID(), ownerAccountId: scope === 'personal' ? user.id : '', scope, content, createdAt: now, updatedAt: now };
        state.memories.push(item);
        return item;
      }) };
    }
    if (pathname.startsWith('/api/unit/workspace/ai/memories/') && method === 'DELETE') return this.update(state => {
      const index = state.memories.findIndex(item => item.id === decodeURIComponent(pathname.slice('/api/unit/workspace/ai/memories/'.length)));
      if (index < 0) throw denied('没有找到这条记忆', 404);
      if (state.memories[index].scope === 'organization' ? !isAdmin(user) : state.memories[index].ownerAccountId !== user.id) throw denied('无权删除这条记忆');
      state.memories.splice(index, 1);
      return { success: true };
    });
    if (pathname === '/api/unit/workspace/ai/tasks' && method === 'GET') {
      const state = await this.read();
      const limit = Math.max(1, Math.min(Number(query.get('limit')) || 30, 100));
      return { tasks: state.tasks.filter(item => item.ownerAccountId === user.id
        && (!query.get('conversationId') || item.conversationId === query.get('conversationId'))
        && (!query.get('status') || item.status === query.get('status')))
        .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt))).slice(0, limit).map(publicTask) };
    }
    if (pathname.startsWith('/api/unit/workspace/ai/tasks/') && method === 'PUT') return { task: await this.update(state => {
      const id = decodeURIComponent(pathname.slice('/api/unit/workspace/ai/tasks/'.length));
      const index = state.tasks.findIndex(item => item.id === id && item.ownerAccountId === user.id);
      const now = new Date().toISOString();
      const item = { ...(index >= 0 ? state.tasks[index] : {}), ...structuredClone(body), id, ownerAccountId: user.id,
        createdAt: index >= 0 ? state.tasks[index].createdAt : now, updatedAt: now };
      if (index >= 0) state.tasks[index] = item; else state.tasks.push(item);
      return publicTask(item);
    }) };
    throw denied('接口不存在', 404);
  }
}

module.exports = { LanAiState, normalizeImportedState };
