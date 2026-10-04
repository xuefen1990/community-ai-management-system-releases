import { authGate, router, useAuthStore, createElementVNode as h, ref, onMounted, onBeforeUnmount } from './vendor/assets/foundation-runtime.mjs';
import { routeAfterLogin } from './workspace-connection.mjs';

// Keep the reference login layout and remembered-login contract.
export function installCommunityAccountGate() {
  authGate.setup = function setupCommunityAccount() {
    const auth = useAuthStore();
    const mode = ref('login'); const busy = ref(false); const error = ref(''); const notice = ref('');
    const phone = ref(''); const password = ref(''); const nextPassword = ref(''); const confirmation = ref(''); const remember = ref(false);
    const serverUrl = ref(''); const activation = ref('');
    const version = ref(''); const checkingUpdate = ref(false); const updateMessage = ref('');
    let unsubscribeUpdate;
    onMounted(async () => {
      try { version.value = await window.api.getVersion(); }
      catch { version.value = '未知'; }
      unsubscribeUpdate = window.api.onAppUpdateStatus?.(event => {
        if (event.type === 'available') updateMessage.value = `发现新版本 ${event.version}，请在更新窗口中继续。`;
        if (event.type === 'not-available') updateMessage.value = '当前已是最新版本。';
        if (event.type === 'downloaded') updateMessage.value = '更新已下载，重启后可安装。';
        if (event.type === 'error') updateMessage.value = event.message || '检查更新失败';
      });
      try {
        const saved = await window.api.getLoginPrefill?.();
        if (saved) { phone.value = saved.phone || ''; password.value = saved.password || ''; remember.value = saved.remembered === true; }
      } catch { /* Login remains usable without optional keychain prefill. */ }
    });
    onBeforeUnmount(() => unsubscribeUpdate?.());
    async function checkUpdate() {
      if (checkingUpdate.value) return;
      checkingUpdate.value = true; updateMessage.value = '正在检查新版本…';
      try {
        const result = await window.api.checkForAppUpdate();
        if (result?.disabled) updateMessage.value = '开发版不检查正式更新，请在已安装应用中使用。';
        else if (!result?.ok) throw new Error(result?.error || '检查更新失败');
        else if (updateMessage.value === '正在检查新版本…') updateMessage.value = '检查已发起，正在等待结果。';
      } catch (cause) { updateMessage.value = cause.message || '检查更新失败'; }
      finally { checkingUpdate.value = false; }
    }
    function switchMode(next) {
      mode.value = next; error.value = ''; notice.value = ''; confirmation.value = '';
      updateMessage.value = '';
      if (next === 'register') password.value = '';
    }
    async function openServer() {
      switchMode('server');
      try { serverUrl.value = (await window.api.getRemoteServerConfig()).baseUrl || ''; }
      catch (cause) { error.value = cause.message; }
    }
    async function saveServer() {
      if (busy.value) return; busy.value = true; error.value = ''; notice.value = '';
      try {
        const result = await window.api.checkRemoteServerConnection({ baseUrl: serverUrl.value.trim() });
        if (result?.ok === false) throw new Error(result.error || '服务连接失败');
        await window.api.setRemoteServerConfig({ baseUrl: serverUrl.value.trim() });
        password.value = ''; switchMode('login'); notice.value = '服务地址已保存，请登录该服务上的社区账号。';
      } catch (cause) { error.value = cause.message || '服务连接失败'; }
      finally { busy.value = false; }
    }
    async function activate() {
      if (busy.value) return; busy.value = true; error.value = ''; notice.value = '';
      try {
        if (!activation.value.trim()) throw new Error('请填写授权码');
        await window.api.activateOfflineLicense(activation.value.trim());
        activation.value = ''; await auth.refresh(); notice.value = '授权已更新，请使用社区账号登录。';
      } catch (cause) { error.value = cause.message || '激活失败'; }
      finally { busy.value = false; }
    }
    async function changeInitialPassword(event) {
      event.preventDefault(); if (busy.value) return;
      error.value = ''; busy.value = true;
      try {
        if (nextPassword.value.length < 6) throw new Error('新密码至少需要 6 位');
        if (nextPassword.value !== confirmation.value) throw new Error('两次输入的新密码不一致');
        await window.api.changeLocalAccountPassword({ oldPassword: password.value, newPassword: nextPassword.value });
        password.value = ''; nextPassword.value = ''; confirmation.value = '';
        await auth.refresh();
        if (!auth.canEnterApp) throw new Error(auth.status.message || '账号暂不能进入工作台');
        await router.replace(await routeAfterLogin(window.api));
      } catch (cause) { error.value = cause.message || '修改密码失败'; }
      finally { busy.value = false; }
    }
    async function submit(event) {
      event.preventDefault(); if (busy.value) return;
      error.value = ''; notice.value = ''; busy.value = true;
      try {
        if (!/^1\d{10}$/.test(phone.value.trim()) || !password.value) throw new Error('请填写 11 位手机号和密码');
        if (mode.value === 'login') {
          await auth.login({ phone: phone.value.trim(), password: password.value, remember: remember.value });
          if (auth.status.state === 'password-change-required') switchMode('change-password');
          else if (!auth.canEnterApp) error.value = auth.status.message || '当前账号暂不能进入，请核对授权状态';
          else await router.replace(await routeAfterLogin(window.api));
        } else {
          if (password.value.length < 6) throw new Error('密码至少需要 6 位');
          if (password.value !== confirmation.value) throw new Error('两次输入的密码不一致');
          await auth.register({ phone: phone.value.trim(), password: password.value, confirmPassword: confirmation.value });
          if (!auth.canEnterApp) throw new Error(auth.status.message || '注册成功，但当前无法进入工作台');
          password.value = ''; confirmation.value = '';
          await router.replace(await routeAfterLogin(window.api));
        }
      } catch (cause) { error.value = String(cause.message || '操作失败').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''); }
      finally { busy.value = false; }
    }
    const input = (label, value, id, type = 'text', autocomplete = 'off', placeholder = '') => h('label', { class: 'input-group', key: id }, [
      h('span', { class: 'foundation-auth-label' }, label),
      h('span', { class: 'foundation-auth-field' }, [
        h('span', { class: `foundation-auth-field-icon ${type === 'password' ? 'is-lock' : 'is-user'}`, 'aria-hidden': 'true' }),
        h('input', { id, 'data-testid': id, class: 'foundation-auth-input', type, autocomplete, placeholder,
          value: value.value, onInput: event => { value.value = event.target.value; } }),
      ]),
    ]);
    const button = (label, action) => h('button', { type: 'button', class: 'auth-link', onClick: action }, label);
    const heading = (title, subtitle) => h('header', { class: 'login-header' }, [
      h('div', { class: 'login-logo-container' }, [h('img', { src: 'foundation/vendor/community-logo.png', class: 'login-header-logo', alt: '社区AI管理系统' })]),
      h('h1', null, title), h('p', { class: 'subtitle' }, subtitle),
    ]);
    return () => h('main', { class: 'login-view auth-gate foundation-account-gate' }, [
      h('div', { class: 'mac-drag-strip', 'aria-hidden': 'true' }), h('div', { class: 'login-card-backdrop' }),
      h('section', { class: 'login-container', 'aria-label': '社区账号' }, [
        h('div', { class: 'login-intro-section' }, [h('div', { class: 'intro-content' }, [
          h('div', { class: 'intro-brand' }, [h('img', { src: 'foundation/vendor/community-logo.png', class: 'intro-logo', alt: '' }), h('span', null, '社区AI管理系统')]),
          h('h2', null, '让社区档案与日常工作，更清晰、更省心'),
          h('p', { class: 'intro-desc' }, '居民档案、土地、资金发放和电子材料集中管理，让查询、协作与办事都有据可查。'),
          h('div', { class: 'intro-features' }, [
            ['户', '居民一户一档', '户籍、家庭关系与居民资料统一归集，快速检索。'], ['田', '土地与资金管理', '地块、承包关系和发放记录清楚可查。'], ['档', '电子档案与 AI 助理', '材料分类归档，辅助查询、拟写和办理。'],
          ].map(([icon, title, text]) => h('div', { class: 'intro-feature-item', key: title }, [h('div', { class: 'feature-icon-wrapper' }, icon), h('div', { class: 'feature-text' }, [h('h4', null, title), h('p', null, text)])]))),
        ])]),
        h('div', { class: `login-form-section is-${mode.value}` }, [h('div', { class: 'login-card' }, [
          mode.value === 'server' ? h('section', { class: 'auth-panel' }, [heading('服务地址设置', '连接您的社区账号服务器'),
            input('服务器地址', serverUrl, 'community-login-server', 'url', 'url', '例如 https://example.com'),
            error.value ? h('p', { role: 'alert' }, error.value) : null,
            h('button', { class: 'login-btn btn btn-primary', disabled: busy.value, onClick: saveServer }, busy.value ? '正在检查…' : '检查连接并保存'),
            button('返回登录', () => switchMode('login')),
          ]) : mode.value === 'forgot' ? h('section', { class: 'auth-panel forgot-panel' }, [
            heading('找回密码', '为保障账号安全，暂由管理员协助重置'),
            h('div', { class: 'foundation-auth-help-card' }, [
              h('strong', null, '请联系管理员重置密码'),
              h('p', null, '子账号请联系本单位主账号管理员；主账号请联系平台管理员。重置后使用手机号和新密码登录。'),
            ]),
            h('details', { class: 'foundation-auth-extra' }, [
              h('summary', null, '已有离线授权码？'),
              h('div', { class: 'machine-code-card' }, [h('strong', null, '本机设备码'), h('code', null, auth.status.machineId || '暂未获取')]),
              button('复制设备码', () => navigator.clipboard.writeText(auth.status.machineId || '')),
              input('离线授权码', activation, 'community-help-activation', 'text', 'off', '请输入授权码'),
              h('button', { class: 'login-btn btn btn-primary', disabled: busy.value, onClick: activate }, '验证并激活'),
            ]),
            error.value ? h('p', { role: 'alert' }, error.value) : null,
            notice.value ? h('p', { role: 'status' }, notice.value) : null,
            button('返回登录', () => switchMode('login')),
          ]) : mode.value === 'change-password' ? h('form', { class: 'auth-panel login-form', onSubmit: changeInitialPassword }, [
            heading('设置登录密码', '首次登录请修改初始密码'),
            input('新密码', nextPassword, 'first-login-new-password', 'password', 'new-password', '至少 6 位'),
            input('确认新密码', confirmation, 'first-login-confirm-password', 'password', 'new-password', '请再次输入新密码'),
            error.value ? h('p', { class: 'auth-inline-message danger', role: 'alert' }, error.value) : null,
            h('button', { type: 'submit', class: 'login-btn btn btn-primary', disabled: busy.value }, busy.value ? '正在修改…' : '修改密码并进入工作台'),
            button('返回登录', () => { password.value = ''; switchMode('login'); }),
          ]) : h('form', { class: 'auth-panel login-form', onSubmit: submit }, [
            heading(mode.value === 'login' ? '账号登录' : '注册新账号', mode.value === 'login' ? '输入手机号与登录密码' : '仅需手机号和密码，注册后即可试用'),
            input('手机号', phone, 'login-phone', 'tel', 'username', '请输入手机号'),
            input('登录密码', password, 'login-password', 'password', mode.value === 'login' ? 'current-password' : 'new-password', '请输入密码'),
            mode.value !== 'login' ? input('确认密码', confirmation, 'application-password-confirm', 'password', 'new-password', '请再次输入密码') : null,
            mode.value === 'login' ? h('label', { class: 'remember-phone' }, [h('input', { type: 'checkbox', checked: remember.value, onChange: event => { remember.value = event.target.checked; } }), ' 记住登录']) : null,
            error.value ? h('p', { class: 'auth-inline-message danger', role: 'alert' }, error.value) : null,
            notice.value ? h('p', { class: 'auth-inline-message', role: 'status' }, notice.value) : null,
            h('button', { type: 'submit', class: 'login-btn btn btn-primary', disabled: busy.value, 'data-testid': 'community-auth-submit' }, busy.value ? '正在处理…' : mode.value === 'login' ? '安全登录' : '注册并进入工作台'),
            h('div', { class: 'auth-switch-links' }, mode.value === 'login' ? [
              button('注册新账号', () => switchMode('register')), button('忘记密码', () => switchMode('forgot')),
            ] : [button('返回账号登录', () => switchMode('login'))]),
          ]),
          h('footer', { class: 'login-footer' }, [
            h('span', null, '社区AI管理系统 · 用心做好每一件社区事务'),
            h('div', { class: 'foundation-auth-footer-actions' }, [
              button('服务地址设置', openServer),
              h('span', { class: 'foundation-auth-footer-divider', 'aria-hidden': 'true' }, '·'),
              h('span', { class: 'foundation-auth-version' }, `● 版本 v${version.value || '…'}`),
              h('span', { class: 'foundation-auth-footer-divider', 'aria-hidden': 'true' }, '·'),
              h('button', { type: 'button', class: 'auth-link', disabled: checkingUpdate.value, onClick: checkUpdate, 'data-testid': 'login-check-update' }, checkingUpdate.value ? '检查中…' : '检查更新'),
            ]),
            updateMessage.value ? h('span', { class: 'foundation-auth-update-message', role: 'status' }, updateMessage.value) : null,
          ]),
        ])]),
      ]),
    ]);
  };
}
