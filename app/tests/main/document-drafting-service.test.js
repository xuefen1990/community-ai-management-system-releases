'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createEmptyDatabase } = require('../../src/main/empty-database');
const { DocumentDraftingService, sanitizeDocumentHtml } = require('../../src/main/document-drafting-service');

function makeHarness({ accountId = 'u1', aiContent = 'AI 生成正文' } = {}) {
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
    aiRouter: { chat: async ({ messages }) => { aiPrompts.push(messages); return { content: aiContent, provider: 'local' }; } },
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
