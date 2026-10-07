'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AiToolRegistry } = require('../../src/main/ai-tools/registry');
const { createReadOnlyToolRegistry } = require('../../src/main/ai-tools/read-tools');
const { createWriteToolRegistry, WRITE_TOOL_ID_BY_ACTION } = require('../../src/main/ai-tools/write-tools');

test('工具注册中心拒绝重复编号并输出稳定的公开目录', () => {
  const registry = new AiToolRegistry([{
    id: 'resident.search', name: '查询居民', category: '居民档案', riskLevel: 'R0',
    permission: { module: 'personnel', action: 'view' }, sourceCollections: ['personnel'],
    handle: () => null,
  }]);
  assert.throws(() => registry.register({ id: 'resident.search', name: '重复工具', category: '居民档案', handle: () => null }), /工具编号重复/u);
  assert.deepEqual(registry.list(), [{
    id: 'resident.search', name: '查询居民', category: '居民档案', riskLevel: 'R0', confirmationCount: 0,
    permission: { module: 'personnel', action: 'view' }, sourceCollections: ['personnel'],
    precheck: '', impact: '', verification: '', undoPolicy: '', onlineSummary: '',
  }]);
});

test('工具注册中心按顺序选择首个有结果的工具并附加工具来源', async () => {
  const calls = [];
  const registry = new AiToolRegistry([
    { id: 'first.query', name: '第一项查询', category: '测试', handle: () => { calls.push('first'); return null; } },
    { id: 'second.query', name: '第二项查询', category: '测试', handle: () => { calls.push('second'); return { content: '已找到', handled: true }; } },
    { id: 'third.query', name: '第三项查询', category: '测试', handle: () => { calls.push('third'); return { content: '不应执行' }; } },
  ]);
  const result = await registry.executeFirst({}, { stage: 'post-plan' });
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(result.content, '已找到');
  assert.equal(result.aiTool.id, 'second.query');
  assert.equal(result.aiTool.riskLevel, 'R0');
});

test('只读工具目录覆盖首批业务查询并全部为零确认风险', () => {
  const catalog = createReadOnlyToolRegistry().list();
  const ids = new Set(catalog.map(tool => tool.id));
  for (const id of [
    'resident.overview', 'resident.identity-query', 'resident.relationship-query',
    'funds.paid-summary', 'funds.pending-summary', 'land.total-area-query',
    'contract.expiry-query', 'finance.summary-query', 'certificate.history-query',
    'document.final-query', 'work.status-query', 'system.navigate',
  ]) assert.equal(ids.has(id), true, `缺少只读工具：${id}`);
  assert.equal(catalog.every(tool => tool.riskLevel === 'R0' && tool.confirmationCount === 0), true);
  assert.equal(createReadOnlyToolRegistry().list({ stage: 'pre-plan' }).map(tool => tool.id).join(','), 'resident.overview');
});

test('写操作工具目录统一登记权限、风险和确认次数', () => {
  const catalog = createWriteToolRegistry().list();
  assert.equal(catalog.length, Object.keys(WRITE_TOOL_ID_BY_ACTION).length);
  assert.equal(catalog.every(tool => ['R0', 'R1', 'R2'].includes(tool.riskLevel)), true);
  assert.equal(catalog.every(tool => tool.permission?.module && tool.permission?.action), true);
  assert.equal(catalog.filter(tool => tool.riskLevel === 'R1').every(tool => tool.confirmationCount === 1), true);
  assert.equal(catalog.filter(tool => tool.riskLevel === 'R2').every(tool => tool.confirmationCount === 2), true);
  assert.equal(catalog.filter(tool => tool.riskLevel === 'R0').every(tool => tool.confirmationCount === 0), true);
  assert.equal(catalog.find(tool => tool.id === 'document.category-create-and-archive').undoPolicy.includes('撤销'), true);
  assert.equal(catalog.find(tool => tool.id === 'finance.records-clear').riskLevel, 'R2');
  assert.equal(catalog.find(tool => tool.id === 'resident.phone-update').permission.module, 'personnel');
});
