'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAiJsonObject } = require('../../src/main/ai-json-response');

test('reads complete nested JSON, escaped quotes and braces in template placeholders', () => {
  const data = { content: '正文：{居民姓名}，"}"与"{"和"引号"与\\斜线', fields: { values: ['{第二居民}', '完整内容'] } };
  assert.deepEqual(extractAiJsonObject('```json\n' + JSON.stringify(data) + '\n}\n```'), data);
});

test('rejects truncated, malformed or multiple objects without guessing content', () => {
  for (const value of ['普通正文', '{"content":"未完成', '{"content":正文}', '{"content":"第一份"}{"content":"另一份"}', '{"content":"完整"}但是应当改成另一个内容']) {
    assert.equal(extractAiJsonObject(value), null);
  }
});
