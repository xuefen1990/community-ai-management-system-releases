'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('update UI uses the preload bridge and waits for user confirmation before download', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');
  assert.match(source, /onAppUpdateStatus/u);
  assert.match(source, /downloadAppUpdate/u);
  assert.match(source, /installAppUpdate/u);
  assert.match(source, /立即更新/u);
  assert.match(source, /暂不更新/u);
  assert.match(source, /installation-required/u);
  assert.match(source, /release-mismatch/u);
  assert.match(source, /backend-unavailable/u);
  assert.match(source, /当前已是最新版本/u);
  assert.match(source, /完成后将自动安装并打开新版/u);
  assert.doesNotMatch(source, /重启并安装/u);
  assert.match(source, /function formatReleaseNotes\(value\)/u);
  assert.match(source, /replace\(\/<li\\b\[\^>\]\*>\/giu, '• '\)/u);
  assert.match(source, /replace\(\/<\[\^>\]\+>\/gu, ''\)/u);
  assert.match(source, /textContent = formatReleaseNotes\(status\.releaseNotes\)/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('manual update check shows a loading state and always restores the button', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');

  assert.match(source, /function setManualCheckButtonState\(/u);
  assert.match(source, /button\.classList\.toggle\('is-checking', checking\)/u);
  assert.match(source, /button\.setAttribute\('aria-busy', String\(checking\)\)/u);
  assert.match(source, /try\s*\{[\s\S]*api\.checkForAppUpdate\(\)[\s\S]*\}\s*finally\s*\{[\s\S]*setManualCheckButtonState\(button, false\)/u);
});

test('startup update check subscribes first, checks once per launch and never installs automatically', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');
  const values = new Map(); let checks = 0, subscribed = false, downloads = 0, installs = 0;
  const run = async storage => {
    const callbacks = [];
    vm.runInNewContext(source, {
      window: { api: { onAppUpdateStatus: () => { subscribed = true; }, checkForAppUpdate: async () => { assert.equal(subscribed, true); checks++; return {ok:true,hasUpdate:true}; }, downloadAppUpdate: () => downloads++, installAppUpdate: () => installs++ } },
      document: {readyState:'complete',getElementById:()=>null,querySelector:()=>null},
      sessionStorage: storage, setTimeout: callback => callbacks.push(callback),
    });
    for (const callback of callbacks) callback();
    await new Promise(resolve => setImmediate(resolve));
  };
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  await run(storage); await run(storage); assert.equal(checks,1);
  values.clear(); subscribed=false; await run(storage); assert.equal(checks,2);
  assert.equal(downloads,0); assert.equal(installs,0);
});

test('startup check failure leaves manual updating available', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');
  let subscriptions=0,checks=0;
  vm.runInNewContext(source, {
    window:{api:{onAppUpdateStatus:()=>subscriptions++,checkForAppUpdate:async()=>{checks++;throw Error('synthetic offline');}}},
    document:{readyState:'complete',getElementById:()=>null,querySelector:()=>null},
    sessionStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:callback=>callback(),
  });
  await new Promise(resolve=>setImmediate(resolve));assert.equal(subscriptions,1);assert.equal(checks,1);
});
