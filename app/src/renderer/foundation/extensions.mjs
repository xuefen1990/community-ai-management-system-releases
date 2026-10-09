import { installOverviewBalance } from './finance-balance-card.mjs';
import { installFloatingAssistant } from './floating-assistant.mjs';
import { createElementVNode as h, onMounted, onBeforeUnmount, ref, useDialogStore, useAuthStore } from './vendor/assets/foundation-runtime.mjs';
import { sortMenuItems, orderDefaultMenus } from './menu-configuration.mjs';
import { navigateToRecord } from './record-navigation.mjs';
import { workspaceApi } from './workspace-api.mjs';
import { installAiFileViewer } from './ai-file-viewer.mjs';
import { resolveMenuIcon } from './menu-icons.mjs';
import { LAN_SETUP_ROUTE, isChildAccount, needsLanSetup } from './workspace-connection.mjs';
import { HostConnectionPage } from './host-connection-page.mjs';

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve;
    script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error('扩展功能加载失败，请重试')); };
    document.head.appendChild(script);
  }));
  return scripts.get(src);
}
function loadStyle(href) {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.getAttribute('href') === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.appendChild(link);
}
async function fundsAssets() {
  loadStyle('css/contract-fee-workspace.css');
  loadStyle('css/contract-fee-ledger.css');
  await loadScript('../shared/contract-fee-excel-parser.js');
  await loadScript('../shared/contract-fee-model.js');
  await loadScript('js/contract-fee-ledger-ui.js');
}
const definitions = [
  { key: 'finance-workspace', iconKey: 'money', tab: 'tab-finance', menuKey: 'finance', insertMenu: false, label: '财务收支', path: '/finance', async mount(host) {
    loadStyle('css/finance-workspace.css');
    await loadScript('../shared/finance-category-rules.js');
    await loadScript('../shared/finance-import-review.js');
    await loadScript('../shared/finance-chart-groups.js');
    await loadScript('../shared/finance-default-period.js');
    await loadScript('foundation/vendor/echarts.min.js');
    await loadScript('js/finance-workspace-ui.js');
    await window.CommunityFinanceWorkspace.mount(host);
  } },
  { key: 'certificate-workspace', iconKey: 'certificate', tab: 'tab-certificate-management', menuKey: 'certificate-management', insertMenu: false, label: '证明管理', path: '/certificate-workspace', async mount(host) {
    loadStyle('foundation/certificate-management.css');
    await loadScript('../shared/certificate-management-model.js');
    await loadScript('js/certificate-management-ui.js');
    await window.CertificateManagementUI.mount(host);
  } },
  { key: 'ai-assistant-records', iconKey: 'ai', label: 'AI 操作记录', path: '/assistant-records', async mount(host) {
    loadStyle('foundation/assistant-extension.css');
    await loadScript('../shared/ai-operation-presentation.js');
    await loadScript('js/ai-settings-ui.js'); await window.CommunityAiUi.mountOperations(host);
  } },
  { key: 'contract-fees', iconKey: 'money', label: '资金发放中心', path: '/funds', async mount(host) {
    await fundsAssets(); await loadScript('js/contract-fee-workspace.js');
    await window.ContractFeeWorkspace.init(host); await window.ContractFeeWorkspace.loadDatabase(); window.ContractFeeWorkspace.render();
  } },
  { key: 'work-management', iconKey: 'tasks', label: '工作事项', path: '/work', async mount(host) {
    await loadScript('js/modules/work-management-model.js'); await loadScript('js/modules/work-management.js');
    window.WorkManagement.mount(host); await window.WorkManagement.open();
  } },
  { key: 'document-drafting', iconKey: 'document', label: '公文拟写', path: '/drafting', async mount(host) {
    loadStyle('foundation/document-extension.css');
    await loadScript('js/core/purify.min.js');
    await loadScript('js/document-drafting-ui.js');
    await window.DocumentDrafting.mount(host);
  } },
];

