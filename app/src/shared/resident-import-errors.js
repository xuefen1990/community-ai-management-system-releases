'use strict';
(function expose(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.CommunityResidentImportErrors=api;
})(typeof globalThis!=='undefined'?globalThis:this,function createErrors(){
  const text=value=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
  function errorTable(failures=[]){
    const columns=[...new Set(failures.flatMap(row=>Object.keys(row.raw||{})))].filter(key=>!key.startsWith('__resident'));
    if(!columns.length)columns.push('姓名','身份证号');
    const unique=label=>{while(columns.includes(label))label=`本次导入${label}`;return label;};
    const headers=[...columns,unique('原表行号'),unique('错误原因')];
    const rows=failures.map(row=>[
      ...columns.map(key=>text(Object.hasOwn(row.raw||{},key)?row.raw[key]:key==='姓名'?row.name:key==='身份证号'?row.idCard:'')),
      text(row.rowNo),text(row.reason||row.error||'未能导入，请核对资料'),
    ]);
    return {headers,rows};
  }
  return {errorTable};
});
