import { createElementVNode as h, ref, onMounted, onBeforeUnmount, useAuthStore, router } from './vendor/assets/foundation-runtime.mjs';
import { autoConnectHost } from './workspace-connection.mjs';

const button = (label, onClick, disabled = false, secondary = false) => h('button', {
  type: 'button', class: `foundation-host-button${secondary ? ' is-secondary' : ''}`, disabled, onClick,
}, label);

export const HostConnectionPage = { name: 'HostConnectionPage', setup() {
  const auth = useAuthStore();
  const connection = ref({ baseUrl: '', status: 'unconfigured' });
  const hosts = ref([]), ip = ref(''), busy = ref(false), message = ref(''), error = ref(false);
  let timer = null, leaving = false;

  async function enterWorkbench() {
    if (leaving) return;
    leaving = true;
    await router.replace('/overview');
    window.location.reload();
  }

  async function connect(address, automatic = false) {
    if (busy.value || !address) return;
    busy.value = true; error.value = false;
    message.value = automatic ? `正在连接 ${address}…` : '正在核对主电脑和账号归属…';
    try {
      await window.api.updateLanShareConfig({ action: 'connect', ip: address.trim() });
      await enterWorkbench();
    } catch (cause) {
      error.value = true;
      message.value = cause.message || '连接失败，请核对 IP 后重试';
    } finally { busy.value = false; }
  }

  async function scan({ quiet = false } = {}) {
    if (busy.value || leaving) return;
    busy.value = true; error.value = false;
    if (!quiet) message.value = '正在查找同一局域网的主电脑…';
    try {
      const info = await window.api.getLanShareInfo();
      connection.value = info.connection || connection.value;
      if (connection.value.status === 'online') { await enterWorkbench(); return; }
      const result = await window.api.updateLanShareConfig({ action: 'scan' });
      hosts.value = result.hosts || [];
      const candidate = autoConnectHost(hosts.value, connection.value.baseUrl);
      if (candidate) {
        busy.value = false;
        await connect(candidate.ip, true);
        return;
      }
      if (!ip.value && connection.value.baseUrl) ip.value = new URL(connection.value.baseUrl).hostname;
      if (!quiet || hosts.value.length) message.value = hosts.value.length
        ? connection.value.baseUrl ? '请选择要连接的主电脑，或等待已确认主机恢复。' : '请选择主电脑并确认连接。'
        : '暂未发现主电脑。请确认两台电脑连接同一局域网，或输入主电脑显示的 IP。';
    } catch (cause) {
      error.value = true;
      message.value = cause.message || '扫描失败，请重试或手动输入 IP';
    } finally { busy.value = false; }
  }

  onMounted(() => {
    void scan();
    timer = setInterval(() => { void scan({ quiet: true }); }, 10000);
  });
  onBeforeUnmount(() => { leaving = true; if (timer) clearInterval(timer); });

  return () => h('main', { class: 'foundation-host-gate', 'data-testid': 'host-connection-page' }, [
    h('section', { class: 'foundation-host-card' }, [
      h('header', { class: 'foundation-host-heading' }, [
        h('span', { class: 'foundation-host-mark', 'aria-hidden': 'true' }, '⌂'),
        h('div', {}, [h('h1', {}, '连接主电脑'), h('p', {}, '连接保存业务数据的电脑后，即可进入社区工作台。')]),
      ]),
      h('div', { class: 'foundation-host-status' }, [
        h('strong', {}, connection.value.baseUrl ? '已确认的主电脑' : '首次连接'),
        h('span', {}, connection.value.baseUrl ? new URL(connection.value.baseUrl).hostname : '请选择或输入主电脑 IP，并确认一次。'),
      ]),
      h('div', { class: 'foundation-host-actions' }, [
        button(busy.value ? '正在查找…' : '扫描局域网主电脑', () => { void scan(); }, busy.value, true),
      ]),
      hosts.value.length ? h('div', { class: 'foundation-host-results' }, hosts.value.map(host =>
        h('button', { type: 'button', key: host.ip, class: `foundation-host-result${ip.value === host.ip ? ' is-selected' : ''}`,
          disabled: !host.matched || busy.value, onClick: () => { ip.value = host.ip; message.value = '已选定主电脑，请点击“确认连接”。'; error.value = false; } }, [
          h('span', {}, [h('strong', {}, host.name || '主电脑'), h('small', {}, host.ip)]),
          h('em', {}, host.matched ? '可连接' : host.reason || '无法连接'),
        ]))) : null,
      h('label', { class: 'foundation-host-field' }, [
        h('span', {}, '主电脑 IP 地址'),
        h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '例如 192.168.2.106',
          value: ip.value, onInput: event => { ip.value = event.target.value; }, 'data-testid': 'host-ip-input' }),
      ]),
      button(connection.value.baseUrl ? '连接主电脑' : '确认连接', () => { void connect(ip.value); }, busy.value || !ip.value.trim()),
      message.value ? h('p', { class: `foundation-host-message${error.value ? ' is-error' : ''}`, role: error.value ? 'alert' : 'status' }, message.value) : null,
      h('footer', { class: 'foundation-host-footer' }, [
        h('span', {}, '主电脑保持开机并运行应用即可，主账号无需保持登录。'),
        button('退出当前账号', () => { void auth.logout(); }, busy.value, true),
      ]),
    ]),
  ]);
} };
