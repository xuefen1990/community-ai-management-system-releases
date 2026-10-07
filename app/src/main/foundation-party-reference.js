'use strict';
const { checkVersion, revision, fail } = require('./foundation-data-model');
const { domainRows, mutateDomain } = require('./foundation-domains');
const { partyDues, mutateParty } = require('./foundation-party');
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const partyTags = ['党员', '中共党员', '预备党员', '入党积极分子', '积极分子', '入党发展对象', '发展对象', '入党申请人'];
const tagForStage = { 正式党员: '党员', 预备党员: '预备党员', 积极分子: '入党积极分子', 发展对象: '入党发展对象', 申请人: '入党申请人' };

function findResident(database, card, name) {
  const people = list(database.personnel);
  if (card) return people.find(person => text(person.idCard || person.id_card) === card);
  const matches = people.filter(person => text(person.name) === name);
  if (matches.length > 1) fail('AMBIGUOUS_PERSON', '存在同名居民，请填写身份证号后保存');
  return matches[0];
}

function saveMember(database, body, context) {
  const supplied = body.member || {}, form = body.form || {};
  let original = [...list(database.partyMembers), ...list(database.partyActivists)].find(item => text(item.id) === text(supplied.id));
  if (supplied.id && !supplied.id.startsWith('party_auto_') && !original) fail('NOT_FOUND', '党员档案已删除，请刷新后重试');
  const card = text(form.externalIdCard ?? supplied.id_card ?? supplied.externalIdCard);
  const name = text(form.name ?? supplied.name ?? supplied.nameSnapshot);
  if (!name) fail('INVALID_INPUT', '请填写党员姓名');
  if (!original && card) original = [...list(database.partyMembers), ...list(database.partyActivists)].find(item => text(item.externalIdCard || item.id_card) === card);
  if (original && !body.ensureOnly) checkVersion(original, supplied.version);
  if (original && body.ensureOnly) return { member: domainRows(database, '/party/members').find(item => item.id === original.id) };
  const base = original || supplied;
  const changes = { name, externalIdCard: card, memberType: form.memberType ?? base.memberType ?? base.member_type ?? '流动党员',
    branchId: form.branchId ?? base.branchId ?? base.branch_id ?? supplied.branchId ?? '', branch: form.branchName ?? base.branch ?? '',
    position: form.position ?? base.position ?? '普通党员', stage: form.stage ?? base.stage ?? supplied.stage ?? '正式党员',
    joinDate: form.joinDate ?? base.joinDate ?? base.join_date ?? '', phone: form.phone ?? base.phone ?? '',
    villageGroup: form.villageGroup ?? base.villageGroup ?? base.village_group ?? '',
    applyDate: form.applyDate ?? base.applyDate ?? base.apply_date ?? '', activistDate: form.activistDate ?? base.activistDate ?? base.activist_date ?? '',
    targetDate: form.targetDate ?? base.targetDate ?? base.target_date ?? '', mentors: form.mentors ?? base.mentors ?? '' };
  if (!Object.hasOwn(tagForStage, changes.stage)) fail('INVALID_INPUT', '发展阶段不正确');
  if (changes.branchId && !list(database.partyBranches).some(branch => text(branch.id) === text(changes.branchId))) fail('NOT_FOUND', '所属党支部已改变，请刷新');
  if (changes.branchId) changes.branch = database.partyBranches.find(branch => text(branch.id) === text(changes.branchId)).name;
  const standard = form.duesStandard === undefined ? base.duesStandardCents ?? Math.round(Number(base.dues_standard ?? 10) * 100) : Math.round(Number(form.duesStandard) * 100);
  if (!Number.isSafeInteger(standard) || standard < 0) fail('INVALID_INPUT', '党费基数不正确');
  changes.duesStandardCents = standard;
  const person = ['本村党员', '本村'].includes(changes.memberType) ? findResident(database, card, name) : null;
  if (!original && person && (supplied.id?.startsWith('party_auto_') || supplied.residentVersion !== undefined)) checkVersion(person, supplied.residentVersion);
  if (['本村党员', '本村'].includes(changes.memberType) && !person && !original) fail('NOT_FOUND', '请先从居民档案选择本村人员');
  const result = mutateDomain(database, original ? 'PATCH' : 'POST', `/party/members${original ? `/${encodeURIComponent(original.id)}` : ''}`,
    original ? { baseVersion: revision(original), changes } : changes, context);
  const stored = database.partyMembers.find(item => item.id === result.member.id);
  if (!original || changes.stage !== original.stage || ['applyDate', 'activistDate', 'targetDate', 'mentors'].some(key => changes[key] !== original[key])) {
    (stored.development ||= []).push({ id: context.uuid(), stage: changes.stage, eventDate: changes.activistDate || changes.applyDate || context.now().toISOString().slice(0, 10),
      contacts: [{ name: '联系电话', phone: changes.phone }, { name: '培养联系人', mentors: changes.mentors }], remarks: changes.villageGroup,
      targetDate: changes.targetDate, createdAt: context.now().toISOString() });
  }
  if (person) {
    const info = { ...(person.party_info || person.customFields?.party_info || {}), join_date: changes.joinDate, branch: changes.branch, duty: changes.position,
      stage: changes.stage, dues_standard: standard / 100, apply_date: changes.applyDate, activist_date: changes.activistDate,
      target_date: changes.targetDate, mentors: changes.mentors };
    person.party_info = info; person.customFields = { ...person.customFields, party_info: structuredClone(info) };
    person.tags = [...list(person.tags).filter(tag => !partyTags.includes(tag)), tagForStage[changes.stage]];
    person.updatedAt = context.now().toISOString();
  }
  return { member: domainRows(database, '/party/members').find(item => item.id === stored.id), item: result.item };
}

