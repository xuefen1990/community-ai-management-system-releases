'use strict';
const test = require('node:test');const assert = require('node:assert/strict');const fs = require('node:fs/promises');const os = require('node:os');const path = require('node:path');const http = require('node:http');
const { AccountWorkspaceManager } = require('../../src/main/account-workspace-manager');
test('共享端口被占用时仍保留稳定的本机业务连接，后续请求不会反复重启', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'standalone-busy-port-'));
  const busy=http.createServer((_req,res)=>res.end('other-program'));await new Promise(r=>busy.listen(0,'127.0.0.1',r));
  const manager=new AccountWorkspaceManager({userDataPath:root,port:busy.address().port,host:'127.0.0.1',discovery:false});
  t.after(async()=>{await manager.stop();await new Promise(r=>busy.close(r));await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'lan-workspace'),{recursive:true});await fs.writeFile(path.join(root,'lan-workspace/config.json'),JSON.stringify({ownerId:'owner',authMode:'standalone',cloudBaseUrl:'http://127.0.0.1:3302',shareEnabled:false}));await fs.writeFile(path.join(root,'lan-workspace/workspace.json'),JSON.stringify({version:1,data:{personnel:[{id:'preserved-person'}]}}));
  const first=await manager.prepareLocal({ownerId:'owner',cloudBaseUrl:'http://127.0.0.1:3302'});
  assert.notEqual(new URL(first.baseUrl).port,String(busy.address().port));assert.match(manager.lastShareError,/端口/);assert.equal(manager.active.info().localReady,true);
  for(let n=0;n<5;n++){assert.equal((await manager.prepareLocal({ownerId:'owner',cloudBaseUrl:'http://127.0.0.1:3302'})).baseUrl,first.baseUrl);assert.equal((await fetch(first.baseUrl+'/api/health')).status,200);}
  assert.equal((await manager.readWorkspace()).data.personnel[0].id,'preserved-person');
});
