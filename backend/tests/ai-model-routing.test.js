'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { selectModel } = require('../src/services/aiModelRouting');

const provider = {
  defaultModel: 'deepseek-chat',
  availableModels: ['deepseek-chat', 'deepseek-reasoner'],
};

test('基础任务优先选择普通对话模型', () => {
  assert.equal(selectModel(provider, '', 'basic'), 'deepseek-chat');
});

test('深度任务优先选择推理模型', () => {
  assert.equal(selectModel(provider, '', 'deep'), 'deepseek-reasoner');
});

test('明确指定且可用的模型保持不变', () => {
  assert.equal(selectModel(provider, 'deepseek-chat', 'deep'), 'deepseek-chat');
});

test('图片理解任务使用单独配置的视觉模型', () => {
  assert.equal(selectModel({ ...provider, supportsVision: true, visionModel: 'vision-pro' }, '', 'deep', 'vision-document-review'), 'vision-pro');
});

test('未启用图片理解时给出明确提示', () => {
  assert.throws(() => selectModel(provider, '', 'deep', 'vision-document-review'), /未启用图片理解能力/u);
});
