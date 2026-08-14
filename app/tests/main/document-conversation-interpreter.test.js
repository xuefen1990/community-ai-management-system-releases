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
  assert.throws(() => parseConversationResponse('不是 JSON', { fallbackKind: 'report', fallbackTemplateId: 'report-work' }), /无法理解/u);
});
