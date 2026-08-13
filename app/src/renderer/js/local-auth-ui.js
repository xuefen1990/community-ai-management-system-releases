'use strict';

(function installLocalAuthentication() {
  const api = window.api;
  if (!api?.loginLocalAccount) return;

  let currentStatus = null;

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
      const label = entitlement.plan === 'monthly' ? '月度授权' : '年度授权';
      return entitlement.expiresAt ? `${label} · 至 ${entitlement.expiresAt.slice(0, 10)}` : label;
    }
    if (entitlement?.type === 'trial') return `本地试用 · 剩 ${entitlement.remainingDays} 天`;
    if (entitlement?.type === 'expired') return '试用已到期';
    return '未授权';
  }

  async function enterDashboard(status) {
    currentStatus = status;
    if (!status.authenticated) return;
    if (!['trial', 'licensed'].includes(status.entitlement?.type)) {
      openActivationModal(status);
      return;
    }
    document.getElementById('loginView')?.classList.add('hidden');
    document.getElementById('dashboardView')?.classList.remove('hidden');
    document.querySelectorAll('.admin-name').forEach((element) => { element.textContent = status.account.phone; });
    document.querySelectorAll('.user-status-text').forEach((element) => {
      element.textContent = formatEntitlement(status.entitlement);
    });
    if (typeof window.loadDatabase === 'function') await window.loadDatabase();
    if (typeof window.renderOverview === 'function') window.renderOverview();
  }

  async function submitLogin() {
    setError('login');
    setLoading('doLoginBtn', true, '安全登录');
    try {
      const phone = document.getElementById('login-phone')?.value || '';
      const password = document.getElementById('login-password')?.value || '';
      const status = await api.loginLocalAccount({ phone, password });
      if (document.getElementById('remember-me')?.checked) localStorage.setItem('local-auth-phone', phone);
      else localStorage.removeItem('local-auth-phone');
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
      await enterDashboard(await api.registerLocalAccount({ phone, password }));
    } catch (error) {
      setError('reg', error.message || '注册失败');
    } finally {
      setLoading('doRegisterBtn', false, '注册并开启 30 天免费试用');
    }
  }

  async function logout() {
    await api.logoutLocalAccount();
    currentStatus = null;
    document.getElementById('dashboardView')?.classList.add('hidden');
    document.getElementById('loginView')?.classList.remove('hidden');
    if (typeof window.showPanel === 'function') window.showPanel('login');
    const password = document.getElementById('login-password');
    if (password) password.value = '';
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
    window.forceSyncToken = async () => openActivationModal(await api.getLocalAuthStatus());
    bindButton('doLoginBtn', submitLogin);
    bindButton('doRegisterBtn', submitRegister);
    bindButton('logoutBtn', logout);
    bindButton('syncTokenBtn', window.forceSyncToken);

    const rememberedPhone = localStorage.getItem('local-auth-phone');
    if (rememberedPhone) {
      document.getElementById('login-phone').value = rememberedPhone;
      document.getElementById('remember-me').checked = true;
    }
    const rememberLabel = document.querySelector('label[for="remember-me"]');
    if (rememberLabel) rememberLabel.textContent = '记住手机号';
    const syncButton = document.getElementById('syncTokenBtn');
    if (syncButton) syncButton.title = '查看设备码或输入离线授权码';

    currentStatus = await api.getLocalAuthStatus();
    const machineCode = document.getElementById('forgot-machine-id');
    if (machineCode) machineCode.textContent = currentStatus.machineId;

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
