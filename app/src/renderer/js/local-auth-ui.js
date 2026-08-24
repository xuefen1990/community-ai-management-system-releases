'use strict';

(function installLocalAuthentication() {
  const api = window.api;
  if (!api?.loginLocalAccount) return;

  let currentStatus = null;
  let startupTrialGuardTimer = null;
  let loginSubmission = null;
  let startupLoginGuardTimer = null;
  let footerActionInFlight = false;

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

  function hasPurchasedStartupAccess(summary) {
    return summary?.entitlement?.type === 'licensed';
  }

  function installShortLivedTrialRemoval() {
    const observeTarget = document.body || document.documentElement;
    if (!observeTarget || typeof MutationObserver !== 'function') return;
    let observer = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (startupTrialGuardTimer) window.clearTimeout(startupTrialGuardTimer);
      startupTrialGuardTimer = null;
    };
    const removeIfLegacyTrial = (node) => {
      const candidate = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return candidate && removeLegacyTrialArtifacts(candidate);
    };
    observer = new MutationObserver((records) => {
      const removed = records.some((record) => {
        if (record.type === 'characterData') return removeIfLegacyTrial(record.target);
        return Array.from(record.addedNodes).some(removeIfLegacyTrial);
      });
      if (removed) stop();
    });
    observer.observe(observeTarget, { childList: true, subtree: true, characterData: true });
    if (removeLegacyTrialArtifacts()) {
      stop();
      return;
    }
    startupTrialGuardTimer = window.setTimeout(stop, 2500);
  }

  async function prepareAuthorizedStartup() {
    try {
      const startupSummary = await api.getStartupEntitlement();
      if (hasPurchasedStartupAccess(startupSummary)) installShortLivedTrialRemoval();
    } catch {
      // The login screen remains usable if the optional startup summary is unavailable.
    }
  }

  async function enterDashboard(status) {
    currentStatus = status;
    if (!status.authenticated) return;
    if (!['trial', 'licensed'].includes(status.entitlement?.type)) {
      openActivationModal(status);
      return;
    }
    removeLegacyTrialArtifacts();
    document.body.classList.remove('auth-login-required');
    document.getElementById('loginView')?.classList.add('hidden');
    document.getElementById('dashboardView')?.classList.remove('hidden');
    refreshLegacyAuthLabels(status);
    if (typeof window.loadDatabase === 'function') await window.loadDatabase();
    if (typeof window.renderOverview === 'function') window.renderOverview();
    removeLegacyTrialArtifacts();
  }

  async function submitLogin() {
    if (loginSubmission) return loginSubmission;
    loginSubmission = (async () => {
      setError('login');
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
    const kind = document.querySelector('input[name="application-kind"]:checked')?.value || 'unit-admin';
    const phone = document.getElementById('reg-phone')?.value || '';
    const password = document.getElementById('reg-password')?.value || '';
    const name = document.getElementById('reg-name')?.value || '';
    if (password !== (document.getElementById('reg-password-confirm')?.value || '')) return setError('reg', '两次输入的密码不一致');
    setLoading('doRegisterBtn', true, '提交申请');
    try {
      if (kind === 'unit-admin') {
        await api.submitUnitAdminApplication({ phone, password, name, organizationName: document.getElementById('reg-organization-name')?.value || '', region: document.getElementById('reg-region')?.value || '' });
        setError('reg', '申请已提交，等待平台审核后即可登录。');
      } else {
        await api.submitMemberApplication({ phone, password, name, inviteCode: document.getElementById('reg-invite-code')?.value || '' });
        setError('reg', '加入申请已提交，等待单位管理员审核。');
      }
    } catch (error) { setError('reg', error.message || '提交申请失败'); }
    finally { setLoading('doRegisterBtn', false, '提交申请'); }
  }

  function configureApplicationPanel() {
    const panel = document.getElementById('panel-register');
    if (!panel || panel.dataset.unitApplications) return;
    panel.dataset.unitApplications = 'true';
    panel.innerHTML = `<div class="login-header"><div class="login-logo-container"><img src="logo.png" alt="Logo" style="width:60px;height:60px;object-fit:contain;"></div><h1>开户注册申请</h1><p class="subtitle">选择申请单位管理员，或通过邀请码加入单位</p></div><div class="login-form"><div class="input-group"><label><input type="radio" name="application-kind" value="unit-admin" checked> 申请成为单位管理员</label><label style="margin-left:12px"><input type="radio" name="application-kind" value="member"> 申请加入单位</label></div><div class="input-group"><label for="reg-name">姓名</label><input id="reg-name" type="text" placeholder="请输入真实姓名"></div><div class="input-group"><label for="reg-phone">手机号</label><input id="reg-phone" type="text" placeholder="请输入手机号"></div><div class="input-group"><label for="reg-password">密码</label><input id="reg-password" type="password" placeholder="至少 6 位"></div><div class="input-group"><label for="reg-password-confirm">确认密码</label><input id="reg-password-confirm" type="password" placeholder="再次输入密码"></div><div data-unit-admin-fields><div class="input-group"><label for="reg-organization-name">村居/社区名称</label><input id="reg-organization-name" type="text" placeholder="例如：陆庄社区"></div><div class="input-group"><label for="reg-region">所在地区</label><input id="reg-region" type="text" placeholder="例如：晓店街道"></div></div><div class="input-group hidden" data-member-fields><label for="reg-invite-code">邀请码</label><input id="reg-invite-code" type="text" placeholder="扫描二维码后自动填入，或手工输入"></div><div id="regErrorContainer" class="login-error" style="visibility:hidden"><span id="regErrorText"></span></div><button id="doRegisterBtn" type="button" class="btn btn-primary"><span>提交申请</span></button><button id="backToLoginBtn" type="button" class="btn btn-outline" style="margin-top:10px">返回登录</button></div>`;
    const updateKind = () => { const member = panel.querySelector('input[name="application-kind"]:checked')?.value === 'member'; panel.querySelector('[data-unit-admin-fields]').classList.toggle('hidden', member); panel.querySelector('[data-member-fields]').classList.toggle('hidden', !member); };
    panel.querySelectorAll('input[name="application-kind"]').forEach(input => input.addEventListener('change', updateKind));
    panel.querySelector('#backToLoginBtn').addEventListener('click', () => forceLoginPanel());
    bindButton('doRegisterBtn', submitRegister);
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
      : `账号服务器：${config?.baseUrl || '尚未设置（将使用本机默认地址）'}`;
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
        <div class="modal-body remote-server-modal-body"><label for="remoteServerUrl">服务器地址</label><input id="remoteServerUrl" type="url" placeholder="http://192.168.x.x:3000" autocomplete="url"><p class="remote-server-note">仅在可信局域网中使用 HTTP；公网部署请使用 HTTPS。</p><div id="remoteServerMessage" class="remote-server-message"></div></div>
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

  function configureCompactSidebarFooter() {
    const footer = document.querySelector('.sidebar-footer');
    const actions = footer?.querySelector('.sidebar-footer-actions');
    const legacyRow = actions?.querySelector('.sidebar-action-row');
    const refreshButton = document.getElementById('syncTokenBtn');
    const logoutButton = document.getElementById('logoutBtn');
    const privacyButton = legacyRow?.querySelector('button[onclick*="showPrivacyAgreementModal"]');
    if (!footer || !actions || !legacyRow || !refreshButton || !logoutButton || !privacyButton) return;

    footer.classList.add('sidebar-footer-compact');
    privacyButton.id = 'privacyPolicyBtn';
    privacyButton.classList.add('sidebar-security-btn');
    privacyButton.removeAttribute('style');
    privacyButton.removeAttribute('onmouseover');
    privacyButton.removeAttribute('onmouseout');

    const primaryActions = document.createElement('div');
    primaryActions.className = 'sidebar-primary-actions';
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'sidebar-secondary-actions';

    primaryActions.append(refreshButton, logoutButton);
    secondaryActions.append(privacyButton);
    actions.replaceChildren(primaryActions, secondaryActions);
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
    configureCompactSidebarFooter();
    configureApplicationPanel();
    bindButton('privacyPolicyBtn', openPrivacyPolicy);
    configureLoginActions();
    showLoginScreen();
    installStartupLoginGuard();
    await refreshRemoteServerSummary();
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

  prepareAuthorizedStartup();
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

// The legacy renderer's personnel import binding can be absent in packaged builds.
// Load its merge rules first so the standalone import flow can use them reliably.
function loadPersonnelExcelImport() {
  if (document.querySelector('script[data-personnel-excel-import]')) return;
  const personnelImportScript = document.createElement('script');
  personnelImportScript.src = 'js/personnel-excel-import.js?v=1.1.0';
  personnelImportScript.dataset.personnelExcelImport = 'true';
  document.head.appendChild(personnelImportScript);
}

if (!document.querySelector('script[data-personnel-import-merge]')) {
  const personnelMergeScript = document.createElement('script');
  personnelMergeScript.src = 'js/personnel-import-merge.js?v=1.0.0';
  personnelMergeScript.dataset.personnelImportMerge = 'true';
  personnelMergeScript.addEventListener('load', loadPersonnelExcelImport, { once: true });
  document.head.appendChild(personnelMergeScript);
} else {
  loadPersonnelExcelImport();
}

// Keep personnel search independent from the legacy renderer so imported field
// variants and incomplete historical records cannot stop live filtering.
if (!document.querySelector('script[data-personnel-search]')) {
  const personnelSearchScript = document.createElement('script');
  personnelSearchScript.src = 'js/personnel-search.js?v=1.0.0';
  personnelSearchScript.dataset.personnelSearch = 'true';
  document.head.appendChild(personnelSearchScript);
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
