// Check a copy of the built standalone app using disposable synthetic accounts.
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2];
if (!baseline?.endsWith('.app')) throw Error('Pass the built .app path');
const root = await mkdtemp('/tmp/community-standalone-ui-');
const clone = path.join(root, 'Packaged QA.app');
function run(command, args) { const result = spawnSync(command, args, { encoding: 'utf8' }); if (result.status) throw Error(result.stderr || `${command} failed`); return result.stdout; }
run('/bin/cp', ['-cRp', baseline, clone]);
const appRoot = path.join(clone, 'Contents/Resources/app');
await mkdir(path.join(appRoot, 'tests/renderer'), { recursive: true });
await copyFile(path.join(project, 'app/tests/renderer/packaged-map-statistics-check.cjs'), path.join(appRoot, 'tests/renderer/packaged-map-statistics-check.cjs'));
const manifest = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
if (manifest.version !== '1.4.3') throw Error('Expected the confirmed 1.4.3 package');
manifest.main = 'tests/renderer/packaged-map-statistics-check.cjs';
await writeFile(path.join(appRoot, 'package.json'), JSON.stringify(manifest));
run('codesign', ['--force', '--deep', '--sign', '-', clone]);
const executable = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(clone, 'Contents/Info.plist')]).trim();
const portProbe = net.createServer();
await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(0,'127.0.0.1',resolve);});
const port = portProbe.address().port; await new Promise(resolve=>portProbe.close(resolve));
const env = { ...process.env, STANDALONE_ELECTRON_TEST_DIR: root, COMMUNITY_RUNTIME_MODE: 'standalone', COMMUNITY_PACKAGED_TEST_BACKEND_URL: `http://127.0.0.1:${port}` };
for (const key of ['COMMUNITY_DEV_MODE', 'COMMUNITY_DEV_USER_DATA', 'COMMUNITY_DEV_AUTH_SCREEN', 'COMMUNITY_DEV_BACKEND_URL']) delete env[key];
const child = spawn(path.join(clone, 'Contents/MacOS', executable), [], { env });
let stderr = ''; child.stderr.on('data', bytes => stderr += bytes); child.stdout.on('data', bytes => process.stdout.write(bytes));
const timer = setTimeout(() => child.kill('SIGTERM'), 115000);
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timer);
let result; try { result = JSON.parse(await readFile(path.join(root, 'result.json'), 'utf8')); } catch { throw Error(`No packaged result: ${root}: ${stderr.slice(-4000)}`); }
if (code || !result.ok) throw Error(`Packaged QA failed (${code}): ${root}: ${JSON.stringify(result)} ${stderr.slice(-4000)}`);
console.log(JSON.stringify({ root, ...result }, null, 2));
