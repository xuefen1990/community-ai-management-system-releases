(() => {
  'use strict';

  const state = {
    sortKey: 'group',
    sortDirection: 'asc',
    lastRows: [],
    legacyRender: null,
  };
  let idValidationInstalled = false;

  const sortColumns = [
    { index: 1, key: 'name', label: '姓名' },
    { index: 2, key: 'householdId', label: '户号' },
    { index: 3, key: 'idCard', label: '身份证号' },
    { index: 4, key: 'gender', label: '性别' },
    { index: 5, key: 'birthDate', label: '出生日期' },
    { index: 6, key: 'group', label: '居民组' },
    { index: 7, key: 'relation', label: '与户主关系' },
    { index: 8, key: 'household', label: '关联户' },
    { index: 9, key: 'phone', label: '电话号码' },
    { index: 10, key: 'identity', label: '专项身份' },
  ];

  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const text = (value) => String(value ?? '').trim();
  const personValue = (person, keys) => keys.map((key) => person?.[key]).find((value) => text(value)) ?? '';
  const idCardWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const idCardChecks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  function people() {
    try {
      if (Array.isArray(dbState?.personnel)) return dbState.personnel;
    } catch (_) {
      // The readable layer can load before the legacy global is initialized.
    }
    return Array.isArray(window.dbState?.personnel) ? window.dbState.personnel : [];
  }

  function valueFor(person, key) {
    const values = {
      name: ['name', 'person_name', 'full_name', 'display_name'],
      householdId: ['household_id', 'householdId'],
      idCard: ['idCard', 'id_card', 'identity_card', 'id_number'],
      gender: ['gender', 'sex'],
      birthDate: ['birth_date', 'birthDate', 'birthday'],
      group: ['village_group', 'villageGroup', 'group_name', 'groupName'],
      relation: ['relation_to_head', 'relationType', 'relation_type'],
      household: ['related_household', 'relatedHousehold', 'household_id', 'householdId'],
      phone: ['phone', 'mobile', 'mobile_phone'],
      identity: ['special_identity', 'specialIdentity', 'political_status', 'politicalStatus'],
    };
    if (key === 'identity') {
      const tags = Array.isArray(person?.tags) ? person.tags : [person?.tags];
      const identities = Array.isArray(person?.specialIdentities) ? person.specialIdentities : [person?.specialIdentities];
      return [...tags, ...identities, personValue(person, values.identity)].filter((value) => text(value)).join('、');
    }
    return personValue(person, values[key] || [key]);
  }

  function normalizeIdCard(value) { return text(value).replace(/\s/g, '').toUpperCase(); }

  function isMissingValue(value) {
    const source = text(value).toLowerCase().replace(/[\s*_]/gu, '');
    return !source || ['undefined', 'null', 'nan', '-', '—', 'none', 'n/a', '>', '<'].includes(source)
      || /^und.*ined$/u.test(source);
  }

  function validateIdCard(value) {
    const idCard = normalizeIdCard(value);
    if (!idCard) return { valid: false, reason: '未填写身份证号' };
    if (!/^[1-9]\d{16}[\dX]$/u.test(idCard)) return { valid: false, reason: '应为 18 位身份证号' };
    const birth = `${idCard.slice(6, 10)}-${idCard.slice(10, 12)}-${idCard.slice(12, 14)}`;
    const date = new Date(`${birth}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(idCard.slice(6, 10)) || date.getMonth() + 1 !== Number(idCard.slice(10, 12)) || date.getDate() !== Number(idCard.slice(12, 14))) return { valid: false, reason: '出生日期不正确' };
    const sum = idCardWeights.reduce((total, weight, index) => total + Number(idCard[index]) * weight, 0);
    if (idCardChecks[sum % 11] !== idCard[17]) return { valid: false, reason: '校验码不正确' };
    return {
      valid: true,
      value: idCard,
      birthDate: `${idCard.slice(6, 10)}-${idCard.slice(10, 12)}-${idCard.slice(12, 14)}`,
      gender: Number(idCard[16]) % 2 === 1 ? '男' : '女',
    };
  }

  function emptyDisplay(value) {
    const source = text(value);
    return isMissingValue(source) ? '未填写' : source;
  }

  function genderDisplay(value) {
    const source = text(value).toLowerCase();
    if (['male', 'm', '1', '男'].includes(source)) return '男';
    if (['female', 'f', '0', '2', '女'].includes(source)) return '女';
    if (['unknown', 'other', '未知', '其他'].includes(source)) return '未填写';
    return emptyDisplay(value);
  }

  function relationDisplay(value) {
    const source = text(value).toLowerCase().replace(/[\s_-]/g, '');
    const labels = {
      '户主': '户主', 'head': '户主', 'householdhead': '户主', 'headofhousehold': '户主', 'familyhead': '户主',
      '配偶': '配偶', 'spouse': '配偶', 'husband': '配偶', 'wife': '配偶',
      '子女': '子女', 'child': '子女', 'son': '儿子', 'daughter': '女儿',
      '父母': '父母', 'parent': '父母', 'father': '父亲', 'mother': '母亲',
      '祖父母': '祖父母', 'grandparent': '祖父母', '孙子女': '孙子女', 'grandchild': '孙子女',
      '兄弟姐妹': '兄弟姐妹', 'sibling': '兄弟姐妹', 'brother': '兄弟', 'sister': '姐妹',
      '其他': '其他', 'other': '其他',
    };
    return labels[source] || emptyDisplay(value);
  }

  function phoneDisplay(value) {
    const source = text(value);
    if (isMissingValue(source) || /^(undefined|null|nan)/iu.test(source)) return '未填写';
    return source;
  }

  // Birth dates arrive from older imports in several human-readable forms
  // (for example, "1988年06月12日"). Keep the stored value untouched and
  // normalize only the resident-directory presentation to a fixed-width ISO
  // date so the table row never grows because of an extra line.
  function birthDateDisplay(value) {
    const source = text(value);
    if (isMissingValue(source)) return '未填写';
    const compact = source.replace(/\s+/gu, '').replace(/[./]/gu, '-').replace(/年/gu, '-').replace(/月/gu, '-').replace(/日/gu, '').replace(/-+$/u, '');
    const parts = compact.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/u);
    if (parts) {
      const year = parts[1];
      const month = parts[2] ? parts[2].padStart(2, '0') : '00';
      const day = parts[3] ? parts[3].padStart(2, '0') : '00';
      return `${year}-${month}-${day}`;
    }
    const digits = source.match(/^(\d{4})(\d{2})(\d{2})$/u);
    if (digits) return `${digits[1]}-${digits[2]}-${digits[3]}`;
    return source;
  }

  function identityProfile(person) {
    const result = validateIdCard(valueFor(person, 'idCard'));
    if (result.valid) return { gender: result.gender, birthDate: result.birthDate, verified: true };
    return {
      gender: genderDisplay(valueFor(person, 'gender')) === '未填写' ? '待核对' : genderDisplay(valueFor(person, 'gender')),
      birthDate: isMissingValue(valueFor(person, 'birthDate')) ? '待核对' : birthDateDisplay(valueFor(person, 'birthDate')),
      verified: false,
    };
  }

  function displayValue(person, key) {
    const profile = identityProfile(person);
    if (key === 'gender') return profile.gender;
    if (key === 'birthDate') return profile.birthDate;
    if (key === 'relation') return relationDisplay(valueFor(person, key));
    if (key === 'phone') return phoneDisplay(valueFor(person, key));
    return emptyDisplay(valueFor(person, key));
  }

  function chineseNumber(value) {
    const source = text(value);
    if (/^\d+$/u.test(source)) return Number(source);
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 };
    let total = 0; let current = 0;
    for (const character of source) {
      if (Object.hasOwn(digits, character)) current = digits[character];
      else if (Object.hasOwn(units, character)) { total += (current || 1) * units[character]; current = 0; }
    }
    return total + current;
  }

  function configuredGroups() {
    const database = (() => { try { return dbState; } catch (_) { return window.dbState || {}; } })() || {};
    const candidates = [database.villageGroups, database.village_groups, database.groups, database.settings?.villageGroups, database.settings?.village_groups];
    return [...new Set(candidates.flatMap((items) => Array.isArray(items) ? items : []).map((item) => text(typeof item === 'string' ? item : (item?.name || item?.groupName || item?.group_name || item?.label))).filter(Boolean))];
  }

  function compareGroup(left, right) {
    const a = text(left); const b = text(right);
    if (!a || !b) return a ? -1 : (b ? 1 : 0);
    const configured = configuredGroups();
    const leftIndex = configured.indexOf(a); const rightIndex = configured.indexOf(b);
    if (leftIndex !== rightIndex && (leftIndex >= 0 || rightIndex >= 0)) return leftIndex < 0 ? 1 : (rightIndex < 0 ? -1 : leftIndex - rightIndex);
    const matcher = /^(.*?)([零一二三四五六七八九十百千万两\d]+)组?$/u;
    const leftParts = a.match(matcher); const rightParts = b.match(matcher);
    const prefix = collator.compare(leftParts?.[1] || a, rightParts?.[1] || b);
    if (prefix) return prefix;
    if (leftParts && rightParts) {
      const number = chineseNumber(leftParts[2]) - chineseNumber(rightParts[2]);
      if (number) return number;
    }
    return collator.compare(a, b);
  }

  function compareValue(left, right, key) {
    const a = text(left); const b = text(right);
    if (!a || !b) return a ? -1 : (b ? 1 : 0);
    return key === 'group' ? compareGroup(a, b) : collator.compare(a, b);
  }

  function sortedRows(rows) {
    const direction = state.sortDirection === 'desc' ? -1 : 1;
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
      const primary = compareValue(valueFor(left, state.sortKey), valueFor(right, state.sortKey), state.sortKey);
      if (primary) return primary * direction;
      const group = compareGroup(valueFor(left, 'group'), valueFor(right, 'group'));
      if (group) return group;
      return collator.compare(text(valueFor(left, 'name')), text(valueFor(right, 'name')));
    });
  }

  function sortIndicator(key) {
    if (state.sortKey !== key) return '⇅';
    return state.sortDirection === 'asc' ? '▲' : '▼';
  }

  function applyLabels() {
    const tab = document.getElementById('tab-personnel');
    if (!tab) return;
    tab.querySelector('.header-info h2')?.replaceChildren('居民一户一档');
    const subtitle = tab.querySelector('.header-info .active-sub');
    if (subtitle) subtitle.textContent = '居民一户一档';
    document.querySelector('.wb-stat-card[onclick*="tab-personnel"]')?.setAttribute('title', '点击查看居民一户一档');
  }

  function renderCurrentResult() {
    if (typeof window.filterPersonnel === 'function') {
      window.filterPersonnel();
      return;
    }
    if (state.legacyRender) state.legacyRender(sortedRows(state.lastRows.length ? state.lastRows : people()));
  }

  function setSort(key) {
    if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDirection = 'asc'; }
    renderCurrentResult();
    updateSortControls();
  }

  function updateSortControls() {
    const tab = document.getElementById('tab-personnel');
    if (!tab) return;
    tab.querySelectorAll('[data-personnel-directory-sort-key]').forEach((control) => {
      const isActive = control.dataset.personnelDirectorySortKey === state.sortKey;
      const icon = control.querySelector('.personnel-directory-sort-icon');
      control.classList.toggle('is-active', isActive);
      control.setAttribute('aria-sort', isActive ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      if (icon) icon.textContent = sortIndicator(control.dataset.personnelDirectorySortKey);
    });
    const select = tab.querySelector('[data-personnel-directory-sort-select]');
    if (select) select.value = state.sortKey;
    const direction = tab.querySelector('[data-personnel-directory-sort-direction]');
    if (direction) direction.value = state.sortDirection;
  }

  function readLegacyPage() {
    try { return Math.max(1, Number(personnelCurrentPage) || 1); } catch (_) { return Math.max(1, Number(window.personnelCurrentPage) || 1); }
  }

  function writeLegacyPage(page) {
    const value = Math.max(1, Number(page) || 1);
    try { personnelCurrentPage = value; } catch (_) { window.personnelCurrentPage = value; }
  }

  function readLegacyPageSize() {
    try { return Math.max(1, Number(personnelPageSize) || 15); } catch (_) { return Math.max(1, Number(window.personnelPageSize) || 15); }
  }

  function writeLegacyPageSize(size) {
    const value = Math.max(1, Number(size) || 15);
    try { personnelPageSize = value; } catch (_) { window.personnelPageSize = value; }
  }

  function renderSelectedPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.lastRows.length / readLegacyPageSize()));
    writeLegacyPage(Math.min(Math.max(1, Number(page) || 1), totalPages));
    window.renderPersonnel?.(state.lastRows);
  }

  function paginationButton(label, page, { active = false, disabled = false, title = '' } = {}) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `page-btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`;
    button.textContent = label; button.disabled = disabled; button.title = title || `第 ${page} 页`;
    if (!disabled) button.addEventListener('click', () => renderSelectedPage(page));
    return button;
  }

  function renderDirectoryPagination() {
    const container = document.getElementById('personnelPagination');
    if (!container || !state.lastRows.length) return;
    const pageSize = readLegacyPageSize();
    const total = state.lastRows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(readLegacyPage(), pages);
    if (page !== readLegacyPage()) writeLegacyPage(page);
    const start = Math.min(total, (page - 1) * pageSize + 1);
    const end = Math.min(total, page * pageSize);
    const fragment = document.createDocumentFragment();
    const info = document.createElement('div'); info.className = 'pagination-info'; info.textContent = `显示第 ${start} 至 ${end} 项，共 ${total} 项`;
    const controls = document.createElement('div'); controls.className = 'pagination-controls personnel-directory-pagination-controls';
    controls.append(paginationButton('首页', 1, { disabled: page === 1 }), paginationButton('上一页', page - 1, { disabled: page === 1 }));
    const firstPage = Math.max(1, page - 2); const lastPage = Math.min(pages, page + 2);
    for (let number = firstPage; number <= lastPage; number += 1) controls.append(paginationButton(String(number), number, { active: number === page }));
    controls.append(paginationButton('下一页', page + 1, { disabled: page === pages }), paginationButton('末页', pages, { disabled: page === pages }));
    const sizeLabel = document.createElement('label'); sizeLabel.className = 'personnel-directory-page-size'; sizeLabel.textContent = '每页显示 ';
    const sizeSelect = document.createElement('select'); sizeSelect.setAttribute('aria-label', '每页显示数量');
    [10, 15, 20, 50].forEach((size) => { const option = new Option(`${size} 条`, String(size), false, size === pageSize); sizeSelect.add(option); });
    sizeSelect.addEventListener('change', () => { writeLegacyPageSize(sizeSelect.value); renderSelectedPage(1); }); sizeLabel.append(sizeSelect);
    const jump = document.createElement('label'); jump.className = 'personnel-directory-page-jump'; jump.textContent = '跳至 ';
    const jumpInput = document.createElement('input'); jumpInput.type = 'number'; jumpInput.min = '1'; jumpInput.max = String(pages); jumpInput.value = String(page); jumpInput.inputMode = 'numeric'; jumpInput.setAttribute('aria-label', '跳转页码');
    const jumpButton = document.createElement('button'); jumpButton.type = 'button'; jumpButton.className = 'page-btn'; jumpButton.textContent = '确定'; jumpButton.title = '跳转至输入页码';
    const submitJump = () => renderSelectedPage(jumpInput.value);
    jumpButton.addEventListener('click', submitJump); jumpInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitJump(); }); jump.append(jumpInput, ' 页', jumpButton);
    fragment.append(info, sizeLabel, controls, jump); container.replaceChildren(fragment);
  }

  function decorateTable() {
    const tab = document.getElementById('tab-personnel');
    const table = tab?.querySelector('.data-table');
    const headers = table?.tHead?.rows?.[0]?.cells;
    if (!headers) return;
    sortColumns.forEach((column) => {
      const header = headers[column.index];
      if (!header || header.dataset.personnelDirectorySortReady === 'true') return;
      header.dataset.personnelDirectorySortReady = 'true';
      header.removeAttribute('onclick');
      header.title = `点击按${column.label}排序`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'personnel-directory-sort-button';
      button.dataset.personnelDirectorySortKey = column.key;
      button.innerHTML = `<span>${column.label}</span><span class="personnel-directory-sort-icon" aria-hidden="true">${sortIndicator(column.key)}</span>`;
      button.addEventListener('click', () => setSort(column.key));
      header.replaceChildren(button);
    });
    updateSortControls();
  }

  function setCellText(cell, value, { preserveInteractive = false } = {}) {
    if (!cell || cell.dataset.personnelDirectoryFormatted === value) return;
    if (preserveInteractive && cell.querySelector('a, button, [onclick]')) {
      cell.dataset.personnelDirectoryFormatted = value;
      return;
    }
    cell.dataset.personnelDirectoryFormatted = value;
    cell.replaceChildren(value);
  }

  function renderHouseholdRelation(cell, person) {
    if (!cell) return;
    const relation = person ? displayValue(person, 'relation') : relationDisplay(cell.textContent);
    const householdId = person ? valueFor(person, 'householdId') : '';
    const canOpenHousehold = person && !isMissingValue(relation) && !isMissingValue(householdId);
    if (!canOpenHousehold) {
      // A blank relationship is intentional: do not show a misleading
      // placeholder and do not present a household-members action.
      cell.dataset.personnelDirectoryFormatted = '';
      cell.replaceChildren('');
      return;
    }
    if (cell.dataset.personnelDirectoryHouseholdId === householdId
      && cell.dataset.personnelDirectoryFormatted === relation
      && cell.querySelector('.household-relation-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'household-relation-button';
    button.title = `查看户号 ${householdId} 的成员信息`;
    button.append(relation, document.createTextNode(' ›'));
    button.addEventListener('click', () => window.openHouseholdMembers?.(householdId));
    cell.dataset.personnelDirectoryHouseholdId = householdId;
    cell.dataset.personnelDirectoryFormatted = relation;
    cell.replaceChildren(button);
  }

  function formatRenderedRows() {
    const table = document.querySelector('#tab-personnel .data-table');
    table?.tBodies?.[0]?.rows && [...table.tBodies[0].rows].forEach((row) => {
      const cells = row.cells;
      if (!cells?.length) return;
      const person = personForRow(row);
      if (person) {
        row.dataset.residentPersonKey = text(person.id) || valueFor(person, 'idCard');
        row.dataset.residentPersonIndex = String(people().indexOf(person));
      }
      setCellText(cells[4], person ? displayValue(person, 'gender') : genderDisplay(cells[4]?.textContent));
      setCellText(cells[5], person ? displayValue(person, 'birthDate') : emptyDisplay(cells[5]?.textContent));
      setCellText(cells[6], person ? displayValue(person, 'group') : emptyDisplay(cells[6]?.textContent));
      renderHouseholdRelation(cells[7], person);
      setCellText(cells[8], person ? displayValue(person, 'household') : emptyDisplay(cells[8]?.textContent), { preserveInteractive: true });
      setCellText(cells[9], person ? displayValue(person, 'phone') : phoneDisplay(cells[9]?.textContent));
      setCellText(cells[10], person ? displayValue(person, 'identity') : emptyDisplay(cells[10]?.textContent));
      const idCell = cells[3];
      const idCard = normalizeIdCard(person ? valueFor(person, 'idCard') : (idCell?.dataset.personnelIdValue || idCell?.textContent));
      if (!idCell || !idCard || idCard.includes('*') || ['未填写', '—'].includes(idCard)) return;
      idCell.dataset.personnelIdValue = idCard;
      const result = validateIdCard(idCard);
      idCell.classList.toggle('personnel-id-invalid', !result.valid);
      idCell.classList.toggle('personnel-id-valid', result.valid);
      idCell.title = result.valid ? '身份证号校验通过' : `身份证号异常：${result.reason}`;
      idCell.querySelector('.personnel-id-status')?.remove();
      if (!result.valid) {
        const badge = document.createElement('span');
        badge.className = 'personnel-id-status';
        badge.textContent = '校验异常';
        idCell.append(' ', badge);
      }
    });
  }

  function personForRow(row) {
    const key = text(row?.dataset?.residentPersonKey);
    if (key) return people().find((person) => text(person.id) === key || valueFor(person, 'idCard') === key) || null;
    const cells = row?.cells || [];
    const rowId = normalizeIdCard(cells[3]?.dataset?.personnelIdValue || cells[3]?.textContent);
    const byId = rowId && !rowId.includes('*') ? people().filter((person) => valueFor(person, 'idCard') === rowId) : [];
    if (byId.length === 1) return byId[0];
    const name = text(cells[1]?.textContent); const group = text(cells[6]?.textContent);
    const matches = people().filter((person) => valueFor(person, 'name') === name && (!group || valueFor(person, 'group') === group));
    if (matches.length === 1) return matches[0];
    const actionSource = [...(row?.querySelectorAll?.('[onclick]') || [])].map((item) => text(item.getAttribute('onclick'))).join(' ');
    const index = actionSource.match(/openEditModal\s*\(\s*['"]personnel['"]\s*,\s*(\d+)\s*\)/u)?.[1];
    return index !== undefined && people()[Number(index)] ? people()[Number(index)] : null;
  }

  function isIdCardInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    const attributes = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''}`.toLowerCase();
    if (/idcard|id_card|identity_card|id_number|身份证/u.test(attributes)) return true;
    const label = input.closest('label')?.textContent || input.parentElement?.previousElementSibling?.textContent || '';
    return /身份证|证件号码/u.test(label);
  }

  function validateIdCardInput(input, { showMessage = false } = {}) {
    if (!isIdCardInput(input)) return true;
    const raw = normalizeIdCard(input.value);
    if (input.value !== raw) input.value = raw;
    if (raw.includes('*')) {
      input.setCustomValidity(''); input.classList.remove('personnel-id-input-invalid'); input.setAttribute('aria-invalid', 'false');
      input.parentElement?.querySelector(':scope > [data-personnel-id-validation]')?.remove();
      return true;
    }
    const result = raw ? validateIdCard(raw) : { valid: true, reason: '' };
    input.setCustomValidity(result.valid ? '' : `身份证号${result.reason}`);
    input.classList.toggle('personnel-id-input-invalid', !result.valid);
    input.setAttribute('aria-invalid', result.valid ? 'false' : 'true');
    const message = input.parentElement?.querySelector(':scope > [data-personnel-id-validation]');
    if (message) message.remove();
    if (showMessage && !result.valid) {
      const hint = document.createElement('small');
      hint.dataset.personnelIdValidation = 'true';
      hint.className = 'personnel-id-input-message';
      hint.textContent = `身份证号${result.reason}`;
      input.insertAdjacentElement('afterend', hint);
    }
    if (result.valid) applyDerivedIdentity(input.closest('form') || input.parentElement, result);
    return result.valid;
  }

  function applyDerivedIdentity(scope, result) {
    if (!scope || !result?.valid) return;
    [...scope.querySelectorAll('input, select')].forEach((input) => {
      const hint = `${input.name || ''} ${input.id || ''} ${input.closest('label')?.textContent || ''} ${input.parentElement?.previousElementSibling?.textContent || ''}`.toLowerCase();
      if (/gender|sex|性别/u.test(hint)) {
        if (input.tagName === 'SELECT') {
          const option = [...input.options].find((item) => genderDisplay(item.value) === result.gender || text(item.textContent) === result.gender);
          if (option) input.value = option.value;
        } else input.value = result.gender;
      }
      if (/birth|birthday|出生日期|出生年月/u.test(hint) && !isIdCardInput(input)) input.value = result.birthDate;
    });
  }

  function installIdCardValidation() {
    if (idValidationInstalled) return;
    idValidationInstalled = true;
    document.addEventListener('blur', (event) => { if (isIdCardInput(event.target)) validateIdCardInput(event.target, { showMessage: true }); }, true);
    document.addEventListener('input', (event) => { if (isIdCardInput(event.target)) validateIdCardInput(event.target); }, true);
    document.addEventListener('submit', (event) => {
      const inputs = [...event.target.querySelectorAll('input')].filter(isIdCardInput);
      const invalid = inputs.find((input) => !validateIdCardInput(input, { showMessage: true }));
      if (!invalid) return;
      event.preventDefault();
      invalid.reportValidity?.();
      invalid.focus();
    }, true);
  }

  function addSortControls() {
    const tab = document.getElementById('tab-personnel');
    const controls = tab?.querySelector('.filter-main-controls');
    if (!controls || controls.querySelector('[data-personnel-directory-sort-select]')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'select-dropdown-wrapper personnel-directory-sort-control';
    wrapper.innerHTML = `<select aria-label="居民排序方式" data-personnel-directory-sort-select><option value="group">居民组（默认）</option>${sortColumns.filter((item) => item.key !== 'group').map((item) => `<option value="${item.key}">${item.label}</option>`).join('')}</select><select aria-label="排序方向" data-personnel-directory-sort-direction><option value="asc">升序</option><option value="desc">降序</option></select>`;
    const [select, direction] = wrapper.querySelectorAll('select');
    select.addEventListener('change', () => { state.sortKey = select.value; renderCurrentResult(); updateSortControls(); });
    direction.addEventListener('change', () => { state.sortDirection = direction.value; renderCurrentResult(); updateSortControls(); });
    controls.insertBefore(wrapper, controls.firstChild);
    updateSortControls();
  }

  function wrapLegacyRenderer() {
    if (state.legacyRender || typeof window.renderPersonnel !== 'function') return Boolean(state.legacyRender);
    state.legacyRender = window.renderPersonnel;
    function renderSortedPersonnel(rows) {
      state.lastRows = Array.isArray(rows) ? rows : people();
      const result = state.legacyRender.call(this, sortedRows(state.lastRows));
      window.requestAnimationFrame?.(() => { decorateTable(); formatRenderedRows(); updateSortControls(); renderDirectoryPagination(); });
      return result;
    }
    renderSortedPersonnel.__residentDirectoryUi = true;
    window.renderPersonnel = renderSortedPersonnel;
    return true;
  }

  function install() {
    applyLabels();
    addSortControls();
    decorateTable();
    formatRenderedRows();
    installIdCardValidation();
    if (!wrapLegacyRenderer()) {
      window.setTimeout(install, 80);
      return;
    }
    renderCurrentResult();
  }

  window.ResidentDirectoryUi = { compareGroup, sortedRows, validateIdCard, genderDisplay, relationDisplay, phoneDisplay, birthDateDisplay, identityProfile, displayValue, setSort, install, render: (rows) => window.renderPersonnel(rows) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
