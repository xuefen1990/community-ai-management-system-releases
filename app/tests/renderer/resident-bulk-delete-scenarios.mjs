export async function checkResidentBulkDelete(){
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async(fn,message)=>{for(let i=0;i<600;i++){if(fn())return;await pause(25);}throw Error(message || 'Bulk delete UI timeout');};
 const find=id=>document.querySelector(`[data-testid="${id}"]`);
 const click=id=>{const e=find(id);if(!e)throw Error(`Missing ${id}`);e.click();};
 const {foundation}=await import('../../src/renderer/foundation/bootstrap.mjs');
 await foundation.personnel.load({force:true});await foundation.router.push('/personnel');await wait(()=>find('personnel-more-actions'));
 const count=foundation.personnel.people.length;if(count!==5368)throw Error('Expected synthetic dataset');
 click('personnel-more-actions');await wait(()=>[...document.querySelectorAll('.el-dropdown-menu__item')].some(e=>e.textContent.includes('删除所有居民档案')));
 [...document.querySelectorAll('.el-dropdown-menu__item')].find(e=>e.textContent.includes('删除所有居民档案')).click();
 await wait(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='删除全部'));
 [...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='删除全部').click();await wait(()=>find('delete-all-personnel-dialog'));
 const dialog=find('delete-all-personnel-dialog'),input=dialog.querySelector('input[data-testid="delete-all-confirm-input"], [data-testid="delete-all-confirm-input"] input');
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause(40);
 if(find('resident-delete-progress'))throw Error('Typed confirmation bypassed');
 input.value='确认删除';input.dispatchEvent(new Event('input',{bubbles:true}));await pause(40);
 click('confirm-delete-all-btn');await wait(()=>find('resident-delete-error'),'Failed delete did not release UI');
 if(find('confirm-delete-all-btn').disabled || !find('resident-delete-error').textContent.includes('合成权限失败'))throw Error('Delete error was swallowed');
 if(foundation.personnel.people.length!==count)throw Error('Failure changed local list');
 click('confirm-delete-all-btn');await wait(()=>find('resident-delete-progress'),'Delete progress missing');
 // Synthetic sync/focus/duplicate events cannot start row-by-row deletion.
 if(await foundation.personnel.checkAndSync({notify:true})!==false)throw Error('Sync was not suppressed during delete');
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));find('confirm-delete-all-btn').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 await wait(()=>!find('delete-all-personnel-dialog'),'Delete did not finish/close');
 if(foundation.personnel.people.length!==0)throw Error('Committed delete did not refresh count');
 await wait(()=>document.body.textContent.includes('已成功清空 5368 名居民档案'),'Success notification missing');
 return {count,permissionErrorVisible:true,typedConfirmationRequired:true,syncPaused:true,duplicateBlocked:true,listRefreshed:true};
}
