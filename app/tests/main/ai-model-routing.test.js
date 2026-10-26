'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAiTask, classifyWritingTask, defaultAiMaxTokens } = require('../../src/main/ai-model-routing');
const request = content => [{ role: 'system', content: '模板含合同、协议字段；必须全面核对并保留缺项。' }, { role: 'user', content }];

test('ordinary reports, notices, proof writing and polishing do not trigger deep reasoning', () => {
  for (const content of ['拟写全面开展卫生整治的工作报告', '写一份会议通知', '起草亲属关系证明', '润色这份工作总结']) {
    assert.equal(classifyAiTask({ messages: request(content) }), 'basic');
  }
  for (const taskKind of ['document-draft', 'document-rewrite', 'certificate-draft', 'long-form-generation']) {
    assert.equal(classifyAiTask({ messages: request('拟写工作报告'), taskKind }), 'basic');
  }
});

test('contracts, explicit reasoning and cross-module/multiple-reference analysis retain deep mode', () => {
  for (const content of ['写一份服务合同', '深入分析后拟写报告', '综合分析居民、土地和资金', '对比多份文件并写报告']) {
    assert.equal(classifyAiTask({ messages: request(content) }), 'deep');
  }
  assert.equal(classifyWritingTask({ documentKind: 'contract', instructions: '只修改金额' }), 'deep');
  assert.equal(classifyWritingTask({ referenceCount: 2, instructions: '整理工作报告' }), 'deep');
  assert.equal(classifyWritingTask({ referenceCount: 1, instructions: '整理工作报告' }), 'basic');
  assert.equal(classifyAiTask({ taskKind: 'cross-module-analysis' }), 'deep');
  assert.equal(classifyAiTask({ taskKind: 'multi-file-review' }), 'deep');
  assert.equal(classifyAiTask({ messages: request('深入分析'), requestedTier: 'basic' }), 'basic');
});

test('writing keeps the original output budget while normal chat remains bounded', () => {
  assert.equal(defaultAiMaxTokens({ messages: request('写一份工作报告') }), 4096);
  assert.equal(defaultAiMaxTokens({ taskKind: 'document-draft' }), 4096);
  assert.equal(defaultAiMaxTokens({ taskKind: 'certificate-draft' }), 2400);
  assert.equal(defaultAiMaxTokens({ messages: request('你好') }), 1200);
  assert.equal(defaultAiMaxTokens({ taskTier: 'deep' }), 4096);
});
