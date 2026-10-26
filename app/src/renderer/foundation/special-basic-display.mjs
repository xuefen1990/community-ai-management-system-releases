// Adapt the existing forms without editing the locked runtime or storage keys.
export function createBasicFieldDisplay(getCatalog, schedule) {
 let activeForm=null;
 const originals=new WeakMap();
 const hide=(element,value)=>{if(element.classList.contains('community-category-hidden')!==value)element.classList.toggle('community-category-hidden',value);};
 const replace=(element,value)=>{if(element && element.textContent!==value)element.textContent=value;};
 const source=element=>{const previous=originals.get(element);return previous && element.textContent===previous.applied?previous.source:element.textContent.trim();};
 const label=(element,value)=>{if(!element)return;const original=source(element);originals.set(element,{source:original,applied:value});replace(element,value);};
 const selectControl=(row,control,field,category)=>{
  let select=row.querySelector(':scope > .community-basic-select');
  const configured=category.row?.basicFieldOverrides?.[field.key]?.options;
  const original=control.closest('.el-select') || control;
  if(!configured || !activeForm){select?.remove();hide(original,false);return;}
  hide(original,true);
  if(!select){select=document.createElement('select');select.className='community-basic-select';select.dataset.testid=`resident-basic-${category.key}-${field.key}`;row.append(select);}
  select.setAttribute('aria-label',field.label);
  const current=String(activeForm[field.formGroup]?.[field.key] ?? '');
  const choices=field.options.filter(o=>!o.deleted);
  const historic=field.options.find(o=>o.value===current);
  if(current && !choices.some(o=>o.value===current))choices.push({value:current,label:`${historic?.label || current}（历史值）`});
  const signature=JSON.stringify(choices);
  if(select.dataset.signature!==signature){
   select.replaceChildren(new Option('请选择',''),...choices.map(o=>new Option(o.label,o.value)));
   select.dataset.signature=signature;
  }
  if(select.value!==current)select.value=current;
  select.onchange=()=>{
   const form=activeForm;if(!form?.[field.formGroup])return;
   form[field.formGroup][field.key]=select.value;
   if(field.formGroup==='lowIncomeInfo' && field.key==='category' && select.value){
    const extreme=/特困|五保/.test(select.value);
    form.tags=form.tags.filter(t=>!['低保户','特困户','低保边缘家庭','临时救助对象'].includes(t));form.tags.push(extreme?'特困户':'低保户');
   }
   schedule();
  };
 };
 const decorate=()=>{
  const catalog=getCatalog();
  for(const category of catalog.filter(c=>c.isSystem)){
   if(['low_income','extreme_poor'].includes(category.key) && activeForm){
    const extreme=activeForm.tags.includes('特困户');if(extreme!==(category.key==='extreme_poor'))continue;
   }
   for(const field of category.basicSchema || []){
    const control=document.getElementById(field.controlId),row=control?.closest('.form-field-item');if(!row)continue;
    hide(row,field.deleted);label(row.querySelector('.form-item-label'),field.label);
    if(field.type==='select')selectControl(row,control,field,category);
   }
  }
  document.querySelectorAll('.special-tag-dialog-body,.household-special-group').forEach(section=>{
   const title=section.matches('.household-special-group')?section.querySelector('.household-special-title'):section.closest('.el-dialog')?.querySelector('.special-tag-dialog-title');
   if(!title)return;
   const titleText=source(title),category=catalog.find(c=>c.aliases.some(alias=>titleText===alias || titleText.includes(`${alias}详情`)) || titleText===c.displayName);
   if(!category?.basicSchema)return;
   for(const row of section.querySelectorAll('.special-tag-detail-row,.el-descriptions__label')){
    const element=row.matches('.el-descriptions__label')?row:row.querySelector('.detail-row-label');if(!element)continue;
    const field=category.basicSchema.find(f=>f.aliases.includes(source(element)));if(!field)continue;
    hide(row,field.deleted);label(element,field.label);
    if(row.matches('.el-descriptions__label') && row.nextElementSibling)hide(row.nextElementSibling,field.deleted);
    const value=row.matches('.el-descriptions__label')?row.nextElementSibling:row.querySelector('.detail-row-value');if(value && field.type==='select'){
     const original=source(value),choice=field.options.find(o=>o.value===original);if(choice)label(value,choice.label);
    }
   }
  });
 };
 return {decorate,setForm:form=>{activeForm=form;schedule();}};
}
