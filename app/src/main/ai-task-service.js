'use strict';

function text(value) { return String(value ?? '').trim(); }
function copy(value) { return structuredClone(value); }
function taskId() { return `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function withProgress(task) {
  const normalized = copy(task || {});
  const steps = Array.isArray(normalized.steps) ? normalized.steps : [];
  normalized.progress = {
    completed: steps.filter(step => ['completed', 'skipped', 'undone'].includes(step?.status)).length,
    total: steps.length,
  };
  normalized.estimatedTokens = Math.max(0, Number(normalized.estimatedTokens) || 0);
  normalized.actualTokens = Math.max(0, Number(normalized.actualTokens) || 0);
  return normalized;
}

class AiTaskService {
  constructor({ databaseStore, authService = null, now = () => new Date() } = {}) {
    if (!databaseStore?.read) throw new TypeError('databaseStore is required');
    this.databaseStore = databaseStore;
    this.authService = authService;
    this.now = now;
  }

  async currentAccountId() {
    const status = await this.authService?.getStatus?.().catch(() => null);
    return text(status?.account?.id || status?.account?.phone || 'local');
  }

  async list({ conversationId = '', status = '', limit = 30 } = {}) {
    if (typeof this.authService?.request === 'function') {
      const params = new URLSearchParams();
      if (conversationId) params.set('conversationId', conversationId);
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      const response = await this.authService.request(`/unit/workspace/ai/tasks?${params.toString()}`);
      return Array.isArray(response?.tasks) ? response.tasks.map(withProgress) : [];
    }
    const accountId = await this.currentAccountId();
    const database = await this.databaseStore.read();
    return (database.aiAssistantTasks || []).filter(task => task.ownerAccountId === accountId
      && (!conversationId || task.conversationId === conversationId)
      && (!status || task.status === status))
      .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt))).slice(0, limit).map(withProgress);
  }

  async latestActive(conversationId) {
    return (await this.list({ conversationId, limit: 20 })).find(task => ['pending', 'running', 'waiting-input', 'waiting-confirmation'].includes(task.status)) || null;
  }

  async save(task) {
    const now = this.now().toISOString();
    const normalized = { ...copy(task), id: text(task?.id) || taskId(), createdAt: task?.createdAt || now, updatedAt: now };
    if (typeof this.authService?.request === 'function') {
      const response = await this.authService.request(`/unit/workspace/ai/tasks/${encodeURIComponent(normalized.id)}`, { method: 'PUT', body: normalized });
      return withProgress(response.task);
    }
    const accountId = await this.currentAccountId();
    const outcome = await this.databaseStore.update(database => {
      database.aiAssistantTasks ||= [];
      const index = database.aiAssistantTasks.findIndex(item => item.id === normalized.id && item.ownerAccountId === accountId);
      const saved = { ...normalized, ownerAccountId: accountId };
      if (index >= 0) database.aiAssistantTasks[index] = saved;
      else database.aiAssistantTasks.push(saved);
      return saved;
    });
    return withProgress(outcome.result);
  }
}

module.exports = { AiTaskService };
