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
    authService: options.authService || null,
    now: () => new Date('2026-09-01T08:00:00.000Z'),
  });
}

function serviceWithBackups(database, backupEntries = {}) {
  const backups = new Map(Object.entries(backupEntries).map(([name, data]) => [name, structuredClone(data)]));
  let safeguardCount = 0;
  const replaceDatabase = (next) => {
    for (const key of Object.keys(database)) delete database[key];
    Object.assign(database, structuredClone(next));
  };
  const store = {
    read: async () => structuredClone(database),
    update: async (mutator) => {
      const draft = structuredClone(database);
      const result = await mutator(draft);
      replaceDatabase(draft);
      return { data: structuredClone(database), result };
    },
    createBackup: async () => {
      const name = `backup-safeguard-${++safeguardCount}.json`;
      backups.set(name, structuredClone(database));
      return { ok: true, name };
    },
    listBackups: async () => [...backups.keys()].map((name) => ({ name, modifiedAt: '2026-09-01T08:00:00.000Z' })),
    restoreBackup: async (reference, { transform = null } = {}) => {
      const name = typeof reference === 'string' ? reference : reference?.name;
      const restored = structuredClone(backups.get(name));
      if (!restored) throw new Error('未指定备份文件');
      if (transform) await transform(restored);
      replaceDatabase(restored);
      return { ok: true, data: structuredClone(database) };
    },
  };
  return new AiAssistantService({
    databaseStore: store,
    aiRouter: { chat: async () => ({ content: '一般回答', provider: 'local' }) },
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
  assert.equal(result.data.queryEvidence.kind, 'payment-evidence');
  assert.equal(result.data.queryEvidence.paidTotalCents, 250000);
  assert.equal(result.data.queryEvidence.paidCount, 2);
  assert.deepEqual(result.data.queryEvidence.categorySummary.map((item) => [item.name, item.amountCents]), [['固定工资', 200000], ['土地租金', 50000]]);
  assert.deepEqual(result.data.queryEvidence.alerts.map((item) => [item.type, item.count, item.amountCents]), [['pending', 1, 80000]]);
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-contract-fees');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.evidenceSource.batchId, 'general-1');
});

test('shows pending funding as an alert rather than including it in paid totals', async () => {
  const assistant = service({
    personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }],
    disbursementBatches: [{ id: 'general-pending', categoryName: '固定工资', period: '2026 年 5 月', items: [
      { personId: 'person-1', name: '张三', amountCents: 80000, paymentStatus: 'pending' },
    ] }],
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三 2026 年还有多少待发资金？' }] });
  assert.equal(result.provider, 'system');
  assert.match(result.content, /¥800\.00/u);
  assert.equal(result.data.queryEvidence.paidTotalCents, 0);
  assert.equal(result.data.queryEvidence.empty, true);
  assert.equal(result.data.queryEvidence.alerts[0].type, 'pending');
  assert.equal(result.data.queryEvidence.records[0].statusLabel, '待发放');
});

test('answers a unique resident identity-card request from the local archive without calling online AI', async () => {
  let onlineCalled = false;
  const assistant = service({
    personnel: [{ id: 'person-xue', name: '薛锋', village_group: '三组', id_card: '321302199009011634' }],
  }, {
    aiRouter: {
      chat: async () => { onlineCalled = true; return { content: '不应调用', provider: 'online' }; },
    },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '帮我查找一下薛锋的身份证号' }] });
  assert.equal(result.provider, 'system');
  assert.match(result.content, /321302199009011634/u);
  assert.match(result.content, /本机村民一户一档/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-personnel');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.filters.query, '薛锋');
  assert.equal(onlineCalled, false);
});

test('answers a same-household relationship from the local resident archive without calling online AI', async () => {
  let onlineCalled = false;
  const assistant = service({
    personnel: [
      { id: 'head', name: '薛伯齐', village_group: '西六组', household_id: '209095940', relation_to_head: '户主' },
      { id: 'member', name: '薛锋', village_group: '西六组', household_id: '209095940', relation_to_head: '子' },
    ],
  }, {
    aiRouter: { chat: async () => { onlineCalled = true; return { content: '不应调用', provider: 'online' }; } },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '居民档案里面薛锋与薛伯齐是什么关系？' }] });
  assert.equal(result.provider, 'system');
  assert.match(result.content, /同一户/u);
  assert.match(result.content, /薛锋.*子/u);
  assert.match(result.content, /薛伯齐.*户主/u);
  assert.match(result.content, /本机村民一户一档/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.metricValue, '薛锋是薛伯齐的子女');
  assert.equal(result.data.queryEvidence.records.length, 2);
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-personnel');
  assert.equal(result.data.queryEvidence.records[1].sourceAction.filters.query, '薛锋');
  assert.equal(onlineCalled, false);
});

