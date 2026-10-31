import {createElementVNode as h,createVNode as component,ref,computed,useDialogStore,router} from './vendor/assets/foundation-runtime.mjs';
import {referenceAggregate,availableStatisticYears} from './vendor/statistics-297.mjs';
import {BUILTIN_CATEGORIES} from './special-category-model.mjs';
import {readAllPages,financeSummary} from './map-statistics-model.mjs';
import '../../shared/finance-chart-groups.js';
export const categoryDefaults=BUILTIN_CATEGORIES.map(c=>({...c,id:'sc_'+c.code,tag:c.name}));
let currentRaw={},sessionEpoch=0;
export async function statisticsIdentity(){const status=await window.api.getLocalAuthStatus();if(!status.authenticated)throw Error('请先登录后查看统计');return JSON.stringify([status.account?.id||status.account?.phone,status.account?.mainAccountId]);}
export const statisticsToast=Object.fromEntries(['success','warning','info','error'].map(type=>[type,value=>useDialogStore().notify({type,message:typeof value==='string'?value:value?.message||''})]));
export async function requestBusiness(input){const result=await window.api.businessRequest(input);if(!result?.ok){const error=Error(result?.error?.message||'业务数据读取失败');error.code=result?.error?.code;throw error;}return result.data;}
export async function saveStatisticsSettings(changes){const data=await requestBusiness({method:'PATCH',path:'/api/v3/system-settings',body:{changes:JSON.parse(JSON.stringify(changes))}});window.dispatchEvent(new CustomEvent('community-map-settings-changed',{detail:changes}));return data;}
const sources=[
 ['personnel','personnel','/people'],['households','personnel','/households'],['villageGroups','personnel','/village-groups'],['specialCategories','personnel','/special-categories'],['householdLinkGroups','personnel','/household-link-groups'],
 ['partyMembers','party','/party/members'],['partyDues','party','/party/dues'],['partyBranches','party','/party/branches'],['partyMeetings','party','/party/meetings'],
 ['serviceRecords','visit','/service-records'],['dutyPlans','work','/duty/plans'],['dutyPeople','work','/duty/people'],['financeRecords','finance','/finance-records'],['landParcels','land','/land-parcels'],
 ['documents','archive','/documents'],['certificateRecords','certificate','/certificate-records'],['operationLogs','workspace','/operation-logs'],['settings','settings','/system-settings'],
];
const labels={personnel:'居民档案',party:'党务管理',visit:'民情工单',work:'村务值班',finance:'财务收支',land:'土地承包',archive:'电子档案',certificate:'证明',workspace:'操作日志',settings:'系统设置'};
export async function loadStatistics(){
 const epoch=sessionEpoch,identity=await statisticsIdentity();currentRaw={};
 const raw={_domainStatus:{},_loadErrors:[]};
 await Promise.all(sources.map(async([key,domain,path])=>{try{raw[key]=await readAllPages(requestBusiness,path);if(!raw._domainStatus[domain])raw._domainStatus[domain]='ready';}catch(error){raw[key]=[];raw._domainStatus[domain]=error.code==='FORBIDDEN'?'forbidden':'error';raw._loadErrors.push({domain:labels[domain],message:error.message});}}));
 // A failure in any part of a domain invalidates that domain's derived totals.
 for(const [key,domain]of sources)if(raw._domainStatus[domain]!=='ready')raw[key]=[];
 if(epoch!==sessionEpoch||await statisticsIdentity()!==identity)throw Error('账号已切换，请重新打开统计页');
 raw._identity=identity;currentRaw=raw;
 const profile=aggregateStatistics(raw,new Date(),{selectedYear:'all'});
 return {...profile,_rawData:raw,availableYearOptions:availableStatisticYears(raw),hasBusinessData:true,businessRecordCount:sources.filter(([key])=>!['settings','operationLogs'].includes(key)).reduce((n,[key])=>n+(raw[key]?.length||0),0),loadErrors:raw._loadErrors};
}
export function aggregateStatistics(raw,now=new Date(),options={}){
 const copy=JSON.parse(JSON.stringify(raw));
 // The reference aggregator annotates records in memory. Never pass authoritative DTOs through it.
 const year=options.selectedYear||'all',finance=financeSummary(raw.financeRecords||[],year);
 copy.financeRecords=finance.records;
 const profile=referenceAggregate(copy,now,options);
 Object.assign(profile,{incomeTotal:finance.incomeTotal,expenseTotal:finance.expenseTotal,balance:finance.balance,finCount:finance.records.length,financeRecords:finance.records});
 Object.assign(profile.financeData,{totalIncome:finance.incomeTotal,totalExpense:finance.expenseTotal,netBalance:finance.balance,totalCount:finance.records.length,incomeCount:finance.records.filter(r=>r.recordType==='income').length,expenseCount:finance.records.filter(r=>r.recordType==='expense').length,incomeCategories:finance.incomeCategories,expenseCategories:finance.expenseCategories});
 profile.selectedYear=year;profile._identity=raw._identity;profile.settings=raw.settings||[];profile._domainStatus=raw._domainStatus||{};profile.loadErrors=raw._loadErrors||[];
 return profile;
}
export function statisticsPeopleStore(){return {get people(){return currentRaw.personnel||[];},get households(){return currentRaw.households||[];},get villageGroups(){return currentRaw.villageGroups||[];},get groupNames(){return(currentRaw.villageGroups||[]).map(g=>g.name);},get specialCategories(){return currentRaw.specialCategories||[];},get householdLinkGroups(){return currentRaw.householdLinkGroups||[];},cadreSettings:{},sensitiveVisible:false,loaded:true,loading:false,async load(){return this;}};}
export const StatisticsDomainGate={props:['profile','domain'],setup(props,{slots}){return()=>props.profile._domainStatus[props.domain]==='ready'?slots.default?.():h('div',{role:'status',class:'statistics-domain-unavailable'},props.profile._domainStatus[props.domain]==='forbidden'?'当前账号没有该分区的查看权限。':'此分区的数据未能完整加载，请点击上方“刷新数据”重试。');}};
export const statisticsIdentityLabel=value=>{const text=String(value||'');return text.length>6?text.slice(0,3)+'********'+text.slice(-3):text;};
function detail(kind){return {props:['profile','land'],emits:['close'],setup(props,{emit}){return()=>{const p=kind==='household'?props.profile:props.land,people=p?.members||[],land=kind==='land'?p:p?.landParcels;return h('div',{class:'community-stat-detail-backdrop',onClick:e=>{if(e.target===e.currentTarget)emit('close');}},[h('section',{class:'community-stat-detail',role:'dialog','aria-modal':'true','aria-label':kind==='land'?'地块档案':'家庭档案'},[h('header',{},[h('h3',{},kind==='land'?'地块档案':'家庭档案'),h('button',{onClick:()=>emit('close')},'关闭')]),kind==='household'?h('div',{},[h('p',{},`户号：${p?.householdNo||'未登记'} · 共 ${people.length} 人`),h('table',{},[h('thead',{},[h('tr',{},['姓名','性别','与户主关系','身份证号'].map(t=>h('th',{},t)))]),h('tbody',{},people.map(r=>h('tr',{key:r.id},[r.name,r.gender,r.relationToHead,statisticsIdentityLabel(r.idCard||r.id_card)].map(v=>h('td',{},v||'—')))))])]):h('dl',{},Object.entries({地块名称:p?.parcelName||p?.parcel_name,地块编号:p?.parcelCode||p?.parcel_code,面积:`${Number(p?.areaSquareMeterX100||0)/100} 亩`,承包截止:p?.contractEnd||p?.contract_end}).flatMap(([k,v])=>[h('dt',{},k),h('dd',{},v||'未登记')])),kind==='household'?h('p',{},`关联地块：${land?.length||0} 块 · 关联档案：${p?.documents?.length||0} 份`):null,h('p',{},'如需修改，请进入对应业务页面。')])]);};}};}
export const HouseholdStatisticsDetail=detail('household'),LandStatisticsDetail=detail('land');
let screenOpener;
export function setStatisticsScreenOpener(opener){screenOpener=opener;}
export async function openStatisticsScreen(profile){if(!screenOpener)return;try{await screenOpener(profile);}catch(error){statisticsToast.error(error.message||'打开数据大屏失败');}}
export function clearStatisticsSession(){sessionEpoch++;currentRaw={};}

// Use actual group identities, including an explicit unassigned bucket.
export function statisticsGraphGroups(profile={},people=[]) {
 const groups=new Map((profile.villageGroups||[]).filter(g=>g.name).map(g=>[String(g.name),{id:String(g.id||g.name),name:String(g.name)}]));
 for(const g of profile.groupList||[])if(g.name&&!groups.has(String(g.name)))groups.set(String(g.name),{id:String(g.id||g.name),name:String(g.name)});
 for(const person of people){if(person.registryStatus==='已注销')continue;const name=String(person.villageGroupName||person.village_group_name||person.villageGroup||person.village_group||'').trim();const id=String(person.villageGroupId||person.village_group_id||'');if(name){if(!groups.has(name))groups.set(name,{id:id||name,name});}else if(![...groups.values()].some(g=>g.id===id)&&!groups.has('未分组'))groups.set('未分组',{id:'unassigned',name:'未分组'});}
 return [...groups.values()];
}
