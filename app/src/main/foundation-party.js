'use strict';
const { revision, derivedId, fail } = require('./foundation-data-model');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
function dueEntries(database) {
  return list(database.partyDues).flatMap((record, index) => {
    if (record.dueMonth) return [{ record, index, item: { ...structuredClone(record), version: revision(record) } }];
    const months = list(record.paid_months);
    return [...new Set(months.map(Number))].filter(month => month >= 1 && month <= 12).map(month => ({ record, index, month,
      item: { ...structuredClone(record), id: derivedId('party-due', `${record.id || record.member_id || record.id_card || index}:${record.year}:${month}`),
        version: revision({ id: record.id, member: record.member_id || record.partyMemberId || record.id_card, year: record.year, month,
          amount: record.monthly_amounts?.[month] ?? record.monthly_amount, paidAt: record.paid_date }), partyMemberId: record.member_id || record.partyMemberId,
        dueYear: Number(record.year), dueMonth: month, amountCents: Math.round(Number(record.monthly_amounts?.[month] ?? record.monthly_amount ?? 0) * 100),
        status: '已缴', paidAt: record.paid_date || '',
      } }));
  });
}
function partyDues(database) { return dueEntries(database).map(entry => entry.item); }
function mutateParty(database, method, path, body, { now, uuid }) {
  const development = path.match(/^\/party\/members\/([^/]+)\/development$/);
  if (development && method === 'POST') {
    const member = list(database.partyMembers).find(item => text(item.id) === decodeURIComponent(development[1]));
    if (!member) fail('NOT_FOUND', '党员档案不存在');
    const event = { id: uuid(), stage: text(body.stage), eventDate: body.eventDate || now().toISOString().slice(0, 10),
      contacts: structuredClone(list(body.contacts)), remarks: text(body.remarks), createdAt: now().toISOString() };
    if (!event.stage) fail('INVALID_INPUT', '请选择发展阶段');
    (member.development ||= []).push(event); member.stage = event.stage;
    const phone = event.contacts.find(contact => contact.phone)?.phone;
    if (phone) member.phone = phone;
    member.updatedAt = now().toISOString();
    return { event, item: { ...structuredClone(member), version: revision(member) } };
  }
  if (path === '/party/dues' && method === 'POST') {
    const year = Number(body.dueYear), month = Number(body.dueMonth), amount = Number(body.amountCents);
    if (!text(body.partyMemberId) || !Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(amount) || amount < 0) fail('INVALID_INPUT', '党费人员、年度、月份或金额不正确');
    if (partyDues(database).some(item => text(item.partyMemberId) === text(body.partyMemberId) && item.dueYear === year && item.dueMonth === month)) fail('DUPLICATE_DUE', '该党员本月已有交费记录，请刷新后修改');
    const member = list(database.partyMembers).find(item => text(item.id) === text(body.partyMemberId));
    if (!member) fail('NOT_FOUND', '请先保存党员档案再登记党费');
    const record = { id: uuid(), partyMemberId: member.id, member_id: member.id, id_card: member.externalIdCard || member.id_card || '',
      dueYear: year, year, dueMonth: month, amountCents: amount, status: body.status || '已缴', paidAt: body.paidAt || '', createdAt: now().toISOString() };
    (database.partyDues ||= []).push(record); const item = { ...record, version: revision(record) }; return { due: item, item };
  }
  if (/^\/party\/dues\/[^/]+$/.test(path) && method === 'DELETE') {
    const id = decodeURIComponent(path.slice('/party/dues/'.length));
    const entry = dueEntries(database).find(entry => text(entry.item.id) === id);
    if (!entry) fail('NOT_FOUND', '党费记录不存在');
    if (Number(body.baseVersion) !== entry.item.version) fail('VERSION_CONFLICT', '党费记录已改变，请刷新后重试');
    (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: '/party/dues', record: structuredClone(entry.item), deletedAt: now().toISOString() });
    if (entry.month) {
      entry.record.paid_months = entry.record.paid_months.filter(month => Number(month) !== entry.month);
      entry.record.status = entry.record.paid_months.length ? '部分交纳' : '未交纳';
    } else database.partyDues.splice(entry.index, 1);
    return { deleted: true, id };
  }
  return null;
}
module.exports = { partyDues, mutateParty };