test('does not guess a direct relationship when two residents share a household but neither is the head', async () => {
  const assistant = service({
    personnel: [
      { id: 'a', name: '张三', household_id: '001', relation_to_head: '子' },
      { id: 'b', name: '李四', household_id: '001', relation_to_head: '孙' },
    ],
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三和李四是什么关系？' }] });
  assert.match(result.content, /同一户/u);
  assert.match(result.content, /无法仅依据/u);
  assert.match(result.content, /不会猜测/u);
  assert.equal(result.data.queryEvidence.metricValue, '无法确认');
  assert.equal(result.data.queryEvidence.summary[0].value, '同一户');
});

test('explains that the archive cannot establish a relationship for residents in different households', async () => {
  const assistant = service({
    personnel: [
      { id: 'a', name: '张三', household_id: '001', relation_to_head: '户主' },
      { id: 'b', name: '李四', household_id: '002', relation_to_head: '户主' },
    ],
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三跟李四什么关系？' }] });
  assert.match(result.content, /不同户号/u);
  assert.match(result.content, /不能确认/u);
});

test('requires a group for duplicate names and does not guess or send an identity-card request online', async () => {
  let onlineCalled = false;
  const assistant = service({
    personnel: [
      { id: 'person-1', name: '张三', village_group: '一组', id_card: '110101199001011234' },
      { id: 'person-2', name: '张三', village_group: '二组', id_card: '110101199002021234' },
    ],
  }, {
    aiRouter: { chat: async () => { onlineCalled = true; return { content: '不应调用', provider: 'online' }; } },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三的身份证号码是多少？' }] });
  assert.equal(result.needsConfirmation, true);
  assert.match(result.content, /一组/u);
  assert.match(result.content, /二组/u);
  assert.doesNotMatch(result.content, /1101011990/u);
  assert.equal(onlineCalled, false);
});

test('automatically sends an explicitly requested online analysis after the administrator authorization', async () => {
  let onlineMessages = null;
  const assistant = service({}, {
    aiRouter: {
      onlineChat: async (messages) => { onlineMessages = messages; return { content: '已完成分析', provider: 'online' }; },
    },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '请用在线AI分析身份证号 321302199009011634 是否符合格式' }] });
  assert.equal(result.provider, 'online');
  assert.equal(onlineMessages.length, 3);
  assert.match(onlineMessages[2].content, /321302199009011634/u);
});

test('can automatically provide the complete local database to online analysis when the planner requires it', async () => {
  const onlineCalls = [];
  const assistant = service({
    personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }],
    partyMembers: [{ id: 'party-1', name: '李四', stage: '正式党员' }],
  }, {
    aiRouter: {
      onlineChat: async (messages) => {
        onlineCalls.push(messages);
        if (/对话理解器/u.test(messages[0].content)) {
          return { content: JSON.stringify({ canonicalMessage: '请用在线 AI 对本系统资料作综合分析。', intent: 'query', needsFacts: true, dataScope: 'full_database' }) };
        }
        return { content: '已根据完整资料完成综合分析。', provider: 'online' };
      },
    },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '请用在线AI对系统资料作综合分析' }] });

  assert.equal(result.provider, 'online');
  assert.equal(onlineCalls.length, 2);
  assert.match(onlineCalls[1][onlineCalls[1].length - 1].content, /partyMembers/u);
  assert.match(onlineCalls[1][onlineCalls[1].length - 1].content, /正式党员/u);
});

test('uses online context understanding and verified household facts for a sibling relationship', async () => {
  const onlineCalls = [];
  const assistant = service({
    personnel: [
      { id: 'head', name: '薛伯齐', household_id: 'H-1', relation_to_head: '户主' },
      { id: 'xue-feng', name: '薛锋', household_id: 'H-1', relation_to_head: '长子' },
      { id: 'xue-zhen-yu', name: '薛振宇', household_id: 'H-1', relation_to_head: '次子' },
    ],
  }, {
    aiRouter: {
      onlineChat: async (messages) => {
        onlineCalls.push(messages);
        if (/对话理解器/u.test(messages[0].content)) {
          return { content: JSON.stringify({ canonicalMessage: '薛锋与薛振宇是什么关系？', intent: 'query', needsFacts: true, dataScope: 'related_records' }), provider: 'online' };
        }
        return { content: '已核对同户资料：薛锋登记为长子、薛振宇登记为次子，二人是兄弟关系。', provider: 'online' };
      },
    },
  });

  const result = await assistant.converse({ messages: [
    { role: 'user', content: '帮我查一下薛锋和薛振宇' },
    { role: 'assistant', content: '请说明需要核对什么。' },
    { role: 'user', content: '他们是什么关系？' },
  ] });

  assert.equal(result.provider, 'online');
  assert.match(result.content, /兄弟关系/u);
  assert.equal(onlineCalls.length, 2);
  assert.match(onlineCalls[0].map((item) => item.content).join('\n'), /他们是什么关系/u);
  assert.match(onlineCalls[1][onlineCalls[1].length - 1].content, /长子/u);
  assert.match(onlineCalls[1][onlineCalls[1].length - 1].content, /次子/u);
});

test('falls back to verified local sibling reasoning when online understanding is unavailable', async () => {
  const assistant = service({
    personnel: [
      { id: 'xue-feng', name: '薛锋', household_id: 'H-1', relation_to_head: '长子' },
      { id: 'xue-zhen-yu', name: '薛振宇', household_id: 'H-1', relation_to_head: '次子' },
    ],
  }, {
    aiRouter: { onlineChat: async () => { throw new Error('offline'); } },
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '薛锋和薛振宇是什么关系？' }] });
  assert.equal(result.provider, 'system');
  assert.match(result.content, /兄弟关系/u);
});

test('uses an online-normalized conversational update only as a local confirmation proposal', async () => {
  const database = { personnel: [{ id: 'xue-feng', name: '薛锋', village_group: '一组', phone: '18888190901' }] };
  const assistant = service(database, {
    aiRouter: {
      onlineChat: async () => ({ content: JSON.stringify({ canonicalMessage: '修改手机号：姓名=薛锋；手机号=17505270901', intent: 'update', needsFacts: false, dataScope: 'related_records' }), provider: 'online' }),
    },
  });

  const proposal = await assistant.converse({ messages: [
    { role: 'user', content: '我刚说的那个人，电话换成 17505270901' },
  ] });
  assert.equal(proposal.provider, 'system');
  assert.equal(proposal.action.type, 'confirm');
  assert.equal(database.personnel[0].phone, '18888190901');

  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /已修改薛锋的手机号/u);
  assert.equal(database.personnel[0].phone, '17505270901');
});

