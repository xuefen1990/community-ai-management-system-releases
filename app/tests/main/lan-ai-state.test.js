'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LanAiState } = require('../../src/main/lan-ai-state');

test('AI 对话与任务只写主电脑并按子账号隔离', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-ai-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = new LanAiState({ directory });
  const userA = { id: 'a', role: 'member', aiAccessEnabled: true };
  const userB = { id: 'b', role: 'member', aiAccessEnabled: true };
  const conversation = (await state.handle(userA, 'PUT', '/api/unit/workspace/ai/conversation', new URLSearchParams(), {
    messages: [{ role: 'user', content: '居民业务问题' }],
  })).conversation;
  await state.handle(userA, 'PUT', '/api/unit/workspace/ai/tasks/task-1', new URLSearchParams(), { title: '业务任务', status: 'pending' });
  assert.equal((await state.handle(userA, 'GET', '/api/unit/workspace/ai/conversation', new URLSearchParams())).conversation.id, conversation.id);
  assert.equal((await state.handle(userB, 'GET', '/api/unit/workspace/ai/conversation', new URLSearchParams())).conversation, null);
  assert.equal((await state.handle(userA, 'GET', '/api/unit/workspace/ai/tasks', new URLSearchParams())).tasks.length, 1);
  assert.equal((await state.handle(userB, 'GET', '/api/unit/workspace/ai/tasks', new URLSearchParams())).tasks.length, 0);
  assert.match(await fs.readFile(path.join(directory, 'ai-state.json'), 'utf8'), /居民业务问题/u);
});
