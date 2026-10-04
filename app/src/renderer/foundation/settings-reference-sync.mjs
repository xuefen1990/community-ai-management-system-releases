import {
  settingsView, basicPanel, menuPanel, lanPanel, dictionaryPanel,
  specialPanel, logsPanel, accountPanel, aiSettingsPanel, router,
  createElementVNode as h, createVNode as component, ref, onMounted,
  onBeforeUnmount, useDialogStore, useThemeStore,
} from './vendor/assets/foundation-runtime.mjs';
import { MobileConnectivityPanel, LanSharingPanel, BackupReferencePanel } from './settings-connectivity-panels.mjs';
import { AccessManagementPanel } from './settings-access-panel.mjs';

const tabs = [
  ['basic', '基础设置'], ['mobile', '手机互联'], ['lan', '局域网共享与账号授权'],
  ['backup', '数据与备份'], ['menu', '菜单设置'], ['dictionary', '字典管理'],
  ['special', '村民专项类别'], ['logs', '操作日志'],
  ['ai-assistant', '智能助理'],
];
const allowedTabs = new Set(tabs.map(([id]) => id));
const button = (label, action, options = {}) => h('button', {
  type: 'button', class: options.secondary ? 'btn btn-outline' : 'btn btn-primary',
  disabled: !!options.disabled, onClick: action, 'data-testid': options.testid,
}, label);
const status = (value, error = false) => value
  ? h('p', { class: `foundation-setting-message${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' }, value)
  : null;

async function readSettings() {
  const result = await window.api.businessRequest({ path: '/api/v3/system-settings' });
  if (!result?.ok) throw new Error(result?.error?.message || '读取设置失败');
  return Object.fromEntries((result.data?.items || []).map(item => [item.key, item.value]));
}

const UpdateSettingsCard = { setup() {
  const version = ref('读取中…'), checking = ref(false), message = ref(''), error = ref(false);
  let unsubscribe;
  onMounted(async () => {
    try { version.value = await window.api.getVersion(); }
    catch (cause) { version.value = '暂时无法读取'; message.value = cause.message; error.value = true; }
    unsubscribe = window.api.onAppUpdateStatus(event => {
      if (event.type !== 'error') error.value = false;
      if (event.type === 'available') message.value = `发现新版本 ${event.version}，请在更新窗口中继续。`;
      if (event.type === 'not-available') message.value = '当前已是最新版本。';
      if (event.type === 'downloaded') message.value = '更新已下载，重启后可安装。';
      if (event.type === 'release-mismatch') message.value = '更新发布尚未同步完成，请稍后再试。';
      if (event.type === 'error') { message.value = event.message || '检查更新失败'; error.value = true; }
    });
  });
  onBeforeUnmount(() => unsubscribe?.());
  const check = async () => {
    checking.value = true; error.value = false; message.value = '正在检查新版本…';
    try {
      const result = await window.api.checkForAppUpdate();
      if (result.disabled) message.value = '当前为独立开发版，正式更新检查将在已安装应用中使用。';
      else if (!result.ok) throw new Error(result.error || '检查更新失败');
      else if (message.value === '正在检查新版本…') message.value = '检查已完成，正在等待更新结果。';
    } catch (cause) { message.value = cause.message || '检查更新失败'; error.value = true; }
    finally { checking.value = false; }
  };
  return () => h('section', { class: 'settings-card foundation-reference-card', 'data-testid': 'community-update-settings' }, [
    h('div', { class: 'card-header foundation-reference-card__head' }, [h('h3', {}, '🚀 系统版本与在线更新'), h('span', { class: 'foundation-reference-badge' }, `当前版本 v${version.value}`)]),
    h('div', { class: 'card-body' }, [
      h('p', {}, '通过社区AI管理系统的更新服务检查新版本。下载完成后，可按提示重启安装。'),
      h('div', { class: 'foundation-setting-actions' }, [button(checking.value ? '正在检查…' : '🔄 检查新版本', check, { disabled: checking.value, testid: 'community-check-update' })]),
      status(message.value, error.value),
    ]),
  ]);
} };

const AppearanceSettingsCard = { setup() {
  const theme = useThemeStore();
  const fontLabel = { compact: '紧凑 90%', standard: '标准 100%', large: '关怀大字 115%' };
  return () => h('section', { class: 'settings-card foundation-reference-card', 'data-testid': 'community-appearance-settings' }, [
    h('div', { class: 'card-header' }, [h('h3', {}, '🎨 系统外观与显示偏好')]),
    h('div', { class: 'card-body' }, [
      h('p', {}, `当前主题：${theme.currentStyle?.name || '生态竹青'} · 界面文字：${fontLabel[theme.fontSizeMode] || '标准 100%'}`),
      h('p', {}, '可选择竹青、政务蓝、暖橙、党建红和深色主题，文字与按钮支持三档大小。'),
      h('div', { class: 'foundation-setting-actions' }, [button('调整主题和字号', () => theme.openCustomizer(), { testid: 'community-open-appearance' })]),
    ]),
  ]);
} };

export function installSettingsReferenceSync() {
  // The legacy settings panel below still exists for older routes. Mark the
  // reference settings shell so that it can avoid rendering its fallback LAN
  // connection card a second time.
  window.communitySettingsReferenceSync = true;
  // The imported foundation components remain intact. Replace only their
  // settings container; the existing AI panel and its setup are reused.
  settingsView.setup = () => {
    const dialogs = useDialogStore();
    const activeTab = ref('basic'), settings = ref({}), loading = ref(true), refreshing = ref(false), selectedCadre = ref(null);
    const connectionOnly = () => router.currentRoute.value.query.connect === '1';
    const routeTab = () => {
      const requested = router.currentRoute.value.query.tab;
      if (connectionOnly() || requested === 'account') activeTab.value = 'lan';
      else if (allowedTabs.has(requested)) activeTab.value = requested;
    };
    let removeRouteHook;
    const load = async () => {
      try { settings.value = await readSettings(); }
      catch (cause) { dialogs.notify({ type: 'error', message: cause.message || '读取设置失败' }); }
      finally { loading.value = false; refreshing.value = false; }
    };
    const refresh = () => { refreshing.value = true; void load(); };
    const save = async (changes, label = '设置已保存') => {
      const result = await window.api.businessRequest({ method: 'PATCH', path: '/api/v3/system-settings', body: { changes } });
      if (!result?.ok) { dialogs.notify({ type: 'error', message: result?.error?.message || '保存设置失败' }); return; }
      settings.value = { ...settings.value, ...changes };
      dialogs.notify({ type: 'success', message: label });
    };
    onMounted(() => { routeTab(); removeRouteHook = router.afterEach(routeTab); if (connectionOnly()) loading.value = false; else void load(); });
    onBeforeUnmount(() => removeRouteHook?.());
    const panel = () => {
      if (connectionOnly()) return component(LanSharingPanel, { autoScan: true });
      switch (activeTab.value) {
        case 'basic': return h('div', { class: 'foundation-reference-basic' }, [component(UpdateSettingsCard), component(basicPanel, { settings: settings.value, onSaveSettings: save }), component(AppearanceSettingsCard)]);
        case 'mobile': return component(MobileConnectivityPanel, { onOpenAccess: cadre => { selectedCadre.value = cadre; activeTab.value = 'lan'; } });
        case 'lan': return h('div', { class: 'foundation-reference-basic' }, [component(LanSharingPanel), component(AccessManagementPanel, { cadre: selectedCadre.value }), component(lanPanel), component(accountPanel)]);
        case 'backup': return component(BackupReferencePanel);
        case 'menu': return component(menuPanel);
        case 'dictionary': return component(dictionaryPanel);
        case 'special': return component(specialPanel);
        case 'logs': return component(logsPanel);
        case 'ai-assistant': return component(aiSettingsPanel);
        default: return null;
      }
    };
    return () => h('div', { class: 'settings-view tab-content', 'data-testid': 'settings-view' }, [
      h('div', { class: 'premium-header-card', 'data-testid': 'settings-header-card' }, [
        h('div', { class: 'header-top-row foundation-reference-header' }, [
          h('div', { class: 'header-info' }, [h('h2', {}, '系统设置'), h('div', { class: 'header-subtitle' }, ['管理系统 / ', h('span', { class: 'active-sub' }, '系统设置')])]),
          connectionOnly() ? null : h('div', { class: 'foundation-reference-header-actions' }, [
            h('span', { class: 'village-status-pill' }, `🏡 ${settings.value.village_name || '社区工作区'}`),
            button(refreshing.value ? '刷新中…' : '🔄 刷新配置', refresh, { disabled: refreshing.value, secondary: true, testid: 'community-refresh-settings' }),
          ]),
        ]),
      ]),
      loading.value ? h('p', { class: 'foundation-settings-loading', role: 'status' }, '正在载入系统设置…')
        : h('div', { class: 'settings-workspace settings-main-unified-card party-main-unified-card', 'data-testid': 'settings-workspace' }, [
          connectionOnly() ? h('p', { class: 'foundation-lan-account-hint', role: 'status' }, '请先连接单位主电脑，再进入工作台。可以自动扫描，也可以输入主电脑 IP。') : h('div', { class: 'party-unified-tabs-bar settings-unified-tabs-bar', role: 'tablist', 'aria-label': '系统设置分类', 'data-testid': 'settings-tabs-bar' }, [
            h('aside', { class: 'settings-tabbar party-sub-tab-nav', id: 'settingsTabbar' }, tabs.map(([id, label]) => h('button', {
              type: 'button', role: 'tab', class: `settings-tab-btn cwt-sub-tab-btn party-sub-tab-btn${activeTab.value === id ? ' active' : ''}`,
              'aria-selected': String(activeTab.value === id), 'data-settings-tab': id, 'data-testid': `settings-tab-${id}`,
              onClick: () => { selectedCadre.value = null; activeTab.value = id; },
            }, [h('span', { class: 'tab-label' }, label)]))),
          ]),
          h('div', { class: 'settings-content', 'data-testid': 'settings-subtab-pane' }, [panel()]),
        ]),
    ]);
  };
}