test('answers group, category, and highest-group annual payment questions with a paid-only scope', async () => {
  const assistant = service({
    personnel: [
      { id: 'one', name: '张三', village_group: '一组' },
      { id: 'two', name: '李四', village_group: '二组' },
    ],
    disbursementCategories: [{ id: 'salary', name: '固定工资' }],
    disbursementBatches: [{ id: 'salary-1', categoryName: '固定工资', completedAt: '2026-03-01T00:00:00.000Z', items: [
      { personId: 'one', name: '张三', amountCents: 250000, paymentStatus: 'paid' },
      { personId: 'two', name: '李四', amountCents: 100000, paymentStatus: 'paid' },
      { personId: 'two', name: '李四', amountCents: 990000, paymentStatus: 'pending' },
    ] }],
    contractFeeBatches: [{ id: 'rent-1', contractName: '土地租金', batchDate: '2026-05-01', items: [
      { personId: 'two', name: '李四', groupName: '二组', finalAmountCents: 200000, paymentStatus: 'paid' },
    ] }],
  });

  const group = await assistant.converse({ messages: [{ role: 'user', content: '一组 2026 年发放多少钱？' }] });
  assert.match(group.content, /¥2500\.00/u);
  assert.match(group.content, /只统计状态为“已发放”/u);

  const category = await assistant.converse({ messages: [{ role: 'user', content: '固定工资 2026 年发放多少钱？' }] });
  assert.match(category.content, /¥3500\.00/u);

  const highest = await assistant.converse({ messages: [{ role: 'user', content: '2026 年哪个组发放最多？' }] });
  assert.match(highest.content, /二组/u);
  assert.match(highest.content, /¥3000\.00/u);
});

test('answers a yearly pending-funding question from only defined unpaid payment states', async () => {
  const assistant = service({
    personnel: [{ id: 'one', name: '张三', village_group: '一组' }],
    disbursementBatches: [{ id: 'salary-1', categoryName: '固定工资', batchDate: '2026-03-01', items: [
      { personId: 'one', name: '张三', amountCents: 250000, paymentStatus: 'pending' },
      { personId: 'one', name: '张三', amountCents: 90000, paymentStatus: 'paid' },
      { personId: 'one', name: '张三', amountCents: 70000, paymentStatus: 'unknown' },
    ] }],
    contractFeeBatches: [{ id: 'rent-1', contractName: '土地租金', batchDate: '2026-05-01', items: [
      { personId: 'one', name: '张三', groupName: '一组', finalAmountCents: 50000, paymentStatus: 'failed' },
      { personId: 'one', name: '张三', groupName: '一组', finalAmountCents: 20000, paymentStatus: 'unpaid' },
    ] }],
  });

  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三 2026 年还有多少待发资金？' }] });
  assert.match(result.content, /¥3200\.00/u);
  assert.match(result.content, /待发放1笔/u);
  assert.match(result.content, /发放失败1笔/u);
  assert.match(result.content, /本次未发放1笔/u);
  assert.match(result.content, /不包含未知状态/u);
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

test('requires two confirmations for a high-risk action and records its cancellation', async () => {
  const database = { personnel: [], aiAssistantOperations: [] };
  const assistant = service(database);
  assistant.queueControlledAction({
    type: 'future_bulk_delete', riskLevel: 'high', personName: '一组居民', before: { count: 5 }, after: { deleted: true },
  });
  const first = await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  assert.match(first.content, /第一次确认/u);
  assert.deepEqual(first.action, {
    type: 'confirm', riskLevel: 'high', confirmationsRequired: 2, confirmationStep: 1, before: { count: 5 }, after: { deleted: true },
  });
  assert.equal(database.aiAssistantOperations.length, 0);

  const cancelled = await assistant.converse({ messages: [{ role: 'user', content: '取消' }] });
  assert.match(cancelled.content, /没有修改/u);
  assert.equal(database.aiAssistantOperations[0].status, 'cancelled');
  assert.equal(database.aiAssistantOperations[0].riskLevel, 'high');
});

test('records a failed confirmed update without applying an outdated phone change', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', phone: '13800000000' }], aiAssistantOperations: [] };
  const assistant = service(database);
  await assistant.converse({ messages: [{ role: 'user', content: '把张三的电话改成13900000000' }] });
  database.personnel[0].phone = '13700000000';
  const failed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(failed.content, /未执行(?:本次操作|修改)/u);
  assert.equal(database.personnel[0].phone, '13700000000');
  assert.equal(database.aiAssistantOperations[0].status, 'failed');
});

test('updates and manually undoes a resident address through the same confirmation guard', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', village_group: '一组', address: '老地址' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '把一组张三的住址改成新村路 18 号' }] });
  assert.match(proposal.content, /老地址/u);
  assert.equal(database.personnel[0].address, '老地址');
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.personnel[0].address, '新村路 18 号');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'resident_address_update');
  assert.equal(operation.fieldLabel, '住址');
  await assistant.undoOperation({ operationId: operation.id });
  assert.equal(database.personnel[0].address, '老地址');
});

test('moves a uniquely identified resident to another group after confirmation and supports manual undo', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '把张三从一组转到二组' }] });
  assert.match(proposal.content, /一组/u);
  assert.match(proposal.content, /二组/u);
  assert.equal(database.personnel[0].village_group, '一组');
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.personnel[0].village_group, '二组');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'resident_group_update');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.personnel[0].village_group, '一组');
});

test('creates a fully specified land parcel only after confirmation and keeps its resident link', async () => {
  const database = { personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }], landParcel: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '新增地块：名称=东沟地；编号=DK-001；类型=水田；面积=12.5；承包人=张三；村民组=一组' }] });
  assert.match(proposal.content, /东沟地/u);
  assert.equal(database.landParcel.length, 0);
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.landParcel.length, 1);
  assert.deepEqual(database.landParcel[0].contractorIds, ['person-1']);
  assert.equal(database.landParcel[0].area, 12.5);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'land_parcel_create');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.landParcel.length, 0);
});

