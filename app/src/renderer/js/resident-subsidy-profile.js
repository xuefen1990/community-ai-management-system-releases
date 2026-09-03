(() => {
  'use strict';

  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const personName = (person) => text(person?.name || person?.person_name || person?.resident_name);
  const personGroup = (person) => text(person?.village_group || person?.villageGroup || person?.group || person?.group_name);
  const personIdCard = (person) => text(person?.id_card || person?.idCard || person?.identity_card || person?.id_number);
  const personPhone = (person) => text(person?.phone || person?.mobile || person?.mobile_phone);
  const money = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const personnel = () => { try { return Array.isArray(window.dbState?.personnel) ? window.dbState.personnel : []; } catch { return []; } };
  const close = () => document.getElementById('resident-subsidy-profile-overlay')?.remove();

  function profileContent(person, tab) {
    const bankAccounts = Array.isArray(person.bankAccounts) ? person.bankAccounts : (text(person.bank_card || person.bank_account || person.bankCard) ? [{ cardNumber: person.bank_card || person.bank_account || person.bankCard, isDefault: true }] : []);
    const histories = Array.isArray(person.farmlandSubsidyHistory) ? person.farmlandSubsidyHistory : [];
    const disbursementHistories = Array.isArray(person.disbursementHistory) ? person.disbursementHistory : [];
    const sources = Array.isArray(person.importSources) ? person.importSources : [];
    if (tab === 'bank') return bankAccounts.length ? `<table class="cf-table"><thead><tr><th>银行卡号</th><th>开户行</th><th>默认卡</th><th>来源</th></tr></thead><tbody>${bankAccounts.map((account) => `<tr><td>${escapeHtml(account.cardNumber || '—')}</td><td>${escapeHtml(account.bankName || person.bank_name || person.bankName || '—')}</td><td>${account.isDefault ? '是' : '否'}</td><td>${escapeHtml(account.source || '居民档案')}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未登记银行卡资料。</div>';
    if (tab === 'subsidy') return histories.length ? `<table class="cf-table"><thead><tr><th>年度</th><th>村民组</th><th>应补面积</th><th>标准</th><th>补贴金额</th><th>导入时间</th></tr></thead><tbody>${histories.map((item) => `<tr><td>${escapeHtml(item.ledgerYear || '—')}</td><td>${escapeHtml(item.groupName || '—')}</td><td>${escapeHtml(item.eligibleArea || 0)} 亩</td><td>${money(item.standardCents)}</td><td>${money(item.amountCents)}</td><td>${escapeHtml(text(item.importedAt).replace('T', ' ').slice(0, 16) || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未导入地力补贴记录。</div>';
    if (tab === 'funds') return disbursementHistories.length ? `<table class="cf-table"><thead><tr><th>类别</th><th>期间</th><th>金额</th><th>状态</th><th>来源批次</th></tr></thead><tbody>${disbursementHistories.map((item) => `<tr><td>${escapeHtml(item.categoryName || '其他发放')}</td><td>${escapeHtml(item.period || '—')}</td><td>${money(item.amountCents)}</td><td>${escapeHtml(item.paymentStatus === 'paid' ? '已发放' : '已登记')}</td><td>${escapeHtml(item.batchId || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未登记工资、承包费、杂工或其他资金发放记录。</div>';
    if (tab === 'sources') return sources.length ? `<table class="cf-table"><thead><tr><th>资料来源</th><th>补贴年度</th><th>关联记录</th><th>导入时间</th></tr></thead><tbody>${sources.map((item) => `<tr><td>${escapeHtml(item.sourceType === 'farmland_subsidy_import' ? '地力补贴批量导入' : item.sourceType || '居民档案')}</td><td>${escapeHtml(item.ledgerYear || '—')}</td><td>${escapeHtml(item.recordId || '—')}</td><td>${escapeHtml(text(item.importedAt).replace('T', ' ').slice(0, 16) || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="cf-empty">暂未记录资料来源。</div>';
    return `<div class="cf-record-summary"><strong>${escapeHtml(personName(person) || '未填写姓名')}</strong><br>身份证号：${escapeHtml(personIdCard(person) || '未填写')}<br>村民组：${escapeHtml(personGroup(person) || '未填写')}<br>联系电话：${escapeHtml(personPhone(person) || '未填写')}</div>`;
  }

  function showProfile(person, activeTab = 'basic') {
    const overlay = document.getElementById('resident-subsidy-profile-overlay'); if (!overlay || !person) return;
    const tabs = [['basic', '基本信息'], ['bank', '联系与银行卡'], ['subsidy', '地力补贴记录'], ['funds', '资金记录'], ['sources', '来源与更正记录']];
    overlay.querySelector('.resident-profile-tabs').innerHTML = tabs.map(([key, label]) => `<button data-resident-profile-tab="${key}" class="${key === activeTab ? 'active' : ''}">${label}</button>`).join('');
    overlay.querySelector('.resident-profile-body').innerHTML = profileContent(person, activeTab);
    overlay.querySelectorAll('[data-resident-profile-tab]').forEach((button) => button.addEventListener('click', () => showProfile(person, button.dataset.residentProfileTab)));
  }

  function openProfileDialog() {
    close(); const overlay = document.createElement('div'); overlay.id = 'resident-subsidy-profile-overlay'; overlay.className = 'cf-modal-overlay';
    overlay.innerHTML = `<div class="cf-modal"><div class="cf-modal-head"><h3>居民档案资料</h3><button class="cf-close" data-resident-profile-action="close">×</button></div><div class="cf-modal-body"><div class="cf-subsidy-search"><input id="resident-profile-query" placeholder="输入姓名、身份证号或村民组"><button class="btn btn-primary" data-resident-profile-action="search">查询居民</button></div><div id="resident-profile-results" class="cf-row-actions"></div><div class="resident-profile-tabs"></div><div class="resident-profile-body"><div class="cf-empty">请先查询并选择一名居民。</div></div></div><div class="cf-modal-foot"><button class="btn btn-outline" data-resident-profile-action="close">关闭</button></div></div>`;
    document.body.appendChild(overlay);
    const search = () => {
      const needle = text(document.getElementById('resident-profile-query')?.value).toLowerCase(); const matches = personnel().filter((person) => !needle || [personName(person), personIdCard(person), personGroup(person)].some((value) => text(value).toLowerCase().includes(needle))).slice(0, 20); const result = overlay.querySelector('#resident-profile-results');
      result.innerHTML = matches.length ? matches.map((person) => `<button class="btn btn-outline" data-resident-profile-person="${escapeHtml(person.id)}">${escapeHtml(personName(person))} · ${escapeHtml(personGroup(person) || '未分组')}</button>`).join('') : '<span class="text-secondary">未找到居民档案。</span>';
      result.querySelectorAll('[data-resident-profile-person]').forEach((button) => button.addEventListener('click', () => showProfile(personnel().find((person) => text(person.id) === text(button.dataset.residentProfilePerson)))));
    };
    overlay.querySelectorAll('[data-resident-profile-action="close"]').forEach((button) => button.addEventListener('click', close)); overlay.querySelector('[data-resident-profile-action="search"]').addEventListener('click', search); overlay.querySelector('#resident-profile-query').addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); }); overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  function ensureEntry() {
    const tab = document.getElementById('tab-personnel'); if (!tab || tab.querySelector('[data-resident-subsidy-profile-entry]')) return;
    const anchor = tab.querySelector('h2, h3'); if (!anchor) return; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.dataset.residentSubsidyProfileEntry = 'true'; button.textContent = '居民资料标签'; button.addEventListener('click', openProfileDialog); anchor.parentElement?.appendChild(button);
  }

  window.openResidentSubsidyProfile = openProfileDialog;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureEntry, { once: true }); else ensureEntry();
  new MutationObserver(ensureEntry).observe(document.documentElement, { childList: true, subtree: true });
})();
