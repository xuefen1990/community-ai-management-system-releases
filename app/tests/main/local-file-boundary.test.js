'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assertLocalDataPath } = require('../../src/main/local-file-boundary');

test('local file boundary accepts archived files and rejects traversal and escaping symlinks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-file-boundary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  await fs.mkdir(data);
  const inside = path.join(data, 'archive.txt');
  const outside = path.join(root, 'outside.txt');
  await fs.writeFile(inside, 'archive');
  await fs.writeFile(outside, 'outside');
  await fs.symlink(outside, path.join(data, 'shortcut.txt'));

  assert.equal(await assertLocalDataPath(data, inside), inside);
  await assert.rejects(assertLocalDataPath(data, outside), /应用数据目录/u);
  await assert.rejects(assertLocalDataPath(data, path.join(data, '..', 'outside.txt')), /应用数据目录/u);
  await assert.rejects(assertLocalDataPath(data, path.join(data, 'shortcut.txt')), /应用数据目录/u);
  await assert.rejects(assertLocalDataPath(data, '../relative.txt'), /绝对路径/u);
});
