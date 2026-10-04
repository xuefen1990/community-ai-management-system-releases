'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../src/shared/certificate-management-model');

test('证明日期使用中文年月日格式', () => {
  assert.equal(model.formatCertificateDate('2026-09-15'), '2026年09月15日');
  assert.equal(model.formatCertificateDate('2026年9月5日'), '2026年09月05日');
  assert.equal(model.localIsoDate(new Date(2026, 8, 5)), '2026-09-05');
});

test('旧模板转换为中文动态字段和连续版次', () => {
  const template = model.normalizeCertificateTemplate({ id: 'tpl_relation', name: '亲属关系证明', content: '{村民姓名}与{第二村民姓名}系{双方关系}关系', redSeal: true });
  assert.equal(template.currentVersion, 1);
  assert.deepEqual(template.subjects.map(item => item.key), ['person1', 'person2']);
  assert.equal(template.fields.find(item => item.label === '双方关系').source, 'manual');
  assert.equal(template.sealEnabled, true);
  const second = model.publishTemplateVersion(template, { content: '{村民姓名}与{第二村民姓名}确系{双方关系}关系' }, { now: '2026-09-14T00:00:00Z' });
  assert.equal(second.currentVersion, 2); assert.equal(second.versions[0].content, template.content);
});

test('居民字段改名后仍能识别第二位居民并修复旧版 subjects', () => {
  const template = model.normalizeCertificateTemplate({
    id: 'tpl_relation_renamed',
    name: '亲属关系证明',
    content: '{居民姓名}与{第二居民}系{两人之间关系}关系',
    subjects: [{ key: 'person1', label: '当事人', required: true }],
    fields: [
      { key: 'person1.name', label: '居民姓名', source: 'archive', type: 'resident', required: true },
      { key: 'person1.idCard', label: '身份证号', source: 'archive', required: true },
      { key: 'manual.second-resident', label: '第二居民', source: 'archive', required: true },
      { key: 'manual.second-id-card', label: '第二居民身份证号', source: 'archive', required: true },
      { key: 'manual.relationship', label: '两人之间关系', source: 'manual', required: true },
    ],
  });
  assert.deepEqual(template.subjects.map(item => item.key), ['person1', 'person2']);
  assert.equal(template.fields.find(item => item.label === '第二居民').key, 'person2.name');
  assert.equal(template.fields.find(item => item.label === '第二居民').subjectKey, 'person2');
  assert.equal(template.fields.find(item => item.label === '第二居民身份证号').key, 'person2.idCard');
});

test('模板字段可以显式绑定第一位或第二位居民且改名不丢失绑定', () => {
  const rebound = model.bindResidentField({ key: 'manual.other', label: '另一位当事人', source: 'archive', type: 'text' }, 'person2');
  assert.equal(rebound.key, 'person2.name');
  assert.equal(rebound.subjectKey, 'person2');
  assert.equal(rebound.type, 'resident');
  const renamed = model.normalizeCertificateField({ ...rebound, label: '被证明人' });
  assert.equal(renamed.key, 'person2.name');
  assert.equal(renamed.subjectKey, 'person2');
});

test('AI 草稿保存为模板时会把真实居民资料替换成占位字段', () => {
  const template = model.createTemplateFromAiDraft({
    title: '亲属关系证明',
    content: '兹证明张三（身份证号：321302199001010011）与李四（身份证号：321302199202020022）系兄弟关系。',
    subjects: {
      person1: { name: '张三', idCard: '321302199001010011' },
      person2: { name: '李四', idCard: '321302199202020022' },
    },
    manualValues: { 两人之间关系: '兄弟' },
  });
  assert.doesNotMatch(template.content, /张三|李四|321302/u);
  assert.match(template.content, /\{村民姓名\}/u);
  assert.match(template.content, /\{第二村民姓名\}/u);
  assert.match(template.content, /\{身份证号\}/u);
  assert.match(template.content, /\{第二村民身份证号\}/u);
  assert.equal(template.fields.some(field => field.label === '两人之间关系' && field.source === 'manual'), true);
});

test('未关联档案的 AI 识别姓名也不会写死在可复用模板中', () => {
  const template = model.createTemplateFromAiDraft({ title: '同一人证明', content: '示例居民甲与示例姓名乙系同一人。',
    residentNames: ['示例居民甲', '示例姓名乙'], subjects: {} });
  assert.doesNotMatch(template.content, /示例居民甲|示例姓名乙/u);
  assert.match(template.content, /\{村民姓名\}.*\{第二村民姓名\}/u);
});

test('AI 证明优先复用明确匹配或正文结构相同的现有模板', () => {
  const existing = model.normalizeCertificateTemplate({ id: 'relation', name: '亲属关系证明', title: '亲属关系证明', content: '兹证明{村民姓名}与{第二村民姓名}系{双方关系}关系。' });
  const sameStructure = model.normalizeCertificateTemplate({ id: '', name: 'AI 亲属证明', title: '亲属关系证明', content: '兹证明 {村民姓名} 与 {第二村民姓名} 系 {双方关系} 关系。' });
  assert.equal(model.findDuplicateCertificateTemplate(sameStructure, [existing])?.id, 'relation');
  assert.equal(model.findDuplicateCertificateTemplate({ title: '其他证明', content: '完全不同' }, [existing], 'relation')?.id, 'relation');
  assert.equal(model.findDuplicateCertificateTemplate({ title: '其他证明', content: '完全不同' }, [existing]), null);
});

test('双人快照各自独立且更换一人不会串值', () => {
  let draft = { subjects: { person1: { name: '张三', idCard: 'A' }, person2: { name: '李四', idCard: 'B' } }, values: { 'manual.relationship': '兄弟' } };
  draft = model.replaceSubject(draft, 'person1', { name: '王五', idCard: 'C' });
  assert.equal(draft.subjects.person1.idCard, 'C'); assert.equal(draft.subjects.person2.idCard, 'B');
});

test('正文渲染列出缺失中文字段且不会引入内部编号', () => {
  const version = { title: '关系证明', content: '{村民姓名}与{第二村民姓名}系{双方关系}关系，编号字段不存在。' };
  const draft = { subjects: { person1: { name: '张三' }, person2: { name: '李四' } }, values: {}, internalRecordNo: 'CERT-2026-0001' };
  const result = model.renderCertificateContent(version, draft);
  assert.deepEqual(result.missingVariables, ['双方关系']);
  assert.doesNotMatch(result.content, /CERT-2026/u);
});

test('开具记录冻结模板、人员和输出快照，作废保留原文', () => {
  const version = { versionNumber: 1, title: '关系证明', content: '{村民姓名}与{第二村民姓名}系{双方关系}关系' };
  const draft = { id: 'r1', templateId: 't1', templateVersion: 1, subjects: { person1: { name: '张三' }, person2: { name: '李四' } }, values: { 'manual.relationship': '兄弟' } };
  const issued = model.createIssuedRecord(draft, version, { internalRecordNo: 'CERT-2026-0001', issuedAt: '2026-09-14T00:00:00Z' });
  assert.equal(issued.outputSnapshot.content, '张三与李四系兄弟关系');
  const voided = model.voidIssuedRecord(issued, '填写错误', { now: '2026-09-14T01:00:00Z' });
  assert.equal(voided.status, '已作废'); assert.equal(voided.outputSnapshot.content, issued.outputSnapshot.content);
  assert.throws(() => model.voidIssuedRecord(issued, ''), /必须填写原因/u);
});
