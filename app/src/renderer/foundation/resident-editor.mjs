import { onMounted, onBeforeUnmount, ref, useDialogStore, usePersonnelStore } from './vendor/assets/foundation-runtime.mjs';
import { toIpcData } from './ipc-data.mjs';

const tabs = [['accounts','收款账户'],['custom','扩展资料'],['payments','费用发放记录'],['operations','操作记录'],['sources','来源与更正记录']];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function installResidentEditor(loadScript) {
  window.communityCreateResidentEditor = options => {
    const { person, form, active, scroll, navigate, emit } = options;
    const saving = ref(false), identityEditing = ref(false), dialogs = useDialogStore();
    let initialPerson, initialDefinitions;
    let draft, snapshot, originalForm = JSON.stringify(form), touched = false, mounted = false, disposed = false;
    let root, sidebar, errorBox, pendingClose = false;
    const ready = person ? Promise.all([
      window.api.businessRequest({path:`/api/v3/people/editor?id=${encodeURIComponent(person.id)}`}).then(result=>{if(!result.ok)throw new Error(result.error.message);return result.data;}),
      loadScript('../shared/chinese-identity-card.js').then(()=>loadScript('../shared/contract-fee-model.js')).then(()=>loadScript('../shared/resident-record-presentation.js')).then(()=>loadScript('js/resident-subsidy-profile.js')),
    ]).then(([data])=>{snapshot=data; initialPerson=structuredClone(data.person);initialDefinitions=structuredClone(data.customFields); if(data.version!==person.version)throw new Error('居民资料已更新，请关闭窗口并刷新后编辑');return data;}) : Promise.resolve();
    ready.catch(()=>{});
    function showError(error) { if(errorBox){errorBox.hidden=false;errorBox.textContent=error.message||String(error);} else dialogs.notify({type:'error',message:error.message||String(error)}); }
    function clearError() { if(errorBox){errorBox.hidden=true;errorBox.textContent='';} }
    function beginIdentityCorrection() {
      const hint=document.querySelector('#idCardHint');
      if(identityEditing.value)return;
      identityEditing.value=true;if(hint){hint.disabled=true;hint.setAttribute('aria-disabled','true');}clearError();
      requestAnimationFrame(()=>{
        const current=document.querySelector('input#p_id_card')||document.querySelector('#p_id_card input');
        current?.focus();current?.select();current?.closest('.el-input')?.classList.add('resident-identity-correcting');
      });
    }
    function installIdentityCorrection() {
      const hint=document.querySelector('#idCardHint');
      if(!hint)return false;
      if(!hint.dataset.residentCorrectIdentity) {
        hint.dataset.residentCorrectIdentity='true';hint.setAttribute('role','button');hint.tabIndex=0;hint.setAttribute('aria-label','更正身份证号');
        hint.addEventListener('click',beginIdentityCorrection);
        hint.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();beginIdentityCorrection();}});
      }
      return true;
    }
    function render(tab) {
      if(!root||!draft)return;
      const key=tab==='custom'?'accounts':tab;
      const host=root.querySelector(`[data-editor-content="${key}"]`);
      if(!host)return;
      const inputs=[...host.querySelectorAll('[data-resident-new-card],[data-resident-new-bank],[data-resident-new-account-name]')].map(input=>[input.attributes[0].name,input.value]);
      draft.render(host,key);
      if(key==='accounts') {
        const sections=host.querySelectorAll(':scope > .resident-profile-section');
        if(sections[1])sections[1].id='sec_custom';
        const existing=new Set((snapshot.person.bankAccounts||[]).map(a=>a.cardNumber));
        if(!existing.has(inputs[0]?.[1])) for(const [attribute,value] of inputs){const input=host.querySelector(`[${attribute}]`);if(input)input.value=value;}
        host.querySelectorAll('[data-resident-save-custom-fields]').forEach(button=>button.remove());
        host.querySelectorAll('[data-resident-save-account-edit]').forEach(button=>button.textContent='完成账户编辑');
      }
      host.querySelectorAll('.resident-profile-section > .cf-section-head h4').forEach(heading=>heading.classList.add('section-title'));
    }
    const handleInput = event => {
      touched = true;
      if(event.target.matches('[data-resident-custom-field]')) {
        snapshot.person.customFields ||= {};
        snapshot.person.customFields[event.target.dataset.residentCustomField]=event.target.value;
      }
    };
    const syncNav = () => { sidebar?.querySelectorAll('[data-editor-nav]').forEach(button=>button.classList.toggle('active',button.dataset.editorNav===active.value)); };
    onMounted(async()=>{
      mounted=true;
      if(!person)return;
      await ready.catch(error=>{showError(error);});
      for(let attempt=0;attempt<100&&!document.querySelector('#foundation-resident-extra-root');attempt++)await new Promise(resolve=>setTimeout(resolve,20));
      if(disposed)return;
      sidebar=document.querySelector('[data-testid="person-form-sidebar"]');
      root=document.querySelector('#foundation-resident-extra-root');
      if(!root||!scroll.value){showError(new Error('编辑窗口未就绪，请重新打开'));return;}
      errorBox=document.createElement('div');errorBox.className='resident-editor-error';errorBox.hidden=true;root.appendChild(errorBox);
      scroll.value.appendChild(root);
      try {
        await ready;if(disposed)return;
        // The draft belongs to this dialog only. It never mutates the shared
        // workspace or writes a card before the native Confirm Save button.
        draft=window.createResidentEditorDraft(snapshot.person,snapshot.customFields,render);
        for(let attempt=0;attempt<20&&!installIdentityCorrection();attempt++)await new Promise(resolve=>setTimeout(resolve,20));
        for(const [key,label] of tabs) {
          const button=document.createElement('button');button.type='button';button.className='modal-nav-link';for(const attr of sidebar.querySelector('.modal-nav-link')?.attributes||[])if(attr.name.startsWith('data-v-'))button.setAttribute(attr.name,'');button.dataset.editorNav=`sec_${key}`;button.textContent=label;
          button.addEventListener('click',()=>{navigate(`sec_${key}`);syncNav();});sidebar.appendChild(button);
          if(key==='custom')continue;
          const section=document.createElement('section');section.id=`sec_${key}`;section.className='form-section-block';
          const heading=document.createElement('h4');heading.className='section-title';heading.textContent=label;
          const content=document.createElement('div');content.dataset.editorContent=key;content.className='resident-profile-body';
          if(key!=='accounts')section.appendChild(heading);section.appendChild(content);root.appendChild(section);render(key);
        }
        root.addEventListener('input',handleInput);root.addEventListener('change',handleInput);scroll.value.addEventListener('scroll',syncNav);
        if(window.communityResidentInitialSection?.id===person.id){const section=window.communityResidentInitialSection.section;window.communityResidentInitialSection=null;requestAnimationFrame(()=>{navigate(section);syncNav();});}
      }catch(error){showError(error);}
    });
    onBeforeUnmount(()=>{disposed=true;draft?.dispose();scroll.value?.removeEventListener('scroll',syncNav);root?.remove();sidebar?.querySelectorAll('[data-editor-nav]').forEach(button=>button.remove());});
    return { saving, identityEditing, beginIdentityCorrection, async handle(event,payload) {
      if(event==='close') {
        if(saving.value||pendingClose)return;
        pendingClose=true;
        try {
          const dirty=touched||JSON.stringify(form)!==originalForm||draft && (!same(snapshot.person, initialPerson)||!same(draft.database.residentCustomFields,initialDefinitions));
          if(dirty&&!await dialogs.confirm('还有未保存的修改，关闭后将放弃这些修改。是否关闭？',{title:'放弃修改'}))return;
          emit('close');
        }finally{pendingClose=false;}
        return;
      }
      if(event!=='save'||!person){emit(event,payload);return;}
      if(saving.value)return;saving.value=true;
      try {
        clearError();
        await ready;if(!draft)throw new Error('账户资料仍在载入，请稍后保存');draft.collect(root);render("accounts");
        const accountChanges={};for(const key of ['bankAccounts','bank_card','bank_account','bankCard','residentOperationLog'])if(!same(snapshot.person[key],initialPerson[key]))accountChanges[key]=snapshot.person[key]??null;
        const previousIdentity=window.CommunityIdentityCard.normalize(initialPerson.idCard||initialPerson.id_card), requestedIdentity=window.CommunityIdentityCard.normalize(payload?.fields?.idCard??payload?.fields?.id_card);
        const identityChanged=previousIdentity!==requestedIdentity;
        let identityChangeConfirmation;
        if(identityChanged) {
          if(!identityEditing.value)throw new Error('请先点击“更正身份证号”，再修改身份证号码');
          const profile=window.CommunityIdentityCard.validate(requestedIdentity);
          if(!profile.valid)throw new Error(`身份证号${profile.reason}`);
          payload.fields.idCard=profile.normalized;delete payload.fields.id_card;payload.fields.birthDate=profile.birthDate;payload.fields.gender=profile.gender;
          const name=String(payload.fields.name||initialPerson.name||'该居民').trim();
          if(!await dialogs.confirm(`请仔细核对：${name}的身份证号将由 ${previousIdentity||'未登记'} 更正为 ${profile.normalized}，出生日期同步为 ${profile.birthDate}，性别同步为${profile.gender}。是否继续？`,{title:'第一次确认：核对身份证更正'}))return;
          if(!await dialogs.confirm(`再次确认更正${name}的身份证号。居民内部编号不会改变，银行卡、家庭关系和历史发放记录将继续保留。确认后立即保存。`,{title:'第二次确认：确认保存'}))return;
          identityChangeConfirmation={firstConfirmed:true,secondConfirmed:true,previousIdCard:previousIdentity,newIdCard:profile.normalized};
        }
        const body=toIpcData({...payload,id:person.id,accountChanges,identityChangeConfirmation,customFields:draft.database.residentCustomFields,customFieldsVersion:snapshot.customFieldsVersion,customValues:snapshot.person.customFields||{}});
        const response=await window.api.businessRequest({method:'PATCH',path:'/api/v3/people/editor',body});
        if(!response.ok)throw new Error(response.error.message);
        emit('close');dialogs.notify({type:'success',message:identityChanged?'身份证号已更正，居民关联资料保持不变':'居民资料与收款账户已保存'});
        await usePersonnelStore().load({force:true});
      }catch(error){showError(error);}finally{saving.value=false;}
    } };
  };
}
