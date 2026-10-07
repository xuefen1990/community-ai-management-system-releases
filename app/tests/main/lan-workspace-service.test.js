'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { LanWorkspaceService } = require('../../src/main/lan-workspace-service');
const { createEmptyDatabase } = require('../../src/main/empty-database');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function request(port, pathname, token = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: token ? { Authorization: `Bearer ${token}` } : {} }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('主电脑共享服务校验主账号归属并按成员权限过滤数据', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profiles = new Map([
    ['member-token', { id: 'member-1', mainAccountId: 'owner-1', role: 'member', isActive: true, permissions: { funds: ['view'] } }],
    ['wrong-owner-token', { id: 'member-2', mainAccountId: 'other-owner', role: 'member', isActive: true, permissions: { funds: ['view'] } }],
  ]);
  const service = new LanWorkspaceService({
    userDataPath: root,
    port: 0,
    host: '127.0.0.1',
    fetchImpl: async (url, options) => response(200, url.endsWith('/api/auth/entitlement')
      ? { valid: true, plan: 'permanent' } : { user: profiles.get(options.headers.Authorization.replace('Bearer ', '')) }),
  });
  await service.initialize({
    ownerId: 'owner-1',
    cloudBaseUrl: 'https://account.example.com',
    sourceVersion: 7,
    data: { disbursementBatches: [{ id: 'batch-1' }], personnel: [{ id: 'person-1' }] },
  });
  t.after(() => service.stop());
  const port = service.info().port;

  assert.deepEqual(await request(port, '/api/health'), { status: 200, body: { status: 'ok', service: 'community-ai-backend', mode: 'lan-workspace' } });
  assert.equal((await request(port, '/api/lan/status', 'wrong-owner-token')).status, 403);
  const data = await request(port, '/api/unit/workspace/data', 'member-token');
  assert.equal(data.status, 200);
  assert.deepEqual(data.body.data.disbursementBatches, [{ id: 'batch-1' }]);
  assert.equal(data.body.data.personnel, undefined);
  assert.equal(data.body.version, 1);
});

test('子账号首次在线核验后，服务器断开且主电脑重启仍可按原权限访问', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-offline-grant-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let online = true;
  const fetchImpl = async url => {
    if (!online) throw new Error('cloud unavailable');
    return response(200, url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' }
      : { user: { id: 'member-1', mainAccountId: 'owner-1', role: 'member', isActive: true, permissions: { funds: ['view'] } } });
  };
  const service = new LanWorkspaceService({ userDataPath: root, fetchImpl, port: 0, host: '127.0.0.1' });
  await service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com', sourceVersion: 1,
    data: { disbursementBatches: [{ id: 'batch-1' }] } });
  assert.equal((await request(service.info().port, '/api/unit/workspace/data', 'member-token')).status, 200);
  await service.stop();
  online = false;
  const restarted = new LanWorkspaceService({ userDataPath: root, fetchImpl, port: 0, host: '127.0.0.1' });
  t.after(() => restarted.stop());
  await restarted.startIfConfigured();
  assert.equal((await request(restarted.info().port, '/api/unit/workspace/data', 'member-token')).status, 200);
  assert.equal((await request(restarted.info().port, '/api/unit/workspace/data', 'unknown-token')).status, 503);
});

test('缺失的历史附件会阻止清除云端来源，AI 历史须完整一致', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1' });
  const source = { data: { documents: [{ id: 'doc-1', filePath: path.join(root, 'missing.pdf') }] },
    aiState: { conversations: [{ id: 'chat-1', user_id: 'owner-1', messages: [{ role: 'user', content: '原文' }] }], memories: [], tasks: [] },
    version: 3 };
  await assert.rejects(service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com',
    sourceVersion: source.version, ...source }), /附件未在这台主电脑上找到/);
  await fs.writeFile(path.join(root, 'missing.pdf'), 'sample');
  await service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com',
    sourceVersion: source.version, ...source });
  t.after(() => service.stop());
  assert.deepEqual(await service.verifyMigration(source), { ok: true });
  const migrated = (await service.readWorkspace()).data.documents[0].filePath;
  assert.notEqual(migrated, source.data.documents[0].filePath);
  assert.equal(await fs.readFile(migrated, 'utf8'), 'sample');
  await assert.rejects(service.verifyMigration({ ...source, aiState: { ...source.aiState,
    conversations: [{ ...source.aiState.conversations[0], messages: [{ role: 'user', content: '被改动' }] }] } }), /AI 历史核对失败/);
});

