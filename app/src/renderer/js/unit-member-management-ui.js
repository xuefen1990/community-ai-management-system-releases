'use strict';

(function installUnitMemberManagement() {
  const api = window.api;
  const labels = { view: '查看', create: '添加', update: '修改', delete: '删除', export: '导出', approve: '审核' };
  let catalog = null;
  let members = [];
  let status = null;
  let quota = null;
  let pendingApplications = [];
  let editorBaseline = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function close() { document.getElementById('unitMemberManagementPage')?.remove(); }
  function page() { return document.getElementById('unitMemberManagementPage'); }
  function message(error) { window.showToast?.(error?.message || '操作未完成，请稍后重试', 'error'); }

  function matrix(permissions = {}, aiAccessEnabled = false) {
    return `<div class="unit-member-permission-toolbar"><div><strong>业务权限</strong><small data-permission-count></small></div><div class="unit-member-permission-toolbar__actions"><button type="button" class="btn btn-outline" data-select-all-permissions>全选业务权限</button><button type="button" class="btn btn-outline" data-clear-all-permissions>清空业务权限</button></div></div><p class="unit-member-permission-hint">全选包含删除、导出和审核等操作；AI 使用权限单独设置。</p><div class="unit-member-matrix">${catalog.modules.map(module => `<fieldset data-module-row="${escapeHtml(module.id)}"><legend>${escapeHtml(module.label)}</legend><div class="unit-member-module-actions"><button type="button" data-select-module>全选</button><button type="button" data-clear-module>清空</button></div><div class="unit-member-module-checkboxes">${module.actions.map(action => `<label><input type="checkbox" data-module="${escapeHtml(module.id)}" data-action="${escapeHtml(action)}" ${permissions[module.id]?.includes(action) ? 'checked' : ''}>${labels[action] || escapeHtml(action)}</label>`).join('')}</div></fieldset>`).join('')}<label class="unit-member-ai-switch"><input type="checkbox" data-ai-access ${aiAccessEnabled ? 'checked' : ''}><span><strong>允许使用 AI</strong><small>使用主账号共用 AI 额度；关闭后无法使用 AI 助理、AI 公文等功能。</small></span></label></div>`;
  }

  function bindMatrix(root) {
    const boxes = selector => root.querySelectorAll(selector);
    const updateCount = () => {
      const total = boxes('[data-module][data-action]').length;
      const checked = boxes('[data-module][data-action]:checked').length;
      root.querySelector('[data-permission-count]').textContent = `已选 ${checked} / ${total} 项`;
    };
    const markCustom = () => {
      const preset = root.querySelector('[name="preset"]');
      if (preset) preset.value = 'custom';
    };
    const setChecked = (inputs, checked) => {
      inputs.forEach(input => { input.checked = checked; });
      markCustom();
      updateCount();
    };
    root.querySelector('[data-select-all-permissions]').addEventListener('click', () => setChecked(boxes('[data-module][data-action]'), true));
    root.querySelector('[data-clear-all-permissions]').addEventListener('click', () => setChecked(boxes('[data-module][data-action]'), false));
    root.querySelectorAll('[data-module-row]').forEach(row => row.addEventListener('change', event => {
      const input = event.target;
      if (!input.matches('[data-action]')) return;
      const view = row.querySelector('[data-action="view"]');
      if (input.dataset.action === 'view' && !input.checked) row.querySelectorAll('[data-action]').forEach(box => { box.checked = false; });
      else if (input.dataset.action !== 'view' && input.checked && view) view.checked = true;
      markCustom();
      updateCount();
    }));
    root.querySelectorAll('[data-module-row]').forEach(row => {
      row.querySelector('[data-select-module]').addEventListener('click', () => setChecked(row.querySelectorAll('[data-action]'), true));
      row.querySelector('[data-clear-module]').addEventListener('click', () => setChecked(row.querySelectorAll('[data-action]'), false));
    });
    updateCount();
    return updateCount;
  }

  function collect(root) {
    const permissions = {};
    root.querySelectorAll('[data-module][data-action]:checked').forEach(input => {
      (permissions[input.dataset.module] ||= []).push(input.dataset.action);
    });
    return { permissions, aiAccessEnabled: Boolean(root.querySelector('[data-ai-access]')?.checked) };
  }

  function editorSnapshot(root) {
    return JSON.stringify({
      name: root.querySelector('[name="name"]')?.value || '',
      phone: root.querySelector('[name="phone"]')?.value || '',
      preset: root.querySelector('[name="preset"]')?.value || '',
      ...collect(root),
    });
  }

  function currentPreset(member) {
    if (!member) return 'custom';
    const selected = collectPermissions(member.permissions || {});
    return Object.keys(catalog.presets).find(key => {
      const preset = catalog.presets[key];
      return Boolean(preset.aiAccessEnabled) === Boolean(member.aiAccessEnabled)
        && collectPermissions(preset.permissions || {}) === selected;
    }) || 'custom';
  }

  function collectPermissions(permissions) {
    return JSON.stringify(Object.keys(permissions).sort().map(module => [module, [...permissions[module]].sort()]));
  }

  function leaveEditor(force = false) {
    const root = page();
    const editor = root?.querySelector('[data-member-editor]');
    if (!editor || editor.hidden) return true;
    if (!force && editorBaseline !== editorSnapshot(editor)
      && !window.confirm('有未保存的更改，确定返回成员列表？')) return false;
    editor.hidden = true;
    editor.textContent = '';
    editorBaseline = null;
    root.classList.remove('is-editing');
    root.querySelector('[data-close-page]').textContent = root.dataset.listCloseLabel;
    root.querySelector('[data-member-search]')?.focus();
    return true;
  }

  function showCredential(user, initialPassword) {
    const notice = page()?.querySelector('[data-credential-notice]');
    if (!notice) return;
    notice.hidden = false;
    notice.innerHTML = `<strong>${escapeHtml(user.name)} 的一次性初始密码</strong><p>账号：${escapeHtml(user.phone)}　密码：<code>${escapeHtml(initialPassword)}</code></p><small>只在这里显示一次。请通过可信方式告知本人；首次登录必须修改密码。</small><button type="button" class="btn btn-outline" data-dismiss-credential>我已记录，关闭</button>`;
    notice.querySelector('[data-dismiss-credential]').addEventListener('click', () => { notice.textContent = ''; notice.hidden = true; });
    notice.scrollIntoView?.({ block: 'nearest' });
  }

  async function refreshMembers() {
    const result = await api.listUnitMembers();
    members = result.members || [];
    const count = page()?.querySelector('[data-member-count]');
    if (count) count.textContent = `${members.length} 人`;
    renderMembers();
  }

  function renderMembers() {
    const target = page()?.querySelector('[data-member-list]');
    if (!target) return;
    const keyword = page().querySelector('[data-member-search]')?.value.trim().toLowerCase() || '';
    const shown = members.filter(member => !keyword || `${member.name} ${member.phone}`.toLowerCase().includes(keyword));
    target.innerHTML = shown.length ? shown.map(member => `<article class="unit-member-row" data-member-id="${escapeHtml(member.id)}"><div><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.phone)}</span><small>${member.isActive ? '正常使用' : '已停用'} · ${member.aiAccessEnabled ? '可用 AI' : 'AI 已关闭'}${member.mustChangePassword ? ' · 待修改初始密码' : ''} · 近 30 天用量 ${quota?.billingUnit==='credits' ? `${Number(member.aiCredits30d || 0).toLocaleString('zh-CN',{maximumFractionDigits:4})} 积分` : `${Number(member.aiTokens30d || 0).toLocaleString('zh-CN')} Token`}</small></div><div class="unit-member-row__actions"><button type="button" class="btn btn-outline" data-edit-member="${escapeHtml(member.id)}">设置权限</button><button type="button" class="btn btn-outline" data-reset-member="${escapeHtml(member.id)}">重置密码</button><button type="button" class="btn btn-outline" data-toggle-member="${escapeHtml(member.id)}">${member.isActive ? '停用' : '恢复'}</button></div></article>`).join('') : keyword
      ? '<div class="unit-member-empty"><strong>没有找到匹配的成员</strong><p>试试其他姓名或手机号。</p></div>'
      : '<div class="unit-member-empty"><strong>还没有成员</strong><p>点击“新增成员”，为工作人员开通子账号。</p><button type="button" class="btn btn-primary" data-add-first-member>新增第一位成员</button></div>';
    target.querySelector('[data-add-first-member]')?.addEventListener('click', () => openEditor());
    target.querySelectorAll('[data-edit-member]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.editMember)));
    target.querySelectorAll('[data-reset-member]').forEach(button => button.addEventListener('click', async () => {
      const member = members.find(item => item.id === button.dataset.resetMember);
      if (!member || !window.confirm(`确认重置 ${member.name} 的登录密码？该成员现有登录会立即失效。`)) return;
      try { const result = await api.resetUnitMemberPassword({ memberId: member.id }); showCredential(result.user, result.initialPassword); await refreshMembers(); }
      catch (error) { message(error); }
    }));
    target.querySelectorAll('[data-toggle-member]').forEach(button => button.addEventListener('click', async () => {
      const member = members.find(item => item.id === button.dataset.toggleMember);
      if (!member) return;
      try { await api.updateUnitMemberStatus({ memberId: member.id, isActive: !member.isActive }); await refreshMembers(); }
      catch (error) { message(error); }
    }));
  }

  function renderPending() {
    const target = page()?.querySelector('[data-pending-applications]');
    if (!target) return;
    target.hidden = pendingApplications.length === 0;
    target.innerHTML = pendingApplications.length ? `<h3>历史待审核申请（${pendingApplications.length}）</h3><p>旧邀请码流程留下的申请。通过后先不给业务权限，可在成员列表中授权。</p>${pendingApplications.map(item => `<article><strong>${escapeHtml(item.applicant?.name || '未命名')}</strong><span>${escapeHtml(item.applicant?.phone || '')}</span><button type="button" class="btn btn-outline" data-review-id="${escapeHtml(item.id)}" data-review-approve="true">通过（待授权）</button><button type="button" class="btn btn-outline" data-review-id="${escapeHtml(item.id)}" data-review-approve="false">驳回</button></article>`).join('')}` : '';
    target.querySelectorAll('[data-review-id]').forEach(button => button.addEventListener('click', async () => {
      try {
        await api.reviewUnitMemberApplication({ applicationId: button.dataset.reviewId, approve: button.dataset.reviewApprove === 'true', permissions: {} });
        pendingApplications = pendingApplications.filter(item => item.id !== button.dataset.reviewId);
        renderPending();
        await refreshMembers();
      } catch (error) { message(error); }
    }));
  }

  function openEditor(memberId = null, prefill = null) {
    const member = members.find(item => item.id === memberId) || null;
    const root = page();
    const target = root?.querySelector('[data-member-editor]');
    if (!target) return;
    target.hidden = false;
    root.classList.add('is-editing');
    root.querySelector('[data-close-page]').textContent = '返回成员列表';
    const selectedPreset = currentPreset(member);
    const presetOptions = Object.entries(catalog.presets).map(([key, value]) => `<option value="${escapeHtml(key)}"${key === selectedPreset ? ' selected' : ''}>${escapeHtml(value.label)}</option>`).join('');
    target.innerHTML = `<div class="unit-member-editor__heading"><div><small>${member ? '成员权限' : '开通子账号'}</small><h3>${member ? `编辑 ${escapeHtml(member.name)}` : '新增成员'}</h3><p>${member ? '调整该成员可使用的业务功能。' : '填写成员信息，选择岗位预设后可按需调整权限。'}</p></div></div><section class="unit-member-editor__section"><h4>基本信息</h4>${member
      ? `<div class="unit-member-fields unit-member-fields--readonly"><div><small>姓名</small><strong>${escapeHtml(member.name)}</strong></div><div><small>手机号</small><strong>${escapeHtml(member.phone)}</strong></div><label>岗位预设<select name="preset">${presetOptions}</select></label></div><p class="unit-member-account-status">账号状态：${member.isActive ? '正常使用' : '已停用'}</p>`
      : `<div class="unit-member-fields"><label>姓名<input name="name" autocomplete="off" maxlength="50" placeholder="工作人员姓名" required></label><label>手机号<input name="phone" inputmode="tel" autocomplete="off" placeholder="作为登录账号" required></label><label>岗位预设<select name="preset">${presetOptions}</select></label></div>`}</section><section class="unit-member-editor__section"><h4>功能与权限</h4>${matrix(member?.permissions || catalog.presets.custom.permissions, member?.aiAccessEnabled || false)}</section><div class="unit-member-editor__footer"><p data-editor-error role="alert" hidden></p><div><button type="button" class="btn btn-outline" data-cancel-editor>取消</button><button type="button" class="btn btn-primary" data-save-editor>${member ? '保存权限' : '开通成员'}</button></div></div>`;
    if (!member && prefill) {
      target.querySelector('[name="name"]').value = prefill.name || '';
      target.querySelector('[name="phone"]').value = prefill.phone || '';
    }
    const updatePermissionCount = bindMatrix(target);
    target.querySelector('[data-cancel-editor]').addEventListener('click', () => leaveEditor());
    target.querySelector('[name="preset"]')?.addEventListener('change', event => {
      const preset = catalog.presets[event.target.value];
      target.querySelectorAll('[data-module][data-action]').forEach(input => { input.checked = Boolean(preset.permissions[input.dataset.module]?.includes(input.dataset.action)); });
      target.querySelector('[data-ai-access]').checked = Boolean(preset.aiAccessEnabled);
      updatePermissionCount();
    });
    target.querySelector('[data-save-editor]').addEventListener('click', async event => {
      const button = event.currentTarget;
      const inlineError = target.querySelector('[data-editor-error]');
      inlineError.hidden = true;
      inlineError.textContent = '';
      const { permissions, aiAccessEnabled } = collect(target);
      button.disabled = true;
      try {
        let credential;
        if (member) {
          await api.updateUnitMemberPermissions({ memberId: member.id, permissions, aiAccessEnabled });
          window.showToast?.('权限已保存，成员重新登录后界面同步更新', 'success');
        } else {
          const result = await api.createUnitMember({ name: target.querySelector('[name="name"]').value, phone: target.querySelector('[name="phone"]').value, preset: target.querySelector('[name="preset"]').value, permissions, aiAccessEnabled });
          credential = result;
        }
        leaveEditor(true);
        try { await refreshMembers(); } catch (refreshError) { message(refreshError); }
        if (credential) showCredential(credential.user, credential.initialPassword);
      } catch (error) {
        inlineError.textContent = error?.message || '保存失败，请检查填写内容后重试';
        inlineError.hidden = false;
        message(error);
      }
      finally { button.disabled = false; }
    });
    editorBaseline = editorSnapshot(target);
    root.querySelector('.unit-member-page__header')?.scrollIntoView?.({ block: 'start' });
  }

  async function open(currentStatus, { mount = document.body, prefill = null } = {}) {
    close();
    status = currentStatus;
    const root = document.createElement('section');
    root.id = 'unitMemberManagementPage';
    root.className = `unit-member-page${mount === document.body ? '' : ' unit-member-page--embedded'}`;
    root.dataset.listCloseLabel = mount === document.body ? '返回工作台' : '收起成员管理';
    root.innerHTML = `<div class="unit-member-page__panel"><header class="unit-member-page__header"><div><small>主账号管理</small><h2>成员与权限</h2><p>${escapeHtml(status?.account?.organization?.name || status?.account?.phone || '主账号')} · 软件授权与所有子账号保持一致</p></div><button type="button" class="btn btn-outline" data-close-page>${mount === document.body ? '返回工作台' : '收起成员管理'}</button></header><div class="unit-member-page__summary"><div><small>子账号</small><strong data-member-count>—</strong></div><div><small>软件授权</small><strong>${escapeHtml(status?.entitlement?.expiresAt?.slice(0, 10) || '永久 / 以主账号为准')}</strong></div><div><small>主账号可用 AI 额度</small><strong data-quota-remaining>读取中…</strong></div></div><div class="unit-member-credential" data-credential-notice hidden></div><div class="unit-member-page__content"><main><div class="unit-member-page__toolbar"><input data-member-search type="search" placeholder="搜索姓名或手机号"><button type="button" class="btn btn-primary" data-add-member>＋ 新增成员</button></div><div data-member-list class="unit-member-list">正在加载…</div><section class="unit-member-pending" data-pending-applications hidden></section></main><aside class="unit-member-editor" data-member-editor hidden></aside></div></div>`;
    mount.appendChild(root);
    root.querySelector('[data-close-page]').addEventListener('click', () => { if (root.classList.contains('is-editing')) leaveEditor(); else close(); });
    root.querySelector('[data-add-member]').addEventListener('click', () => openEditor());
    root.querySelector('[data-member-search]').addEventListener('input', renderMembers);
    try {
      const [catalogResult, memberResult, quotaResult, applicationsResult] = await Promise.all([api.getUnitPermissionCatalog(), api.listUnitMembers(), api.getAiQuota?.().catch(() => null), api.listUnitMemberApplications?.().catch(() => ({ applications: [] }))]);
      catalog = catalogResult;
      members = memberResult.members || [];
      pendingApplications = (applicationsResult?.applications || []).filter(item => item.status === 'pending');
      quota = quotaResult?.quota || null;
      root.querySelector('[data-member-count]').textContent = `${members.length} 人`;
      root.querySelector('[data-quota-remaining]').textContent = quota ? quota.billingUnit === 'credits' ? `${Number(quota.remainingCredits || 0).toLocaleString('zh-CN',{maximumFractionDigits:4})} 积分` : `${Number(quota.remainingTokens || 0).toLocaleString('zh-CN')} Token` : '请在 AI 设置查看';
      renderMembers();
      renderPending();
      if (prefill) openEditor(members.find(member => member.phone === prefill.phone)?.id || null, prefill);
    } catch (error) { root.querySelector('[data-member-list]').textContent = error?.message || '成员信息加载失败'; }
  }

  window.unitMemberManagement = { open, close };
})();
