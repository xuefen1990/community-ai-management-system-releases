// Green-skin acceptance runner: extends the native fixture timeout for 120 route transitions.
import { access, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(project, 'app/package.json'));
const root = await mkdtemp(path.join(tmpdir(), 'community-foundation-electron-'));
const clone = path.join(root, 'Foundation Test.app');
let installed = '/Applications/村居AI管理系统.app';
try { await access(installed); } catch { installed = '/Applications/社区AI管理系统.app'; }
const copied = spawnSync('/bin/cp', ['-cRp', installed, clone], { encoding: 'utf8' });
if (copied.status) throw new Error(copied.stderr);
const fixture = path.join(root, 'fixture'); await mkdir(fixture);
await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'community-foundation-isolated-check', version: '0.0.0', main: 'main.cjs' }));
await writeFile(path.join(fixture, 'main.cjs'), `require(${JSON.stringify(path.join(project, 'app/tests/renderer/foundation-electron-check.cjs'))});`);
// Remove the clone's production entry so the only launchable application is
// this test harness, regardless of Electron's archive/directory precedence.
await rm(path.join(clone, 'Contents/Resources/app'), { recursive: true, force: true });
await require('@electron/asar').createPackage(fixture, path.join(clone, 'Contents/Resources/app.asar'));
const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', clone], { encoding: 'utf8' });
if (signed.status) throw new Error(signed.stderr);
const executable = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(clone, 'Contents/Info.plist')], { encoding: 'utf8' });
if (executable.status) throw new Error(executable.stderr);
const child = spawn(path.join(clone, 'Contents/MacOS', executable.stdout.trim()), [], { env: { ...process.env, FOUNDATION_ELECTRON_TEST_DIR: root } });
let stderr = ''; child.stderr.on('data', chunk => stderr += chunk); child.stdout.on('data', chunk => process.stdout.write(chunk));
const timer = setTimeout(() => child.kill('SIGTERM'), 160000);
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timer);
if (code) throw new Error(`Isolated Electron check failed (${code}), ${root}: ${stderr.slice(-3500)}`);
try { console.log(await readFile(path.join(root, 'result.json'), 'utf8')); }
catch { throw new Error(`Electron did not execute the harness: ${root}: ${stderr.slice(-3500)}`); }
