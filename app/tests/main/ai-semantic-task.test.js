'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AiSemanticService } = require('../../src/main/ai-semantic-service');
const { AiTaskPlanner } = require('../../src/main/ai-task-planner');
const { AiTaskService } = require('../../src/main/ai-task-service');
const { createReadOnlyToolRegistry } = require('../../src/main/ai-tools/read-tools');

test('语义关联禁止仅凭重名合并，并可用组别解析到唯一居民', () => {
  const semantic = new AiSemanticService();
  const view = semantic.buildView({ personnel: [
    { id: 'p-1', name: '张三', village_group: '一组', id_card: '321302199001011111' },
    { id: 'p-2', name: '张三', village_group: '二组', id_card: '321302199002022222' },
  ] });
  const ambiguous = semantic.resolveResident(view, { query: '查询张三的发放记录' });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.match(ambiguous.reason, /禁止仅凭姓名/u);
  const resolved = semantic.resolveResident(view, { query: '查询二组张三的发放记录' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resident.id, 'p-2');
});

test('语义关联优先使用稳定标识，并把仅有姓名的旧记录留给人工核对', () => {
  const semantic = new AiSemanticService();
  const database = {
    personnel: [{ id: 'p-1', name: '李四', village_group: '三组', id_card: '321302199003033333' }],
    landParcel: [{ id: 'land-1', personId: 'p-1', area: 2.5 }],
    disbursementBatches: [{ id: 'batch-1', items: [{ name: '李四', groupName: '三组', personId: 'p-1', amountCents: 10000 }] }],
    certificates: [{ id: 'cert-1', residentName: '李四' }],
    resourceContracts: [{ id: 'contract-1', contractorName: '李四', groupName: '三组' }],
  };
  const related = semantic.relatedRecords(database, { personId: 'p-1' });
  assert.equal(related.status, 'resolved');
  assert.deepEqual(related.records.map(item => item.collection).sort(), ['disbursementBatches', 'landParcel', 'resourceContracts']);
  assert.equal(related.pendingRecords.length, 1);
  assert.equal(related.pendingRecords[0].collection, 'certificates');
  assert.match(related.pendingRecords[0].reason, /需人工确认/u);
});

test('任务规划器只使用统一工具中心已经登记的工具', () => {
  const planner = new AiTaskPlanner({ registry: createReadOnlyToolRegistry() });
  const plan = planner.plan('查询张三的承包地以及历年发放金额，并汇总核对');
  assert.ok(plan);
  assert.ok(plan.steps.length >= 2);
  const registered = new Set(createReadOnlyToolRegistry().list().map(item => item.id));
  assert.equal(plan.steps.every(step => registered.has(step.toolId)), true);
});

test('本地备用任务存储可在服务重建后恢复未完成任务', async () => {
  const database = { aiAssistantTasks: [] };
  const store = {
    read: async () => structuredClone(database),
    update: async mutator => { const draft = structuredClone(database); const result = await mutator(draft); Object.assign(database, draft); return { result }; },
  };
  const first = new AiTaskService({ databaseStore: store, now: () => new Date('2026-09-20T08:00:00.000Z') });
  const saved = await first.save({ id: 'task-1', conversationId: 'conversation-1', title: '核对任务', status: 'waiting-input', steps: [{ id: 'step-1', title: '查询', toolId: 'funds.paid-summary', status: 'waiting-input' }] });
  assert.deepEqual(saved.progress, { completed: 0, total: 1 });
  const restored = await new AiTaskService({ databaseStore: store }).latestActive('conversation-1');
  assert.equal(restored.id, 'task-1');
  assert.equal(restored.status, 'waiting-input');
  assert.deepEqual(restored.progress, { completed: 0, total: 1 });
});

test('AI 任务保存模型等级和 Token 结算状态', async () => {
  const database = { aiAssistantTasks: [] };
  const store = {
    read: async () => structuredClone(database),
    update: async mutator => { const draft = structuredClone(database); const result = await mutator(draft); Object.assign(database, draft); return { result }; },
  };
  const service = new AiTaskService({ databaseStore: store });
  const saved = await service.save({
    id: 'task-token', conversationId: 'conversation-token', title: '跨模块核对', status: 'waiting-input',
    steps: [{ id: 'step-1', title: '深度分析', status: 'waiting-input', modelTier: 'deep', estimatedTokens: 4200, actualTokens: 0 }],
    modelTier: 'deep', modelName: 'deepseek-reasoner', estimatedTokens: 4200, actualTokens: 0,
    tokenStatus: 'quota-exhausted', quotaSnapshot: { remainingTokens: 100 },
  });
  assert.equal(saved.modelTier, 'deep');
  assert.equal(saved.estimatedTokens, 4200);
  assert.equal(saved.tokenStatus, 'quota-exhausted');
  assert.equal(saved.quotaSnapshot.remainingTokens, 100);
});