test('子账号归档文件上传主电脑，并只能按权限读取已登记档案', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = { id: 'member-1', mainAccountId: 'owner-1', role: 'member', isActive: true,
    permissions: { archive: ['view', 'create'] } };
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1',
    fetchImpl: async url => response(200, url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' } : { user: profile }) });
  await service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com', sourceVersion: 1,
    data: { documents: [] } });
  t.after(() => service.stop());
  const port = service.info().port;
  const send = (pathname, method, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
      headers: { Authorization: 'Bearer member-token', ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
  const uploadedResponse = await send('/api/unit/workspace/files', 'POST', Buffer.from('private archive'),
    { 'X-File-Name': encodeURIComponent('证明.pdf') });
  assert.equal(uploadedResponse.status, 200);
  const uploaded = JSON.parse(uploadedResponse.body.toString());
  assert.equal(await fs.readFile(uploaded.path, 'utf8'), 'private archive');
  const record = { id: uploaded.id, file_path: uploaded.path, fileObjectRelativePath: uploaded.path };
  const write = await send('/api/unit/workspace/data', 'PUT', Buffer.from(JSON.stringify({ version: 1, data: { documents: [record] } })));
  assert.equal(write.status, 200);
  const downloaded = await send(`/api/unit/workspace/files/${uploaded.id}`, 'GET');
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.body.toString(), 'private archive');
  const unknown = await send('/api/unit/workspace/files/missing', 'GET');
  assert.equal(unknown.status, 404);
});

test('主账号先使用当前电脑本地库，开启共享后仍是同一份数据', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-local-owner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1',
    fetchImpl: async url => response(200, url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' }
      : { user: { id: 'owner-1', mainAccountId: 'owner-1', role: 'main_account', isActive: true } }) });
  t.after(() => service.stop());
  const local = await service.prepareLocal({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com' });
  assert.match(local.baseUrl, /^http:\/\/127\.0\.0\.1:/u);
  assert.equal(service.info().enabled, false);
  assert.deepEqual((await service.readWorkspace()).data.personnel, []);
  const port = service.info().port;
  const write = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/unit/workspace/data', method: 'PUT',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end(JSON.stringify({ version: 1, data: { personnel: [{ id: 'local-1' }] } }));
  });
  assert.equal(write.status, 200);
  await service.enableSharing();
  assert.equal(service.info().enabled, true);
  assert.deepEqual((await request(service.info().port, '/api/unit/workspace/data', 'owner-token')).body.data.personnel,
    [{ id: 'local-1' }]);
  await assert.rejects(service.prepareLocal({ ownerId: 'other-owner', cloudBaseUrl: 'https://account.example.com' }), /其他主账号/u);
  assert.deepEqual((await service.readWorkspace()).data.personnel, [{ id: 'local-1' }]);
});

test('旧云端数据只能导入空的本机工作区', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-empty-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1' });
  t.after(() => service.stop());
  await service.prepareLocal({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com' });
  const source = { version: 9, data: { personnel: [{ id: 'cloud-1' }] }, aiState: { conversations: [], memories: [], tasks: [] } };
  await service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com',
    sourceVersion: source.version, data: source.data, aiState: source.aiState });
  assert.deepEqual(await service.verifyMigration(source), { ok: true });
  assert.equal(service.info().enabled, false);
  await assert.rejects(service.initialize({ ownerId: 'owner-1', cloudBaseUrl: 'https://account.example.com',
    sourceVersion: source.version, data: source.data, aiState: source.aiState }), /已有业务数据/u);
});

