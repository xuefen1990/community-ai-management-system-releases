'use strict';
const { revision, derivedId, fail } = require('./foundation-data-model');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const FLEXIBLE_ID = 'foundation:duty:flexible';
function dutyPlans(database) {
  const rows = list(database.dutyRecords).map(record => ({ ...structuredClone(record), version: revision(record),
    days: Array.isArray(record.days) ? structuredClone(record.days) : Object.entries(record.schedules || {}).map(([dutyDate, names]) => ({ dutyDate,
      assignments: list(names).map(name => ({ id: derivedId('duty-assignment', `${record.id}:${dutyDate}:${text(name)}`), nameSnapshot: text(name), dutyDate })) })) }));
  const schedule = database.dutyFlexible?.schedule || {};
  const days = Object.entries(schedule).map(([dutyDate, names]) => ({ dutyDate, assignments: list(names).map(name => ({
    id: derivedId('duty-assignment', `${FLEXIBLE_ID}:${dutyDate}:${text(name)}`), dutyDate, nameSnapshot: text(name), shiftName: '全天', role: '值班员',
  })) }));
  if (days.length) rows.push({ id: FLEXIBLE_ID, theme: '日常常规值班', title: '日常常规值班',
    startDate: days.map(day => day.dutyDate).sort()[0], endDate: days.map(day => day.dutyDate).sort().at(-1), days, version: revision(schedule) });
  return rows;
}
function date(value) {
  const text = String(value || ''); const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail('INVALID_INPUT', '值班日期不正确');
  return text;
}
function mutateDuty(database, method, path, body, { now, uuid }) {
  if (path === '/duty/plans' && method === 'POST') {
    const startDate = date(body.startDate), endDate = date(body.endDate);
    if (endDate < startDate) fail('INVALID_INPUT', '结束日期不能早于开始日期');
    const theme = text(body.theme || body.title).trim();
    if (!theme) fail('INVALID_INPUT', '请填写值班主题');
    const record = { id: uuid(), theme, title: text(body.title || theme), startDate, endDate, days: structuredClone(list(body.days)), createdAt: now().toISOString() };
    for (const day of record.days) {
      if (date(day.dutyDate) < startDate || day.dutyDate > endDate) fail('INVALID_INPUT', '排班日期超出计划范围');
      day.assignments = list(day.assignments).map(item => ({ ...item, id: uuid(), dutyDate: day.dutyDate }));
    }
    (database.dutyRecords ||= []).push(record);
    const item = dutyPlans(database).find(item => item.id === record.id); return { plan: item, item };
  }
  if (path !== '/duty/assignments') return null;
  if (!['POST', 'DELETE'].includes(method)) fail('METHOD_NOT_ALLOWED', '排班操作方式不正确');
  const dutyDate = date(body.dutyDate);
  const view = dutyPlans(database).find(item => text(item.id) === text(body.planId));
  if (!view) fail('NOT_FOUND', '值班计划不存在');
  if (view.id !== FLEXIBLE_ID && (view.startDate && dutyDate < view.startDate || view.endDate && dutyDate > view.endDate)) fail('INVALID_INPUT', '排班日期超出计划范围');
  const plan = structuredClone(view);
  let day = plan.days.find(item => item.dutyDate === dutyDate);
  if (!day) { day = { dutyDate, assignments: [] }; plan.days.push(day); }
  let assignment;
  if (method === 'POST') {
    const name = text(body.nameSnapshot).trim();
    if (!name) fail('INVALID_INPUT', '请选择值班人员');
    assignment = day.assignments.find(item => item.nameSnapshot === name && (item.shiftName || '全天') === (body.shiftName || '全天'));
    if (!assignment) {
      assignment = { id: uuid(), dutyDate, nameSnapshot: name, personId: body.personId || body.dutyPersonId || null,
        phoneSnapshot: body.phoneSnapshot || '', shiftName: body.shiftName || '全天', role: body.role || '值班员' };
      day.assignments.push(assignment);
    }
  } else {
    const matches = item => body.assignmentId ? text(item.id) === text(body.assignmentId) : item.nameSnapshot === body.nameSnapshot;
    if (!day.assignments.some(matches)) fail('NOT_FOUND', '该排班已不存在，请刷新后重试');
    day.assignments = day.assignments.filter(item => !matches(item));
  }
  if (view.id === FLEXIBLE_ID) {
    database.dutyFlexible ||= {}; database.dutyFlexible.schedule ||= {};
    database.dutyFlexible.schedule[dutyDate] = [...new Set(day.assignments.map(item => item.nameSnapshot))];
  } else {
    const original = database.dutyRecords.find(item => text(item.id) === text(view.id));
    original.days = plan.days; original.updatedAt = now().toISOString();
    // Keep the old per-plan schedule readable by historical workbench code.
    original.schedules = Object.fromEntries(plan.days.map(item => [item.dutyDate, [...new Set(item.assignments.map(value => value.nameSnapshot))]]));
  }
  return { item: assignment || { id: body.assignmentId }, assignment, deleted: method === 'DELETE' };
}
module.exports = { dutyPlans, mutateDuty, FLEXIBLE_ID };
