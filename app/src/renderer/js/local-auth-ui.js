'use strict';

(function installLocalAuthentication() {
  const api = window.api;
  if (!api?.loginLocalAccount) return;

  let currentStatus = null;
  let activeApplicationView = 'login';
  let legacyTrialObserver = null;

  function applyProductBrand() {
    const subtitle = document.getElementById('displayAppSubtitle');
    if (subtitle && subtitle.textContent !== '社区AI管理系统') subtitle.textContent = '社区AI管理系统';
  }

  function setError(kind, message = '') {
    const container = document.getElementById(`${kind}ErrorContainer`);
    const text = document.getElementById(`${kind}ErrorText`);
    if (text) text.textContent = message;
    if (container) container.style.visibility = message ? 'visible' : 'hidden';
  }

  function setLoading(buttonId, loading, normalText) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.disabled = loading;
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
    if (entitlement?.type === 'trial') return `本地试用 · 剩 ${entitlement.remainingDays} 天`;
    if (entitlement?.type === 'expired') return '试用已到期';
    return '未授权';
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

  function hideLegacyTrialModal(modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    modal.style.visibility = 'hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.style.pointerEvents = 'none';
  }

  function forceLoginPanel() {
    document.querySelectorAll('#loginCard .auth-panel').forEach((panel) => {
      const isLoginPanel = panel.id === 'panel-login';
      panel.classList.toggle('hidden', !isLoginPanel);
      panel.setAttribute('aria-hidden', String(!isLoginPanel));
    });
  }

  function clearLegacyTrialExperience() {
    document.querySelectorAll('body, .app-wrapper, #loginView, #dashboardView').forEach((element) => {
      if (element?.style.filter !== 'none') element.style.setProperty('filter', 'none', 'important');
    });

    const trialTitles = Array.from(document.querySelectorAll('h1,h2,h3,h4,strong,p,span,div'))
      .filter((element) => /免费体验已结束|免注册体验已结束/u.test(element.textContent?.trim() || ''))
      .sort((left, right) => left.textContent.length - right.textContent.length);

    trialTitles.forEach((trialTitle) => {
      const modal = trialTitle.closest('.modal-overlay,[role="dialog"]')
        || trialTitle.closest('.modal-card')?.parentElement
        || trialTitle.parentElement?.parentElement?.parentElement;
      if (modal && !modal.contains(document.getElementById('loginView')) && !modal.contains(document.getElementById('dashboardView'))) {
        hideLegacyTrialModal(modal);
      }
    });
  }

  function maintainLocalAuthenticationView() {
    clearLegacyTrialExperience();
    if (activeApplicationView === 'login') {
      document.getElementById('dashboardView')?.classList.add('hidden');
      document.getElementById('loginView')?.classList.remove('hidden');
      forceLoginPanel();
    }
  }

  function startLegacyTrialGuard() {
    if (legacyTrialObserver) return;
    legacyTrialObserver = new MutationObserver(maintainLocalAuthenticationView);
    legacyTrialObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    maintainLocalAuthenticationView();
  }

  async function enterDashboard(status) {
    currentStatus = status;
    if (!status.authenticated) return;
    if (!['trial', 'licensed'].includes(status.entitlement?.type)) {
      openActivationModal(status);
      return;
    }
    activeApplicationView = 'dashboard';
    clearLegacyTrialExperience();
    document.getElementById('loginView')?.classList.add('hidden');
    document.getElementById('dashboardView')?.classList.remove('hidden');
    refreshLegacyAuthLabels(status);
    if (typeof window.loadDatabase === 'function') await window.loadDatabase();
    if (typeof window.renderOverview === 'function') window.renderOverview();
    clearLegacyTrialExperience();
  }

  async function submitLogin() {
    setError('login');
    setLoading('doLoginBtn', true, '安全登录');
    try {
      const phone = document.getElementById('login-phone')?.value || '';
      const password = document.getElementById('login-password')?.value || '';
      const remember = Boolean(document.getElementById('remember-me')?.checked);
      const status = await api.loginLocalAccount({ phone, password, remember });
      await enterDashboard(status);
    } catch (error) {
      setError('login', error.message || '登录失败');
    } finally {
      setLoading('doLoginBtn', false, '安全登录');
    }
  }

  async function submitRegister() {
    setError('reg');
    const phone = document.getElementById('reg-phone')?.value || '';
    const password = document.getElementById('reg-password')?.value || '';
    if (password !== (document.getElementById('reg-password-confirm')?.value || '')) {
      setError('reg', '两次输入的密码不一致');
      return;
    }
    setLoading('doRegisterBtn', true, '注册并开启 30 天免费试用');
    try {
      await enterDashboard(await api.registerLocalAccount({ phone, password, remember: true }));
    } catch (error) {
      setError('reg', error.message || '注册失败');
    } finally {
      setLoading('doRegisterBtn', false, '注册并开启 30 天免费试用');
    }
  }

  async function logout() {
    await api.logoutLocalAccount();
    currentStatus = null;
    showLoginScreen();
    await hydrateLoginPrefill();
  }

  function showLoginScreen() {
    activeApplicationView = 'login';
    clearLegacyTrialExperience();
    document.getElementById('dashboardView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
    forceLoginPanel();
    queueMicrotask(maintainLocalAuthenticationView);
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
    select.innerHTML = accounts.map((account) => `<option value="${account.id}">${account.phone}${account.isOwner ? '（本机主账号）' : ''}</option>`).join('');
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

  async function initialize() {
    applyProductBrand();
    const brandObserver = new MutationObserver(applyProductBrand);
    const subtitle = document.getElementById('displayAppSubtitle');
    if (subtitle) brandObserver.observe(subtitle, { childList: true, characterData: true, subtree: true });

    window.submitLogin = submitLogin;
    window.submitRegister = submitRegister;
    window.handleLogout = logout;
    window.forceSyncToken = async () => {
      currentStatus = await api.getLocalAuthStatus();
      if (currentStatus.account?.isOwner) return openAccountEntitlementModal();
      return openActivationModal(currentStatus);
    };
    bindButton('doLoginBtn', submitLogin);
    bindButton('doRegisterBtn', submitRegister);
    bindButton('logoutBtn', logout);
    bindButton('syncTokenBtn', window.forceSyncToken);
    configureLoginActions();
    showLoginScreen();
    startLegacyTrialGuard();
    await hydrateLoginPrefill();
    const rememberLabel = document.querySelector('label[for="remember-me"]');
    if (rememberLabel) rememberLabel.textContent = '记住登录';
    const syncButton = document.getElementById('syncTokenBtn');
    if (syncButton) syncButton.title = '查看设备码或输入离线授权码';

    currentStatus = await api.getLocalAuthStatus();
    refreshLegacyAuthLabels(currentStatus);
    const machineCode = document.getElementById('forgot-machine-id');
    if (machineCode) machineCode.textContent = currentStatus.machineId;
    if (syncButton && currentStatus.account?.isOwner) {
      syncButton.title = '管理本机注册账号的使用期限';
      syncButton.lastChild.textContent = ' 账号授权';
    }
    const privacyLink = document.querySelector('#panel-login a[onclick*="showPrivacyAgreementModal"]');
    if (privacyLink) {
      const activationLink = document.createElement('a');
      activationLink.href = '#';
      activationLink.textContent = '🔐 离线激活';
      activationLink.style.cssText = privacyLink.style.cssText;
      activationLink.style.marginLeft = '8px';
      activationLink.addEventListener('click', (event) => {
        event.preventDefault();
        openActivationModal(currentStatus);
      });
      privacyLink.parentElement.appendChild(activationLink);
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || document.getElementById('loginView')?.classList.contains('hidden')) return;
      if (!document.getElementById('panel-login')?.classList.contains('hidden')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        submitLogin();
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());

// Load the readable public-document workspace separately from the legacy renderer bundle.
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
