'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiCertificateTemplateIntakeService, buildTemplateCandidate } = require('../../src/main/ai-certificate-template-intake-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');

function storeFor(database) {
  return { async read() { return structuredClone(database); }, async update(mutator) { return { result: await mutator(database) }; } };
}

function fixture() {
  return { aiFileIndexEntries: [{ id: 'file-1', documentId: 'doc-1', fileName: '赡养关系证明.docx', status: 'reviewed', detectedModule: 'certificate',
    documentClassification: { module: 'certificate', name: '赡养关系证明材料', templateHint: '赡养关系证明' },
    contentReview: { confirmed: true, fields: [
      { key: 'name', label: '姓名', value: '张三' }, { key: 'idCard', label: '身份证号', value: '321302199001010011' },
      { key: 'name2', label: '姓名2', value: '李四' }, { key: 'idCard2', label: '身份证号2', value: '321302199202020022' },
    ] }, businessLinks: [] }] };
}

test('证明样张会把真实姓名和身份证号转换为可填写字段', () => {
  const entry = fixture().aiFileIndexEntries[0];
  const candidate = buildTemplateCandidate(entry, '赡养关系证明\n兹证明张三（身份证号：321302199001010011）与李四（身份证号：321302199202020022）系父子关系。\n特此证明。');
  assert.equal(candidate.name, '赡养关系证明');
  for (const label of ['村民姓名', '第二村民姓名', '身份证号', '第二村民身份证号']) assert.match(candidate.content, new RegExp(`\\{${label}\\}`, 'u'));
  assert.equal(candidate.subjects.length, 2);
});

test('完全相同模板直接提示复用，不生成第二份模板', () => {
  const database = fixture();
  database.certificateTemplates = [{ id: 'existing', name: '赡养关系证明', category: '关系证明', title: '赡养关系证明',
    content: '兹证明{村民姓名}（身份证号：{身份证号}）与{第二村民姓名}（身份证号：{第二村民身份证号}）系父子关系。\n特此证明。', status: 'active' }];
  const service = new AiCertificateTemplateIntakeService({ databaseStore: storeFor(database), businessService: { request: async () => ({ ok: true }) } });
  const preview = service.preview(database, database.aiFileIndexEntries[0], '赡养关系证明\n兹证明张三（身份证号：321302199001010011）与李四（身份证号：321302199202020022）系父子关系。\n特此证明。');
  assert.equal(preview.match.level, 'exact'); assert.equal(preview.match.template.id, 'existing');
});

test('没有重复项时只建立草稿，未发布前不会作为开具模板', async () => {
  const database = fixture(); const store = storeFor(database);
  const business = new FoundationBusinessService({ store, authorize: async () => ({ account: { role: 'admin' } }), now: () => new Date('2026-09-21T08:00:00Z'), uuid: () => 'draft-template' });
  const service = new AiCertificateTemplateIntakeService({ databaseStore: store, businessService: business, now: () => new Date('2026-09-21T08:00:00Z') });
  const candidate = buildTemplateCandidate(database.aiFileIndexEntries[0], '赡养关系证明\n兹证明张三与李四共同承担赡养义务。\n特此证明。');
  const result = await service.apply({ fileId: 'file-1', decision: 'create-draft', candidate, confirmed: true });
  assert.equal(result.action, 'draft-created'); assert.equal(result.template.status, 'draft'); assert.equal(database.certificateTemplates.length, 1);
  assert.equal(database.aiFileIndexEntries[0].businessLinks[0].targetId, 'certificate-template-draft-template');
  assert.equal(database.aiAssistantOperations.at(-1).type, 'certificate_template_draft_create');
  const undone = await service.undoDraft({ operationId: result.operationId });
  assert.match(undone.message, /已撤销模板草稿/u);
  assert.equal(database.certificateTemplates.length, 0);
  assert.equal(database.aiAssistantOperations.find(item => item.id === result.operationId).status, 'undone');
});

test('同名不同正文会列出差异，更新时发布连续新版本', async () => {
  const database = fixture(); database.certificateTemplates = [{ id: 'existing', name: '赡养关系证明', category: '关系证明', title: '赡养关系证明', content: '旧正文{村民姓名}', status: 'active' }];
  const store = storeFor(database);
  const business = new FoundationBusinessService({ store, authorize: async () => ({ account: { role: 'admin' } }), now: () => new Date('2026-09-21T08:00:00Z'), uuid: () => 'unused' });
  const service = new AiCertificateTemplateIntakeService({ databaseStore: store, businessService: business, now: () => new Date('2026-09-21T08:00:00Z') });
  const candidate = buildTemplateCandidate(database.aiFileIndexEntries[0], '赡养关系证明\n新正文张三与李四。');
  const preview = service.preview(database, database.aiFileIndexEntries[0], '赡养关系证明\n新正文张三与李四。');
  assert.equal(preview.match.level, 'same-name'); assert.ok(preview.match.differences.some(item => item.field === 'content'));
  const result = await service.apply({ fileId: 'file-1', decision: 'update-existing', candidate, templateId: 'existing', confirmed: true });
  assert.equal(result.action, 'updated'); assert.equal(result.template.currentVersion, 2); assert.equal(result.template.status, 'active');
});
