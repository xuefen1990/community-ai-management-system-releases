'use strict';
// Only the disposable renderer fixture uses this entry. No production data or service is opened.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const { MapService } = require('../../src/main/map-service');
const root = process.env.FOUNDATION_ELECTRON_TEST_DIR;
if (!root || !path.resolve(root).includes('/community-foundation-electron-')) throw Error('Disposable test directory required');
app.setPath('userData', path.join(root, 'isolated-user-data'));
const timer = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  let win;
  try {
    const store = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
    await store.write({ settings: { villageName: '快捷工具测试社区' }, personnel: [] });
    const baseline = JSON.stringify(await store.read());
    let signedIn = true, logoutCalls = 0;
    const authService = { session: { user: { id: 'test-admin' } }, request: async () => ({}),
      getStatus: async () => ({ authenticated: signedIn, entitlement: { type: 'licensed' }, account: signedIn ? { id: 'test-admin', role: 'unit_admin', phone: '10000000000', name: '合成账号' } : null }),
      getServerConfig: async () => ({ mode: 'standalone', baseUrl: 'http://127.0.0.1:1' }),
      getLoginPrefill: async () => ({ phone: '', password: '' }),
      listUnitMembers: async () => ({ members: [] }),
      logout: async () => { logoutCalls++; signedIn = false; return { ok: true }; },
    };
    const mapService = new MapService({ userDataPath: app.getPath('userData'), safeStorage: { isEncryptionAvailable: () => false }, fetchImpl: async () => { throw Error('No live map requests allowed'); } });
    app.setLoginItemSettings = () => {};
    registerCompatibilityHandlers({ app, ipcMain, dialog, databaseStore: store, authService, mapService, shell: { openPath: async () => '' } });
    for (const [channel, value] of Object.entries({ 'check-for-app-update': { ok: true, disabled: true }, 'get-ai-assistant-conversation': { messages: [] }, 'list-ai-assistant-files': [], 'list-ai-assistant-operations': [], 'get-ai-settings': { mode: 'online', online: { hasApiKey: false } } })) {
      if (!ipcMain._invokeHandlers.has(channel)) ipcMain.handle(channel, async () => value);
    }
    win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: false, nodeIntegration: false, webSecurity: true, preload: path.resolve(__dirname, '../../src/preload/index.js') } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(path.resolve(__dirname, '../../src/renderer/foundation/index.html'));
    const result = await win.webContents.executeJavaScript(`(${async function () {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const wait = async (fn, label) => { for (let i = 0; i < 180; i++) { if (fn()) return; await pause(40); } throw Error('等待超时：' + label); };
      const check = (value, label) => { if (!value) throw Error(label); };
      const get = key => document.querySelector('[data-testid="community-footer-' + key + '"]');
      const { foundation } = await import(new URL('./bootstrap.mjs', location.href).href);
      const { useThemeStore, useAuthStore } = await import(new URL('./vendor/assets/foundation-runtime.mjs', location.href).href);
      await wait(() => get('more'), '快捷工具栏');
      const account = document.querySelector('[data-testid="sidebar-account-phone"]').textContent;
      check(account === '10000000000', '账号显示被修改');
      check(document.querySelectorAll('.community-footer-shortcuts button').length === 4, '应有四个快捷按钮');
      check(getComputedStyle(document.querySelector('.sidebar-footer-actions')).display === 'none', '旧按钮未收起');
      get('more').click();
      const menu = document.getElementById('community-sidebar-more-menu');
      check(!menu.hidden && document.activeElement === get('sync'), '更多菜单未正确聚焦');
      get('sync').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      check(document.activeElement === get('privacy'), '菜单方向键失效');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check(menu.hidden && document.activeElement === get('more'), 'Esc 未关闭并恢复焦点');
      get('more').click(); get('sync').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      check(menu.hidden && document.activeElement === get('more'), 'Tab 未返回快捷栏');
      get('more').click(); document.querySelector('.app-main').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      check(menu.hidden, '点击外部未关闭菜单');
      get('theme').click(); await wait(() => useThemeStore().customizerVisible, '原外观面板');
      check(document.querySelector('[data-testid="theme-customizer-dialog"]'), '外观面板缺失'); useThemeStore().closeCustomizer();
      get('more').click(); get('privacy').click();
      await wait(() => [...document.querySelectorAll('[role="dialog"]')].some(d => getComputedStyle(d).display !== 'none' && d.textContent.includes('数据存储与服务说明')), '数据说明');
      const privacy = [...document.querySelectorAll('[role="dialog"]')].find(d => d.textContent.includes('数据存储与服务说明'));
      privacy.querySelector('.el-dialog__headerbtn').click(); await pause(200);
      get('more').click(); get('sync').click();
      await wait(() => document.body.textContent.includes('授权有效期已同步至最新'), '原刷新授权');
      get('screen').click(); await wait(() => document.querySelector('[data-testid="statistics-big-screen"]'), '数据大屏');
      check(document.querySelector('[data-testid="statistics-big-screen"] h1').textContent.includes('快捷工具测试社区'), '大屏没有使用当前工作区');
      [...document.querySelectorAll('[data-testid="statistics-big-screen"] button')].find(b => b.textContent === '返回').click();
      await wait(() => !document.querySelector('[data-testid="statistics-big-screen"]'), '退出大屏');
      get('mobile').click(); await wait(() => document.querySelector('[data-testid="community-mobile-settings"]'), '手机互联');
      check(foundation.router.currentRoute.value.query.tab === 'mobile', '手机入口分类错误');
      const config = structuredClone(JSON.parse(JSON.stringify(foundation.shell.menuVisibilityConfig)));
      foundation.shell.setMenuVisibilityConfig({ ...config, statistics: { visible: false } });
      await wait(() => get('screen').disabled, '隐藏菜单限制');
      foundation.shell.setMenuVisibilityConfig(config); await wait(() => !get('screen').disabled, '恢复菜单');
      const auth = useAuthStore(); const state = auth.status.state; auth.status.state = 'lan-authorized';
      await wait(() => get('mobile').disabled && get('logout').hidden, '协同模式限制');
      auth.status.state = state; await wait(() => !get('mobile').disabled && !get('logout').hidden, '恢复主账号入口');
      const routes = foundation.router.getRoutes().filter(r => r.meta?.menuKey).map(r => r.path).filter(p => !p.includes(':'));
      for (const route of [...new Set(routes)]) { await foundation.router.push(route); await pause(35); check(document.querySelectorAll('.community-footer-shortcuts').length === 1, '页面切换重复挂载：' + route); }
      await foundation.router.push('/overview');
      check(document.querySelector('[data-testid="sidebar-account-phone"]').textContent === account, '快捷操作改写账号');
      return { buttons: 4, accountPreserved: true, screen: true, mobile: true, appearance: true, privacy: true, refresh: true, keyboard: true, outsideClose: true, menuVisibilityRespected: true, lanRestrictions: true, routeCount: new Set(routes).size };
    }})()`);
    result.layouts = [];
    for (const [width, height, zoom] of [[1600, 900, 1], [1080, 680, 1], [1080, 680, 1.15], [1600, 900, .9]]) {
      win.webContents.setZoomFactor(zoom); win.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 200));
      const layout = await win.webContents.executeJavaScript(`(() => {
        const more = document.querySelector('[data-testid="community-footer-more"]'); more.click();
        const menu = document.getElementById('community-sidebar-more-menu'), rect = menu.getBoundingClientRect(), anchor = more.getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.community-footer-shortcuts button')].map(b => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return { width: r.width, bottom: r.bottom, clickable: b === hit || b.contains(hit) }; });
        const valid = rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom < anchor.top && buttons.every(b => b.bottom <= innerHeight && b.clickable) && Math.max(...buttons.map(b => b.width)) - Math.min(...buttons.map(b => b.width)) < 1;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { valid, width: innerWidth, height: innerHeight };
      })()`);
      assert.equal(layout.valid, true, JSON.stringify({ width, height, zoom, layout }));
      result.layouts.push({ width, height, zoom, valid: layout.valid });
    }
    win.webContents.setZoomFactor(1); win.setContentSize(1600, 900);
    await fs.writeFile(path.join(root, 'footer-light.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`import(new URL('./vendor/assets/foundation-runtime.mjs',location.href).href).then(({useThemeStore})=>{const theme=useThemeStore();theme.selectStyle(theme.THEME_STYLE_PRESETS.find(p=>p.mode==='dark').id);if(!theme.isDark)throw Error('Dark theme not applied');})`);
    await new Promise(resolve => setTimeout(resolve, 200));
    result.darkTheme = await win.webContents.executeJavaScript("document.body.classList.contains('dark-theme')"); assert.equal(result.darkTheme,true);
    const darkFooter = await win.webContents.executeJavaScript(`(() => {
      const css = getComputedStyle(document.querySelector('.community-footer-enhanced')).backgroundColor;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.fillStyle = css; context.fillRect(0,0,1,1);
      return { css, rgba: [...context.getImageData(0,0,1,1).data] };
    })()`);
    assert.ok(Math.max(...darkFooter.rgba.slice(0,3)) < 128, 'Dark footer must retain contrast: ' + darkFooter.css); result.darkFooter = darkFooter;
    await fs.writeFile(path.join(root, 'footer-dark.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="community-footer-more"]').click();document.querySelector('[data-testid="community-footer-logout"]').click()`);
    for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript('!!document.querySelector("#login-password") && !document.querySelector(".community-footer-shortcuts") && !document.querySelector(".community-footer-menu")').catch(() => false)) break; await new Promise(resolve => setTimeout(resolve, 60)); }
    assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("#login-password") && !document.querySelector(".community-footer-menu")'), true);
    assert.equal(logoutCalls, 1); result.logoutAndCleanup = true;
    assert.equal(JSON.stringify(await store.read()), baseline, 'Footer actions modified business data');
    assert.equal(errors.length, 0, errors.join('\n')); result.rendererErrors = errors; result.businessDataUnchanged = true;
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(root); clearTimeout(timer); win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error.stack); await fs.writeFile(path.join(root, 'failure.txt'), String(error.stack));
    if (win && !win.isDestroyed()) await fs.writeFile(path.join(root, 'failure.png'), (await win.webContents.capturePage()).toPNG()).catch(() => {});
    clearTimeout(timer); app.exit(1);
  }
});
