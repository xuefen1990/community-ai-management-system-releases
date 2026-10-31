import {router,createElementVNode as h,createVNode as component,ref,onMounted,onBeforeUnmount} from './vendor/assets/foundation-runtime.mjs';
import {ReferenceStatisticsView} from './vendor/statistics-297.mjs';
import {loadStatistics,requestBusiness,setStatisticsScreenOpener,clearStatisticsSession,statisticsIdentity} from './map-statistics-api.mjs';
import {createVillageMap} from './map-settings-panel.mjs';
import {loadScript} from './extensions.mjs';
let pendingProfile=null;
function style(file){const href=new URL(file,import.meta.url).href;if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>l.href===href)){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);}}
export async function loadStatisticsAssets(){style('vendor/statistics-297.css');style('map-statistics.css');await Promise.all([loadScript('foundation/vendor/echarts.min.js'),loadScript('js/core/xlsx.full.min.js')]);window.ensureEchartsReady=()=>Promise.resolve(window.echarts);}
const DataScreen={props:['profile'],emits:['close'],setup(props,{emit}){
 const canvas=ref(null),root=ref(null),mapError=ref('');let handle,disposed=false;
 onMounted(async()=>{document.body.classList.add('community-data-screen-active');try{const result=await requestBusiness({path:'/api/v3/system-settings'});const settings=Object.fromEntries(result.items.map(r=>[r.key,r.value]));const map=await createVillageMap(canvas.value,settings,{readOnly:true,onTileError:message=>{if(!disposed)mapError.value=message;}});if(disposed){map.destroy();return;}handle=map;if(!map.service.hasApiKey)mapError.value='尚未配置地图服务密钥，可在系统设置 → 地图与村界中配置。';}catch(error){if(!disposed)mapError.value=error.message;}});
 onBeforeUnmount(()=>{disposed=true;handle?.destroy();document.body.classList.remove('community-data-screen-active');});
 const allowed=domain=>props.profile?._domainStatus?.[domain]==='ready';
 const value=(domain,key,unit='')=>allowed(domain)?`${Number(props.profile[key]||0).toLocaleString('zh-CN')}${unit}`:props.profile?._domainStatus?.[domain]==='forbidden'?'无权限':'未加载';
 const card=(title,content)=>h('section',{class:'community-screen-card'},[h('h3',{},title),content]);
 return()=>h('div',{class:'community-data-screen',ref:root,role:'dialog','aria-modal':'true','aria-label':'村情数据大屏','data-testid':'statistics-big-screen'},[
 h('header',{},[h('div',{},[h('h1',{},`${props.profile?.settings?.find(r=>r.key==='village_name')?.value||'村居'} · 村情数据大屏`),h('p',{},`统计年度：${props.profile?.selectedYear&&props.profile.selectedYear!=='all'?props.profile.selectedYear:'全部历史'} · 本机工作区`)]),h('div',{},[h('button',{onClick:()=>root.value.requestFullscreen?.().catch(()=>{})},'全屏展示'),h('button',{onClick:async()=>{if(document.fullscreenElement)await document.exitFullscreen();emit('close');}},'返回')])]),
 h('div',{class:'community-screen-kpis'},[['在籍及登记人口',value('personnel','total',' 人')],['常住家庭',value('personnel','householdCount',' 户')],['党员',value('party','partyCount',' 人')],['土地地块',value('land','landCount',' 块')],['待办民情',value('visit','visitPendingCount',' 件')]].map(([title,v])=>h('div',{},[h('span',{},title),h('strong',{},v)]))),
 h('div',{class:'community-screen-grid'},[
 h('aside',{},[card('各居民小组分布',allowed('personnel')?h('ul',{},(props.profile.groupList||[]).map(g=>h('li',{key:g.id||g.name},[h('span',{},g.name),h('strong',{},`${g.count??g.population??0} 人 / ${g.households??0} 户`)]))):h('p',{},'此账号无法查看居民统计')),card('民情办理',h('p',{},`待处理：${value('visit','visitPendingCount')} · 已办结：${value('visit','visitDoneCount')}`))]),
 h('section',{class:'community-screen-map'},[h('div',{ref:canvas,class:'community-screen-map-canvas'}),mapError.value?h('p',{class:'community-screen-map-status',role:'status'},mapError.value):null]),
 h('aside',{},[card('人口年龄结构',allowed('personnel')?h('ul',{},Object.entries(props.profile.ageSeg||{}).map(([label,count])=>h('li',{},[h('span',{},label),h('strong',{},`${count} 人`)]))):h('p',{},'无权限或未加载')),card('财务收支',h('div',{},[h('p',{},`收入：${value('finance','incomeTotal',' 元')}`),h('p',{},`支出：${value('finance','expenseTotal',' 元')}`),h('p',{},`收支结余：${value('finance','balance',' 元')}`)])),card('值班排班',allowed('work')?h('p',{},`值班人员 ${props.profile.dutyData?.totalDutyPeople||0} 人 · 排班 ${props.profile.dutyData?.totalPlansCount||0} 项`):h('p',{},'无权限或未加载'))])])]);
}};
const StatisticsPage={name:'CommunityStatisticsPage',setup(){const ready=ref(false),error=ref(''),screen=ref(null);let disposed=false,removeRouteHook;
 async function open(){try{await loadStatisticsAssets();const identity=await statisticsIdentity();const profile=pendingProfile?._identity===identity?pendingProfile:await loadStatistics();pendingProfile=null;if(!disposed)screen.value=profile;}catch(cause){if(!disposed)error.value=cause.message;}}
 const routeChanged=()=>{if(router.currentRoute.value.query.screen==='1')void open();else screen.value=null;};
 onMounted(async()=>{removeRouteHook=router.afterEach(routeChanged);try{await loadStatisticsAssets();if(!disposed){ready.value=true;routeChanged();}}catch(cause){if(!disposed)error.value=cause.message;}});
 onBeforeUnmount(()=>{disposed=true;removeRouteHook?.();clearStatisticsSession();});
 const close=()=>{screen.value=null;void router.replace({path:'/statistics',query:{}});};
 return()=>h('div',{class:'community-statistics-reference','data-testid':'community-statistics-reference'},[error.value?h('p',{role:'alert'},error.value):null,ready.value?component(ReferenceStatisticsView):h('p',{role:'status'},'正在加载统计组件…'),screen.value?component(DataScreen,{profile:screen.value,onClose:close}):null]);
}};
export function installMapStatisticsReference(){style('map-statistics.css');setStatisticsScreenOpener(async profile=>{pendingProfile=profile||null;if(router.currentRoute.value.path==='/statistics'&&router.currentRoute.value.query.screen==='1'){await router.replace({path:'/statistics',query:{}});}await router.push({path:'/statistics',query:{screen:'1'}});});const existing=router.getRoutes().find(r=>r.name==='statistics');router.addRoute({name:'statistics',path:'/statistics',component:StatisticsPage,meta:{...existing?.meta,menuKey:'statistics',tabId:'tab-statistics',requiresAuth:true}});}
