#!/usr/bin/env node
'use strict';
// Import a user-supplied reference front end; never execute the reference app's main process.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('../app/node_modules/@electron/asar');
const adaptFoundation = require('./foundation-adaptations.cjs');
const archive = process.argv[2];
if (!archive) throw new Error('请提供 v2.6.4 app.asar 的本机路径');
const project = path.resolve(__dirname, '..');
const target = path.join(project, 'app/src/renderer/foundation/vendor');
const prefix = '/cwt-Fe/dist/';
const files = asar.listPackage(archive).filter(name => name.startsWith(prefix) && /\.(js|css|png|jpg)$/u.test(name));
const manifest = [];
for (const name of files) {
  const relative = name.slice(prefix.length);
  if (relative.includes('..')) throw new Error('非法资源路径');
  const bytes = asar.extractFile(archive, name.slice(1));
  const destination = path.join(target, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  manifest.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const original = manifest.find(file => /^assets\/index-.*\.js$/u.test(file.path));
if (!original) throw new Error('未找到新版基础前端');
const source = fs.readFileSync(path.join(target, original.path), 'utf8');
const mount = 'B1.mount("#app");';
if (source.split(mount).length !== 2) throw new Error('基础挂载入口发生变化，需要重新核对');
const extensionExports = '\nexport { QNe as statisticsFinanceChart, ss as ChartCard, B1 as app, Av as router, _9 as pinia, Yht as authGate, Ult as backupPanel, out as accountPanel, yut as aiSettingsPanel, krt as lanPanel, Od as useAppStore, cm as useAuthStore, nC as usePersonnelStore, jr as useOverviewStore, fa as useDialogStore, L1 as useThemeStore, d as createElementVNode, zt as onMounted, ka as onBeforeUnmount, O as computed, B as ref, Aut as settingsView, nlt as basicPanel, Qlt as menuPanel, uot as dictionaryPanel, lit as specialPanel, Bit as logsPanel, S as createVNode };\n';
// Keep the module beside its assets: the original uses new URL(..., import.meta.url).
const referenceMapPath = path.join(__dirname, 'party-duty-reference-map.json');
let referenceExports = '';
if (fs.existsSync(referenceMapPath)) {
  const local = new Set(['referenceRequest', 'useReferenceRouter', 'useReferenceRoute', 'savePartyMember', 'ensurePartyMember', 'removePartyMember']);
  const names = [...new Set(Object.values(require(referenceMapPath).bindings).filter(name => !local.has(name)))];
  referenceExports = `\nexport const reference286Bindings = { ${names.join(', ')} };\n`;
}
fs.writeFileSync(path.join(target, 'assets/foundation-runtime.mjs'), adaptFoundation(source.replace(mount, '')) + extensionExports + referenceExports);
fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify({ version: '2.6.4', originalBundle: original.path, css: manifest.find(file => /^assets\/index-.*\.css$/u.test(file.path)).path, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), files: manifest }, null, 2)+'\n');
console.log(JSON.stringify({ imported: files.length, frontendVersion: '2.6.4', output: target }));
