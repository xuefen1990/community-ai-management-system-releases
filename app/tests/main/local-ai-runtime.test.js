'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LocalAiRuntime } = require('../../src/main/local-ai-runtime');

test('runtime loads a GGUF model, chats, and releases resources', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modelPath = path.join(root, 'model.gguf');
  await fs.writeFile(modelPath, 'fixture');
  const disposed = [];
  class FakeSession {
    async prompt(value) { return `本地回复:${value}`; }
    async dispose() { disposed.push('session'); }
  }
  const runtime = new LocalAiRuntime({ loadModule: async () => ({
    getLlama: async () => ({ loadModel: async () => ({
      createContext: async () => ({ getSequence: () => ({}), dispose: async () => disposed.push('context') }),
      dispose: async () => disposed.push('model'),
    }) }),
    LlamaChatSession: FakeSession,
  }) });

  assert.equal((await runtime.start(modelPath)).running, true);
  assert.match((await runtime.chat([{ role: 'user', content: '你好' }])).content, /本地回复/u);
  assert.equal((await runtime.stop()).running, false);
  assert.deepEqual(disposed, ['session', 'context', 'model']);
});
