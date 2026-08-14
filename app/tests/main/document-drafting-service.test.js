'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createEmptyDatabase } = require('../../src/main/empty-database');
const { DocumentDraftingService, sanitizeDocumentHtml } = require('../../src/main/document-drafting-service');

function makeHarness({ accountId = 'u1', aiContent = 'AI 生成正文', aiResponses = null } = {}) {
  let database = createEmptyDatabase();
  let currentAccountId = accountId;
  let sequence = 0;
  const store = {
    read: async () => structuredClone(database),
    update: async (mutator) => {
      const draft = structuredClone(database);
      const result = await mutator(draft);
      database = draft;
      return { data: structuredClone(database), result: structuredClone(result) };
    },
  };
  const aiPrompts = [];
  const service = new DocumentDraftingService({
    databaseStore: store,
    getCurrentAccount: async () => currentAccountId ? ({ id: currentAccountId }) : null,
    aiRouter: { chat: async ({ messages }) => {
      aiPrompts.push(messages);
      const content = Array.isArray(aiResponses) && aiResponses.length ? aiResponses.shift() : aiContent;
      return { content, provider: 'local', model: 'test-model' };
    } },
    now: () => new Date('2026-08-13T08:00:00.000Z'),
    createId: (prefix) => `${prefix}-${++sequence}`,
  });
  return { service, aiPrompts, get database() { return structuredClone(database); }, setAccount: (id) => { currentAccountId = id; } };
}

const validReportFields = { title: '环境整治工作总结', period: '2026 年', keyPoints: '完成垃圾清运' };

test('creating a draft stores owner, template snapshot, visibility, and first version', async () => {
  const harness = makeHarness();
  const result = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields, visibility: 'shared' });

  assert.equal(result.document.ownerUserId, 'u1');
  assert.equal(result.document.status, 'draft');
  assert.equal(result.document.visibility, 'shared');
  assert.equal(result.document.currentVersionId, result.version.id);
  assert.equal(harness.database.documentVersions.length, 1);
});

test('saving versions preserves older content and increments numbers', async () => {
  const harness = makeHarness();
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await harness.service.saveDraft({ documentId: created.document.id, contentText: '人工编辑一', contentHtml: '<p>人工编辑一</p>' });
  const version = await harness.service.saveVersion({ documentId: created.document.id, changeSummary: '第一版修改' });

  assert.equal(version.versionNumber, 2);
  assert.equal(harness.database.documentVersions[0].contentText, '');
  assert.equal(harness.database.documentVersions[1].contentText, '人工编辑一');
});

test('only owner may edit, finalize, archive, or read private documents', async () => {
  const harness = makeHarness();
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields, visibility: 'private' });
  harness.setAccount('u2');

  await assert.rejects(() => harness.service.getDocument(created.document.id), /无权查看/u);
  await assert.rejects(() => harness.service.saveDraft({ documentId: created.document.id, title: '越权' }), /只有创建人/u);
  await assert.rejects(() => harness.service.finalize(created.document.id), /只有创建人/u);
  await assert.rejects(() => harness.service.archive(created.document.id), /只有创建人/u);
});

test('shared documents are readable by another signed-in admin', async () => {
  const harness = makeHarness();
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields, visibility: 'shared' });
  harness.setAccount('u2');
  assert.equal((await harness.service.getDocument(created.document.id)).document.id, created.document.id);
});

test('finalizing learns only from owner final content and archive preserves final status', async () => {
  const harness = makeHarness();
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await harness.service.saveDraft({ documentId: created.document.id, contentText: '一、工作情况\n特此报告。', contentHtml: '<p>一、工作情况</p><p>特此报告。</p>' });
  await harness.service.saveVersion({ documentId: created.document.id });
  const finalized = await harness.service.finalize(created.document.id);
  const archived = await harness.service.archive(created.document.id);

  assert.equal(finalized.status, 'final');
  assert.equal(archived.status, 'final');
  assert.equal(typeof archived.archivedAt, 'string');
  assert.equal(harness.database.writingProfiles[0].userId, 'u1');
  assert.equal(harness.database.writingProfiles[0].finalizedCount, 1);
});

test('final documents are read-only until owner explicitly reopens them', async () => {
  const harness = makeHarness();
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await harness.service.saveDraft({ documentId: created.document.id, contentText: '特此报告。', contentHtml: '<p>特此报告。</p>' });
  await harness.service.saveVersion({ documentId: created.document.id });
  await harness.service.finalize(created.document.id);
  await assert.rejects(() => harness.service.saveDraft({ documentId: created.document.id, title: '误改' }), /先取消定稿/u);
  const reopened = await harness.service.reopen(created.document.id);
  assert.equal(reopened.status, 'draft');
  assert.equal(reopened.finalizedAt, null);
  assert.equal((await harness.service.saveDraft({ documentId: created.document.id, title: '允许修改' })).title, '允许修改');
});

