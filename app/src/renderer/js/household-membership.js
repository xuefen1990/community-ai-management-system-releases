(() => {
  'use strict';

  // A household number is the only key used to decide who belongs to a household.
  // Do not remove leading zeroes: `00123` and `123` can be two different households.
  function normalizeExactHouseholdId(value) {
    return String(value ?? '').trim();
  }

  function relationOrder(person) {
    const relation = String(person?.relation_to_head ?? '').trim();
    if (relation === '户主') return 0;
    if (relation === '配偶') return 1;
    if (['子', '女儿', '儿子'].includes(relation)) return 2;
    if (['父亲', '母亲'].includes(relation)) return 3;
    return 4;
  }

  function getPersonnel() {
    try {
      return Array.isArray(dbState?.personnel) ? dbState.personnel : [];
    } catch (_) {
      return [];
    }
  }

  function getExactHouseholdMembers(householdId) {
    const target = normalizeExactHouseholdId(householdId);
    if (!target) return [];

    return getPersonnel()
      .filter((person) => (
        normalizeExactHouseholdId(person?.household_id) === target
        && person?.registry_status !== '已注销'
      ))
      .sort((left, right) => {
        const relationDifference = relationOrder(left) - relationOrder(right);
        if (relationDifference !== 0) return relationDifference;
        return String(left?.birth_date ?? '').localeCompare(String(right?.birth_date ?? ''));
      });
  }

  // The legacy household panel resolves these global functions at render time.
  // Replacing both keeps the summary and the clickable member cards on the same key.
  window.normalizeHouseholdId = normalizeExactHouseholdId;
  window.getHouseholdMembersById = getExactHouseholdMembers;
  window.__getExactHouseholdMembers = getExactHouseholdMembers;
})();
