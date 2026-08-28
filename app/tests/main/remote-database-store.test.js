'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { RemoteDatabaseStore, normalize } = require('../../src/main/remote-database-store');

test('normalizes legacy remote workspaces with contract fee collections', () => {
  const database = normalize({ version: 3, personnel: [{ id: 'p-1' }], landParcel: [{ id: 'land-1' }] });

  assert.equal(database.version, 4);
  assert.deepEqual(database.personnel, [{ id: 'p-1' }]);
  assert.deepEqual(database.landParcel, [{ id: 'land-1' }]);
  assert.deepEqual(database.resourceContracts, []);
  assert.deepEqual(database.contractFeeLedgers, []);
  assert.deepEqual(database.contractFeeBatches, []);
  assert.deepEqual(database.contractFeeReceipts, []);
  assert.deepEqual(database.contractFeeAdvances, []);
});

test('keeps existing contract fee collections from a remote workspace', () => {
  const database = normalize({
    resourceContracts: [{ id: 'c-1' }],
    contractFeeLedgers: [{ id: 'l-1' }],
    contractFeeBatches: [{ id: 'b-1' }],
    contractFeeReceipts: [{ id: 'r-1' }],
    contractFeeAdvances: [{ id: 'a-1' }],
  });

  assert.deepEqual(database.resourceContracts, [{ id: 'c-1' }]);
  assert.deepEqual(database.contractFeeLedgers, [{ id: 'l-1' }]);
  assert.deepEqual(database.contractFeeBatches, [{ id: 'b-1' }]);
  assert.deepEqual(database.contractFeeReceipts, [{ id: 'r-1' }]);
  assert.deepEqual(database.contractFeeAdvances, [{ id: 'a-1' }]);
});

test('uses the local ledger for a signed-in legacy account that has no shared unit workspace', async () => {
  const localData = { version: 4, contractFeeLedgers: [{ id: 'legacy-ledger' }] };
  let remoteRequests = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { phone: '17505270901', organizationId: null } }),
      request: async () => { remoteRequests += 1; throw new Error('不应请求共享工作区'); },
    },
    localStore: {
      dataDirectory: '/tmp/community-local-store',
      read: async () => localData,
      write: async (value) => value,
    },
  });

  const data = await store.read();
  assert.deepEqual(data.contractFeeLedgers, localData.contractFeeLedgers);
  assert.equal(remoteRequests, 0);
});

test('uses the shared workspace only for an account assigned to a unit', async () => {
  let subscribed = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { phone: '18888190901', organizationId: 'unit-1' } }),
      subscribeWorkspaceChanges: async () => { subscribed += 1; return () => {}; },
      request: async () => ({ version: 3, data: { contractFeeLedgers: [{ id: 'shared-ledger' }] } }),
    },
    localStore: { dataDirectory: '/tmp/community-local-store', read: async () => { throw new Error('不应读取本机台账'); } },
  });

  const data = await store.read();
  assert.deepEqual(data.contractFeeLedgers, [{ id: 'shared-ledger' }]);
  assert.equal(subscribed, 1);
});
