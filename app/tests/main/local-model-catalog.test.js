'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LocalModelCatalog } = require('../../src/main/local-model-catalog');

test('GGUF files can be imported and scanned while unrelated files are ignored', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'qwen-test.gguf');
  await fs.writeFile(source, 'GGUF fixture');
  const catalog = new LocalModelCatalog({ userDataPath: path.join(root, 'userdata') });
  await catalog.importFile(source);
  await fs.writeFile(path.join(catalog.modelsDirectory, 'notes.txt'), 'ignore me');

  const models = await catalog.scan();
  assert.equal(models.length, 1);
  assert.equal(models[0].name, 'qwen-test.gguf');
  assert.equal(models[0].size, 12);
});

test('manual import rejects files that are not GGUF models', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const catalog = new LocalModelCatalog({ userDataPath: root });
  await assert.rejects(() => catalog.importFile(path.join(root, 'model.bin')), /\.gguf/u);
});
