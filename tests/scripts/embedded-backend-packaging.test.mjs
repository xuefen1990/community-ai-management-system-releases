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
