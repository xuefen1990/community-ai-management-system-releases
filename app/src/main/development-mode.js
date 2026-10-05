'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function getDevelopmentConfig({ isPackaged, env = process.env, productionData }) {
  if (isPackaged || env.COMMUNITY_DEV_MODE !== '1') return null;
  const userData = path.resolve(env.COMMUNITY_DEV_USER_DATA || '');
  if (!env.COMMUNITY_DEV_USER_DATA || userData === productionData || userData.startsWith(productionData + path.sep)) throw new Error('开发模式必须使用独立数据目录');
  if (!fs.existsSync(path.join(userData, 'development-profile.json'))) throw new Error('请通过 npm run dev 初始化开发环境');
  const url = new URL(env.COMMUNITY_DEV_BACKEND_URL);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') throw new Error('开发后端必须使用独立的本机端口');
  const remoteServerUrl = new URL(env.COMMUNITY_DEV_REMOTE_SERVER_URL || url.origin);
  if (!['http:', 'https:'].includes(remoteServerUrl.protocol) || !remoteServerUrl.hostname) throw new Error('开发远程服务地址无效');
  return { userData, baseUrl: url.origin, remoteServerUrl: remoteServerUrl.origin, devtools: env.COMMUNITY_DEV_TOOLS === '1' };
}
function developmentAuthStore(store, remoteServerUrl) {
  return { read: async () => ({ ...await store.read(), remoteServerUrl }), write: value => store.write({ ...value, remoteServerUrl }) };
}
async function initializeDevelopmentPreview(authService, config) {
  if (!config) return;
  // The caller only supplies config after the unpackaged, isolated-profile checks.
  const saved = await authService.store.read();
  const remembered = await authService.rememberedLoginStore?.load().catch(() => null);
  if (remembered?.phone && remembered.password) {
    try { await authService.login({ ...remembered, remember: true }); } catch {}
  }
  const originalStatus = authService.getStatus.bind(authService);
  const originalRequest = authService.request.bind(authService);
  const account = saved.remoteAccount && ['main_account','unit_admin','admin','platform_admin'].includes(saved.remoteAccount.role)
    ? { ...saved.remoteAccount, mustChangePassword:false, isActive:true }
    : {id:'development-preview',mainAccountId:'development-preview',name:'开发预览',phone:'开发预览',role:'main_account',permissions:{},isActive:true,mustChangePassword:false};
  account.mainAccountId ||= account.id;
  const token = `development-preview-${require('node:crypto').randomUUID()}`;
  const entitlement = {type:'licensed',plan:'permanent',expiresAt:null};
  async function ensurePreview() {
    authService.session = {user:account,token,developmentPreview:true};
    await authService.localWorkspaceService.prepareLocal({ownerId:account.mainAccountId,cloudBaseUrl:config.remoteServerUrl});
    await authService.localWorkspaceService.cacheAccountGrant(token,account,entitlement);
  }
  if (!authService.session) await ensurePreview();
  authService.getStatus = async options => {
    if (!authService.session) await ensurePreview();
    if (!authService.session.developmentPreview) return originalStatus(options);
    return {ok:true,authenticated:true,account:{...account},machineId:authService.machineId,entitlement:{...entitlement}};
  };
  authService.request = async (route, ...args) => {
    if (authService.session?.developmentPreview && route === '/auth/preferences') {
      const file = path.join(config.userData,'development-preferences.json');
      if (args[0]?.method === 'PUT') fs.writeFileSync(file,JSON.stringify({menu:args[0]?.body?.menu || {},updatedAt:new Date().toISOString()}));
      try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return {menu:{},updatedAt:null}; }
    }
    if (authService.session?.developmentPreview && route === '/ai/quota') return {balanceTokens:0,balanceCredits:0,creditsEnabled:false,developmentPreview:true};
    if (authService.session?.developmentPreview && !route.startsWith('/unit/workspace/') && !['/auth/login','/auth/register'].includes(route))
      throw new Error('开发预览可直接使用本机业务；在线 AI 和账号管理需要有效的真实账号，请在账号设置中登录');
    return originalRequest(route,...args);
  };
}
function attachDevelopmentWindow(window, config) {
  const stateFile = path.join(config.userData, 'development-window.json');
  const notify = payload => { if (process.connected) process.send({ type: 'community-dev', ...payload }); };
  window.on('page-title-updated', event => { event.preventDefault();window.setTitle('社区AI管理系统 · 开发版（独立数据）'); });
  const saveRoute = () => {
    try { fs.writeFileSync(stateFile, JSON.stringify({ hash: new URL(window.webContents.getURL()).hash })); } catch {}
  };
  window.webContents.on('did-navigate-in-page', saveRoute);
  window.webContents.on('did-finish-load', () => { saveRoute();notify({ event: 'renderer-ready', url: window.webContents.getURL() }); });
  window.webContents.on('console-message', (_event, level, message, line, source) => { if(level >= 2) console.error(`[renderer:${level}] ${message} (${source}:${line})`); });
  window.webContents.on('preload-error', (_event, file, error) => console.error('[preload]', file, error));
  window.webContents.on('render-process-gone', (_event, details) => console.error('[renderer exited]', details.reason));
  if (config.devtools) window.webContents.openDevTools({ mode: 'detach' });
  const onMessage = async message => {
    if (message?.type !== 'community-dev' || message.action !== 'reload' || window.isDestroyed()) return;
    const files = message.files || [];
    if (files.length && files.every(file => file.endsWith('.css'))) {
      const urls = files.map(file => pathToFileURL(file).href);
      try {
        const replaced = await window.webContents.executeJavaScript(`(() => {
          const urls = ${JSON.stringify(urls)}, links = [...document.querySelectorAll('link[rel="stylesheet"]')];
          let updated = 0;
          for (const url of urls) for (const link of links) {
            const current = new URL(link.href); current.search = '';current.hash = '';
            if (current.href !== url) continue;
            const next = link.cloneNode(); next.href = url + '?dev=' + Date.now();
            next.onload = () => link.remove(); next.onerror = () => { next.remove();location.reload(); };
            link.after(next);updated++;
          }
          return updated >= urls.length;
        })()`);
        if (replaced) { notify({ event: 'css-updated' });return; }
      } catch (error) { console.error('[dev css]', error.message); }
    }
    window.webContents.reloadIgnoringCache();
  };
  process.on('message', onMessage);
  window.once('closed', () => process.off('message', onMessage));
  return '#/overview';
}
module.exports = { getDevelopmentConfig, developmentAuthStore, initializeDevelopmentPreview, attachDevelopmentWindow };