test('AI generation sends only selected context and creates references and a version', async () => {
  const harness = makeHarness();
  const source = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields, visibility: 'shared' });
  await harness.service.saveDraft({ documentId: source.document.id, contentText: '历史环境整治正文', contentHtml: '<p>历史环境整治正文</p>' });
  await harness.service.saveVersion({ documentId: source.document.id });
  await harness.service.finalize(source.document.id);

  const target = await harness.service.createDraft({ templateId: 'contract-service', fields: { title: '清运服务合同', partyA: '幸福社区', partyB: '清运公司', subject: '垃圾清运', amount: '1000 元', term: '一年', payment: '验收后付款' } });
  const generated = await harness.service.generate({
    documentId: target.document.id,
    selectedReferences: [{ type: 'document', documentId: source.document.id, versionId: harness.database.documentDrafts[0].currentVersionId, selectedBy: 'user' }],
  });

  const prompt = harness.aiPrompts[0].map((message) => message.content).join('\n');
  assert.match(prompt, /历史环境整治正文/u);
  assert.equal(generated.version.versionNumber, 2);
  assert.equal(harness.database.documentReferences.length, 1);
  assert.equal(harness.database.documentVersions.at(-1).contentText, 'AI 生成正文');
});

test('empty AI output does not create a new version', async () => {
  const harness = makeHarness({ aiContent: '   ' });
  const created = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await assert.rejects(() => harness.service.generate({ documentId: created.document.id }), /未返回有效正文/u);
  assert.equal(harness.database.documentVersions.length, 1);
});

test('cross-kind creation seeds an explicit source reference without copying risky fields', async () => {
  const harness = makeHarness();
  const source = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  const created = await harness.service.createFromHistory({ sourceDocumentId: source.document.id, targetTemplateId: 'contract-service' });
  assert.equal(created.document.documentKind, 'contract');
  assert.equal(created.document.fieldSnapshot.title.includes('基于'), true);
  assert.equal(created.document.fieldSnapshot.amount, '请补充');
  assert.equal(created.document.pendingReferences[0].documentId, source.document.id);
});

test('business source listing uses an allowlist and returns compact records', async () => {
  const harness = makeHarness();
  await harness.service.databaseStore.update((database) => {
    database.personnel.push({ id: 'p1', name: '张三', phone: '13800000000' });
    database.secretCollection = [{ id: 's1', value: '秘密' }];
  });
  const results = await harness.service.listBusinessSources({ collection: 'personnel', query: '张三' });
  assert.equal(results[0].title, '张三');
  await assert.rejects(() => harness.service.listBusinessSources({ collection: 'secretCollection' }), /不允许读取/u);
});

test('document HTML sanitizer keeps formatting but removes scripts, remote resources, and event handlers', () => {
  const sanitized = sanitizeDocumentHtml('<p onclick="steal()">正文<strong style="color:red">重点</strong><img src="https://example.test/a.png"><script>alert(1)</script></p>');
  assert.equal(sanitized, '<p>正文<strong>重点</strong></p>');
});

test('direct drafting creates a draft and generates the first version without storing chat messages', async () => {
  const harness = makeHarness({ aiResponses: [JSON.stringify({
    documentKind: 'report', templateId: 'report-request', status: 'ready', assistantMessage: '已生成请示',
    fields: { title: '关于拨付过渡房费用的请示', period: '2026年8月', recipient: '上级部门', keyPoints: '申请拨付36000元过渡房费用' },
    documentText: '关于拨付过渡房费用的请示\n\n现申请拨付相关费用。',
  })] });

  const result = await harness.service.converse({ message: '写一份请示，申请拨付36000元过渡房费用' });

  assert.equal(result.action, 'generated');
  assert.equal(result.document.documentKind, 'report');
  assert.equal(result.version.versionNumber, 2);
  assert.equal(harness.database.documentDraftMessages.length, 0);
  assert.equal(harness.database.documentDrafts[0].conversationState.status, 'ready');
});

