// All migrated components use the authoritative local/LAN business service.
// The reference application's authentication, server and data are never used.
export async function referenceRequest(input, options = {}) {
  const request = typeof input === 'string' ? { ...options, path: input } : { ...input };
  if (!request.path.startsWith('/api/v3/')) request.path = `/api/v3${request.path}`;
  if (request.path === '/api/v3/dictionaries' && request.method === 'POST' && request.body?.category === 'duty_category') request.path = '/api/v3/duty/tasks';
  if (request.method === 'DELETE' && request.path.startsWith('/api/v3/dictionaries/')) {
    const tasks = await referenceRequest('/duty/tasks');
    const id = decodeURIComponent(request.path.slice('/api/v3/dictionaries/'.length));
    const task = tasks.items.find(item => String(item.id) === id);
    if (task) { request.path = `/api/v3/duty/tasks/${encodeURIComponent(id)}`; request.body = { ...request.body }; }
  }
  const result = await window.api.businessRequest(JSON.parse(JSON.stringify(request)));
  if (!result?.ok) {
    const error = new Error(result?.error?.message || '业务操作失败，请重试');
    error.code = result?.error?.code;
    throw error;
  }
  return result.data;
}

export const saveDutySchedule = body => referenceRequest({ method: 'PATCH', path: '/duty/schedule', body });

export async function savePartyMember({ member, form = {} }) {
  return referenceRequest({ method: member?.id && !member.id.startsWith('party_auto_') ? 'PATCH' : 'POST', path: '/party/member-save', body: { member: member || {}, form } });
}
export async function ensurePartyMember(member) {
  if (member?.id && !member.id.startsWith('party_auto_')) return member.id;
  const result = await referenceRequest({ method: 'POST', path: '/party/member-save', body: { member, ensureOnly: true,
    form: { memberType: member.member_type, branchId: member.branchId } } });
  return result.member.id;
}
export async function removePartyMember(member) {
  return referenceRequest({ method: 'DELETE', path: '/party/member-remove', body: { member, residentVersion: member.residentVersion } });
}
export const removePartyMembers = members => referenceRequest({ method: 'DELETE', path: '/party/member-remove-batch', body: { members } });

export async function savePartyDuesBatch({ year, entries }) {
  return referenceRequest({ method: 'PATCH', path: '/party/dues/batch', body: { year: Number(year), entries: entries.map(entry => ({
    member: entry.member, duesVersion: entry.previous?.annualVersion || 0,
    months: entry.months, paidAt: entry.paidAt, standardCents: entry.standardCents, status: entry.status,
  })) } });
}