test('creates and manually undoes a visit record only after confirmation', async () => {
  const database = { personnel: [], visitRecords: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '新增民情记录：张三反映水渠堵塞' }] });
  assert.match(proposal.content, /张三反映水渠堵塞/u);
  assert.equal(database.visitRecords.length, 0);
  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /新增民情记录/u);
  assert.equal(database.visitRecords.length, 1);
  assert.equal(database.visitRecords[0].status, '待处理');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'visit_record_create');
  await assistant.undoOperation({ operationId: operation.id });
  assert.equal(database.visitRecords.length, 0);
});

test('adds and manually undoes a duty arrangement in the duty page schedule', async () => {
  const database = {
    personnel: [{ id: 'person-1', name: '张三', village_group: '一组' }],
    dutyFlexible: { schedule: { '2026-09-02': ['李四'] } },
    aiAssistantOperations: [],
  };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '安排一组张三在 2026-09-02 值班' }] });
  assert.match(proposal.content, /2026-09-02/u);
  assert.deepEqual(database.dutyFlexible.schedule['2026-09-02'], ['李四']);

  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /安排张三值班/u);
  assert.deepEqual(database.dutyFlexible.schedule['2026-09-02'], ['李四', '张三']);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'duty_schedule_add');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.deepEqual(database.dutyFlexible.schedule['2026-09-02'], ['李四']);
});

test('requires an explicit duty date instead of guessing one', async () => {
  const assistant = service({ personnel: [{ id: 'person-1', name: '张三' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '安排张三值班' }] });
  assert.match(result.content, /明确值班日期/u);
  assert.match(result.content, /不会自行猜测/u);
});

test('answers an explicitly dated duty query from the duty page schedule', async () => {
  const assistant = service({ dutyFlexible: { schedule: { '2026-09-01': ['张三', '李四'] } } });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '今天有几个值班人员？' }] });
  assert.match(result.content, /共安排 2 名/u);
  assert.match(result.content, /张三、李四/u);
  assert.match(result.content, /当日排班台账/u);
});

test('creates and manually undoes a fully specified work item after confirmation', async () => {
  const database = { workItems: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '新建工作：名称=幸福河清理；类型=环境卫生；地点=幸福河；责任人=张三；开始日期=2026-09-02；说明=清理河道杂物' }] });
  assert.match(proposal.content, /幸福河清理/u);
  assert.equal(database.workItems.length, 0);

  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /新建工作/u);
  assert.equal(database.workItems.length, 1);
  assert.match(database.workItems[0].number, /^GZ-20260901-001$/u);
  assert.equal(database.workItems[0].status, '未开始');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'work_item_create');
  await assistant.undoOperation({ operationId: operation.id });
  assert.equal(database.workItems.length, 0);
});

test('updates a work status only within safe pre-acceptance states and supports manual undo', async () => {
  const database = { workItems: [{ id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '更新工作状态：名称=河道清理；状态=进行中' }] });
  assert.match(proposal.content, /未开始/u);
  assert.match(proposal.content, /进行中/u);
  assert.equal(database.workItems[0].status, '未开始');

  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.workItems[0].status, '进行中');
  assert.equal(database.workItems[0].updatedAt, '2026-09-01T08:00:00.000Z');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'work_item_status_update');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.workItems[0].status, '未开始');
  assert.equal(database.workItems[0].updatedAt, '2026-09-01T00:00:00.000Z');
});

test('does not let AI mark work accepted or archived without the existing work-management checks', async () => {
  const assistant = service({ workItems: [{ id: 'work-1', name: '河道清理', status: '进行中', updatedAt: '2026-09-01T00:00:00.000Z' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '更新工作状态：名称=河道清理；状态=已完成' }] });
  assert.match(result.content, /验收结论/u);
  assert.match(result.content, /不会绕过/u);
});

test('uses a work number to safely target one of several same-named work items', async () => {
  const database = { workItems: [
    { id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'work-2', number: 'GZ-002', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' },
  ], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '更新工作状态：编号=GZ-002；状态=进行中' }] });
  assert.match(proposal.content, /GZ-002/u);
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.workItems[0].status, '未开始');
  assert.equal(database.workItems[1].status, '进行中');
});

test('asks for missing work fields rather than creating an incomplete work item', async () => {
  const assistant = service({ workItems: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '新建工作：名称=幸福河清理；类型=环境卫生' }] });
  assert.match(result.content, /还缺少/u);
  assert.match(result.content, /地点/u);
  assert.match(result.content, /不会自行补填/u);
});

test('answers a scoped contract expiry question from contract end dates', async () => {
  const assistant = service({ resourceContracts: [
    { id: 'contract-1', name: '鱼塘承包', contractNumber: 'HT-01', endDate: '2026-09-15' },
    { id: 'contract-2', name: '林地承包', endDate: '2027-01-01' },
  ] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '未来 30 天有哪些到期合同？' }] });
  assert.match(result.content, /1 份/u);
  assert.match(result.content, /鱼塘承包/u);
  assert.doesNotMatch(result.content, /林地承包/u);
  assert.match(result.content, /合同结束日期/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.metricValue, '1 份');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-contract-fees');
  assert.deepEqual(result.data.queryEvidence.records[0].sourceAction.recordSource, { kind: 'contract', id: 'contract-1' });
});

test('asks for a contract expiry scope rather than assuming one', async () => {
  const assistant = service({ resourceContracts: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '有哪些到期合同？' }] });
  assert.match(result.content, /时间范围/u);
  assert.match(result.content, /不会自行猜测/u);
});

