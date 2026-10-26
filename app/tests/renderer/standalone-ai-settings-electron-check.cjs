'use strict';
// Real renderer + native settings handlers; only synthetic data and a fake provider.
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { AiSettingsStore } = require('../../src/main/ai-settings-store');
const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const root = process.env.AI_SETTINGS_ELECTRON_TEST_DIR;
if (!root || !/[/\\]community-ai-settings-check-[^/\\]+$/.test(path.resolve(root))) throw Error('Disposable synthetic test directory required');
app.setPath('userData', path.join(root, 'profile'));
app.setLoginItemSettings = () => {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = { role: 'main_account', providerFailure: false, scanFailure: false, encryption: true, canceledImport: true, providerCalls: 0, scans: 0, legacyUsageCalls: 0, runtime: { running: false } };
const errors = [], publicRequests = [];
const timer = setTimeout(() => app.exit(2), 90000);
app.whenReady().then(async () => {
  let window;
  try {
    session.defaultSession.webRequest.onBeforeRequest((request, done) => {
      const publicRequest = /^https?:/.test(request.url);
      if (publicRequest) publicRequests.push(new URL(request.url).origin);
      done({ cancel: publicRequest });
    });
    const store = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
    await store.write({ settings: { villageName: 'AI 配置测试社区' }, personnel: [] });
    const safeStorage = { isEncryptionAvailable: () => state.encryption, encryptString: value => Buffer.from('encrypted-fixture:' + value), decryptString: value => value.toString().slice('encrypted-fixture:'.length) };
    const aiSettingsStore = new AiSettingsStore({ userDataPath: app.getPath('userData'), safeStorage });
    await aiSettingsStore.save({ mode: 'online', online: { baseUrl: '', model: '' } });
    const account = () => ({ id: 'fixture-owner', mainAccountId: 'fixture-owner', role: state.role, name: '合成测试账号', phone: '18800000000', permissions: { settings: ['view'] } });
    const authService = {
      mode: 'standalone', session: { token: 'fixture', user: account() },
      request: async route => { if (route.startsWith('/ai/usage/detail')) state.legacyUsageCalls++; return route === '/ai/quota' ? { billingUnit: 'provider' } : {}; },
      getStatus: async () => ({ mode: 'standalone', authenticated: true, entitlement: { type: 'licensed' }, account: account() }),
      getServerConfig: async () => ({ mode: 'standalone', baseUrl: 'http://127.0.0.1:1' }),
      getLoginPrefill: async () => ({ phone: '', password: '' }),
    };
    registerCompatibilityHandlers({ app, BrowserWindow, ipcMain, dialog: { ...dialog, showOpenDialog: async () => ({ canceled: state.canceledImport, filePaths: [path.join(root, 'models/test.gguf')] }) }, databaseStore: store, authService, aiSettingsStore,
      shell: { openPath: async () => '' },
      modelCatalog: { scan: async () => { state.scans++; if (state.scanFailure) throw Error('fixture scan failure'); return [{ name: '合成模型', path: path.join(root, 'models/test.gguf') }]; }, importFile: async file => ({ model: { path: file } }) },
      localAiRuntime: { getStatus: async () => state.runtime, toggle: async input => { state.runtime = { running: input.action === 'start' }; return state.runtime; } },
      aiRouter: { onlineChat: async () => { state.providerCalls++; await pause(80); if (state.providerFailure) throw Error('合成服务连接失败'); return { content: '合成连接成功' }; }, getOnlineCapabilities: async () => ({ supportsVision: false }) },
    });
    ipcMain.handle('check-for-app-update', async () => ({ ok: true, disabled: true }));
    ipcMain.removeHandler('get-lan-share-info');
    ipcMain.handle('get-lan-share-info', async () => ({ enabled: false, connection: { status: 'online', baseUrl: 'https://192.168.0.2:3300' } }));
    for (const [channel, value] of Object.entries({ 'get-ai-assistant-conversation': { messages: [] }, 'list-ai-assistant-files': [], 'list-ai-assistant-operations': [] })) ipcMain.handle(channel, async () => value);
    window = new BrowserWindow({ show: false, width: 1600, height: 900, titleBarStyle: 'hiddenInset', webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: false, nodeIntegration: false, webSecurity: true, preload: path.resolve(__dirname, '../../src/preload/index.js') } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await window.loadFile(path.resolve(__dirname, '../../src/renderer/foundation/index.html'));
    const js = code => window.webContents.executeJavaScript(code);
    const until = async (code, label) => { for (let n = 0; n < 200; n++) { if (await js(code)) return; await pause(50); } throw Error('Timeout: ' + label); };
    const route = async tab => { await js(`import(new URL('foundation/bootstrap.mjs',document.baseURI).href).then(m=>m.foundation.router.push('/settings?tab=${tab}'))`); };
    const open = async () => { await route('basic'); await pause(120); await route('ai-assistant'); await until("document.querySelector('#standalone-ai-url') && !document.querySelector('[data-testid=standalone-ai-save]').disabled", 'AI settings'); };
    const click = async name => { await js(`document.querySelector('[data-testid="standalone-ai-${name}"]').click()`); };
    const fill = async (name, value) => js(`(()=>{const e=document.getElementById('standalone-ai-${name}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const settled = () => until("document.querySelector('[data-testid=standalone-ai-settings]').getAttribute('aria-busy')==='false'", 'operation finished');
    const message = () => js("document.querySelector('[data-testid=standalone-ai-message]')?.textContent || ''");
    await open();
    assert.equal(await js("document.querySelector('[data-testid=standalone-ai-save]').classList.contains('is-primary')"), true);
    assert.equal(await js("document.querySelector('[data-testid=standalone-ai-save]').getBoundingClientRect().height>=38"), true);
    assert.equal(state.legacyUsageCalls, 0, 'standalone settings must not request legacy cloud usage');
    assert.equal(state.providerCalls, 0, 'opening settings must never call a model');
    assert.equal(await js("document.querySelector('[data-testid=standalone-ai-local]').open"), false);
    await fill('url', ''); await click('test'); await settled(); assert.match(await message(), /服务地址/); assert.equal(state.providerCalls, 0);
    await fill('url', 'https://provider.invalid/v1'); await fill('model', 'fixture-model'); await fill('key', 'synthetic-key-only');
    await js("document.querySelector('.standalone-ai-key-toggle').click()");
    assert.equal(await js("document.getElementById('standalone-ai-key').type"), 'text');
    await click('save'); await settled(); assert.equal(state.providerCalls, 0);
    assert.equal(await js("document.getElementById('standalone-ai-key').value"), '');
    assert.equal(await js("document.getElementById('standalone-ai-key').type"), 'password');
    assert.equal((await aiSettingsStore.getOnlineCredentials()).apiKey, 'synthetic-key-only');
    const previousEncrypted = (await aiSettingsStore.readRaw()).online.encryptedApiKey;
    await fill('model', 'fixture-second'); await click('save'); await settled();
    assert.equal((await aiSettingsStore.readRaw()).online.encryptedApiKey, previousEncrypted, 'blank preserves saved key');
    await open(); assert.equal(await js("document.getElementById('standalone-ai-model').value"), 'fixture-second');
    await js("document.querySelector('[data-testid=standalone-ai-test]').click();document.querySelector('[data-testid=standalone-ai-test]').click()");
    await settled(); assert.equal(state.providerCalls, 1, 'one test request despite rapid duplicate click');
    assert.match(await message(), /连接成功/);
    state.providerFailure = true; await click('test'); await settled();
    assert.match(await message(), /合成服务连接失败/); assert.equal(state.providerCalls, 2); state.providerFailure = false;
    await fill('url', 'http://provider.invalid/v1'); await fill('key', 'unsaved-fixture-key');
    await click('test'); await settled(); assert.match(await message(), /HTTPS/); assert.equal(state.providerCalls, 2);
    assert.equal((await aiSettingsStore.readRaw()).online.encryptedApiKey, previousEncrypted, 'invalid save preserves original');
    assert.equal(await js("document.getElementById('standalone-ai-key').value"), 'unsaved-fixture-key', 'failed save keeps the edit available for correction');
    await open(); await click('mode-local');
    await until("document.querySelector('[data-testid=standalone-ai-local]').open", 'local panel expanded');
    await click('import'); await settled(); assert.equal(await js("document.getElementById('standalone-ai-local-path').value"), '');
    state.canceledImport = false; await click('import'); await settled(); await click('toggle'); await settled(); assert.equal(state.runtime.running, true);
    await click('save'); await settled(); assert.equal((await aiSettingsStore.getPublicSettings()).mode, 'local');
    await click('toggle'); await settled(); assert.equal(state.runtime.running, false);
    await click('mode-online'); await click('save'); await settled();
    state.scanFailure = true; await open(); assert.equal(await js("document.getElementById('standalone-ai-url').disabled"), false); state.scanFailure = false;
    state.encryption = false; await fill('key', 'session-fixture-only'); await click('save'); await settled(); assert.match(await message(), /仅在本次/); assert.equal((await aiSettingsStore.getPublicSettings()).online.keyStorage, 'session');
    state.encryption = true; await fill('key', 'synthetic-key-only'); await click('save'); await settled();
    assert.equal((await aiSettingsStore.getPublicSettings()).online.keyStorage, 'secure');
    const screenshots = [], layouts = [];
    await open();
    for (const [width, height, zoom] of [[1600,900,1],[1080,680,1],[1080,680,1.15]]) {
      window.setContentSize(width,height); window.webContents.setZoomFactor(zoom); await pause(180);
      await js("(()=>{for(let e=document.querySelector('[data-testid=standalone-ai-settings]');e;e=e.parentElement)e.scrollTop=0;window.scrollTo(0,0);})()"); await pause(100);
      const layout = await js(`(()=>{const e=document.querySelector('[data-testid=standalone-ai-settings]');const r=e.getBoundingClientRect();return {overflow:e.scrollWidth>e.clientWidth,outside:r.left<0||r.right>innerWidth+1,fields:[...e.querySelectorAll('.standalone-ai-field input')].every(i=>i.getBoundingClientRect().right<=r.right+1),columns:getComputedStyle(e.querySelector('.standalone-ai-layout')).gridTemplateColumns};})()`);
      assert.equal(layout.overflow, false); assert.equal(layout.outside, false); assert.equal(layout.fields, true);
      const screenshot = path.join(root, `ai-settings-${width}-${zoom}.png`); await fs.writeFile(screenshot,(await window.webContents.capturePage()).toPNG()); screenshots.push(screenshot); layouts.push({width,height,zoom,...layout});
      await js("document.querySelector('[data-testid=standalone-ai-save]').scrollIntoView({block:'center'})");
      const reachable = await js("(()=>{const b=document.querySelector('[data-testid=standalone-ai-save]'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()");
      assert.equal(reachable,true,'save button remains reachable and uncovered');
    }
    state.role = 'member'; const scansBeforeMember = state.scans;
    await route('basic'); await pause(120); await route('ai-assistant');
    await until("document.querySelector('.standalone-ai-readonly') && document.querySelector('[data-testid=standalone-ai-settings]').getAttribute('aria-busy')==='false'", 'member read-only state');
    assert.equal(await js("[...document.querySelectorAll('[data-testid=standalone-ai-settings] input,[data-testid=standalone-ai-settings] select,[data-testid=standalone-ai-settings] button')].every(e=>e.disabled)"), true);
    assert.equal(state.scans, scansBeforeMember, 'member must not scan local models');
    assert.equal(await js("document.getElementById('standalone-ai-key').value"), '');
    assert.equal(state.providerCalls, 2); assert.equal(publicRequests.length,0); assert.deepEqual(errors,[]);
    const result = { ok: true, providerRequestsMocked: state.providerCalls, realNetworkRequests: publicRequests, rendererErrors: errors, checks: ['no-legacy-quota','no-implicit-provider-call','input-validation','secure-save','blank-key-preserved','reload','duplicate-test-click','provider-failure','invalid-save-preserves-edits','local-import-cancel','local-import-start-stop','local-scan-failure','session-key-warning','member-readonly','responsive-actions'], layouts, screenshots };
    await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result)); clearTimeout(timer); window.destroy(); app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(root,'failure.png'),(await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(root,'result.json'),JSON.stringify({ok:false,error:error.stack,errors,publicRequests},null,2)); console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1);
  }
});
