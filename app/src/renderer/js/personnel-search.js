(() => {
  'use strict';

  const SEARCH_FIELDS = [
    'name', 'person_name', 'full_name', 'display_name',
    'idCard', 'id_card', 'identity_card', 'id_number',
    'household_id', 'householdId',
    'phone', 'mobile', 'mobile_phone',
  ];

  const text = (value) => String(value ?? '').trim().toLocaleLowerCase('zh-CN');

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
      console.error('人员搜索结果渲染失败：', error);
    }
    return false;
  }

  function filterBySearch() {
    const input = document.getElementById('searchPersonnel');
    if (!input) return;

    const query = text(input.value);
    const clearButton = document.getElementById('clearSearchPersonnel');
    if (clearButton) clearButton.style.display = query ? 'block' : 'none';

    const results = query
      ? getPersonnel().filter((person) => SEARCH_FIELDS.some((field) => text(person?.[field]).includes(query)))
      : getPersonnel();

    resetPage();
    renderPersonnelResults(results);
  }

  function install() {
    const input = document.getElementById('searchPersonnel');
    const clearButton = document.getElementById('clearSearchPersonnel');
    if (!input || input.dataset.personnelSearchReady === 'true') return;

    input.dataset.personnelSearchReady = 'true';
    input.removeAttribute('oninput');
    input.addEventListener('input', filterBySearch);

    clearButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      input.value = '';
      filterBySearch();
      input.focus();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
