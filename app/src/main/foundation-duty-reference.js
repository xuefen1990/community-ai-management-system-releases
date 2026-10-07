'use strict';
const { revision, fail } = require('./foundation-data-model');
const { dutyPlans, mutateDuty } = require('./foundation-duty');
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const DEFAULT_TASKS = ['秸秆禁烧', '防汛', '除雪', '节假日值班', '日常常规值班'];
function dutyTasks(database) {
  const saved = list(database.foundationDictionaries).filter(item => item.category === 'duty_category');
  if (saved.length || database.foundationDutyTasksConfigured) return saved.map(item => ({ ...item, version: revision(item) }));
  return DEFAULT_TASKS.map((label, index) => ({ id: `default-duty-task-${index}`, category: 'duty_category', label, name: label, code: `duty-${index}`, sortOrder: index, version: 1 }));
}
function validDate(value) {
  const date = text(value), parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('INVALID_INPUT', '排班日期不正确');
  return date;
}
function monthDates(year, month, rule = 'all') {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || !['all', 'workday', 'weekend', 'odd', 'even'].includes(rule)) fail('INVALID_INPUT', '排班月份或规则不正确');
  const dates = [], days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    const date = new Date(Date.UTC(year, month - 1, day)), weekend = [0, 6].includes(date.getUTCDay());
    if (rule === 'all' || rule === 'workday' && !weekend || rule === 'weekend' && weekend || rule === 'odd' && day % 2 === 1 || rule === 'even' && day % 2 === 0) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
function mutateDutyReference(database, method, path, body, context) {
  if (path === '/duty/tasks' || /^\/duty\/tasks\/[^/]+$/.test(path)) {
    const previousTasks = dutyTasks(database);
    database.foundationDictionaries ||= [];
    if (!database.foundationDutyTasksConfigured) {
      database.foundationDictionaries.push(...dutyTasks(database).filter(item => !database.foundationDictionaries.some(existing => existing.id === item.id)));
      database.foundationDutyTasksConfigured = true;
    }
    if (path === '/duty/tasks' && method === 'POST') {
      const label = text(body.label || body.name);
      if (!label) fail('INVALID_INPUT', '任务名称不能为空');
      if (dutyTasks(database).some(item => item.label === label)) fail('DUPLICATE_RECORD', '该值班任务已存在');
      const task = { id: context.uuid(), category: 'duty_category', label, name: label, code: text(body.code) || context.uuid(), sortOrder: Number(body.sortOrder) || 0 };
      database.foundationDictionaries.push(task);
      return { item: { ...task, version: revision(task) } };
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/duty/tasks/'.length)), item = dutyTasks(database).find(task => text(task.id) === id);
      if (!item) fail('NOT_FOUND', '值班任务已不存在');
      if (body.baseVersion !== previousTasks.find(task => text(task.id) === id)?.version) fail('VERSION_CONFLICT', '值班任务已改变，请刷新');
      database.foundationDictionaries = database.foundationDictionaries.filter(task => text(task.id) !== id);
      return { deleted: true, id };
    }
    fail('METHOD_NOT_ALLOWED', '值班任务操作不正确');
  }
  if (path !== '/duty/schedule' || method !== 'PATCH') return null;
  const plans = dutyPlans(database);
  if (body.baseVersion !== revision(plans)) fail('VERSION_CONFLICT', '排班已被另一端修改，请刷新后重试');
  const people = [...list(database.dutyCadres), ...list(database.dutyPublicPosts)];
  const taskNames = new Set([...dutyTasks(database).map(item => item.label), ...plans.map(plan => plan.theme || plan.title)]);
  let additions = [], removals = [];
  const currentAssignments = (date, task = '') => plans.flatMap(plan => !task || (plan.theme || plan.title) === task ? list(plan.days).filter(day => day.dutyDate === date)
    .flatMap(day => list(day.assignments).map(item => ({ ...item, planId: plan.id, task: plan.theme || plan.title, date }))) : []);
  const namesToAdd = (dates, tasks, names) => {
    if (!tasks.length || !names.length || tasks.some(task => !taskNames.has(task))) fail('INVALID_INPUT', '请选择有效任务和人员');
    for (const name of names) if (!people.some(person => text(person.name) === name)) fail('NOT_FOUND', `值班人员 ${name} 已改变，请刷新`);
    return dates.flatMap(date => tasks.flatMap(task => names.map(name => ({ date, task, name }))));
  };
  if (body.action === 'bulk') additions = namesToAdd(monthDates(Number(body.year), Number(body.month), body.rule), [...new Set(list(body.tasks).map(text))], [...new Set(list(body.names).map(text))]);
  else if (body.action === 'replace-day') {
    const date = validDate(body.date), task = text(body.task), names = [...new Set(list(body.names).map(text))];
    if (!taskNames.has(task)) fail('INVALID_INPUT', '值班任务不存在');
    removals = currentAssignments(date, task).filter(item => !names.includes(item.nameSnapshot));
    additions = names.length ? namesToAdd([date], [task], names) : [];
  } else if (body.action === 'clear-month') removals = monthDates(Number(body.year), Number(body.month)).flatMap(date => currentAssignments(date));
  else if (body.action === 'copy') {
    const pairs = list(body.pairs);
    if (pairs.length > 366) fail('INVALID_INPUT', '复制日期数量过多');
    for (const pair of pairs) {
      const source = validDate(pair.source), date = validDate(pair.target);
      additions.push(...currentAssignments(source).map(item => ({ date, task: item.task, name: item.nameSnapshot, personId: item.personId, phoneSnapshot: item.phoneSnapshot })));
    }
  } else fail('INVALID_INPUT', '排班操作不正确');
  if (additions.length > 100000) fail('INVALID_INPUT', '排班数量过多，请分月操作');
  for (const item of removals) mutateDuty(database, 'DELETE', '/duty/assignments', { planId: item.planId, dutyDate: item.date, assignmentId: item.id }, context);
  let added = 0;
  for (const item of additions) {
    if (dutyPlans(database).some(plan => (plan.theme || plan.title) === item.task && list(plan.days).some(day => day.dutyDate === item.date && list(day.assignments).some(assignment => assignment.nameSnapshot === item.name)))) continue;
    let plan = dutyPlans(database).find(plan => (plan.theme || plan.title) === item.task && plan.startDate <= item.date && plan.endDate >= item.date);
    if (!plan) plan = mutateDuty(database, 'POST', '/duty/plans', { title: item.task, theme: item.task, startDate: `${item.date.slice(0, 4)}-01-01`, endDate: `${item.date.slice(0, 4)}-12-31` }, context).plan;
    const person = people.find(person => text(person.name) === item.name);
    if (!list(plan.days).find(day => day.dutyDate === item.date)?.assignments.some(assignment => assignment.nameSnapshot === item.name)) added++;
    mutateDuty(database, 'POST', '/duty/assignments', { planId: plan.id, dutyDate: item.date, nameSnapshot: item.name,
      personId: person?.id || item.personId, phoneSnapshot: person?.phone || item.phoneSnapshot || '', role: '值班员', shiftName: '全天' }, context);
  }
  return { added, removed: removals.length, revision: revision(dutyPlans(database)) };
}
module.exports = { dutyTasks, monthDates, mutateDutyReference };
