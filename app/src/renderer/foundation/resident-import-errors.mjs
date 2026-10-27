import '../../shared/resident-import-errors.js';
import { loadScript } from './extensions.mjs';

export async function exportResidentImportErrors(failures=[],fileName='居民导入') {
  if(!failures.length)throw Error('没有需要导出的错误信息');
  if(!window.XLSX)await loadScript('js/core/xlsx.full.min.js');
  const xlsx=window.XLSX;
  if(!xlsx?.utils)throw Error('表格导出组件未就绪，请重新打开后再试');
  const {headers,rows}=globalThis.CommunityResidentImportErrors.errorTable(failures);
  // Strings remain text cells: long identity cards/leading zeroes are never
  // converted to numeric cells, and user input cannot become a formula.
  const sheet=xlsx.utils.aoa_to_sheet([headers,...rows]);
  sheet['!cols']=headers.map(key=>({wch:/错误原因/.test(key)?48:/身份证/.test(key)?24:20}));
  const book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,sheet,'待修正错误行');
  const bytes=xlsx.write(book,{bookType:'xlsx',type:'array'});
  const name=String(fileName||'居民导入').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]/g,'_');
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`${name}_错误信息_${new Date().toLocaleDateString('sv-SE')}.xlsx`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return {exportedRows:rows.length};
}
