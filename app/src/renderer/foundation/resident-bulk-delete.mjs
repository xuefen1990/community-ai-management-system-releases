import {useDialogStore} from './vendor/assets/foundation-runtime.mjs';

// Capture only the existing final confirmation, ahead of its legacy per-row
// handler. Both mouse and Enter use the same atomic operation. Vendor is read-only.
export function installResidentBulkDelete(store) {
 const dialogs=useDialogStore();let pending=false;
 const originalSync=store.checkAndSync.bind(store);
 store.checkAndSync=(...args)=>pending?Promise.resolve(false):originalSync(...args);
 const modal=()=>document.querySelector('[data-testid="delete-all-personnel-dialog"]');
 async function execute(dialog){
  if(pending || dialog.querySelector('input[data-testid="delete-all-confirm-input"], [data-testid="delete-all-confirm-input"] input')?.value!=='确认删除')return;
  pending=true;
  const items=store.people.map(person=>({id:person.id,baseVersion:person.version}));
  const controls=[...dialog.querySelectorAll('input,button')].map(element=>({element,disabled:element.disabled}));
  for(const {element}of controls)element.disabled=true;
  dialog.setAttribute('aria-busy','true');
  const progress=document.createElement('p');progress.setAttribute('role','status');progress.dataset.testid='resident-delete-progress';progress.textContent=`正在批量清空 ${items.length} 名居民档案，请稍候…`;
  dialog.querySelector('.el-dialog__body').append(progress);
  let committed=false,close=false;
  try{
   if(!items.length)throw Error('当前没有可删除的居民，请关闭窗口并刷新');
   const response=await window.api.businessRequest({method:'DELETE',path:'/api/v3/people',body:{items,confirmation:'确认删除',operationUuid:crypto.randomUUID()}});
   if(!response?.ok)throw Error(response?.error?.message || '清空失败，请刷新后重试');
   committed=true;
   progress.textContent='删除完成，正在刷新居民档案…';
   await store.load({force:true});
   if(store.error)throw Error(store.error);
   store.clearSelection();
   const {deletedCount,remainingCount}=response.data;
   dialogs.notify({type:remainingCount?'warning':'success',message:remainingCount?`已删除 ${deletedCount} 名居民；另有 ${remainingCount} 名并发新增居民已保留。`:`已成功清空 ${deletedCount} 名居民档案`});
   close=true;
  }catch(error){
   let message=error.message || '清空失败，请刷新后重试';
   if(committed){message=`删除已完成，但列表刷新失败。请关闭窗口后刷新，勿重复清空。${message}`;close=true;}
   progress.textContent=message;progress.setAttribute('role','alert');progress.dataset.testid='resident-delete-error';
   dialogs.notify({type:'error',message});
  }finally{
   pending=false;dialog.removeAttribute('aria-busy');
   for(const {element,disabled}of controls)element.disabled=disabled;
   if(close)dialog.querySelector('.el-dialog__headerbtn')?.click();
  }
 }
 function onClick(event){
  const dialog=modal();if(!dialog)return;
  if(pending){event.preventDefault();event.stopImmediatePropagation();return;}
  if(event.target.closest?.('[data-testid="confirm-delete-all-btn"]')){
   event.preventDefault();event.stopImmediatePropagation();dialog.querySelectorAll('[data-testid="resident-delete-error"],[data-testid="resident-delete-progress"]').forEach(e=>e.remove());void execute(dialog);
  }
 }
 function onKeydown(event){
  const dialog=modal();if(!dialog)return;
  if(pending && ['Escape','Enter'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();return;}
  if(event.key==='Enter' && dialog.contains(event.target)){
   event.preventDefault();event.stopImmediatePropagation();dialog.querySelectorAll('[data-testid="resident-delete-error"],[data-testid="resident-delete-progress"]').forEach(e=>e.remove());void execute(dialog);
  }
 }
 document.addEventListener('click',onClick,true);document.addEventListener('keydown',onKeydown,true);
}