test('makes a no-result contract expiry query traceable instead of silently returning an empty list', async () => {
  const assistant = service({ resourceContracts: [{ id: 'contract-1', name: '鱼塘承包', endDate: '2027-12-31' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '2026 年有哪些到期合同？' }] });
  assert.match(result.content, /未查到/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.empty, true);
  assert.match(result.data.queryEvidence.emptyMessage, /未查到/u);
  assert.match(result.data.queryEvidence.scope, /合同结束日期/u);
});

test('answers a contract receipt question from the actual contract receipt ledger', async () => {
  const assistant = service({
    resourceContracts: [{ id: 'contract-1', name: '鱼塘承包', contractorName: '王五', amountCents: 500000 }],
    contractFeeReceipts: [{ id: 'receipt-1', contractId: 'contract-1', amountCents: 500000, status: 'paid', receivedDate: '2026-08-20' }],
  });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '鱼塘承包合同是否到账？' }] });
  assert.match(result.content, /已登记到账/u);
  assert.match(result.content, /¥5000\.00/u);
  assert.match(result.content, /2026-08-20/u);
  assert.match(result.content, /承包人缴费到账台账/u);
  assert.equal(result.data.queryEvidence.metricValue, '¥5000.00');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-contract-fees');
});

test('creates and manually removes a fully specified resource contract after confirmation', async () => {
  const database = { resourceContracts: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '新建合同：名称=鱼塘承包；承包人=王五；资源类型=土地；金额=5000.50；开始日期=2026-01-01；结束日期=2026-12-31；说明=年度鱼塘承包' }] });
  assert.match(proposal.content, /¥5000\.50/u);
  assert.equal(database.resourceContracts.length, 0);
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.resourceContracts.length, 1);
  assert.equal(database.resourceContracts[0].amountCents, 500050);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'resource_contract_create');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.resourceContracts.length, 0);
});

test('records and manually removes an exact contract receipt without allowing a partial amount', async () => {
  const database = { resourceContracts: [{ id: 'contract-1', name: '鱼塘承包', contractNumber: 'HT-001', amountCents: 500000 }], contractFeeReceipts: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '登记到账：合同=HT-001；日期=2026-08-20' }] });
  assert.match(proposal.content, /¥5000\.00/u);
  assert.equal(database.contractFeeReceipts.length, 0);
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.contractFeeReceipts[0].amountCents, 500000);
  assert.equal(database.contractFeeReceipts[0].receivedDate, '2026-08-20');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'contract_receipt_create');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.contractFeeReceipts.length, 0);

  const partial = await assistant.converse({ messages: [{ role: 'user', content: '登记到账：合同=HT-001；日期=2026-08-20；金额=4999' }] });
  assert.match(partial.content, /不允许登记多缴或少缴/u);
});

test('updates and manually restores the community name without touching account authorization', async () => {
  const database = { settings: { villageName: '陆庄社区' }, aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '把社区名称改成幸福社区' }] });
  assert.match(proposal.content, /陆庄社区/u);
  assert.equal(database.settings.villageName, '陆庄社区');
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.settings.villageName, '幸福社区');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'settings_village_name_update');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.settings.villageName, '陆庄社区');
});

test('soft-deletes and manually restores a work item only after two confirmations', async () => {
  const database = { workItems: [{ id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '删除工作：名称=河道清理' }] });
  assert.match(proposal.content, /高风险操作/u);
  assert.equal(database.workItems[0].deletedAt, undefined);
  const first = await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  assert.match(first.content, /第一次确认/u);
  await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.equal(database.workItems[0].deletedAt, '2026-09-01T08:00:00.000Z');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'work_item_soft_delete');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.workItems[0].deletedAt, undefined);
});

test('soft-deletes an exact batch of work numbers atomically and supports manual recovery', async () => {
  const database = {
    workItems: [
      { id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'work-2', number: 'GZ-002', name: '道路巡查', status: '进行中', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'work-3', number: 'GZ-003', name: '资料整理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' },
    ],
    aiAssistantOperations: [],
  };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '批量删除工作：编号=GZ-001、GZ-002' }] });
  assert.match(proposal.content, /批量删除 2 项工作/u);
  assert.equal(database.workItems.every((item) => !item.deletedAt), true);
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.equal(database.workItems[0].deletedAt, '2026-09-01T08:00:00.000Z');
  assert.equal(database.workItems[1].deletedAt, '2026-09-01T08:00:00.000Z');
  assert.equal(database.workItems[2].deletedAt, undefined);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'work_items_soft_delete_batch');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.workItems.every((item) => !item.deletedAt), true);
});