function replaceDues(database, body, context) {
  const year = Number(body.year), entries = list(body.entries);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !entries.length || entries.length > 10000) fail('INVALID_INPUT', '年度或收缴人员不正确');
  if (new Set(entries.map(entry => entry.member?.id || entry.memberId)).size !== entries.length) fail('INVALID_INPUT', '同一党员不能重复收缴');
  // Materialization is in the same store transaction, rolled back on any failure.
  for (const entry of entries) if (entry.member) {
    const saved = saveMember(database, { member: entry.member, ensureOnly: true, form: { memberType: entry.member.member_type } }, context).member;
    entry.memberId = saved.id;
    entry.memberVersion = entry.member.id === saved.id ? entry.member.version : saved.version;
  }
  // Validate the whole batch before removing any existing monthly payments.
  for (const entry of entries) {
    const member = list(database.partyMembers).find(item => text(item.id) === text(entry.memberId));
    if (!member) fail('NOT_FOUND', '党员档案不存在，请刷新');
    checkVersion(member, entry.memberVersion);
    const previous = partyDues(database).filter(due => text(due.partyMemberId) === text(member.id) && due.dueYear === year);
    const annualVersion = previous.length ? previous[0].annualVersion : 0;
    if (annualVersion !== entry.duesVersion) fail('VERSION_CONFLICT', '党费台账已改变，请刷新后重新登记');
    const months = list(entry.months);
    if (new Set(months.map(item => item.month)).size !== months.length) fail('INVALID_INPUT', '收缴月份重复');
    for (const month of months) if (!Number.isInteger(month.month) || month.month < 1 || month.month > 12 || !Number.isSafeInteger(month.amountCents) || month.amountCents < 0) fail('INVALID_INPUT', '收缴月份或金额不正确');
    if (entry.standardCents !== undefined && (!Number.isSafeInteger(entry.standardCents) || entry.standardCents < 0)) fail('INVALID_INPUT', '党费基数不正确');
  }
  for (const entry of entries) {
    const member = database.partyMembers.find(item => text(item.id) === text(entry.memberId));
    const old = partyDues(database).filter(item => text(item.partyMemberId) === text(entry.memberId) && item.dueYear === year);
    for (const item of old) mutateParty(database, 'DELETE', `/party/dues/${encodeURIComponent(item.id)}`, { baseVersion: item.version }, context);
    for (const item of entry.months) mutateParty(database, 'POST', '/party/dues', { partyMemberId: member.id, dueYear: year, dueMonth: item.month,
      amountCents: item.amountCents, status: entry.status === '免缴' ? '免缴' : '已缴', paidAt: entry.paidAt || '' }, context);
    if (entry.standardCents !== undefined) {
      member.duesStandardCents = entry.standardCents; member.dues_standard = entry.standardCents / 100; member.updatedAt = context.now().toISOString();
      const person = findResident(database, text(member.externalIdCard || member.id_card), text(member.name));
      if (person?.party_info) person.party_info.dues_standard = entry.standardCents / 100;
      if (person?.customFields?.party_info) person.customFields.party_info.dues_standard = entry.standardCents / 100;
    }
  }
  return { saved: entries.length, recordIds: entries.map(entry => entry.memberId), items: partyDues(database) };
}

function mutatePartyReference(database, method, path, body, context) {
  if (method === 'DELETE' && path === '/party/member-remove-batch') {
    const members = list(body.members);
    if (!members.length || members.length > 10000 || new Set(members.map(member => member.id)).size !== members.length) fail('INVALID_INPUT', '删除人员不正确');
    const rows = domainRows(database, '/party/members');
    for (const member of members) {
      const original = [...list(database.partyMembers), ...list(database.partyActivists)].find(record => text(record.id) === text(member.id));
      if (!original) fail('NOT_FOUND', '党员档案已删除，请刷新后重试');
      if (rows.find(row => row.id === original.id)?.memberType !== '流动党员') fail('INVALID_INPUT', '批量清理仅适用于流动党员档案');
      checkVersion(original, member.version);
    }
    for (const member of members) mutatePartyReference(database, 'DELETE', '/party/member-remove', { member }, context);
    return { deleted: true, recordIds: members.map(member => member.id) };
  }
  if (['POST', 'PATCH'].includes(method) && path === '/party/member-save') return saveMember(database, body, context);
  if (method === 'PATCH' && path === '/party/dues/batch') return replaceDues(database, body, context);
  if (method === 'DELETE' && path === '/party/member-remove') {
    const supplied = body.member || {};
    const original = [...list(database.partyMembers), ...list(database.partyActivists)].find(item => text(item.id) === text(supplied.id));
    if (original) checkVersion(original, supplied.version);
    const card = text(original?.externalIdCard || original?.id_card || supplied.id_card), name = text(original?.name || supplied.name);
    const person = findResident(database, card, name);
    if (person) {
      if (!original && body.residentVersion !== revision(person)) fail('VERSION_CONFLICT', '居民党员档案已改变，请刷新后重试');
      delete person.party_info;
      if (person.customFields) delete person.customFields.party_info;
      person.tags = list(person.tags).filter(tag => !partyTags.includes(tag));
    }
    if (original) mutateDomain(database, 'DELETE', `/party/members/${encodeURIComponent(original.id)}`, { baseVersion: revision(original) }, context);
    return { deleted: true, id: original?.id || person?.id };
  }
  return null;
}
module.exports = { mutatePartyReference };
