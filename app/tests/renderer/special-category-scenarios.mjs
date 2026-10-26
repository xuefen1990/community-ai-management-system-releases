export async function checkSpecialCategories() {
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(test,message)=>{for(let i=0;i<160;i++){if(test())return;await pause(25);}throw Error(message);};
 const click=id=>{const e=document.querySelector(`[data-testid="${id}"]`);if(!e)throw Error(`Missing ${id}`);e.click();};
 const input=(element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
 const {foundation}=await import('../../src/renderer/foundation/bootstrap.mjs');
 await foundation.personnel.load({force:true});
 await foundation.router.push('/settings?tab=special');
 await wait(()=>document.querySelector('[data-testid="special-edit-standard_yulu"]'),'Manager did not load');
 const rename=async(code,label)=>{
  click(`special-edit-${code}`);await wait(()=>document.querySelector('[data-testid="special-label-input"]'),'Editor did not open');
  input(document.querySelector('[data-testid="special-label-input"]'),label);
  if(code==='standard_yulu') {click('special-add-field');await pause(30);input(document.querySelector('[aria-label="第2个字段名称"]'),'补充说明');}
  click('special-save');await wait(()=>!document.querySelector('[data-testid="special-category-editor"]'),'Save failed: '+document.querySelector('[role="alert"]')?.textContent);
 };
 await rename('standard_yulu','助学补贴');await rename('standard_poverty','巩固脱贫农户');await rename('synthetic_custom','本村关爱台账');
 await foundation.router.push('/personnel');await pause(250);
 await wait(()=>document.querySelector('[data-testid="stat-card-yulu"] .stat-label')?.textContent==='助学补贴','Stat alias failed');
 if(document.querySelector('[data-testid="stat-yulu"] .tab-label')?.textContent!=='助学补贴')throw Error('Quick filter alias failed');
 click('stat-yulu');await pause(100);
 if(foundation.personnel.filtered.length!==2 || foundation.personnel.filters.identity!=='雨露计划')throw Error('Rename changed identity predicate/count');
 // The existing field keys are preserved when adding an extension field.
 let r=await window.api.businessRequest({path:'/api/v3/special-categories'});
 const row=r.data.items.find(c=>c.code==='standard_yulu');
 if(row.name!=='雨露计划'||row.fieldSchema[0].key!=='f_existing'||row.fieldSchema.length!==2)throw Error('Canonical name or field keys changed');
 await foundation.router.push('/settings?tab=special');await wait(()=>document.querySelector('[data-testid="special-delete-standard_yulu"]'),'Manager reload failed');
 click('special-delete-standard_yulu');await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='删除标签'),'Delete confirmation missing');
 [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='删除标签').click();
 await wait(()=>!document.querySelector('[data-testid="builtin-cat-card-standard_yulu"]'),'Deleted card still active');
 click('special-deleted-toggle');await wait(()=>document.querySelector('[data-testid="special-restore-standard_yulu"]'),'Restore entry missing');
 await foundation.router.push('/personnel');await pause(250);
 await wait(()=>document.querySelector('[data-testid="stat-card-yulu"]')?.getBoundingClientRect().height===0,'Deleted stat still visible');
 if(document.querySelector('[data-testid="stat-yulu"]').getBoundingClientRect().height!==0)throw Error('Deleted quick filter still visible');
 if(foundation.personnel.people.filter(p=>p.tags.includes('雨露计划')).length!==2)throw Error('Deletion changed residents');
 const add=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新增人员'));add.click();await pause(200);
 const checkbox=[...document.querySelectorAll('.tag-checkbox-card')].find(e=>e.textContent.includes('助学补贴'));
 if(!checkbox||checkbox.getBoundingClientRect().height!==0)throw Error('Deleted category remains assignable');
 // Existing canonical values still belong to saved records; the form is cancelled.
 const cancel=[...document.querySelectorAll('button')].reverse().find(b=>b.textContent.trim()==='取消');cancel?.click();await pause(100);
 document.querySelector('[data-testid="edit-person-synthetic-0"]').click();
 await wait(()=>document.querySelector('[data-testid="person-form-dialog"] #p_phone'),'Resident editor missing');
 await wait(()=>document.querySelector('#foundation-resident-extra-root [data-editor-content="accounts"]'),'Resident editor extra data not loaded');await pause(150);
 input(document.querySelector('[data-testid="person-form-dialog"] #p_phone'),'13900000001');
 [...document.querySelector('[data-testid="person-form-dialog"]').querySelectorAll('button')].find(b=>b.textContent.trim()==='确认保存').click();
 await wait(()=>!document.querySelector('[data-testid="person-form-dialog"]'),'Saving another resident field failed: '+document.querySelector('.resident-editor-error')?.textContent);
 return {renamedBuiltin:true,renamedCustom:true,extensionKeysPreserved:true,canonicalFilterCount:2,deletedActiveEntries:true,recordCount:foundation.personnel.people.length};
}
export async function checkSpecialCategoryRestartAndRestore() {
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async test=>{for(let i=0;i<150;i++){if(test())return;await pause(30);}throw Error('Restore UI timeout');};
 const {foundation}=await import('../../src/renderer/foundation/bootstrap.mjs');await foundation.personnel.load({force:true});await foundation.router.push('/settings?tab=special');
 await wait(()=>document.querySelector('[data-testid="special-deleted-toggle"]'));
 document.querySelector('[data-testid="special-deleted-toggle"]').click();await wait(()=>document.querySelector('[data-testid="special-restore-standard_yulu"]'));
 const r=await window.api.businessRequest({path:'/api/v3/special-categories'});
 if(!r.data.items.find(c=>c.code==='standard_yulu')?.deletedAt)throw Error('Delete did not persist across reload');
 document.querySelector('[data-testid="special-restore-standard_yulu"]').click();await wait(()=>document.querySelector('[data-testid="special-edit-standard_yulu"]'));
 await foundation.router.push('/personnel');await pause(250);
 const card=document.querySelector('[data-testid="stat-card-yulu"]');if(!card||!card.getBoundingClientRect().height||card.querySelector('.stat-label').textContent!=='助学补贴')throw Error('Restore lost alias or card');
 document.querySelector('[data-testid="stat-yulu"]').click();await pause(100);if(foundation.personnel.filtered.length!==2)throw Error('Restore lost matching residents');
 await foundation.router.push('/settings?tab=special');await wait(()=>document.querySelector('[data-testid="special-edit-standard_yulu"]'));document.querySelector('[data-testid="special-edit-standard_yulu"]').click();await wait(()=>document.querySelector('[data-testid="special-label-input"]'));
 document.querySelector('[data-testid="special-reset-label"]').click();document.querySelector('[data-testid="special-save"]').click();await wait(()=>!document.querySelector('[data-testid="special-category-editor"]'));
 await foundation.router.push('/personnel');await pause(200);if(document.querySelector('[data-testid="stat-card-yulu"] .stat-label')?.textContent!=='雨露计划')throw Error('Restore original name failed');
 await foundation.router.push('/settings?tab=special');await wait(()=>document.querySelector('[data-testid="special-edit-standard_yulu"]'));
 return {restartPersistence:true,restoreKeepsAliasAndResidents:true,defaultNameRestored:true};
}