test('does not partially delete work when a requested batch contains a missing number', async () => {
  const database = { workItems: [{ id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const result = await assistant.converse({ messages: [{ role: 'user', content: '批量删除工作：编号=GZ-001、GZ-404' }] });
  assert.match(result.content, /GZ-404/u);
  assert.match(result.content, /不会执行/u);
  assert.equal(database.workItems[0].deletedAt, undefined);
  assert.equal(assistant.pendingAction, null);
});

test('does not partially delete a batch when one work changes after the first confirmation', async () => {
  const database = {
    workItems: [
      { id: 'work-1', number: 'GZ-001', name: '河道清理', status: '未开始', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'work-2', number: 'GZ-002', name: '道路巡查', status: '进行中', updatedAt: '2026-09-01T00:00:00.000Z' },
    ],
    aiAssistantOperations: [],
  };
  const assistant = service(database);
  await assistant.converse({ messages: [{ role: 'user', content: '批量删除工作：编号=GZ-001、GZ-002' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  database.workItems[1].status = '未开始';
  const failed = await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.match(failed.content, /不会执行/u);
  assert.equal(database.workItems.every((item) => !item.deletedAt), true);
  assert.equal(database.aiAssistantOperations[0].status, 'failed');
});

test('restores an exact backup only after two confirmations and can manually undo it', async () => {
  const database = { settings: { villageName: '当前社区' }, personnel: [{ id: 'person-1', name: '张三', phone: '13900000000' }], aiAssistantOperations: [] };
  const assistant = serviceWithBackups(database, {
    'backup-weekly.json': { settings: { villageName: '上周社区' }, personnel: [{ id: 'person-1', name: '张三', phone: '13800000000' }], aiAssistantOperations: [] },
  });
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '恢复备份：名称=backup-weekly.json' }] });
  assert.match(proposal.content, /高风险操作/u);
  assert.equal(database.settings.villageName, '当前社区');
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.equal(database.settings.villageName, '上周社区');
  assert.equal(database.personnel[0].phone, '13800000000');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'database_backup_restore');
  assert.equal(operation.riskLevel, 'high');
  assert.match(operation.before.safeguardBackupName, /^backup-safeguard-/u);
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.settings.villageName, '当前社区');
  assert.equal(database.personnel[0].phone, '13900000000');
  assert.equal(database.aiAssistantOperations.find((item) => item.id === operation.id).status, 'undone');
});

test('does not restore a backup if current data changes between the two confirmations', async () => {
  const database = { settings: { villageName: '当前社区' }, aiAssistantOperations: [] };
  const assistant = serviceWithBackups(database, {
    'backup-weekly.json': { settings: { villageName: '上周社区' }, aiAssistantOperations: [] },
  });
  await assistant.converse({ messages: [{ role: 'user', content: '恢复备份：名称=backup-weekly.json' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  database.settings.villageName = '人工修改后的社区';
  const failed = await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.match(failed.content, /没有按本次指令被覆盖/u);
  assert.equal(database.settings.villageName, '人工修改后的社区');
  assert.equal(database.aiAssistantOperations[0].status, 'failed');
});

test('clears and manually restores the complete finance ledger only after two confirmations', async () => {
  const database = {
    finances: [
      { id: 'finance-1', voucherNumber: 'P-001', summary: '场地租金', amountCents: 100000 },
      { id: 'finance-2', voucherNumber: 'P-002', summary: '办公支出', amountCents: 50000 },
    ],
    aiAssistantOperations: [],
  };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '清空财务收支台账' }] });
  assert.match(proposal.content, /2 笔/u);
  assert.equal(database.finances.length, 2);
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.deepEqual(database.finances, []);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'finance_records_clear');
  assert.equal(operation.riskLevel, 'high');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.deepEqual(database.finances.map((item) => item.voucherNumber), ['P-001', 'P-002']);
});

test('does not clear the finance ledger when a record changes before final confirmation', async () => {
  const database = { finances: [{ id: 'finance-1', voucherNumber: 'P-001', summary: '场地租金', amountCents: 100000 }], aiAssistantOperations: [] };
  const assistant = service(database);
  await assistant.converse({ messages: [{ role: 'user', content: '清空财务收支台账' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  database.finances[0].summary = '人工修改';
  const failed = await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.match(failed.content, /不会执行/u);
  assert.equal(database.finances[0].summary, '人工修改');
  assert.equal(database.aiAssistantOperations[0].status, 'failed');
});

test('deletes a certificate record only by its unique code after two confirmations and supports manual recovery', async () => {
  const database = { certificates: [{ id: 'certificate-1', recordCode: 'CERT-001', personName: '张三', templateName: '居住证明', issuedAt: '2026-08-20' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '删除证明记录：编号=CERT-001' }] });
  assert.match(proposal.content, /高风险操作/u);
  assert.equal(database.certificates.length, 1);
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.equal(database.certificates.length, 0);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'certificate_record_delete');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.certificates.length, 1);
  assert.equal(database.certificates[0].recordCode, 'CERT-001');
});

test('does not delete a certificate record by person name because that target is not unique enough', async () => {
  const assistant = service({ certificates: [{ recordCode: 'CERT-001', personName: '张三' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '删除证明记录：姓名=张三' }] });
  assert.match(result.content, /唯一证明编号/u);
  assert.match(result.content, /不会按姓名/u);
});

test('answers a yearly finance summary using only explicit income and expense records', async () => {
  const assistant = service({ finances: [
    { id: 'income-1', date: '2026-02-10', type: 'income', amount: 1200.5 },
    { id: 'expense-1', date: '2026-03-12', type: 'expense', amountCents: 30025 },
    { id: 'ignored-1', date: '2026-04-01', type: 'adjusting', amount: 9999 },
    { id: 'previous-year', date: '2025-12-31', type: 'income', amount: 800 },
  ] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '2026 年财务收入、支出和结余分别是多少？' }] });
  assert.match(result.content, /收入 ¥1200\.50/u);
  assert.match(result.content, /支出 ¥300\.25/u);
  assert.match(result.content, /结余 ¥900\.25/u);
  assert.match(result.content, /类型明确为“收入”或“支出”/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.metricValue, '¥900.25');
  assert.equal(result.data.queryEvidence.records.length, 2);
  assert.equal(result.data.queryEvidence.records[0].sourceAction.filters.query, '未填写摘要');
});

test('answers a yearly finance category breakdown from explicit income records only', async () => {
  const assistant = service({ finances: [
    { id: 'income-1', date: '2026-01-10', type: 'income', category: '集体经营收入', amount: 1200 },
    { id: 'income-2', date: '2026-02-10', type: 'income', category: '集体经营收入', amountCents: 30050 },
    { id: 'expense-1', date: '2026-03-10', type: 'expense', category: '办公支出', amount: 500 },
  ] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '2026 年按分类查看财务收入明细' }] });
  assert.match(result.content, /集体经营收入 ¥1500\.50（2 笔）/u);
  assert.doesNotMatch(result.content, /办公支出/u);
});

