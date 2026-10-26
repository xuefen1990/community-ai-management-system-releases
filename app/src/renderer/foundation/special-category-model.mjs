import {basicFieldsFor,validateBasicOverrides,preserveBasicHistory} from './special-basic-fields.mjs';
// Canonical identities stay unchanged; this module only manages category configuration.
const definitions = [
  ['party', '党员', ['中共党员'], ['入党时间','所在党支部','党内职务']],
  ['veteran', '退役军人', [], ['人员类别','原服役部队/兵种','入伍时间','退伍时间']],
  ['low_income', '低保户', [], ['保障类别','月补助金额','批准享受时间','救助专卡卡号']],
  ['extreme_poor', '特困户', ['特困难户','五保户','五保'], ['保障类别','月救助金额','批准享受时间','救助专卡卡号','特困供养方式','照料护理人姓名']],
  ['disability', '残疾人', ['残疾人员'], ['残疾人证号','残疾类别','残疾等级','残疾证有效期至']],
  ['labor', '务工人员', [], ['务工状态','务工地点/城市','从事行业 / 企业名称']],
  ['student', '学生', ['在读学生'], ['就读阶段','就读学校全称','预计毕业时间/年份']],
  ['poverty', '脱贫户', ['脱贫农户'], ['脱贫年度','主要帮扶措施','当年家庭人均纯收入','是否纳入防返贫监测']],
  ['yulu', '雨露计划', [], ['就读学校','所学专业','补贴金额','当前学年','户主姓名']],
  ['monitor', '监测户', ['监测农户'], ['致贫返贫风险原因','监测识别时间','帮扶责任人','风险消除状态']],
];
export const BUILTIN_CATEGORIES = definitions.map(([key,name,aliases,basicFields]) => ({
  key, code:`standard_${key}`, name, aliases:[name,...aliases], basicFields, isSystem:true,
  statKey:({low_income:'lowIncome',extreme_poor:'extremePoor',disability:'disabled'})[key] || key,
}));
const clean = value => String(value ?? '').trim();
export function builtinFor(row) {
  return BUILTIN_CATEGORIES.find(b => [b.code,`sc_${b.code}`].includes(row.code) || [b.code,`sc_${b.code}`].includes(row.id))
    || BUILTIN_CATEGORIES.find(b => b.aliases.includes(row.name));
}
export function categoryCatalog(rows = []) {
  const builtins = BUILTIN_CATEGORIES.map(b => {
    const row=rows.find(r=>builtinFor(r)?.code===b.code);
    return {...b,row:row || null,id:row?.id || `sc_${b.code}`,displayName:clean(row?.displayName) || b.name,
      deleted:!!row?.deletedAt,fieldSchema:row?.fieldSchema || [],basicSchema:basicFieldsFor(b.key,row?.basicFieldOverrides)};
  });
  return [...builtins,...rows.filter(r=>!builtinFor(r)).map(row=>({
    ...row,row,displayName:clean(row.displayName) || row.name,aliases:[row.name],deleted:!!row.deletedAt,basicFields:[],basicSchema:[],isSystem:!!Number(row.isSystem),
  }))];
}
export function categoryChanges(category, draft, catalog) {
  const displayName=clean(draft.displayName);
  if (!displayName || displayName.length>60) throw new Error('标签名称须为 1 至 60 个字');
  const comparable=displayName.toLocaleLowerCase();
  if (catalog.some(c=>c.id!==category.id && [c.displayName,c.name,...(c.aliases || [])].some(n=>clean(n).toLocaleLowerCase()===comparable))) throw new Error('该标签名称已存在，请使用其他名称');
  const basicFieldOverrides=category.isSystem?validateBasicOverrides(category.key,draft.basicFieldOverrides || category.row?.basicFieldOverrides):{};
  const basicSchema=basicFieldsFor(category.key,basicFieldOverrides);
  const keys=new Set(), labels=new Set();
  const fieldSchema=(draft.fieldSchema || []).map(field=>{
    const label=clean(field.label),key=clean(field.key);
    if(!label || !key)throw new Error('请填写完整的扩展字段名称');
    if(keys.has(key) || labels.has(label) || basicSchema.some(f=>f.label===label || f.originalLabel===label))throw new Error('字段名称或标识重复');
    keys.add(key);labels.add(label);
    if(!['text','number','select','date','month','boolean'].includes(field.type))throw new Error('字段类型不正确');
    const options=field.type==='select' ? (Array.isArray(field.options)?field.options:String(field.options || '').split(/[,，、\n]/)).map(clean).filter(Boolean) : [];
    if(field.type==='select' && (!options.length || new Set(options).size!==options.length))throw new Error('下拉字段需要填写不重复的选项');
    return {...field,key,label,options};
  });
  return {displayName,fieldSchema,...(category.isSystem?{basicFieldOverrides}:{})};
}
export function categoryWrite(category, changes) {
  if(category.row) return {method:'PATCH',path:`/api/v3/special-categories/${encodeURIComponent(category.row.id)}`,
    body:{baseVersion:category.row.version,changes}};
  return {method:'POST',path:'/api/v3/special-categories',body:{
    id:category.id,code:category.code,name:category.name,isSystem:category.isSystem?1:0,fieldSchema:[],...changes,
  }};
}
export function deletedStatKeys(catalog) {return catalog.filter(c=>c.deleted && c.statKey).map(c=>c.statKey);}
export function labelCategory(text, catalog) {
  const name=clean(text);return catalog.find(c=>c.aliases?.includes(name) || c.name===name);
}

// The old resident editor rebuilds extension groups from visible definitions.
// Preserve deleted groups and removed field values when another field is saved.
export function preserveCategoryHistory(person, payload, catalog, form) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const previous = person.customFields || {};
  const fields = {...payload.fields,customFields:{...(payload.fields?.customFields || {})}};
  const tags = [...(payload.tags || [])];
  for (const category of catalog.filter(c => c.deleted)) {
    for (const tag of person.tags || []) if (category.aliases.includes(tag) && !tags.includes(tag)) tags.push(tag);
    const key = category.key === 'extreme_poor' ? 'low_income_info' : `${category.key}_info`;
    if (category.isSystem && category.aliases.some(tag => (person.tags || []).includes(tag)) && previous[key]) fields.customFields[key] = clone(previous[key]);
  }
  const before = previous.specialCustomInfo || previous.special_custom_info || {};
  const current = {...(fields.customFields.specialCustomInfo || {})};
  for (const [id, group] of Object.entries(before)) {
    const category = catalog.find(c => [c.id,c.code,c.name].includes(id) || c.name === group.name);
    if (!category || (!category.deleted && !category.aliases.some(tag => tags.includes(tag)))) continue;
    if (category.deleted) {current[id] = clone(group);continue;}
    const targetKey = [category.id,category.code,category.name].find(key => current[key]) || id;
    const target = current[targetKey] || {name:category.name,fields:[]};
    const configured = new Set(category.fieldSchema.map(f => f.key));
    const values = [...(target.fields || [])];
    for (const field of group.fields || []) if (!configured.has(field.key) && !values.some(f => f.key === field.key)) values.push(clone(field));
    current[targetKey] = {...target,fields:values};
  }
  fields.customFields.specialCustomInfo = current;
  return preserveBasicHistory(person,{...payload,fields,tags},catalog,form);
}
