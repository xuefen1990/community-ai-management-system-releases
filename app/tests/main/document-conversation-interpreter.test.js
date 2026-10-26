'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConversationMessages,
  detectDocumentKind,
  defaultTemplateFor,
  parseConversationResponse,
} = require('../../src/main/document-conversation-interpreter');

test('detects document kind and selects a useful default template', () => {
  assert.equal(detectDocumentKind('请写一份垃圾清运服务合同'), 'contract');
  assert.equal(detectDocumentKind('申请拨付过渡房费用的请示'), 'report');
  assert.equal(defaultTemplateFor('contract', '房屋租赁协议'), 'contract-lease');
  assert.equal(defaultTemplateFor('report', '申请拨付费用的请示'), 'report-request');
});

test('preferred kind overrides automatic recognition', () => {
  assert.equal(detectDocumentKind('把这份报告改一下', 'contract'), 'contract');
});

test('direct drafting prompt includes current summary, content, selected references, and forbids follow-up questions', () => {
  const messages = buildConversationMessages({
    preferredKind: 'auto',
    conversation: [{ role: 'user', content: '写一份请示' }],
    currentFields: { title: '费用请示' },
    currentContent: '现有正文',
    referencePrompt: '【历史公文】参考正文',
  });
  const combined = messages.map((item) => item.content).join('\n');
  assert.match(combined, /严格 JSON/u);
  assert.match(combined, /直接生成完整正文/u);
  assert.match(combined, /不得向用户追问/u);
  assert.match(combined, /费用请示/u);
  assert.match(combined, /现有正文/u);
  assert.match(combined, /参考正文/u);
  assert.doesNotMatch(combined, /needs_input/u);
});

test('parses a ready report response and keeps only template fields', () => {
  const result = parseConversationResponse('```json\n{"documentKind":"report","templateId":"report-request","status":"ready","assistantMessage":"已生成","fields":{"title":"费用请示","period":"2026年8月","keyPoints":"申请拨款","unknown":"丢弃"},"documentText":"完整正文"}\n```', {
    fallbackKind: 'report',
    fallbackTemplateId: 'report-request',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.fields.title, '费用请示');
  assert.equal(Object.hasOwn(result.fields, 'unknown'), false);
  assert.equal(result.documentText, '完整正文');
});

test('contracts missing high-risk terms are generated with explicit placeholders instead of follow-up questions', () => {
  const result = parseConversationResponse('{"documentKind":"contract","templateId":"contract-service","status":"ready","assistantMessage":"已生成","fields":{"title":"服务合同","partyA":"甲方","partyB":"乙方","subject":"保洁","amount":"1000元","term":"一年","payment":"验收后付款"},"documentText":"合同正文"}', {
    fallbackKind: 'contract',
    fallbackTemplateId: 'contract-service',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.fields.breach, '【待补充】');
  assert.equal(result.fields.dispute, '【待补充】');
  assert.match(result.documentText, /待补充事项/u);
  assert.match(result.documentText, /违约责任：【待补充】/u);
  assert.match(result.documentText, /争议解决：【待补充】/u);
});

test('invalid AI JSON is rejected', () => {
  const result = parseConversationResponse('工作报告\n\n一、工作情况\n本月已完成环境整治。', {
    fallbackKind: 'report',
    fallbackTemplateId: 'report-work',
    currentFields: { title: '环境整治工作报告', period: '2026年8月', keyPoints: '完成环境整治' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.fields.title, '环境整治工作报告');
  assert.match(result.documentText, /本月已完成环境整治/u);
});

test('plain-text contract responses preserve required-field safeguards', () => {
  const result = parseConversationResponse('保洁服务合同\n\n双方就保洁服务达成如下约定。', {
    fallbackKind: 'contract',
    fallbackTemplateId: 'contract-service',
    currentFields: { title: '保洁服务合同', subject: '保洁服务' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.fields.partyA, '【待补充】');
  assert.match(result.documentText, /待补充事项/u);
  assert.match(result.documentText, /付款方式：【待补充】/u);
});

test('empty AI content is rejected', () => {
  assert.throws(() => parseConversationResponse('   ', { fallbackKind: 'report', fallbackTemplateId: 'report-work' }), /未返回完整公文正文/u);
});


test('compact template catalog preserves every template and exact required-field definitions', () => {
  const { listTemplates } = require('../../src/main/document-template-catalog');
  const messages = buildConversationMessages({ conversation: [{ role: 'user', content: '写情况报告' }],
    currentContent: '人工核对的原稿', referencePrompt: '已确认的参考来源全文' });
  const lines = messages[0].content.split('\n');
  const templates = JSON.parse(lines.find(line => line.startsWith('可选模板：')).slice('可选模板：'.length));
  const prefix = '模板字段定义（按 fieldsSchema 取用）：';
  const schemas = JSON.parse(lines.find(line => line.startsWith(prefix)).slice(prefix.length));
  const expected = listTemplates().filter(item => !item.isCustom);
  assert.deepEqual(templates.map(item => item.id), expected.map(item => item.id));
  for (const template of templates) {
    const original = expected.find(item => item.id === template.id);
    assert.deepEqual(schemas[template.fieldsSchema], original.fields.map(field => ({ key: field.key, label: field.label, required: Boolean(field.required) })));
  }
  assert.equal(Object.keys(schemas).length, 2);
  assert.match(messages[1].content, /人工核对的原稿/u);
  assert.match(messages[1].content, /已确认的参考来源全文/u);
});


test('complete JSON with a redundant closing brace is usable; incomplete JSON never becomes a draft', () => {
  const value = { documentKind: 'report', templateId: 'report-work', fields: { title: '测试报告' }, documentText: '已确认事实，保留{占位符}和"引号"。' };
  assert.equal(parseConversationResponse(JSON.stringify(value) + '\n}').documentText, value.documentText);
  assert.throws(() => parseConversationResponse('{"documentText":"正文未完整'), /格式不完整/u);
  assert.throws(() => parseConversationResponse(JSON.stringify(value) + '{"documentText":"矛盾的另一份"}'), /格式不完整/u);
});
