// The review owns focus; all writes remain in the transactional main process.
export async function openResidentMerge(group, {dialog,node,table,display,fieldLabel}) {
  return new Promise(resolve => {
    const view = dialog('核对重复档案并合并','resident-merge-dialog');
    const hint = node('p','请确认这些档案确为同一人。选择主档后只补空白、保留已有内容，账户和历史资料合并保留；身份证不同必须核实正确号码。','resident-review-hint');
    const fields = node('div',null,'resident-merge-fields'), details = node('div'), error = node('p',null,'resident-review-error');
    error.setAttribute('role','alert');
    const primary = node('select'), name = node('select'), card = node('select');
    const choices = (select,title,values) => {
      select.setAttribute('aria-label',title); select.dataset.testid=`resident-merge-${select===primary?'primary':select===name?'name':'card'}`;
      const empty = node('option','请选择'); empty.value=''; select.append(empty);
      for (const [value,label] of values) { const option=node('option',label);option.value=value;select.append(option); }
      const label=node('label',title);label.append(select);fields.append(label);
    };
    choices(primary,'保留哪份主档',group.people.map((person,index)=>[person.id,`档案 ${index+1} · ${person.name} · ${person.householdNo||'无户号'} · ${person.villageGroupName||'未划组'}`]));
    choices(name,'核实后保留的姓名',[...new Set(group.people.map(person=>person.name).filter(Boolean))].map(value=>[value,value]));
    const cards=[...new Set(group.people.map(person=>globalThis.CommunityIdentityCard.normalize(person.idCard)))];
    choices(card,'核实后保留的身份证号',cards.map(value=>[value,`${value || '未登记'}${globalThis.CommunityIdentityCard.validate(value).valid?'':'（校验不通过，不可选）'}`]));
    [...card.options].forEach(option=>{if(option.value&&!globalThis.CommunityIdentityCard.validate(option.value).valid)option.disabled=true;});
    if (name.options.length===2) name.selectedIndex=1;
    if (cards.length===1 && globalThis.CommunityIdentityCard.validate(cards[0]).valid) card.value=cards[0];
    view.content.append(hint,table(['姓名','身份证号','出生日期','居民组','户号','电话'],group.people.map(p=>[p.name,p.idCard,p.birthDate,p.villageGroupName,p.householdNo,p.phone])),fields,details,error);
    const agreement=node('input');agreement.type='checkbox';agreement.dataset.testid='resident-merge-agree';
    const agreementLabel=node('label',null,'resident-merge-agreement');agreementLabel.append(agreement,document.createTextNode('我已核实是同一人，确认主档、姓名、身份证及所列差异。'));
    agreementLabel.hidden=true;view.content.append(agreementLabel);
    const cancel=node('button','取消'),preview=node('button','查看差异'),confirm=node('button','备份并确认合并','resident-review-primary');
    preview.dataset.testid='resident-merge-preview';confirm.dataset.testid='resident-merge-confirm';confirm.disabled=true;
    let state=null,busy=false,request=null;const operationUuid=crypto.randomUUID();
    const finish=value=>{view.close();resolve(value);};cancel.onclick=()=>{if(!busy)finish(false);};view.onCancel(()=>{if(!busy)finish(false);});
    const controls=()=>{[primary,name,card,preview,cancel,agreement].forEach(e=>e.disabled=busy);confirm.disabled=busy||!state||!agreement.checked;};
    const invalidate=()=>{state=null;details.replaceChildren();agreement.checked=false;agreementLabel.hidden=true;error.textContent='';controls();};
    [primary,name,card].forEach(e=>e.onchange=invalidate);agreement.onchange=controls;
    preview.onclick=async()=>{
      if(busy)return;invalidate();busy=true;controls();
      try {
        if(!primary.value||!name.value||!card.value)throw Error('请选择主档，并核实保留的姓名和身份证号');
        request={primaryId:primary.value,sourceIds:group.people.filter(p=>p.id!==primary.value).map(p=>p.id),name:name.value,idCard:card.value};
        const response=await window.api.businessRequest({method:'POST',path:'/api/v3/people/merge-preview',body:request});
        if(!response?.ok)throw Error(response?.error?.message||'读取差异失败');
        state=response.data;
        details.append(node('h3',`将 ${state.sourceCount} 份档案合并为 1 份`));
        details.append(table(['合并后姓名','身份证号','户号','居民组','电话','标签'],[[state.name,state.idCard,state.result.householdNo,state.result.villageGroupName,state.result.phone,(state.result.tags||[]).join('、')]]));
        details.append(node('p','已有值不同的字段按下表处理；原始档案完整保留在合并记录和备份中。'));
        if(state.differences.length)details.append(table(['字段','主档内容','另一份内容','处理'],state.differences.map(d=>[fieldLabel(d.field),display(d.current),display(d.incoming),d.action||'保留主档内容'])));
        else details.append(node('p','未发现非空字段冲突。'));
        const extra=node('details');extra.append(node('summary','查看合并后的全部资料'),table(['资料项','合并后内容'],Object.entries(state.result).filter(([key])=>!['id','version','created_at','createdAt','updated_at','updatedAt'].includes(key)).map(([key,value])=>[fieldLabel(key),display(value)])));details.append(extra);
        agreementLabel.hidden=false;
      }catch(err){error.textContent=err.message;}finally{busy=false;controls();}
    };
    confirm.onclick=async()=>{
      if(confirm.disabled)return;busy=true;controls();error.textContent='';confirm.textContent='正在备份并合并…';
      try{
        const response=await window.api.businessRequest({method:'POST',path:'/api/v3/people/merge',body:{...request,token:state.token,operationUuid,confirmation:'确认合并'}});
        if(!response?.ok)throw Error(response?.error?.message||'合并失败');
        finish(true);
      }catch(err){state=null;agreement.checked=false;error.textContent=`${err.message}。请重新查看差异后再确认。`;}
      finally{busy=false;confirm.textContent='备份并确认合并';controls();}
    };
    view.footer.append(cancel,preview,confirm);
  });
}
