import { createElementVNode as h, ref, onMounted } from './vendor/assets/foundation-runtime.mjs';

const MODES = [['online', '自用在线服务'], ['local', '本机模型'], ['auto', '优先本机模型']];
const icon = name => h('svg', { class: 'standalone-ai-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, [
  h('path', { d: { lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3', eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0', cube: 'm12 2 9 5v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10', chevron: 'm6 9 6 6 6-6' }[name] }),
]);

export const StandaloneAiSettings = { setup() {
  const settings = ref(null), models = ref([]), runtime = ref({ running: false });
  const password = ref(''), revealPassword = ref(false), localExpanded = ref(false);
  const busy = ref(''), message = ref(''), messageKind = ref('success'), messageArea = ref('online'), canManage = ref(false), modelWarning = ref('');
  const feedback = (text, kind = 'success') => { message.value = text; messageKind.value = kind; };
  const run = async (action, work) => {
    if (busy.value || (action !== 'load' && !canManage.value)) return;
    busy.value = action; message.value = ''; messageArea.value = ['scan', 'import', 'toggle'].includes(action) ? 'local' : 'online';
    try { await work(); }
    catch (error) { feedback(error?.message || '操作失败，请重试', 'error'); }
    finally { busy.value = ''; }
  };
  const refreshModels = async () => {
    const results = await Promise.allSettled([window.api.scanLocalModels(), window.api.getInternalAiServerStatus()]);
    if (results[0].status === 'fulfilled') models.value = results[0].value;
    if (results[1].status === 'fulfilled') runtime.value = results[1].value;
    modelWarning.value = results.some(result => result.status === 'rejected') ? '暂时无法读取本机模型状态，可重新扫描；自用在线服务仍可配置。' : '';
  };
  onMounted(() => run('load', async () => {
    const account = await window.api.getLocalAuthStatus();
    canManage.value = ['main_account', 'unit_admin'].includes(account.account?.role);
    settings.value = await window.api.getAiSettings();
    localExpanded.value = settings.value.mode !== 'online';
    if (canManage.value) await refreshModels();
  }));
  const save = async () => {
    const current = settings.value;
    settings.value = await window.api.saveAiSettings({
      mode: current.mode, localModelPath: current.localModelPath, tokenReminderMode: current.tokenReminderMode,
      online: { baseUrl: current.online.baseUrl.trim(), model: current.online.model.trim(), supportsVision: current.online.supportsVision === true, apiKey: password.value },
    });
    password.value = ''; revealPassword.value = false;
    const storage = settings.value.online.keyStorage;
    feedback(storage === 'session' ? '设置已保存。系统安全存储不可用，密钥仅在本次打开软件期间有效。'
      : storage === 'unavailable' ? '设置已保存，但原密钥暂时无法读取，请重新输入密钥。'
        : 'AI 设置已保存。');
  };
  const testConnection = async () => {
    const online = settings.value.online;
    if (!online.baseUrl.trim()) throw new Error('请先填写服务地址');
    if (!online.model.trim()) throw new Error('请先填写模型名称');
    if (!password.value.trim() && !online.hasApiKey) throw new Error('请先填写 API 密钥');
    await save();
    // One explicit click sends one test request. Saving and opening never call a provider.
    await window.api.testOnlineAi();
    feedback('模型服务连接成功，设置已保存。');
  };
  const button = (label, action, work, primary = false) => h('button', {
    type: 'button', class: `standalone-ai-button${primary ? ' is-primary' : ''}`, disabled: Boolean(busy.value) || !canManage.value,
    onClick: () => run(action, work), 'data-testid': `standalone-ai-${action}`,
  }, busy.value === action ? ({ save: '正在保存…', test: '正在测试…', scan: '正在扫描…', import: '正在导入…', toggle: '正在处理…' }[action] || label) : label);
  const statusMessage = () => message.value ? h('p', { role: messageKind.value === 'error' ? 'alert' : 'status', class: `standalone-ai-message is-${messageKind.value}`, 'data-testid': 'standalone-ai-message' }, message.value) : null;
  const field = (label, id, value, update, { type = 'text', placeholder = '', hint = '' } = {}) => h('div', { class: 'standalone-ai-field' }, [
    h('label', { for: id }, label),
    h('input', { id, type, value, placeholder, autocomplete: 'off', spellcheck: false, disabled: !canManage.value || Boolean(busy.value), 'aria-describedby': hint ? `${id}-hint` : undefined, onInput: event => update(event.target.value) }),
    hint ? h('small', { id: `${id}-hint` }, hint) : null,
  ]);
  const localPanel = () => h('details', {
    class: 'standalone-ai-card standalone-ai-local', open: localExpanded.value,
    onToggle: event => { localExpanded.value = event.target.open; }, 'data-testid': 'standalone-ai-local',
  }, [
    h('summary', {}, [icon('cube'), h('span', {}, [h('strong', {}, '本机模型（可选）'), h('small', {}, '导入本地模型后，可选择在本机运行')]), icon('chevron')]),
    h('div', { class: 'standalone-ai-local-body' }, [
      field('本机模型路径', 'standalone-ai-local-path', settings.value.localModelPath, value => { settings.value.localModelPath = value; }, { placeholder: '选择已导入的 GGUF 模型，或填写本机文件路径' }),
      h('div', { class: 'standalone-ai-field' }, [
        h('label', { for: 'standalone-ai-local-model' }, '已导入的本机模型'),
        h('select', { id: 'standalone-ai-local-model', value: settings.value.localModelPath, disabled: !canManage.value || Boolean(busy.value), onChange: event => { settings.value.localModelPath = event.target.value; } }, [
          h('option', { value: '' }, '选择本机 GGUF 模型'), ...models.value.map(model => h('option', { value: model.path, key: model.path }, model.name)),
        ]),
      ]),
      h('p', { class: 'standalone-ai-runtime', 'data-testid': 'standalone-ai-runtime' }, `本机模型服务：${runtime.value.running ? '运行中' : runtime.value.loading ? '加载中' : '未启动'}`),
      modelWarning.value ? h('p', { class: 'standalone-ai-hint' }, modelWarning.value) : null,
      h('div', { class: 'standalone-ai-local-actions' }, [
        button('重新扫描', 'scan', refreshModels),
        button('导入 GGUF 模型', 'import', async () => {
          const result = await window.api.importLocalModel();
          if (result.canceled) return;
          if (!result.model?.path) throw new Error(result.error || '导入失败');
          settings.value.localModelPath = result.model.path; await refreshModels(); feedback('模型已导入，请保存设置。');
        }),
        button(runtime.value.running ? '停止本机模型' : '启动本机模型', 'toggle', async () => {
          if (!runtime.value.running && !settings.value.localModelPath) throw new Error('请先选择或导入本机模型');
          runtime.value = await window.api.toggleInternalAiServer({ action: runtime.value.running ? 'stop' : 'start', modelPath: settings.value.localModelPath });
        }),
      ]),
      h('p', { class: 'standalone-ai-hint' }, '修改运行方式或模型路径后，点击“保存设置”生效。'),
      messageArea.value === 'local' ? statusMessage() : null,
    ]),
  ]);
  const onlinePanel = () => h('section', { class: 'standalone-ai-card standalone-ai-online', 'aria-labelledby': 'standalone-ai-online-title' }, [
    h('header', { class: 'standalone-ai-card-heading' }, [h('h4', { id: 'standalone-ai-online-title' }, '自用在线 AI'), h('span', { class: 'standalone-ai-badge' }, '本机保存')]),
    h('p', { class: 'standalone-ai-card-description' }, '填写模型服务商提供的接口信息'),
    field('服务地址', 'standalone-ai-url', settings.value.online.baseUrl, value => { settings.value.online.baseUrl = value; }, { type: 'url', placeholder: 'https://api.example.com/v1', hint: '填写兼容 OpenAI 接口的 HTTPS 地址；HTTP 仅支持本机服务。' }),
    field('模型名称', 'standalone-ai-model', settings.value.online.model, value => { settings.value.online.model = value; }, { placeholder: '填写服务商提供的模型名称' }),
    h('div', { class: 'standalone-ai-field' }, [
      h('label', { for: 'standalone-ai-key' }, 'API 密钥'),
      h('div', { class: 'standalone-ai-key-control' }, [
        h('input', { id: 'standalone-ai-key', type: revealPassword.value ? 'text' : 'password', value: password.value, autocomplete: 'new-password', spellcheck: false, disabled: !canManage.value || Boolean(busy.value), placeholder: settings.value.online.hasApiKey ? '已保存；留空保留原密钥' : '输入服务商提供的 API 密钥', onInput: event => { password.value = event.target.value; } }),
        h('button', { type: 'button', class: 'standalone-ai-key-toggle', disabled: !canManage.value || Boolean(busy.value), 'aria-label': revealPassword.value ? '隐藏输入的密钥' : '显示输入的密钥', 'aria-pressed': revealPassword.value, onClick: () => { revealPassword.value = !revealPassword.value; } }, [icon('eye')]),
      ]),
    ]),
    h('label', { class: 'standalone-ai-vision' }, [h('input', { type: 'checkbox', checked: settings.value.online.supportsVision === true, disabled: !canManage.value || Boolean(busy.value), onChange: event => { settings.value.online.supportsVision = event.target.checked; } }), h('span', {}, '此模型支持图片识别')]),
    h('div', { class: 'standalone-ai-security' }, [icon('lock'), h('span', {}, settings.value.online.keyStorage === 'session' ? '当前密钥仅保留在本次打开软件期间，不发送到原账号后台。' : '密钥由本机安全存储保护，不发送到原账号后台。')]),
    settings.value.online.keyStorage === 'session' || settings.value.online.keyStorage === 'unavailable' ? h('p', { class: 'standalone-ai-storage-warning' }, settings.value.online.keyStorage === 'session' ? '当前密钥仅保留到本次退出软件，请在系统安全存储可用后重新保存。' : '系统安全存储暂时不可用，原密钥无法读取，请重新输入密钥。') : null,
    messageArea.value === 'online' ? statusMessage() : null,
    h('div', { class: 'standalone-ai-actions' }, [h('small', {}, '测试连接会产生少量服务商用量，并保存当前配置。'), h('div', {}, [button('测试连接', 'test', testConnection), button('保存设置', 'save', save, true)])]),
  ]);
  const infoPanel = () => h('aside', { class: 'standalone-ai-info', 'aria-label': 'AI 配置说明' }, [
    h('section', { class: 'standalone-ai-card' }, [h('h4', {}, '配置位置'), h('div', { class: 'standalone-ai-location' }, [h('span', {}, '系统设置 → 智能助理'), h('p', {}, '在客户端填写自己的模型服务，AI 助理、公文拟写和报告共用这份配置。')])]),
    h('section', { class: 'standalone-ai-card' }, [h('h4', {}, '配置说明'), h('dl', {}, [
      h('div', {}, [h('dt', {}, '谁来配置'), h('dd', {}, '主账号或单位管理员设置')]),
      h('div', {}, [h('dt', {}, '在哪里使用'), h('dd', {}, 'AI 助理 / 公文 / 报告')]),
      h('div', {}, [h('dt', {}, '费用方式'), h('dd', {}, '按模型服务商用量结算，本机不扣平台积分')]),
    ]), h('p', { class: 'standalone-ai-privacy' }, '在线 AI 会将本次提问和所选内容发送给对应服务商。')]),
  ]);
  return () => h('section', { class: 'foundation-standalone-ai', 'data-testid': 'standalone-ai-settings', 'aria-busy': Boolean(busy.value) }, [
    h('header', { class: 'standalone-ai-heading' }, [h('h3', {}, 'AI 服务设置'), h('p', {}, '在本机配置自己的模型服务，用于 AI 助理、公文拟写和报告生成。')]),
    !canManage.value && settings.value ? h('p', { class: 'standalone-ai-readonly', role: 'note' }, '模型配置由主账号管理；成员设备使用主电脑的 AI 服务，密钥不会提供给成员设备。') : null,
    settings.value ? h('div', {}, [
      h('div', { class: 'standalone-ai-mode-row' }, [h('span', { id: 'standalone-ai-mode-label' }, '运行方式'), h('div', { class: 'standalone-ai-modes', role: 'group', 'aria-labelledby': 'standalone-ai-mode-label' }, MODES.map(([mode, label]) => h('button', {
        type: 'button', 'aria-pressed': settings.value.mode === mode, disabled: !canManage.value || Boolean(busy.value), 'data-testid': `standalone-ai-mode-${mode}`,
        onClick: () => { settings.value.mode = mode; localExpanded.value = mode !== 'online'; },
      }, label)))]),
      h('div', { class: 'standalone-ai-layout' }, [h('div', { class: 'standalone-ai-main' }, [onlinePanel(), localPanel()]), infoPanel()]),
    ]) : h('p', { class: 'standalone-ai-loading' }, busy.value === 'load' ? '正在读取 AI 设置…' : '暂时无法读取 AI 设置，请重新打开此页面。'),
    !settings.value ? statusMessage() : null,
  ]);
} };
