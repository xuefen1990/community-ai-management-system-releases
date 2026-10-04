'use strict';
const { buildPersonnelView, applyPersonFields, checkVersion, revision, personRecordId, fail } = require('./foundation-data-model');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);

function batchPatch(database, body, { now }) {
  if (!Array.isArray(body.selection?.ids) || body.selection.ids.length > 100000) fail('INVALID_INPUT', '批量修改必须明确选择居民');
  const ids = new Set(body.selection.ids.map(text));
  const selected = list(database.personnel).map((person,index)=>({person,index,id:personRecordId(person,index)})).filter(entry => ids.has(entry.id));
  if (selected.length !== ids.size) fail('NOT_FOUND', '所选居民已发生变化，请刷新后重新选择');
  const patch = body.patch || {};
  if (Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'idCard')) fail('INVALID_INPUT', '身份证和居民编号不能批量覆盖');
  const tags = body.tagAction;
  if (tags && (!['add', 'remove', 'replace'].includes(tags.mode) || !Array.isArray(tags.tags))) fail('INVALID_INPUT', '专项身份修改方式不正确');
  const view = buildPersonnelView(database);
  let groupName = patch.villageGroupName;
  if (patch.villageGroupId) {
    const group = view.villageGroups.find(item => text(item.id) === text(patch.villageGroupId));
    if (!group) fail('NOT_FOUND', '目标居民组不存在');
    groupName = group.name;
  }
  const updates = selected.map(({person:original,index,id}) => {
    const next = structuredClone(original); applyPersonFields(next, patch);
    if (!text(next.id).trim()) next.id=id;
    if (groupName !== undefined) next.village_group = text(groupName).trim();
    if (Object.hasOwn(patch, 'householdNo')) next.household_id = text(patch.householdNo);
    if (tags) {
      const values = new Set(tags.tags.map(text).filter(Boolean));
      next.tags = tags.mode === 'replace' ? [...values] : tags.mode === 'add' ? [...new Set([...list(next.tags), ...values])] : list(next.tags).filter(tag => !values.has(tag));
    }
    next.updated_at = now().toISOString(); return {index,next};
  });
  const byIndex = new Map(updates.map(entry => [entry.index,entry.next]));
  database.personnel = database.personnel.map((record,index) => byIndex.get(index) || record);
  return { updatedRows: updates.length, affectedRows: updates.length, items: updates.map(({next}) => ({ id: next.id, version: revision(next) })) };
}

function mutateGroup(database, method, path, body) {
  if (!/^\/village-groups\/[^/]+$/.test(path)) return null;
  const id = decodeURIComponent(path.slice('/village-groups/'.length));
  const group = buildPersonnelView(database).villageGroups.find(item => text(item.id) === id);
  if (!group) fail('NOT_FOUND', '居民组不存在');
  if (Number(body.baseVersion) !== group.version) fail('VERSION_CONFLICT', '居民组已发生变化，请刷新后重试');
  const members = list(database.personnel).filter(person => person.village_group === group.name || text(person.villageGroupId) === id);
  if (method === 'DELETE') {
    if (members.length) fail('GROUP_IN_USE', '居民组中仍有居民，请先调整居民分组');
    database.village_groups = list(database.village_groups).filter(item => typeof item === 'string' ? item !== group.name : text(item.id) !== id && item.name !== group.name);
    return { deleted: true, id };
  }
  if (method !== 'PATCH') fail('METHOD_NOT_ALLOWED', '居民组操作方式不正确');
  const changes = body.changes || body;
  const name = text(changes.name ?? group.name).trim();
  if (!name) fail('INVALID_INPUT', '居民组名称不能为空');
  if (buildPersonnelView(database).villageGroups.some(item => item.name === name && text(item.id) !== id)) fail('DUPLICATE_GROUP', '该居民组名称已存在');
  const stored = list(database.village_groups).find(item => typeof item === 'object' && text(item.id) === id);
  const next = { ...(stored || {}), id, name, sortOrder: changes.sortOrder ?? group.sortOrder };
  database.village_groups = list(database.village_groups).filter(item => typeof item === 'string' ? item !== group.name : text(item.id) !== id && item.name !== group.name);
  database.village_groups.push(next);
  for (const person of members) person.village_group = name;
  const item = { ...next, version: revision(next) }; return { group: item, item };
}

function mutateCategory(database, method, path, body, { uuid, now }) {
  const paths = { '/special-categories': ['specialCategories', 'category'], '/dictionaries': ['foundationDictionaries', 'item'] };
  const base = Object.keys(paths).find(key => key === path || path.startsWith(`${key}/`));
  if (!base) return null;
  const [key, response] = paths[base]; const rows = database[key] ||= [];
  const id = path === base ? '' : decodeURIComponent(path.slice(base.length + 1));
  const index = rows.findIndex(item => text(item.id) === id);
  const original = index >= 0 ? rows[index] : null;
  if (method !== 'POST' && !original) fail('NOT_FOUND', '原配置不存在');
  if (original) checkVersion(original, body.baseVersion);
  if (method === 'DELETE') { rows.splice(index, 1); return { deleted: true, id }; }
  if (!['POST', 'PATCH'].includes(method)) fail('METHOD_NOT_ALLOWED', '配置操作方式不正确');
  const changes = method === 'POST' ? body : body.changes || {};
  const next = { ...(original || {}), ...structuredClone(changes), id: original?.id || body.id || uuid(), updatedAt: now().toISOString() };
  for (const meta of ['baseVersion', 'baseValues', 'operationUuid']) delete next[meta];
  if (base === '/special-categories' && !text(next.name).trim()) fail('INVALID_INPUT', '专项类别名称不能为空');
  if (base === '/dictionaries' && (!text(next.category).trim() || !text(next.label || next.name || next.value).trim())) fail('INVALID_INPUT', '字典类别和名称不能为空');
  if (rows.some(item => item !== original && text(item.id) === text(next.id))) fail('DUPLICATE_RECORD', '配置编号已存在');
  if (index >= 0) rows[index] = next; else rows.push(next);
  const item = { ...next, version: revision(next) }; return { item, [response]: item };
}

function mutatePersonnelAction(database, method, path, body, options) {
  if (method === 'POST' && path === '/people/batch-patch') return batchPatch(database, body, options);
  return mutateGroup(database, method, path, body) || mutateCategory(database, method, path, body, options);
}
module.exports = { mutatePersonnelAction };
