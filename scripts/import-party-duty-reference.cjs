#!/usr/bin/env node
'use strict';
// Only the approved two modules. The source archive is read, never launched.
// Offsets are pinned to its SHA-256 so a changed bundle fails closed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('../app/node_modules/@electron/asar');
const manifest = require('./party-duty-reference-map.json');
const { adaptNode } = require('./party-duty-adaptations.cjs');
const { renameCodeLiterals } = require('./brand-terminology.cjs');
const root = path.resolve(__dirname, '..');
const archive = process.argv[2];
if (!archive) throw new Error('请提供已核对的村务通 v2.8.6 app.asar');
const source = asar.extractFile(archive, `cwt-Fe/dist/assets/${manifest.bundle}`).toString('utf8');
if (crypto.createHash('sha256').update(source).digest('hex') !== manifest.sha256) throw new Error('参考版本不一致，请先重新核对模块边界');
const local = new Set(['referenceRequest', 'useReferenceRouter', 'useReferenceRoute', 'savePartyMember', 'ensurePartyMember', 'removePartyMember']);
const bindings = [...new Set(Object.values(manifest.bindings).filter(name => !local.has(name)))];
const vendor = path.join(root, 'app/src/renderer/foundation/vendor');
const runtimePath = path.join(vendor, 'assets/foundation-runtime.mjs');
const runtime = fs.readFileSync(runtimePath, 'utf8').replace(/\nexport const reference286Bindings = [^\n]*;\n/g, '');
fs.writeFileSync(runtimePath, `${runtime}\nexport const reference286Bindings = { ${bindings.join(', ')} };\n`);
const moduleSource = `// Targeted, user-authorized migration from 村务通 v2.8.6. No reference data or app bootstrap.
import { reference286Bindings as bindings, router } from './assets/foundation-runtime.mjs';
import { referenceRequest, savePartyMember, ensurePartyMember, removePartyMember, removePartyMembers, savePartyDuesBatch, saveDutySchedule } from '../party-duty-api.mjs';
const useReferenceRouter = () => router;
const useReferenceRoute = () => router.currentRoute.value;
const { ${Object.entries(manifest.bindings).filter(([, value]) => !local.has(value)).map(([name, value]) => `${value}: ${name}`).join(', ')} } = bindings;
${Object.entries(manifest.bindings).filter(([, value]) => local.has(value)).map(([name, value]) => `const ${name} = ${value};`).join('\n')}
${manifest.nodes.map(node => (node.type === 'VariableDeclarator' ? `${node.kind || 'const'} ` : '') + adaptNode(node.name, source.slice(node.start, node.end)) + ';').join('\n')}
export { gst as PartyView286, W0t as DutyView286 };
`;
fs.writeFileSync(path.join(vendor, 'party-duty-286.mjs'), renameCodeLiterals(moduleSource));
console.log('已生成党员管理和村务值班模块；保留已核对的作用域样式。');