test('direct drafting generates an incomplete contract immediately with explicit placeholders', async () => {
  const harness = makeHarness({ aiResponses: [JSON.stringify({
    documentKind: 'contract', templateId: 'contract-service', status: 'ready', assistantMessage: '合同已生成',
    fields: { title: '保洁服务合同', subject: '保洁服务' },
    documentText: '保洁服务合同\n\n甲方：【待补充】\n乙方：【待补充】\n服务内容：保洁服务\n金额：【待补充】',
  })] });

  const result = await harness.service.converse({ message: '帮我写一份保洁服务合同' });
  assert.equal(result.action, 'generated');
  assert.equal(result.version.versionNumber, 2);
  assert.equal(result.document.fieldSnapshot.partyA, '【待补充】');
  assert.equal(result.document.fieldSnapshot.payment, '【待补充】');
  assert.equal(harness.database.documentVersions.length, 2);
  assert.equal(harness.database.documentDraftMessages.length, 0);
});

test('typed history intent does not interrupt generation with a confirmation conversation', async () => {
  const harness = makeHarness({ aiResponses: [JSON.stringify({
    documentKind: 'contract', templateId: 'contract-service', status: 'ready', assistantMessage: '已生成',
    fields: { title: '新合同', subject: '历史事项' }, documentText: '新合同\n\n甲方：【待补充】',
  })] });
  const source = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await harness.service.saveDraft({ documentId: source.document.id, contentText: '过渡房费用历史报告', contentHtml: '<p>过渡房费用历史报告</p>' });
  await harness.service.saveVersion({ documentId: source.document.id });
  await harness.service.finalize(source.document.id);

  const result = await harness.service.converse({ message: '参考前几天那份报告，再写一份合同' });
  assert.equal(result.action, 'generated');
  assert.equal(harness.aiPrompts.length, 1);
  assert.doesNotMatch(harness.aiPrompts[0].map((item) => item.content).join('\n'), /过渡房费用历史报告/u);
});

test('supplemental regeneration uses the manually edited current body and creates a new version', async () => {
  const harness = makeHarness({ aiResponses: [JSON.stringify({
    documentKind: 'report', templateId: 'report-work', status: 'ready', assistantMessage: '已重新生成',
    fields: { title: '环境整治报告', period: '2026年8月', keyPoints: '增加整改安排' },
    documentText: '环境整治报告\n\n一、现状\n人工核对后的事实。\n\n二、整改安排\n立即整改。',
  })] });
  const created = await harness.service.createDraft({ templateId: 'report-work', fields: { title: '环境整治报告', period: '2026年8月', keyPoints: '初稿' } });
  await harness.service.saveDraft({ documentId: created.document.id, contentText: '人工核对后的事实。', contentHtml: '<p>人工核对后的事实。</p>' });

  const result = await harness.service.converse({ documentId: created.document.id, message: '增加整改安排，全文重新生成' });

  assert.equal(result.action, 'generated');
  assert.equal(result.version.versionNumber, 2);
  const prompt = harness.aiPrompts[0].map((item) => item.content).join('\n');
  assert.match(prompt, /人工核对后的事实/u);
  assert.match(prompt, /增加整改安排/u);
});

test('manual history search merges the typed query with the current draft', async () => {
  const harness = makeHarness();
  const source = await harness.service.createDraft({ templateId: 'report-work-summary', fields: validReportFields });
  await harness.service.saveDraft({ documentId: source.document.id, contentText: '专项环境整治历史正文' });
  await harness.service.saveVersion({ documentId: source.document.id });
  await harness.service.finalize(source.document.id);
  const target = await harness.service.createDraft({ templateId: 'report-request', fields: { title: '其他事项请示', period: '2026年', keyPoints: '无关内容' } });

  const results = await harness.service.recommend({ documentId: target.document.id, query: { title: '专项环境整治' } });
  assert.equal(results[0].documentId, source.document.id);
});

test('plain-text conversation output creates a new document version', async () => {
  const harness = makeHarness({ aiResponses: ['工作报告\n\n一、工作情况\n本月已完成环境整治。'] });
  const result = await harness.service.converse({ message: '写一份完整的工作报告' });
  assert.equal(result.action, 'generated');
  assert.equal(result.version.versionNumber, 2);
  assert.match(result.version.contentText, /本月已完成环境整治/u);
});

test('empty conversation output preserves the empty draft version', async () => {
  const harness = makeHarness({ aiResponses: ['   '] });
  await assert.rejects(() => harness.service.converse({ message: '写一份完整的工作报告' }), /未返回完整公文正文/u);
  assert.equal(harness.database.documentVersions.length, 1);
  assert.equal(harness.database.documentVersions[0].contentText, '');
});
