// Immutable storage keys and original control types; overrides are presentation metadata.
const select = labels => labels.map(label => ({value:label,label,deleted:false}));
const definitions = {
 party: ['partyInfo','party', [['join_date','入党时间','date','join_date'],['branch','所在党支部','text','branch'],['duty','党内职务','text','duty']]],
 veteran: ['veteranInfo','vet', [['category','人员类别','select','category',select(['普通退役军人','带病回乡退伍军人','参战退役人员','伤残军人'])],['service_branch','原服役部队/兵种','text','service_branch'],['enlist_date','入伍时间','date','enlist_date'],['discharge_date','退伍时间','date','discharge_date']]],
 low_income: ['lowIncomeInfo','low', [['category','保障类别','select','category',select(['低保户','特困户','低保边缘家庭','临时救助对象'])],['amount','月补助金额','number','amount'],['start_date','批准享受时间','date','start_date'],['bank_card','救助专卡卡号','text','bank_card']]],
 extreme_poor: ['lowIncomeInfo','low', [['category','保障类别','select','category',select(['低保户','特困户','低保边缘家庭','临时救助对象'])],['amount','月救助金额','number','amount'],['start_date','批准享受时间','date','start_date'],['bank_card','救助专卡卡号','text','bank_card'],['support_method','特困供养方式','select','support_method',select(['分散供养','集中供养'])],['caregiver','照料护理人姓名','text','caregiver']]],
 disability: ['disabilityInfo','dis', [['cert_no','残疾人证号','text','cert_no'],['category','残疾类别','select','category',select(['肢体残疾','听力残疾','言语残疾','视力残疾','智力残疾','精神残疾','多重残疾'])],['level','残疾等级','select','level', ['一级','二级','三级','四级'].map((value,i)=>({value,label:`${value} (${['重度','重度','中度','轻度'][i]})`,deleted:false}))],['cert_validity','残疾证有效期至','date','validity']]],
 labor: ['laborInfo','lab', [['status','务工状态','select','status',select(['省外务工','省内县外务工','县内务工','就近务工','自主创业','未就业'])],['location','务工地点/城市','text','location'],['company_type','从事行业 / 企业名称','text','company_type']]],
 student: ['studentInfo','student', [['level','就读阶段','select','level',select(['学前教育','小学','初中','高中','中专/职高','大专','本科','研究生'])],['school','就读学校全称','text','school'],['graduation','预计毕业时间/年份','month','graduation']]],
 poverty: ['povertyInfo','poverty', [['year','脱贫年度','number','year'],['measures','主要帮扶措施','text','measures',null,['帮扶措施']],['income','当年家庭人均纯收入','number','income',null,['当年收入']],['is_monitor','是否纳入防返贫监测','select','is_monitor',select(['否','是'])]]],
 yulu: ['yuluInfo','yulu', [['school','就读学校','text','school'],['major','所学专业','text','major',null,['就读专业']],['subsidy','补贴金额','number','subsidy'],['year','当前学年','text','year'],['head_name','户主姓名','text','head_name']]],
 monitor: ['monitorInfo','monitor', [['type','致贫返贫风险原因','select','type',select(['因病','因残疾','务工就业不稳定','缺少劳动力','因学','因灾','其他'])],['start_date','监测识别时间','date','start_date'],['helper','帮扶责任人','text','helper'],['risk_status','风险消除状态','select','risk_status',select(['未消除','已消除'])]]],
};
export function basicFieldsFor(key, overrides = {}) {
 const definition=definitions[key];if(!definition)return [];
 const [formGroup,prefix,rows]=definition;
 return rows.map(([key,label,type,id,options=[],aliases=[]])=>{
  const override=overrides[key] || {};
  return {key,originalLabel:label,label:override.label || label,type,controlId:`p_${prefix}_${id}`,formGroup,
   storageGroup:formGroup==='lowIncomeInfo'?'low_income_info':`${Object.keys(definitions).find(k=>definitions[k][0]===formGroup)}_info`,
   aliases:[label,...aliases],deleted:!!override.deleted,options:override.options || options || []};
 });
}
export function validateBasicOverrides(categoryKey, overrides = {}) {
 const fields=basicFieldsFor(categoryKey), valid=new Map(fields.map(f=>[f.key,f]));
 const result={},names=new Set();
 for(const key of Object.keys(overrides))if(!valid.has(key))throw Error('基础字段标识不正确');
 for(const field of fields){
  const entry=overrides[field.key] || {},label=String(entry.label ?? field.originalLabel).trim();
  if(!label || label.length>60 || names.has(label))throw Error('基础字段名称须为 1 至 60 个字且不能重复');names.add(label);
  if(entry.type && entry.type!==field.type)throw Error('基础字段保留原数据类型');
  const value={label,deleted:!!entry.deleted};
  if(field.type==='select'){
   const options=entry.options || field.options,values=new Set(),labels=new Set();
   if(!Array.isArray(options))throw Error('下拉选项格式不正确');
   value.options=options.map(o=>{
    const option={value:String(o.value ?? '').trim(),label:String(o.label ?? '').trim(),deleted:!!o.deleted};
    if(!option.value || !option.label || option.label.length>60 || values.has(option.value) || (!option.deleted && labels.has(option.label)))throw Error('下拉选项不能为空或重复');
    values.add(option.value);if(!option.deleted)labels.add(option.label);return option;
   });
   if(!value.options.some(o=>!o.deleted))throw Error('下拉字段至少保留一个选项');
   for(const original of field.options)if(!values.has(original.value))value.options.push({...original,deleted:true});
  }
  const original={label:field.originalLabel,deleted:false,...(field.type==='select'?{options:field.options}:{})};
  if(JSON.stringify(value)!==JSON.stringify(original))result[field.key]=value;
 }
 return result;
}
export function preserveBasicHistory(person, payload, catalog, form) {
 const custom=payload.fields.customFields,previous=person?.customFields || {};
 for(const category of catalog.filter(c=>c.isSystem && !c.deleted && c.aliases.some(tag=>(payload.tags || []).includes(tag)))){
  // The two benefits share one group. Apply only the category actually assigned.
  if(category.key==='low_income' && (payload.tags || []).includes('特困户'))continue;
  for(const field of category.basicSchema || []){
   if(field.deleted && Object.hasOwn(previous[field.storageGroup] || {},field.key)){
    custom[field.storageGroup]={...custom[field.storageGroup],[field.key]:previous[field.storageGroup][field.key]};
   }else if(field.type==='select' && category.row?.basicFieldOverrides?.[field.key]?.options && form?.[field.formGroup]){
    custom[field.storageGroup]={...custom[field.storageGroup],[field.key]:form[field.formGroup][field.key]};
   }
  }
  // The original serializer omits these for customized benefit option values.
  if(category.key==='extreme_poor' && form?.lowIncomeInfo && category.row?.basicFieldOverrides?.category?.options){
   for(const key of ['support_method','caregiver'])if(!category.basicSchema.find(f=>f.key===key)?.deleted)custom.low_income_info={...custom.low_income_info,[key]:form.lowIncomeInfo[key]};
  }
 }
 return payload;
}