test('同一主账号在不同电脑各自使用独立的本机数据', async t => {
  const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-owner-first-'));
  const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-owner-second-'));
  t.after(() => Promise.all([firstRoot, secondRoot].map(root => fs.rm(root, { recursive: true, force: true }))));
  const first = new LanWorkspaceService({ userDataPath: firstRoot, port: 0, host: '127.0.0.1' });
  const second = new LanWorkspaceService({ userDataPath: secondRoot, port: 0, host: '127.0.0.1' });
  t.after(() => Promise.all([first.stop(), second.stop()]));
  await first.prepareLocal({ ownerId: 'same-owner', cloudBaseUrl: 'https://account.example.com' });
  await first.writeJson(first.dataPath, { version: 1, data: { ...createEmptyDatabase(), personnel: [{ id: 'only-first' }] } });
  await second.prepareLocal({ ownerId: 'same-owner', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await first.readWorkspace()).data.personnel, [{ id: 'only-first' }]);
  assert.deepEqual((await second.readWorkspace()).data.personnel, []);
  assert.equal(second.info().enabled, false);
});

test('finance opening balance is shared with finance viewers and protected from member writes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-finance-balance-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profiles = { finance: { id: 'f', role: 'member', mainAccountId: 'owner', isActive: true, permissions: { finance: ['view', 'create', 'update'] } },
    other: { id: 'o', role: 'member', mainAccountId: 'owner', isActive: true, permissions: { workspace: ['view'] } } };
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1', discovery: false,
    fetchImpl: async (url, options) => response(200, url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' } : { user: profiles[options.headers.Authorization.replace('Bearer ', '')] }) });
  const opening = { startDate: '2026-01-01', amountCents: 100000, version: 1 };
  await service.initialize({ ownerId: 'owner', cloudBaseUrl: 'https://account.example.com', data: { financeOpeningBalance: opening, financeRecords: [] } });
  t.after(() => service.stop());
  const port = service.info().port;
  const view = await request(port, '/api/unit/workspace/data', 'finance');
  assert.deepEqual(view.body.data.financeOpeningBalance, opening);
  assert.equal((await request(port, '/api/unit/workspace/data', 'other')).body.data.financeOpeningBalance, undefined);
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'PUT', path: '/api/unit/workspace/data', headers: { Authorization: 'Bearer finance', 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(JSON.stringify({ version: view.body.version, data: { financeOpeningBalance: { ...opening, amountCents: 0 } } }));
  });
  assert.equal(result, 403);
  assert.deepEqual((await service.readWorkspace()).data.financeOpeningBalance, opening);
});

test('finance category catalog is shared; editing members can append categories and host logs AI changes', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lan-finance-categories-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profiles={editor:{id:'editor',role:'member',mainAccountId:'owner',isActive:true,permissions:{finance:['view','update']}},viewer:{id:'viewer',role:'member',mainAccountId:'owner',isActive:true,permissions:{finance:['view']}},other:{id:'other',role:'member',mainAccountId:'owner',isActive:true,permissions:{workspace:['view']}}};
  const service=new LanWorkspaceService({userDataPath:root,port:0,host:'127.0.0.1',discovery:false,fetchImpl:async(url,options)=>response(200,url.endsWith('/api/auth/entitlement')?{valid:true,plan:'permanent'}:{user:profiles[options.headers.Authorization.replace('Bearer ','')]})});
  const record={id:'r',recordType:'expense',recordDate:'2026-02-02',summary:'水费',category:'其他支出',amountCents:8000};
  await service.initialize({ownerId:'owner',cloudBaseUrl:'https://account.example.com',data:{financeRecords:[record],finances:[record],financeCategories:[]}}); t.after(()=>service.stop()); const port=service.info().port;
  const snapshot=(await request(port,'/api/unit/workspace/data','editor')).body;
  const catalog=[{id:'expense:水费',type:'expense',name:'水费'}];
  const put=(token,body)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,method:'PUT',path:'/api/unit/workspace/data',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});
  const data={financeCategories:catalog,financeRecords:[{...record,category:'水费',categorySource:'ai'}],finances:[{...record,category:'水费',categorySource:'ai'}]};
  assert.equal(await put('viewer',{version:snapshot.version,data}),403); assert.equal(await put('editor',{version:snapshot.version,data}),200);
  assert.deepEqual((await request(port,'/api/unit/workspace/data','viewer')).body.data.financeCategories,catalog); assert.equal((await request(port,'/api/unit/workspace/data','other')).body.data.financeCategories,undefined);
  assert.equal((await service.readWorkspace()).data.operationLogs.at(-1).action,'智能整理收支科目');
});