test('creates and manually removes a fully specified finance record after confirmation', async () => {
  const database = { finances: [], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '新增财务收支：类型=收入；分类=集体经营收入；摘要=场地租赁；金额=1200.50；日期=2026-09-01；经办人=张三；凭证号=P-001' }] });
  assert.match(proposal.content, /¥1200\.50/u);
  assert.equal(database.finances.length, 0);
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.finances.length, 1);
  assert.equal(database.finances[0].type, 'income');
  assert.equal(database.finances[0].amount, 1200.5);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'finance_record_create');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.finances.length, 0);
});

test('updates one finance record by its unique voucher number and supports manual undo', async () => {
  const database = { finances: [{ id: 'finance-1', voucherNumber: 'P-001', type: 'income', category: '集体经营收入', summary: '旧摘要', amount: 1200, amountCents: 120000, date: '2026-08-20', handler: '张三', updatedAt: '2026-08-20T00:00:00.000Z' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '修改财务收支：凭证号=P-001；摘要=场地租赁；金额=1200.50；日期=2026-08-21' }] });
  assert.match(proposal.content, /P-001/u);
  assert.match(proposal.content, /¥1200\.00→¥1200\.50/u);
  assert.equal(database.finances[0].summary, '旧摘要');
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.finances[0].summary, '场地租赁');
  assert.equal(database.finances[0].amountCents, 120050);
  assert.equal(database.finances[0].date, '2026-08-21');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'finance_record_update');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.finances[0].summary, '旧摘要');
  assert.equal(database.finances[0].amountCents, 120000);
  assert.equal(database.finances[0].date, '2026-08-20');
});

test('does not modify finance records without a unique voucher number', async () => {
  const assistant = service({ finances: [{ summary: '场地租赁', amount: 1200 }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '修改财务收支：摘要=场地租赁；金额=1200.50' }] });
  assert.match(result.content, /唯一凭证号/u);
  assert.match(result.content, /不会只按摘要/u);
});

test('answers a specific party member query from the party ledger', async () => {
  const assistant = service({ partyMembers: [{ id: 'party-1', name: '张三', village_group: '一组', stage: '正式党员', duty: '支部委员' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '一组张三是什么党员阶段，担任什么职务？' }] });
  assert.match(result.content, /已登记在党员档案中/u);
  assert.match(result.content, /正式党员/u);
  assert.match(result.content, /支部委员/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-party');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.filters.query, '张三');
});

test('updates and manually restores a uniquely identified party member stage', async () => {
  const database = { partyMembers: [{ id: 'party-1', name: '张三', village_group: '一组', stage: '预备党员' }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '把一组张三转为正式党员' }] });
  assert.match(proposal.content, /预备党员/u);
  assert.equal(database.partyMembers[0].stage, '预备党员');
  await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.equal(database.partyMembers[0].stage, '正式党员');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'party_member_stage_update');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.partyMembers[0].stage, '预备党员');
});

test('does not guess a party member when the name is missing', async () => {
  const assistant = service({ partyMembers: [{ id: 'party-1', name: '张三', stage: '正式党员' }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '他是不是党员？' }] });
  assert.match(result.content, /补充姓名/u);
});

test('answers a land area question from the authoritative land parcel ledger', async () => {
  const assistant = service({ landParcel: [{ id: 'land-1', area: '12.5' }, { id: 'land-2', acreage: 7.25 }] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '土地总面积多少亩？' }] });
  assert.match(result.content, /2 块/u);
  assert.match(result.content, /19\.75 亩/u);
  assert.match(result.content, /土地承包确权台账/u);
  assert.equal(result.data.queryEvidence.metricValue, '19.75 亩');
  assert.equal(result.data.queryEvidence.records.length, 2);
  assert.equal(result.data.queryEvidence.records[0].sourceAction.filters.query, 'land-1');
});

test('answers a resident land query through explicitly linked contractor identifiers', async () => {
  const assistant = service({
    personnel: [{ id: 'person-1', name: '张三', id_card: '320101199001011234' }],
    landParcel: [
      { id: 'land-1', parcel_name: '东一田', area: '8.5', contractorIds: ['320101199001011234'] },
      { id: 'land-2', parcel_name: '西二田', area: '3.25', contractorIds: ['other'] },
    ],
  });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三承包了哪些地块，多少亩？' }] });
  assert.match(result.content, /1 块/u);
  assert.match(result.content, /8\.50 亩/u);
  assert.match(result.content, /东一田/u);
  assert.doesNotMatch(result.content, /西二田/u);
  assert.equal(result.data.queryEvidence.metricValue, '8.50 亩');
  assert.equal(result.data.queryEvidence.records[0].sourceAction.target, 'tab-land');
});

test('answers a work status question without counting deleted work items', async () => {
  const assistant = service({ workItems: [
    { id: 'work-1', number: 'GZ-001', name: '河道清理', responsiblePerson: '张三', status: '进行中', updatedAt: '2026-09-01' },
    { id: 'work-2', number: 'GZ-002', name: '道路修补', responsiblePerson: '李四', status: '进行中', deletedAt: '2026-09-01' },
  ] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '进行中的工作有哪些？' }] });
  assert.match(result.content, /共有 1 项/u);
  assert.match(result.content, /河道清理/u);
  assert.doesNotMatch(result.content, /道路修补/u);
  assert.match(result.content, /已排除回收状态/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.equal(result.data.queryEvidence.metricValue, '1 项');
  assert.deepEqual(result.data.queryEvidence.records[0].sourceAction.recordSource, { kind: 'work', id: 'work-1' });
});

