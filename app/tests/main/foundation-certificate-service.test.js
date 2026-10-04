'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { revision } = require('../../src/main/foundation-data-model');
const service = require('../../src/main/foundation-certificate-service');
const options = { now: () => new Date('2026-09-14T08:00:00Z'), uuid: (() => { let n = 0; return () => `uuid-${++n}`; })() };

function fixture() {
  return { settings: { villageName: '测试社区' }, personnel: [
    { id: 'p1', name: '张三', id_card: '321302199001010011', household_id: '001', village_group: '一组', relation_to_head: '户主', birth_date: '1990-01-01', gender: '男', address: '测试社区一组' },
    { id: 'p2', name: '张三', id_card: '321302199202020022', household_id: '002', village_group: '二组', relation_to_head: '子', birth_date: '1992-02-02', gender: '男', address: '测试社区二组' },
  ] };
}

test('姓名搜索保留同名候选且不自动选择', () => {
  const result = service.searchResidents(fixture(), new URLSearchParams({ keyword: '张三' }));
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].id, result.items[1].id);
  assert.match(result.items[0].idCardHint, /……/u);
});

test('内置模板可覆盖编辑、连续发布并恢复默认', () => {
  const db = fixture(); const initial = service.templateRows(db)[0];
  const changed = service.mutateCertificateResource(db, 'PATCH', `/certificate-templates/${initial.id}`, { baseVersion: initial.version, changes: { name: '修改后的证明' } }, options);
  assert.equal(changed.template.name, '修改后的证明'); assert.equal(db.certificateTemplates.length, 1);
  const draftChanged = service.mutateCertificateResource(db, 'PATCH', `/certificate-templates/${initial.id}`, { baseVersion: revision(db.certificateTemplates[0]), changes: { content: '草稿正文{村民姓名}' } }, options);
  assert.equal(draftChanged.template.content, '草稿正文{村民姓名}');
  const published = service.mutateCertificateResource(db, 'POST', `/certificate-templates/${initial.id}/publish`, { baseVersion: revision(db.certificateTemplates[0]), changes: { content: '第2版{村民姓名}' } }, options);
  assert.equal(published.template.currentVersion, 2);
  service.mutateCertificateResource(db, 'POST', '/certificate-templates/restore-defaults', {}, options);
  assert.equal(service.templateRows(db)[0].name, initial.name);
});

test('直接开具幂等并按年度生成连续内部编号', () => {
  const db = fixture(); const template = service.templateRows(db).find(item => item.id === 'tpl_residency');
  const subject = service.residentContext(db, 'p1').snapshot;
  const body = { templateId: template.id, templateVersion: template.currentVersion, subjects: { person1: subject }, values: {}, system: {}, issue: true, operationUuid: 'same-op' };
  const first = service.mutateCertificateResource(db, 'POST', '/certificate-records', body, options);
  const duplicate = service.mutateCertificateResource(db, 'POST', '/certificate-records', body, options);
  assert.equal(first.record.internalRecordNo, 'CERT-2026-0001'); assert.equal(duplicate.record.id, first.record.id); assert.equal(db.certificateRecords.length, 1);
  assert.doesNotMatch(first.record.outputSnapshot.content, /CERT-2026/u);
});

test('AI 复用现有模板时可保存人工核对后的本次正文', () => {
  const db = fixture(); const template = service.templateRows(db).find(item => item.id === 'tpl_residency');
  const subject = service.residentContext(db, 'p1').snapshot;
  const result = service.mutateCertificateResource(db, 'POST', '/certificate-records', {
    templateId: template.id, templateVersion: template.currentVersion, subjects: { person1: subject }, values: {}, system: {}, issue: true,
    outputOverride: { title: 'AI 核对后的证明', content: '这是工作人员已经确认的本次证明正文。' },
  }, options);
  assert.equal(result.record.templateId, 'tpl_residency');
  assert.deepEqual(result.record.outputSnapshot, { title: 'AI 核对后的证明', content: '这是工作人员已经确认的本次证明正文。' });
  assert.equal(db.certificateTemplates, undefined, '复用现有模板不得新增模板记录');
});

test('AI 核对后的正文可在未关联居民且没有身份证号时开具，普通开具仍需核验模板字段', () => {
  const db = fixture(); const template = service.templateRows(db).find(item => item.id === 'tpl_residency');
  const body = { templateId: template.id, templateVersion: template.currentVersion, subjects: {}, values: {}, system: {}, issue: true,
    outputOverride: { title: '情况证明', content: '兹证明示例居民甲曾使用示例姓名乙。特此证明。' } };
  assert.throws(() => service.mutateCertificateResource(db, 'POST', '/certificate-records', body, options), /尚未选择居民/u);
  const issued = service.mutateCertificateResource(db, 'POST', '/certificate-records', { ...body, aiReviewed: true }, options).record;
  assert.equal(issued.outputSnapshot.content, body.outputOverride.content);
  assert.deepEqual(issued.subjectSnapshots, {});
  assert.equal(issued.idCard, '');
  assert.equal(issued.templateSnapshot.wordPath, '');
});

test('证明只能作废并保留原快照，不能物理删除', () => {
  const db = fixture(); const template = service.templateRows(db).find(item => item.id === 'tpl_residency'); const subject = service.residentContext(db, 'p1').snapshot;
  const issued = service.mutateCertificateResource(db, 'POST', '/certificate-records', { templateId: template.id, subjects: { person1: subject }, issue: true }, options).record;
  assert.throws(() => service.mutateCertificateResource(db, 'DELETE', `/certificate-records/${issued.id}`, {}, options), /不能删除/u);
  const voided = service.mutateCertificateResource(db, 'POST', `/certificate-records/${issued.id}/void`, { reason: '信息填写错误' }, options).record;
  assert.equal(voided.status, '已作废'); assert.equal(voided.outputSnapshot.content, issued.outputSnapshot.content);
});

test('AI 开具草稿可以自动保存、恢复和清空', () => {
  const db = fixture();
  const saved = service.mutateCertificateResource(db, 'PUT', '/certificate-ai-draft', { messages: [{ role: 'user', content: '开关系证明' }], content: '草稿正文' }, options);
  assert.equal(saved.draft.content, '草稿正文');
  assert.equal(service.readCertificateResource(db, '/certificate-ai-draft', new URLSearchParams()).draft.messages.length, 1);
  const cleared = service.mutateCertificateResource(db, 'DELETE', '/certificate-ai-draft', {}, options);
  assert.equal(cleared.deleted, true);
  assert.equal(service.readCertificateResource(db, '/certificate-ai-draft', new URLSearchParams()).draft, null);
});
