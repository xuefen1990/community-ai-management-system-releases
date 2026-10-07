'use strict';
const fs=require('node:fs');
const path=require('node:path');
class UpdateDiagnostics {
  constructor({userDataPath}) { this.directory=path.join(userDataPath,'update-diagnostics');this.pendingPath=path.join(this.directory,'pending.json');this.logPath=path.join(this.directory,'events.jsonl'); }
  record(event) {
    try {fs.mkdirSync(this.directory,{recursive:true});if(fs.existsSync(this.logPath)&&fs.statSync(this.logPath).size>1024*1024)fs.renameSync(this.logPath,this.logPath+'.previous');fs.appendFileSync(this.logPath,JSON.stringify({time:new Date().toISOString(),...event})+'\n',{mode:0o600});}catch{} // Logging must never block an update.
  }
  pending({fromVersion,version,networkBytes}) {
    fs.mkdirSync(this.directory,{recursive:true});const tmp=this.pendingPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify({fromVersion,version,networkBytes}),{mode:0o600});fs.renameSync(tmp,this.pendingPath);this.record({type:'install-requested',fromVersion,version,networkBytes});
  }
  verify(version) {
    if(!fs.existsSync(this.pendingPath))return null;
    try {const expected=JSON.parse(fs.readFileSync(this.pendingPath,'utf8'));const ok=version===expected.version;this.record({type:ok?'startup-verified':'startup-version-mismatch',version,expectedVersion:expected.version});fs.rmSync(this.pendingPath,{force:true});return {ok,version,expectedVersion:expected.version};}catch {return null;}
  }
}
// Count response-body bytes, including failed attempts and indexes. Rebuilt file size is not download size.
class UpdateTransferMonitor {
  constructor(executor){this.active=false;this.bytes=0;this.requests=0;if(!executor?.createRequest)return;const create=executor.createRequest.bind(executor);executor.createRequest=(options,callback)=>{const counted=this.active;return create(options,response=>{if(counted){this.requests++;response.on('data',chunk=>{this.bytes+=Buffer.byteLength(chunk);});}callback(response);});};}
  start(){this.bytes=0;this.requests=0;this.active=true;}
  stop(){this.active=false;return {networkBytes:this.bytes,networkRequests:this.requests};}
}
module.exports={UpdateDiagnostics,UpdateTransferMonitor};
