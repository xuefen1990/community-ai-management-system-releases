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
    if (!['trial', 'licensed'].includes(status.entitlement?.type)) {
      showLoginScreen();
      window.showToast?.(status.entitlement?.reason || '单位有效期已到，请联系平台管理员续期', 'error');
      return;
    }
    removeLegacyTrialArtifacts();
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

  function permissionChoices(selected = {}) {
    const has = (moduleName, action) => selected?.[moduleName]?.includes(action) ? 'checked' : '';
    return `<div class="unit-permissions"><strong>成员权限</strong><label><input type="checkbox" data-permission="workspace:view" ${has('workspace', 'view')}> 查看单位共享数据</label><label><input type="checkbox" data-permission="workspace:update" ${has('workspace', 'update')}> 修改单位共享数据</label><label><input type="checkbox" data-permission="personnel:view" ${has('personnel', 'view')}> 人员档案查看</label><label><input type="checkbox" data-permission="personnel:create" ${has('personnel', 'create')}> 人员档案录入</label><label><input type="checkbox" data-permission="visit:view" ${has('visit', 'view')}> 走访记录查看</label><label><input type="checkbox" data-permission="visit:create" ${has('visit', 'create')}> 走访记录录入</label><label><input type="checkbox" data-permission="party:view" ${has('party', 'view')}> 党务查看</label><label><input type="checkbox" data-permission="work:view" ${has('work', 'view')}> 工作事项查看</label></div>`;
  }

  function selectedPermissions(root) {
    const result = {};
    root.querySelectorAll('[data-permission]:checked').forEach((input) => {
      const [moduleName, action] = input.dataset.permission.split(':');
      (result[moduleName] ||= []).push(action);
    });
    return result;
  }

  function closeUnitManagementModal() {
    document.getElementById('unitManagementModal')?.remove();
  }

  async function openUnitManagementModal() {
    if (!api.listUnitMemberApplications) return;
    closeUnitManagementModal();
    const modal = document.createElement('div');
    modal.id = 'unitManagementModal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:100004;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `<div class="modal-card" style="width:760px;max-width:94vw;max-height:88vh;overflow:auto;padding:22px;"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><div><h3 style="margin:0;">成员与权限管理</h3><p style="margin:5px 0 0;color:var(--text-secondary);font-size:12px;">审核成员申请，生成邀请码并调整成员权限。</p></div><button type="button" class="btn btn-outline" data-close-unit-management>关闭</button></div><div data-unit-management-content style="padding-top:18px;">加载中…</div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-unit-management]').addEventListener('click', closeUnitManagementModal);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeUnitManagementModal(); });
    const content = modal.querySelector('[data-unit-management-content]');
    try {
      const [applicationsResult, membersResult, invitesResult] = await Promise.all([api.listUnitMemberApplications(), api.listUnitMembers(), api.listUnitInvites()]);
      const applications = applicationsResult.applications || [];
      const members = membersResult.members || [];
      const invites = invitesResult.invites || [];
      content.innerHTML = `<section style="padding:12px;border:1px solid var(--border-color);border-radius:8px;"><h4 style="margin-top:0;">导入本机历史数据</h4><p style="font-size:12px;color:var(--text-secondary);">仅当单位共享工作区为空时，才可把当前电脑的数据一次性导入。已有共享数据时会拒绝导入，避免重复和覆盖。</p><button id="importLocalUnitDataBtn" class="btn btn-outline">导入当前电脑数据</button></section><section><h4>待审核申请（${applications.filter((item) => item.status === 'pending').length}）</h4>${applications.length ? applications.map((item) => `<article style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin:8px 0;"><div><strong>${escapeHtml(item.applicant?.name || '未命名')}</strong> · ${escapeHtml(item.applicant?.phone || '')} · ${item.status === 'pending' ? '待审核' : escapeHtml(item.status)}</div>${item.status === 'pending' ? `${permissionChoices()}<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-primary" data-approve-member="${item.id}">通过并授权</button><button class="btn btn-outline" data-reject-member="${item.id}">拒绝</button></div>` : ''}</article>`).join('') : '<p>暂无成员申请。</p>'}</section><section style="margin-top:22px;"><h4>邀请码</h4><div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;"><label>有效至<input id="unitInviteExpiry" type="date" style="display:block;margin-top:4px;"></label><label>可使用人数<input id="unitInviteMaxUses" type="number" min="1" max="1000" value="20" style="display:block;margin-top:4px;width:90px;"></label><button class="btn btn-primary" id="createUnitInviteBtn">生成邀请码</button></div><div id="unitInviteCreated" style="margin-top:10px;"></div>${invites.length ? `<ul>${invites.map((item) => `<li>${escapeHtml(item.expiresAt?.slice(0, 10) || '')} · 已用 ${item.usedCount}/${item.maxUses} · ${item.isActive ? '<button class="btn btn-outline" data-deactivate-invite="' + item.id + '">作废</button>' : '已作废'}</li>`).join('')}</ul>` : ''}</section><section style="margin-top:22px;"><h4>已加入成员</h4>${members.length ? members.map((member) => `<article style="border-top:1px solid var(--border-color);padding:10px 0;"><strong>${escapeHtml(member.name || '')}</strong> · ${escapeHtml(member.phone)}${permissionChoices(member.permissions)}<button class="btn btn-primary" data-save-member="${member.id}" style="margin-top:8px;">保存权限</button></article>`).join('') : '<p>暂无已启用成员。</p>'}</section>`;
      content.querySelector('#importLocalUnitDataBtn')?.addEventListener('click', async () => { if (!window.confirm('确认把当前电脑的本机数据导入本单位共享工作区？此操作只允许在共享工作区为空时进行。')) return; const result = await api.importLocalDataToUnit(); window.showToast?.(`已导入 ${result.recordCount} 条本机记录`, 'success'); });
      content.querySelectorAll('[data-approve-member]').forEach((button) => button.addEventListener('click', async () => { await api.reviewUnitMemberApplication({ applicationId: button.dataset.approveMember, approve: true, permissions: selectedPermissions(button.closest('article')) }); await openUnitManagementModal(); }));
      content.querySelectorAll('[data-reject-member]').forEach((button) => button.addEventListener('click', async () => { await api.reviewUnitMemberApplication({ applicationId: button.dataset.rejectMember, approve: false }); await openUnitManagementModal(); }));
      content.querySelectorAll('[data-save-member]').forEach((button) => button.addEventListener('click', async () => { await api.updateUnitMemberPermissions({ memberId: button.dataset.saveMember, permissions: selectedPermissions(button.closest('article')) }); window.showToast?.('成员权限已保存', 'success'); }));
      content.querySelector('#createUnitInviteBtn')?.addEventListener('click', async () => { const expiresAt = content.querySelector('#unitInviteExpiry').value; const maxUses = content.querySelector('#unitInviteMaxUses').value; const result = await api.createUnitInvite({ expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined, maxUses }); content.querySelector('#unitInviteCreated').textContent = `请仅通过可信渠道发送邀请码：${result.code}`; });
      content.querySelectorAll('[data-deactivate-invite]').forEach((button) => button.addEventListener('click', async () => { await api.deactivateUnitInvite({ inviteId: button.dataset.deactivateInvite }); await openUnitManagementModal(); }));
    } catch (error) { content.textContent = error.message || '无法加载成员管理信息'; }
  }

  function closeMemberPermissionsPage() {
    document.getElementById('memberPermissionsPage')?.remove();
  }

  async function openMemberPermissionsPage() {
    if (!api.listUnitMemberApplications || currentStatus?.account?.role !== 'unit_admin') return;
    closeMemberPermissionsPage();
    const page = document.createElement('section');
    page.id = 'memberPermissionsPage';
    page.className = 'member-permissions-page';
    page.innerHTML = `<div class="member-permissions-page__panel"><header class="member-permissions-page__header"><div><p class="member-permissions-page__eyebrow">单位管理</p><h2>成员与权限</h2><p>统一授权：${escapeHtml(formatEntitlement(currentStatus?.entitlement))}</p></div><button type="button" class="btn btn-outline" data-close-member-page>返回工作台</button></header><main data-member-page-content class="member-permissions-page__content">正在加载成员信息…</main></div>`;
    document.body.appendChild(page);
    page.querySelector('[data-close-member-page]').addEventListener('click', closeMemberPermissionsPage);
    const content = page.querySelector('[data-member-page-content]');
    try {
      const [applicationsResult, membersResult, invitesResult] = await Promise.all([api.listUnitMemberApplications(), api.listUnitMembers(), api.listUnitInvites()]);
      const applications = applicationsResult.applications || [];
      const members = membersResult.members || [];
      const invites = invitesResult.invites || [];
      const pendingApplications = applications.filter((item) => item.status === 'pending');
      content.innerHTML = `<section class="member-permissions-page__section"><div class="member-permissions-page__section-heading"><div><h3>单位成员</h3><p>${members.length} 个账号，成员有效期自动跟随单位管理员。</p></div></div>${members.length ? members.map((member) => `<article class="member-permissions-page__member"><div class="member-permissions-page__member-summary"><div><strong>${escapeHtml(member.name || '未命名成员')}</strong><span>${escapeHtml(member.phone || '')}</span></div><div><span class="member-status member-status--${member.isActive ? 'active' : 'disabled'}">${member.isActive ? '正常使用' : '已停用'}</span><small>最后登录：${escapeHtml(member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString('zh-CN') : '尚未登录')}</small></div></div>${permissionChoices(member.permissions)}<div class="member-permissions-page__actions"><button class="btn btn-primary" data-save-member="${escapeHtml(member.id)}">保存权限</button><button class="btn btn-outline" data-clear-member="${escapeHtml(member.id)}">清空权限</button><button class="btn ${member.isActive ? 'btn-outline member-permissions-page__danger' : 'btn-primary'}" data-toggle-member="${escapeHtml(member.id)}" data-next-active="${member.isActive ? 'false' : 'true'}">${member.isActive ? '停用成员' : '恢复成员'}</button></div></article>`).join('') : '<p class="member-permissions-page__empty">暂无已加入的成员。</p>'}</section><section class="member-permissions-page__section"><div class="member-permissions-page__section-heading"><div><h3>待审核申请</h3><p>${pendingApplications.length} 个账号等待单位管理员处理。</p></div></div>${pendingApplications.length ? pendingApplications.map((item) => `<article class="member-permissions-page__member"><div class="member-permissions-page__member-summary"><div><strong>${escapeHtml(item.applicant?.name || '未命名申请人')}</strong><span>${escapeHtml(item.applicant?.phone || '')}</span></div><small>申请时间：${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '')}</small></div>${permissionChoices()}<div class="member-permissions-page__actions"><button class="btn btn-primary" data-approve-member="${escapeHtml(item.id)}">通过并授权</button><button class="btn btn-outline member-permissions-page__danger" data-reject-member="${escapeHtml(item.id)}">拒绝申请</button></div></article>`).join('') : '<p class="member-permissions-page__empty">暂无待审核申请。</p>'}</section><section class="member-permissions-page__section"><div class="member-permissions-page__section-heading"><div><h3>邀请码</h3><p>通过邀请码申请加入后，仍需单位管理员审核。</p></div></div><div class="member-permissions-page__invite-form"><label>有效至<input id="unitInviteExpiry" type="date"></label><label>可使用人数<input id="unitInviteMaxUses" type="number" min="1" max="1000" value="20"></label><button class="btn btn-primary" id="createUnitInviteBtn">生成邀请码</button></div><div id="unitInviteCreated" class="member-permissions-page__invite-code"></div>${invites.length ? `<div class="member-permissions-page__invite-list">${invites.map((item) => `<article><span>${escapeHtml(item.expiresAt?.slice(0, 10) || '')} 前有效 · 已用 ${item.usedCount}/${item.maxUses}</span>${item.isActive ? `<button class="btn btn-outline" data-deactivate-invite="${escapeHtml(item.id)}">停用邀请码</button>` : '<span class="member-status member-status--disabled">已停用</span>'}</article>`).join('')}</div>` : '<p class="member-permissions-page__empty">尚未生成邀请码。</p>'}</section>`;
      const refresh = () => openMemberPermissionsPage();
      const runAction = async (action) => { try { await action(); } catch (error) { window.showToast?.(error.message || '操作未完成，请稍后重试', 'error'); } };
      content.querySelectorAll('[data-approve-member]').forEach((button) => button.addEventListener('click', () => runAction(async () => { await api.reviewUnitMemberApplication({ applicationId: button.dataset.approveMember, approve: true, permissions: selectedPermissions(button.closest('article')) }); window.showToast?.('成员已通过审核', 'success'); await refresh(); })));
      content.querySelectorAll('[data-reject-member]').forEach((button) => button.addEventListener('click', () => runAction(async () => { await api.reviewUnitMemberApplication({ applicationId: button.dataset.rejectMember, approve: false }); window.showToast?.('已拒绝该申请', 'success'); await refresh(); })));
      content.querySelectorAll('[data-save-member]').forEach((button) => button.addEventListener('click', () => runAction(async () => { await api.updateUnitMemberPermissions({ memberId: button.dataset.saveMember, permissions: selectedPermissions(button.closest('article')) }); window.showToast?.('成员权限已保存', 'success'); })));
      content.querySelectorAll('[data-clear-member]').forEach((button) => button.addEventListener('click', () => runAction(async () => { await api.updateUnitMemberPermissions({ memberId: button.dataset.clearMember, permissions: {} }); window.showToast?.('成员权限已清空', 'success'); await refresh(); })));
      content.querySelectorAll('[data-toggle-member]').forEach((button) => button.addEventListener('click', () => runAction(async () => { const isActive = button.dataset.nextActive === 'true'; await api.updateUnitMemberStatus({ memberId: button.dataset.toggleMember, isActive }); window.showToast?.(isActive ? '成员已恢复使用' : '成员已停用', 'success'); await refresh(); })));
      content.querySelector('#createUnitInviteBtn')?.addEventListener('click', () => runAction(async () => { const expiresAt = content.querySelector('#unitInviteExpiry').value; const maxUses = content.querySelector('#unitInviteMaxUses').value; const result = await api.createUnitInvite({ expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined, maxUses }); content.querySelector('#unitInviteCreated').textContent = `请仅通过可信渠道发送邀请码：${result.code}`; window.showToast?.('邀请码已生成', 'success'); }));
      content.querySelectorAll('[data-deactivate-invite]').forEach((button) => button.addEventListener('click', () => runAction(async () => { await api.deactivateUnitInvite({ inviteId: button.dataset.deactivateInvite }); window.showToast?.('邀请码已停用', 'success'); await refresh(); })));
    } catch (error) {
      content.innerHTML = `<p class="member-permissions-page__error">${escapeHtml(error.message || '无法加载成员管理信息')}</p>`;
    }
  }

  function ensureUnitManagementEntry(status) {
    if (status?.account?.role !== 'unit_admin' || document.getElementById('unitManagementEntry')) return;
    const actions = document.querySelector('.sidebar-secondary-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'unitManagementEntry';
    button.type = 'button';
    button.className = 'sidebar-member-btn';
    button.textContent = '成员与权限';
    button.title = '管理单位成员、权限、申请和邀请码';
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
    } catch (error) {
      setError('reg', friendlyRemoteError(error));
      if (/无法连接账号服务|账号服务器响应超时|账号服务器连接超时|ECONNREFUSED|Failed to fetch|fetch failed/iu.test(String(error?.message || ''))) {
        document.getElementById('openRemoteServerSettings')?.removeAttribute('hidden');
      }
    }
    finally { setLoading('doRegisterBtn', false, '提交申请'); }
  }

  function configureApplicationPanel() {
    const panel = document.getElementById('panel-register');
    if (!panel || panel.dataset.unitApplications) return;
    panel.dataset.unitApplications = 'true';
    panel.classList.add('unit-application-panel');
    panel.innerHTML = `<div class="login-header unit-application-heading"><div class="login-logo-container"><img src="logo.png" alt="Logo" style="width:60px;height:60px;object-fit:contain;"></div><h1>开户注册申请</h1><p class="subtitle">填写资料后，由平台管理员审核开通</p></div><div class="unit-application-kind" role="radiogroup" aria-label="申请类型"><label class="unit-application-kind-option is-selected"><input type="radio" name="application-kind" value="unit-admin" checked><span>申请成为单位管理员</span></label><label class="unit-application-kind-option"><input type="radio" name="application-kind" value="member"><span>邀请码加入单位</span></label></div><div class="login-form unit-application-scroll"><div class="input-group"><label for="reg-name">姓名</label><input id="reg-name" type="text" placeholder="请输入真实姓名"></div><div class="input-group"><label for="reg-phone">手机号</label><input id="reg-phone" type="text" placeholder="请输入手机号"></div><div class="unit-application-passwords"><div class="input-group"><label for="reg-password">密码</label><input id="reg-password" type="password" placeholder="至少 6 位"></div><div class="input-group"><label for="reg-password-confirm">确认密码</label><input id="reg-password-confirm" type="password" placeholder="再次输入密码"></div></div><div data-unit-admin-fields><div class="input-group"><label for="reg-organization-name">村居/社区名称</label><input id="reg-organization-name" type="text" placeholder="例如：陆庄社区"></div><div class="input-group"><label for="reg-region">所在地区</label><input id="reg-region" type="text" placeholder="例如：晓店街道"></div></div><div class="input-group hidden" data-member-fields><label for="reg-invite-code">邀请码</label><input id="reg-invite-code" type="text" placeholder="扫描二维码后自动填入，或手工输入"></div><div id="regErrorContainer" class="login-error" style="visibility:hidden"><span id="regErrorText"></span></div><button id="openRemoteServerSettings" type="button" class="remote-server-settings-btn" hidden>设置账号服务器</button></div><div class="unit-application-actions"><button id="backToLoginBtn" type="button" class="btn btn-outline">返回登录</button><button id="doRegisterBtn" type="button" class="btn btn-primary"><span>提交申请</span></button></div>`;
    const updateKind = () => { const member = panel.querySelector('input[name="application-kind"]:checked')?.value === 'member'; panel.querySelector('[data-unit-admin-fields]').classList.toggle('hidden', member); panel.querySelector('[data-member-fields]').classList.toggle('hidden', !member); panel.querySelectorAll('.unit-application-kind-option').forEach((option) => option.classList.toggle('is-selected', option.querySelector('input').checked)); };
    panel.querySelectorAll('input[name="application-kind"]').forEach(input => input.addEventListener('change', updateKind));
    panel.querySelector('#backToLoginBtn').addEventListener('click', () => forceLoginPanel());
    panel.querySelector('#openRemoteServerSettings').addEventListener('click', openRemoteServerModal);
    bindButton('doRegisterBtn', submitRegister);
    const loginForm = document.querySelector('#panel-login .login-form');
    if (!document.getElementById('unitApplicationEntry') && loginForm) {
      const entry = document.createElement('div');
      entry.id = 'unitApplicationEntry';
      entry.style.cssText = 'margin-top:18px;padding-top:16px;border-top:1px solid var(--border-color);display:grid;grid-template-columns:1fr 1fr;gap:10px;';
      entry.innerHTML = '<button type="button" class="btn btn-outline" data-apply-kind="unit-admin">申请开通单位</button><button type="button" class="btn btn-outline" data-apply-kind="member">邀请码加入单位</button>';
      entry.querySelectorAll('[data-apply-kind]').forEach((button) => button.addEventListener('click', () => {
        document.querySelectorAll('#loginCard .auth-panel').forEach((item) => { item.classList.toggle('hidden', item !== panel); item.setAttribute('aria-hidden', String(item !== panel)); });
        const radio = panel.querySelector(`input[name="application-kind"][value="${button.dataset.applyKind}"]`);
        if (radio) { radio.checked = true; updateKind(); }
        panel.querySelector('#reg-name')?.focus();
      }));
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
      : `账号服务器：${config?.baseUrl || '尚未设置（将使用本机默认地址）'}`;
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
    if (!footer || !actions || !legacyRow || !refreshButton || !logoutButton) return;

    footer.classList.add('sidebar-footer-compact');
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'sidebar-secondary-actions';
    privacyButton?.remove();
    secondaryActions.append(refreshButton, logoutButton);
    actions.replaceChildren(secondaryActions);
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

  forceLoginPanel();
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
