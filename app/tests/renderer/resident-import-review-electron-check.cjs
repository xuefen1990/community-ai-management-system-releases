'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {JsonDatabaseStore}=require('../../src/main/database-store');
const {registerCompatibilityHandlers}=require('../../src/main/ipc-handlers');
const {FOUNDATION_CHANNELS}=require('../../src/shared/ipc-contract');
const root=process.env.FOUNDATION_ELECTRON_TEST_DIR;
if(!root||!path.resolve(root).includes('/community-foundation-electron-'))throw Error('Disposable test directory required');
app.setPath('userData',path.join(root,'isolated-user-data'));const timer=setTimeout(()=>app.exit(2),110000);
app.whenReady().then(async()=>{let window;try{
 const id='11010519491231002X',id2='110105194912310011';
 const prefix='11010519800101001',weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2],checks=['1','0','X','9','8','7','6','5','4','3','2'];
 const id3=prefix+checks[weights.reduce((sum,w,i)=>sum+w*Number(prefix[i]),0)%11];
 const prefix4='11010519810101001',id4=prefix4+checks[weights.reduce((sum,w,i)=>sum+w*Number(prefix4[i]),0)%11];
 const csv=path.join(root,'synthetic-import.csv');await fs.writeFile(csv,`\uFEFF姓名,身份证号,手机号,地址\n表格姓名,${id},新电话,补充地址\n新增居民,${id3},12345,\n新增居民,${id3},,新居民地址\n异常行,错误号码,,\n`);
 const people=[{id:'old',name:'原姓名',id_card:id,phone:'原电话',address:'',household_id:'001',village_group:'一组',bankAccounts:[{id:'account',number:'synthetic'}]},
  {id:'dup1',name:'重复甲',id_card:id2},{id:'dup2',name:'重复乙',id_card:id2},{id:'invalid',name:'异常居民',id_card:'invalid',bankAccounts:[{id:'invalid-account',number:'synthetic-existing'}],disbursementHistory:[{id:'original-payment'}]}];
 const store=new JsonDatabaseStore({userDataPath:app.getPath('userData')});await store.write({personnel:people,settings:{villageName:'导入核对隔离验收'}});
 let snapshots=0,upserts=0;const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>register(channel,async(event,value)=>{
  if(channel===FOUNDATION_CHANNELS.businessRequest&&value?.path==='/api/v3/__test/resident-review-capture'){
   await fs.writeFile(path.join(root,'resident-import-choices.png'),(await window.webContents.capturePage()).toPNG());return {ok:true,data:{}};
  }
  if(channel===FOUNDATION_CHANNELS.createV3ImportSnapshot)snapshots++;
  if(channel===FOUNDATION_CHANNELS.businessRequest&&value?.path==='/api/v3/people/batch-upsert')upserts++;
  return handler(event,value);
 });
 app.setLoginItemSettings=()=>{};
 const authService={request:async()=>({}),getStatus:async()=>({authenticated:true,entitlement:{type:'licensed'},account:{id:'synthetic-main',mainAccountId:'synthetic-main',role:'unit_admin',name:'测试账号',phone:'10000000000'}}),getServerConfig:async()=>({baseUrl:'http://127.0.0.1:1'}),getLoginPrefill:async()=>({phone:'',password:''})};
 registerCompatibilityHandlers({app,ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[csv]})},databaseStore:store,authService,shell:{openPath:async()=>''}});
 ipcMain.handle('check-for-app-update',async()=>({ok:true,disabled:true}));
 for(const [channel,response]of Object.entries({'get-ai-assistant-conversation':{messages:[]},'list-ai-assistant-files':[],'list-ai-assistant-operations':[],'get-ai-settings':{mode:'online',online:{enabled:false,providers:[]},local:{enabled:false}}}))ipcMain.handle(channel,async()=>response);
 window=new BrowserWindow({show:false,width:1450,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:false,nodeIntegration:false,webSecurity:true,preload:path.resolve(__dirname,'../../src/preload/index.js')}});
 await window.loadFile(path.resolve(__dirname,'../../src/renderer/foundation/index.html'));
 const result=await window.webContents.executeJavaScript(`import(new URL('../../../tests/renderer/resident-import-review-scenarios.mjs',location.href).href).then(m=>m.checkResidentImportReview(${JSON.stringify({id,id3})}))`);
 const persisted=await store.read();assert.equal(snapshots,1);assert.equal(upserts,1);assert.equal(persisted.personnel.length,5);
 assert.equal(persisted.personnel[0].name,'原姓名');assert.equal(persisted.personnel[0].phone,'原电话');assert.equal(persisted.personnel[0].address,'补充地址');assert.deepEqual(persisted.personnel[0].bankAccounts,people[0].bankAccounts);
 const added=persisted.personnel.find(row=>row.id_card===id3||row.idCard===id3);assert.equal(added.phone,'12345');assert.equal(added.address,'新居民地址');
 const history=persisted.personnelImportRecords.at(-1);assert.equal(history.report.policy,'fill-empty');assert.equal(history.report.decisions[0].selectedName,'原姓名');
 const editing=await window.webContents.executeJavaScript(`import(new URL('../../../tests/renderer/resident-import-review-scenarios.mjs',location.href).href).then(m=>m.checkResidentAuditEditing(${JSON.stringify({validCard:id4})}))`);
 const corrected=(await store.read()).personnel;assert.equal(corrected.find(row=>row.id==='invalid').id_card,id4);assert.equal(corrected.find(row=>row.id==='invalid').name,'已核实居民');
 assert.deepEqual(corrected.find(row=>row.id==='invalid').bankAccounts,people[3].bankAccounts);assert.deepEqual(corrected.find(row=>row.id==='invalid').disbursementHistory,people[3].disbursementHistory);assert.equal(corrected.find(row=>row.id==='invalid').identityCardHistory.length,1);
 assert.equal(corrected.find(row=>row.id==='dup1').name,'重复甲已核实');assert.equal(corrected.find(row=>row.id==='dup2').name,'重复乙');assert.equal(corrected.length,5);
 const screenshot=path.join(root,'resident-import-review.png');await fs.writeFile(screenshot,(await window.webContents.capturePage()).toPNG());
 const output={ok:true,...result,...editing,snapshots,upserts,preservedOriginalName:true,preservedExistingPhone:true,filledBlankAddress:true,mergedSpreadsheetDuplicates:true,historyDecisionSaved:true,correctedResidentLinksPreserved:true,screenshot};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));clearTimeout(timer);window.destroy();app.exit(0);
 }catch(error){if(window&&!window.isDestroyed()){await fs.writeFile(path.join(root,'failure.png'),(await window.webContents.capturePage()).toPNG());await fs.writeFile(path.join(root,'failure.html'),await window.webContents.executeJavaScript('document.documentElement.outerHTML'));}await fs.writeFile(path.join(root,'result.json'),JSON.stringify({ok:false,error:error.stack}));console.error(error);clearTimeout(timer);window?.destroy();app.exit(1);}
});
