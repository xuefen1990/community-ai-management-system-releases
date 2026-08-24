'use strict';

(() => {
  const waitForApp = () => {
    if (!document.querySelector('#nav') || !document.querySelector('#content')) return setTimeout(waitForApp, 50);
    if (document.querySelector('[data-page="unit-applications"]')) return;
    const nav = document.querySelector('#nav');
    const entry = document.createElement('button');
    entry.className = 'nav';
    entry.dataset.page = 'unit-applications';
    entry.innerHTML = '⌂ <span>单位审核</span>';
    const usersEntry = nav.querySelector('[data-page="users"]');
    usersEntry?.before(entry);

    const apiRequest = async (path, options = {}) => {
      const token = localStorage.getItem('community-ai-admin-token') || '';
      const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '请求失败');
      return body;
    };
    const setContent = (title, subtitle, body) => { document.querySelector('#content').innerHTML = `<header class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div></header>${body}`; };
    const renderApplications = async () => {
      try {
        const data = await apiRequest('/auth/unit-admin-applications?status=pending');
        const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
        setContent('单位管理员审核', '审核村居单位管理员申请，并设置该单位的有效期。', `<section class="panel"><div class="toolbar"><span class="hint">待审核 ${data.applications.length} 项</span><button id="refreshUnitApplications" class="ghost small">刷新</button></div><table><thead><tr><th>申请单位</th><th>地区</th><th>申请人</th><th>手机号</th><th>提交时间</th><th>操作</th></tr></thead><tbody>${data.applications.length ? data.applications.map(item => `<tr><td>${esc(item.organizationName)}</td><td>${esc(item.region)}</td><td>${esc(item.applicant?.name)}</td><td>${esc(item.applicant?.phone)}</td><td>${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</td><td class="actions"><button class="primary small" data-approve-unit="${item.id}">通过</button><button class="danger small" data-reject-unit="${item.id}">驳回</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">暂无待审核单位申请</td></tr>'}</tbody></table></section>`);
        document.querySelector('#refreshUnitApplications').onclick = renderApplications;
        document.querySelectorAll('[data-approve-unit]').forEach(button => button.addEventListener('click', () => review(button.dataset.approveUnit, true)));
        document.querySelectorAll('[data-reject-unit]').forEach(button => button.addEventListener('click', () => review(button.dataset.rejectUnit, false)));
      } catch (error) { setContent('加载失败', '请检查后端服务状态。', `<section class="panel"><p class="error">${error.message}</p></section>`); }
    };
    const review = async (applicationId, approve) => {
      if (!approve) {
        if (!confirm('确认驳回该单位管理员申请？')) return;
        await apiRequest(`/auth/unit-admin-applications/${applicationId}/review`, { method: 'POST', body: JSON.stringify({ approve: false }) });
        return renderApplications();
      }
      const choice = prompt('授权类型：输入“体验”“正式”或“永久”（体验版默认 30 天）：', '体验');
      if (!choice) return;
      const normalized = choice.trim();
      let body = { approve: true, planType: normalized === '永久' ? 'permanent' : normalized === '正式' ? 'expires' : 'trial' };
      if (body.planType === 'expires') {
        const raw = prompt('请输入正式授权结束日期（YYYY-MM-DD）：');
        if (!raw) return;
        const end = new Date(`${raw}T23:59:59`);
        if (Number.isNaN(end.getTime()) || end <= new Date()) return alert('请输入未来的有效期结束日期');
        body.planExpiresAt = end.toISOString();
      }
      await apiRequest(`/auth/unit-admin-applications/${applicationId}/review`, { method: 'POST', body: JSON.stringify(body) });
      renderApplications();
    };
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-page="unit-applications"]');
      if (!button) return;
      event.stopImmediatePropagation();
      document.querySelectorAll('.nav').forEach(item => item.classList.toggle('active', item === button));
      renderApplications();
    }, true);
  };
  waitForApp();
})();
