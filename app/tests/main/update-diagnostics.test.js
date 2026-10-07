'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {UpdateDiagnostics,UpdateTransferMonitor}=require('../../src/main/update-diagnostics');
test('transfer counts network bodies including indexes and retries, excludes inactive and local bytes',()=>{
 const responses=[];const executor={createRequest(options,callback){const response=new EventEmitter();responses.push(response);callback(response);return response;}};
 const monitor=new UpdateTransferMonitor(executor);executor.createRequest({},()=>{}).emit('data',Buffer.alloc(50));monitor.start();
 executor.createRequest({},()=>{}).emit('data',Buffer.alloc(120));executor.createRequest({},()=>{}).emit('data',Buffer.alloc(30));
 assert.deepEqual(monitor.stop(),{networkBytes:150,networkRequests:2});executor.createRequest({},()=>{}).emit('data',Buffer.alloc(200));assert.equal(monitor.bytes,150);
});
test('restart checks installed version and records mismatch without claiming success',async t=>{
 const userDataPath=await fs.mkdtemp(path.join(os.tmpdir(),'update-diagnostics-'));t.after(()=>fs.rm(userDataPath,{recursive:true,force:true}));const log=new UpdateDiagnostics({userDataPath});
 log.pending({fromVersion:'1.2.3',version:'1.2.4',networkBytes:123});assert.equal(log.verify('1.2.3').ok,false);assert.equal(log.verify('1.2.4'),null);
 log.pending({fromVersion:'1.2.3',version:'1.2.4',networkBytes:123});assert.equal(log.verify('1.2.4').ok,true);assert.match(await fs.readFile(log.logPath,'utf8'),/startup-verified/);
});
