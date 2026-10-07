'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const adaptFoundation = require('../../../scripts/foundation-adaptations.cjs');

const appRoot = path.resolve(__dirname, '..', '..');

test('foundation sidebar highlights extension pages by their stable menu key', async () => {
  const bundlePath = path.join(appRoot, 'src/renderer/foundation/vendor/assets/index-BXDL0R6w.js');
  const source = await readFile(bundlePath, 'utf8');
  const adapted = adaptFoundation(source.replace('B1.mount("#app");', ''));

  assert.match(adapted, /active:u\(l\)\.meta\.tabId===b\.tab\|\|u\(l\)\.meta\.menuKey===b\.key/u);
  const extensions = await readFile(path.join(appRoot, 'src/renderer/foundation/extensions.mjs'), 'utf8');
  assert.match(source, /key:"certificate-management",tab:"tab-certificate-management",label:"证明管理"/u);
  assert.match(extensions, /key: 'certificate-workspace',[\s\S]*?tab: 'tab-certificate-management',[\s\S]*?menuKey: 'certificate-management'/u);
  assert.match(extensions, /'tab-certificate': '\/certificate-workspace', certificate: '\/certificate-workspace'/u);
  assert.match(extensions, /meta: \{ requiresAuth: true, tabId: definition\.tab \|\| `tab-\$\{definition\.key\}`, menuKey: definition\.menuKey \|\| definition\.key \}/u);
});
