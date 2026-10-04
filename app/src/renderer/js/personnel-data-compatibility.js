(() => {
  'use strict';

  const text = (value) => String(value ?? '').trim();

  function getPersonnel() {
    try {
      return Array.isArray(dbState?.personnel) ? dbState.personnel : [];
    } catch (_) {
      return [];
    }
  }

  function getIdCard(person) {
    return text(person?.idCard || person?.id_card || person?.identity_card || person?.id_number).replace(/\s/g, '').toUpperCase();
  }

  function normalizeIdentityCardFields() {
    getPersonnel().forEach((person) => {
      const idCard = getIdCard(person);
      if (!idCard) return;
      person.idCard = idCard;
      person.id_card = idCard;
    });
  }

  function exactHouseholdMembers(householdId) {
    const target = text(householdId);
    if (!target) return [];
    if (typeof window.__getExactHouseholdMembers === 'function') {
      return window.__getExactHouseholdMembers(target);
    }
    return getPersonnel().filter((person) => text(person?.household_id) === target && person?.registry_status !== '已注销');
  }

  function installHouseholdEntryByHouseholdId() {
    const legacyOpen = window.openHouseholdMembers;
    if (typeof legacyOpen !== 'function' || legacyOpen.__householdIdEntry) return false;

    function openHouseholdByHouseholdId(personOrHouseholdId, ...args) {
      normalizeIdentityCardFields();
      const reference = text(personOrHouseholdId);
      const selectedPerson = getPersonnel().find((person) => getIdCard(person) === reference || text(person?.id) === reference);
      const householdId = text(selectedPerson?.household_id) || reference;
      const members = exactHouseholdMembers(householdId);
      const householdHead = members.find((person) => text(person?.relation_to_head) === '户主') || members[0];
      const targetIdCard = getIdCard(householdHead || selectedPerson);

      // Legacy rendering still accepts a person identifier. Resolve it from the
      // exact household first, so every route opens the same household record.
      return legacyOpen.call(this, targetIdCard || reference, ...args);
    }

    openHouseholdByHouseholdId.__householdIdEntry = true;
    window.openHouseholdMembers = openHouseholdByHouseholdId;
    return true;
  }

  function wrapDatabaseLoader() {
    const legacyLoadDatabase = window.loadDatabase;
    if (typeof legacyLoadDatabase !== 'function' || legacyLoadDatabase.__idCardCompatibility) return;
    async function loadDatabaseWithIdentityCompatibility(...args) {
      const result = await legacyLoadDatabase.apply(this, args);
      normalizeIdentityCardFields();
      return result;
    }
    loadDatabaseWithIdentityCompatibility.__idCardCompatibility = true;
    window.loadDatabase = loadDatabaseWithIdentityCompatibility;
  }

  function install() {
    normalizeIdentityCardFields();
    wrapDatabaseLoader();
    installHouseholdEntryByHouseholdId();
  }

  window.PersonnelDataCompatibility = { getIdCard, normalizeIdentityCardFields, install, installHouseholdEntryByHouseholdId };
  install();
  window.setTimeout?.(install, 0);
})();
