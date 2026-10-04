const PATH = '/api/v3/duty/people';

function requireSuccess(result, fallback) {
  if (!result?.ok) throw new Error(result?.error?.message || fallback);
  return result.data;
}

export function normalizeCadre(input) {
  const name = String(input?.name || '').trim();
  const phone = String(input?.phone || '').trim();
  const idCard = String(input?.idCard || '').trim().toUpperCase();
  const position = String(input?.position || '').trim();
  const duty = String(input?.duty || '').trim();
  const personId = String(input?.personId || '').trim();
  if (!name || name.length > 50) throw new Error('请输入 1 至 50 字的干部姓名');
  if (phone && !/^1\d{10}$/.test(phone)) throw new Error('联系电话应为 11 位手机号');
  if (idCard.length > 32) throw new Error('身份证号不能超过 32 字');
  if (position.length > 60) throw new Error('职位不能超过 60 字');
  if (duty.length > 200) throw new Error('负责内容不能超过 200 字');
  return { name, phone, idCard, position, duty, personId };
}

export async function searchCadreResidents(api, keyword) {
  const query = String(keyword || '').trim();
  if (!query) return [];
  const data = requireSuccess(await api.businessRequest({ path: `/api/v3/people?keyword=${encodeURIComponent(query)}&limit=12` }), '居民档案检索失败');
  return Array.isArray(data?.items) ? data.items.filter(person => person && person.id && person.name) : [];
}

export function applyResidentToCadre(form, person) {
  return {
    ...form,
    name: String(person?.name || '').trim(),
    phone: String(person?.phone || '').trim(),
    idCard: String(person?.idCard || person?.id_card || '').trim().toUpperCase(),
    personId: String(person?.id || ''),
  };
}

export async function readCadreRoster(api) {
  const data = requireSuccess(await api.businessRequest({ path: `${PATH}?personType=cadre&limit=100000` }), '干部名册读取失败');
  return (data.items || []).map(item => ({ ...item, duty: item.responsibility || item.duties || '', personId: item.personId || '' }));
}

export function assertUniqueCadre(roster, input) {
  const cadre = normalizeCadre(input);
  if (cadre.personId && roster.some(item => item.personId === cadre.personId)) throw new Error('该人员已加入摸底干部名册');
  if (cadre.phone && roster.some(item => item.phone === cadre.phone)) throw new Error('该手机号已在摸底干部名册中');
  return cadre;
}

export async function createCadre(api, input) {
  const cadre = assertUniqueCadre(await readCadreRoster(api), input);
  requireSuccess(await api.businessRequest({ method: 'POST', path: PATH, body: {
    operationUuid: globalThis.crypto.randomUUID(), personId: cadre.personId || undefined,
    name: cadre.name, phone: cadre.phone, idCard: cadre.idCard, position: cadre.position,
    responsibility: cadre.duty, personType: 'cadre',
  } }), '保存干部失败');
  return readCadreRoster(api);
}

export async function deleteCadre(api, cadre) {
  requireSuccess(await api.businessRequest({ method: 'DELETE', path: `${PATH}/${encodeURIComponent(cadre.id)}`, body: {
    operationUuid: globalThis.crypto.randomUUID(), baseVersion: cadre.version,
  } }), '移出干部失败');
  return readCadreRoster(api);
}
