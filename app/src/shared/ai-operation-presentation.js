(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.AiOperationPresentation=value;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const labels={phone:'联系电话',address:'住址',group:"居民组",name:'名称',title:'标题',content:'内容',status:'状态',stage:'党员阶段',date:'日期',startDate:'开始日期',endDate:'结束日期',amountCents:'金额',amount:'金额',summary:'摘要',type:'收支类型',villageName:"村居名称",parcel_name:'地块名称',parcel_code:'地块编号',area:'面积（亩）',areaMu:'面积（亩）',landType:'土地类型',contractor_name:'承包人',contractorName:'承包人',village_group:"居民组",location:'位置',number:'编号',contractNumber:'合同编号',voucherNumber:'凭证号',receiptNumber:'到账编号',paymentDate:'到账日期',bankName:'开户行',accountName:'开户人',cardNumber:'银行卡号',bankCard:'银行卡号',personName:'居民姓名',visitorName:'来访人',recordNo:'证明编号',reason:'原因',remark:'备注',description:'说明',backupName:'备份名称',enabled:'是否启用',disabled:'是否停用',deletedAt:'移除时间',archivedAt:'归档时间',count:'数量',completedAt:'完成时间',dueDate:'截止日期',priority:'优先级',assignee:'负责人',owner:'负责人',responsiblePerson:'负责人',resourceType:'资源类型'};
  const statuses={completed:'已完成',undone:'已撤销',cancelled:'已取消',failed:'未执行',pending:'待确认',income:'收入',expense:'支出',active:'启用',disabled:'停用',archived:'已归档',draft:'草稿',high:'高',normal:'普通',low:'低'};
  function value(v,key){if(v==null||v==='')return '未填写';if(typeof v==='boolean')return v?'是':'否';if(key==='amountCents')return `¥${(Number(v)/100).toFixed(2)}`;if(typeof v==='object')return Array.isArray(v)?`${v.length} 条记录`:'已登记资料';return statuses[v]||String(v);}
  function flatten(object,prefix='',result=new Map()){
    if(!object||typeof object!=='object')return result;
    for(const [key,v] of Object.entries(object)){
      if(['record','receipt','schedule','member','fields','settings'].includes(key)&&v&&typeof v==='object'&&!Array.isArray(v)){flatten(v,prefix,result);continue;}
      if(['records','items','numbers','names'].includes(key)&&Array.isArray(v)){result.set('记录数量',`${v.length} 条`);if(key==='names')result.set('涉及人员',v.join('、'));continue;}
      const label=labels[key]||(/^[\p{Script=Han}、（）()\s]+$/u.test(key)?key:'');if(!label)continue;
      result.set(prefix+label,value(v,key));
    }return result;
  }
  function changes(op){const before=flatten(op.before),after=flatten(op.after);return [...new Set([...before.keys(),...after.keys()])].filter(key=>before.get(key)!==after.get(key)).map(label=>({label,before:before.get(label)||'未登记',after:after.get(label)||'已移除'}));}
  function undoReason(op){if(op.status==='undone')return '本次操作已撤销';if(op.status==='cancelled')return '操作已取消，未写入数据';if(op.status==='failed')return '操作未成功，无需撤销';if(op.type==='undo')return '这是一条撤销记录，无需再次撤销';if(!op.recoverable)return '此记录没有可恢复快照，无法直接撤销';if(op.status!=='completed')return '操作尚未完成，暂不能撤销';return '';}
  return {changes,status:op=>statuses[op.status]||'状态待核对',operator:op=>op.operator?.name||op.operator?.phone||op.operatorName||op.createdBy||'历史记录未记载',undoReason};
});
