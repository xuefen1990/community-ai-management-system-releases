// Run against an already started `COMMUNITY_DEV_DEBUG=1 npm run dev`.
// This smoke check changes only temporary source comments and restores them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFile = path.join(project, 'app/.dev/runtime.json');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readState = async () => JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if (await predicate()) return; } catch { /* Electron may be between restarts */ }
    await sleep(100);
  }
  throw new Error(message);
}
async function appendMarker(file, marker) { await fs.appendFile(path.join(project, file), marker); }
async function removeMarker(file, marker) {
  const target = path.join(project, file);
  const source = await fs.readFile(target, 'utf8');
  await fs.writeFile(target, source.replace(marker, ''));
}

const report = {};
const markers = [];
try {
  const initial = await readState();
  assert.equal(initial.running, true, '请先启动开发模式');
  assert.equal(initial.baseUrl, 'http://127.0.0.1:3301');
  report.profile = initial.profile;
  report.backend = initial.baseUrl;

  const css = 'app/src/renderer/foundation/foundation.css';
  const cssMarker = '\n/* development-smoke-css */\n';
  markers.push([css, cssMarker]);
  const cssBefore = await readState();
  const cssStarted = Date.now();
  await appendMarker(css, cssMarker);
  await waitFor(async () => (await readState()).cssUpdates > cssBefore.cssUpdates, 'CSS 保存没有触发样式更新');
  const cssAfter = await readState();
  assert.equal(cssAfter.electronPid, cssBefore.electronPid, 'CSS 更新不应重启 Electron');
  report.css = { milliseconds: Date.now() - cssStarted, keptWindow: true, cssUpdateEvent: true };
  await removeMarker(css, cssMarker); markers.pop();

  const renderer = 'app/src/renderer/foundation/bootstrap.mjs';
  const rendererMarker = '\n/* development-smoke-renderer */\n';
  markers.push([renderer, rendererMarker]);
  const rendererBefore = await readState();
  const rendererStarted = Date.now();
  await appendMarker(renderer, rendererMarker);
  await waitFor(async () => (await readState()).reloads > rendererBefore.reloads, '渲染进程保存没有触发页面刷新');
  assert.equal((await readState()).electronPid, rendererBefore.electronPid, '渲染代码刷新不应重启 Electron');
  report.renderer = { milliseconds: Date.now() - rendererStarted, keptProcess: true, reloadedSource: true };
  await removeMarker(renderer, rendererMarker); markers.pop();

  for (const [label, file] of [['preload', 'app/src/preload/index.js'], ['main', 'app/src/main/development-mode.js'], ['backend', 'backend/src/index.js']]) {
    const marker = `\n// development-smoke-${label}\n`;
    markers.push([file, marker]);
    const before = await readState();
    const started = Date.now();
    await appendMarker(file, marker);
    await waitFor(async () => (await readState()).generation > before.generation, `${label} 保存没有触发 Electron 重启`);
    const after = await readState();
    assert.notEqual(after.electronPid, before.electronPid, `${label} 保存后 Electron 应重启`);
    if (label === 'backend') assert.notEqual(after.backendPid, before.backendPid, '后端保存后应重启后端');
    report[label] = { milliseconds: Date.now() - started, restarted: true };
    await removeMarker(file, marker); markers.pop();
    await waitFor(async () => (await readState()).generation > after.generation, `${label} 清理后没有重新载入`);
  }
  report.ok = true;
  await fs.writeFile(path.join(project, 'app/.dev/verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const [file, marker] of markers.reverse()) await removeMarker(file, marker).catch(() => {});
}