export async function checkBasicFields() {
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(test,message)=>{for(let i=0;i<160;i++){if(test())return;await pause(25);}throw Error(message || 'Basic field UI timeout');};
 const el=id=>document.querySelector(`[data-testid="${id}"]`);
 const click=id=>{if(!el(id))throw Error(`Missing ${id}`);el(id).click();};
 const input=(element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
 const {foundation}=await import('../../src/renderer/foundation/bootstrap.mjs');
 await foundation.router.push('/settings?tab=special');await wait(()=>el('special-edit-standard_yulu'));
 click('special-edit-standard_yulu');await wait(()=>el('basic-label-school'));
 input(el('basic-label-school'),'就读院校');click('basic-toggle-school');click('special-save');await wait(()=>!el('special-category-editor'),'Basic field save failed');
 click('special-edit-standard_poverty');await wait(()=>el('basic-option-is_monitor-0'));
 input(el('basic-option-is_monitor-0'),'未纳入');input(el('basic-option-is_monitor-1'),'已纳入');
 click('basic-add-option-is_monitor');await pause(30);input(el('basic-option-is_monitor-2'),'待核实');
 click('basic-option-toggle-is_monitor-1');click('special-save');await wait(()=>!el('special-category-editor'));
 await foundation.router.push('/personnel');await pause(200);
 click('edit-person-synthetic-0');await wait(()=>document.querySelector('#p_yulu_school'));
 await wait(()=>document.querySelector('#p_yulu_school').closest('.form-field-item').classList.contains('community-category-hidden'),'Deleted base field still visible');
 await wait(()=>el('resident-basic-poverty-is_monitor'),'Configured select missing');
 const select=el('resident-basic-poverty-is_monitor');
 if(select.value!=='是' || ![...select.options].some(o=>o.value==='是' && o.text==='已纳入（历史值）'))throw Error('Deleted old option value was not preserved');
 if(![...select.options].some(o=>o.text==='未纳入' && o.value==='否') || [...select.options].some(o=>o.text==='已纳入') || ![...select.options].some(o=>o.text==='待核实'))throw Error('Option editing/deletion/addition not reflected');
 select.value='否';select.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('#foundation-resident-extra-root [data-editor-content="accounts"]'));await pause(100);
 input(document.querySelector('#p_phone'),'13900000002');document.querySelector('#saveModalBtn').click();await wait(()=>!el('person-form-dialog'),'Resident save failed');
 click('special-tag-synthetic-0-雨露计划');await wait(()=>document.querySelector('.special-tag-dialog-body'));
 const hidden=document.querySelector('.special-tag-dialog-body .special-tag-detail-row');
 if(hidden.querySelector('.detail-row-label').textContent!=='就读院校' || hidden.getBoundingClientRect().height!==0)throw Error('Deleted field detail still visible');
 [...document.querySelectorAll('.special-tag-dialog-footer button')].find(b=>b.textContent.trim()==='关闭').click();await pause(100);
 click('view-person-synthetic-0');await wait(()=>document.querySelector('[data-testid="household-360-dialog"]'),'Family profile did not open');
 await wait(()=>[...document.querySelectorAll('.household-special-group')].some(g=>g.querySelector('.household-special-title')?.textContent==='雨露计划'),'Family special data missing');
 const householdGroup=[...document.querySelectorAll('.household-special-group')].find(g=>g.querySelector('.household-special-title')?.textContent==='雨露计划');
 const householdLabel=[...householdGroup.querySelectorAll('.el-descriptions__label')].find(e=>e.textContent==='就读院校');
 if(!householdLabel || householdLabel.getBoundingClientRect().height!==0 || householdLabel.nextElementSibling.getBoundingClientRect().height!==0)throw Error('Family profile did not hide deleted base field');
 document.querySelector('[data-testid="household-360-dialog"] .el-dialog__headerbtn').click();await wait(()=>!document.querySelector('[data-testid="household-360-dialog"]'));
 await foundation.router.push('/settings?tab=special');await wait(()=>el('special-edit-standard_yulu'));
 click('special-edit-standard_yulu');await wait(()=>el('basic-toggle-school'));click('basic-toggle-school');click('special-save');await wait(()=>!el('special-category-editor'));
 click('special-edit-standard_poverty');await wait(()=>el('basic-option-toggle-is_monitor-1'));click('basic-option-toggle-is_monitor-1');click('special-save');await wait(()=>!el('special-category-editor'));
 return {basicNames:true,basicOptionsRenameAddDeleteRestore:true,basicDeleteRestore:true,detailHidesDeletedField:true,familyProfileBaseFields:true};
}
export async function checkBasicFieldsAfterReload() {
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async fn=>{for(let i=0;i<160;i++){if(fn())return;await pause(25);}throw Error('Basic reload timeout');};
 const {foundation}=await import('../../src/renderer/foundation/bootstrap.mjs');await foundation.personnel.load({force:true});await foundation.router.push('/personnel');await pause(200);
 document.querySelector('[data-testid="edit-person-synthetic-0"]').click();await wait(()=>document.querySelector('#p_yulu_school'));
 await wait(()=>document.querySelector('#p_yulu_school').closest('.form-field-item').querySelector('.form-item-label').textContent==='就读院校');
 if(document.querySelector('#p_yulu_school').value!=='合成学校')throw Error('Restore lost old basic value');
 await wait(()=>document.querySelector('[data-testid="resident-basic-poverty-is_monitor"]'));
 const select=document.querySelector('[data-testid="resident-basic-poverty-is_monitor"]');
 if(![...select.options].some(o=>o.value==='是' && o.text==='已纳入') || select.value!=='否')throw Error('Restored options or stored value lost');
 const historic=[...select.options].find(o=>o.text==='待核实');
 await wait(()=>document.querySelector('#foundation-resident-extra-root [data-editor-content="accounts"]'));await pause(150);
 select.value=historic.value;select.dispatchEvent(new Event('change',{bubbles:true}));await pause(50);
 if(select.value!==historic.value)throw Error('New option was reset before save');
 document.querySelector('#saveModalBtn').click();await wait(()=>!document.querySelector('[data-testid="person-form-dialog"]'));
 document.querySelector('[data-testid="special-tag-synthetic-0-脱贫户"]').click();await wait(()=>document.querySelector('.special-tag-dialog-body'));
 await wait(()=>[...document.querySelectorAll('.detail-row-value')].some(e=>e.textContent==='待核实'));
 [...document.querySelectorAll('.special-tag-dialog-footer button')].find(b=>b.textContent.trim()==='关闭').click();await pause(100);
 await foundation.router.push('/settings?tab=special');await wait(()=>document.querySelector('[data-testid="special-edit-standard_poverty"]'));document.querySelector('[data-testid="special-edit-standard_poverty"]').click();await wait(()=>document.querySelector('[data-testid="basic-option-toggle-is_monitor-2"]'));document.querySelector('[data-testid="basic-option-toggle-is_monitor-2"]').click();document.querySelector('[data-testid="special-save"]').click();await wait(()=>!document.querySelector('[data-testid="special-category-editor"]'));
 await foundation.router.push('/personnel');await pause(200);document.querySelector('[data-testid="edit-person-synthetic-0"]').click();await wait(()=>document.querySelector('[data-testid="resident-basic-poverty-is_monitor"]'));
 const removed=document.querySelector('[data-testid="resident-basic-poverty-is_monitor"]');if(removed.value!==historic.value || ![...removed.options].some(o=>o.value===historic.value && o.text==='待核实（历史值）'))throw Error('Deleted custom option cleared historical value');
 await wait(()=>document.querySelector('#foundation-resident-extra-root [data-editor-content="accounts"]'));await pause(100);document.querySelector('#saveModalBtn').click();await wait(()=>!document.querySelector('[data-testid="person-form-dialog"]'));
 await foundation.router.push('/settings?tab=special');return {basicRestartPersistence:true,basicHistoryRestored:true,newOptionSavedAndDisplayed:true,deletedOptionHistoryRetained:true};
}
