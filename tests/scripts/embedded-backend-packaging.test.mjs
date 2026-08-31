import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

test('electron-builder bundles backend runtime files while excluding data and secrets', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'app', 'package.json'), 'utf8'));
  const resource = manifest.build?.extraResources?.find(item => item.to === 'backend');
  assert.ok(resource);
  assert.equal(resource.from, '../backend');
  for (const required of ['package.json', 'src/**/*', 'node_modules/**/*']) assert.ok(resource.filter.includes(required));
  for (const excluded of ['!data/**/*', '!.env*', '!**/*.log', '!tests/**/*']) assert.ok(resource.filter.includes(excluded));
});

test('the local runtime builder copies only backend code, manifest, and installed dependencies', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts', 'prepare-local-runtime.mjs'), 'utf8');
  assert.match(source, /backendRuntime/u);
  assert.match(source, /path\.join\(backendSource, 'package\.json'\)/u);
  assert.match(source, /path\.join\(backendSource, 'src'\)/u);
  assert.match(source, /path\.join\(backendSource, 'node_modules'\)/u);
  assert.doesNotMatch(source, /path\.join\(backendSource, 'data'\)/u);
  assert.doesNotMatch(source, /path\.join\(backendSource, '\.env'\)/u);
});

test('desktop build paths reject an update package missing the login encoding module', async () => {
  const [localRuntime, localBuilder, ciBuilder] = await Promise.all([
    readFile(path.join(projectRoot, 'scripts', 'prepare-local-runtime.mjs'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts', 'build-arm64-dmg.mjs'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts', 'build-ci-arm64-dmg.mjs'), 'utf8'),
  ]);
  for (const source of [localRuntime, localBuilder, ciBuilder]) {
    assert.match(source, /iconv-lite/u);
    assert.match(source, /encodings/u);
    assert.match(source, /index\.js/u);
    assert.match(source, /require\('iconv-lite\/encodings'\)/u);
  }
  for (const source of [localBuilder, ciBuilder]) {
    assert.match(source, /unzip.*-tqq/us);
    assert.match(source, /unzip.*-Z1/us);
    assert.match(source, /maxBuffer:\s*archiveListingBuffer/u);
  }
});
