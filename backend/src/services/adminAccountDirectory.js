'use strict';
const db = require('../database');
const auth = require('./authService');
const scope = require('./mainAccountScope');
const isMain = user => ['main_account','unit_admin'].includes(user?.role);
const isPlatform = user => ['admin','platform_admin'].includes(user?.role);
function pageOf(items,page,pageSize) {
  const size=Math.min(100,Math.max(1,parseInt(pageSize,10)||15)),totalPages=Math.max(1,Math.ceil(items.length/size));
  const current=Math.min(totalPages,Math.max(1,parseInt(page,10)||1));
  return {items:items.slice((current-1)*size,current*size),pagination:{page:current,pageSize:size,total:items.length,totalPages}};
}
function context() {
  const users=db.findAll('users'),byId=new Map(users.map(user=>[user.id,user]));
  const parents=new Map();
  for(const user of users.filter(user=>user.role==='member')) {
    const parent=byId.get(scope.mainAccountIdOf(user));
    if(parent && (isMain(parent)||isPlatform(parent)) && parent.id!==user.id) parents.set(user.id,parent);
  }
  const creators=new Map();
  // A binding is not evidence of who created an old account.
  for(const log of db.findAll('audit_logs').filter(log=>log.action==='create_unit_member').sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')))) {
    if(!creators.has(log.target)) creators.set(log.target,log.user_id);
  }
  return {users,byId,parents,creators};
}
function present(user,ctx) {
  const parent=ctx.parents.get(user.id),creatorId=user.created_by || ctx.creators.get(user.id) || null,creator=ctx.byId.get(creatorId);
  return {...auth.getUserById(user.id),parentUserId:user.role==='member'?parent?.id || null:null,
    parentPhone:parent?.deleted_at?'已删除':parent?.phone || null,
    createdBy:creatorId,createdByPhone:creator?.deleted_at?'已删除':creator?.phone || null,
    creatorSource:user.created_by?'record':ctx.creators.has(user.id)?'audit':'unknown',
    positionPreset:user.position_preset || null,
    ownershipStatus:user.role!=='member'?'main':!parent?'unassigned':parent.deleted_at?'parent-deleted':'bound'};
}
function list({keyword='',isActive,scope:kind='main',page=1,pageSize=15}={}) {
  const ctx=context(),word=String(keyword).trim().toLowerCase(),match=user=>[user.phone,user.name].some(value=>String(value||'').toLowerCase().includes(word));
  let users=ctx.users.filter(user=>kind==='platform'?isPlatform(user):kind==='unassigned'?user.role==='member'&&!ctx.parents.has(user.id):isMain(user));
  if(word) users=users.filter(user=>match(user) || ctx.users.some(child=>ctx.parents.get(child.id)?.id===user.id&&match(child)));
  if(isActive!==undefined&&isActive!=='') users=users.filter(user=>Boolean(user.is_active)===['true','1'].includes(String(isActive)));
  users.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(a.id).localeCompare(String(b.id)));
  const paged=pageOf(users,page,pageSize);
  return {accounts:paged.items.map(user=>{const children=ctx.users.filter(child=>ctx.parents.get(child.id)?.id===user.id&&!child.deleted_at);return {...present(user,ctx),memberCount:children.length,activeMemberCount:children.filter(child=>child.is_active).length,
    matchedMembers:word?children.filter(match).map(child=>({id:child.id,phone:child.phone,name:child.name})):[]};}),pagination:paged.pagination,
    counts:{main:ctx.users.filter(user=>isMain(user)&&!user.deleted_at).length,members:ctx.users.filter(user=>user.role==='member'&&!user.deleted_at).length,unassigned:ctx.users.filter(user=>user.role==='member'&&!user.deleted_at&&!ctx.parents.has(user.id)).length}};
}
function detail(id,{keyword='',isActive,page=1,pageSize=15}={}) {
  const ctx=context(),main=ctx.byId.get(id);
  if(!main || !(isMain(main)||isPlatform(main))){const error=new Error('未找到主账号');error.statusCode=404;throw error;}
  const all=ctx.users.filter(user=>user.role==='member'&&ctx.parents.get(user.id)?.id===id&&!user.deleted_at);
  const word=String(keyword).trim().toLowerCase();let members=all.filter(user=>!word || [user.phone,user.name].some(value=>String(value||'').toLowerCase().includes(word)));
  if(isActive!==undefined&&isActive!=='') members=members.filter(user=>Boolean(user.is_active)===['true','1'].includes(String(isActive)));
  members.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(a.id).localeCompare(String(b.id)));
  const paged=pageOf(members,page,pageSize);
  return {account:present(main,ctx),memberCount:all.length,members:paged.items.map(user=>present(user,ctx)),pagination:paged.pagination};
}
module.exports={list,detail};
