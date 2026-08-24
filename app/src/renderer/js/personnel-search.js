(() => {
  'use strict';

  const SEARCH_FIELDS = [
    'name', 'person_name', 'full_name', 'display_name',
    'idCard', 'id_card', 'identity_card', 'id_number',
    'household_id', 'householdId',
    'phone', 'mobile', 'mobile_phone',
  ];
  const FILTER_IDS = ['filterGroup', 'filterIdentity', 'filterGender', 'filterRelation', 'filterAge', 'filterDataAudit', 'filterRegistryStatus'];

  const text = (value) => String(value ?? '').trim().toLocaleLowerCase('zh-CN');
  const valueOf = (person, fields) => fields.map((field) => person?.[field]).find((value) => text(value)) ?? '';
  const selected = (id) => document.getElementById(id)?.value || '';

  function getPersonnel() {
    try {
      return Array.isArray(dbState?.personnel) ? dbState.personnel : [];
    } catch {
      return [];
    }
  }

  function resetPage() {
    try {
      personnelCurrentPage = 1;
    } catch {
      window.personnelCurrentPage = 1;
    }
  }

  function renderPersonnelResults(results) {
    try {
      if (typeof renderPersonnel === 'function') {
        renderPersonnel(results);
        return true;
      }
    } catch (error) {
      console.error('人员筛选结果渲染失败：', error);
    }
    return false;
  }

  function getBirthDate(person) {
    const direct = text(valueOf(person, ['birth_date', 'birthDate', 'birthday']));
    const idCard = text(valueOf(person, ['idCard', 'id_card', 'identity_card', 'id_number'])).toUpperCase();
    const raw = direct || (/^\d{17}[\dX]$/u.test(idCard) ? `${idCard.slice(6, 10)}-${idCard.slice(10, 12)}-${idCard.slice(12, 14)}` : '');
    const date = raw ? new Date(`${raw.slice(0, 10)}T00:00:00`) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function getAge(person, now = new Date()) {
    const birth = getBirthDate(person);
    if (!birth) return null;
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
    return age;
  }

  function hasValidIdCard(person) {
    const idCard = text(valueOf(person, ['idCard', 'id_card', 'identity_card', 'id_number'])).toUpperCase();
    return /^\d{17}[\dX]$/u.test(idCard);
  }

  function hasIdentity(person, identity) {
    if (!identity) return true;
    const tags = Array.isArray(person?.tags) ? person.tags : [person?.tags];
    const labels = [...tags, person?.special_identity, person?.specialIdentity, person?.political_status, person?.politicalStatus].map(text).join(' ');
    const flags = {
      '党员': Boolean(person?.is_party_member || person?.isPartyMember),
      '低保户': Boolean(person?.is_low_income || person?.isLowIncome),
      '特困难户': Boolean(person?.is_low_income || person?.isLowIncome),
      '退役军人': Boolean(person?.is_veteran || person?.isVeteran),
      '残疾人': Boolean(person?.is_disabled || person?.isDisabled),
      '务工人员': Boolean(person?.is_laborer || person?.isLaborer),
      '学生': Boolean(person?.is_student || person?.isStudent),
      '脱贫户': Boolean(person?.is_poverty || person?.isPoverty),
      '雨露计划': Boolean(person?.is_yulu || person?.isYulu),
      '监测户': Boolean(person?.is_monitor || person?.isMonitor),
    };
    const aliases = {
      '低保户': ['低保', '特困'], '特困难户': ['特困', '低保'], '退役军人': ['退役', '退伍'],
      '务工人员': ['务工'], '学生': ['学生', '在读'],
    };
    return flags[identity] || (aliases[identity] || [identity]).some((label) => labels.includes(text(label)));
  }

  function matchesAge(person, filter) {
    if (!filter) return true;
    const age = getAge(person);
    const birth = getBirthDate(person);
    if (age === null || !birth) return false;
    const now = new Date();
    const monthMatches = birth.getMonth() === now.getMonth();
    const birthdayThisMonth = monthMatches && birth.getDate() >= now.getDate();
    const ranges = {
      '未成年人': age < 18, '入学儿童': age >= 6 && age <= 7, '兵役登记': age >= 18 && age <= 24,
      '中青年劳动力': age >= 18 && age <= 59, '60-79岁': age >= 60 && age <= 79, '80-89岁': age >= 80 && age <= 89,
      '90-99岁': age >= 90 && age <= 99, '100岁以上': age >= 100,
      '本月满60岁': monthMatches && now.getFullYear() - birth.getFullYear() === 60 && birthdayThisMonth,
      '本月满65岁': monthMatches && now.getFullYear() - birth.getFullYear() === 65 && birthdayThisMonth,
      '本月满80岁': monthMatches && now.getFullYear() - birth.getFullYear() === 80 && birthdayThisMonth,
      '本月80岁以上生日': monthMatches && age >= 80,
    };
    return Boolean(ranges[filter]);
  }

  function matchesAudit(person, filter) {
    if (!filter) return true;
    const hasPhone = Boolean(text(valueOf(person, ['phone', 'mobile', 'mobile_phone'])));
    const hasValidCard = hasValidIdCard(person);
    if (filter === 'missing_phone') return !hasPhone;
    if (filter === 'invalid_id_card') return !hasValidCard;
    return !hasPhone || !hasValidCard;
  }

  function matchesRegistry(person, filter) {
    if (!filter) return true;
    const registry = valueOf(person, ['registry_status', 'registryStatus', 'registry_type', 'registryType']) || '正常';
    return text(registry) === text(filter);
  }

  function matchesFilters(person, filters) {
    const queryMatch = !filters.query || SEARCH_FIELDS.some((field) => text(person?.[field]).includes(filters.query));
    const group = valueOf(person, ['village_group', 'villageGroup']);
    const gender = valueOf(person, ['gender', 'sex']);
    const relation = valueOf(person, ['relation_to_head', 'relationType', 'relation_type']);
    return queryMatch
      && (!filters.group || text(group) === text(filters.group))
      && (!filters.identity || hasIdentity(person, filters.identity))
      && (!filters.gender || text(gender) === text(filters.gender))
      && (!filters.relation || text(relation) === text(filters.relation))
      && matchesAge(person, filters.age)
      && matchesAudit(person, filters.audit)
      && matchesRegistry(person, filters.registry);
  }

  function currentFilters() {
    return {
      query: text(document.getElementById('searchPersonnel')?.value), group: selected('filterGroup'),
      identity: selected('filterIdentity'), gender: selected('filterGender'), relation: selected('filterRelation'),
      age: selected('filterAge'), audit: selected('filterDataAudit'), registry: selected('filterRegistryStatus'),
    };
  }

  function applyFilters() {
    const filters = currentFilters();
    const clearButton = document.getElementById('clearSearchPersonnel');
    if (clearButton) clearButton.style.display = filters.query ? 'block' : 'none';
    resetPage();
    renderPersonnelResults(getPersonnel().filter((person) => matchesFilters(person, filters)));
  }

  function clearFilters() {
    const search = document.getElementById('searchPersonnel');
    if (search) search.value = '';
    FILTER_IDS.forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
    applyFilters();
  }

  function applyStatFilter(key) {
    clearFilters();
    const filters = {
      household: ['filterRelation', '户主'], party: ['filterIdentity', '党员'], lowIncome: ['filterIdentity', '低保户'],
      veteran: ['filterIdentity', '退役军人'], disabled: ['filterIdentity', '残疾人'], student: ['filterIdentity', '学生'],
      labor: ['filterIdentity', '务工人员'], poverty: ['filterIdentity', '脱贫户'], yulu: ['filterIdentity', '雨露计划'], monitor: ['filterIdentity', '监测户'],
    };
    const target = filters[key];
    if (target) document.getElementById(target[0]).value = target[1];
    applyFilters();
  }

  function install() {
    const search = document.getElementById('searchPersonnel');
    const clearButton = document.getElementById('clearSearchPersonnel');
    if (!search || search.dataset.personnelSearchReady === 'true') return;
    search.dataset.personnelSearchReady = 'true';
    search.removeAttribute('oninput');
    search.addEventListener('input', applyFilters);
    FILTER_IDS.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.removeAttribute('onchange');
      input.addEventListener('change', applyFilters);
    });
    clearButton?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation(); search.value = ''; applyFilters(); search.focus();
    }, true);
    document.querySelector('button[onclick="clearPersonnelFilters()"]')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation(); clearFilters();
    }, true);
    document.addEventListener('click', (event) => {
      const card = event.target.closest?.('#tab-personnel .stat-card[data-stat-key]');
      if (!card) return;
      event.preventDefault(); event.stopImmediatePropagation(); applyStatFilter(card.dataset.statKey);
    }, true);
  }

  window.filterPersonnel = applyFilters;
  window.clearPersonnelFilters = clearFilters;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
