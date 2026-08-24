(() => {
  'use strict';

  const SPECIAL_IDENTITIES = [
    { label: '退役军人', aliases: ['退役军人', '退伍军人', '退役', '退伍'], flag: 'is_veteran' },
    { label: '党员', aliases: ['中共党员', '共产党员', '党员'], flag: 'is_party_member' },
    { label: '低保户', aliases: ['低保户', '低保'], flag: 'is_low_income' },
    { label: '特困难户', aliases: ['特困难户', '特困人员', '特困'], flag: 'is_low_income' },
    { label: '残疾人', aliases: ['残疾人员', '残疾人', '残疾'], flag: 'is_disabled' },
    { label: '务工人员', aliases: ['务工人员', '外出务工', '务工'], flag: 'is_laborer' },
    { label: '学生', aliases: ['在读学生', '学生'], flag: 'is_student' },
    { label: '脱贫户', aliases: ['脱贫农户', '脱贫户', '建档立卡'], flag: 'is_poverty' },
    { label: '雨露计划', aliases: ['雨露计划'], flag: 'is_yulu' },
    { label: '监测户', aliases: ['监测农户', '监测户', '防返贫监测'], flag: 'is_monitor' },
    { label: '军人', aliases: ['现役军人', '军人'], flag: null },
  ];

  const text = (value) => String(value ?? '').trim();
  const normalized = (value) => text(value).replace(/[\s_（）()\-]/g, '').toLocaleLowerCase('zh-CN');
  const normalizeIdCard = (value) => text(value).replace(/\s/g, '').toUpperCase();
  const idCardWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const idCardChecks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  function isValidIdCard(value) {
    const idCard = normalizeIdCard(value);
    if (!/^\d{17}[\dX]$/u.test(idCard)) return false;
    const sum = idCardWeights.reduce((total, weight, index) => total + Number(idCard[index]) * weight, 0);
    return idCardChecks[sum % 11] === idCard[17];
  }

  function detectSpecialIdentity({ fileName = '', sheetName = '', columns = [] } = {}) {
    const source = normalized([fileName, sheetName, ...columns].join(' '));
    const aliasMatches = SPECIAL_IDENTITIES.flatMap((identity) => identity.aliases.map((alias) => ({ identity, alias: normalized(alias) })))
      .filter((entry) => entry.alias && source.includes(entry.alias));
    const mostSpecificMatches = aliasMatches.filter((entry) => !aliasMatches.some((other) => other.identity.label !== entry.identity.label && other.alias.length > entry.alias.length && other.alias.includes(entry.alias)));
    const identities = [...new Map(mostSpecificMatches.map((entry) => [entry.identity.label, entry.identity])).values()];
    return identities.length === 1 ? identities[0].label : '';
  }

  function findUniquePersonById(personnel, value) {
    const idCard = normalizeIdCard(value);
    if (!idCard) return { status: 'missing', person: null };
    const matches = (Array.isArray(personnel) ? personnel : []).filter((person) => normalizeIdCard(person?.idCard || person?.id_card || person?.identity_card || person?.id_number) === idCard);
    if (matches.length === 1) return { status: 'matched', person: matches[0] };
    return { status: matches.length > 1 ? 'duplicate' : 'missing', person: null };
  }

  function asLabels(value) {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((label) => text(label).split(/[、,，;；|/]+/u).map(text).filter(Boolean));
  }

  function mergeResidentInformation(person, incoming, identity, updatedAt) {
    const normalizedCard = normalizeIdCard(incoming?.idCard);
    Object.entries(incoming || {}).forEach(([key, value]) => {
      const cleaned = text(value);
      if (!cleaned) return;
      person[key] = key === 'idCard' ? normalizedCard : cleaned;
    });

    const currentIdentities = asLabels(person.specialIdentities);
    const identityAdded = Boolean(identity) && !currentIdentities.includes(identity);
    if (identityAdded) currentIdentities.push(identity);
    person.specialIdentities = currentIdentities;

    const tags = asLabels(person.tags);
    if (identity && !tags.includes(identity)) tags.push(identity);
    person.tags = tags;

    const flag = SPECIAL_IDENTITIES.find((item) => item.label === identity)?.flag;
    if (flag) person[flag] = true;
    person.updated_at = updatedAt;
    return { identityAdded };
  }

  const api = { SPECIAL_IDENTITIES, detectSpecialIdentity, findUniquePersonById, isValidIdCard, mergeResidentInformation, normalizeIdCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PersonnelImportMerge = api;
})();
