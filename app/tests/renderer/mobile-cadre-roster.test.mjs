import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResidentToCadre, assertUniqueCadre, createCadre, deleteCadre, readCadreRoster, searchCadreResidents } from '../../src/renderer/foundation/mobile-cadre-roster.mjs';

test('mobile roster uses the same duty cadre records as the workbench', async () => {
  let rows = [];
  const calls = [];
  const api = { async businessRequest(request) {
    calls.push(request);
    if (request.method === 'POST') rows.push({ ...request.body, id: 'cadre-1', version: 1 });
    if (request.method === 'DELETE') rows = rows.filter(item => item.id !== 'cadre-1');
    return { ok: true, data: { items: rows, person: rows[0], deleted: true } };
  } };
  const saved = await createCadre(api, { name: '测试干部', phone: '13800000000', idCard: '11010119900101123x', position: '网格员', duty: '走访摸底', personId: 'resident-1' });
  assert.equal(saved[0].duty, '走访摸底');
  assert.equal(saved[0].personId, 'resident-1');
  assert.equal(saved[0].idCard, '11010119900101123X');
  assert.equal(calls.find(item => item.method === 'POST').path, '/api/v3/duty/people');
  assert.equal((await readCadreRoster(api)).length, 1);
  assert.deepEqual(await deleteCadre(api, saved[0]), []);
  assert.equal(calls.find(item => item.method === 'DELETE').body.baseVersion, 1);
});

test('resident search returns matching archive and selection fills name, phone and identity card', async () => {
  const requests = [];
  const api = { async businessRequest(request) {
    requests.push(request);
    return { ok: true, data: { items: [{ id: 'resident-1', name: '张三', phone: '13800000000', idCard: '11010119900101123X' }] } };
  } };
  const matches = await searchCadreResidents(api, ' 张三 ');
  assert.equal(requests[0].path, '/api/v3/people?keyword=%E5%BC%A0%E4%B8%89&limit=12');
  assert.deepEqual(applyResidentToCadre({ position: '网格员' }, matches[0]), {
    position: '网格员', name: '张三', phone: '13800000000', idCard: '11010119900101123X', personId: 'resident-1',
  });
  assert.deepEqual(await searchCadreResidents(api, ' '), []);
  assert.equal(requests.length, 1);
  const failed = { businessRequest: async () => ({ ok: false, error: { message: '无权读取居民库' } }) };
  await assert.rejects(searchCadreResidents(failed, '张'), /无权读取居民库/);
});

test('cadre roster rejects duplicate resident or phone and invalid contact number', () => {
  const existing = [{ id: 'cadre-1', name: '已有干部', phone: '13800000000', personId: 'resident-1' }];
  assert.throws(() => assertUniqueCadre(existing, { name: '重复人员', personId: 'resident-1' }), /已加入/);
  assert.throws(() => assertUniqueCadre(existing, { name: '重复手机', phone: '13800000000' }), /手机号已在/);
  assert.throws(() => assertUniqueCadre(existing, { name: '号码错误', phone: '123' }), /11 位手机号/);
});
