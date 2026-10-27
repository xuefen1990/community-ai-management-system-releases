import '../../shared/chinese-identity-card.js';
import { exportResidentImportErrors } from './resident-import-errors.mjs';
import { openResidentMerge } from './resident-merge.mjs';
import '../../shared/resident-import-review.js';
import { useDialogStore } from './vendor/assets/foundation-runtime.mjs';

const rules = globalThis.CommunityResidentImportReview;
let latestImport=null;
const node = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
const labels = { idCard:'身份证号',tags:'专项标签',bankAccounts:'收款账户',disbursementHistory:'发放历史',residentOperationLog:'档案操作记录',identityCardHistory:'身份证更正记录', phone:'联系电话',address:'地址',gender:'性别',birthDate:'出生日期',educationLevel:'文化程度',ethnicity:'民族',relationToHead:'与户主关系',householdNo:'户号',villageGroupName:'居民组',registryType:'户籍类型',registryStatus:'档案状态',countInPopulation:'计入人口',customFields:'专项资料',remarks:'备注',name:'姓名' };
const display = value => value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
const fieldLabel = field => field.split('.').map(key => labels[key] || key).join(' / ');

function exportCsv(title, headers, rows) {
  const cell = value => { let text = display(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const blob = new Blob(['\uFEFF', [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = node('a'); anchor.href = url; anchor.download = `${title}_${new Date().toLocaleDateString('sv-SE')}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

function table(headers, rows) {
  const wrap = node('div', null, 'resident-review-table-wrap'), table = node('table'), head = node('thead'), tr = node('tr');
  headers.forEach(label => tr.append(node('th',label))); head.append(tr); table.append(head);
  const body = node('tbody');
  for (const values of rows) { const row = node('tr'); for (const value of values) { const td = node('td'); td.append(value instanceof Node ? value : document.createTextNode(display(value))); row.append(td); } body.append(row); }
  table.append(body); wrap.append(table); return wrap;
}

function pagedTable(container, headers, getRows) {
  let page = 0;
  const render = () => {
    const rows = getRows(), pages = Math.max(1,Math.ceil(rows.length / 50)); page = Math.min(page,pages-1); container.replaceChildren();
    container.append(table(headers,rows.slice(page*50,(page+1)*50)));
    const nav = node('div',null,'resident-review-pagination'), previous = node('button','上一页'), next = node('button','下一页');
    previous.type = next.type = 'button'; previous.disabled = !page; next.disabled = page >= pages-1;
    previous.onclick=()=>{page--;render();}; next.onclick=()=>{page++;render();};
    nav.append(node('span',`共 ${rows.length} 项 · 第 ${page+1} / ${pages} 页`),previous,next);container.append(nav);
  }; render(); return render;
}

function dialog(title, testid) {
  const previousFocus=document.activeElement, underlying=[...document.querySelectorAll('[data-testid="personnel-import-dialog"]')].map(element=>({element,inert:element.inert}));
  underlying.forEach(({element})=>element.inert=true);
  const overlay=node('div',null,'resident-review-overlay'), panel=node('section',null,'resident-review-dialog');overlay.dataset.testid=testid;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);panel.tabIndex=-1;
  const heading=node('h2',title), content=node('div',null,'resident-review-content'), footer=node('div',null,'resident-review-footer');
  panel.append(heading,content,footer);overlay.append(panel);document.body.append(overlay);panel.focus();
  let cancel=()=>{},suspended=false;
  const onKey=event=>{
    if(suspended)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}
    if(event.key==='Tab'){
      const controls=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')];
      const first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus();}
    }
  };document.addEventListener('keydown',onKey,true);
  return {content,footer,onCancel:callback=>cancel=callback,
    suspend:()=>{suspended=true;overlay.style.display='none';},
    resume:()=>{suspended=false;overlay.style.display='';panel.focus();},
    close:()=>{document.removeEventListener('keydown',onKey,true);overlay.remove();underlying.forEach(({element,inert})=>element.inert=inert);if(previousFocus?.isConnected)previousFocus.focus();}};
}

async function currentResidents(api) {
  const responses=await Promise.all(['/people','/households','/village-groups'].map(path=>api.businessRequest({path:`/api/v3${path}?limit=100000`})));
  for(const response of responses)if(!response?.ok)throw Error(response?.error?.message||'读取现有居民档案失败');
  for(const response of responses)if(response.data.total>response.data.items.length)throw Error('居民数据读取不完整，请刷新后重新检查');
  const [people,households,groups]=responses.map(response=>response.data.items),householdMap=new Map(households.map(row=>[row.id,row.householdNo])),groupMap=new Map(groups.map(row=>[row.id,row.name]));
  return {people:people.map(person=>({...person,householdNo:householdMap.get(person.householdId)||'',villageGroupName:groupMap.get(person.villageGroupId)||''})),groups};
}

function showAudit(initialAudit) {
  const view=dialog('检查现有居民档案','resident-audit-dialog');
  const summary=node('p'),hint=node('p','点击问题行的“修改档案”可直接核对资料。身份证更正沿用校验和两次确认，保存后自动返回并重新查验。','resident-review-hint');
  const status=node('p'),error=node('p',null,'resident-review-error'),container=node('div'),empty=node('p','未发现重复身份证、姓名缺失或身份证异常。');
  summary.dataset.testid='resident-audit-summary';status.setAttribute('role','status');error.setAttribute('role','alert');
  const mergeContainer=node('div');
  view.content.append(summary,hint,status,error,mergeContainer,container,empty);
  let audit=initialAudit,busy=false,closed=false,editorListener=null;
  const headers=['档案序号','姓名','身份证号','居民组','户号','检查结果'];
  const close=node('button','关闭'),download=node('button','导出核对清单'),recheck=node('button','重新查验');
  recheck.dataset.testid='resident-audit-recheck';
  const controls=()=>{recheck.disabled=busy;download.disabled=busy||!audit.issues.length;container.querySelectorAll('[data-resident-audit-edit]').forEach(button=>button.disabled=busy);};
  const edit=async row=>{
    if(busy||closed)return;busy=true;controls();error.textContent='';
    try{
      if(typeof window.communityResidentEditorOpen!=='function')throw Error('居民编辑窗口尚未就绪，请关闭检查后重新打开居民档案');
      // Stay attached to this exact internal ID. The resident can be on another
      // page or excluded by the list filters; names/cards are never re-matched.
      editorListener=async event=>{
        if(event.detail?.id!==row.personId)return;
        window.removeEventListener('community-resident-editor-closed',editorListener);editorListener=null;
        if(!document.querySelector('[data-testid="personnel-more-actions"]')){finish();return;}
        try{await refresh(event.detail.saved?'修改已保存，检查结果已刷新。':'已返回检查结果，未保存的内容不会写入。');}
        catch(err){error.textContent=`${event.detail.saved?'修改已保存，但重新查验失败':'重新查验失败'}：${err.message}。可点击“重新查验”重试。`;}
        finally{if(!closed){busy=false;controls();view.resume();}}
      };
      window.addEventListener('community-resident-editor-closed',editorListener);view.suspend();
      await window.communityResidentEditorOpen(row.personId);
    }catch(err){
      if(editorListener)window.removeEventListener('community-resident-editor-closed',editorListener);editorListener=null;
      busy=false;controls();error.textContent=err.message;view.resume();
    }
  };
  const renderTable=pagedTable(container,[...headers,'操作'],()=>audit.issues.map(row=>{
    const button=node('button','修改档案');button.type='button';button.dataset.residentAuditEdit=row.personId;button.disabled=busy||!row.personId;button.onclick=()=>edit(row);
    return [row.index,row.name,row.idCard,row.villageGroupName,row.householdNo,row.reason,button];
  }));
  function renderMerges(){
    mergeContainer.replaceChildren();
    const groups=audit.mergeGroups||[];
    if(!groups.length)return;
    mergeContainer.append(node('h3',`发现 ${groups.length} 组重复或疑似重复档案，请核对后合并`));
    const rows=node('div');mergeContainer.append(rows);
    pagedTable(rows,['核对原因','姓名','档案数量','操作'],()=>groups.map(group=>{
      const button=node('button','查看差异并合并');button.dataset.residentMergeOpen='true';button.disabled=busy;
      button.onclick=async()=>{
        if(busy)return;busy=true;controls();button.disabled=true;view.suspend();
        try{
          const merged=await openResidentMerge(group,{dialog,node,table,display,fieldLabel});
          if(merged){
            const {foundation}=await import('./bootstrap.mjs');await foundation.personnel.load({force:true});
            await refresh('合并已完成，列表和检查结果已刷新。');
          }
        }catch(err){error.textContent=err.message;}finally{busy=false;controls();renderMerges();view.resume();}
      };
      return [group.reason,[...new Set(group.people.map(p=>p.name))].join('、'),group.people.length,button];
    }));
  }
  function render(){renderMerges();summary.textContent=`已检查 ${audit.total} 份档案，${audit.affected} 份需要核对。重复身份证 ${audit.duplicateGroups} 组，其中姓名不同 ${audit.nameConflictGroups} 组；身份证缺失 ${audit.missingId} 份、不合法 ${audit.invalidId} 份。`;empty.hidden=!!audit.issues.length||!!audit.mergeGroups?.length;renderTable();controls();}
  async function refresh(message='检查结果已更新。'){
    const {people}=await currentResidents(window.api);if(closed)return;
    audit=rules.auditResidents(people);render();status.textContent=message;
  }
  function finish(){closed=true;if(editorListener)window.removeEventListener('community-resident-editor-closed',editorListener);view.close();}
  close.onclick=()=>{if(!busy)finish();};view.onCancel(()=>{if(!busy)finish();});
  recheck.onclick=async()=>{if(busy)return;busy=true;controls();error.textContent='';try{await refresh();}catch(err){error.textContent=err.message;}finally{busy=false;controls();}};
  download.onclick=()=>exportCsv('居民档案核对清单',headers,audit.issues.map(row=>[row.index,row.name,row.idCard,row.villageGroupName,row.householdNo,row.reason]));
  view.footer.append(download,recheck,close);render();
}

async function reviewImport(options) {
  const current=await currentResidents(window.api),input={...options,existingPeople:current.people,villageGroups:current.groups};
  const inspection=rules.inspectImport(input),decisions={};
  return new Promise(resolve=>{
    const view=dialog('导入前检查与合并确认','resident-import-review-dialog');
    const summary=node('p'),hint=node('p','合并规则：只补空白，保留已有值；姓名不同必须人工选择。确认后才写入档案。','resident-review-hint');view.content.append(hint,summary);
    if(inspection.nameConflicts.length){
      view.content.append(node('h3','选择保留的姓名'));
      const container=node('div');view.content.append(container);
      const rows=inspection.nameConflicts.map(group=>{
        const select=node('select');select.dataset.residentNameChoice=group.idCard;select.setAttribute('aria-label',`${group.idCard}保留的姓名`);
        const placeholder=node('option','请选择姓名或跳过');placeholder.value='';select.append(placeholder);
        for(const name of group.nameOptions){const option=node('option',`${name}${name===group.currentName?'（现有档案）':'（表格）'}`);option.value=name;select.append(option);}
        const skip=node('option','跳过此人');skip.value='__skip__';select.append(skip);
        select.onchange=()=>{decisions[group.idCard]=select.value;update();};
        return [group.rows.map(row=>row.rowNo).join('、'),group.idCard,group.currentName||'无现有档案',group.names.join('、'),select];
      });pagedTable(container,['表格行号','身份证号','原姓名','表格姓名','人工决定'],()=>rows);
    }
    const details=node('div'),error=node('p',null,'resident-review-error');error.setAttribute('role','alert');view.content.append(details,error);
    const cancel=node('button','返回表格'),confirm=node('button','确认合并并导入'),download=node('button','导出本次核对清单');confirm.dataset.testid='resident-review-confirm';confirm.className='resident-review-primary';cancel.dataset.testid='resident-review-cancel';
    let plan=null;
    const finish=value=>{view.close();resolve(value);};cancel.onclick=()=>finish(null);view.onCancel(()=>finish(null));
    confirm.onclick=()=>{if(plan&&!confirm.disabled){latestImport={input,plan};finish(plan);}};
    download.onclick=()=>{
      const headers=['类型','表格行号','姓名','身份证号','字段','原内容','表格内容','处理说明'];
      const rows=[...inspection.nameConflicts.map(group=>['姓名冲突',group.rows.map(row=>row.rowNo).join('、'),group.currentName,group.idCard,'姓名',group.currentName,group.names.join('、'),decisions[group.idCard]||'待人工选择']),...inspection.invalid.map(row=>['异常',row.rowNo,row.name,row.idCard,'','','',row.reason]),...(plan?.differences||[]).map(row=>['字段差异',row.rowNo,row.name,row.idCard,fieldLabel(row.field),display(row.current),display(row.incoming),'保留已有值'])];
      exportCsv('居民导入核对清单',headers,rows);
    };
    const errorDownload=node('button','导出错误信息 (.xlsx)');errorDownload.dataset.testid='resident-review-export-errors';
    errorDownload.onclick=async()=>{try{await exportResidentImportErrors(plan?.summary.failedList||inspection.invalid,input.fileName);}catch(err){error.textContent=err.message;}};
    view.footer.append(download,errorDownload,cancel,confirm);
    function update(){
      error.textContent='';details.replaceChildren();
      const unresolved=inspection.nameConflicts.filter(group=>!decisions[group.idCard]).length;
      if(unresolved){plan=null;confirm.disabled=true;summary.textContent=`表格 ${inspection.totalRows} 行，可处理 ${inspection.groups.length} 人，表内重复 ${inspection.duplicateRows} 行，异常 ${inspection.invalid.length} 行；还有 ${unresolved} 项姓名冲突待选择。`;return;}
      try{
        plan=rules.planImport(input,options.buildPlan,decisions);confirm.disabled=!plan.validRows.length&&!plan.summary.unchangedRows;errorDownload.disabled=!plan.summary.failedList.length;
        summary.textContent=`将新增 ${plan.summary.insertedRows} 人，补充 ${plan.summary.updatedRows} 人，原档保持 ${plan.summary.unchangedRows} 人；表内归并 ${plan.summary.duplicateRows} 行，跳过/异常 ${plan.summary.failedRows} 行。`;
        if(inspection.invalidIdentityRows.length)error.textContent=`${inspection.invalidIdentityRows.length} 行身份证号错误或缺失，将跳过；其余正确行可正常导入。导入后可导出错误表格。`;
        const sections=[['处理预览',['表格行号','姓名','身份证号','处理'],plan.reviewRows.map(row=>[row.rowNo,row.name,row.idCard,row.action])],['已有值与表格不同（保留已有值）',['表格行号','姓名','字段','已有值','表格值'],plan.differences.map(row=>[row.rowNo,row.name,fieldLabel(row.field),display(row.current),display(row.incoming)])],['异常与跳过项',['表格行号','姓名','身份证号','原因'],plan.summary.failedList.map(row=>[row.rowNo,row.name,row.idCard,row.reason])]];
        for(const [title,headers,rows]of sections)if(rows.length){const section=node('details');section.open=title==='处理预览'||title==='异常与跳过项';section.append(node('summary',`${title}（${rows.length} 项）`));const container=node('div');section.append(container);details.append(section);pagedTable(container,headers,()=>rows);}
      }catch(err){plan=null;confirm.disabled=true;error.textContent=err.message;}
    }update();
  });
}

export function installResidentImportReview() {
  const dialogs=useDialogStore();let busy=false;
  window.communityReviewResidentImport=reviewImport;
  window.communityExportResidentImportErrors=exportResidentImportErrors;
  const style=node('link');style.rel='stylesheet';style.href=new URL('./resident-import-review.css',import.meta.url).href;document.head.append(style);
  const installButton=()=>{
    const exportButton=document.getElementById('btnExportImportErrors');
    if(exportButton&&latestImport&&!exportButton.dataset.reviewExport){
      exportButton.dataset.reviewExport='true';
      exportButton.addEventListener('click',async event=>{
        event.preventDefault();event.stopImmediatePropagation();
        const {input,plan}=latestImport;
        const failures=plan.summary.failedList.map(row=>row.raw?row:{...row,raw:input.rows.find(source=>globalThis.CommunityIdentityCard.normalize(source[input.mappings.id_card||input.mappings.idCard])===row.idCard)||{}});
        try{await exportResidentImportErrors(failures,input.fileName);}catch(error){dialogs.notify({type:'error',message:error.message});}
      },true);
    }

    const more=document.querySelector('[data-testid="personnel-more-actions"]');
    if(!more||document.querySelector('[data-testid="resident-audit-open"]'))return;
    const button=node('button','检查现有档案','resident-audit-open el-button');button.type='button';button.dataset.testid='resident-audit-open';
    button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{const {people}=await currentResidents(window.api);showAudit(rules.auditResidents(people));}catch(error){dialogs.notify({type:'error',message:error.message});}finally{busy=false;button.disabled=false;}};
    (more.closest('.el-dropdown')||more).before(button);
    currentResidents(window.api).then(({people})=>{
      const count=rules.duplicateCandidates(people).length;
      if(button.isConnected&&count){button.textContent=`发现 ${count} 组疑似重复 · 检查档案`;button.title='请核对重复档案，确认后可合并';}
    }).catch(()=>{});
  };
  let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;installButton();});}}).observe(document.getElementById('app'),{childList:true,subtree:true});
  installButton();
}
