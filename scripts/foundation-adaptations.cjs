'use strict';

// Each change targets the exact reviewed 2.6.4 bundle. Fail closed if a later
// reference changes an anchor; never silently patch an unrelated component.
module.exports = function adaptFoundation(source) {
  function once(before, after) {
    if (source.split(before).length !== 2) throw new Error(`新版基础适配锚点不唯一：${before.slice(0, 90)}`);
    source = source.replace(before, after);
  }
  function block(start, end, replacement) {
    if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('证明操作适配锚点不唯一');
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    if (last < first) throw new Error('证明操作边界不正确');
    source = source.slice(0, first) + replacement + source.slice(last);
  }
  // Keep legacy imported birth dates readable in the v2.6.4 resident table.
  // The stored record is left unchanged; this only normalizes the view model.
  once('function l8e(e,t,a){let n=t||"男",s=a||null;const l=String(e||"").trim().toUpperCase();if(l.length===18){',
    'function l8e(e,t,a){let n=t||"男",s=a||null;const l=String(e||"").trim().toUpperCase(),r=String(s||"").trim().replaceAll(" ","").replace(/[./]/g,"-").replaceAll("年","-").replaceAll("月","-").replaceAll("日","").replace(/-+$/,""),o=r.match(/^([0-9]{4})(?:-([0-9]{1,2}))?(?:-([0-9]{1,2}))?$/),i=r.match(/^([0-9]{4})([0-9]{2})([0-9]{2})$/);o?s=`${o[1]}-${String(o[2]||"00").padStart(2,"0")}-${String(o[3]||"00").padStart(2,"0")}`:i&&(s=`${i[1]}-${i[2]}-${i[3]}`);if(l.length===18){');
  // Use the same normalizer for age filters and the v2.6.4 table/detail cells.
  // The foundation table otherwise prints legacy Chinese dates verbatim.
  once('function tS(e){const a=Va((e==null?void 0:e.birthDate)||(e==null?void 0:e.birth_date)).match(/^',
    'function tS(e){const a=Va(l8e("","",(e==null?void 0:e.birthDate)||(e==null?void 0:e.birth_date)).birthDate).match(/^');
  once('default:I(({row:k})=>[d("span",null,L(k.birthDate||"-"),1)])',
    'default:I(({row:k})=>[d("span",null,L(l8e("","",k.birthDate||k.birth_date).birthDate||"-"),1)])');
  once('default:I(()=>[X(L(g.value.birthDate||"-"),1)]),_:1}),S(Q,{label:"文化程度"',
    'default:I(()=>[X(L(l8e("","",g.value.birthDate||g.value.birth_date).birthDate||"-"),1)]),_:1}),S(Q,{label:"文化程度"');
  once('setup(e,{emit:t}){const a=e,n=t,s=[{key:"party",label:"党员信息"', 'setup(e,{emit:t}){let foundationEditor=null;const a=e,n=(event,payload)=>foundationEditor?foundationEditor.handle(event,payload):t(event,payload),s=[{key:"party",label:"党员信息"');
  // Existing residents keep their identity card locked until the user enters
  // the reviewed correction flow. The editor owns the confirmation state.
  once('const Ne=O(()=>a.person?"(唯一主键，禁止修改)":E.value?E.value:"(登记后不可修改)"),Ie=O(()=>a.person?"is-disabled-primary":E.value.includes("✅")?"is-valid":E.value.includes("❌")?"is-invalid":"is-normal")',
    'const Ne=O(()=>a.person?(foundationEditor?.identityEditing.value?E.value||"正在更正，请输入新身份证号":"更正身份证号"):E.value?E.value:"(登记后可按流程更正)"),Ie=O(()=>a.person&&!foundationEditor?.identityEditing.value?"is-disabled-primary":E.value.includes("✅")?"is-valid":E.value.includes("❌")?"is-invalid":"is-normal")');
  once('placeholder:"请输入18位身份证号",disabled:!!e.person,clearable:"","input-props":{id:"p_id_card",maxlength:18,disabled:!!e.person},class:ne({"is-error":_.field==="idCard"})',
    'placeholder:"请输入18位身份证号",disabled:!!e.person&&!foundationEditor?.identityEditing.value,clearable:"","input-props":{id:"p_id_card",maxlength:18,disabled:!!e.person&&!foundationEditor?.identityEditing.value},class:ne({"is-error":_.field==="idCard"})');
  once('d("span",{id:"idCardHint",class:ne(`id-card-hint-badge ${Ie.value}`)},L(Ne.value),3)',
    'd("button",{id:"idCardHint",type:"button","data-resident-correct-identity":"true",class:ne(`id-card-hint-badge ${Ie.value}`),onClick:()=>foundationEditor?.beginIdentityCorrection()},L(Ne.value),3)');
  // Derived IDs keep old imported residents editable, but the technical key
  // is not useful to the clerk. Show a plain status label in the dialog.
  once('X(" ID: "+L(e.person.id),1)',
    'X(String(e.person.id||"").startsWith("foundation:person:")?" 档案编号：已建立":" ID: "+L(e.person.id),1)');
  // Add a newborn/household-member flow inside the existing household ledger.
  // The extension owns the form and authenticated save; the reference dialog
  // continues to own member selection, refresh and household presentation.
  once('__name:"Household360Dialog",props:{profile:{type:Object,required:!0},groupNames:{type:Object,default:()=>new Map},villageGroups:{type:Array,default:()=>[]},sensitiveVisible:{type:Boolean,default:!1},allowLocateLand:{type:Boolean,default:!0}},emits:["close","edit-person","open-document","manage-group","switch-household","locate-land","locate-visit","issue-certificate","refresh"],setup(e,{emit:t}){const a=e,n=t,s=B(!1),l=fa()',
    '__name:"Household360Dialog",props:{profile:{type:Object,required:!0},groupNames:{type:Object,default:()=>new Map},villageGroups:{type:Array,default:()=>[]},sensitiveVisible:{type:Boolean,default:!1},allowLocateLand:{type:Boolean,default:!0}},emits:["close","edit-person","open-document","manage-group","switch-household","locate-land","locate-visit","issue-certificate","refresh"],setup(e,{emit:t}){let foundationHouseholdMember=null;const a=e,n=t,s=B(!1),l=fa()');
  once('const H=B(!1),W=B(""),j=O(()=>{',
    'foundationHouseholdMember=window.communityCreateHouseholdMemberRegistration?.({getProfile:()=>a.profile,selected:g,emit:n,dialogs:l});ka(()=>foundationHouseholdMember?.dispose());const H=B(!1),W=B(""),j=O(()=>{');
  once('d("aside",RFe,[d("div",OFe,[(x(!0)',
    'd("aside",RFe,[d("div",{class:"household-member-list-header"},[d("strong",null,"家庭成员"),d("button",{type:"button",class:"household-member-add-button","data-testid":"add-household-member",onClick:()=>foundationHouseholdMember?.open()},"＋ 添加家庭成员")]),d("div",OFe,[(x(!0)');
  once(']),d("div",KFe,[d("div",GFe,',
    ']),d("div",{id:"foundation-household-member-root",class:"foundation-household-member-root","data-testid":"household-member-registration-root"}),d("div",KFe,[d("div",GFe,');
  once('X(" 编辑人员 ",-1)', 'X(" 编辑当前成员 ",-1)');
  once('X(" 关联分户 ",-1)', 'X(" 关联其他户号 ",-1)');
  once('d("strong",null,"暂无关联分户")', 'd("strong",null,"暂无关联其他户号")');
  once('X(" 👨‍👩‍👧‍👦 关联分户：",-1)', 'X(" 👨‍👩‍👧‍👦 关联户号：",-1)');
  once('b.specialCustomInfo=Se,n("save",she(b,a.person))}return(he,ae)=>', 'b.specialCustomInfo=Se,n("save",she(b,a.person))}foundationEditor=window.communityCreateResidentEditor?.({person:a.person,form:b,active:k,scroll:C,navigate:Xe,emit:t});return(he,ae)=>');
  once('teleported:!1,class:"person-form-el-dialog"', 'teleported:!1,"before-close":()=>n("close"),class:"person-form-el-dialog"');
  once('loading:e.saving,disabled:e.saving,onClick:Ze', 'loading:e.saving||foundationEditor?.saving.value,disabled:e.saving||foundationEditor?.saving.value,onClick:Ze');
  once('...ze.value.map(he=>"subform_"+he.key)]);function ut', '...ze.value.map(he=>"subform_"+he.key),...(a.person?["sec_accounts","sec_custom","sec_payments","sec_operations","sec_sources"]:[])]);function ut');
  once('"data-testid":"person-form-scroll-region",onScroll:st},[d("div",Mhe', '"data-testid":"person-form-scroll-region",onScroll:st},[d("div",{id:"foundation-resident-extra-root",class:"resident-editor-extras"}),d("div",Mhe');
  // Multiple mounting consumers share one initial resident load. A forced
  // refresh after a save still runs after an in-flight read has settled.
  once('async function Q({force:V=!1,silent:J=!1}={}){var ie;if(!(c.value&&!V))',
    'let foundationPersonnelLoad=null;function Q(options={}){if(foundationPersonnelLoad)return options.force?foundationPersonnelLoad.catch(()=>{}).then(()=>Q(options)):foundationPersonnelLoad;const pending=foundationLoadPersonnel(options);foundationPersonnelLoad=pending;pending.finally(()=>{if(foundationPersonnelLoad===pending)foundationPersonnelLoad=null}).catch(()=>{});return pending}async function foundationLoadPersonnel({force:V=!1,silent:J=!1}={}){var ie;if(!(c.value&&!V))');
  // Relative <base> supports the existing extension assets. On file://, hash
  // navigation must retain the foundation entry rather than resolving against
  // that base and accidentally reloading the old renderer.
  once('m=p>-1?(a.host&&document.querySelector("base")?e:e.slice(p))+i:v0e()+e+i',
    'm=p>-1?(a.pathname+a.search+e.slice(p))+i:v0e()+e+i');
  if (source.split('window.api.readExcelColumns').length !== 7) throw new Error('Excel 读取入口数量已变化');
  source = source.replaceAll('window.api.readExcelColumns', 'window.api.readFoundationExcelColumns');
  once('return`http://${N}:${T}/mobile_upload.html?ownerType=${encodeURIComponent(a.ownerType)}&ownerKey=${encodeURIComponent(a.ownerKey)}`',
    'return`http://${N}:${T}/mobile_upload.html?token=${encodeURIComponent(window.communityMobileUploadToken||"")}&ownerType=${encodeURIComponent(a.ownerType)}&ownerKey=${encodeURIComponent(a.ownerKey)}`');
  once('if(M!=null&&M.running)return T=M.port||9898,', 'if(M!=null&&M.running)return window.communityMobileUploadToken=M.token||"",T=M.port||9898,');
  once('let Ae=null,De=Date.now();async function Fe(){', 'let Ae=null,De=Date.now(),foundationUploadUnsubscribe=null;async function Fe(){');
  once('?window.api.onMobileFileUploaded($e):(De=Date.now(),Ae=setInterval(Fe,2e3))',
    '?(foundationUploadUnsubscribe=window.api.onMobileFileUploaded($e)):(De=Date.now(),Ae=setInterval(Fe,2e3))');
  once('ka(()=>{o=!1,Ae&&(clearInterval(Ae),Ae=null)})',
    'ka(()=>{o=!1,Ae&&(clearInterval(Ae),Ae=null),foundationUploadUnsubscribe?.()})');
  // An import rollback must point to the state before its first write.
  once('async function q0e(e){const t={domain:"personnel",', 'async function q0e(e){const t={id:e.id,domain:"personnel",');
  once('try{const{validRows:ie,householdGroupCandidates:me,distinctRelations:xe,summary:Me}=o8e(',
    'try{const foundationImportId=`import-job-${crypto.randomUUID()}`;await window.api.createV3ImportSnapshot({id:foundationImportId,domain:"personnel"});const{validRows:ie,householdGroupCandidates:me,distinctRelations:xe,summary:Me}=o8e(');
  block('const Ae=await q0e({fileName:p.value,mode:l.value===', 'Object.assign(Q,Me)}catch(ie){s().notify',
    'try{await q0e({id:foundationImportId,domain:"personnel",fileName:p.value,mode:l.value==="supplement"?"supplement":"batch",totalRows:Me.totalRows,insertedRows:Me.insertedRows,updatedRows:Me.updatedRows,failedRows:Me.failedRows});}catch(error){s().notify({type:"warning",message:"人员已写入，但导入历史登记失败。导入前完整备份已保留，可在设置中恢复。"});}');
  once('catch(V){console.warn("创建导入快照失败:",V)}', 'catch(V){throw new Error("导入前备份失败，已停止导入："+(V.message||V))}');
  once('await window.api.createV3ImportSnapshot(se)', 'await window.api.createV3ImportSnapshot({id:se,domain:"land"})');
  once('catch(V){console.warn("记录导入历史日志失败:",V)}',
    'catch(V){s.notify({type:"warning",message:"地块已写入，但导入历史登记失败。导入前完整备份已保留，可在设置中恢复。"})}');
  once('a("restored"),a("close")}catch(h){', 'a("restored"),a("close"),location.reload()}catch(h){');
  once('a("rollback",c),a("close")}catch(p){', 'a("rollback",c),a("close"),location.reload()}catch(p){');
  if (source.split('/api/v3/documents/file?').length !== 7) throw new Error('档案预览入口数量已变化');
  source = source.replaceAll('${window.location.origin}/api/v3/documents/file?', 'community-file://document/?')
    .replaceAll('/api/v3/documents/file?', 'community-file://document/?');
  block('async function Y(){var te,Z,se;try{const[de,pe,ee,K]=await Promise.all([n9()', 'async function U(te){var de;const Z=a.value.find(pe=>pe.id===te);',
    'async function Y(){try{const[de,pe,ee,K]=await Promise.all([n9(),Xk(),x1({limit:1e4}),Sw()]);a.value=(de.items||[]).map(me=>({...me,redSeal:me.sealEnabled!==!1,builtin:me.isSystem===!0}));s.value=pe.people||[];l.value=ee.items||[];y.value=K.items||[];if(!a.value.some(me=>me.id===n.value))n.value=a.value[0]?.id||"";}catch(error){t.notify({type:"error",message:error.message||"读取证明资料失败"});}}');
  block('async function U(te){var de;const Z=a.value.find(pe=>pe.id===te);', 'function z(){p.value=null,f.value=!0}function Q(te){',
    'async function U(te){const Z=a.value.find(pe=>pe.id===te);if(!Z||!await t.confirm(`确定删除证明模板【${Z.name}】？`,"删除模板"))return;try{await l9(te,{baseVersion:Z.version});await Y();b();t.notify({type:"success",message:"模板已删除"});}catch(error){t.notify({type:"error",message:error.message||"删除模板失败"});}}');
  block('async function le(te){var Z,se;if(te.id){try{await Nut(te.id,{changes:te})}', 'async function ue(){await t.confirm("确定要将所有证明模板恢复至出厂默认状态吗？',
    'async function le(te){try{const current=a.value.find(item=>item.id===te.id);const payload={...te,sealEnabled:te.redSeal};const result=current?await Nut(current.id,{baseVersion:current.version,changes:payload}):await s9(payload);await Y();n.value=result.template.id;b();f.value=!1;t.notify({type:"success",message:"证明模板已保存"});}catch(error){t.notify({type:"error",message:error.message||"保存模板失败"});}}');
  block('async function ue(){await t.confirm("确定要将所有证明模板恢复至出厂默认状态吗？', 'async function q(){var te;try{const Z=await Sw();',
    'async function ue(){if(!await t.confirm("恢复六套默认模板并移除当前自定义模板？系统保留原模板恢复记录。","恢复默认模板"))return;try{await Vt({method:"POST",path:"/certificate-templates/restore-defaults",body:{}});await Y();b();t.notify({type:"success",message:"默认模板已恢复"});}catch(error){t.notify({type:"error",message:error.message||"恢复模板失败"});}}');
  block('async function ce(te){const Z=te.id||te.recordNo;try{await o9(Z,{changes:{status:"已作废"}})}', 'return zt(()=>{Y()}),(te,Z)=>(x(),P("div",pft,',
    'async function ce(te){try{const result=await o9(te.id,{baseVersion:te.version,changes:{status:"已作废"}});Object.assign(te,result.record);t.notify({type:"success",message:"证明记录已作废"});}catch(error){t.notify({type:"error",message:error.message||"作废失败"});}}async function oe(te){if(!await t.confirm("确定删除这条开具记录？系统将保留恢复记录。","删除开具记录"))return;try{await Vt({method:"DELETE",path:`/certificate-records/${encodeURIComponent(te.id)}`,body:{baseVersion:te.version}});y.value=y.value.filter(item=>item.id!==te.id);t.notify({type:"success",message:"开具记录已删除"});}catch(error){t.notify({type:"error",message:error.message||"删除失败"});}}');
  once('try{const V=await r9(G);V!=null&&V.data||V!=null&&V.id?y.value.unshift(V.data||V):y.value.unshift({id:`rec_${Date.now()}`,...G})}catch{y.value.unshift({id:`rec_${Date.now()}`,...G})}',
    'try{const V=await r9(G);if(!V.record)throw new Error("证明记录未保存");y.value.unshift(V.record);return!0;}catch(error){t.notify({type:"error",message:error.message||"证明记录保存失败"});return!1;}');
  once('await H("正规打印"),window.print()', 'if(!await H("正规打印"))return;window.print()');
  once('G.href=F,G.download=pe,document.body.appendChild(G)', 'if(!await H("导出 Word")){URL.revokeObjectURL(F);return;}G.href=F,G.download=pe,document.body.appendChild(G)');
  once('URL.revokeObjectURL(F),await H("导出 Word"),t.notify', 'URL.revokeObjectURL(F),t.notify');
  once('function m0t(e){return c0t[e]||"/overview"}',
    'function m0t(e){return globalThis.communityFoundationRoutes?.[e]||c0t[e]||"/overview"}');
  once('function f0t(e){return b9[e]||"/overview"}',
    'function f0t(e){return globalThis.communityFoundationRoutes?.[e]||b9[e]||"/overview"}');
  once('X(" 彻底删除 ",-1)', 'X(" 移除档案 ",-1)');
  once('title:"彻底永久删除警告",message:`⚠️ 警告：您即将永久删除电子档案【${Ne.file_name}】！\n\n此操作不可撤销，且无法再次还原。是否确认彻底删除？`,confirmText:"彻底删除"',
    'title:"移除档案记录",message:`将【${Ne.file_name}】从废纸篓移除？系统保留恢复记录及文件副本，原文件与其他业务引用不受影响。`,confirmText:"移除记录"');
  once('message:`文件【${Ne.file_name}】已从系统中彻底删除！`', 'message:`档案【${Ne.file_name}】已移除，恢复记录已保留。`');
  once('message:`⚠️ 高危操作：确定要清空废纸篓中的全部 ${Ne} 件档案吗？\n\n清空后将无法找回！`',
    'message:`将废纸篓中的 ${Ne} 件档案记录全部移除？系统保留恢复记录及文件副本，原文件与其他业务引用不受影响。`');
  once('"(本地脱机加密)"', '"(社区工作区)"');
  once('{key:"lan",label:"局域网共享",icon:"🌐",allowLan:!1}', '{key:"lan",label:"单位服务",icon:"🌐",allowLan:!1}');
  once('S(u(Pt),{label:"操作",width:"128","min-width":"128",align:"right","header-align":"right",fixed:"right"}',
    'S(u(Pt),{label:"操作",width:"176","min-width":"176",align:"right","header-align":"right",fixed:"right"}');
  once('d("div",Rze,[S(u(be),{link:"",type:"primary",size:"small","data-testid":`view-person-${k.id}`',
    'd("div",Rze,[S(u(be),{link:"",type:"primary",size:"small","data-testid":`accounts-person-${k.id}`,onClick:()=>window.communityFoundationOpenResident?.(k.id)},{default:I(()=>[X("账户")]),_:1}),S(u(be),{link:"",type:"primary",size:"small","data-testid":`view-person-${k.id}`');
  // The donor's offline-only/encrypted-storage promises do not describe our
  // app. Keep an informational dialog but no donor consent or automatic popup.
  once('function o(){typeof globalThis<"u"&&globalThis.localStorage&&(globalThis.localStorage.getItem(B8)||(s.value=!0))}', 'function o(){}');
  const replacements = [
    ['🛡️ 数据安全承诺 · 使用须知', '数据存储与服务说明'],
    [' 🛡️ 村务通管理系统 · 数据安全承诺书 ', ' 社区AI管理系统 · 数据存储与服务说明 '],
    [' 生效日期：软件首次启动时 ｜ 适用范围：全系统离线档案与业务数据 ', ' 适用范围：社区档案、业务记录与扩展功能 '],
    ['"纯本地运行，零数据上传"', '"本机与单位工作区"'],
    ['您录入的村民档案、土地台账、走访记录等所有业务数据，100% 存储在您本机电脑，软件不会向任何服务器上传、同步或备份您的业务数据。', '本机档案保存在本机数据目录；使用单位共享工作区时，相关业务数据由配置的单位服务保存和同步。'],
    ['"本地加密存储"', '"数据目录与系统账户"'],
    ['数据库文件已在本地进行加密保护，第三方软件无法直接读取原始内容。', '本机业务数据库采用 JSON 文件保存。请通过 macOS 账户权限管理数据目录的访问，并妥善保存备份。'],
    ['联网仅用于授权验证', '账号、AI 与更新服务'],
    ['软件联网的唯一目的是向授权服务器验证您的手机号与订阅有效期，不涉及任何村务业务数据的传输。', '账号与单位功能会连接配置的服务。使用在线 AI 时，请求内容会发送给所选 AI 服务；应用更新通过配置的更新后端获取。'],
    ['使用方数据安全责任声明', '日常数据管理'],
    ['由于所有数据均存储于您的本地设备，若因', '请关注'],
    ['等使用方原因造成的数据丢失或泄露，与本软件及开发者无关，相关责任由使用方自行承担。', '等可能影响数据完整性与保密性的情况，定期核对账户权限和备份。'],
    ['请在系统设置中使用“手动备份到桌面”功能，或定期将数据文件夹复制至 U 盘，以保障数据安全。', '请通过社区系统的备份功能保存数据，并核对备份时间和可恢复内容。'],
    [' ✅ 我已阅读并同意 ', ' 我知道了 '],
    ['✅ 已同意数据安全承诺，感谢您的信任！', '已阅读数据存储与服务说明'],
    ['点击【我已阅读并同意】即表示您接受上述条款，后续可在 设置 → 账号授权 中随时查阅。 ', '可在设置中再次查看数据存储与服务说明。 '],
    ['<strong>纯本地运行，零数据上传：</strong>业务数据 100% 存储在您本机电脑，不会上传到任何第三方服务器。', '<strong>本机与单位工作区：</strong>本机档案保存在数据目录，单位共享数据由配置的单位服务保存和同步。'],
    ['<strong>本地加密存储：</strong>核心数据在本地进行加密保护，防止非授权直接提取。', '<strong>数据目录：</strong>本机业务数据库采用 JSON 文件保存，请妥善管理访问权限。'],
    ['<strong>授权验证仅核验账号：</strong>软件联网仅核验手机号与有效期，不涉及任何业务数据。', '<strong>联网服务：</strong>账号、共享工作区、在线 AI 与应用更新按配置使用相应服务。'],
  ];
  for (const [before, after] of replacements) once(before, after);
  // These two brand changes belong to the actual bundled workspace shell.
  // Updating only account-gate.mjs leaves the imported sidebar untouched.
  if (!source.includes('村民一户一档')) throw new Error('居民一户一档品牌锚点已变化，请重新核对新版基础');
  source = source.replaceAll('村民一户一档', '居民一户一档');
  once('村民“一户一档”档案库', '居民“一户一档”档案库');
  once('qh=""+new URL("logo-I1jcNb58.png",import.meta.url).href', 'qh=new URL("../community-logo.png",import.meta.url).href');
  // Extension routes can retain the same menu identity while their tab id
  // differs from the upstream shell's tab. Match the stable menu key too.
  once('active:u(l).meta.tabId===b.tab', 'active:u(l).meta.tabId===b.tab||u(l).meta.menuKey===b.key');
  // The reference shell eagerly loads its overview and all business stores
  // whenever auth becomes valid. A child must first choose a reachable host.
  once('We(()=>a.canEnterApp,p=>{p&&(n.loadSystemConfig().catch(()=>{}),l||(l=!0,Promise.resolve(t.load()).catch(()=>{})))}),',
    'We(()=>a.canEnterApp,p=>{p&&Promise.resolve(window.communityMayLoadBusiness?.()??!0).then(ready=>{ready&&(n.loadSystemConfig().catch(()=>{}),l||(l=!0,Promise.resolve(t.load()).catch(()=>{})))})}),');
  once('a.canEnterApp&&(n.loadSystemConfig().catch(()=>{}),l||(l=!0,Promise.resolve(t.load()).catch(()=>{}))),a.isLanClient||',
    'a.canEnterApp&&await Promise.resolve(window.communityMayLoadBusiness?.()??!0)&&(n.loadSystemConfig().catch(()=>{}),l||(l=!0,Promise.resolve(t.load()).catch(()=>{}))),a.isLanClient||');
  // Replace the original period-surplus card in place with the authenticated
  // cumulative account balance component installed by the extension.
  block('d("div",{class:"wb-stat-card card-blue",onClick:l[2]||(l[2]=r=>u(a).push({name:"finance"})),title:"点击查看财务收支"}',
    'd("div",{class:"wb-stat-card card-violet","data-testid":"pending-visits-stat"',
    'S(window.communityOverviewBalanceCard),');
  return source;
};
