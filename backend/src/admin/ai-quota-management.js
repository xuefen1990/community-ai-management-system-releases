'use strict';

(() => {
  const waitForApp = () => {
    const nav = document.querySelector('#nav');
    if (!nav || !document.querySelector('#content')) return setTimeout(waitForApp, 50);
    if (document.querySelector('[data-page="ai-quotas"]')) return;

    const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const tokens = value => Number(value || 0).toLocaleString('zh-CN');
    const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
    const api = async (path, options = {}) => {
      const token = localStorage.getItem('community-ai-admin-token') || '';
      const response = await fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '请求失败');
      return body;
    };
    const content = (title, subtitle, body) => {
      document.querySelector('#content').innerHTML = `<header class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div></header>${body}`;
    };
    const render = async (selectedId = '') => {
      try {
        const [defaults, data, usage] = await Promise.all([
          api('/admin/ai/default-quota'), api('/admin/ai/quotas'), api('/admin/ai/usage?days=30&pageSize=30'),
        ]);
        const selected = data.quotas.find(item => item.account.id === selectedId);
        let ledgerHtml = '';
        if (selected) {
          const ledger = await api(`/admin/ai/quotas/${encodeURIComponent(selectedId)}/ledger?pageSize=30`);
          ledgerHtml = `<section class="panel"><div class="toolbar"><div><h2>${esc(selected.account.phone)} · 额度流水</h2><p class="hint">每次分配、购买、消耗和退回均有记录。</p></div><button id="closeQuotaLedger" class="ghost small">返回账号列表</button></div><table><thead><tr><th>时间</th><th>类型</th><th>Token</th><th>余额</th><th>说明</th></tr></thead><tbody>${ledger.ledger.length ? ledger.ledger.map(row => `<tr><td>${date(row.createdAt)}</td><td>${esc(row.eventLabel)}</td><td>${row.deltaTokens > 0 ? '+' : row.deltaTokens < 0 ? '-' : ''}${tokens(Math.abs(row.deltaTokens || row.tokens))}</td><td>${tokens(row.balanceAfter)}</td><td>${esc(row.reason || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">暂无流水</td></tr>'}</tbody></table></section>`;
        }
        const rows = data.quotas.map(item => {
          const account = item.account;
          const quota = item.quota;
          const plan = account.planType === 'permanent' ? '永久授权' : `${account.planType === 'trial' ? '试用' : '限期'} · ${date(account.planExpiresAt)} 到期`;
          return `<tr><td>${esc(account.phone)}<br><span class="hint">${esc(account.name || '主账号')}</span></td><td>${esc(plan)}</td><td>${item.memberCount}</td><td>${tokens(quota.totalTokens)}</td><td>${tokens(quota.usedTokens)}</td><td><b>${tokens(quota.remainingTokens)}</b></td><td class="actions"><button class="ghost small" data-ledger="${esc(account.id)}">查看流水</button><button class="primary small" data-grant="${esc(account.id)}">增加额度</button></td></tr>`;
        }).join('');
        content('AI 额度管理', '每个主账号持有一份永久有效的额度；其子账号共用余额，使用记录保留实际操作人。',
          `<section class="panel"><div class="toolbar"><div><h2>默认额度</h2><p class="hint">新主账号注册时仅分配一次；修改设置不会重置旧账号余额。</p></div><div class="actions"><strong>${tokens(defaults.defaultQuotaTokens)} Token</strong><button id="editDefaultQuota" class="ghost small">修改默认额度</button></div></div></section>
          <section class="panel"><div class="toolbar"><h2>主账号额度</h2><span class="hint">共 ${data.quotas.length} 个主账号</span></div><table><thead><tr><th>手机号</th><th>使用期限</th><th>子账号</th><th>总额度</th><th>已使用</th><th>当前可用</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">暂无主账号</td></tr>'}</tbody></table></section>${ledgerHtml}
          <section class="panel"><div class="toolbar"><h2>最近在线 AI 消耗</h2><span class="hint">近 30 天 ${usage.pagination.total} 条</span></div><table><thead><tr><th>时间</th><th>操作账号</th><th>模型</th><th>消耗 Token</th><th>状态</th></tr></thead><tbody>${usage.usage.length ? usage.usage.map(row => `<tr><td>${date(row.createdAt)}</td><td>${esc(row.userName)}</td><td>${esc(row.model)}</td><td>${tokens(row.chargedTokens)}</td><td>${row.status === 'success' ? '<span class="badge on">成功</span>' : '<span class="badge off">失败</span>'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">暂无在线 AI 消耗记录</td></tr>'}</tbody></table></section>`);
        document.querySelector('#editDefaultQuota')?.addEventListener('click', async () => {
          const value = prompt('请输入新主账号默认 Token 额度（整数）：', String(defaults.defaultQuotaTokens));
          if (value === null) return;
          await api('/admin/ai/default-quota', { method: 'PUT', body: JSON.stringify({ defaultQuotaTokens: Number(value) }) });
          render(selectedId);
        });
        document.querySelector('#closeQuotaLedger')?.addEventListener('click', () => render());
        document.querySelectorAll('[data-ledger]').forEach(button => button.addEventListener('click', () => render(button.dataset.ledger)));
        document.querySelectorAll('[data-grant]').forEach(button => button.addEventListener('click', async () => {
          const value = prompt('请输入要增加的 Token 数量（整数）：');
          if (value === null) return;
          const reason = prompt('备注（可选）：', '平台管理员增加额度') || '';
          await api(`/admin/ai/quotas/${encodeURIComponent(button.dataset.grant)}/grants`, { method: 'POST', body: JSON.stringify({ tokens: Number(value), reason }) });
          render(selectedId);
        }));
      } catch (error) {
        content('加载失败', '请检查后端服务状态。', `<section class="panel"><p class="error">${esc(error.message)}</p><button id="retryAiQuota" class="primary">重试</button></section>`);
        document.querySelector('#retryAiQuota')?.addEventListener('click', () => render(selectedId));
      }
    };

    const entry = document.createElement('button');
    entry.className = 'nav';
    entry.dataset.page = 'ai-quotas';
    entry.innerHTML = '◉ <span>AI 额度</span>';
    nav.querySelector('[data-page="providers"]')?.before(entry);
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-page="ai-quotas"]');
      if (!button) return;
      event.stopImmediatePropagation();
      document.querySelectorAll('.nav').forEach(item => item.classList.toggle('active', item === button));
      render();
    }, true);
  };
  waitForApp();
})();
