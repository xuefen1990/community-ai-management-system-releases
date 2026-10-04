'use strict';
// Run only inside the disposable Electron app created by the runner. Production
// auth, backend startup, update service and userData are never instantiated.
const { app, BrowserWindow, ipcMain, protocol, net, dialog } = require('electron');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const { registerFoundationFileProtocol } = require('../../src/main/foundation-file-protocol');
const { FoundationDocumentService } = require('../../src/main/foundation-document-service');
const root = process.env.FOUNDATION_ELECTRON_TEST_DIR;
if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && !path.resolve(root).startsWith('/private/tmp/community-foundation-electron-')) throw new Error('Disposable test directory required');
app.setPath('userData', path.join(root, 'isolated-user-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'community-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const timer = setTimeout(() => app.exit(2), 45000);
app.whenReady().then(async () => {
  let window;
  try {
    const store = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
    await store.write({ settings: { villageName: '桌面隔离测试社区' }, personnel: Array.from({ length: 10000 }, (_, i) => ({ id: `test-${i}`, name: `合成居民${i}`,
      id_card: `SYNTHETIC-${i}`, household_id: String(Math.floor(i / 4)).padStart(6, '0'), village_group: `测试${i % 8}组`, relation_to_head: i % 4 ? '子' : '户主', gender: '男', birth_date: '1980-01-01', tags: [] })) });
    const source = path.join(root, 'synthetic-pixel.png');
    await fs.writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    const files = new FoundationDocumentService({ store, authorize: async () => {} });
    const archived = await files.request({ action: 'archive', sourceFilePath: source, name: '合成图片.png', links: [{ targetType: 'person', personId: 'test-0' }] });
    assert.equal(archived.success, true);
    let signedIn = true;
    const authService = { getStatus: async () => ({ authenticated: signedIn, entitlement: { type: signedIn ? 'licensed' : 'none' }, account: signedIn ? { role: 'unit_admin', name: '合成账号', phone: '10000000000' } : null }),
      logout: async () => { signedIn = false; return { ok: true }; },
      getLoginPrefill: async () => ({}), getServerConfig: async () => ({ baseUrl: 'http://127.0.0.1:1' }) };
    registerCompatibilityHandlers({ app, ipcMain, dialog, databaseStore: store, authService, shell: { openPath: async () => '' } });
    registerFoundationFileProtocol({ protocol, net, store, authService });
    const visible = process.env.FOUNDATION_VISIBLE_QA === '1';
    window = new BrowserWindow({ show: visible, width: 1600, height: 1000, webPreferences: { offscreen: !visible, backgroundThrottling: false, contextIsolation: true,
      sandbox: false, nodeIntegration: false, webSecurity: true, preload: path.resolve(__dirname, '../../src/preload/index.js') } });
    await window.loadFile(path.resolve(__dirname, '../../src/renderer/foundation/index.html'));
    const result = await window.webContents.executeJavaScript(`(${async function run() {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const { foundation } = await import(new URL('./bootstrap.mjs', location.href).href);
      await foundation.router.push('/personnel'); await foundation.personnel.load();
      for (let count = 0; count < 100 && document.querySelectorAll('.el-table__body tbody tr').length !== 15; count++) await pause(50);
      const rows = document.querySelectorAll('.el-table__body tbody tr').length;
      if (rows !== 15) throw new Error(`Expected 15 rendered rows, got ${rows}`);
      const scroll = document.querySelector('.el-table__body-wrapper .el-scrollbar__wrap');
      const frames = []; let previous;
      await new Promise(resolve => { const frame = timestamp => { if (previous !== undefined) frames.push(timestamp - previous); previous = timestamp;
        scroll.scrollTop = (Math.sin(frames.length / 12) + 1) / 2 * (scroll.scrollHeight - scroll.clientHeight);
        if (frames.length >= 120) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
      const sorted = [...frames].sort((a, b) => a - b), filtered = foundation.personnel.filtered;
      for (let page = 2; page <= 6; page++) { foundation.personnel.page = page; await pause(50); if (foundation.personnel.filtered !== filtered) throw new Error('Native page flip recomputed all residents'); }
      foundation.personnel.page = 1; scroll.scrollTop = 0;
      const { data } = await window.api.businessRequest({ path: '/api/v3/documents?storageArea=archives' });
      const file = data.items[0];
      const response = await fetch(`community-file://document/?id=${encodeURIComponent(file.id)}`);
      const bytes = await response.arrayBuffer();
      if (!response.ok || new Uint8Array(bytes)[0] !== 137) throw new Error('Native file preview failed');
      const backup = await window.api.createV3Backup(); if (!backup.success) throw new Error('Native backup failed');
      const backups = await window.api.listV3AutoBackups(); if (!backups.backups.length) throw new Error('Native backup list empty');
      const editor = await window.communityFoundationApi.readDb();
      const person = foundation.personnel.people.find(person => person.id === 'test-0');
      const update = await window.api.businessRequest({ method: 'POST', path: '/api/v3/people/batch-upsert', body: { items: [{ id: person.id, baseVersion: person.version, fields: { name: '另页已保存的姓名' } }] } });
      if (!update.ok) throw new Error(update.error.message);
      editor.personnel.find(person => person.id === 'test-0').bankAccounts = [{ id: 'bank-test', cardNumber: 'SYNTHETIC-BANK' }];
      await window.communityFoundationApi.writeDb(editor);
      if (editor.personnel.find(person => person.id === 'test-0').name !== '另页已保存的姓名') throw new Error('Parked editor overwrote a newer resident update');
      for (const label of ['资金发放中心', '工作事项']) {
        [...document.querySelectorAll('.menu-item')].find(item => item.textContent.trim() === label).click();
        await pause(100);
        if (document.querySelector('.menu-item.active')?.textContent.trim() !== label) throw new Error('Native menu navigation failed');
      }
      await foundation.router.push('/personnel'); await pause(100);
      if (!location.pathname.endsWith('/foundation/index.html')) throw new Error('Navigation escaped the foundation entry');
      return { ok: true, loadedPeople: foundation.personnel.people.length, renderedRows: rows, previewBytes: bytes.byteLength,
        nativeBackupFiles: backup.filesCount, concurrentEditorPreservedResident: true, nativeMenuClicks: true,
        scrollFrames: { count: frames.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], over50Ms: frames.filter(ms => ms > 50).length },
        sandboxedRenderer: typeof require === 'undefined' && typeof process === 'undefined' };
    }.toString()})()`);
    result.electron = process.versions.electron; result.chromium = process.versions.chrome;
    // Use a loopback phone request against the disposable app's real service.
    const mobile = await window.webContents.executeJavaScript(`(async()=>{const {foundation}=await import(new URL('./bootstrap.mjs',location.href).href);await foundation.router.push('/documents');return window.api.getMobileUploadInfo();})()`);
    assert.equal(mobile.running, true);
    const upload = await fetch(`http://127.0.0.1:${mobile.port}/upload?${new URLSearchParams({ token: mobile.token, name: '手机合成照片.png', ownerType: '未关联' })}`, { method: 'POST', body: await fs.readFile(source) });
    assert.equal(upload.status, 200);
    result.mobileInboxVisible = await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('[data-testid="sorting-file-list"]')?.textContent.includes('手机合成照片.png'))return true;await new Promise(resolve=>setTimeout(resolve,25));}return false})()`);
    assert.equal(result.mobileInboxVisible, true);
    await window.webContents.executeJavaScript(`(async()=>{const {foundation}=await import(new URL('./bootstrap.mjs',location.href).href);[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.trim()==='居民一户一档').click();await new Promise(resolve=>setTimeout(resolve,600));for(let i=0;i<100;i++){if(document.querySelectorAll('.el-table__body tbody tr').length===15&&[...document.querySelectorAll('.el-table__body tbody tr')].some(row=>row.getBoundingClientRect().height>0)){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return;}await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Resident page did not settle before capture')})()`);
    const screenshot = path.join(root, 'electron-foundation.png'); await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG()); result.screenshot = screenshot;
    const reloaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await reloaded;
    result.reloadKeepsFoundation = await window.webContents.executeJavaScript(`(async()=>{await import(new URL('./bootstrap.mjs',location.href).href);return location.pathname.endsWith('/foundation/index.html')})()`);
    assert.equal(result.reloadKeepsFoundation, true);
    const loggedOut = once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`import(new URL('./vendor/assets/foundation-runtime.mjs',location.href).href).then(({useAuthStore})=>{void useAuthStore().logout()})`);
    await loggedOut;
    result.logoutClearsBusiness = await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('#login-phone'))return !document.querySelector('[data-testid="business-shell"]')&&!document.querySelector('#resident-subsidy-profile-overlay');await new Promise(resolve=>setTimeout(resolve,25));}return false})()`);
    assert.equal(result.logoutClearsBusiness, true); result.visibleDesktopWindow = visible;
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result));
    console.log(JSON.stringify(result));
    clearTimeout(timer); window.destroy(); app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) { await fs.writeFile(path.join(root, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(root, 'failure.html'), await window.webContents.executeJavaScript('document.documentElement.outerHTML')); }
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ ok: false, error: error.stack }));
    console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1);
  }
});
