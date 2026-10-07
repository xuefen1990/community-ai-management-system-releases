'use strict';
const { buildPersonnelView, revision, checkVersion, derivedId, fail } = require('./foundation-data-model');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);

function householdLinks(database, personnel = buildPersonnelView(database)) {
  const households = new Map(personnel.households.flatMap(item => [[text(item.id), item], [text(item.householdNo), item]]));
  return list(database.householdGroups).map(record => {
    const resolve = value => households.get(text(value))?.id || text(value);
    const rawMembers = list(record.members).length ? record.members : list(record.memberHouseholdIds || record.householdIds).map(id => ({ householdId: id }));
    const mainHouseholdId = resolve(record.mainHouseholdId || record.main_household_id || rawMembers[0]?.householdId);
    const members = rawMembers.map(member => ({ ...structuredClone(member),
      id: member.id || derivedId('household-member', `${record.id}:${member.householdId}`),
      householdId: resolve(member.householdId), version: revision(member) }));
    return { ...structuredClone(record), mainHouseholdId, members, version: revision(record) };
  });
}

function mutateHouseholdLink(database, method, path, body, { uuid, now }) {
  const match = path.match(/^\/household-link-groups(?:\/([^/]+)(?:\/members(?:\/([^/]+))?)?)?$/);
  if (!match) return null;
  const id = match[1] && decodeURIComponent(match[1]);
  const memberId = match[2] && decodeURIComponent(match[2]);
  const personnel = buildPersonnelView(database);
  const views = householdLinks(database, personnel);
  const original = list(database.householdGroups).find(item => text(item.id) === id);
  const view = views.find(item => text(item.id) === id);
  if (id && !original) fail('NOT_FOUND', '关联户组不存在');
  const requireHouseholds = ids => {
    const unique = [...new Set(ids.map(text).filter(Boolean))];
    const rows = unique.map(value => personnel.households.find(item => text(item.id) === value));
    if (rows.some(item => !item)) fail('NOT_FOUND', '所选家庭档案不存在，请刷新后重试');
    for (const other of views) if (text(other.id) !== id && rows.some(item => other.mainHouseholdId === item.id || other.members.some(member => member.householdId === item.id))) {
      fail('HOUSEHOLD_ALREADY_LINKED', '所选家庭已属于其他关联户组');
    }
    return rows;
  };
  let next;
  if (!id && method === 'POST') {
    const households = requireHouseholds([body.mainHouseholdId, ...list(body.memberHouseholdIds)]);
    if (!body.mainHouseholdId || households.length < 2) fail('INVALID_INPUT', '关联户至少需要主户和另一个家庭');
    next = { id: uuid(), name: text(body.name).trim(), notes: text(body.notes), mainHouseholdId: text(body.mainHouseholdId),
      members: households.map(item => ({ id: uuid(), householdId: item.id })), createdAt: now().toISOString() };
    // Persist derived household identities only when they acquire a link.
    // A later resident move must not silently destroy an established link.
    database.households ||= [];
    for (const row of households) if (!database.households.some(item => text(item.id) === text(row.id))) {
      const { version, ...stored } = row; database.households.push(stored);
    }
    (database.householdGroups ||= []).push(next);
  } else if (path.endsWith('/members') && method === 'POST') {
    const [household] = requireHouseholds([body.householdId]);
    if (!household) fail('INVALID_INPUT', '请选择需要关联的家庭');
    if (view.members.some(item => item.householdId === household.id)) return { group: view, item: view };
    next = { ...structuredClone(original), members: view.members.map(({ version, ...item }) => item) };
    next.members.push({ id: uuid(), householdId: household.id });
    database.households ||= [];
    if (!database.households.some(item => text(item.id) === household.id)) { const { version, ...stored } = household; database.households.push(stored); }
  } else if (memberId && method === 'DELETE') {
    const member = view.members.find(item => text(item.id) === memberId);
    if (!member) fail('NOT_FOUND', '关联家庭已移除');
    if (Number(body.baseVersion) !== member.version) fail('VERSION_CONFLICT', '关联关系已改变，请刷新后重试');
    if (member.householdId === view.mainHouseholdId) fail('MAIN_HOUSEHOLD_REQUIRED', '不能单独移除主户，请解除整个关联户组');
    next = { ...structuredClone(original), members: view.members.filter(item => text(item.id) !== memberId).map(({ version, ...item }) => item) };
  } else if (id && !path.includes('/members') && ['PATCH', 'DELETE'].includes(method)) {
    checkVersion(original, body.baseVersion);
    if (method === 'DELETE') {
      (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: '/household-link-groups', record: structuredClone(original), deletedAt: now().toISOString() });
      database.householdGroups = database.householdGroups.filter(item => text(item.id) !== id);
      return { deleted: true, id };
    }
    next = { ...structuredClone(original), name: text(body.changes?.name ?? original.name), notes: text(body.changes?.notes ?? original.notes) };
  } else fail('METHOD_NOT_ALLOWED', '关联户操作方式不正确');
  next.updatedAt = now().toISOString();
  if (original) database.householdGroups[database.householdGroups.indexOf(original)] = next;
  const item = householdLinks(database).find(row => text(row.id) === text(next.id));
  return { group: item, item };
}
module.exports = { householdLinks, mutateHouseholdLink };
