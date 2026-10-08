import { backupPanel, accountPanel, aiSettingsPanel, lanPanel, menuPanel, createElementVNode as h, ref, onMounted, useAppStore, useAuthStore, useDialogStore } from './vendor/assets/foundation-runtime.mjs';
import { loadScript } from './extensions.mjs';
import { readMenuConfiguration, sortMenuItems, moveMenuRow, menuRows, menuConfigFromRows, orderDefaultMenus } from './menu-configuration.mjs';
let defaultMenuOrder = [];
export function initializeMenuConfiguration(shell) {
  defaultMenuOrder = orderDefaultMenus(shell.allMenus);
  shell.allMenus.splice(0, shell.allMenus.length, ...sortMenuItems(shell.allMenus, readMenuConfiguration(), defaultMenuOrder));
  shell.reloadMenuConfig();
}
const button = (label, action, busy, testid) => h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onClick: action, 'data-testid': testid }, label);
const field = (label, value, update, type = 'text', placeholder = '') => h('label', { class: 'foundation-setting-field' }, [h('span', {}, label), h('input', { type, value, placeholder, onInput: event => update(event.target.value) })]);
const message = state => state.value ? h('p', { role: 'status', class: 'foundation-setting-message' }, state.value) : null;
function taskState() {
  const busy = ref(false), status = ref('');
  const run = async callback => {
    if (busy.value) return;
    busy.value = true; status.value = '';
    try { await callback(); } catch (error) { status.value = error?.message || '操作失败，请重试'; }
    finally { busy.value = false; }
  };
  return { busy, status, run };
}
export function installCommunitySettings() {
  menuPanel.setup = () => {
    const shell = useAppStore();
    const status = ref('');
    const rows = ref(menuRows(shell.allMenus, shell.menuVisibilityConfig));
    onMounted(() => {
      void window.api.getAccountPreferences().then(preferences => {
        const config = preferences?.menu || {};
        rows.value = menuRows(sortMenuItems(shell.allMenus, config, defaultMenuOrder), config);
      }).catch(error => { status.value = error.message || '暂时无法读取账号菜单设置'; });
    });
    const move = (key, value) => { rows.value = moveMenuRow(rows.value, key, value); };
    const save = async () => {
      const config = { ...shell.menuVisibilityConfig, ...menuConfigFromRows(rows.value) };
      await window.api.saveAccountPreferences({ menu: config });
      shell.allMenus.splice(0, shell.allMenus.length, ...sortMenuItems(shell.allMenus, config, defaultMenuOrder));
      shell.setMenuVisibilityConfig(config);
      status.value = '菜单名称、显示状态和顺序已保存，左侧菜单已同步。';
    };
    const reset = async () => {
      await window.api.saveAccountPreferences({ menu: {} });
      shell.allMenus.splice(0, shell.allMenus.length, ...sortMenuItems(shell.allMenus, {}, defaultMenuOrder));
      shell.resetMenuVisibilityConfig();
      rows.value = menuRows(shell.allMenus);
      status.value = '已恢复默认菜单顺序、名称和显示状态。';
    };
    return () => h('section', { class: 'settings-card foundation-menu-settings', 'data-testid': 'menu-settings-panel' }, [
      h('div', { class: 'card-header' }, [h('h3', {}, '🧭 功能菜单、名称与排序')]),
      h('div', { class: 'card-body' }, [
        h('p', {}, '这里与左侧菜单使用同一份配置。修改排序号可调整位置，保存后立即同步到左侧；隐藏菜单不会删除其中的数据。系统设置始终显示。'),
        h('div', { class: 'foundation-menu-grid', 'data-testid': 'menu-visibility-list' }, rows.value.map(row => h('div', { class: 'foundation-menu-card', key: row.key, 'data-testid': `menu-config-${row.key}` }, [
          h('div', { class: 'foundation-menu-card__top' }, [
            h('label', { class: 'foundation-menu-visibility' }, [h('input', { type: 'checkbox', checked: row.visible, disabled: row.key === 'settings', onChange: event => { row.visible = event.target.checked; status.value = ''; } }), h('span', {}, row.label)]),
            row.key === 'settings' ? h('span', { class: 'foundation-menu-fixed' }, '常驻') : null,
          ]),
          h('div', { class: 'foundation-menu-card__fields' }, [
            h('label', {}, [h('span', {}, '左侧名称'), h('input', { type: 'text', value: row.customAlias, placeholder: row.label, 'aria-label': `${row.label}的左侧名称`, onInput: event => { row.customAlias = event.target.value; status.value = ''; } })]),
            h('label', {}, [h('span', {}, '排序号'), h('input', { type: 'number', min: 1, max: rows.value.length, step: 1, value: row.order, 'aria-label': `${row.label}的排序号`, onChange: event => { move(row.key, event.target.value); status.value = ''; } })]),
          ]),
        ]))),
        h('div', { class: 'foundation-menu-actions' }, [
          h('button', { class: 'btn btn-primary', type: 'button', onClick: () => { void save().catch(error => { status.value = error.message || '保存失败'; }); }, 'data-testid': 'save-menu-settings' }, '保存菜单配置'),
          h('button', { class: 'btn', type: 'button', onClick: () => { void reset().catch(error => { status.value = error.message || '恢复失败'; }); }, 'data-testid': 'reset-menu-settings' }, '恢复默认菜单'),
        ]),
        message(status),
      ]),
    ]);
  };
  backupPanel.setup = () => {
    const { busy, status, run } = taskState(); const rows = ref([]), directory = ref(''); const dialogs = useDialogStore();
    const load = async () => { directory.value = await window.api.getDbDir(); rows.value = (await window.api.listV3AutoBackups()).backups; };
    const create = () => run(async () => { const result = await window.api.createV3Backup(); if (!result.success) throw new Error(result.error || '备份失败'); await load(); status.value = result.warning || `备份已保存，包含 ${result.filesCount} 个附件。`; });
    const restore = row => run(async () => {
      if (!await dialogs.confirm(`将业务数据恢复到 ${new Date(row.createdAt).toLocaleString()}。此后的业务修改会被替换，系统会先保存一份当前数据和附件备份。是否继续？`, '恢复备份')) return;
      const result = await window.api.restoreV3DbBackup({ relativePath: row.relativePath });
      if (!result.success) throw new Error(result.error || '恢复失败');
      status.value = result.warning || '数据已恢复，正在重新载入页面。';
      setTimeout(() => location.reload(), 1000);
    });
    onMounted(() => run(load));
    return () => h('section', { class: 'foundation-settings-panel', 'data-testid': 'community-backup-panel' }, [
      h('h3', {}, '数据与附件备份'), h('p', {}, '备份当前工作区的业务数据和能找到的关联附件。恢复前会校验备份并另存当前状态。'),
      h('code', {}, `${directory.value}/foundation-backups`),
      h('div', { class: 'foundation-setting-actions' }, [button('创建备份', create, busy.value, 'community-backup-create'), button('刷新备份列表', () => run(load), busy.value),
        button('打开备份目录', () => run(async () => { const result = await window.api.openPath(`${directory.value}/foundation-backups`); if (!result.ok) throw new Error(result.error); }), busy.value)]),
      message(status), h('p', {}, '备份保存在本机，请定期将备份目录复制到外部存储。无法找到的历史附件会单独提示。'),
      ...rows.value.map(row => h('article', { class: 'foundation-backup-row', key: row.relativePath }, [h('div', {}, [h('strong', {}, new Date(row.createdAt).toLocaleString()),
        h('p', {}, `${row.manifest.files.length} 个附件 · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB${row.manifest.missingFiles?.length ? ` · ${row.manifest.missingFiles.length} 个历史路径缺失` : ''}`)]), button('恢复此备份', () => restore(row), busy.value)])),
      !rows.value.length ? h('p', {}, busy.value ? '正在读取…' : '尚无新版完整备份。改造前的完整备份另行保留。') : null,
    ]);
  };
  accountPanel.setup = () => {
    const { busy, status, run } = taskState(); const auth = useAuthStore(); const account = ref({}), version = ref(''); const activation = ref('');
    const load = async () => { account.value = await window.api.getLocalAuthStatus(); version.value = await window.api.getVersion(); };
    onMounted(() => run(load));
    return () => h('section', { class: 'foundation-settings-panel', 'data-testid': 'community-account-panel' }, [
      h('h3', {}, "村居账号与应用更新"), h('p', {}, `${account.value.account?.name || ''} ${account.value.account?.phone || ''}`),
      h('p', {}, `当前版本：${version.value} · ${account.value.entitlement?.label || account.value.entitlement?.type || ''}`),
      h('div', { class: 'foundation-setting-actions' }, [
        button('检查更新', () => run(async () => { await loadScript('js/update-ui.js'); const result = await window.api.checkForAppUpdate(); if (result.disabled) { status.value = '独立开发版不检查正式更新'; return; } if (!result.ok) throw new Error(result.error || '检查更新失败'); status.value = '已发起检查，请查看更新提示。'; }), busy.value, 'community-update-check'),
        ['unit_admin', 'main_account'].includes(account.value.account?.role) ? button('成员与权限', () => run(async () => { await loadScript('js/unit-member-management-ui.js'); await window.unitMemberManagement.open(account.value); }), busy.value) : null,
        button('同步账号授权', () => run(async () => { await auth.refresh(); await load(); status.value = '账号授权已刷新'; }), busy.value),
        button('退出登录', () => run(() => auth.logout()), busy.value),
      ]),
      h('details', {}, [h('summary', {}, '离线授权激活'), h('p', {}, `本机设备码：${account.value.machineId || ''}`),
        field('授权码', activation.value, value => activation.value = value), button('验证并激活', () => run(async () => { await window.api.activateOfflineLicense(activation.value.trim()); activation.value = ''; await auth.refresh(); await load(); status.value = '授权已更新'; }), busy.value)]),
      message(status), h('p', {}, "账号、单位、AI 和更新继续使用村居系统配置的服务。"),
    ]);
  };
  aiSettingsPanel.setup = () => {
    const { busy, status, run } = taskState();
    const settings = ref({ mode: 'local', localModelPath: '', online: {} });
    const models = ref([]), runtime = ref({ running: false });
    const quota = ref(null), usage = ref([]), usagePagination = ref({ page: 1, totalPages: 1, total: 0 });
    const quotaStatus = ref(''); const backendUrl = ref('');
    const formatTokens = value => Number(value || 0).toLocaleString('zh-CN');
    const creditsMode=()=>quota.value?.billingUnit==='credits';
    const unit=()=>creditsMode()?'积分':'Token';
    const quotaAmount=key=>Number(quota.value?.[key+(creditsMode()?'Credits':'Tokens')]||0).toLocaleString('zh-CN',{maximumFractionDigits:4});
    const refreshRuntime = async () => { [models.value, runtime.value] = await Promise.all([window.api.scanLocalModels(), window.api.getInternalAiServerStatus()]); };
    const refreshQuota = async () => {
      quotaStatus.value = '';
      if (!window.api.getAiQuota || !window.api.getAiUsageDetail) return;
      try {
        const [quotaResult, usageResult, server] = await Promise.all([
          window.api.getAiQuota(), window.api.getAiUsageDetail({ page: 1, pageSize: 8, days: 30 }), window.api.getRemoteServerConfig?.(),
        ]);
        quota.value = quotaResult?.quota || null;
        usage.value = usageResult?.usage || [];
        usagePagination.value = usageResult?.pagination || usagePagination.value;
        backendUrl.value = server?.baseUrl || '';
      } catch (error) { quotaStatus.value = error?.message || '暂时无法读取在线 AI 额度，请先登录单位账号'; }
    };
    onMounted(() => run(async () => { settings.value = await window.api.getAiSettings(); await Promise.all([refreshRuntime(), refreshQuota()]); }));
    const save = async () => { settings.value = await window.api.saveAiSettings({ mode: settings.value.mode, localModelPath: settings.value.localModelPath }); status.value = 'AI 设置已保存'; };
    return () => h('section', { class: 'foundation-settings-panel', 'data-testid': 'community-ai-settings' }, [h('h3', {}, 'AI 服务设置'),
      h('label', { class: 'foundation-setting-field' }, [h('span', {}, '运行方式'), h('select', { value: settings.value.mode, onChange: event => settings.value.mode = event.target.value },
        [['local', '本机模型'], ['online', '在线模型'], ['auto', '自动选择']].map(([value, label]) => h('option', { value }, label)))]),
      field('本机模型路径', settings.value.localModelPath, value => settings.value.localModelPath = value),
      h('label', { class: 'foundation-setting-field' }, [h('span', {}, '已导入模型'), h('select', { value: settings.value.localModelPath, onChange: event => settings.value.localModelPath = event.target.value }, [
        h('option', { value: '' }, '选择本机 GGUF 模型'), ...models.value.map(model => h('option', { value: model.path }, `${model.name} · ${(model.size / 1024 / 1024).toFixed(0)} MB`)),
      ])]),
      h('p', { 'data-testid': 'community-ai-runtime-status' }, `本机服务：${runtime.value.running ? '运行中' : runtime.value.loading ? '加载中' : '未启动'}${runtime.value.modelPath ? ` · ${runtime.value.modelPath.split('/').pop()}` : ''}`),
      h('div', { class: 'foundation-setting-actions' }, [
        button('扫描模型', () => run(refreshRuntime), busy.value),
        button('导入 GGUF', () => run(async () => { const result = await window.api.importLocalModel(); if (result.canceled) return; if (!result.model?.path) throw new Error(result.error || '导入模型失败'); settings.value.localModelPath = result.model.path; await refreshRuntime(); status.value = '模型已导入，请保存设置。'; }), busy.value),
        button('打开模型目录', () => run(async () => { const result = await window.api.openModelsDir(); if (result?.ok === false) throw new Error(result.error || '打开模型目录失败'); }), busy.value),
        button(runtime.value.running ? '停止本机模型' : '启动本机模型', () => run(async () => {
          const action = runtime.value.running ? 'stop' : 'start';
          if (action === 'start' && !settings.value.localModelPath) throw new Error('请先选择或导入本机模型');
          try { runtime.value = await window.api.toggleInternalAiServer({ action, modelPath: settings.value.localModelPath }); }
          finally { await refreshRuntime(); }
        }), busy.value, 'community-ai-toggle'),
      ]),
      h('div', { class: 'foundation-ai-online-card' }, [
        h('div', { class: 'foundation-ai-online-heading' }, [h('strong', {}, '在线 AI（单位共享额度）'), h('span', { class: 'foundation-ai-online-badge' }, '后端统一管理')]),
        h('p', {}, "在线模型由村居账号服务统一调用，桌面端不保存或填写 API 密钥。所有本单位账号共用同一 AI 额度，额度永久有效，用完后请联系平台管理员购买。"),
        h('div', { class: 'foundation-ai-server-line' }, [h('span', {}, '当前账号服务器'), h('code', {}, backendUrl.value || '尚未配置')]),
      ]),
      quota.value ? h('div', { class: 'foundation-ai-quota-grid', 'data-testid': 'community-ai-quota' }, [
        h('div', { class: 'foundation-ai-quota-card' }, [h('span', {}, '永久总额度'), h('strong', {}, `${quotaAmount("total")} ${unit()}`)]),
        h('div', { class: 'foundation-ai-quota-card' }, [h('span', {}, '已使用'), h('strong', {}, `${quotaAmount("used")} ${unit()}`)]),
        h('div', { class: 'foundation-ai-quota-card is-primary' }, [h('span', {}, '当前可用'), h('strong', {}, `${quotaAmount("remaining")} ${unit()}`)]),
        h('div', { class: 'foundation-ai-quota-card' }, [h('span', {}, '预留中'), h('strong', {}, `${quotaAmount("reserved")} ${unit()}`)]),
      ]) : null,
      quota.value ? h('div', { class: 'foundation-ai-quota-progress' }, [h('div', { class: 'foundation-ai-quota-progress-head' }, [h('span', {}, '本单位在线 AI 用量'), h('span', {}, `${quotaAmount("used")} / ${quotaAmount("total")} ${unit()}`)]), h('div', { class: 'foundation-ai-quota-progress-track' }, [h('span', { style: { width: `${Math.min(100, Math.round((quota.value.usedTokens / Math.max(1, quota.value.totalTokens)) * 100))}%` } })])]) : null,
      h('div', { class: 'foundation-setting-actions' }, [
        button('保存设置', () => run(save), busy.value, 'community-ai-save'),
        button('测试在线 AI（会消耗少量额度）', () => run(async () => { await window.api.testOnlineAi(); await refreshQuota(); status.value = '在线 AI 连接成功'; }), busy.value),
        button('刷新额度与明细', () => run(refreshQuota), busy.value),
      ]),
      quotaStatus.value ? h('p', { class: 'foundation-ai-quota-warning' }, quotaStatus.value) : null,
      h('div', { class: 'foundation-ai-usage' }, [h('div', { class: 'foundation-ai-usage-heading' }, [h('h4', {}, '最近在线 AI 使用记录'), h('span', {}, `近 30 天 ${formatTokens(usagePagination.value.total)} 次`)]),
        usage.value.length ? h('div', { class: 'foundation-ai-usage-table-wrap' }, [h('table', { class: 'foundation-ai-usage-table' }, [h('thead', {}, [h('tr', {}, ['时间', '账号', '模型', `消耗 ${unit()}`, '状态'].map(label => h('th', {}, label)))]), h('tbody', {}, usage.value.map(row => h('tr', { key: row.id }, [h('td', {}, new Date(row.createdAt).toLocaleString()), h('td', {}, row.userName || '当前账号'), h('td', {}, row.model || '在线模型'), h('td', {}, creditsMode() && row.chargedCredits !== null && row.chargedCredits !== undefined ? `${Number(row.chargedCredits).toLocaleString('zh-CN')} 积分` : `${formatTokens(row.chargedTokens ?? row.totalTokens)} Token`), h('td', { class: row.status === 'success' ? 'is-success' : 'is-error' }, row.status === 'success' ? '成功' : '失败')])))] )]) : h('p', { class: 'foundation-ai-usage-empty' }, quotaStatus.value ? '登录后可查看本单位使用明细' : '暂无在线 AI 使用记录'),
      ]),
      message(status),
    ]);
  };
  lanPanel.setup = () => {
    const { busy, status, run } = taskState();
    const baseUrl = ref('');
    const account = ref(null), lanInfo = ref(null), hosts = ref([]), hostIp = ref('');
    const lanBusy = ref(false), lanStatus = ref(''), lanError = ref(false);
    const isMember = () => account.value?.role === 'member';
    const loadLan = async () => {
      if (window.communitySettingsReferenceSync) return;
      try {
        account.value = (await window.api.getLocalAuthStatus()).account || null;
        if (!isMember()) return;
        lanInfo.value = await window.api.getLanShareInfo();
        if (!hostIp.value && lanInfo.value?.connection?.baseUrl) hostIp.value = new URL(lanInfo.value.connection.baseUrl).hostname;
      } catch (cause) { lanStatus.value = cause.message || '无法读取主电脑连接状态'; lanError.value = true; }
    };
    const runLan = async callback => {
      if (lanBusy.value) return;
      lanBusy.value = true; lanStatus.value = ''; lanError.value = false;
      try { await callback(); } catch (cause) { lanStatus.value = cause.message || '主电脑连接失败'; lanError.value = true; }
      finally { lanBusy.value = false; }
    };
    const scanLan = () => runLan(async () => {
      const result = await window.api.updateLanShareConfig({ action: 'scan' });
      hosts.value = result.hosts || [];
      lanStatus.value = hosts.value.length ? `发现 ${hosts.value.length} 台主电脑，请选择属于当前账号的设备。` : '未发现主电脑，请确认同一局域网，或手动输入主电脑 IP。';
    });
    const testLan = () => runLan(async () => {
      await window.api.updateLanShareConfig({ action: 'check', ip: hostIp.value.trim() });
      lanInfo.value = { ...(lanInfo.value || {}), connection: { ...(lanInfo.value?.connection || {}), status: 'online', baseUrl: `http://${hostIp.value.trim()}:3000` } };
      lanStatus.value = '主电脑连接成功，账号归属已核对。';
    });
    const connectLan = () => runLan(async () => {
      await window.api.updateLanShareConfig({ action: 'connect', ip: hostIp.value.trim() });
      lanStatus.value = '已连接主电脑，正在进入工作台…';
      location.reload();
    });
    onMounted(() => run(async () => {
      baseUrl.value = (await window.api.getRemoteServerConfig()).baseUrl || '';
      await loadLan();
    }));
    const fallbackConnection = () => !window.communitySettingsReferenceSync && isMember() ? h('section', { class: 'foundation-settings-panel foundation-lan-fallback', 'data-testid': 'legacy-lan-connection-panel' }, [
      h('h3', {}, '主电脑连接'),
      h('p', {}, '当前账号是子账号。请扫描主电脑，或输入主电脑的局域网 IP，连接后使用主电脑上的业务数据。'),
      h('div', { class: 'foundation-setting-actions' }, [button(lanBusy.value ? '扫描中…' : '扫描主电脑', scanLan, lanBusy.value, 'legacy-lan-scan')]),
      hosts.value.length ? h('div', { class: 'foundation-lan-host-list' }, hosts.value.map(host => h('div', { class: 'foundation-lan-host', key: host.ip }, [
        h('div', {}, [h('strong', {}, `${host.name || '主电脑'} · ${host.ip}`), h('small', {}, host.matched ? '属于当前账号 · 可连接' : host.reason || '无法连接')]),
        h('button', { class: 'btn btn-outline', type: 'button', disabled: !host.matched, onClick: () => { hostIp.value = host.ip; } }, '选择'),
      ]))) : null,
      field('主电脑 IP', hostIp.value, value => { hostIp.value = value; }, 'text', '例如 192.168.2.106'),
      h('div', { class: 'foundation-setting-actions' }, [
        button(lanBusy.value ? '检查中…' : '测试连接', testLan, lanBusy.value || !hostIp.value.trim(), 'legacy-lan-check'),
        button('连接并使用主电脑数据', connectLan, lanBusy.value || !hostIp.value.trim(), 'legacy-lan-connect'),
      ]),
      lanStatus.value ? h('p', { class: `foundation-setting-message${lanError.value ? ' is-error' : ''}`, role: lanError.value ? 'alert' : 'status' }, lanStatus.value) : null,
    ]) : null;
    return () => h('div', {}, [fallbackConnection(), h('section', { class: 'foundation-settings-panel' }, [h('h3', {}, "村居单位服务"),
      h('p', {}, "单位账号和共享工作区使用村居系统的服务地址。"), field('服务地址', baseUrl.value, value => baseUrl.value = value),
      button('检查连接并保存', () => run(async () => { const result = await window.api.checkRemoteServerConnection({ baseUrl: baseUrl.value }); if (result.ok === false) throw new Error(result.error || '连接失败'); await window.api.setRemoteServerConfig({ baseUrl: baseUrl.value }); await useAuthStore().refresh(); location.reload(); }), busy.value), message(status)])]);
  };
}
