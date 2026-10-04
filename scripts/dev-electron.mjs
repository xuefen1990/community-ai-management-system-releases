#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepareProfile } from './dev/profile.mjs';
import { refreshFoundation } from './dev/foundation.mjs';
import { ensureElectronRuntime } from './dev/runtime.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(project, 'package.json'));
const stateDirectory = path.join(project, 'app/.dev');
const profile = path.resolve(process.env.COMMUNITY_DEV_USER_DATA || path.join(stateDirectory, 'user-data'));
const port = Number(process.env.COMMUNITY_DEV_PORT || 3301);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) throw new Error('开发端口必须为 1024–65535，且不能使用正式端口 3000');
const baseUrl = `http://127.0.0.1:${port}`;
const remoteServerUrl = process.env.COMMUNITY_DEV_REMOTE_SERVER_URL || baseUrl;
await fsp.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const logFile = path.join(stateDirectory, 'dev.log');
const stateFile = path.join(stateDirectory, 'runtime.json');
const lockFile = path.join(stateDirectory, 'dev.lock');
let ownsLock = false;
async function acquireLock() {
  try {
    const previous = JSON.parse(await fsp.readFile(lockFile, 'utf8'));
    try { process.kill(previous.pid, 0);throw new Error('开发模式已经运行，请使用已打开的开发窗口；不要重复启动。'); }
    catch(error) { if(error.code !== 'ESRCH')throw error; }
    await fsp.unlink(lockFile);
  } catch(error) { if(error.code !== 'ENOENT')throw error; }
  const handle = await fsp.open(lockFile, 'wx', 0o600);
  await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();ownsLock=true;
}
const state = { supervisorPid: process.pid, electronPid: null, backendPid: null, generation: 0, reloads: 0, cssUpdates: 0, baseUrl, profile, running: true };
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
function log(message) { const line = `[dev ${new Date().toLocaleTimeString()}] ${message}`;console.log(line);fs.appendFileSync(logFile, line + '\n'); }
let electron, backend, stopping = false, restarting = false, restartRequested = false, timer;
const watchers = [];
const changed = new Set();
function pipe(child, name) {
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { process.stdout.write(`[${name}] ${chunk}`);fs.appendFileSync(logFile, `[${name}] ${chunk}`); });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', () => reject(new Error(`开发端口 ${port} 已被占用；不会连接其他服务。请关闭旧开发版或设置 COMMUNITY_DEV_PORT。`)));server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const done = () => { clearTimeout(timeout);resolve(); };
    const timeout = setTimeout(() => { log(`${label} 退出超时，终止此开发进程`);child.kill('SIGKILL'); }, 8000);
    child.once('exit', done);
    if (label === 'Electron' && child.connected) child.send({ type: 'community-dev', action: 'quit' });
    else child.kill('SIGTERM');
  });
}
async function startBackend() {
  await freePort();
  const secret = (await fsp.readFile(path.join(profile, 'backend/service-secret'), 'utf8')).trim();
  backend = spawn(process.execPath, [path.join(project, 'backend/src/index.js')], {
    cwd: profile,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(profile, 'backend/backend.db'), UPDATE_FILES_DIR: path.join(profile, 'backend/updates'), JWT_SECRET: secret, ADMIN_PASSWORD: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.backendPid = backend.pid;saveState();pipe(backend, 'backend');
  let launchError;
  backend.once('error', error => { launchError = error; });
  backend.once('exit', () => { if(!stopping && !restarting){ log('开发后端已退出，修复代码并保存后会重试');state.backendPid=null;saveState();} });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (backend.exitCode !== null) throw new Error('开发后端启动失败，请查看终端日志');
    try { const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });const body = await response.json();if (response.ok && body.service === 'community-ai-backend') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('开发后端启动超时');
}
function startElectron(executable) {
  const env = { ...process.env, NODE_ENV: 'development', COMMUNITY_DEV_MODE: '1', COMMUNITY_DEV_USER_DATA: profile, COMMUNITY_DEV_BACKEND_URL: baseUrl, COMMUNITY_DEV_REMOTE_SERVER_URL: remoteServerUrl, COMMUNITY_DEV_TOOLS: process.argv.includes('--devtools') ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [path.join(project, 'app')];
  if (process.env.COMMUNITY_DEV_DEBUG === '1') args.unshift('--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1');
  electron = spawn(executable, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  state.electronPid = electron.pid;state.generation++;saveState();pipe(electron, 'electron');
  electron.on('message', message => {
    if(message?.type !== 'community-dev') return;
    if(message.event === 'renderer-ready') { state.reloads++;state.url=message.url;log('页面已就绪'); }
    if(message.event === 'css-updated') { state.cssUpdates++;log('样式已更新'); }
    saveState();
  });
  electron.on('error', error => log(`Electron 启动失败：${error.message}`));
  electron.on('exit', (code, signal) => {
    if(stopping || restarting) return;
    state.electronPid=null;saveState();
    if(code === 0 && !signal) void shutdown(0);
    else log('Electron 已退出；文件监听仍在运行，修复代码并保存会重新启动。');
  });
  log(`已启动开发版，进程 ${electron.pid}（第 ${state.generation} 次）`);
}
async function restart(executable, includeBackend) {
  if(restarting){restartRequested=true;return;}
  restarting=true;
  try {
    await stopChild(electron, 'Electron');
    if(stopping)return;
    if(includeBackend || !backend || backend.exitCode !== null) { await stopChild(backend, '后端');await startBackend(); }
    startElectron(executable);
  } finally { restarting=false; }
}
async function handleChanges(executable) {
  if(stopping)return;
  if(restarting){timer=setTimeout(()=>handleChanges(executable),300);return;}
  const files = [...changed];changed.clear();
  if(!files.length)return;
  try {
    log(`检测到保存：${files.map(file=>path.relative(project,file)).join('、')}`);
    if(files.some(file=>file.endsWith('foundation-adaptations.cjs'))) await refreshFoundation(project);
    const backendChanged = files.some(file=>file.startsWith(path.join(project,'backend')));
    const mustRestart = backendChanged || files.some(file=>/[/\\]src[/\\](main|preload|shared|legacy)[/\\]/.test(file) || file.endsWith('package.json'));
    if(mustRestart || !electron || electron.exitCode !== null || electron.signalCode !== null) await restart(executable,backendChanged);
    else if(electron.connected) electron.send({ type:'community-dev',action:'reload',files });
    if(restartRequested){restartRequested=false;await restart(executable,true);}
  } catch(error){log(`刷新失败，修复后保存会重试：${error.stack || error}`);}
}
function watch(directory, executable, recursive = true) {
  const watchedPath = recursive ? directory : path.dirname(directory);
  const watcher = fs.watch(watchedPath, { recursive }, (_event, filename) => {
    if (!filename || stopping || (!recursive && filename.toString() !== path.basename(directory))) return;
    const file = recursive ? path.join(directory, filename.toString()) : directory;
    if (!/\.(html|css|js|mjs|cjs|json|vue|ts|tsx|jsx|png|jpg|svg)$/.test(file)) return;
    changed.add(file);clearTimeout(timer);timer=setTimeout(()=>handleChanges(executable),350);
  });
  watcher.on('error', error=>log(`文件监听异常：${error.message}`));watchers.push(watcher);
}
async function shutdown(code = 0) {
  if(stopping)return;stopping=true;clearTimeout(timer);watchers.forEach(watcher=>watcher.close());
  await stopChild(electron,'Electron');await stopChild(backend,'后端');
  if(ownsLock){state.running=false;state.electronPid=null;state.backendPid=null;saveState();await fsp.unlink(lockFile).catch(()=>{});ownsLock=false;log('开发模式已停止');}process.exitCode=code;
}
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
try {
  await acquireLock();
  let executable;
  try {
    executable = require('electron');
  } catch (error) {
    throw new Error(`Electron 开发运行时尚未安装，请先执行 npm run dev:setup：${error.message}`);
  }
  await ensureElectronRuntime(executable, log);
  await freePort();
  const result = await prepareProfile({ project, profile, fresh: process.argv.includes('--fresh') });
  log(result.initialized ? '已建立独立开发数据副本，之后不会自动覆盖' : '使用现有开发数据副本');
  log(`数据：${profile}\n本地开发后端：${baseUrl}\n远程账号与业务服务：${remoteServerUrl}\n保存 CSS 自动更新；页面脚本自动刷新；主进程/preload 自动重启。Ctrl+C 停止。`);
  await refreshFoundation(project);
  await startBackend();
  for(const directory of ['app/src','backend/src'])watch(path.join(project,directory),executable);
  for(const file of ['app/package.json','scripts/foundation-adaptations.cjs'])watch(path.join(project,file),executable,false);
  startElectron(executable);
} catch(error){log(error.stack || error.message);await shutdown(1);}
