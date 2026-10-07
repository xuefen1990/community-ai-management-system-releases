/* Main accounts and their members are linked by ID; phone numbers are display/search keys. */
(function (root) {
  'use strict';
  root.createAccountDirectory = function ({api, setContent, esc, date, badge, toast, isActive, action}) {
    const state={id:null,keyword:'',active:'',scope:'main',page:1,memberKeyword:'',memberActive:'',memberPage:1};
    let revision=0;
    const button=(label,kind,id,css='ghost')=>`<button type="button" class="${css} small" data-account-action="${kind}" data-account-id="${esc(id)}">${label}</button>`;
    const status=u=>u.isDeleted?'<span class="badge off">已删除</span>':badge(u.isActive);
    const plan=u=>u.role==='member'?'随主账号':(u.planType==='permanent'?'永久':u.planType==='trial'?'试用':'限期')+(u.planExpiresAt?' · '+date(u.planExpiresAt):'');
    function actions(u) {
      let html=u.role!=='member'?button('查看子账号','detail',u.id):'';
      if(u.isDeleted)return html+'<span class="hint">已安全删除</span>';
      if(['admin','platform_admin'].includes(u.role))return html+'<span class="hint">平台管理员</span>';
      if(u.role!=='member')html+=button('授权','editUser',u.id);
      html+=button('重置密码','resetPassword',u.id);
      if(u.loginLockedUntil&&new Date(u.loginLockedUntil)>new Date())html+=button('解除锁定','unlockLogin',u.id);
      return html+button(u.isActive?'停用':'启用',u.isActive?'disable':'enable',u.id,u.isActive?'danger':'primary')+button('删除','deleteUser',u.id,'danger');
    }
    const filters=(keyword,active,detail)=>`<form id="accountSearch" class="left"><input id="accountKeyword" value="${esc(keyword)}" placeholder="搜索${detail?'子账号手机号或姓名':'主账号 / 子账号手机号或姓名'}" aria-label="账号搜索"><select id="accountActive" aria-label="账号状态"><option value="">全部状态</option><option value="true" ${active==='true'?'selected':''}>正常</option><option value="false" ${active==='false'?'selected':''}>已停用 / 已删除</option></select>${detail?'':`<select id="accountScope" aria-label="账号范围"><option value="main" ${state.scope==='main'?'selected':''}>主账号</option><option value="platform" ${state.scope==='platform'?'selected':''}>平台管理员</option><option value="unassigned" ${state.scope==='unassigned'?'selected':''}>归属待核对</option></select>`}<button class="ghost small">搜索</button></form>`;
    const pages=p=>`<div class="pagination"><button class="ghost small" data-page-step="-1" ${p.page<=1?'disabled':''}>上一页</button><span class="hint">第 ${p.page} / ${p.totalPages} 页 · 共 ${p.total} 个账号</span><button class="ghost small" data-page-step="1" ${p.page>=p.totalPages?'disabled':''}>下一页</button></div>`;
    function bind(detail) {
      document.querySelector('#accountSearch').onsubmit=e=>{e.preventDefault();const keyword=document.querySelector('#accountKeyword').value,active=document.querySelector('#accountActive').value;if(detail){state.memberKeyword=keyword;state.memberActive=active;state.memberPage=1;}else{state.keyword=keyword;state.active=active;state.scope=document.querySelector('#accountScope').value;state.page=1;}run();};
      document.querySelectorAll('[data-page-step]').forEach(node=>node.onclick=()=>{state[detail?'memberPage':'page']+=Number(node.dataset.pageStep);run();});
      document.querySelectorAll('[data-account-action]').forEach(node=>node.onclick=async()=>{const kind=node.dataset.accountAction,id=node.dataset.accountId;if(kind==='detail'){state.id=id;state.memberKeyword='';state.memberActive='';state.memberPage=1;return run();}if(kind==='back'){state.id=null;return run();}try{await action(kind==='enable'||kind==='disable'?'toggleUser':kind,id,kind==='enable');}catch(error){toast(error.message||'操作失败',true);}});
    }
    async function render() {
      const current=++revision,detail=Boolean(state.id),token=state.id;
      const query=new URLSearchParams({keyword:detail?state.memberKeyword:state.keyword,isActive:detail?state.memberActive:state.active,page:detail?state.memberPage:state.page,pageSize:15,scope:state.scope});
      const d=await api('/admin/accounts'+(detail?'/'+encodeURIComponent(token):'')+'?'+query);
      if(current!==revision||!isActive())return;
      if(detail) {
        state.memberPage=d.pagination.page;const u=d.account;
        const roles={clerk:'业务经办',custom:'自定义',readonly:'只读人员'};
        const rows=d.members.map(m=>`<tr><td><strong>${esc(m.phone)}</strong><div class="hint">${esc(m.name||'未填写姓名')}</div></td><td>子账号<div class="hint">${esc(roles[m.positionPreset]||m.positionPreset||'岗位未记录')}</div></td><td>${status(m)}</td><td>${date(m.createdAt)}</td><td>${date(m.lastLoginAt)}</td><td>${esc(m.createdByPhone||'未记录')}<div class="hint">${m.creatorSource==='audit'?'来源：创建日志':m.creatorSource==='record'?'来源：创建记录':'历史记录无依据'}</div></td><td class="actions">${actions(m)}</td></tr>`).join('');
        setContent('主账号 '+esc(u.phone),'子账号归属按固定账号 ID 绑定，修改手机号不会改变归属。',`<section class="panel"><div class="toolbar"><h2>主账号信息</h2>${button('返回账号列表','back','')}</div><div class="account-summary"><div>手机号<strong>${esc(u.phone)}</strong></div><div>姓名<strong>${esc(u.name||'未填写')}</strong></div><div>状态<strong>${status(u)}</strong></div><div>软件授权<strong>${esc(plan(u))}</strong></div><div>注册时间<strong>${date(u.createdAt)}</strong></div><div>最后登录<strong>${date(u.lastLoginAt)}</strong></div><div>子账号<strong>${d.memberCount} 个</strong></div></div></section><section class="panel account-directory"><div class="toolbar">${filters(state.memberKeyword,state.memberActive,true)}</div><div class="account-table-wrap"><table><thead><tr><th>手机号 / 姓名</th><th>角色 / 岗位</th><th>状态</th><th>注册时间</th><th>最后登录</th><th>创建人</th><th>操作</th></tr></thead><tbody>${rows||`<tr><td colspan="7" class="empty">${d.memberCount?'没有符合搜索条件的子账号':'该主账号尚未开通子账号'}</td></tr>`}</tbody></table></div>${pages(d.pagination)}</section>`);
      } else {
        state.page=d.pagination.page;
        const rows=d.accounts.map(u=>`<tr><td><strong>${esc(u.phone)}</strong><div class="hint">${esc(u.name||'未填写姓名')}</div>${u.matchedMembers.length?`<div class="hint">匹配子账号：${u.matchedMembers.map(m=>esc(m.phone)).join('、')}</div>`:''}</td><td>${u.role==='member'?'归属待核对':u.role==='main_account'||u.role==='unit_admin'?'主账号':'平台管理员'}</td><td>${esc(plan(u))}</td><td>${u.role==='member'?'—':u.memberCount+' 个'}</td><td>${status(u)}</td><td>${date(u.createdAt)}</td><td>${date(u.lastLoginAt)}</td><td class="actions">${actions(u)}</td></tr>`).join('');
        setContent('账号管理','默认展示主账号，点击“查看子账号”查看成员；手机号用于查找，归属按固定账号 ID 保存。',`<div class="stats"><div class="stat"><span>主账号</span><b>${d.counts.main}</b></div><div class="stat"><span>子账号</span><b>${d.counts.members}</b></div><div class="stat"><span>归属待核对</span><b>${d.counts.unassigned}</b></div></div><section class="panel account-directory"><div class="toolbar">${filters(state.keyword,state.active,false)}</div><div class="account-table-wrap"><table><thead><tr><th>手机号 / 姓名</th><th>类型</th><th>软件授权</th><th>子账号数</th><th>状态</th><th>注册时间</th><th>最后登录</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">没有符合条件的账号</td></tr>'}</tbody></table></div>${pages(d.pagination)}</section>`);
      }
      bind(detail);
    }
    async function run(){try{await render();}catch(error){if(isActive())toast(error.message||'读取账号失败，请重试',true);}}
    return {render, reset(){revision++;Object.assign(state,{id:null,keyword:'',active:'',scope:'main',page:1,memberKeyword:'',memberActive:'',memberPage:1});}};
  };
})(window);
