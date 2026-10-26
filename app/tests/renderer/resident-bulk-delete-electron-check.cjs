'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {JsonDatabaseStore}=require('../../src/main/database-store');
const {registerCompatibilityHandlers}=require('../../src/main/ipc-handlers');
const {FOUNDATION_CHANNELS}=require('../../src/shared/ipc-contract');
const root=process.env.FOUNDATION_ELECTRON_TEST_DIR;
if(!root || !path.resolve(root).includes('/community-foundation-electron-'))throw Error('Disposable test directory required');
app.setPath('userData',path.join(root,'isolated-user-data'));const timer=setTimeout(()=>app.exit(2),110000);
app.whenReady().then(async()=>{let window;try{
 const store=new JsonDatabaseStore({userDataPath:app.getPath('userData')});
 const people=Array.from({length:5368},(_,i)=>({id:`synthetic-${i}`,name:`合成居民${i}`,id_card:`SYNTHETIC-${i}`,household_id:`H${Math.floor(i/4)}`,village_group:'合成组',relation_to_head:i%4?'子':'户主',bankAccounts:[{id:`FAKE-${i}`,number:'SYNTHETIC-ACCOUNT'}]}));
 await store.write({settings:{villageName:'批量删除隔离测试'},personnel:people,finances:[{id:'synthetic-finance',amount:10}],landParcel:[{id:'synthetic-land',owner:'合成业主'}]});
 const originalSnapshot=store.writeSnapshot.bind(store);let writes=0;store.writeSnapshot=async value=>{writes++;return originalSnapshot(value);};
 let bulkCalls=0,rowCalls=0;
 const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,async(event,value)=>{
  if(channel===FOUNDATION_CHANNELS.businessRequest && value?.method==='DELETE'){
   if(value.path==='/api/v3/people'){
    bulkCalls++;if(bulkCalls===1)return {ok:false,error:{code:'FORBIDDEN',message:'合成权限失败：当前账号不能删除'}};
    await new Promise(resolve=>setTimeout(resolve,250));
   }else if(value.path.startsWith('/api/v3/people/'))rowCalls++;
  }
  return handler(event,value);
 });
 app.setLoginItemSettings=()=>{};
 const authService={request:async()=>({}),getStatus:async()=>({authenticated:true,entitlement:{type:'licensed'},account:{id:'synthetic-main',mainAccountId:'synthetic-main',role:'unit_admin',name:'测试账号',phone:'10000000000'}}),getServerConfig:async()=>({baseUrl:'http://127.0.0.1:1'}),getLoginPrefill:async()=>({phone:'',password:''})};
 registerCompatibilityHandlers({app,ipcMain,dialog,databaseStore:store,authService,shell:{openPath:async()=>''}});
 ipcMain.handle('check-for-app-update',async()=>({ok:true,disabled:true}));
 for(const [channel,response]of Object.entries({'get-ai-assistant-conversation':{messages:[]},'list-ai-assistant-files':[],'list-ai-assistant-operations':[],'get-ai-settings':{mode:'online',online:{enabled:false,providers:[]},local:{enabled:false}}}))ipcMain.handle(channel,async()=>response);
 window=new BrowserWindow({show:false,width:1600,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:false,nodeIntegration:false,webSecurity:true,preload:path.resolve(__dirname,'../../src/preload/index.js')}});
 await window.loadFile(path.resolve(__dirname,'../../src/renderer/foundation/index.html'));
 const started=performance.now();const result=await window.webContents.executeJavaScript(`import(new URL('../../../tests/renderer/resident-bulk-delete-scenarios.mjs',location.href).href).then(m=>m.checkResidentBulkDelete())`);
 const persisted=await new JsonDatabaseStore({userDataPath:app.getPath('userData')}).read();
 assert.equal(bulkCalls,2);assert.equal(rowCalls,0);assert.equal(writes,1);assert.equal(persisted.personnel.length,0);assert.deepEqual(persisted.foundationDeletedResidents.map(row=>row.person),people);assert.equal(persisted.finances.length,1);assert.equal(persisted.landParcel.length,1);
 const screenshot=path.join(root,'resident-bulk-delete-completed.png');await fs.writeFile(screenshot,(await window.webContents.capturePage()).toPNG());
 const output={ok:true,...result,bulkCalls,rowCalls,diskWrites:writes,elapsedMs:performance.now()-started,recoveryRecords:persisted.foundationDeletedResidents.length,unrelatedDataPreserved:true,screenshot};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));clearTimeout(timer);window.destroy();app.exit(0);
 }catch(error){if(window&&!window.isDestroyed()){await fs.writeFile(path.join(root,'failure.png'),(await window.webContents.capturePage()).toPNG());await fs.writeFile(path.join(root,'failure.html'),await window.webContents.executeJavaScript('document.documentElement.outerHTML'));}await fs.writeFile(path.join(root,'result.json'),JSON.stringify({ok:false,error:error.stack}));console.error(error);clearTimeout(timer);window?.destroy();app.exit(1);}
});