test('answers a final document question while excluding archived drafts', async () => {
  const assistant = service({ documentDrafts: [
    { id: 'doc-1', title: '环境整治工作报告', documentKind: 'report', status: 'final', updatedAt: '2026-09-01' },
    { id: 'doc-2', title: '旧请示', documentKind: 'request', status: 'final', archivedAt: '2026-08-01', updatedAt: '2026-08-01' },
  ] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '现在有多少已定稿公文？' }] });
  assert.match(result.content, /有 1 份/u);
  assert.match(result.content, /环境整治工作报告/u);
  assert.doesNotMatch(result.content, /旧请示/u);
  assert.match(result.content, /公文拟写台账/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.deepEqual(result.data.queryEvidence.records[0].sourceAction.recordSource, { kind: 'document', id: 'doc-1' });
});

test('answers a certificate history question directly from the certificate ledger', async () => {
  const assistant = service({
    personnel: [{ id: 'person-1', name: '张三' }],
    certificates: [
      { recordCode: 'CERT-001', personName: '张三', templateName: '居住证明', issuedAt: '2026-08-20' },
      { recordCode: 'CERT-002', personName: '李四', templateName: '收入证明', issuedAt: '2026-08-21' },
    ],
  });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '张三最近开具了哪些证明记录？' }] });
  assert.match(result.content, /1 条/u);
  assert.match(result.content, /CERT-001/u);
  assert.match(result.content, /居住证明/u);
  assert.doesNotMatch(result.content, /CERT-002/u);
  assert.match(result.content, /证明开具历史台账/u);
  assert.equal(result.data.queryEvidence.kind, 'record-evidence');
  assert.deepEqual(result.data.queryEvidence.records[0].sourceAction.recordSource, { kind: 'certificate', query: 'CERT-001' });
});

test('archives and manually restores a specified draft only after confirmation', async () => {
  const database = { documentDrafts: [{ id: 'doc-1', title: '环境整治工作报告', currentVersionId: 'version-1', updatedAt: '2026-09-01T00:00:00.000Z', archivedAt: null }], aiAssistantOperations: [] };
  const assistant = service(database);
  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '归档公文《环境整治工作报告》' }] });
  assert.match(proposal.content, /确认/u);
  assert.equal(database.documentDrafts[0].archivedAt, null);

  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认' }] });
  assert.match(completed.content, /归档公文/u);
  assert.equal(database.documentDrafts[0].archivedAt, '2026-09-01T08:00:00.000Z');
  const operation = (await assistant.listOperations()).find((item) => item.type === 'document_draft_archive');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(database.documentDrafts[0].archivedAt, null);
  assert.equal(database.documentDrafts[0].updatedAt, '2026-09-01T00:00:00.000Z');
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

test('returns controlled navigation only for an explicitly requested module', async () => {
  const assistant = service({ personnel: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '打开土地承包确权' }] });
  assert.deepEqual(result.action, { type: 'navigate', target: 'tab-land', label: '土地承包确权' });
});

test('returns explicitly scoped read-only counts for other system ledgers', async () => {
  const assistant = service({
    personnel: [{ id: 'one' }, { id: 'two' }],
    partyMembers: [{ id: 'party-1' }],
    resourceContracts: [{ id: 'contract-1' }, { id: 'contract-2' }],
  });
  const residents = await assistant.converse({ messages: [{ role: 'user', content: '现在有多少村民？' }] });
  assert.match(residents.content, /2 条村民档案/u);
  assert.match(residents.content, /未按年份或状态筛选/u);

  const contracts = await assistant.converse({ messages: [{ role: 'user', content: '系统有几份合同？' }] });
  assert.match(contracts.content, /2 条资源合同/u);
});

test('uses the configured AI only for non-system conversations and adds a no-guessing rule', async () => {
  let received = null;
  const assistant = service({ personnel: [] }, { aiRouter: { chat: async (value) => { received = value; return { content: '收到', provider: 'online' }; } } });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '帮我写一句节日祝福' }] });
  assert.equal(result.content, '收到');
  assert.match(received.messages[0].content, /不得编造/u);
});

test('stops and manually restores a unit member only after two confirmations', async () => {
  const database = { aiAssistantOperations: [] };
  const members = [{ id: 'member-1', name: '李四', phone: '13800000000', isActive: true }];
  const authService = {
    listUnitMembers: async () => structuredClone(members),
    updateMemberStatus: async ({ memberId, isActive }) => {
      const member = members.find((item) => item.id === memberId);
      if (!member) throw new Error('成员不存在');
      member.isActive = isActive;
      return structuredClone(member);
    },
  };
  const assistant = service(database, { authService });

  const proposal = await assistant.converse({ messages: [{ role: 'user', content: '停用成员：手机号=13800000000' }] });
  assert.match(proposal.content, /高风险操作/u);
  assert.equal(members[0].isActive, true);
  await assistant.converse({ messages: [{ role: 'user', content: '继续执行' }] });
  const completed = await assistant.converse({ messages: [{ role: 'user', content: '确认执行' }] });
  assert.match(completed.content, /已停用成员/u);
  assert.equal(members[0].isActive, false);
  const operation = (await assistant.listOperations()).find((item) => item.type === 'unit_member_disable');
  const undone = await assistant.undoOperation({ operationId: operation.id });
  assert.equal(undone.ok, true);
  assert.equal(members[0].isActive, true);
  assert.equal((await assistant.listOperations()).find((item) => item.id === operation.id).status, 'undone');
});

test('does not hard-delete a unit account through the AI assistant', async () => {
  const assistant = service({ aiAssistantOperations: [] });
  const result = await assistant.converse({ messages: [{ role: 'user', content: '删除账号：13800000000' }] });
  assert.match(result.content, /不执行硬删除账号/u);
});
