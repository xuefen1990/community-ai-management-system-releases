'use strict';
// Deliberate changes to the two imported v2.8.6 modules. Keep layout/render
// functions intact; replace multi-request writes with atomic community IPC.
function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Reference adaptation anchor changed: ${label}`);
  return source.replace(before, after);
}
function setupFunction(source, name, next, replacement) {
  const start = source.indexOf(`async function ${name}(`), end = source.indexOf(next, start);
  if (start < 0 || end < 0) throw new Error(`Missing reference action ${name}`);
  return source.slice(0, start) + replacement + source.slice(end);
}
function adaptNode(name, source) {
  if (name === 't0t') source = once(source, 'n("add-category",{name:u}),l.value=""', 'n("add-category",{name:u})', 'retain task input on save failure');
  if (name === 'Hmt') source = once(source, 'n("add-person",V),u.value="",c.value="",f.value="",p.value=[]', 'n("add-person",V),p.value=[]', 'retain duty person input on save failure');
  if (name === 'JJe') source = once(source, 'name:T.name,id_card:T.idCard||T.id_card,', 'name:T.name,residentVersion:T.version,id_card:T.idCard||T.id_card,', 'selected activist resident revision');
  if (name === 'EJe') {
    source = setupFunction(source, '_e', 'function Ne()', `async function _e(){const members=(a.members||[]).filter(member=>m.value.includes(member.id||member.id_card)&&member.member_type==='流动党员');if(!members.length){s.notify({type:'warning',message:'请选择要删除的流动党员'});return;}if(!await s.confirm({title:'批量删除确认',message:'删除所选 '+members.length+' 名流动党员档案？',tone:'danger'}))return;try{await removePartyMembers(members);q();n('refresh');s.notify({type:'success',message:'已删除所选流动党员档案'});}catch(error){s.notify({type:'error',message:error.message||'删除失败，原记录已保留'});}}`);
    source = setupFunction(source, 'Fe', 'return(ve,ce)=>', `async function Fe(){f.value=false;const members=(a.members||[]).filter(member=>member.member_type==='流动党员');if(!members.length){s.notify({type:'info',message:'暂无流动党员档案可清空'});return;}if(!await s.confirm({title:'清空流动党员确认',message:'清空 '+members.length+' 名流动党员档案？本村党员及发展档案保留。',tone:'danger'}))return;try{await removePartyMembers(members);n('refresh');s.notify({type:'success',message:'已清空流动党员档案'});}catch(error){s.notify({type:'error',message:error.message||'清空失败，原记录已保留'});}}`);
    source = source.replaceAll('清空流动党员与无效记录', '清空流动党员').replaceAll('清空流动党员及无效记录', '清空流动党员');
  }
  if (name === 'aLe') source = source.replaceAll('/people?limit=100000', '/party/context/people?limit=100000').replaceAll('/village-groups?limit=100000', '/party/context/village-groups?limit=100000').replaceAll('/special-categories?limit=100000', '/party/context/special-categories?limit=100000');
  if (name === 'BB') {
    source = once(source, 'version:l.version,', 'version:l.version,annualVersion:l.annualVersion,', 'annual dues revision');
    source = once(source, 'l.status==="已缴"&&', 'l.status==="免缴"?(i.status="免缴"):l.status==="已缴"&&', 'dues exemption');
  }
  if (name === 'UB') {
    source = once(source, 'id:`party_auto_${r.id||i}`,', 'id:`party_auto_${r.id||i}`,residentVersion:r.version,', 'resident party revision');
    source = once(source, 'if(f&&!p||p&&', 'if(p&&', 'preserve unlinked historical members');
    source = once(source, 'if(!j&&!W)return}', '}', 'preserve explicit member records');
  }
  if (name === 'GQe') source = setupFunction(source, 'I', 'return(R,L)=>', `async function I(){l.value=true;try{
    const year=Number(a.year);let months=[];
    if(m.value==='免缴')months=p.value.filter(row=>!row.disabled).map(row=>({month:row.month,amountCents:0}));
    else {let rows=p.value.filter(row=>row.paid&&!row.disabled);if(!rows.length&&['全额已交','已交纳'].includes(m.value))rows=p.value.filter(row=>!row.disabled);months=rows.map(row=>({month:row.month,amountCents:Math.round(Number(row.amount||i.value||0)*100)}));}
    await savePartyDuesBatch({year,entries:[{member:a.member,previous:a.existingDues,months,status:m.value,paidAt:g.value||'',standardCents:Math.round(Number(i.value||0)*100)}]});
    s.notify({type:'success',message:'党费登记已保存'});n('refresh');n('close');
  }catch(error){s.notify({type:'error',message:error.message||'保存党费记录失败'});}finally{l.value=false;}}`);
  if (name === 'qet') source = setupFunction(source, 'Ne', 'function Fe()', `async function Ne(){if(!I.value.length){s.notify({type:'warning',message:'请至少勾选一个月份'});return;}H.value=true;try{
    const year=Number(r.value||l),entries=q.value.map(member=>{
      const previous=(a.dues||[]).find(row=>String(row.year)===String(year)&&(row.member_id===member.id||member.id_card&&row.id_card===member.id_card));
      const eligible=f_(member,year),selected=I.value.filter(month=>eligible.includes(month));
      const amount=Math.round(Number(E.value||member.dues_standard||10)*100);
      const months=(previous?.paid_months||[]).filter(month=>!selected.includes(month)).map(month=>({month,amountCents:Math.round(Number(previous.monthly_amounts?.[month]??previous.monthly_amount??0)*100)})).concat(selected.map(month=>({month,amountCents:F.value&&previous?.paid_months?.includes(month)?Math.round(Number(previous.monthly_amounts?.[month]??previous.monthly_amount??0)*100):amount})));
      return {member,previous,months,paidAt:V.value||'',status:'已缴'};
    });await savePartyDuesBatch({year,entries});s.notify({type:'success',message:'已完成批量党费登记'});D.value=false;n('refresh');
  }catch(error){s.notify({type:'error',message:error.message||'批量收缴失败'});}finally{H.value=false;}}`);
  if (name === 'qet') source = once(source, 'const Pe="\\uFEFF"+fe.map', 'const sheet=Za.aoa_to_sheet(fe),book=Za.book_new();sheet["!cols"]=fe[0].map((_,index)=>({wch:index===3?24:18}));Za.book_append_sheet(book,sheet,"党费收缴台账");Jo(book,`党费收缴台账_${ce}年度.xlsx`);s.notify({type:"success",message:"党费台账已导出 XLSX"});return;const Pe="\\uFEFF"+fe.map', 'dues XLSX export');
  if (name === 'Bvt') source = once(source, ',n("update:modelValue",!1)}function g()', '}function g()', 'retain bulk form on failure');
  if (name === 'j0t') {
    source = once(source, 'T0({limit:1e3}),nb()', 'referenceRequest("/duty/context/people?limit=100000"),referenceRequest("/duty/context/village-groups?limit=100000")', 'duty scoped resident context');
    source = once(source, 'setup(e){const t=qs()', 'setup(e){let dutyVersion=0,dutySaving=false;const t=qs()', 'schedule revision state');
    source = once(source, 'u.value=vt}', 'u.value=vt;dutyVersion=ze.value.revision}', 'schedule revision load');
    source = setupFunction(source, 'oe', 'async function te(', `async function oe({dateStr,task,selectedPersonNames}){try{await saveDutySchedule({baseVersion:dutyVersion,action:'replace-day',date:dateStr,task,names:selectedPersonNames});a.notify({type:'success',message:'排班已更新'});_.value=false;await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'te', 'async function X(', `async function te({person,task,dateStr}){const date=dateStr||l.value;if(dutySaving)return;dutySaving=true;try{const names=(V.value[date]||[]).filter(row=>row.theme===task).flatMap(row=>row.people.map(row=>row.name));const next=names.includes(person.name)?names.filter(name=>name!==person.name):[...names,person.name];await saveDutySchedule({baseVersion:dutyVersion,action:'replace-day',date,task,names:next});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}finally{dutySaving=false;}}`);
    source = setupFunction(source, 'X', 'async function be(', `async function X({duty,person}){if(dutySaving)return;dutySaving=true;try{const names=duty.people.filter(row=>row.name!==person.name).map(row=>row.name);await saveDutySchedule({baseVersion:dutyVersion,action:'replace-day',date:l.value,task:duty.theme,names});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}finally{dutySaving=false;}}`);
    source = setupFunction(source, 'be', 'async function me(', `async function be(duty){if(!await a.confirm({title:'清除排班确认',message:'清除 '+l.value+' 的【'+duty.theme+'】值班安排？'}))return;try{await saveDutySchedule({baseVersion:dutyVersion,action:'replace-day',date:l.value,task:duty.theme,names:[]});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = once(source, ']);if(Te.status', ']);const critical=[Te,ze,ut].find(result=>result.status==="rejected");if(critical)throw critical.reason;if(Te.status', 'show schedule load failure');
    source = once(source, 'await lr(We.id)', 'await lr(We.id,{baseVersion:We.version})', 'task delete revision');
    source = setupFunction(source, 'Pe', 'async function Ae(', `async function Pe(record){try{await S0(record.id,{baseVersion:record.version,changes:{status:'已办结'}});a.notify({type:'success',message:'已成功标记为办结'});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'Ae', 'function Ze(', `async function Ae(record){if(!await a.confirm({title:'删除确认',message:'确定删除此条民情记录？原记录会保留在修改日志中。',tone:'warning'}))return;try{await pO(record.id,{baseVersion:record.version});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'me', 'async function J(', `async function me(){const previous=new Date(l.value+'T12:00:00');previous.setDate(previous.getDate()-1);try{const result=await saveDutySchedule({baseVersion:dutyVersion,action:'copy',pairs:[{source:Ql(previous),target:l.value}]});a.notify({type:result.added?'success':'info',message:result.added?'已复制前一天排班':'前一天暂无可复制排班或已全部存在'});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'J', 'async function we(', `async function J(date){const day=new Date((date||l.value)+'T12:00:00');day.setDate(day.getDate()+(day.getDay()===0?-6:1-day.getDay()));const pairs=[];for(let offset=0;offset<7;offset++){const target=new Date(day),origin=new Date(day);target.setDate(day.getDate()+offset);origin.setDate(day.getDate()+offset-7);pairs.push({source:Ql(origin),target:Ql(target)});}if(!await a.confirm({title:'复制排班确认',message:'将上一周的排班复制到本周？已有相同任务和人员将保留，其他人员会追加。'}))return;try{const result=await saveDutySchedule({baseVersion:dutyVersion,action:'copy',pairs});a.notify({type:'success',message:'已复制上一周排班，共新增 '+result.added+' 人次'});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'we', 'async function K(', `async function we(){if(!await a.confirm({title:'复制排班确认',message:'将上月相同日号的排班复制到当前月份？相同任务和人员不会重复。'}))return;const pairs=[],count=new Date(n.value,s.value,0).getDate(),previousCount=new Date(n.value,s.value-1,0).getDate();for(let day=1;day<=Math.min(count,previousCount);day++)pairs.push({source:Ql(new Date(n.value,s.value-2,day)),target:Ql(new Date(n.value,s.value-1,day))});try{const result=await saveDutySchedule({baseVersion:dutyVersion,action:'copy',pairs});a.notify({type:'success',message:'已复制上月排班，共新增 '+result.added+' 人次'});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'K', 'async function ne(', `async function K({year,month}){if(!await a.confirm({title:'清空排班确认',message:'确定清空 '+year+'年'+month+'月所有任务的排班？其他月份和民情记录保留。',tone:'danger'}))return;try{const result=await saveDutySchedule({baseVersion:dutyVersion,action:'clear-month',year,month});a.notify({type:'success',message:'已清空当月排班，共 '+result.removed+' 人次'});await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    source = setupFunction(source, 'ie', 'async function ae(', `async function ie({task,tasks,year,month,rule,peopleNames}){try{const result=await saveDutySchedule({baseVersion:dutyVersion,action:'bulk',tasks:tasks?.length?tasks:[task],year,month,rule,names:peopleNames});a.notify({type:'success',message:'整月排班已保存，共新增 '+result.added+' 人次；已有相同排班保留'});g.value=false;await L({silent:true});}catch(error){a.notify({type:'error',message:error.message});}}`);
    // A task can have multiple yearly plans; never reuse an old year's plan.
    source = source.replaceAll('(Te.theme===et||Te.title===et)&&!Te.deletedAt', '(Te.theme===et||Te.title===et)&&Te.startDate<=Ve&&Te.endDate>=Ve&&!Te.deletedAt');
  }
  return source;
}
module.exports = { adaptNode };
