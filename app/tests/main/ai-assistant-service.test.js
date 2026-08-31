'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AiAssistantService } = require('../../src/main/ai-assistant-service');

function service(database, options = {}) {
  const store = {
    read: async () => structuredClone(database),
    update: async (mutator) => {
      const draft = structuredClone(database);
      const result = await mutator(draft);
      Object.assign(database, draft);
      return { data: structuredClone(database), result };
    },
  };
  return new AiAssistantService({
    databaseStore: store,
    aiRouter: options.aiRouter || { chat: async () => ({ content: '一般回答', provider: 'local' }) },
    now: () => new Date('2026-09-01T08:00:00.000Z'),
  });
}

test('answers an annual payment question from paid general and contract batches only', async () => {
  const assistant = service({
    personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }],
    disbursementBatches: [{ id: 'general-1', categoryName: '固定工资', completedAt: '2026-03-01T00:00:00.000Z', items: [
      { personId: 'person-1', name: '张三', amountCents: 200000, paymentStatus: 'paid', paidAt: '2026-03-01T00:00:00.000Z' },
      { personId: 'person-1', name: '张三', amountCents: 80000, paymentStatus: 'pending' },
    ] }],
    contractFeeBatches: [{ id: 'contract-1', contractName: '土地租金', batchDate: '2026-07-01', items: [
      { personId: 'person-1', name: '张三', finalAmountCents: 50000, paymentStatus: 'paid', paidAt: '2026-07-01T00:00:00.000Z' },
    ] }],
    farmlandSubsidyLedgers: [{ year: '2026', records: [{ personId: 'person-1', name: '张三', amountCents: 90000 }] }],
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三这年度共计发了多少钱？' }] });
  assert.equal(result.provider, 'system');
  assert.match(result.content, /¥2500\.00/u);
  assert.match(result.content, /共 2 笔/u);
  assert.match(result.content, /地力补贴台账目前没有/u);
});

test('requires confirmation, records, and manually undoes a resident phone update', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', village_group: '一组', phone: '13800000000' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '把一组张三的电话改成13900000000' }] });
  assert.equal(proposal.needsConfirmation, true);
  assert.match(proposal.content, /13800000000/u);
  assert.equal(database.personnel[0].phone, '13800000000');

  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /已修改/u);
  assert.equal(database.personnel[0].phone, '13900000000');
  const [operation] = await assistant.listOperations();
  assert.equal(operation.status, 'completed');
  assert.equal(operation.recoverable, true);

  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.personnel[0].phone, '13800000000');
  assert.equal((await assistant.listOperations()).some((item) => item.status === 'undone'), true);
});

test('does not perform a proposed phone update when the user cancels it', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', phone: '13800000000' }], aiAssistantOperations: [] };
  const assistant = service(database);
  await assistant.converse({ messages: [{ role: 'user', content: '把张三的电话改成13900000000' }] });
  const cancelled = await assistant.converse({ messages: [{ role: 'user', content: '取消' }] });
  assert.match(cancelled.content, /没有修改/u);
  assert.equal(database.personnel[0].phone, '13800000000');
  assert.equal(database.aiAssistantOperations.length, 0);
});

test('asks for a group when the requested name belongs to more than one resident', async () => {
  const assistant = service({
    personnel: [{ id: 'a', name: '张三', village_group: '一组' }, { id: 'b', name: '张三', village_group: '二组' }],
    disbursementBatches: [], contractFeeBatches: [], farmlandSubsidyLedgers: [],
  });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三 2026 年发了多少钱？' }] });
  assert.equal(result.needsConfirmation, true);
  assert.match(result.content, /一组/u);
  assert.match(result.content, /二组/u);
});

test('does not guess an annual range when the user omitted the year', async () => {
  const assistant = service({ personnel: [{ id: 'a', name: '张三' }], disbursementBatches: [], contractFeeBatches: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三发了多少钱？' }] });
  assert.match(result.content, /哪一年/u);
});

test('asks for clarification before handling an unstructured system request', async () => {
  const assistant = service({ personnel: [], disbursementBatches: [], contractFeeBatches: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '查一下村民发放记录' }] });
  assert.equal(result.needsConfirmation, true);
  assert.match(result.content, /不会自行猜测/u);
});

test('returns a controlled navigation action for the funding center', async () => {
  const assistant = service({ personnel: [], disbursementBatches: [], contractFeeBatches: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '打开资金发放中心' }] });
  assert.deepEqual(result.action, { type: 'navigate', target: 'tab-contract-fees', label: '资金发放中心' });
});

test('uses the configured AI only for non-system conversations and adds a no-guessing rule', async () => {
  let received = null;
  const assistant = service({ personnel: [] }, { aiRouter: { chat: async (value) => { received = value; return { content: '收到', provider: 'online' }; } } });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '帮我写一句节日祝福' }] });
  assert.equal(result.content, '收到');
  assert.match(received.messages[0].content, /不得编造/u);
});
