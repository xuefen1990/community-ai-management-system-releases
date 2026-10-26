import {createElementVNode as h,ref,onMounted,useDialogStore} from './vendor/assets/foundation-runtime.mjs';
import {categoryCatalog,categoryChanges,categoryWrite} from './special-category-model.mjs';
import {basicFieldsFor} from './special-basic-fields.mjs';
const request=async payload=>{const r=await window.api.businessRequest(payload);if(!r?.ok)throw new Error(r?.error?.message || '操作失败');return r.data;};
const btn=(text,onClick,testid,kind='')=>h('button',{type:'button',class:`special-category-button ${kind}`,'data-testid':testid,onClick},text);
const types=[['text','文本'],['number','数值'],['select','下拉单选'],['date','日期'],['month','年月'],['boolean','开关']];
export const SpecialCategoryPanel={setup(){
  const dialogs=useDialogStore(),catalog=ref([]),busy=ref(false),error=ref(''),editing=ref(null),draft=ref(null),showDeleted=ref(false);
  const load=async()=>{catalog.value=categoryCatalog((await request({path:'/api/v3/special-categories'})).items || []);};
  const run=async fn=>{if(busy.value)return;busy.value=true;error.value='';try{await fn();}catch(e){error.value=e.message;}finally{busy.value=false;}};
  onMounted(()=>run(load));
  const edit=c=>{if(busy.value)return;error.value='';editing.value=c;draft.value={displayName:c.displayName,fieldSchema:JSON.parse(JSON.stringify(c.fieldSchema)),basicFieldOverrides:Object.fromEntries((c.basicSchema || []).map(f=>[f.key,JSON.parse(JSON.stringify({label:f.label,deleted:f.deleted,...(f.type==='select'?{options:f.options}:{})}))]))};};
  const persist=async(c,changes)=>{await request(categoryWrite(c,changes));await load();await window.communityRefreshSpecialCategories?.();};
  const save=()=>run(async()=>{const changes=categoryChanges(editing.value,draft.value,catalog.value);await persist(editing.value,changes);editing.value=null;draft.value=null;dialogs.notify({type:'success',message:'标签与字段配置已保存'});});
  const remove=c=>run(async()=>{if(!await dialogs.confirm({message:`删除标签“${c.displayName}”后，将从标签选择、录入和筛选入口移除。已有居民身份和字段资料会保留，可在“已删除标签”恢复。`,title:'删除居民标签',confirmText:'删除标签'}))return;
    await persist(c,{deletedAt:new Date().toISOString()});dialogs.notify({type:'success',message:'标签已删除，历史资料已保留'});});
  const restore=c=>run(async()=>{await persist(c,{deletedAt:null});dialogs.notify({type:'success',message:'标签已恢复'});});
  const add=()=>{const id=`special_${crypto.randomUUID()}`;edit({id,code:id,name:'',displayName:'',aliases:[],isSystem:false,row:null,fieldSchema:[],basicFields:[]});};
  // A new custom category needs its canonical name on first creation only.
  const saveNew=()=>run(async()=>{const c=editing.value,changes=categoryChanges(c,draft.value,catalog.value);await persist({...c,name:changes.displayName},changes);editing.value=null;draft.value=null;dialogs.notify({type:'success',message:'标签已添加'});});
  const card=c=>h('article',{class:'special-category-card',key:c.id,'data-testid':`${c.isSystem?'builtin':'custom'}-cat-card-${c.code}`},[
    h('div',{class:'special-category-card-head'},[h('strong',{},c.displayName),h('span',{class:'special-category-kind'},c.isSystem?'系统内置':'自定义'),h('div',{class:'special-category-card-actions'},[
      c.deleted?btn('恢复',()=>restore(c),`special-restore-${c.code}`):btn('编辑',()=>edit(c),`special-edit-${c.code}`),
      !c.deleted?btn('删除',()=>remove(c),`special-delete-${c.code}`,'danger'):null])]),
    c.isSystem?h('p',{class:'special-category-canonical'},`系统原标签：${c.name}`):null,
    c.basicFields.length?h('div',{},[h('span',{class:'special-category-section-label'},'基础字段：'),...(c.basicSchema || []).map(field=>h('span',{class:`special-category-field-pill ${field.deleted?'is-deleted':''}`},`${field.label}${field.deleted?'（已删除）':''}`))]):null,
    h('div',{},[h('span',{class:'special-category-section-label'},'扩展字段：'),...c.fieldSchema.map(f=>h('span',{class:'special-category-field-pill'},`${f.label} · ${types.find(t=>t[0]===f.type)?.[1] || f.type}`)),!c.fieldSchema.length?h('span',{class:'special-category-muted'},'未添加扩展字段'):null]),
  ]);
  const editor=()=>editing.value?h('div',{class:'special-category-backdrop'},[h('section',{class:'special-category-editor',role:'dialog','aria-modal':'true','aria-labelledby':'special-category-editor-title','data-testid':'special-category-editor'},[
    h('h3',{id:'special-category-editor-title'},`${editing.value.name?'编辑':'添加'}居民标签`),
    h('label',{},['标签名称',h('input',{value:draft.value.displayName,maxlength:60,'data-testid':'special-label-input',onInput:e=>draft.value.displayName=e.target.value})]),
    editing.value.isSystem?h('p',{class:'special-category-muted'},`原标签“${editing.value.name}”的居民关联与基础资料会保留。`):null,
    editing.value.isSystem?h('section',{class:'special-basic-editor'},[
      h('h4',{},'基础字段设计'),h('p',{class:'special-category-muted'},'可改名、调整下拉选项、删除或恢复。原数据类型与已录入资料保留。'),
      ...basicFieldsFor(editing.value.key).map(field=>{const config=draft.value.basicFieldOverrides[field.key];return h('article',{class:`special-basic-field ${config.deleted?'is-deleted':''}`,key:field.key,'data-testid':`basic-field-${field.key}`},[
       h('div',{class:'special-category-field-row'},[
        h('input',{value:config.label,'aria-label':`${field.originalLabel}名称`,'data-testid':`basic-label-${field.key}`,onInput:e=>config.label=e.target.value}),
        h('span',{class:'special-basic-type'},`原类型：${types.find(t=>t[0]===field.type)?.[1] || field.type}`),
        btn(config.deleted?'恢复字段':'删除字段',()=>config.deleted=!config.deleted,`basic-toggle-${field.key}`,config.deleted?'':'danger')]),
       field.type==='select'?h('div',{class:'special-basic-options'},[
        ...config.options.map((option,index)=>h('div',{class:`special-category-field-row ${option.deleted?'is-deleted':''}`,key:option.value},[
         h('input',{value:option.label,'aria-label':`${field.originalLabel}选项${index+1}`,'data-testid':`basic-option-${field.key}-${index}`,onInput:e=>option.label=e.target.value}),
         btn(option.deleted?'恢复选项':'删除选项',()=>option.deleted=!option.deleted,`basic-option-toggle-${field.key}-${index}`,option.deleted?'':'danger')
        ])),btn('添加选项',()=>config.options.push({value:`${editing.value.key==='extreme_poor'?'特困户':editing.value.key==='low_income'?'低保户':'custom'}_${crypto.randomUUID()}`,label:'',deleted:false}),`basic-add-option-${field.key}`)
       ]):null
      ]);})
    ]):null,
    h('div',{class:'special-category-editor-head'},[h('h4',{},'扩展字段设计'),btn('添加字段',()=>draft.value.fieldSchema.push({key:`f_${crypto.randomUUID().replaceAll('-','')}`,label:'',type:'text',options:[]}), 'special-add-field')]),
    ...draft.value.fieldSchema.map((f,i)=>h('div',{class:'special-category-field-row',key:f.key},[
      h('input',{value:f.label,placeholder:'字段名称','aria-label':`第${i+1}个字段名称`,onInput:e=>f.label=e.target.value}),
      h('select',{value:f.type,'aria-label':`第${i+1}个字段类型`,onChange:e=>f.type=e.target.value},types.map(([v,l])=>h('option',{value:v},l))),
      f.type==='select'?h('input',{value:Array.isArray(f.options)?f.options.join('，'):f.options,placeholder:'选项以逗号分隔','aria-label':`第${i+1}个字段选项`,onInput:e=>f.options=e.target.value}):null,
      btn('移除字段',()=>draft.value.fieldSchema.splice(i,1),`special-remove-field-${i}`,'danger')
    ])),
    h('p',{class:'special-category-muted'},'移除扩展字段不会删除已经录入的历史字段值。'),
    error.value?h('p',{role:'alert',class:'special-category-error'},error.value):null,
    h('div',{class:'special-category-editor-actions'},[editing.value.isSystem?btn('使用原标签名称',()=>draft.value.displayName=editing.value.name,'special-reset-label'):null,
      btn('取消',()=>{if(!busy.value){editing.value=null;draft.value=null;error.value='';}},'special-cancel'),
      h('button',{type:'button',class:'special-category-button primary',disabled:busy.value,'data-testid':'special-save',onClick:editing.value.name?save:saveNew},busy.value?'保存中…':'保存')]),
  ])]):null;
  return()=>h('section',{class:'special-category-manager','data-testid':'community-special-categories','aria-busy':String(busy.value)},[
    h('header',{class:'special-category-manager-head'},[h('div',{},[h('h3',{},`居民专项标签（${catalog.value.filter(c=>!c.deleted).length} 项）`),h('p',{},'内置与自定义标签均可改名和删除；基础字段与扩展字段可编辑，删除后保留历史资料并可恢复。')]),btn('添加自定义标签',add,'special-add-category','primary')]),
    error.value && !editing.value?h('p',{role:'alert',class:'special-category-error'},error.value):null,
    h('div',{class:'special-category-grid'},catalog.value.filter(c=>!c.deleted).map(card)),
    h('button',{type:'button',class:'special-category-deleted-toggle','data-testid':'special-deleted-toggle',onClick:()=>showDeleted.value=!showDeleted.value},`${showDeleted.value?'收起':'查看'}已删除标签（${catalog.value.filter(c=>c.deleted).length}）`),
    showDeleted.value?h('div',{class:'special-category-grid special-category-deleted'},catalog.value.filter(c=>c.deleted).map(card)):null,
    editor(),
  ]);
}};
