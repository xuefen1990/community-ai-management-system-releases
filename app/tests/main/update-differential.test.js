'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {GenericDifferentialDownloader}=require('electron-updater/out/differentialDownloader/GenericDifferentialDownloader');
const {NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
const {CancellationToken}=require('builder-util-runtime');
const {UpdateTransferMonitor}=require('../../src/main/update-diagnostics');
test('ZIP and EXE delta reuse cached bytes through HTTP ranges and validate complete SHA512',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'delta-regression-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const {createUpdateBlockmap}=await import('../../../scripts/update-blockmap.mjs');
 const old=crypto.randomBytes(1024*1024),next=Buffer.from(old);next.fill(7,500000,500200);
 const ranges=[];const server=http.createServer((req,res)=>{const match=/bytes=(\d+)-(\d+)/.exec(req.headers.range||'');if(!match){res.writeHead(400).end();return;}const start=Number(match[1]),end=Number(match[2]);ranges.push([start,end]);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${next.length}`,'Content-Length':end-start+1});res.end(next.subarray(start,end+1));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const extension of ['zip','exe']){
  const oldFile=path.join(dir,'old.'+extension),newFile=path.join(dir,'new.'+extension),destination=path.join(dir,'result.'+extension);
  await fs.writeFile(oldFile,old);await fs.writeFile(newFile,next);
  const maps=await Promise.all([oldFile,newFile].map(async file=>JSON.parse(zlib.gunzipSync(await fs.readFile(await createUpdateBlockmap(file))))));
  const executor=new NodeHttpExecutor(),monitor=new UpdateTransferMonitor(executor);monitor.start();
  const downloader=new GenericDifferentialDownloader({size:next.length,sha512:crypto.createHash('sha512').update(next).digest('base64')},executor,{oldFile,newFile:destination,newUrl:new URL(`http://127.0.0.1:${server.address().port}/package`),logger:{info(){},debug(){},warn(){},error(){}},cancellationToken:new CancellationToken(),isUseMultipleRangeRequest:false});
  await downloader.download(...maps);const metrics=monitor.stop();assert.deepEqual(await fs.readFile(destination),next);assert.ok(metrics.networkBytes>0&&metrics.networkBytes<next.length/2);console.log(`${extension}: ${metrics.networkBytes}/${next.length} bytes transferred`);
  assert.throws(()=>downloader.download(maps[0],{...maps[1],version:'invalid'}),/full download/);
  downloader.blockAwareFileInfo.sha512=crypto.createHash('sha512').update(old).digest('base64');
  await assert.rejects(downloader.download(...maps),/checksum|sha512/i);
 }
 assert.ok(ranges.length>=2);
});
