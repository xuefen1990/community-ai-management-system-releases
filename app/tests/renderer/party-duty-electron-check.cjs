'use strict';
// Disposable Electron window, real preload and business IPC, synthetic records.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const root = process.env.PARTY_DUTY_QA_DIR;
if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && !path.resolve(root).startsWith('/tmp/community-party-duty-') && !path.resolve(root).startsWith('/private/tmp/community-party-duty-')) throw new Error('Disposable test directory required');
app.setPath('userData', path.join(root, 'user-data'));
const timer = setTimeout(() => app.exit(2), 90000);
app.whenReady().then(async () => {
  let window;
  try {
    const store = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
    await store.write({ personnel: [{ id: 'resident', name: '合成党员', id_card: 'SYNTHETIC-1', tags: ['党员'], party_info: { branch: '合成支部', join_date: '2020-01-01' } }, { id: 'candidate', name: '合成后备人员', id_card: 'SYNTHETIC-2', tags: [] }],
      partyBranches: [{ id: 'branch1', name: '合成支部' }], partyMembers: [{ id: 'member1', name: '合成党员', id_card: 'SYNTHETIC-1', memberType: '本村党员', stage: '正式党员', branchId: 'branch1', joinDate: '2020-01-01' }],
      dutyCadres: [{ id: 'cadre1', name: '合成值班员', personType: 'cadre' }], settings: { villageName: '隔离测试工作区' } });
    let failNextWrite = false;
    const update = store.update.bind(store);
    store.update = callback => { if (failNextWrite) { failNextWrite = false; return Promise.reject(new Error('合成保存失败，请重试')); } return update(callback); };
    const authService = { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' }, account: { role: 'unit_admin', name: '合成账号', phone: '10000000000' } }),
      getServerConfig: async () => ({ baseUrl: 'http://127.0.0.1:1' }), request: async () => ({ preferences: {}, credits: 0 }) };
    registerCompatibilityHandlers({ app, ipcMain, databaseStore: store, authService });
    ipcMain.handle('list-ai-assistant-files', async () => ({ items: [] }));
    ipcMain.handle('get-ai-settings', async () => ({ enabled: false }));
    ipcMain.handle('get-ai-assistant-conversation', async () => ({ messages: [] }));
    window = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { backgroundThrottling: false, sandbox: false, contextIsolation: true, preload: path.resolve(__dirname, '../../src/preload/index.js') } });
    const rendererErrors = [];
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) rendererErrors.push(message); });
    const downloads = [];
    window.webContents.session.on('will-download', (_event, item) => { const target = path.join(root, item.getFilename()); item.setSavePath(target); item.once('done', (_event, state) => { if (state === 'completed') downloads.push(target); }); });
    await window.loadFile(path.resolve(__dirname, '../../src/renderer/foundation/index.html'));
    await window.webContents.executeJavaScript(`window.qa = {
      pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
      async wait(check, label){for(let i=0;i<120;i++){if(check())return;await this.pause(25);}throw Error('未出现：'+label);},
      click(selector){const element=document.querySelector(selector);if(!element)throw Error('找不到 '+selector);element.click();},
      input(selector,value){const element=document.querySelector(selector);if(!element)throw Error('找不到输入 '+selector);element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},
      button(text,scope=document){const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('找不到按钮 '+text);b.click();},
      async api(path){const result=await window.api.businessRequest({path:'/api/v3'+path});if(!result.ok)throw Error(result.error.message);return result.data;}
    };undefined;`);
    const party = await window.webContents.executeJavaScript(`(async()=>{
      const {foundation}=await import(new URL('./bootstrap.mjs',location.href).href);await foundation.router.push('/party');
      await qa.wait(()=>document.querySelector('[data-testid="party-member-table"]')?.textContent.includes('合成党员'),'党员');
      for(const title of ['党员队伍全貌','入党后备力量','年度组织生活','当年党费收缴率'])if(!document.querySelector('main').textContent.includes(title))throw Error('缺少统计 '+title);
      qa.click('[data-testid="subtab-party-dues"]');await qa.wait(()=>document.querySelector('[data-testid="party-dues-table"]'),'党费台账');
      return {buttons:[...document.querySelectorAll('main button')].map(b=>b.textContent.trim())};
    })()`);
    console.log('PARTY-DUES', JSON.stringify(party));
    await fs.writeFile(path.join(root, 'party.png'), (await window.webContents.capturePage()).toPNG());
    failNextWrite = true;
    const failure = await window.webContents.executeJavaScript(`(async()=>{
      qa.click('[data-testid="btn-register-dues-member1"]');await qa.wait(()=>document.querySelector('[data-testid="party-dues-modal"]'),'失败登记');
      qa.click('[data-testid="dues-select-all-btn"]');qa.click('[data-testid="dues-save-btn"]');
      await qa.wait(()=>document.body.textContent.includes('合成保存失败'),'失败提示');
      if(!document.querySelector('[data-testid="party-dues-modal"]'))throw Error('失败表单已丢失');
      if((await qa.api('/party/dues')).items.length)throw Error('失败仍写入数据');return true;
    })()`);
    const dues = await window.webContents.executeJavaScript(`(async()=>{
      await qa.wait(()=>document.querySelector('[data-testid="party-dues-modal"]'),'失败后保留登记');qa.click('[data-testid="dues-save-btn"]');
      await qa.wait(()=>!document.querySelector('[data-testid="party-dues-modal"]'),'保存登记');
      const first=await qa.api('/party/dues');if(first.items.length!==12)throw Error('未保存12个月');
      await qa.wait(()=>document.querySelector('[data-testid="btn-register-dues-member1"]'),'登记按钮');qa.click('[data-testid="btn-register-dues-member1"]');await qa.wait(()=>document.querySelector('[data-testid="party-dues-modal"]'),'再次登记');
      qa.click('[data-testid="dues-clear-all-btn"]');qa.click('[data-testid="dues-select-all-btn"]');qa.click('[data-testid="dues-save-btn"]');
      await qa.wait(()=>!document.querySelector('[data-testid="party-dues-modal"]'),'有版本再次保存');
      qa.button('一键全额收缴');await qa.wait(()=>document.querySelector('[data-testid="party-batch-dues-modal"]'),'批量党费');qa.click('[data-testid="btn-confirm-batch-dues"]');await qa.wait(()=>!document.querySelector('[data-testid="party-batch-dues-modal"]'),'批量保存');
      qa.click('[data-testid="btn-export-dues-csv"]');await qa.pause(250);
      qa.click('[data-testid="subtab-party-dev"]');await qa.pause(100);if(!document.querySelector('main').textContent.includes('积极分子'))throw Error('发展页');
      qa.click('[data-testid="subtab-party-meetings"]');await qa.pause(100);
      return {months:first.items.length,meetingButtons:[...document.querySelectorAll('main button')].map(b=>b.textContent.trim())};
    })()`);
    console.log('DUES-SAVE', JSON.stringify(dues));
    const meetings = await window.webContents.executeJavaScript(`(async()=>{
      qa.button('新增会议签到');await qa.wait(()=>document.querySelector('[data-testid="party-meeting-modal"]'),'会议');
      qa.input('[data-testid="meeting-title-input"]','合成会议签到');qa.click('[data-testid="meeting-save-btn"]');
      await qa.wait(()=>!document.querySelector('[data-testid="party-meeting-modal"]'),'保存会议');
      const rows=await qa.api('/party/meetings');if(rows.items[0]?.title!=='合成会议签到'||rows.items[0]?.attendees.length!==1)throw Error('签到未保存');
      qa.click('[data-testid="btn-header-add-external"]');await qa.wait(()=>document.querySelector('[data-testid="party-external-member-modal"]'),'流动党员');qa.input('input[placeholder="输入党员姓名"]','合成流动党员');qa.button('保存党员信息');await qa.wait(()=>!document.querySelector('[data-testid="party-external-member-modal"]'),'保存流动党员');
      if(!(await qa.api('/party/members')).items.some(row=>row.name==='合成流动党员'))throw Error('新增流动党员未保存');
      qa.click('[data-testid="subtab-party-dev"]');await qa.pause(100);qa.click('[data-testid="btn-add-activist"]');await qa.wait(()=>document.querySelector('[data-testid="party-activist-modal"]'),'积极分子');
      qa.input('[data-testid="activist-person-search-input"] input','合成后备人员');await qa.pause(150);qa.click('[data-testid="activist-save-btn"]');await qa.wait(()=>!document.querySelector('[data-testid="party-activist-modal"]'),'发展档案保存');
      if(!(await qa.api('/party/members')).items.some(row=>row.name==='合成后备人员'&&row.stage==='积极分子'))throw Error('积极分子未保存');
      const {foundation}=await import(new URL('./bootstrap.mjs',location.href).href);await foundation.router.push('/village-duty');
      await qa.wait(()=>document.querySelector('[data-testid="btn-bulk-schedule"]'),'村务值班');await qa.pause(300);
      return {meeting:true,peopleButtons:[...document.querySelectorAll('main button')].map(b=>b.textContent.trim())};
    })()`);
    console.log('MEETING-SAVE', JSON.stringify(meetings));
    const duty = await window.webContents.executeJavaScript(`(async()=>{
      qa.button('合成值班员');await qa.wait(()=>document.querySelector('main').textContent.includes('已安排值班')&&document.querySelector('main').textContent.includes('移除'),'点击排班');
      const first=await qa.api('/duty/plans');if(!first.items.some(plan=>plan.days.some(day=>day.assignments.some(row=>row.nameSnapshot==='合成值班员'))))throw Error('点击排班未保存');
      qa.click('[data-testid="btn-bulk-schedule"]');await qa.wait(()=>document.querySelector('[data-testid="dialog-bulk-schedule"]'),'整月');
      const people=[...document.querySelectorAll('[data-testid^="bulk-person-"]')];if(!people.length)throw Error('缺少排班人员');people[0].click();await qa.pause(50);qa.click('[data-testid="btn-submit-bulk"]');
      await qa.wait(()=>!document.querySelector('[data-testid="dialog-bulk-schedule"]'),'整月保存');
      const all=await qa.api('/duty/plans');if(all.items.flatMap(row=>row.days).filter(day=>day.assignments.length).length<28)throw Error('整月笔数错误');
      qa.click('[data-testid="btn-add-work-header"]');await qa.wait(()=>document.querySelector('[data-testid="visit-form-modal"]'),'工作记录');
      qa.click('.btn-add-custom-person');await qa.wait(()=>document.querySelector('.el-message-box__input input'),'手工涉及人员');qa.input('.el-message-box__input input','合成涉及人员');qa.button('添加',document.querySelector('.el-message-box'));await qa.pause(80);
      qa.input('[data-testid="vr-content"]','合成道路巡查记录');qa.click('[data-testid="btn-submit-visit-dialog"]');await qa.wait(()=>!document.querySelector('[data-testid="visit-form-modal"]'),'工作记录保存');
      if(!(await qa.api('/service-records')).items.some(row=>row.content==='合成道路巡查记录'))throw Error('工作记录未保存');
      qa.click('[data-testid="btn-task-settings"]');await qa.wait(()=>document.querySelector('[data-testid="dialog-duty-task-manage"]'),'值班任务');
      qa.input('[data-testid="input-new-task-name"]','合成专项巡查');qa.click('[data-testid="btn-add-task-submit"]');await qa.wait(()=>document.querySelector('[data-testid="task-item-合成专项巡查"]'),'任务保存');qa.button('完成',document.querySelector('[data-testid="dialog-duty-task-manage"]'));
      qa.click('[data-testid="btn-people-manage"]');await qa.wait(()=>document.querySelector('[data-testid="dialog-duty-people-manage"]'),'排班人员');
      qa.input('[data-testid="input-new-person-name"] input','合成新增值班员');await qa.pause(50);qa.click('[data-testid="btn-submit-new-person"]');await qa.wait(()=>document.querySelector('[data-testid="dialog-duty-people-manage"]').textContent.includes('合成新增值班员'),'人员保存');
      qa.click('[data-testid="dialog-duty-people-manage"] .el-dialog__headerbtn');
      qa.click('[data-testid="btn-export-xlsx"]');return {quickSchedule:true,bulkSchedule:true};
    })()`);
    await window.webContents.executeJavaScript(`document.querySelectorAll('.el-message').forEach(message=>message.remove());`);
    await fs.writeFile(path.join(root, 'duty.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelectorAll('.el-message').forEach(message=>message.remove());`);
    window.setSize(1000, 800); await new Promise(resolve => setTimeout(resolve, 150));
    await fs.writeFile(path.join(root, 'duty-small.png'), (await window.webContents.capturePage()).toPNG());
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(downloads.length, 2, JSON.stringify(downloads));
    for (const file of downloads) assert.equal((await fs.readFile(file)).subarray(0, 2).toString(), 'PK');
    assert.deepEqual(rendererErrors, [], 'Renderer errors');
    const database = await store.read();
    assert.equal(database.partyDues.length, 12); assert.equal(database.partyMeetings.length, 1);
    const result = { ok: true, saveFailureRetained: failure, memberCreate: true, activistCreate: true, workRecord: true, taskCreate: true, staffCreate: true, batchDues: true, dues: dues.months, meetings: 1, ...duty, exports: downloads.map(file => path.basename(file)), screenshots: root };
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    clearTimeout(timer); window.destroy(); app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) { await fs.writeFile(path.join(root, 'failure.png'), (await window.webContents.capturePage()).toPNG()); await fs.writeFile(path.join(root, 'failure.html'), await window.webContents.executeJavaScript('document.documentElement.outerHTML')); }
    console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1);
  }
});
