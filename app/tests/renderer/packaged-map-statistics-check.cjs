'use strict';
// Run the real desktop entry against disposable synthetic data, never the installed profile.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, session, safeStorage } = require('electron');
const { seal } = require('../../src/main/offline-session-cache');
const root = process.env.STANDALONE_ELECTRON_TEST_DIR;
if (!root || !path.resolve(root).startsWith('/tmp/community-standalone-ui-') && !path.resolve(root).startsWith('/private/tmp/community-standalone-ui-')) throw Error('Disposable synthetic directory required');
const profile = path.join(root, 'app-data', '社区AI管理系统'); fs.mkdirSync(path.join(profile, 'license'), { recursive: true }); fs.mkdirSync(path.join(profile, 'lan-workspace'), { recursive: true });
fs.writeFileSync(path.join(profile, 'development-profile.json'), JSON.stringify({ source: 'synthetic-test-only' }));
const user = { id: 'ui-owner', mainAccountId: 'ui-owner', phone: '18800000000', role: 'main_account', isActive: true };
const legacy = { accounts: [], remoteAccount: user, offlineSessions: { [user.phone]: seal({ user }, 'test-password') } };
fs.writeFileSync(path.join(profile, 'license/local-auth.json'), JSON.stringify(legacy));
fs.writeFileSync(path.join(profile, 'lan-workspace/config.json'), JSON.stringify({ ownerId: user.id, cloudBaseUrl: 'https://unreachable.invalid', shareEnabled: false }));
fs.writeFileSync(path.join(profile, 'lan-workspace/workspace.json'), JSON.stringify({ version: 1, data: { personnel: [{ id: 'ui-person', name: '合成测试居民', gender: '男' }], settings: { villageName: '独立模式测试社区' } } }));
assert.equal(app.isPackaged, true, 'Use the packaged runtime, not a development Electron process');
app.setPath('appData', path.join(root, 'app-data'));
app.setLoginItemSettings = () => {};
safeStorage.isEncryptionAvailable = () => false; // Disposable synthetic credentials only.
// Keep the actual account/runtime implementation, but bind its local backend to an unused QA port.
const authModule = require('../../src/main/standalone-auth-service');
const BackendAuth = authModule.StandaloneAuthService;
const backendUrl = process.env.COMMUNITY_PACKAGED_TEST_BACKEND_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(backendUrl || '')) throw Error('Disposable loopback backend required');
authModule.StandaloneAuthService = class extends BackendAuth { constructor(options) { super({ ...options, baseUrl: backendUrl }); } };
const blocked = [], errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let n = 0; n < 240; n++) { const value = await fn(); if (value) return value; await pause(100); } throw Error('Timeout: ' + label); }
require('../../src/main/index');
const timer = setTimeout(() => { console.error('UI timeout'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  let window;
  try {
    session.defaultSession.webRequest.onBeforeRequest((request, done) => { const u = new URL(request.url); const cancel = ['https:', 'http:'].includes(u.protocol) && u.hostname !== '127.0.0.1'; if (cancel) blocked.push(u.origin); done({ cancel }); });
    window = await until(() => BrowserWindow.getAllWindows()[0], 'window');
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    const js = code => window.webContents.executeJavaScript(code);
    await until(() => js("document.querySelector('[data-testid=community-auth-submit]') && document.body.innerText.includes('本机账号登录')"), 'local login');
    await js("localStorage.setItem('cwt_menu_visibility_config',JSON.stringify({statistics:{visible:true,customAlias:'合成统计别名',order:14}}))");
    await fsp.writeFile(path.join(root, 'login.png'), (await window.webContents.capturePage()).toPNG());
    await js(`(()=>{for (const [id,value] of [['login-phone','18800000000'],['login-password','test-password']]){const e=document.getElementById(id); if(!e) throw Error('missing '+id); e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('.login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
    await until(() => js("location.hash.includes('overview') && !document.querySelector('.foundation-account-gate')"), 'migrated home');
    assert.equal((await js('window.api.getLocalAuthStatus()')).mode, 'standalone');
    const workspace = await js('window.api.readFoundationWorkspace()');
    assert.equal(workspace.database.personnel[0].id, 'ui-person');
    await until(async () => (await js('window.api.getAccountPreferences()')).menu.statistics?.customAlias === '合成统计别名', 'preserved menu alias');
    assert.equal(await js('window.api.getVersion()'), '1.4.3');
    const menus = ['/overview','/statistics','/personnel','/party','/visits','/drafting','/certificate-workspace','/documents','/funds','/finance','/land','/village-duty','/work','/assistant-records','/settings'];
    for (const route of menus) { await js(`import(new URL('foundation/bootstrap.mjs',document.baseURI).href).then(m=>m.foundation.router.push(${JSON.stringify(route)}))`); await pause(350); assert.equal((await js('location.hash')).split('?')[0], '#' + route); }
    assert.equal((await js('window.api.readFoundationWorkspace()')).database.personnel[0].id, 'ui-person');
    const features = await js(`(${async function () {
      const { foundation } = await import(new URL('foundation/bootstrap.mjs', document.baseURI).href);
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const wait = async (fn, label) => { for(let i=0;i<180;i++){if(fn())return;await pause(50);}throw Error('Timeout: '+label); };
      const check = (value,label) => {if(!value)throw Error(label);};
      await foundation.router.push('/settings?tab=map');
      await wait(()=>document.querySelector('[data-testid="settings-map-canvas"] .leaflet-map-pane'),'packaged map assets');
      const panel = document.querySelector('[data-testid="map-settings-panel"]');
      [...panel.querySelectorAll('button')].find(b=>b.textContent==='标记村委会'||b.textContent==='重标村委会').click();
      const canvas=panel.querySelector('[data-testid="settings-map-canvas"]'),rect=canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width*.55,clientY:rect.top+rect.height*.55}));
      await wait(()=>![...panel.querySelectorAll('button')].find(b=>b.textContent==='保存并同步大屏').disabled,'marker ready');
      [...panel.querySelectorAll('button')].find(b=>b.textContent==='保存并同步大屏').click();
      await wait(()=>document.querySelector('[data-testid="map-save-status"]').textContent==='已保存','real main/backend map settings save');
      await foundation.router.push('/statistics');
      await wait(()=>document.querySelector('[data-testid="stat-tab-land-brain"]'),'statistics');
      for(const tab of ['demographics','party-duty','visits-brain','duty-brain','finance-brain','land-brain']){
        document.querySelector('[data-testid="stat-tab-'+tab+'"]').click();await pause(150);
        check(document.querySelector('[data-testid="stat-tab-'+tab+'"].active'),'statistics tab '+tab);
      }
      document.querySelector('[data-testid="community-footer-screen"]').click();
      await wait(()=>document.querySelector('[data-testid="statistics-big-screen"]'),'footer data screen');
      check(document.querySelector('[data-testid="statistics-big-screen"] h1').textContent.includes('独立模式测试社区'),'workspace name');
      [...document.querySelectorAll('[data-testid="statistics-big-screen"] button')].find(b=>b.textContent==='返回').click();
      await wait(()=>!document.querySelector('[data-testid="statistics-big-screen"]'),'screen return');
      document.querySelector('[data-testid="community-footer-mobile"]').click();
      await wait(()=>document.querySelector('[data-testid="community-mobile-settings"]'),'mobile shortcut');
      check(document.querySelectorAll('.community-footer-shortcuts button').length===4,'four shortcuts');
      check(!document.body.textContent.includes('自定义台账'),'excluded custom ledger entry');
      const update = await window.api.checkForAppUpdate();check(update.disabled===true && update.mode==='manual','standalone manual update retained');
      return {mapSavedWithRealMain:true,statisticsTabs:6,dataScreen:true,mobileShortcut:true,fourShortcuts:true,customLedgerExcluded:true,manualUpdateRetained:true};
    }})()`);
    await js("import(new URL('foundation/bootstrap.mjs',document.baseURI).href).then(m=>m.foundation.router.push('/settings?tab=ai-assistant'))");
    await until(() => js("document.querySelector('[data-testid=standalone-ai-settings] input[type=password]')"), 'own AI settings');
    const screenshots = [];
    for (const [width, height] of [[1600,900],[1080,680]]) { window.setContentSize(width,height); await pause(250); const layout = await js("(()=>{const e=document.querySelector('[data-testid=standalone-ai-settings]');return {overflow:e.scrollWidth>e.clientWidth,secret:!!e.querySelector('input[type=password]')};})()"); assert.equal(layout.overflow,false); assert.equal(layout.secret,true); const image=path.join(root,`ai-${width}.png`); await fsp.writeFile(image,(await window.webContents.capturePage()).toPNG()); screenshots.push(image); }
    assert.equal(blocked.length, 0, 'standalone must not contact a public origin');
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(profile,'license/local-auth.json'))),legacy);
    assert.equal(errors.length, 0, 'renderer must not report runtime errors');
    await fsp.writeFile(path.join(root,'result.json'),JSON.stringify({ok:true,packaged:app.isPackaged,version:app.getVersion(),features,isolatedBackend:true,menus:menus.length,savedMenuPreserved:true,blockedPublicOrigins:blocked,rendererErrors:errors,screenshots},null,2));
    console.log('Standalone Electron migration, 15 menus and AI settings verified'); clearTimeout(timer); app.quit();
  } catch (error) { if(window&&!window.isDestroyed()) { await fsp.writeFile(path.join(root,'failure.png'),(await window.webContents.capturePage()).toPNG()); await fsp.writeFile(path.join(root,'failure-text.txt'),await window.webContents.executeJavaScript('document.body.innerText')); } await fsp.writeFile(path.join(root,'result.json'),JSON.stringify({ok:false,error:error.stack,blocked,errors},null,2)); console.error(error); clearTimeout(timer); app.quit(); process.exitCode=1; }
});
