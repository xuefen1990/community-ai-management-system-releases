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

test('rejects a signed-in account without main-account scope instead of showing local data', async () => {
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

  await assert.rejects(() => store.read(), /缺少主账号归属/u);
  assert.equal(remoteRequests, 0);
});

test('uses the shared workspace for an account assigned to a main account', async () => {
  let subscribed = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { phone: '18888190901', mainAccountId: 'owner-1' } }),
      getWorkspaceBaseUrl: async () => 'http://192.168.1.10:3000',
      subscribeWorkspaceChanges: async () => { subscribed += 1; return () => {}; },
      request: async () => ({ version: 3, data: { contractFeeLedgers: [{ id: 'shared-ledger' }] } }),
    },
    localStore: { dataDirectory: '/tmp/community-local-store', read: async () => { throw new Error('不应读取本机台账'); } },
  });

  const data = await store.read();
  assert.deepEqual(data.contractFeeLedgers, [{ id: 'shared-ledger' }]);
  assert.equal(subscribed, 1);
});

test('reuses a defensive shared-workspace snapshot and refreshes it after a workspace change', async () => {
  let requestCount = 0;
  let notifyChanged = null;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { id: 'account-1', mainAccountId: 'owner-1' } }),
      getWorkspaceBaseUrl: async () => 'http://192.168.1.10:3000',
      subscribeWorkspaceChanges: async (callback) => { notifyChanged = callback; return () => {}; },
      request: async () => {
        requestCount += 1;
        return { version: requestCount, data: { personnel: [{ id: `resident-${requestCount}` }] } };
      },
    },
    localStore: { dataDirectory: '/tmp/community-local-store', read: async () => { throw new Error('不应读取本机台账'); } },
  });

  const first = await store.read();
  first.personnel[0].id = 'mutated-by-caller';
  const second = await store.read();
  assert.equal(requestCount, 1);
  assert.equal(second.personnel[0].id, 'resident-1');

  notifyChanged({ type: 'workspace-changed' });
  const refreshed = await store.read();
  assert.equal(requestCount, 2);
  assert.equal(refreshed.personnel[0].id, 'resident-2');
});

test('does not read cloud or local business data when signed in without a main-computer connection', async () => {
  let requests = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { id: 'member-1', mainAccountId: 'owner-1' } }),
      getWorkspaceBaseUrl: async () => { throw new Error('尚未连接局域网主电脑'); },
      request: async () => { requests += 1; return { data: { personnel: [{ id: 'cloud' }] } }; },
    },
    localStore: { dataDirectory: '/tmp/community-local-store', read: async () => { throw new Error('不应读取本机数据'); } },
  });
  await assert.rejects(() => store.read(), /尚未连接局域网主电脑/u);
  assert.equal(requests, 0);
});

test('主账号在当前电脑读取本地工作区，不要求连接其他主电脑', async () => {
  let checks = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { id: 'owner-1', mainAccountId: 'owner-1', role: 'main_account' } }),
      getWorkspaceBaseUrl: async () => 'http://127.0.0.1:3000',
      subscribeWorkspaceChanges: async () => () => {},
      checkLanWorkspace: async () => { checks += 1; throw new Error('主账号不应扫描局域网'); },
      request: async () => ({ version: 1, data: { personnel: [] } }),
    },
    localStore: { dataDirectory: '/tmp/local-owner', read: async () => { throw new Error('不能读取未隔离的旧本机库'); } },
  });
  assert.deepEqual((await store.read()).personnel, []);
  assert.deepEqual((await store.read()).personnel, []);
  assert.equal(checks, 0);
  assert.equal(await store.isRemoteChild(), false);
});

test('reuses a local snapshot and replaces it after a local write', async () => {
  let readCount = 0;
  let saved = null;
  const store = new RemoteDatabaseStore({
    authService: { getStatus: async () => ({ authenticated: false, account: null }) },
    localStore: {
      dataDirectory: '/tmp/community-local-store',
      read: async () => { readCount += 1; return { personnel: [{ id: 'old' }] }; },
      write: async (value) => { saved = structuredClone(value); return { ok: true }; },
    },
  });

  await store.read();
  await store.read();
  assert.equal(readCount, 1);
  await store.write({ personnel: [{ id: 'new' }] });
  assert.equal(saved.personnel[0].id, 'new');
  assert.equal((await store.read()).personnel[0].id, 'new');
  assert.equal(readCount, 1);
});

test('子电脑不能把新生成的本机附件路径写进主电脑业务记录', async () => {
  let writes = 0;
  const store = new RemoteDatabaseStore({
    authService: {
      getStatus: async () => ({ authenticated: true, account: { id: 'member-1', mainAccountId: 'owner-1' } }),
      getWorkspaceBaseUrl: async () => 'http://192.168.2.10:3000',
      subscribeWorkspaceChanges: async () => () => {},
      request: async (_path, options) => {
        if (options?.method === 'PUT') { writes += 1; return { version: 2 }; }
        return { version: 1, data: { documents: [] } };
      },
    },
    localStore: { dataDirectory: '/tmp/child-data', read: async () => { throw new Error('不能使用本机数据'); } },
  });
  await store.read();
  await assert.rejects(store.write({ documents: [{ id: 'doc-1', file_path: '/tmp/child-data/private.pdf' }] }), /附件必须保存到主电脑/);
  assert.equal(writes, 0);
});
