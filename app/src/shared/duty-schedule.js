'use strict';

// Read both historical daily schedules and the new theme-based plans. Keep
// source collections separate so AI undo only touches the schedule it wrote.
function dutySchedule(database) {
  const schedule = {};
  const add = (date, names) => {
    if (!Array.isArray(names)) return;
    const existing = schedule[date] ||= [];
    for (const value of names) {
      const name = String(value ?? '').trim();
      if (name && !existing.includes(name)) existing.push(name);
    }
  };
  for (const [date, names] of Object.entries(database.dutyFlexible?.schedule || {})) add(date, names);
  for (const plan of database.dutyRecords || []) {
    if (plan.deletedAt || plan.deleted_at) continue;
    if (Array.isArray(plan.days)) for (const day of plan.days) add(day.dutyDate, (day.assignments || []).map(item => item.nameSnapshot));
    else for (const [date, names] of Object.entries(plan.schedules || {})) add(date, names);
  }
  return schedule;
}
module.exports = { dutySchedule };
