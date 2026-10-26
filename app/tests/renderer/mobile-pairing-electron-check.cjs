'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const root = process.env.FOUNDATION_ELECTRON_TEST_DIR;
if (!root || !path.resolve(root).includes('/community-mobile-pairing-electron-')) throw Error('Disposable fixture required');
app.setPath('userData', path.join(root, 'isolated-user-data'));
const timer = setTimeout(() => app.exit(2), 110000);
app.whenReady().then(async () => {
  let window;
  try {
    const store = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
    await store.write({ settings: { villageName: '二维码隔离测试社区' }, personnel: [] });
    let account = { id: 'synthetic-owner', mainAccountId: 'synthetic-owner', role: 'main_account', name: '合成主账号' };
    let calls = 0;
    const authService = {
      request: async () => ({}), getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' }, account }),
      getServerConfig: async () => ({ baseUrl: 'https://xuefeng0901.cn' }), getLoginPrefill: async () => ({ phone: '', password: '' }),
      getWorkspaceConnection: async () => ({ baseUrl: '' }),
    };
    const lanWorkspaceService = {
      prepareLocal: async () => {},
      info: () => ({ enabled: true, ownerId: 'synthetic-owner', ips: ['192.168.50.2'], mobile: { workspaceId: 'synthetic-workspace' } }),
      mobilePairing: async () => {
        calls++;
        const data = { protocol: 'village-mobile-pair-v1', workspaceId: 'synthetic-workspace', ownerId: 'synthetic-owner',
          endpoint: 'https://192.168.50.2:3002', port: 3002, fingerprint: 'a'.repeat(64), cloudBaseUrl: 'https://xuefeng0901.cn',
          pairingToken: String(calls).padStart(48, 'b'), expiresAt: Date.now() + 300000,
          miniProgram: { protocol: 'village-mini-channel-v1', port: 3003, endpoint: 'http://192.168.50.2:3003' } };
        return { payload: JSON.stringify(data), data, expiresAt: data.expiresAt };
      },
    };
    app.setLoginItemSettings = () => {};
    registerCompatibilityHandlers({ app, ipcMain, dialog, databaseStore: store, authService, lanWorkspaceService, shell: { openPath: async () => '' } });
    ipcMain.handle('check-for-app-update', async () => ({ ok: true, disabled: true }));
    for (const [channel, response] of Object.entries({ 'get-ai-assistant-conversation': { messages: [] }, 'list-ai-assistant-files': [], 'list-ai-assistant-operations': [], 'get-ai-settings': { mode: 'online', online: { enabled: false, providers: [] }, local: { enabled: false } } })) ipcMain.handle(channel, async () => response);
    window = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: false, nodeIntegration: false, webSecurity: true, preload: path.resolve(__dirname, '../../src/preload/index.js') } });
    await window.loadFile(path.resolve(__dirname, '../../src/renderer/foundation/index.html'));
    await window.webContents.executeJavaScript(`(async () => {
      const originalInterval = window.setInterval.bind(window);
      window.setInterval = (fn, ms, ...args) => { if (ms === 10000) window.qaRefreshPair = fn; return originalInterval(fn, ms, ...args); };
      const { foundation } = await import(new URL('./bootstrap.mjs', location.href).href);
      await foundation.router.push('/settings?tab=lan');
    })()`);
    const wait = async expression => {
      for (let i = 0; i < 200; i++) { if (await window.webContents.executeJavaScript(expression)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
      throw Error('Pairing UI timeout: ' + expression);
    };
    await wait(`!!document.querySelector('[data-testid="mobile-pairing-create"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mobile-pairing-create"]').click()`);
    await wait(`document.querySelector('[data-testid="mobile-pairing-code"] img')?.complete`);
    const result = { passed: true, layouts: [], refresh: false, expiry: false, memberDenied: false };
    for (const [width, height, zoom] of [[1600, 900, 1], [1080, 680, 1], [1080, 680, 1.15]]) {
      window.setContentSize(width, height); window.webContents.setZoomFactor(zoom);
      await new Promise(resolve => setTimeout(resolve, 200));
      const layout = await window.webContents.executeJavaScript(`(() => {
        const area = document.querySelector('[data-testid="mobile-pairing-code"]'), image = area.querySelector('img');
        return { width: image.getBoundingClientRect().width, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          overflow: area.scrollWidth > area.clientWidth + 1, text: area.innerText,
          rawText: !!area.querySelector('textarea'), copy: [...document.querySelectorAll('button')].some(b => b.textContent.includes('复制手机配对内容')) };
      })()`);
      assert.equal(layout.overflow, false); assert.equal(layout.rawText, false); assert.equal(layout.copy, false);
      assert(Math.abs(layout.width - 280) < 1); assert.equal(layout.naturalWidth, 560); assert.equal(layout.naturalHeight, 560);
      assert(layout.text.includes('有效至') && layout.text.includes('手机登录后扫码连接，同一局域网内使用'));
      assert(!layout.text.includes('pairingToken'));
      const capture = path.join(root, `pairing-${width}-${zoom}.png`);
      await fs.writeFile(capture, (await window.webContents.capturePage()).toPNG());
      result.layouts.push({ viewportWidth: width, viewportHeight: height, zoom, ...layout, screenshot: capture });
    }
    const first = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mobile-pairing-code"] img').src`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mobile-pairing-create"]').click()`);
    await wait(`document.querySelector('[data-testid="mobile-pairing-create"]')?.disabled === false`);
    const second = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mobile-pairing-code"] img').src`);
    assert.notEqual(first, second); assert.equal(calls, 2); result.refresh = true;
    await window.webContents.executeJavaScript(`(async () => { const now = Date.now; Date.now = () => now() + 300001; await window.qaRefreshPair(); Date.now = now; })()`);
    await wait(`!document.querySelector('[data-testid="mobile-pairing-code"]')`); result.expiry = true;
    account = { id: 'synthetic-member', mainAccountId: 'synthetic-owner', role: 'member', permissions: { finance: ['view', 'update'] } };
    await window.webContents.executeJavaScript(`window.qaRefreshPair()`);
    await wait(`!document.querySelector('[data-testid="mobile-pairing-create"]')`); result.memberDenied = true;
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); clearTimeout(timer); window.destroy(); app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(root, 'failure.png'), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: false, error: error.stack }));
    console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1);
  }
});