export function installExtensions({ router, shell }) {
  window.communityFoundation = true;
  loadStyle('foundation/finance-balance-card.css'); installOverviewBalance({ router });
  loadStyle('foundation/ai-file-viewer.css'); installAiFileViewer();
  window.communityFoundationApi = workspaceApi(window.api);
  const dialog = useDialogStore();
  // Reload after any logout entry (including the reference sidebar). This also
  // disposes parked DOM, pending autosaves, and module-level account caches.
  const auth = useAuthStore();
  installFloatingAssistant({ auth, loadScript, loadStyle });
  router.addRoute({ path: LAN_SETUP_ROUTE, name: 'host-connection', meta: { requiresAuth: true }, component: HostConnectionPage });
  router.addRoute({ path: "/assistant", redirect: () => { window.communityOpenAssistant?.(); return "/overview"; } });
  auth.$onAction(({ name, after }) => { if (name === 'logout') after(() => location.reload()); }, true);
  window.showToast = (message, type = 'success') => dialog.notify({ message, type });
  window.communityConfirm = (message, title) => dialog.confirm(message, { title });
  window.communityFoundationRoutes = { 'tab-duty': '/village-duty', 'tab-certificate': '/certificate-workspace', certificate: '/certificate-workspace',
    ...Object.fromEntries(definitions.flatMap(item => [
      [item.key, item.path],
      [item.menuKey || item.key, item.path],
      [item.tab || `tab-${item.key}`, item.path],
    ])) };
  window.switchTab = tab => ["ai-assistant", "tab-ai-assistant"].includes(tab) ? window.communityOpenAssistant?.() : shell.switchTab(tab);
  // Preserve an unfinished form/autosave when changing routes. Only visited
  // extension pages exist; the large legacy application is never loaded.
  const pages = new Map();
  const readiness = new Map();
  const parking = document.createElement('div'); parking.hidden = true; parking.id = 'foundation-extension-parking';
  document.body.appendChild(parking);
  for (const definition of definitions) {
    router.addRoute({ path: definition.path, name: definition.key,
      meta: { requiresAuth: true, tabId: definition.tab || `tab-${definition.key}`, menuKey: definition.menuKey || definition.key },
      component: { name: `CommunityExtension${definition.key}`, setup() {
        const host = ref(null); const error = ref(''); const loading = ref(true);
        let page;
        onMounted(async () => {
          page = pages.get(definition.key);
          if (page) { host.value.appendChild(page); loading.value = false; return; }
          page = document.createElement('div'); page.className = 'foundation-extension-page';
          pages.set(definition.key, page); host.value.appendChild(page);
          const pending = definition.mount(page); readiness.set(definition.key, pending);
          try { await pending; } catch (cause) { error.value = cause.message; pages.delete(definition.key); }
          finally { loading.value = false; }
        });
        onBeforeUnmount(() => { if (page) parking.appendChild(page); });
        return () => h('div', { class: 'foundation-extension-host' }, [
          error.value ? h('div', { class: 'foundation-extension-error', role: 'alert' }, error.value) : null,
          loading.value ? h('div', { class: 'foundation-extension-loading', role: 'status' }, '正在加载…') : null,
          h('div', { ref: host, class: 'foundation-extension-mount', style: { visibility: loading.value ? 'hidden' : 'visible' } }),
        ]);
      } },
    });
    if (definition.insertMenu !== false) {
      const beforeSettings = shell.allMenus.findIndex(item => item.key === 'settings');
      shell.allMenus.splice(beforeSettings < 0 ? shell.allMenus.length : beforeSettings, 0, {
        key: definition.key, tab: definition.tab || `tab-${definition.key}`, label: definition.label,
        svgContent: resolveMenuIcon(definition),
      });
    }
  }
  // Future extension menus can provide iconKey/svgContent; otherwise the
  // registry infers a matching symbol from their stable key and label.
  window.communityMenuIcon = resolveMenuIcon;
  const menuModules = {
    statistics: 'statistics', personnel: 'personnel', party: 'party', 'visit-records': 'visit',
    'village-duty': 'work', finance: 'finance', land: 'land', 'certificate-workspace': 'certificate',
    'certificate-management': 'certificate', documents: 'archive', 'contract-fees': 'funds',
    'work-management': 'work', 'document-drafting': 'document', settings: 'settings',
  };
  const originalMenus = orderDefaultMenus(shell.allMenus);
  async function applyMemberMenus() {
    const status = await window.api.getLocalAuthStatus();
    const account = status?.account;
    if (!status?.authenticated || !account) return;
    const preferences = await window.api.getAccountPreferences();
    const menuConfig = preferences?.menu || {};
    shell.setMenuVisibilityConfig(menuConfig);
    const visible = originalMenus.filter(item => account?.role !== 'member' || (item.key !== 'ai-assistant-records' || account.aiAccessEnabled !== false) && (!menuModules[item.key] || account.permissions?.[menuModules[item.key]]?.includes('view')));
    shell.allMenus.splice(0, shell.allMenus.length, ...sortMenuItems(visible, menuConfig, originalMenus));
    shell.reloadMenuConfig();
  }
  auth.$onAction(({ name, after }) => {
    if (['login', 'refresh'].includes(name)) after(() => { void applyMemberMenus(); });
  }, true);
  void router.isReady().then(() => applyMemberMenus());
  router.beforeEach(async to => {
    const module = menuModules[to.meta?.menuKey] || menuModules[to.path.slice(1)];
    const status = await window.api.getLocalAuthStatus();
    const account = status.account;
    if (status.authenticated && isChildAccount(account)) {
      const setupRoute = to.path === LAN_SETUP_ROUTE;
      if (setupRoute) return true;
      if (await needsLanSetup(window.api)) return LAN_SETUP_ROUTE;
    }
    if (account?.role === 'member' && to.path === '/assistant-records' && account.aiAccessEnabled === false) return '/overview';
    if (!module) return true;
    return account?.role !== 'member' || account.permissions?.[module]?.includes('view') ? true : '/overview';
  });
  let checkingWorkspace = false;
  const redirectDisconnectedMember = async () => {
    if (checkingWorkspace || document.visibilityState === 'hidden'
      || router.currentRoute.value.path === LAN_SETUP_ROUTE) return;
    checkingWorkspace = true;
    try {
      if (await needsLanSetup(window.api)) await router.replace(LAN_SETUP_ROUTE);
    } finally { checkingWorkspace = false; }
  };
  // A host can go offline while a business page stays open. Move to the
  // connection controls once, instead of letting every data panel show errors.
  setInterval(() => { void redirectDisconnectedMember().catch(() => {}); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void redirectDisconnectedMember().catch(() => {}); });
  // The donor shell ships two legacy certificate routes. Remove both so old
  // bookmarks, a remembered development route, and every menu entry land on
  // the community certificate workspace instead of rendering the donor page.
  for (const name of ['certificate', 'certificate-management']) {
    if (router.hasRoute(name)) router.removeRoute(name);
  }
  if (router.hasRoute('finance')) router.removeRoute('finance');
  router.addRoute({ name: 'certificate', path: '/certificate', redirect: '/certificate-workspace' });
  router.addRoute({ name: 'certificate-management', path: '/certificate-management', redirect: '/certificate-workspace' });
  // Vue Router may have resolved the remembered hash before this extension is
  // installed. Replace that already-active legacy route once startup settles.
  void router.isReady().then(() => {
    if (['/certificate', '/certificate-management'].includes(router.currentRoute.value.path)) {
      return router.replace('/certificate-workspace');
    }
  });
  window.communityFoundationNavigate = async action => {
    const navigation = await shell.switchTab(action.target);
    if (navigation && navigation.type !== 16) throw new Error('当前账号暂不能打开该页面，请核对权限');
    // Let the destination mount before asking its module to open a record.
    await new Promise(resolve => requestAnimationFrame(resolve));
    const definition = definitions.find(item => (item.tab || `tab-${item.key}`) === action.target || item.key === action.target || (item.key === 'certificate-workspace' && ['tab-certificate', 'certificate'].includes(action.target)));
    if (definition) await readiness.get(definition.key);
    await navigateToRecord(action);
  };
  window.communityFoundationOpenResident = async personId => {
    try {
      window.communityResidentInitialSection = { id: personId, section: 'sec_accounts' };
      const edit = document.querySelector(`[data-testid="edit-person-${CSS.escape(personId)}"]`);
      if (!edit) throw new Error('请在居民列表中打开对应居民的编辑窗口');
      edit.click();
    } catch (error) { dialog.notify({ type: 'error', message: error.message }); }
  };
}
