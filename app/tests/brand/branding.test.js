'use strict';

const assert = require('node:assert/strict');
const { access, readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const adaptFoundation = require('../../../scripts/foundation-adaptations.cjs');

const appRoot = path.resolve(__dirname, '..', '..');

test('active foundation entry uses the new product name and retired entries are absent', async () => {
  const contents = await readFile(path.join(appRoot, 'src', 'renderer', 'foundation', 'index.html'), 'utf8');
  assert.doesNotMatch(contents, /村务通管理系统|村务通/u);
  assert.match(contents, /村居AI管理系统/u);
  for (const file of ['index.html', 'mobile_upload.html']) {
    await assert.rejects(access(path.join(appRoot, 'src', 'renderer', file)), { code: 'ENOENT' });
  }
});

test('active foundation keeps the AI assistant entry', async () => {
  const contents = await readFile(path.join(appRoot, 'src', 'renderer', 'foundation', 'floating-assistant.mjs'), 'utf8');
  assert.match(contents, /AI 助理/u);
});

test('brand deliverables exist', async () => {
  await access(path.join(appRoot, 'assets', 'brand', 'icon-1024.png'));
  await access(path.join(appRoot, 'assets', 'brand', 'logo-transparent.png'));
  await access(path.join(appRoot, 'build', 'icon.icns'));
  await access(path.join(appRoot, 'src', 'renderer', 'foundation', 'vendor', 'community-logo.png'));
});

test('the active foundation shell uses the resident label and current community logo', async () => {
  const assetDir = path.join(appRoot, 'src', 'renderer', 'foundation', 'vendor', 'assets');
  const bundlePath = path.join(assetDir, 'index-BXDL0R6w.js');
  const runtimePath = path.join(assetDir, 'foundation-runtime.mjs');
  const source = await readFile(bundlePath, 'utf8');
  const adapted = adaptFoundation(source.replace('B1.mount("#app");', ''));
  assert.equal(adapted.includes('村民一户一档'), false, 'the active shell must not restore the old section name');
  assert.equal(adapted.includes('村民“一户一档”档案库'), false, 'the active shell must not restore the old resident archive heading');
  assert.match(adapted, /居民一户一档/u);
  assert.match(adapted, /居民“一户一档”档案库/u);
  assert.match(adapted, /new URL\("\.\.\/community-logo\.png",import\.meta\.url\)/u);
  const runtime = await readFile(runtimePath, 'utf8');
  assert.equal(runtime.includes('村民一户一档'), false, 'the actual renderer runtime must carry the updated label');
  assert.match(runtime, /new URL\("\.\.\/community-logo\.png",import\.meta\.url\)/u);
});

test('all renderer community logo copies match the approved transparent brand asset', async () => {
  const expected = await readFile(path.join(appRoot, 'assets', 'brand', 'logo-transparent.png'));
  const copies = [
    path.join(appRoot, 'src', 'renderer', 'foundation', 'vendor', 'community-logo.png'),
    path.join(appRoot, 'src', 'renderer', 'foundation', 'vendor', 'assets', 'community-logo.png'),
  ];
  for (const file of copies) assert.deepEqual(await readFile(file), expected, `${path.relative(appRoot, file)} must match the brand source`);
});
