import { createElementVNode as h, ref, onMounted, onBeforeUnmount, useDialogStore, useOverviewStore, router } from './vendor/assets/foundation-runtime.mjs';
import { createMobileInterop } from './mobile-interop.mjs';
import { applyResidentToCadre, createCadre, deleteCadre as removeCadreRecord, readCadreRoster, searchCadreResidents } from './mobile-cadre-roster.mjs';
import { loadScript } from './extensions.mjs';
import { autoConnectHost } from './workspace-connection.mjs';

const action = (label, onClick, { secondary = false, disabled = false, testid } = {}) => h('button', {
  type: 'button', class: `btn ${secondary ? 'btn-outline' : 'btn-primary'}`,
  disabled, onClick, 'data-testid': testid,
}, label);
const notice = (text, error = false) => text ? h('p', {
  class: `foundation-setting-message${error ? ' is-error' : ''}`,
  role: error ? 'alert' : 'status',
}, text) : null;
const formatDate = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const formatSize = bytes => Number(bytes || 0) < 1024 * 1024
  ? `${Math.max(1, Math.round(Number(bytes || 0) / 1024))} KB`
  : `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;

async function copyText(value) {
  if (!value) throw new Error('当前没有可复制的地址');
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* Use the selection fallback. */ }
  }
  const input = document.createElement('textarea');
  input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input); input.select();
  const copied = document.execCommand('copy'); input.remove();
  if (!copied) throw new Error('无法自动复制，请选中地址手动复制');
}

export const MobileConnectivityPanel = { props: { onOpenAccess: Function }, setup(props) {
  const interop = createMobileInterop(window.api);
  const session = ref(null), selectedIp = ref(''), overview = ref(null);
  const busy = ref(false), message = ref(''), error = ref(false), received = ref(0), now = ref(Date.now());
  const roster = ref([]), members = ref([]), auth = ref(null), filter = ref(''), accountLookupFailed = ref(false);
  const addOpen = ref(false), form = ref({ name: '', phone: '', idCard: '', position: '', duty: '', personId: '' });
  const personMatches = ref([]), searchTerm = ref(''), searching = ref(false), searchMessage = ref(''), searchError = ref(false), saving = ref(false);
  const dialogs = useDialogStore();
  const overviewStore = useOverviewStore();
  let unsubscribe, timer, qrHost, searchTimer, searchSerial = 0;
  const canManage = () => ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(auth.value?.account?.role);
  const visibleCadres = () => roster.value.filter(item => `${item.name} ${item.phone} ${item.position}`.toLocaleLowerCase().includes(filter.value.trim().toLocaleLowerCase()));
  const accountFor = cadre => members.value.find(member => member.phone === cadre.phone);
  const loadRosterAndAccounts = async () => {
    const [cadres, account] = await Promise.all([readCadreRoster(window.api), window.api.getLocalAuthStatus()]);
    roster.value = cadres; auth.value = account;
    members.value = []; accountLookupFailed.value = false;
    if (canManage()) {
      try { members.value = (await window.api.listUnitMembers()).members || []; }
      catch { accountLookupFailed.value = true; }
    }
  };
  const searchPeople = keyword => {
    clearTimeout(searchTimer);
    const serial = ++searchSerial;
    personMatches.value = []; searchMessage.value = ''; searchError.value = false;
    if (!keyword.trim()) { searching.value = false; return; }
    searching.value = true;
    searchTimer = setTimeout(async () => {
      try {
        const matches = await searchCadreResidents(window.api, keyword);
        if (serial === searchSerial) {
          personMatches.value = matches;
          if (!matches.length) searchMessage.value = '居民库中没有匹配记录。可继续手动录入姓名和手机号。';
        }
      } catch (cause) {
        if (serial === searchSerial) { searchMessage.value = cause.message || '居民档案检索失败'; searchError.value = true; }
      }
      finally { if (serial === searchSerial) searching.value = false; }
    }, 250);
  };
  const addCadre = async () => {
    if (saving.value) return;
    saving.value = true; error.value = false; message.value = '';
    try {
      roster.value = await createCadre(window.api, form.value);
      overviewStore.invalidate(); await overviewStore.load().catch(() => {});
      addOpen.value = false; personMatches.value = []; message.value = '干部已加入摸底名册';
    } catch (cause) { error.value = true; message.value = cause.message || '保存干部失败'; }
    finally { saving.value = false; }
  };
  const deleteCadre = async cadre => {
    if (!await dialogs.confirm(`将 ${cadre.name} 移出摸底干部名册？此操作不会停用其子账号。`, '移出干部')) return;
    try { roster.value = await removeCadreRecord(window.api, cadre); overviewStore.invalidate(); await overviewStore.load().catch(() => {}); message.value = '已移出干部名册'; error.value = false; }
    catch (cause) { message.value = cause.message || '移出失败'; error.value = true; }
  };
  const addresses = () => session.value?.addresses || [];
  const primary = () => addresses().find(item => item.ip === selectedIp.value) || addresses()[0];
  const active = () => !!(primary() && session.value?.expiresAt > now.value);
  const drawQr = async () => {
    if (!qrHost || !active()) return;
    try {
      await loadScript('js/core/qrcode.min.js');
      if (!qrHost || !active()) return;
      qrHost.replaceChildren();
      new window.QRCode(qrHost, { text: primary().qrUrl, width: 150, height: 150, correctLevel: window.QRCode.CorrectLevel.M });
    } catch { /* The address remains copyable. */ }
  };
  const refresh = async () => {
    busy.value = true; message.value = ''; error.value = false;
    const [connection, counts, cadreData] = await Promise.allSettled([
      interop.getUploadSession(), window.api.businessRequest({ path: '/api/v3/dashboard/overview' }), loadRosterAndAccounts(),
    ]);
    if (connection.status === 'fulfilled') {
      session.value = connection.value;
      selectedIp.value = addresses()[0]?.ip || '';
      await Promise.resolve();
      void drawQr();
    } else {
      session.value = null; message.value = connection.reason?.message || '手机上传服务不可用'; error.value = true;
    }
    if (counts.status === 'fulfilled' && counts.value?.ok) overview.value = counts.value.data?.overview || null;
    if (cadreData.status === 'rejected') { message.value = cadreData.reason?.message || '干部名册读取失败'; error.value = true; }
    busy.value = false; now.value = Date.now();
  };
  const copyAddress = async () => {
    try { await copyText(primary()?.url); message.value = '手机上传地址已复制'; error.value = false; }
    catch (cause) { message.value = cause.message; error.value = true; }
  };
  onMounted(() => {
    void refresh();
    unsubscribe = interop.onFileReceived(() => { received.value += 1; message.value = '文件已传到电脑，请核对并归档'; error.value = false; });
    timer = setInterval(() => { now.value = Date.now(); }, 15000);
  });
  onBeforeUnmount(() => { unsubscribe?.(); clearInterval(timer); clearTimeout(searchTimer); });
  const metric = (label, value) => h('div', { class: 'foundation-connect-kpi' }, [h('strong', {}, value), h('span', {}, label)]);
  const rule = (title, description) => h('div', { class: 'foundation-connect-rule' }, [h('strong', {}, title), h('p', {}, description)]);
  return () => h('div', { class: 'settings-panel foundation-connect-page', 'data-testid': 'community-mobile-settings' }, [
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [
        h('div', {}, [h('h3', {}, '📱 手机互联 · 下乡摸底与干部设备协同调度台'), h('p', {}, '局域网文件传送 · 电脑端权威底册 · 干部名册与子账号管理')]),
        h('div', { class: 'foundation-connect-head-actions' }, [
          h('span', { class: `foundation-connect-status${active() ? ' is-running' : ''}` }, active() ? '● 手机上传服务运行中' : '● 手机上传服务未就绪'),
          action('复制局域网地址', copyAddress, { secondary: true, disabled: !active(), testid: 'community-mobile-copy' }),
          action(busy.value ? '刷新中…' : '刷新连接', refresh, { secondary: true, disabled: busy.value, testid: 'community-mobile-refresh' }),
        ]),
      ]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        h('div', { class: 'foundation-connect-benchmark' }, [
          h('div', { class: 'foundation-connect-benchmark-main' }, [
            h('div', { class: 'foundation-connect-eyebrow' }, '当前电脑大盘权威底册基准'),
            h('div', { class: 'foundation-connect-metrics' }, [
              metric('在册人员', overview.value ? Number(overview.value.totalActivePeople || 0).toLocaleString('zh-CN') : '—'),
              metric('土地地块', overview.value ? Number(overview.value.totalLandCount || 0).toLocaleString('zh-CN') : '—'),
            ]),
          ]),
          h('div', { class: 'foundation-connect-benchmark-side' }, [
            h('div', { class: 'foundation-connect-eyebrow' }, '局域网连接与设备授权'),
            h('p', {}, `手机上传简短地址：${active() ? primary().url : '未就绪'}`),
            h('p', {}, accountLookupFailed.value ? `干部名册：${roster.value.length} 人 · 子账号状态暂不可查 · 手机设备绑定待小程序接入` : `干部名册：${roster.value.length} 人 · 已开通子账号：${roster.value.filter(item => accountFor(item)).length} 人 · 手机设备绑定待小程序接入`),
          ]),
        ]),
        h('div', { class: 'foundation-connect-toolbar' }, [
          h('div', { class: 'foundation-connect-toolbar__search' }, [h('input', { type: 'search', value: filter.value, placeholder: '搜索干部姓名 / 电话 / 职务…', onInput: event => { filter.value = event.target.value; }, 'aria-label': '搜索摸底干部' }), h('span', {}, `共 ${roster.value.length} 位下乡摸底干部`)]),
          h('div', { class: 'foundation-connect-actions' }, [
            canManage() ? action('＋ 新增干部 / 从人员档案关联', () => { form.value = { name: '', phone: '', idCard: '', position: '', duty: '', personId: '' }; searchTerm.value = ''; personMatches.value = []; searchMessage.value = ''; searchError.value = false; addOpen.value = true; }, { testid: 'community-cadre-add' }) : null,
            action('刷新对账台', refresh, { secondary: true, disabled: busy.value }),
          ]),
        ]),
        h('div', { class: 'foundation-connect-table-wrap' }, [h('table', { class: 'foundation-connect-table' }, [
          h('thead', {}, [h('tr', {}, ['干部姓名', '联系电话', '已授权绑定手机', '手机当前持有的底册数据', '最近回传成果', '协同操作'].map(label => h('th', {}, label)))]),
          h('tbody', {}, visibleCadres().length ? visibleCadres().map(cadre => h('tr', { key: cadre.id }, [
            h('td', {}, [h('strong', {}, cadre.name), h('small', {}, cadre.position || '摸底干部')]),
            h('td', {}, cadre.phone || '未填写'),
            h('td', {}, [h('span', { class: `foundation-connect-account-badge${accountFor(cadre) ? ' is-linked' : ''}` }, accountLookupFailed.value ? '账号状态暂不可查' : accountFor(cadre) ? '子账号已开通' : '未开通子账号'), h('small', {}, '手机设备待小程序接入')]),
            h('td', {}, '从未下载 · 小程序底册接口待接通'),
            h('td', {}, '暂无回传记录'),
            h('td', {}, [action(accountFor(cadre) ? '账号授权' : '开通子账号', () => props.onOpenAccess?.(cadre), { secondary: true, disabled: !canManage() }),
              action('专属码', () => {}, { secondary: true, disabled: true }),
              canManage() ? action('移出', () => { void deleteCadre(cadre); }, { secondary: true }) : null]),
          ])) : [h('tr', {}, [h('td', { colspan: 6, class: 'foundation-connect-empty' }, filter.value ? '没有符合搜索条件的干部。' : '暂无摸底干部，点击“新增干部”从人员档案关联或手动录入。')])]),
        ])]),
        h('div', { class: 'foundation-connect-rules' }, [
          rule('局域网文件传送', '手机与电脑连接同一局域网，上传链接只对当前账号有效，15 分钟后失效。'),
          rule('底册以电脑端为准', '当前人数和土地数读取本机业务数据；小程序底册下载尚未开放。'),
          rule('干部实名认领', `接口契约 v${interop.protocolVersion} 已预留，设备绑定、增量回传和审核后续接通。`),
        ]),
      ]),
    ]),
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [h('div', {}, [h('h3', {}, '手机扫码上传'), h('p', {}, '使用手机浏览器打开二维码或局域网地址，上传照片和文件。')])]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        active() ? h('div', { class: 'foundation-mobile-connection' }, [
          h('div', { class: 'foundation-mobile-qr', role: 'img', 'aria-label': '手机上传地址二维码', ref: element => { qrHost = element; if (element) void drawQr(); } }),
          h('div', { class: 'foundation-mobile-connection__details' }, [
            addresses().length > 1 ? h('label', { class: 'foundation-setting-field' }, [h('span', {}, '选择电脑所在网络'), h('select', { value: selectedIp.value, onChange: event => { selectedIp.value = event.target.value; void drawQr(); } }, addresses().map(item => h('option', { value: item.ip }, item.ip)))]) : null,
            h('label', { class: 'foundation-setting-field' }, [h('span', {}, '手机上传简短地址'), h('input', { type: 'text', readonly: true, value: primary().url, 'data-testid': 'community-mobile-url', onFocus: event => event.target.select() })]),
            h('p', {}, `有效期至 ${new Date(session.value.expiresAt).toLocaleTimeString('zh-CN')} · 本次页面已接收 ${received.value} 个文件`),
          ]),
        ]) : h('p', {}, '连接尚未就绪，刷新连接后查看上传二维码。'),
        notice(message.value, error.value),
      ]),
    ]),
    addOpen.value ? h('div', { class: 'foundation-cadre-modal-backdrop', role: 'presentation', onClick: event => { if (event.target === event.currentTarget) addOpen.value = false; } }, [
      h('section', { class: 'foundation-cadre-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '新增干部 / 从全村人员档案关联' }, [
        h('header', {}, [h('h3', {}, '新增干部 / 从全村人员档案关联'), action('关闭', () => { addOpen.value = false; }, { secondary: true })]),
        h('div', { class: 'foundation-cadre-modal__body' }, [
          h('label', {}, [h('span', {}, '姓名 / 全村档案关联 *'), h('input', { type: 'search', value: searchTerm.value, placeholder: '输入姓名、手机号或身份证号检索居民…', onInput: event => { const term = event.target.value; searchTerm.value = term; form.value = { ...form.value, name: /^\d{6,18}[Xx]?$/u.test(term.trim()) ? '' : term, phone: form.value.personId ? '' : form.value.phone, idCard: '', personId: '' }; searchPeople(term); }, 'data-testid': 'community-cadre-name', 'aria-controls': 'community-cadre-search-results' })]),
          searching.value ? h('small', { role: 'status' }, '正在搜索居民档案…') : null,
          personMatches.value.length ? h('div', { id: 'community-cadre-search-results', class: 'foundation-cadre-matches', role: 'listbox', 'aria-label': '居民档案匹配结果' }, personMatches.value.map(person => h('button', { type: 'button', role: 'option', onClick: () => { clearTimeout(searchTimer); searchSerial += 1; form.value = applyResidentToCadre(form.value, person); searchTerm.value = form.value.name; personMatches.value = []; searchMessage.value = ''; searching.value = false; } }, `${person.name} · ${person.phone || '无电话'} · ${person.idCard || person.id_card || '无身份证号'}`))) : null,
          !searching.value && searchMessage.value ? h('small', { class: searchError.value ? 'foundation-cadre-search-error' : '', role: searchError.value ? 'alert' : 'status' }, searchMessage.value) : null,
          form.value.personId ? h('small', { class: 'foundation-cadre-linked', role: 'status' }, '已关联居民档案；姓名、电话和身份证号已带入。') : null,
          h('label', {}, [h('span', {}, '联系电话（手机号）'), h('input', { type: 'tel', value: form.value.phone, placeholder: '输入干部联系电话…', onInput: event => { form.value = { ...form.value, phone: event.target.value }; } })]),
          h('label', {}, [h('span', {}, '身份证号（从居民档案带入）'), h('input', { type: 'text', value: form.value.idCard, placeholder: '选中居民档案后自动带入', readonly: true, 'data-testid': 'community-cadre-id-card' })]),
          h('label', {}, [h('span', {}, '职位 / 角色分工'), h('input', { type: 'text', value: form.value.position, placeholder: '如：村党支部书记 / 村委委员 / 网格员…', onInput: event => { form.value = { ...form.value, position: event.target.value }; } })]),
          h('label', {}, [h('span', {}, '负责内容（选填）'), h('input', { type: 'text', value: form.value.duty, placeholder: '如：走访摸底、党建综治、低保民政…', onInput: event => { form.value = { ...form.value, duty: event.target.value }; } })]),
          error.value ? notice(message.value, true) : null,
        ]),
        h('footer', {}, [action('取消', () => { addOpen.value = false; }, { secondary: true }), action(saving.value ? '保存中…' : '确认并加入摸底名册', addCadre, { disabled: saving.value, testid: 'community-cadre-save' })]),
      ]),
    ]) : null,
  ]);
} };

export const LanSharingPanel = { props: { autoScan: Boolean }, setup(props) {
  const info = ref(null), message = ref(''), error = ref(false), ip = ref(''), busy = ref(false), account = ref(null), hosts = ref([]);
  let refreshTimer;
  const canManage = () => ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(account.value?.role);
  const copyIp = async address => { try { await copyText(address); message.value = `${address} 已复制`; error.value = false; } catch (cause) { message.value = cause.message; error.value = true; } };
  const refresh = async () => {
    try {
      info.value = await window.api.getLanShareInfo();
      account.value = (await window.api.getLocalAuthStatus()).account;
      if (!ip.value && info.value?.connection?.baseUrl) ip.value = new URL(info.value.connection.baseUrl).hostname;
    } catch (cause) { message.value = cause.message || '无法读取局域网共享状态'; error.value = true; }
  };
  const run = async (action, success) => {
    if (busy.value) return;
    busy.value = true; message.value = ''; error.value = false;
    try {
      await window.api.updateLanShareConfig({ action, ip: ip.value.trim() });
      message.value = success;
      await refresh();
      if (action === 'connect' || action === 'check' && props.autoScan && info.value?.connection?.status === 'online') {
        await router.replace('/overview');
        window.location.reload();
      }
    } catch (cause) { message.value = cause.message || '操作失败'; error.value = true; }
    finally { busy.value = false; }
  };
  const scan = async () => {
    if (busy.value) return;
    busy.value = true; error.value = false; message.value = ''; hosts.value = [];
    try {
      const result = await window.api.updateLanShareConfig({ action: 'scan' });
      hosts.value = result.hosts || [];
      const automatic = props.autoScan && autoConnectHost(hosts.value, info.value?.connection?.baseUrl);
      if (automatic) {
        message.value = `已找到属于当前账号的主电脑 ${automatic.ip}，正在连接…`;
        await window.api.updateLanShareConfig({ action: 'connect', ip: automatic.ip });
        await router.replace('/overview');
        window.location.reload();
        return;
      }
      message.value = hosts.value.length ? `发现 ${hosts.value.length} 台主电脑，请选择属于当前账号的设备。` : '未发现主电脑。请确认处于同一局域网，或在下方手动输入 IP。若本机从未启用共享，请由主账号先在本机设置。';
    } catch (cause) { message.value = cause.message || '扫描失败，请手动输入 IP'; error.value = true; }
    finally { busy.value = false; }
  };
  onMounted(async () => { await refresh(); if (props.autoScan && !info.value?.connection?.baseUrl) await scan(); refreshTimer = setInterval(refresh, 10000); });
  onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); });
  return () => h('div', { class: 'settings-panel foundation-connect-page', 'data-testid': 'community-lan-settings' }, [
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [h('div', {}, [h('h3', {}, '🌐 局域网共享与账号授权'), !canManage() ? h('p', {}, '扫描或输入单位主电脑 IP，连接后即可使用主电脑上的业务数据。') : null]),
        h('span', { class: `foundation-connect-status${canManage() && info.value?.enabled || info.value?.connection?.status === 'online' ? ' is-running' : ''}` },
          account.value?.role === 'member' && info.value?.connection?.status === 'online' ? '● 主电脑在线'
            : canManage() && info.value?.enabled ? '● 共享服务运行中' : info.value?.connection?.status === 'local' ? '● 共享暂不可用'
            : info.value?.connection?.status === 'online' ? '● 主电脑在线'
              : info.value?.connection?.baseUrl ? '● 主电脑暂不可达' : canManage() ? '● 电脑共享未启用' : '● 尚未连接主电脑')]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        h('div', { class: 'foundation-connect-benchmark foundation-lan-address' }, [
          h('div', {}, [h('div', { class: 'foundation-connect-eyebrow' }, canManage() ? '当前电脑 IP' : '主电脑局域网地址'),
            canManage() && info.value?.enabled && info.value?.ips?.length
              ? h('div', { class: 'foundation-lan-ip-list' }, info.value.ips.map(address =>
                info.value.ips.length === 1 ? h('strong', { key: address }, address)
                  : action(address, () => { void copyIp(address); }, { secondary: true })))
              : h('strong', {}, account.value?.role === 'member' && info.value?.connection?.baseUrl ? new URL(info.value.connection.baseUrl).hostname : canManage() ? '暂无可连接的局域网 IP' : '当前未提供电脑访问地址'),
            h('p', {}, info.value?.connection?.baseUrl && !canManage() && info.value?.connection?.status !== 'online'
              ? `${info.value.connection.reason || '无法连接主电脑'}。请确认主电脑开机、共享服务运行且处于同一局域网，或重新扫描。`
              : canManage() ? info.value?.sharingError || (info.value?.enabled ? '其他电脑连接同一网络后，输入上方 IP 即可连接。' : '共享暂不可用，请检查本机网络或端口占用。')
                  : '请扫描同一局域网中的主电脑，或输入主电脑提供的 IP。')]),
          canManage() && (info.value?.ips?.length || 0) <= 1 ? action('复制 IP', () => { void copyIp(info.value?.ips?.[0]); }, { secondary: true, disabled: !info.value?.enabled || !info.value?.ips?.length }) : null,
        ]),
        !canManage() ? h('div', { class: 'foundation-connect-actions' }, [action(busy.value ? '扫描中…' : info.value?.connection?.baseUrl ? '重新扫描主电脑' : '扫描局域网主电脑', () => { void scan(); }, { secondary: true, disabled: busy.value, testid: 'community-lan-scan' })]) : null,
        hosts.value.length ? h('div', { class: 'foundation-lan-host-list', 'data-testid': 'community-lan-host-list' }, hosts.value.map(host =>
          h('div', { class: 'foundation-lan-host', key: host.ip }, [
            h('div', {}, [h('strong', {}, `${host.name} · ${host.ip}`), h('small', {}, host.matched ? '属于当前主账号 · 可连接' : host.reason || '无法连接')]),
            action('选择此电脑', () => { ip.value = host.ip; message.value = '已选中主电脑，请点击“连接并使用主电脑数据”。'; }, { secondary: true, disabled: !host.matched }),
          ]))) : null,
        !canManage() ? h('label', { class: 'foundation-setting-field' }, [h('span', {}, '手动输入主电脑 IP'),
          h('input', { type: 'text', inputmode: 'decimal', value: ip.value, placeholder: '例如 192.168.2.106',
            onInput: event => { ip.value = event.target.value; }, 'data-testid': 'community-lan-ip' })]) : null,
        !canManage() ? h('div', { class: 'foundation-connect-actions' }, [
          action(info.value?.connection?.baseUrl ? '重试连接' : '测试连接', () => { void run('check', '主电脑连接成功，账号归属已核对。'); }, { secondary: true, disabled: busy.value || !ip.value.trim() }),
          action('连接并使用主电脑数据', () => { void run('connect', '已连接主电脑'); }, { disabled: busy.value || !ip.value.trim(), testid: 'community-lan-connect' }),
        ]) : null,
        !canManage() ? h('p', { class: 'foundation-lan-account-hint' }, '子账号首次连接这台主电脑时，需联网完成身份核对。') : null,
        notice(message.value, error.value),
      ]),
    ]),
  ]);
} };

export const BackupReferencePanel = { setup() {
  const directory = ref(''), rows = ref([]), busy = ref(false), message = ref(''), error = ref(false), remoteChild = ref(false);
  const dialogs = useDialogStore();
  const backupDir = () => `${directory.value}/foundation-backups`;
  const run = async callback => {
    if (busy.value) return;
    busy.value = true; message.value = ''; error.value = false;
    try { await callback(); } catch (cause) { message.value = cause.message || '操作失败'; error.value = true; }
    finally { busy.value = false; }
  };
  const load = async () => {
    const [auth, lan] = await Promise.all([window.api.getLocalAuthStatus(), window.api.getLanShareInfo()]);
    remoteChild.value = Boolean(auth?.authenticated && lan?.connection?.baseUrl && !lan?.enabled);
    if (remoteChild.value) { directory.value = ''; rows.value = []; return; }
    const [path, listing] = await Promise.all([window.api.getDbDir(), window.api.listV3AutoBackups()]);
    directory.value = path; rows.value = listing?.backups || [];
  };
  const create = () => run(async () => {
    const result = await window.api.createV3Backup();
    if (!result?.success) throw new Error(result?.error || '备份失败');
    await load(); message.value = result.warning || `备份已完成，包含 ${result.filesCount || 0} 个附件。`;
  });
  const restore = row => run(async () => {
    if (!await dialogs.confirm(`将业务数据恢复到 ${formatDate(row.createdAt)}。此后的业务修改会被替换，系统会先保存当前数据和附件。是否继续？`, '恢复备份')) return;
    const result = await window.api.restoreV3DbBackup({ relativePath: row.relativePath });
    if (!result?.success) throw new Error(result?.error || '恢复失败');
    message.value = result.warning || '恢复完成，正在重新载入页面。';
    setTimeout(() => location.reload(), 1000);
  });
  const openDirectory = value => run(async () => {
    const result = await window.api.openPath(value);
    if (result?.ok === false) throw new Error(result.error || '无法打开目录');
  });
  const copyDirectory = () => run(async () => { await copyText(directory.value); message.value = '数据目录已复制'; });
  const relocate = () => run(async () => {
    const result = await window.api.selectAndMigrateDataDir();
    if (result?.canceled) return;
    if (result?.ok !== true) throw new Error(result?.error || '搬迁失败');
    message.value = `已校验 ${result.files} 个文件，应用正在重启。原目录仍保留：${result.previous}${result.missingExternal?.length ? `；${result.missingExternal.length} 个历史附件原本已缺失` : ''}`;
  });
  onMounted(() => { void run(load); });
  return () => h('div', { class: 'settings-panel foundation-connect-page foundation-backup-page', 'data-testid': 'community-backup-panel' }, [
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [h('div', {}, [h('h3', {}, '🗄️ 本地数据备份与导出'), h('p', {}, remoteChild.value ? '业务数据保存在主电脑，请在主电脑上查看和备份。' : '查看本机数据位置，创建包含业务数据和关联附件的完整备份。')])]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        remoteChild.value ? h('p', { class: 'foundation-backup-explain' }, '当前是连接主电脑的子电脑。本机不保存业务副本；完整备份和恢复请在主电脑操作。') : null,
        h('div', { class: 'foundation-backup-location' }, [
          h('span', {}, remoteChild.value ? '业务数据存储位置' : '当前数据存储位置'), h('strong', {}, remoteChild.value ? '单位主电脑' : directory.value || '读取中…'),
          action('复制路径', copyDirectory, { secondary: true, disabled: remoteChild.value || !directory.value }),
          remoteChild.value ? null : action(busy.value ? '搬迁中…' : '更改存储位置', relocate, { secondary: true, disabled: busy.value || !directory.value, testid: 'community-change-data-location' }),
        ]),
        remoteChild.value ? null : h('p', { class: 'foundation-backup-explain' }, '备份保存在本机数据目录的 foundation-backups 文件夹。请定期将该文件夹复制到外部存储。'),
        h('div', { class: 'foundation-connect-actions' }, [
          action('打开数据目录', () => openDirectory(directory.value), { secondary: true, disabled: remoteChild.value || busy.value || !directory.value }),
          action('打开备份目录', () => openDirectory(backupDir()), { secondary: true, disabled: remoteChild.value || busy.value || !directory.value }),
          action(busy.value ? '处理中…' : '立即完整备份', create, { disabled: remoteChild.value || busy.value, testid: 'community-backup-create' }),
        ]),
        notice(message.value, error.value),
      ]),
    ]),
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [h('div', {}, [h('h3', {}, '本机备份策略'), h('p', {}, '自动周期、账本密码和存储位置的入口按参考版预留。')])]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        h('div', { class: 'foundation-backup-policy-grid' }, [
          h('div', {}, [h('strong', {}, '自动备份周期'), h('p', {}, '当前未启用定时备份；使用“立即完整备份”创建快照。')]),
          h('div', {}, [h('strong', {}, '村务账本安全密码'), h('p', {}, "当前由村居账号登录保护，本机独立账本密码尚未接入。")]),
          h('div', {}, [h('strong', {}, '更换存储位置'), h('p', {}, '在上方选择本机内置磁盘文件夹，搬迁成功后自动重启。')]),
        ]),
      ]),
    ]),
    h('section', { class: 'settings-card foundation-reference-card' }, [
      h('div', { class: 'card-header foundation-connect-head' }, [h('div', {}, [h('h3', {}, '备份记录'), h('p', {}, '恢复时会校验备份内容，并先自动保存当前数据。')]), action('刷新备份列表', () => run(load), { secondary: true, disabled: remoteChild.value || busy.value })]),
      h('div', { class: 'card-body foundation-connect-body' }, [
        rows.value.length ? h('div', { class: 'foundation-backup-list' }, rows.value.map(row => h('article', { class: 'foundation-backup-record', key: row.relativePath }, [
          h('div', { class: 'foundation-backup-record-main' }, [h('div', {}, [h('span', { class: 'foundation-reference-badge' }, row.source === 'manual' ? '手动备份' : row.source === 'before-restore' ? '恢复前保护' : row.source === 'import' ? '导入前快照' : '其他快照'), h('strong', {}, formatDate(row.createdAt))]),
            h('p', {}, `${formatSize(row.sizeBytes)} · ${row.manifest?.files?.length || 0} 个附件${row.manifest?.missingFiles?.length ? ` · ${row.manifest.missingFiles.length} 个历史附件缺失` : ''}`),
            h('code', {}, `${backupDir()}/${row.relativePath}`)]),
          action('恢复此备份', () => restore(row), { secondary: true, disabled: remoteChild.value || busy.value }),
        ]))) : h('p', { class: 'foundation-connect-empty' }, remoteChild.value ? '备份记录保存在主电脑，请到主电脑查看。' : busy.value ? '正在读取备份记录…' : '尚无完整备份，点击“立即完整备份”创建第一份。'),
      ]),
    ]),
  ]);
} };
