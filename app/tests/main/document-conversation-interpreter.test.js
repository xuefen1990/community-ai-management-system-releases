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

test('conversation prompt includes current summary, content, and selected references', () => {
  const messages = buildConversationMessages({
    preferredKind: 'auto',
    conversation: [{ role: 'user', content: '写一份请示' }],
    currentFields: { title: '费用请示' },
    currentContent: '现有正文',
    referencePrompt: '【历史公文】参考正文',
  });
  const combined = messages.map((item) => item.content).join('\n');
  assert.match(combined, /严格 JSON/u);
  assert.match(combined, /费用请示/u);
  assert.match(combined, /现有正文/u);
  assert.match(combined, /参考正文/u);
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

test('contracts missing high-risk terms are converted to a follow-up question', () => {
  const result = parseConversationResponse('{"documentKind":"contract","templateId":"contract-service","status":"ready","assistantMessage":"已生成","fields":{"title":"服务合同","partyA":"甲方","partyB":"乙方","subject":"保洁","amount":"1000元","term":"一年","payment":"验收后付款"},"documentText":"合同正文"}', {
    fallbackKind: 'contract',
    fallbackTemplateId: 'contract-service',
  });
  assert.equal(result.status, 'needs_input');
  assert.match(result.assistantMessage, /违约责任/u);
  assert.match(result.assistantMessage, /争议解决/u);
  assert.equal(result.documentText, '');
});

test('invalid AI JSON is rejected', () => {
  assert.throws(() => parseConversationResponse('不是 JSON', { fallbackKind: 'report', fallbackTemplateId: 'report-work' }), /无法理解/u);
});
