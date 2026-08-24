(() => {
  'use strict';

  const MEMBER_STAGES = new Set(['正式党员', '党员', '预备党员']);
  const DEVELOPMENT_STAGES = new Set(['积极分子', '入党积极分子', '发展对象']);
  const text = (value) => String(value ?? '').trim();

  function stageOf(record) {
    return text(record?.stage || record?.developmentStage || record?.development_stage || record?.partyStage || record?.party_stage);
  }

  function getStageGroup(record, group, assumeMember = false) {
    const stage = stageOf(record);
    if (group === 'member') return MEMBER_STAGES.has(stage) || (!stage && assumeMember);
    return DEVELOPMENT_STAGES.has(stage);
  }

  function recordKey(record, fallback) {
    const idCard = text(record?.idCard || record?.id_card || record?.identityCard || record?.identity_card).toUpperCase();
    if (idCard) return `id-card:${idCard}`;
    const personId = text(record?.personId || record?.person_id || record?.personnelId || record?.personnel_id);
    if (personId) return `person:${personId}`;
    const id = text(record?.id);
    return id ? `record:${id}` : fallback;
  }

  function uniqueRecords(records) {
    const seen = new Set();
    return records.filter(({ record, key }) => {
      const resolvedKey = key || recordKey(record, `fallback:${seen.size}`);
      if (seen.has(resolvedKey)) return false;
      seen.add(resolvedKey);
      return true;
    }).map(({ record }) => record);
  }

  function getStageCardStats(database = {}) {
    const partyMembers = Array.isArray(database.partyMembers) ? database.partyMembers : [];
    const partyActivists = Array.isArray(database.partyActivists) ? database.partyActivists : [];
    const memberRecords = uniqueRecords([
      ...partyMembers.filter((record) => getStageGroup(record, 'member', true)).map((record, index) => ({ record, key: recordKey(record, `member:${index}`) })),
      ...partyActivists.filter((record) => getStageGroup(record, 'member')).map((record, index) => ({ record, key: recordKey(record, `activist-member:${index}`) })),
    ]);
    const developmentRecords = uniqueRecords(
      partyActivists.filter((record) => getStageGroup(record, 'development')).map((record, index) => ({ record, key: recordKey(record, `activist-development:${index}`) })),
    );
    return {
      memberAndProbationary: memberRecords.length,
      developmentAndActivist: developmentRecords.length,
      memberRecords,
      developmentRecords,
    };
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function recordName(record) {
    return text(record?.name || record?.person_name || record?.full_name || record?.member_name) || '未填写姓名';
  }

  function recordIdCard(record) {
    return text(record?.idCard || record?.id_card || record?.identityCard || record?.identity_card) || '-';
  }

  function recordBranch(record) {
    return text(record?.branch || record?.branch_name || record?.party_branch || record?.partyBranch) || '-';
  }

  function updateCard(card, title, description, count) {
    if (!card) return;
    card.querySelector('.stat-title').textContent = title;
    card.querySelector('.stat-desc').textContent = description;
    card.querySelector('.stat-value').textContent = String(count);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${title}，共 ${count} 人，点击查看名单`);
    card.style.cursor = 'pointer';
  }

  function getDatabase() {
    try {
      return window.dbState || {};
    } catch {
      return {};
    }
  }

  function removeFilterPanel() {
    document.getElementById('partyStageCardFilterPanel')?.remove();
    document.querySelector('#party-list-view .main-table-card')?.style.removeProperty('display');
    document.querySelector('#party-dev-view #partyDevListContainer')?.style.removeProperty('display');
    document.querySelector('#party-dev-view #partyDevListPagination')?.style.removeProperty('display');
  }

  function clearFilter() {
    window.partyStageCardFilter = '';
    removeFilterPanel();
    if (typeof window.renderPartyMemberList === 'function') window.renderPartyMemberList();
    if (typeof window.renderPartyDevList === 'function') window.renderPartyDevList();
  }

  function renderFilterPanel(group, records) {
    const view = document.getElementById(group === 'member' ? 'party-list-view' : 'party-dev-view');
    if (!view) return;
    removeFilterPanel();
    const title = group === 'member' ? '正式党员与预备党员名单' : '发展对象与积极分子名单';
    const source = group === 'member'
      ? view.querySelector('.main-table-card')
      : view.querySelector('#partyDevListContainer');
    const pagination = group === 'development' ? view.querySelector('#partyDevListPagination') : null;
    if (source) source.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    const panel = document.createElement('section');
    panel.id = 'partyStageCardFilterPanel';
    panel.className = 'main-table-card';
    panel.style.marginTop = '16px';
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border-color);"><div><strong style="font-size:15px;color:var(--text-main);">${title}</strong><span style="margin-left:8px;color:var(--text-secondary);font-size:12px;">共 ${records.length} 人</span></div><button type="button" class="btn btn-outline" id="clearPartyStageCardFilter">显示全部</button></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>姓名</th><th>当前阶段</th><th>所属党支部</th><th>身份证号</th></tr></thead><tbody>${records.length ? records.map((record) => `<tr><td>${escapeHtml(recordName(record))}</td><td>${escapeHtml(stageOf(record) || '正式党员')}</td><td>${escapeHtml(recordBranch(record))}</td><td>${escapeHtml(recordIdCard(record))}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:28px;">暂无符合条件的人员</td></tr>'}</tbody></table></div>`;
    view.appendChild(panel);
    panel.querySelector('#clearPartyStageCardFilter').addEventListener('click', clearFilter);
  }

  function openFilter(group) {
    const stats = getStageCardStats(getDatabase());
    window.partyStageCardFilter = group;
    if (typeof window.switchPartySubTab === 'function') window.switchPartySubTab(group === 'member' ? 'party-list' : 'party-dev');
    window.setTimeout(() => renderFilterPanel(group, group === 'member' ? stats.memberRecords : stats.developmentRecords), 0);
  }

  function refreshCards() {
    const stats = getStageCardStats(getDatabase());
    const officialCard = document.getElementById('statPartyOfficialCount')?.closest('.stat-card');
    const developmentCard = document.getElementById('statPartyDevCount')?.closest('.stat-card');
    updateCard(officialCard, '正式党员与预备党员总数', '正式党员与预备党员', stats.memberAndProbationary);
    updateCard(developmentCard, '发展对象与积极分子', '党员发展培养对象', stats.developmentAndActivist);
    if (officialCard && officialCard.dataset.partyStageCardReady !== 'true') {
      officialCard.dataset.partyStageCardReady = 'true';
      officialCard.addEventListener('click', () => openFilter('member'));
      officialCard.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilter('member'); } });
    }
    if (developmentCard && developmentCard.dataset.partyStageCardReady !== 'true') {
      developmentCard.dataset.partyStageCardReady = 'true';
      developmentCard.addEventListener('click', () => openFilter('development'));
      developmentCard.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilter('development'); } });
    }
  }

  function wrapLegacyOverviewRenderer() {
    const legacyRenderer = window.renderPartyOverviewStats;
    if (typeof legacyRenderer !== 'function' || legacyRenderer.__partyStageCardWrapped) return;
    const wrappedRenderer = function (...args) {
      const result = legacyRenderer.apply(this, args);
      window.setTimeout(refreshCards, 0);
      return result;
    };
    wrappedRenderer.__partyStageCardWrapped = true;
    window.renderPartyOverviewStats = wrappedRenderer;
  }

  function install() {
    wrapLegacyOverviewRenderer();
    refreshCards();
    document.addEventListener('click', (event) => {
      const subTab = event.target.closest?.('.sub-tab-btn[data-subtab]');
      if (subTab) window.setTimeout(clearFilter, 0);
      if (event.target.closest?.('#partyActionMenu, #party-dev-view button, #party-list-view button')) window.setTimeout(refreshCards, 0);
    }, true);
  }

  const api = { getStageCardStats, getStageGroup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.PartyStageStatCards = api;
    window.clearPartyStageCardFilter = clearFilter;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})();