test('transaction source balances and reviewed day order survive sharing; only editors can reorder and host audits it', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lan-finance-order-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profiles={editor:{id:'editor',role:'member',mainAccountId:'owner',isActive:true,permissions:{finance:['view','update']}},viewer:{id:'viewer',role:'member',mainAccountId:'owner',isActive:true,permissions:{finance:['view']}}};
  const service=new LanWorkspaceService({userDataPath:root,port:0,host:'127.0.0.1',discovery:false,fetchImpl:async(url,options)=>response(200,url.endsWith('/api/auth/entitlement')?{valid:true,plan:'permanent'}:{user:profiles[options.headers.Authorization.replace('Bearer ','')]})});
  const record={id:'r',recordType:'expense',recordDate:'2026-02-02',summary:'水费',category:'水费',amountCents:8000,sourceBalanceCents:12000,sourceBalanceText:'120.00',sourceRowNumber:3,sourceSheetName:'2月',sourceOrder:3};
  await service.initialize({ownerId:'owner',cloudBaseUrl:'https://account.example.com',data:{financeOpeningBalance:{startDate:'2026-01-01',amountCents:20000},financeRecords:[record],finances:[record]}});t.after(()=>service.stop());const port=service.info().port;
  const snapshot=(await request(port,'/api/unit/workspace/data','viewer')).body;assert.equal(snapshot.data.financeRecords[0].sourceBalanceCents,12000);
  const changed={...record,transactionOrder:1,orderConfirmed:true};
  const put=token=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,method:'PUT',path:'/api/unit/workspace/data',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({version:snapshot.version,data:{financeRecords:[changed],finances:[changed]}}));});
  assert.equal(await put('viewer'),403);assert.equal(await put('editor'),200);
  const stored=await service.readWorkspace();assert.equal(stored.data.operationLogs.at(-1).action,'审核财务同日交易顺序');
  const shared=(await request(port,'/api/unit/workspace/data','viewer')).body.data;
  const result=require('../../src/main/finance-transaction-balances').transactionBalances(shared.financeRecords,shared.financeOpeningBalance,{today:'2026-10-04'});
  assert.equal(result.items[0].balanceStatus,'matched'); assert.equal(result.items[0].calculatedBalanceCents,12000);
});

test('finance source coverage audit is shared with finance viewers, hidden from other modules, and preserves source row identities',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lan-finance-import-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profiles={finance:{id:'f',role:'member',mainAccountId:'owner',isActive:true,permissions:{finance:['view']}},other:{id:'o',role:'member',mainAccountId:'owner',isActive:true,permissions:{workspace:['view']}}};
 const service=new LanWorkspaceService({userDataPath:root,port:0,host:'127.0.0.1',discovery:false,fetchImpl:async(url,options)=>response(200,url.endsWith('/api/auth/entitlement')?{valid:true,plan:'permanent'}:{user:profiles[options.headers.Authorization.replace('Bearer ','')]})});
 const audit={expectedRowKeys:['1%E6%9C%88:2','1%E6%9C%88:3'],decisions:[{key:'1%E6%9C%88:2',status:'import'},{key:'1%E6%9C%88:3',status:'import'}],coverage:[{sheetName:'1月',rows:[1,2,3],nonBusiness:[{sourceRowNumber:1,reason:'表头',raw:['日期','摘要','支出']}]}],totals:[]};
 const batch={id:'b',fileHash:'a'.repeat(64),sourceAudit:audit};
 await service.initialize({ownerId:'owner',cloudBaseUrl:'https://account.example.com',data:{financeImportBatches:[batch]}});t.after(()=>service.stop());
 assert.deepEqual((await request(service.info().port,'/api/unit/workspace/data','finance')).body.data.financeImportBatches[0].sourceAudit,audit);
 assert.equal((await request(service.info().port,'/api/unit/workspace/data','other')).body.data.financeImportBatches,undefined);
});
