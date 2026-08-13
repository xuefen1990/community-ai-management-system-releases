import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectAsarEntries,
  extractAsar,
  readAsarHeader,
  safeOutputPath,
} from '../../scripts/lib/asar-reader.mjs';

function buildFixture(files) {
  const fileTree = {};
  const contentParts = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(files)) {
    const buffer = Buffer.from(contents);
    fileTree[name] = { size: buffer.length, offset: String(offset) };
    contentParts.push(buffer);
    offset += buffer.length;
  }

  const header = { files: fileTree };
  let jsonText = JSON.stringify(header);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' ';
  const jsonBuffer = Buffer.from(jsonText);
  const prologue = Buffer.alloc(16);
  prologue.writeUInt32LE(4, 0);
  prologue.writeUInt32LE(jsonBuffer.length + 8, 4);
  prologue.writeUInt32LE(jsonBuffer.length + 4, 8);
  prologue.writeUInt32LE(jsonBuffer.length, 12);

  return Buffer.concat([prologue, jsonBuffer, ...contentParts]);
}

test('safeOutputPath keeps entries inside the destination', () => {
  const root = path.join(os.tmpdir(), 'asar-safe-root');
  assert.equal(safeOutputPath(root, 'nested/file.txt'), path.join(root, 'nested/file.txt'));
  assert.throws(() => safeOutputPath(root, '../outside.txt'), /escapes output directory/u);
  assert.throws(() => safeOutputPath(root, '/tmp/outside.txt'), /Absolute ASAR entry path/u);
});

test('collectAsarEntries rejects unsafe names', () => {
  assert.throws(
    () => collectAsarEntries({ files: { '..': { size: 1, offset: '0' } } }),
    /Unsafe ASAR entry name/u,
  );
});

test('readAsarHeader and extractAsar preserve file bytes', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'asar-reader-test-'));
  const asarPath = path.join(temporaryRoot, 'fixture.asar');
  const outputPath = path.join(temporaryRoot, 'output');

  try {
    await writeFile(asarPath, buildFixture({
      'hello.txt': '你好，社区 AI',
      'binary.bin': Buffer.from([0, 1, 2, 255]),
    }));

    const metadata = await readAsarHeader(asarPath);
    assert.equal(metadata.contentOffset, 16 + metadata.jsonSize);

    const result = await extractAsar(asarPath, outputPath);
    assert.equal(result.files, 2);
    assert.equal(await readFile(path.join(outputPath, 'hello.txt'), 'utf8'), '你好，社区 AI');
    assert.deepEqual(await readFile(path.join(outputPath, 'binary.bin')), Buffer.from([0, 1, 2, 255]));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('extractAsar rejects entries that exceed archive bounds', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'asar-bounds-test-'));
  const asarPath = path.join(temporaryRoot, 'invalid.asar');
  const outputPath = path.join(temporaryRoot, 'output');
  const fixture = buildFixture({ 'bad.txt': 'x' });

  try {
    const jsonSize = fixture.readUInt32LE(12);
    const header = JSON.parse(fixture.subarray(16, 16 + jsonSize).toString().trimEnd());
    header.files['bad.txt'].size = 1000;
    let jsonText = JSON.stringify(header);
    while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' ';
    const jsonBuffer = Buffer.from(jsonText);
    const prologue = Buffer.alloc(16);
    prologue.writeUInt32LE(4, 0);
    prologue.writeUInt32LE(jsonBuffer.length + 8, 4);
    prologue.writeUInt32LE(jsonBuffer.length + 4, 8);
    prologue.writeUInt32LE(jsonBuffer.length, 12);
    await writeFile(asarPath, Buffer.concat([prologue, jsonBuffer, Buffer.from('x')]));

    await assert.rejects(() => extractAsar(asarPath, outputPath), /exceeds archive bounds/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

