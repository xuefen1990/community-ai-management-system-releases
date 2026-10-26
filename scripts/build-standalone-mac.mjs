#!/usr/bin/env node
// Build a full standalone DMG from a verified prior standalone runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2];
if (!baseline || !baseline.endsWith('.app')) throw Error('Usage: node scripts/build-standalone-mac.mjs <verified-standalone-baseline.app>');
const manifest = JSON.parse(await fs.readFile(path.join(project,'app/package.json'),'utf8'));
const previous = JSON.parse(await fs.readFile(path.join(baseline,'Contents/Resources/app/package.json'),'utf8'));
if (JSON.stringify(previous.dependencies) !== JSON.stringify(manifest.dependencies)) throw Error('Dependency changes require a fresh full runtime build');
const runtime = path.join(project,'app/.runtime/村居AI管理系统.app');
const staging = path.join(project,'app/.standalone-dmg-root');
const output = path.join(project,'app/release',`村居AI管理系统-${manifest.version}-arm64.dmg`);
function run(command,args,cwd=project) { const r=spawnSync(command,args,{cwd,stdio:'inherit'});if(r.status) throw Error(`${command} failed: ${r.status}`); }
await fs.rm(path.dirname(runtime),{recursive:true,force:true}); await fs.mkdir(path.dirname(runtime),{recursive:true});
run('/bin/cp',['-cRp',baseline,runtime]);
async function writable(dir) { for(const e of await fs.readdir(dir,{withFileTypes:true})) {const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;const stat=await fs.stat(p);await fs.chmod(p,stat.mode|0o600|(e.isDirectory()?0o100:0));if(e.isDirectory()) await writable(p);} }
await writable(runtime);
const resources=path.join(runtime,'Contents/Resources');
for(const rel of ['app/src','backend/src']) {await fs.rm(path.join(resources,rel),{recursive:true,force:true});await fs.cp(path.join(project,rel),path.join(resources,rel),{recursive:true,verbatimSymlinks:true});}
for(const rel of ['app/package.json','backend/package.json']) await fs.copyFile(path.join(project,rel),path.join(resources,rel));
const info=path.join(runtime,'Contents/Info.plist');
run('/usr/libexec/PlistBuddy',['-c',`Set :CFBundleShortVersionString ${manifest.version}`,info]);
run('/usr/libexec/PlistBuddy',['-c',`Set :CFBundleVersion ${manifest.version}`,info]);
run(process.execPath,['-e',"for(const n of Object.keys(require('./package.json').dependencies))require.resolve(n);"],path.join(resources,'app'));
run(process.execPath,['-e',"require('express');require('body-parser');require('iconv-lite/encodings');"],path.join(resources,'backend'));
run('xattr',['-cr',runtime]);
run('codesign',['--force','--deep','--sign','-',runtime]);
run('codesign',['--force','--sign','-','-r=designated => identifier \"com.community.ai.management\"',runtime]);
run('codesign',['--verify','--deep','--strict','--verbose=2',runtime]);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.rm(staging,{recursive:true,force:true});await fs.mkdir(staging,{recursive:true});
run('/bin/cp',['-cRp',runtime,path.join(staging,path.basename(runtime))]);await fs.symlink('/Applications',path.join(staging,'Applications'));
run('hdiutil',['create','-volname','村居AI管理系统','-srcfolder',staging,'-ov','-format','UDZO',output]);
await fs.rm(staging,{recursive:true,force:true});console.log(JSON.stringify({version:manifest.version,output,runtime}));
