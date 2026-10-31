#!/usr/bin/env node
'use strict';
// Targeted, reproducible UI migration. Never run the reference main process.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),asar=require(path.join(root,'app/node_modules/@electron/asar'));
const manifest=require('./map-statistics-reference-map.json');
const archive=process.argv[2];if(!archive)throw Error('请提供已核对的村务通 v2.9.7 app.asar');
const source=asar.extractFile(archive,`cwt-Fe/dist/assets/${manifest.bundle}`).toString();
if(crypto.createHash('sha256').update(source).digest('hex')!==manifest.sha256)throw Error('参考包哈希变化，请重新核对模块范围');
const vendor=path.join(root,'app/src/renderer/foundation/vendor');
const aliases=Object.entries(manifest.bindings).filter(([key])=>!manifest.localBindings.includes(key));
const runtimePath=path.join(vendor,'assets/foundation-runtime.mjs');
let runtime=fs.readFileSync(runtimePath,'utf8').replace(/\nexport const reference297StatisticsBindings = [^\n]*;\n/g,'');
runtime+=`\nexport const reference297StatisticsBindings = { ${[...new Set(aliases.map(([,n])=>n))].join(', ')} };\n`;
// Existing runtime changes are preserved; this adds only reviewed library exports.
fs.writeFileSync(runtimePath,runtime);
const bridge=['loadStatistics','aggregateStatistics','openStatisticsScreen','statisticsPeopleStore','HouseholdStatisticsDetail','LandStatisticsDetail','statisticsToast','saveStatisticsSettings','categoryDefaults','statisticsIdentityLabel','statisticsGraphGroups'];
let code=`// Generated from pinned v2.9.7 statistics UI. No reference authentication, requests or bootstrap.\nimport {reference297StatisticsBindings as bindings} from './assets/foundation-runtime.mjs';\nimport {${bridge.join(',')}} from '../map-statistics-api.mjs';\nconst {${aliases.map(([key,n])=>`${n}:${key}`).join(',')}}=bindings;\nconst q9e=loadStatistics,dk=aggregateStatistics,qb=openStatisticsScreen,Gu=statisticsPeopleStore,N0=HouseholdStatisticsDetail,P0=LandStatisticsDetail,Ht=statisticsToast,Jb=saveStatisticsSettings,yd=categoryDefaults;\nconst tn=new Proxy({},{get:(_t,k)=>window.XLSX.utils[k]}),Yo=(...args)=>window.XLSX.writeFile(...args);\n`;
function once(text,from,to){if(text.split(from).length!==2)throw Error('迁入适配锚点变化: '+from);return text.replace(from,to);}
for(const item of manifest.nodes){let text=source.slice(item.start,item.end);if(item.name==='dk')text=once(text,'function dk(', 'function referenceAggregate(');
if(item.name==='tZe'){
 text=text.replace('label:"村民一户一档"','label:"居民档案"').replace('在浏览器中全屏打开数据大屏（适合汇报与开会展示）','全屏展示本机数据大屏（适合汇报与开会展示）');
 // Never turn partial/denied datasets into apparently valid zero charts.
 for(const [component,domain]of [['MWe','personnel'],['KKe','party'],['zqe','visit'],['LYe','work'],['lJe','finance'],['DQe','land']])text=once(text,`C(${component},{profile:a.value},null,8,["profile"])`,`C(StatisticsDomainGate,{profile:a.value,domain:"${domain}"},{default:()=>[C(${component},{profile:a.value},null,8,["profile"])]})`);
 text=text.replace('hasBusinessData:!0,loadErrors:[]','hasBusinessData:!0,loadErrors:n.value._loadErrors||[]');
}
if(item.name==='DWe'){
 const begin=text.indexOf('Oe=z(()=>'),end=text.indexOf('),xt=z(',begin)+1;if(begin<0||end<=begin)throw Error('人口图谱分组锚点变化');
 text=text.slice(0,begin)+'Oe=z(()=>statisticsGraphGroups(t.profile,$t.value||[]))'+text.slice(end);
 text=once(text,'const Ga=((ca=Oe.value[0])==null?void 0:ca.name)||"一组";','const Ga="未分组";');
 text=text.replace('||"一组",ia=rt.filter','||"未分组",ia=rt.filter');
}
if(item.name==='G9e')text=once(text,'return{id:he.id||"",type:', 'return{attachment_note:String(he.attachmentNote||he.attachment_note||""),remarks:String(he.remarks||""),id:he.id||"",type:');
if(item.name==='sJe'){
 for(const field of ['auditScore','voucherRate','handlerRate','attachmentRate'])text=text.replaceAll(`i.value.${field}||100`,`i.value.${field}??100`);
 text=text.replace('本全景画像严格依据农业农村部','统计结果来自本系统已登记的收支记录。请结合').replace('《农村集体经济组织财务制度》','原始凭证').replace('规范进行资产穿透与核算，所有账目均支持凭证追溯。','核对金额、经办人与附件。');
 text=text.replace('审计评价：村级财务凭证与经办人登记齐全，符合农村集体经济组织合规要求。','登记情况：请在财务收支页面核对凭证编号、经办人与原始附件。');
}
if(['DWe','EBe'].includes(item.name))text=text.replace(/I\(([A-Za-z]+)\.idCard\|\|\1\.id_card\|\|"-"\)/g,'I(statisticsIdentityLabel($1.idCard||$1.id_card||"-"))');
// The reference populated sample households when no real data existed. Remove it.
if(item.name==='W9e')text=once(text,'Me.length===0&&Me.push("第1村民小组","第2村民小组","第3村民小组");','');
if(item.name==='DWe')text=text.replace(/rt\.slice\(0,8\)/g,'[]').replace(/rt\.slice\(0,6\)/g,'[]');
code+=(item.type==='VariableDeclarator'?`${item.kind} `:'')+text+';\n';}
code+=`\nexport {aZe as ReferenceStatisticsView,referenceAggregate,j9e as availableStatisticYears};\n`;
code=code.replace("import {loadStatistics", "import {StatisticsDomainGate,loadStatistics");
fs.writeFileSync(path.join(vendor,'statistics-297.mjs'),code);
const ids=[...new Set([...code.matchAll(/data-v-[a-f0-9]+/g)].map(m=>m[0]))],cssBytes=asar.extractFile(archive,`cwt-Fe/dist/assets/${manifest.css}`);
function filterCss(s){let out='',pos=0;while(pos<s.length){const open=s.indexOf('{',pos);if(open<0)break;const head=s.slice(pos,open);let depth=1,end=open+1,quote='';for(;end<s.length&&depth;end++){const c=s[end];if(quote){if(c==='\\')end++;else if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='{')depth++;else if(c==='}')depth--;}const body=s.slice(open+1,end-1);if(/^\s*@(media|supports|layer)/.test(head)){const child=filterCss(body);if(child)out+=head+'{'+child+'}';}else if(ids.some(id=>head.includes(id)))out+=head+'{'+body+'}';pos=end;}return out;}
fs.writeFileSync(path.join(vendor,'statistics-297.css'),'/* Generated scoped v2.9.7 statistics styles. */\n'+filterCss(cssBytes.toString())+'\n');
const assets=[];for(const file of ['leaflet.js','leaflet.css','images/marker-icon-2x.png','images/marker-icon.png','images/marker-shadow.png']){const bytes=asar.extractFile(archive,'cwt-Fe/dist/libs/leaflet/'+file),dest=path.join(vendor,'leaflet',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);assets.push({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
fs.writeFileSync(path.join(vendor,'statistics-297-provenance.json'),JSON.stringify({version:manifest.version,bundle:manifest.bundle,sourceSha256:manifest.sha256,cssSha256:crypto.createHash('sha256').update(cssBytes).digest('hex'),nodes:manifest.nodes.length,scopes:ids,assets},null,2)+'\n');
console.log(JSON.stringify({version:manifest.version,nodes:manifest.nodes.length,bytes:code.length,scopes:ids.length,localMapAssets:assets.length}));
