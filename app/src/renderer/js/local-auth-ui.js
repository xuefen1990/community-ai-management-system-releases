'use strict';

(function installLocalAuthentication() {
  const api = window.api;
  if (!api?.loginLocalAccount) return;

  let currentStatus = null;
  let legacyTrialObserver = null;
  let loginSubmission = null;
  let startupLoginGuardTimer = null;
  let footerActionInFlight = false;
  let localBackendReady = !api.getLocalBackendStatus;

  function applyProductBrand() {
    const subtitle = document.getElementById('displayAppSubtitle');
    if (subtitle && subtitle.textContent !== "村居AI管理系统") subtitle.textContent = "村居AI管理系统";
  }

  function setError(kind, message = '') {
    const container = document.getElementById(`${kind}ErrorContainer`);
    const text = document.getElementById(`${kind}ErrorText`);
    if (text) text.textContent = message;
    if (container) container.style.visibility = message ? 'visible' : 'hidden';
    if (kind === 'login' && message) {
      container?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      window.showToast?.(message, 'error');
    }
  }

  function setLoading(buttonId, loading, normalText) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.disabled = loading || (buttonId === 'doLoginBtn' && !localBackendReady);
    const label = button.querySelector('span');
    if (label) label.textContent = loading ? '处理中...' : normalText;
  }

  function formatEntitlement(entitlement) {
    if (entitlement?.type === 'licensed') {
      if (entitlement.plan === 'permanent') return '永久授权';
      if (entitlement.plan === 'expires') return entitlement.expiresAt ? `授权至 ${entitlement.expiresAt.slice(0, 10)}` : '期限授权';
      const label = entitlement.plan === 'monthly' ? '月度授权' : '年度授权';
      return entitlement.expiresAt ? `${label} · 至 ${entitlement.expiresAt.slice(0, 10)}` : label;
    }
    if (entitlement?.type === 'trial') return entitlement.expiresAt ? `体验版 · 至 ${entitlement.expiresAt.slice(0, 10)}` : '体验版';
    if (entitlement?.type === 'expired') return '单位有效期已到';
    return '未授权';
  }

  function applyMemberNavigation(status) {
    const modules = { 'tab-statistics': 'statistics', 'tab-personnel': 'personnel', 'tab-party': 'party', 'tab-visit-records': 'visit', 'tab-duty': 'work', 'tab-finance': 'finance', 'tab-land': 'land', 'tab-document-drafting': 'document', 'tab-certificate': 'certificate', 'tab-documents': 'archive', 'tab-disbursement': 'funds', 'tab-work-management': 'work', 'tab-settings': 'settings' };
    const member = status?.account?.role === 'member';
    const granted = status?.account?.permissions || {};
    document.querySelectorAll('.menu-item[data-target]').forEach(button => {
      const moduleId = modules[button.dataset.target];
      const allowed = !member || !moduleId || Boolean(granted[moduleId]?.includes('view'));
      button.hidden = !allowed;
      button.style.display = allowed ? '' : 'none';
    });
    const aiButton = document.getElementById('aiCopilotToggleBtn');
    if (aiButton) aiButton.style.display = member && status.account.aiAccessEnabled === false ? 'none' : '';
  }

  function showInitialPasswordChange() {
    if (document.getElementById('firstPasswordChangeModal')) return;
    const modal = document.createElement('div');
    modal.id = 'firstPasswordChangeModal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:100100;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `<form class="modal-card" style="width:min(420px,94vw);padding:26px;display:grid;gap:13px;"><h2 style="margin:0;">首次登录，请修改初始密码</h2><p style="margin:0;color:var(--text-secondary);">修改后才能进入工作台。</p><label>初始密码<input name="oldPassword" type="password" autocomplete="current-password" required style="display:block;width:100%;margin-top:5px;"></label><label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="6" required style="display:block;width:100%;margin-top:5px;"></label><label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required style="display:block;width:100%;margin-top:5px;"></label><p data-password-error role="alert" style="color:#bd3541;margin:0;"></p><button class="btn btn-primary" type="submit">修改密码并进入工作台</button></form>`;
    document.body.appendChild(modal);
    modal.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const error = form.querySelector('[data-password-error]');
      const button = form.querySelector('button[type="submit"]');
      if (form.elements.newPassword.value !== form.elements.confirmPassword.value) { error.textContent = '两次输入的新密码不一致'; return; }
      button.disabled = true;
      try {
        const status = await api.changeLocalAccountPassword({ oldPassword: form.elements.oldPassword.value, newPassword: form.elements.newPassword.value });
        modal.remove();
        await enterDashboard(status);
      } catch (failure) { error.textContent = failure.message || '修改密码失败'; }
      finally { button.disabled = false; }
    });
    modal.querySelector('[name="oldPassword"]').focus();
  }

  function refreshLegacyAuthLabels(status) {
    const phone = status?.account?.phone || '未登录';
    const entitlementLabel = formatEntitlement(status?.entitlement);
    document.querySelectorAll('.admin-name').forEach((element) => { element.textContent = phone; });
    document.querySelectorAll('.user-status-text').forEach((element) => { element.textContent = entitlementLabel; });
    const settingsPhone = document.getElementById('settings-phone');
    if (settingsPhone) settingsPhone.textContent = phone;
    const settingsExpire = document.getElementById('settings-expire');
    if (settingsExpire) settingsExpire.textContent = entitlementLabel;
  }

  function forceLoginPanel() {
    document.querySelectorAll('#loginCard .auth-panel').forEach((panel) => {
      const isLoginPanel = panel.id === 'panel-login';
      panel.classList.toggle('hidden', !isLoginPanel);
      panel.setAttribute('aria-hidden', String(!isLoginPanel));
    });
  }

  function isLegacyTrialTitle(element) {
    return /免费体验已结束|免注册体验已结束/u.test(element?.textContent?.trim() || '');
  }

  function removeLegacyTrialArtifacts(root = document) {
    const titles = [];
    if (root.nodeType === Node.ELEMENT_NODE && isLegacyTrialTitle(root)) titles.push(root);
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('h1,h2,h3,h4,strong,p,span,div').forEach((element) => {
        if (isLegacyTrialTitle(element)) titles.push(element);
      });
    }
    let removed = false;
    titles.sort((left, right) => left.textContent.length - right.textContent.length).forEach((title) => {
      const modal = title.closest('.modal-overlay,[role="dialog"]')
        || title.closest('.modal-card')?.parentElement
        || title.parentElement?.parentElement?.parentElement;
      if (modal && !modal.contains(document.getElementById('loginView')) && !modal.contains(document.getElementById('dashboardView'))) {
        modal.remove();
        removed = true;
      }
    });
    return removed;
  }

  function installShortLivedTrialRemoval() {
    const observeTarget = document.body || document.documentElement;
    if (!observeTarget || typeof MutationObserver !== 'function' || legacyTrialObserver) return;
    const removeIfLegacyTrial = (node) => {
      const candidate = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return candidate && removeLegacyTrialArtifacts(candidate);
    };
    legacyTrialObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'characterData') removeIfLegacyTrial(record.target);
        else Array.from(record.addedNodes).forEach(removeIfLegacyTrial);
      });
    });
    legacyTrialObserver.observe(observeTarget, { childList: true, subtree: true, characterData: true });
    removeLegacyTrialArtifacts();
  }

  async function prepareAuthorizedStartup() {
    installShortLivedTrialRemoval();
    try {
      const startupSummary = await api.getStartupEntitlement();
      if (startupSummary?.hasPreviousAccount) showExpiryReminder(startupSummary.entitlement);
    } catch {
      // The login screen remains usable if the optional startup summary is unavailable.
    }
  }

  async function enterDashboard(status) {
    currentStatus = status;
    if (!status.authenticated) return;
    if (status.account?.mustChangePassword) { showInitialPasswordChange(); return; }
    if (!['trial', 'licensed'].includes(status.entitlement?.type)) {
      showLoginScreen();
      window.showToast?.(status.entitlement?.reason || '单位有效期已到，请联系平台管理员续期', 'error');
      return;
    }
    removeLegacyTrialArtifacts();
    applyMemberNavigation(status);
    document.body.classList.remove('auth-login-required');
    document.getElementById('loginView')?.classList.add('hidden');
    document.getElementById('dashboardView')?.classList.remove('hidden');
    refreshLegacyAuthLabels(status);
    showExpiryReminder(status.entitlement);
    ensureUnitManagementEntry(status);
    if (typeof window.loadDatabase === 'function') await window.loadDatabase();
    if (typeof window.renderOverview === 'function') window.renderOverview();
    removeLegacyTrialArtifacts();
  }

  function showExpiryReminder(entitlement) {
    if (entitlement?.type === 'expired') {
      window.showToast?.('上次登录的单位账号已到期，请联系平台管理员续期。', 'error');
      return;
    }
    if (!entitlement?.expiresAt || !['trial', 'licensed'].includes(entitlement.type)) return;
    const remainingDays = Math.max(0, Math.ceil((new Date(entitlement.expiresAt).getTime() - Date.now()) / 86400000));
    const threshold = entitlement.plan === 'trial' ? 7 : 30;
    if (remainingDays > threshold) return;
    const kind = entitlement.plan === 'trial' ? '体验版' : '正式授权';
    window.showToast?.(`${kind}将于 ${entitlement.expiresAt.slice(0, 10)} 到期，剩余 ${remainingDays} 天，请联系平台管理员续期。`, 'error');
  }

  function friendlyRemoteError(error) {
    const message = String(error?.message || '');
    if (/无法连接账号服务|账号服务器响应超时|账号服务器连接超时|ECONNREFUSED|Failed to fetch|fetch failed/iu.test(message)) {
      return '无法连接账号服务器。请确认账号服务器已启动；如服务器在其他电脑上，请点击下方“设置账号服务器”填写地址并测试连接。';
    }
    return message.replace(/^Error invoking remote method '[^']+': Error: /u, '') || '提交申请失败，请稍后重试。';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  async function openMemberPermissionsPage() {
    if (!['unit_admin', 'main_account'].includes(currentStatus?.account?.role)) return;
    await window.unitMemberManagement?.open(currentStatus);
  }

  function ensureUnitManagementEntry(status) {
    if (!['unit_admin', 'main_account'].includes(status?.account?.role) || document.getElementById('unitManagementEntry')) return;
    const actions = document.querySelector('.sidebar-secondary-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'unitManagementEntry';
    button.type = 'button';
    button.className = 'sidebar-member-btn';
    button.textContent = '成员与权限';
    button.title = '开通成员并设置权限';
    button.addEventListener('click', openMemberPermissionsPage);
    actions.append(button);
  }

  async function submitLogin() {
    if (loginSubmission) return loginSubmission;
    loginSubmission = (async () => {
      setError('login');
      if (!localBackendReady) {
        await refreshLocalBackendStatus();
        if (!localBackendReady) {
          setError('login', '本机账号服务尚未就绪，请点击下方重试');
          return;
        }
      }
      setLoading('doLoginBtn', true, '登录进入工作台');
      try {
        const phone = document.getElementById('login-phone')?.value || '';
        const password = document.getElementById('login-password')?.value || '';
        const remember = Boolean(document.getElementById('remember-me')?.checked);
        const status = await api.loginLocalAccount({ phone, password, remember });
        await enterDashboard(status);
      } catch (error) {
        setError('login', error.message || '登录失败');
      } finally {
        setLoading('doLoginBtn', false, '登录进入工作台');
      }
    })();
    try {
      return await loginSubmission;
    } finally {
      loginSubmission = null;
    }
  }

  async function submitRegister() {
    setError('reg');
    document.getElementById('openRemoteServerSettings')?.setAttribute('hidden', '');
    const phone = document.getElementById('reg-phone')?.value || '';
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPassword = document.getElementById('reg-password-confirm')?.value || '';
    if (password !== confirmPassword) return setError('reg', '两次输入的密码不一致');
    setLoading('doRegisterBtn', true, '注册并进入工作台');
    try {
      const status = await api.registerLocalAccount({ phone, password, confirmPassword });
      await enterDashboard(status);
    } catch (error) {
      setError('reg', friendlyRemoteError(error));
      if (/无法连接账号服务|账号服务器响应超时|账号服务器连接超时|ECONNREFUSED|Failed to fetch|fetch failed/iu.test(String(error?.message || ''))) {
        document.getElementById('openRemoteServerSettings')?.removeAttribute('hidden');
      }
    }
    finally { setLoading('doRegisterBtn', false, '注册并进入工作台'); }
  }

  function configureApplicationPanel() {
    const panel = document.getElementById('panel-register');
    if (!panel || panel.dataset.unitApplications) return;
    panel.dataset.unitApplications = 'true';
    panel.classList.add('unit-application-panel');
    panel.innerHTML = `<div class="login-header unit-application-heading"><div class="login-logo-container"><img src="logo.png" alt="Logo" style="width:60px;height:60px;object-fit:contain;"></div><h1>手机号注册</h1><p class="subtitle">注册后立即进入试用，子账号由主账号开通</p></div><div class="login-form unit-application-scroll"><div class="input-group"><label for="reg-phone">手机号</label><input id="reg-phone" type="tel" placeholder="作为主账号"></div><div class="unit-application-passwords"><div class="input-group"><label for="reg-password">密码</label><input id="reg-password" type="password" placeholder="至少 6 位"></div><div class="input-group"><label for="reg-password-confirm">确认密码</label><input id="reg-password-confirm" type="password" placeholder="再次输入密码"></div></div><div id="regErrorContainer" class="login-error" style="visibility:hidden"><span id="regErrorText"></span></div><button id="openRemoteServerSettings" type="button" class="remote-server-settings-btn" hidden>设置账号服务器</button></div><div class="unit-application-actions"><button id="backToLoginBtn" type="button" class="btn btn-outline">返回登录</button><button id="doRegisterBtn" type="button" class="btn btn-primary"><span>注册并进入工作台</span></button></div>`;
    panel.querySelector('#backToLoginBtn').addEventListener('click', forceLoginPanel);
    panel.querySelector('#openRemoteServerSettings').addEventListener('click', openRemoteServerModal);
    bindButton('doRegisterBtn', submitRegister);
    const loginForm = document.querySelector('#panel-login .login-form');
    if (!document.getElementById('unitApplicationEntry') && loginForm) {
      const entry = document.createElement('div');
      entry.id = 'unitApplicationEntry';
      entry.style.cssText = 'margin-top:18px;padding-top:16px;border-top:1px solid var(--border-color);';
      entry.innerHTML = '<button type="button" class="btn btn-outline" style="width:100%;">手机号注册</button>';
      entry.querySelector('button').addEventListener('click', () => {
        document.querySelectorAll('#loginCard .auth-panel').forEach(item => { item.classList.toggle('hidden', item !== panel); item.setAttribute('aria-hidden', String(item !== panel)); });
        panel.querySelector('#reg-phone')?.focus();
      });
      loginForm.appendChild(entry);
    }
  }

  async function logout() {
    if (footerActionInFlight) return;
    footerActionInFlight = true;
    const button = document.getElementById('logoutBtn');
    const normalMarkup = button?.innerHTML || '安全退出';
    if (button) {
      button.disabled = true;
      button.innerHTML = '退出中';
    }
    try {
      await api.logoutLocalAccount();
      currentStatus = null;
      showLoginScreen();
      await hydrateLoginPrefill();
      window.showToast?.('已安全退出，请手动登录后进入工作台', 'success');
    } finally {
      footerActionInFlight = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = normalMarkup;
      }
    }
  }

  async function refreshEntitlementFromServer() {
    if (footerActionInFlight) return;
    footerActionInFlight = true;
    const button = document.getElementById('syncTokenBtn');
    const normalMarkup = button?.innerHTML || '刷新额度';
    if (button) {
      button.disabled = true;
      button.innerHTML = '同步中';
    }
    try {
      currentStatus = await api.getLocalAuthStatus();
      if (!currentStatus.authenticated) throw new Error('请先登录账号后再刷新授权');
      refreshLegacyAuthLabels(currentStatus);
      window.showToast?.(`授权已同步：${formatEntitlement(currentStatus.entitlement)}`, 'success');
      return currentStatus;
    } catch (error) {
      window.showToast?.(error.message || '授权同步失败，请检查网络后重试', 'error');
      return null;
    } finally {
      footerActionInFlight = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = normalMarkup;
      }
    }
  }

  function openPrivacyPolicy() {
    if (typeof window.showPrivacyAgreementModal === 'function') return window.showPrivacyAgreementModal();
    window.showToast?.('数据安全承诺暂时不可用，请稍后重试', 'error');
    return null;
  }

  function showLoginScreen() {
    document.body.classList.add('auth-login-required');
    document.getElementById('dashboardView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
    forceLoginPanel();
  }

  function keepStartupOnLoginScreen() {
    if (loginSubmission || currentStatus?.authenticated) return;
    showLoginScreen();
    removeLegacyTrialArtifacts();
  }

  function installStartupLoginGuard() {
    if (startupLoginGuardTimer) window.clearTimeout(startupLoginGuardTimer);
    const delays = [0, 100, 500, 1200];
    let attempt = 0;
    const confirmLoginScreen = () => {
      keepStartupOnLoginScreen();
      if (attempt >= delays.length - 1) {
        startupLoginGuardTimer = null;
        return;
      }
      attempt += 1;
      startupLoginGuardTimer = window.setTimeout(confirmLoginScreen, delays[attempt]);
    };
    confirmLoginScreen();
  }

  async function hydrateLoginPrefill() {
    const phone = document.getElementById('login-phone');
    const password = document.getElementById('login-password');
    const remember = document.getElementById('remember-me');
    try {
      const prefill = await api.getLoginPrefill();
      if (phone) phone.value = prefill.phone || '';
      if (password) password.value = prefill.password || '';
      if (remember) remember.checked = true;
      setLoginHint(prefill.warning || '密码已隐藏，确认后请手动登录');
    } catch {
      if (remember) remember.checked = true;
      setLoginHint('无法读取已保存密码，请手动输入密码登录');
    }
  }

  function setLoginHint(message) {
    let hint = document.getElementById('loginMemoryHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'loginMemoryHint';
      hint.className = 'login-memory-hint';
      document.querySelector('#panel-login .login-form')?.appendChild(hint);
    }
    if (hint) hint.textContent = message;
  }

  async function switchAccount() {
    await api.clearLoginPrefill();
    const phone = document.getElementById('login-phone');
    const password = document.getElementById('login-password');
    const remember = document.getElementById('remember-me');
    if (phone) phone.value = '';
    if (password) password.value = '';
    if (remember) remember.checked = true;
    setError('login');
    setLoginHint('已清除已保存登录信息，请输入其他账号');
    phone?.focus();
  }

  function configureLoginActions() {
    const loginButton = document.getElementById('doLoginBtn');
    if (!loginButton || loginButton.parentElement?.classList.contains('login-action-row')) return;
    const actionRow = document.createElement('div');
    actionRow.className = 'login-action-row';
    const switchButton = document.createElement('button');
    switchButton.type = 'button';
    switchButton.id = 'switchAccountBtn';
    switchButton.className = 'switch-account-btn';
    switchButton.textContent = '切换账号';
    switchButton.addEventListener('click', switchAccount);
    loginButton.querySelector('span').textContent = '登录进入工作台';
    loginButton.classList.add('login-primary-action');
    loginButton.parentElement.insertBefore(actionRow, loginButton);
    actionRow.append(switchButton, loginButton);
    configureRemoteServerEntry(actionRow);
  }

  function setRemoteServerSummary(config) {
    const summary = document.getElementById('remoteServerSummary');
    if (!summary) return;
    summary.textContent = config?.configured
      ? `账号服务器：${config.baseUrl}`
      : `账号服务器：${config?.baseUrl || '尚未设置（将使用正式版默认地址）'}`;
  }

  function ensureLocalBackendStatus() {
    let status = document.getElementById('localBackendStatus');
    if (status) return status;
    status = document.createElement('div');
    status.id = 'localBackendStatus';
    status.className = 'local-backend-status is-starting';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    document.getElementById('remoteServerEntry')?.after(status);
    return status;
  }

  function renderLocalBackendStatus(status) {
    const element = ensureLocalBackendStatus();
    if (!element) return;
    const state = status?.state || 'failed';
    localBackendReady = ['ready', 'external'].includes(state);
    element.className = `local-backend-status ${localBackendReady ? 'is-ready' : state === 'starting' || state === 'idle' ? 'is-starting' : 'is-error'}`;
    element.replaceChildren();
    const label = document.createElement('span');
    label.textContent = state === 'ready'
      ? '账号服务已就绪'
      : state === 'external'
        ? '正在使用局域网账号服务'
        : state === 'starting' || state === 'idle'
          ? '账号服务启动中…'
          : (status?.message || '本机账号服务启动失败');
    element.appendChild(label);
    if (!localBackendReady && !['starting', 'idle'].includes(state)) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'local-backend-retry';
      retry.textContent = '重试';
      retry.addEventListener('click', () => refreshLocalBackendStatus({ retry: true }));
      element.appendChild(retry);
    }
    const loginButton = document.getElementById('doLoginBtn');
    if (loginButton && !loginSubmission) loginButton.disabled = !localBackendReady;
  }

  async function refreshLocalBackendStatus({ retry = false } = {}) {
    if (!api.getLocalBackendStatus) {
      localBackendReady = true;
      return { state: 'external' };
    }
    renderLocalBackendStatus({ state: 'starting' });
    try {
      let status = retry && api.retryLocalBackend
        ? await api.retryLocalBackend()
        : await api.getLocalBackendStatus();
      if (!retry && status?.state === 'idle' && api.retryLocalBackend) status = await api.retryLocalBackend();
      for (let attempt = 0; ['idle', 'starting'].includes(status?.state) && attempt < 60; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 150));
        status = await api.getLocalBackendStatus();
      }
      renderLocalBackendStatus(status);
      return status;
    } catch (error) {
      const status = { state: 'failed', message: error.message || '本机账号服务启动失败' };
      renderLocalBackendStatus(status);
      return status;
    }
  }

  async function refreshRemoteServerSummary() {
    if (!api.getRemoteServerConfig) return;
    try {
      setRemoteServerSummary(await api.getRemoteServerConfig());
    } catch {
      setRemoteServerSummary({ baseUrl: '暂时无法读取' });
    }
  }

  function closeRemoteServerModal() {
    const modal = document.getElementById('remoteServerModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function ensureRemoteServerModal() {
    let modal = document.getElementById('remoteServerModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'remoteServerModal';
    modal.className = 'modal-overlay hidden';
    modal.style.cssText = 'z-index:100003;display:none;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div class="modal-card remote-server-modal-card">
        <div class="modal-header remote-server-modal-header"><div><h3>账号服务器设置</h3><p>请填写局域网内运行账号服务的电脑地址。</p></div><button id="closeRemoteServerModal" class="close-modal-btn" type="button">×</button></div>
        <div class="modal-body remote-server-modal-body"><label for="remoteServerUrl">主电脑 IP 或服务器地址</label><input id="remoteServerUrl" type="text" inputmode="url" placeholder="例如 192.168.2.106" autocomplete="url"><p class="remote-server-note">同一局域网内只需输入主电脑 IP；其他服务器请填写完整地址。</p><div id="remoteServerMessage" class="remote-server-message"></div></div>
        <div class="modal-footer remote-server-modal-footer"><button id="testRemoteServer" class="btn btn-outline" type="button">测试连接</button><button id="saveRemoteServer" class="btn btn-primary" type="button">保存并使用</button></div>
      </div>`;
    document.body.appendChild(modal);
    const message = () => modal.querySelector('#remoteServerMessage');
    const serverUrl = () => modal.querySelector('#remoteServerUrl').value.trim();
    modal.querySelector('#closeRemoteServerModal').addEventListener('click', closeRemoteServerModal);
    modal.querySelector('#testRemoteServer').addEventListener('click', async () => {
      const button = modal.querySelector('#testRemoteServer');
      button.disabled = true;
      message().textContent = '正在检查连接…';
      message().className = 'remote-server-message';
      try {
        const result = await api.checkRemoteServerConnection({ baseUrl: serverUrl() });
        message().textContent = `连接成功 · ${result.baseUrl}${result.version ? ` · 服务版本 ${result.version}` : ''}`;
        message().className = 'remote-server-message is-success';
      } catch (error) {
        message().textContent = error.message || '无法连接账号服务器';
        message().className = 'remote-server-message is-error';
      } finally {
        button.disabled = false;
      }
    });
    modal.querySelector('#saveRemoteServer').addEventListener('click', async () => {
      const button = modal.querySelector('#saveRemoteServer');
      button.disabled = true;
      message().textContent = '';
      try {
        const config = await api.setRemoteServerConfig({ baseUrl: serverUrl() });
        setRemoteServerSummary(config);
        await refreshLocalBackendStatus();
        setLoginHint('账号服务器已更新，请使用该服务器上的账号手动登录');
        closeRemoteServerModal();
      } catch (error) {
        message().textContent = error.message || '无法保存账号服务器地址';
        message().className = 'remote-server-message is-error';
      } finally {
        button.disabled = false;
      }
    });
    return modal;
  }

  async function openRemoteServerModal() {
    const modal = ensureRemoteServerModal();
    const input = modal.querySelector('#remoteServerUrl');
    const message = modal.querySelector('#remoteServerMessage');
    message.textContent = '';
    message.className = 'remote-server-message';
    try {
      input.value = (await api.getRemoteServerConfig()).baseUrl || '';
    } catch {
      input.value = '';
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    input.focus();
  }

  function configureRemoteServerEntry(actionRow) {
    if (!api.getRemoteServerConfig || document.getElementById('remoteServerEntry')) return;
    const entry = document.createElement('div');
    entry.id = 'remoteServerEntry';
    entry.className = 'remote-server-entry';
    const summary = document.createElement('span');
    summary.id = 'remoteServerSummary';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remote-server-settings-btn';
    button.textContent = '设置';
    button.addEventListener('click', openRemoteServerModal);
    entry.append(summary, button);
    actionRow.after(entry);
    ensureLocalBackendStatus();
  }

  function closeActivationModal() {
    const modal = document.getElementById('localActivationModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function ensureActivationModal() {
    let modal = document.getElementById('localActivationModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'localActivationModal';
    modal.className = 'modal-overlay hidden';
    modal.style.cssText = 'z-index:100000;display:none;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div class="modal-card" style="width:560px;max-width:92vw;border-radius:14px;overflow:hidden;background:var(--bg-card);">
        <div class="modal-header" style="padding:18px 22px;border-bottom:1px solid var(--border-color);"><div><h3 style="margin:0 0 4px;font-size:17px;">🔐 离线授权激活</h3><p style="margin:0;color:var(--text-secondary);font-size:12px;">支持月度、年度和永久授权</p></div><button id="closeLocalActivation" class="close-modal-btn" style="background:none;border:0;font-size:22px;cursor:pointer;color:var(--text-secondary);">×</button></div>
        <div class="modal-body" style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
          <div><label style="font-size:12px;font-weight:700;">本机设备码</label><div style="display:flex;gap:8px;margin-top:6px;"><code id="localActivationMachineId" style="flex:1;padding:9px;background:var(--bg-body);border:1px solid var(--border-color);border-radius:7px;word-break:break-all;font-size:11px;"></code><button id="copyLocalMachineId" class="btn btn-outline">复制</button></div></div>
          <div><label for="localActivationCode" style="font-size:12px;font-weight:700;">离线授权码</label><textarea id="localActivationCode" rows="5" placeholder="粘贴授权工具生成的完整授权码" style="width:100%;margin-top:6px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);resize:vertical;"></textarea></div>
          <div id="localActivationError" style="min-height:18px;color:#ef4444;font-size:12px;"></div>
        </div>
        <div class="modal-footer" style="padding:14px 22px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;"><button id="cancelLocalActivation" class="btn btn-outline">稍后激活</button><button id="confirmLocalActivation" class="btn btn-primary">验证并激活</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#copyLocalMachineId').addEventListener('click', () => navigator.clipboard.writeText(modal.querySelector('#localActivationMachineId').textContent));
    modal.querySelector('#confirmLocalActivation').addEventListener('click', async () => {
      const errorBox = modal.querySelector('#localActivationError');
      const button = modal.querySelector('#confirmLocalActivation');
      errorBox.textContent = '';
      button.disabled = true;
      try {
        const status = await api.activateOfflineLicense(modal.querySelector('#localActivationCode').value.trim());
        closeActivationModal();
        await enterDashboard(status);
      } catch (error) {
        errorBox.textContent = error.message || '授权码验证失败';
      } finally {
        button.disabled = false;
      }
    });
    modal.querySelector('#closeLocalActivation').addEventListener('click', closeActivationModal);
    modal.querySelector('#cancelLocalActivation').addEventListener('click', closeActivationModal);
    return modal;
  }

  function openActivationModal(status = currentStatus) {
    const modal = ensureActivationModal();
    modal.querySelector('#localActivationMachineId').textContent = status?.machineId || '获取中...';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeAccountEntitlementModal() {
    const modal = document.getElementById('localAccountEntitlementModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function ensureAccountEntitlementModal() {
    let modal = document.getElementById('localAccountEntitlementModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'localAccountEntitlementModal';
    modal.className = 'modal-overlay hidden';
    modal.style.cssText = 'z-index:100001;display:none;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div class="modal-card" style="width:560px;max-width:92vw;border-radius:14px;overflow:hidden;background:var(--bg-card);">
        <div class="modal-header" style="padding:18px 22px;border-bottom:1px solid var(--border-color);"><div><h3 style="margin:0 0 4px;font-size:17px;">账号授权管理</h3><p style="margin:0;color:var(--text-secondary);font-size:12px;">为本机注册账号设置永久或到期授权</p></div><button id="closeLocalAccountEntitlements" class="close-modal-btn" style="background:none;border:0;font-size:22px;cursor:pointer;color:var(--text-secondary);">×</button></div>
        <div class="modal-body" style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
          <div><label for="localEntitlementAccount" style="font-size:12px;font-weight:700;">账号</label><select id="localEntitlementAccount" style="width:100%;margin-top:6px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);"></select></div>
          <div><label for="localEntitlementPlan" style="font-size:12px;font-weight:700;">使用期限</label><select id="localEntitlementPlan" style="width:100%;margin-top:6px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);"><option value="permanent">永久授权</option><option value="expires">指定到期日</option><option value="trial">重置为 30 天试用</option></select></div>
          <div id="localEntitlementExpiresWrap" style="display:none;"><label for="localEntitlementExpires" style="font-size:12px;font-weight:700;">到期日期</label><input id="localEntitlementExpires" type="date" style="width:100%;margin-top:6px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;"></div>
          <div id="localEntitlementCurrent" style="font-size:12px;color:var(--text-secondary);"></div><div id="localEntitlementError" style="min-height:18px;color:#ef4444;font-size:12px;"></div>
        </div>
        <div class="modal-footer" style="padding:14px 22px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;"><button id="cancelLocalAccountEntitlements" class="btn btn-outline">取消</button><button id="saveLocalAccountEntitlement" class="btn btn-primary">保存授权</button></div>
      </div>`;
    document.body.appendChild(modal);
    const plan = modal.querySelector('#localEntitlementPlan');
    plan.addEventListener('change', () => {
      modal.querySelector('#localEntitlementExpiresWrap').style.display = plan.value === 'expires' ? 'block' : 'none';
    });
    modal.querySelector('#closeLocalAccountEntitlements').addEventListener('click', closeAccountEntitlementModal);
    modal.querySelector('#cancelLocalAccountEntitlements').addEventListener('click', closeAccountEntitlementModal);
    modal.querySelector('#saveLocalAccountEntitlement').addEventListener('click', async () => {
      const errorBox = modal.querySelector('#localEntitlementError');
      const button = modal.querySelector('#saveLocalAccountEntitlement');
      button.disabled = true;
      errorBox.textContent = '';
      try {
        const accounts = await api.setLocalAccountEntitlement({
          accountId: modal.querySelector('#localEntitlementAccount').value,
          plan: plan.value,
          expiresAt: modal.querySelector('#localEntitlementExpires').value,
        });
        populateAccountEntitlements(modal, accounts);
        currentStatus = await api.getLocalAuthStatus();
        document.querySelectorAll('.user-status-text').forEach((element) => { element.textContent = formatEntitlement(currentStatus.entitlement); });
      } catch (error) {
        errorBox.textContent = error.message || '保存授权失败';
      } finally {
        button.disabled = false;
      }
    });
    return modal;
  }

  function populateAccountEntitlements(modal, accounts) {
    const select = modal.querySelector('#localEntitlementAccount');
    const previousValue = select.value;
    select.innerHTML = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.phone)}${account.isOwner ? '（本机主账号）' : ''}</option>`).join('');
    if (accounts.some((account) => account.id === previousValue)) select.value = previousValue;
    const describeCurrent = () => {
      const account = accounts.find((candidate) => candidate.id === select.value);
      modal.querySelector('#localEntitlementCurrent').textContent = account ? `当前状态：${formatEntitlement(account.entitlement)}` : '';
    };
    select.onchange = describeCurrent;
    describeCurrent();
  }

  async function openAccountEntitlementModal() {
    const modal = ensureAccountEntitlementModal();
    const errorBox = modal.querySelector('#localEntitlementError');
    errorBox.textContent = '';
    try {
      populateAccountEntitlements(modal, await api.listLocalAccountEntitlements());
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    } catch (error) {
      errorBox.textContent = error.message || '无法读取账号授权信息';
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function bindButton(id, handler) {
    const button = document.getElementById(id);
    if (!button) return;
    button.removeAttribute('onclick');
    button.addEventListener('click', handler);
  }

  function configureCompactSidebarFooter() {
    const footer = document.querySelector('.sidebar-footer');
    const actions = footer?.querySelector('.sidebar-footer-actions');
    const legacyRow = actions?.querySelector('.sidebar-action-row');
    const refreshButton = document.getElementById('syncTokenBtn');
    const logoutButton = document.getElementById('logoutBtn');
    const privacyButton = legacyRow?.querySelector('button[onclick*="showPrivacyAgreementModal"]');
    if (!footer || !actions || !legacyRow || !refreshButton || !logoutButton) return;

    footer.classList.add('sidebar-footer-compact');
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'sidebar-secondary-actions';
    privacyButton?.remove();
    secondaryActions.append(refreshButton, logoutButton);
    actions.replaceChildren(secondaryActions);
  }

  function removeOnboardingControls() {
    document.querySelectorAll('.btn-guide, .sidebar-tour-btn').forEach((button) => button.remove());
  }

  async function initialize() {
    applyProductBrand();
    const brandObserver = new MutationObserver(applyProductBrand);
    const subtitle = document.getElementById('displayAppSubtitle');
    if (subtitle) brandObserver.observe(subtitle, { childList: true, characterData: true, subtree: true });

    window.submitLogin = submitLogin;
    window.submitRegister = submitRegister;
    window.handleLogout = logout;
    window.forceSyncToken = refreshEntitlementFromServer;
    bindButton('doLoginBtn', submitLogin);
    bindButton('doRegisterBtn', submitRegister);
    bindButton('logoutBtn', logout);
    bindButton('syncTokenBtn', window.forceSyncToken);
    api.onUnitWorkspaceChanged?.(async (payload) => {
      if (payload?.error || document.getElementById('dashboardView')?.classList.contains('hidden')) return;
      await window.loadDatabase?.();
      window.renderOverview?.();
      window.showToast?.('本单位数据已同步更新', 'success');
    });
    configureCompactSidebarFooter();
    removeOnboardingControls();
    configureApplicationPanel();
    bindButton('privacyPolicyBtn', openPrivacyPolicy);
    configureLoginActions();
    showLoginScreen();
    installStartupLoginGuard();
    await refreshRemoteServerSummary();
    await refreshLocalBackendStatus();
    await hydrateLoginPrefill();
    const rememberLabel = document.querySelector('label[for="remember-me"]');
    if (rememberLabel) rememberLabel.textContent = '记住登录';
    const syncButton = document.getElementById('syncTokenBtn');
    if (syncButton) syncButton.title = '从后端同步最新授权额度和有效期';

    currentStatus = await api.getLocalAuthStatus();
    refreshLegacyAuthLabels(currentStatus);
    const machineCode = document.getElementById('forgot-machine-id');
    if (machineCode) machineCode.textContent = currentStatus.machineId;
    installStartupLoginGuard();
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || document.getElementById('loginView')?.classList.contains('hidden')) return;
      if (!document.getElementById('panel-login')?.classList.contains('hidden')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        submitLogin();
      }
    }, true);
  }

  if (window.communityFoundation) {
    window.CommunityAccountUi = { async openMembers() {
      currentStatus = await api.getLocalAuthStatus();
      if (!['unit_admin', 'main_account'].includes(currentStatus?.account?.role)) throw new Error('仅主账号可管理成员权限');
      return openMemberPermissionsPage();
    } };
    return;
  }
  forceLoginPanel();
  prepareAuthorizedStartup();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());

// Load the readable public-document workspace separately from the legacy renderer bundle.
if (!window.communityFoundation) {
if (!document.querySelector('script[data-document-drafting-ui]')) {
  const documentDraftingScript = document.createElement('script');
  documentDraftingScript.src = 'js/document-drafting-ui.js?v=1.0.0';
  documentDraftingScript.dataset.documentDraftingUi = 'true';
  document.head.appendChild(documentDraftingScript);
}

if (!document.querySelector('script[data-update-ui]')) {
  const updateScript = document.createElement('script');
  updateScript.src = 'js/update-ui.js?v=1.0.0';
  updateScript.dataset.updateUi = 'true';
  document.head.appendChild(updateScript);
}

// The legacy renderer's personnel import binding can be absent in packaged builds.
// Load its merge rules first so the standalone import flow can use them reliably.
function loadPersonnelExcelImport() {
  if (document.querySelector('script[data-personnel-excel-import]')) return;
  const personnelImportScript = document.createElement('script');
  personnelImportScript.src = 'js/personnel-excel-import.js?v=1.1.0';
  personnelImportScript.dataset.personnelExcelImport = 'true';
  document.head.appendChild(personnelImportScript);
}

function loadPersonnelImportMerge() {
  if (!document.querySelector('script[data-personnel-import-merge]')) {
    const personnelMergeScript = document.createElement('script');
    personnelMergeScript.src = 'js/personnel-import-merge.js?v=1.0.0';
    personnelMergeScript.dataset.personnelImportMerge = 'true';
    personnelMergeScript.addEventListener('load', loadPersonnelExcelImport, { once: true });
    document.head.appendChild(personnelMergeScript);
    return;
  }
  loadPersonnelExcelImport();
}

function loadSpecialPersonnelProfiles() {
  if (!document.querySelector('script[data-special-personnel-profiles]')) {
    const specialPersonnelProfilesScript = document.createElement('script');
    specialPersonnelProfilesScript.src = '../shared/special-personnel-profiles.js?v=1.0.0';
    specialPersonnelProfilesScript.dataset.specialPersonnelProfiles = 'true';
    specialPersonnelProfilesScript.addEventListener('load', loadPersonnelImportMerge, { once: true });
    document.head.appendChild(specialPersonnelProfilesScript);
    return;
  }
  loadPersonnelImportMerge();
}

if (!document.querySelector('script[data-personnel-excel-parser]')) {
  const personnelExcelParserScript = document.createElement('script');
  personnelExcelParserScript.src = '../shared/personnel-excel-parser.js?v=1.0.0';
  personnelExcelParserScript.dataset.personnelExcelParser = 'true';
  personnelExcelParserScript.addEventListener('load', loadSpecialPersonnelProfiles, { once: true });
  document.head.appendChild(personnelExcelParserScript);
} else {
  loadSpecialPersonnelProfiles();
}

// Keep personnel search independent from the legacy renderer so imported field
// variants and incomplete historical records cannot stop live filtering.
if (!document.querySelector('script[data-personnel-search]')) {
  const personnelSearchScript = document.createElement('script');
  personnelSearchScript.src = 'js/personnel-search.js?v=1.0.0';
  personnelSearchScript.dataset.personnelSearch = 'true';
  document.head.appendChild(personnelSearchScript);
}

// Keep the resident directory readable with a fixed table header, a fixed
// name column and consistent sorting without altering the legacy renderer.
if (!document.querySelector('script[data-personnel-directory-ui]')) {
  const personnelDirectoryScript = document.createElement('script');
  personnelDirectoryScript.src = 'js/personnel-directory-ui.js?v=1.0.0';
  personnelDirectoryScript.dataset.personnelDirectoryUi = 'true';
  document.head.appendChild(personnelDirectoryScript);
}

// Keep the party stage statistics readable and independently testable from
// the legacy party-management bundle.
if (!document.querySelector('script[data-party-stage-stat-cards]')) {
  const partyStageStatCardsScript = document.createElement('script');
  partyStageStatCardsScript.src = 'js/party-stage-stat-cards.js?v=1.0.0';
  partyStageStatCardsScript.dataset.partyStageStatCards = 'true';
  document.head.appendChild(partyStageStatCardsScript);
}

// Household 360° cards must be tied to the exact household number, including
// leading zeroes, rather than a name or a normalized numeric value.
if (!document.querySelector('script[data-household-membership]')) {
  const householdMembershipScript = document.createElement('script');
  householdMembershipScript.src = 'js/household-membership.js?v=1.0.0';
  householdMembershipScript.dataset.householdMembership = 'true';
  document.head.appendChild(householdMembershipScript);
}

// Bridge the readable import schema with the legacy household renderer, then
// route every household click through its exact household number.
if (!document.querySelector('script[data-personnel-data-compatibility]')) {
  const personnelCompatibilityScript = document.createElement('script');
  personnelCompatibilityScript.src = 'js/personnel-data-compatibility.js?v=1.0.0';
  personnelCompatibilityScript.dataset.personnelDataCompatibility = 'true';
  document.head.appendChild(personnelCompatibilityScript);
}

} // Legacy automatic modules are not loaded by the v2.6.4 foundation.
