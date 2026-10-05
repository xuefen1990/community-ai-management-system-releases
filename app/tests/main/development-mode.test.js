'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getDevelopmentConfig, developmentAuthStore, initializeDevelopmentPreview, attachDevelopmentWindow } = require('../../src/main/development-mode');

test('preview automatically restores an isolated local owner, but never bypasses cloud account verification',async()=>{
 const calls=[],auth={store:{read:async()=>({remoteAccount:{id:'owner',role:'main_account'}})},getStatus:async()=>({authenticated:false}),request:async path=>({path}),machineId:'dev-machine',
 localWorkspaceService:{prepareLocal:async args=>calls.push(args),cacheAccountGrant:async(...args)=>calls.push(args)}};
 await initializeDevelopmentPreview(auth,{remoteServerUrl:'http://127.0.0.1:3301'});
 assert.equal((await auth.getStatus()).authenticated,true);assert.equal((await auth.getStatus()).account.mainAccountId,'owner');
 assert.equal(calls[0].ownerId,'owner');assert.match(auth.session.token,/^development-preview-/u);
 await assert.rejects(auth.request('/ai/chat'),/真实账号/u);assert.equal((await auth.request('/unit/workspace/data')).path,'/unit/workspace/data');
 const untouched={};await initializeDevelopmentPreview(untouched,null);assert.deepEqual(untouched,{});
});
test('a remembered real account is used automatically and remains subject to real entitlement checks',async()=>{
 const auth={store:{read:async()=>({})},rememberedLoginStore:{load:async()=>({phone:'test',password:'test'})},
 login:async()=>{auth.session={token:'real',user:{id:'real'}};},getStatus:async()=>({authenticated:true,entitlement:{type:'expired'}}),request:async()=>({ok:true})};
 await initializeDevelopmentPreview(auth,{remoteServerUrl:'http://127.0.0.1:3301'});
 assert.equal(auth.session.token,'real');assert.equal((await auth.getStatus()).entitlement.type,'expired');
});

test('packaged builds ignore all development switches', () => {
  assert.equal(getDevelopmentConfig({ isPackaged:true,env:{COMMUNITY_DEV_MODE:'1'},productionData:'/production' }),null);
  assert.equal(getDevelopmentConfig({ isPackaged:false,env:{},productionData:'/production' }),null);
});
test('development requires separate initialized data and a non-production loopback port', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'community-dev-config-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'development-profile.json'),'{}');
  const env={COMMUNITY_DEV_MODE:'1',COMMUNITY_DEV_USER_DATA:root,COMMUNITY_DEV_BACKEND_URL:'http://127.0.0.1:3301'};
  const config=getDevelopmentConfig({isPackaged:false,env:{...env,COMMUNITY_DEV_TOOLS:'1'},productionData:'/production'});
  assert.equal(config.userData,root);assert.equal(config.devtools,true);
  assert.equal(config.remoteServerUrl,'http://127.0.0.1:3301');
  const custom=getDevelopmentConfig({isPackaged:false,env:{...env,COMMUNITY_DEV_REMOTE_SERVER_URL:'https://example.com/api'},productionData:'/production'});
  assert.equal(custom.remoteServerUrl,'https://example.com');
  assert.throws(()=>getDevelopmentConfig({isPackaged:false,env:{...env,COMMUNITY_DEV_USER_DATA:'/production/data'},productionData:'/production'}));
  for(const url of ['http://127.0.0.1:3000','https://example.com','http://localhost:3301'])assert.throws(()=>getDevelopmentConfig({isPackaged:false,env:{...env,COMMUNITY_DEV_BACKEND_URL:url},productionData:'/production'}));
});
test('development account store uses the configured remote server instead of the old local address', async () => {
  let state={remoteServerUrl:'http://127.0.0.1:3000',accounts:[{id:'account'}]};
  const store=developmentAuthStore({read:async()=>state,write:async value=>{state=value;}},'https://xuefeng0901.cn');
  assert.equal((await store.read()).remoteServerUrl,'https://xuefeng0901.cn');
  await store.write({...state,remoteServerUrl:'https://production.example'});
  assert.equal(state.remoteServerUrl,'https://xuefeng0901.cn');assert.deepEqual(state.accounts,[{id:'account'}]);
});
test('profile initializes once, relocates owned paths and never overwrites production or a development edit', async t => {
  const {prepareProfile}=await import('../../../scripts/dev/profile.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'community-dev-profile-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'production'),profile=path.join(root,'development');
  await fs.mkdir(path.join(source,'data'),{recursive:true});
  const data={personnel:[{id:'resident',file:path.join(source,'data','attachment.txt')}],settings:{}};
  await fs.writeFile(path.join(source,'data/community-data.json'),JSON.stringify(data));
  await fs.writeFile(path.join(source,'data/attachment.txt'),'original');
  await prepareProfile({project:root,source,profile});
  const copied=JSON.parse(await fs.readFile(path.join(profile,'data/community-data.json')));
  assert.equal(copied.personnel[0].file,path.join(profile,'data/attachment.txt'));
  await fs.writeFile(path.join(profile,'data/attachment.txt'),'development edit');
  await prepareProfile({project:root,source,profile});
  assert.equal(await fs.readFile(path.join(profile,'data/attachment.txt'),'utf8'),'development edit');
  assert.equal(await fs.readFile(path.join(source,'data/attachment.txt'),'utf8'),'original');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(source,'data/community-data.json'))),data);
  await assert.rejects(prepareProfile({project:root,source,profile:source}));
});
