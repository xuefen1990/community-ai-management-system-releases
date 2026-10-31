// Shared, testable contracts for the editor, statistics and full-screen display.
export function mapConfiguration(settings={}) {
  let center=settings.map_center_coordinates;
  try { if(typeof center==='string')center=JSON.parse(center); } catch { center=null; }
  if(!Array.isArray(center)||center.length!==2||center.some(v=>v===null||v===''||!Number.isFinite(Number(v)))||Math.abs(Number(center[0]))>90||Math.abs(Number(center[1]))>180)center=null;
  const zoom=Number(settings.map_zoom_level);
  return {center:center?.map(Number)||null,zoom:Number.isFinite(zoom)&&zoom>=3&&zoom<=18?zoom:15,villageName:String(settings.village_name||settings.villageName||'').trim()};
}
export function mapChanges(center,zoom) {
  const config=mapConfiguration({map_center_coordinates:center,map_zoom_level:zoom});
  if(!config.center)throw Error('请先在地图上标记有效的村委会位置');
  // Deliberately do not include village name or boundary: preserve both.
  return {map_center_coordinates:JSON.stringify(config.center.map(n=>Number(n.toFixed(6)))),map_zoom_level:String(config.zoom)};
}
export async function readAllPages(request,path,{pageSize=10000}={}) {
  const items=[];let offset=0,expected=null;
  for(;;){const result=await request({path:`/api/v3${path}?limit=${pageSize}&offset=${offset}`});
    if(!Array.isArray(result?.items))throw Error('业务数据返回格式不正确');
    if(expected===null)expected=Number(result.total??result.items.length);
    else if(expected!==Number(result.total??expected))throw Error('统计期间资料已变动，请刷新后重试');
    items.push(...result.items);offset+=result.items.length;
    if(offset>=expected)break;
    if(!result.items.length)throw Error('业务数据读取不完整，请刷新重试');
  }
  return items;
}
export function financeSummary(records,year='all',groups=globalThis.CommunityFinanceChartGroups) {
  const rows=records.filter(row=>{
    const date=String(row.recordDate||row.record_date||row.date||''),type=row.recordType||row.type;
    const d=new Date(`${date}T12:00:00`);
    return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(d.getTime())&&d.toLocaleDateString('sv-SE')===date&&['income','expense'].includes(type)&&(year==='all'||date.startsWith(`${year}-`));
  }).map(row=>({...row,recordDate:row.recordDate||row.record_date||row.date,recordType:row.recordType||row.type,amountCents:Number.isSafeInteger(row.amountCents)?row.amountCents:Math.round(Number(row.amount||0)*100)})).filter(row=>Number.isSafeInteger(row.amountCents)&&row.amountCents>=0);
  const total=type=>rows.filter(r=>r.recordType===type).reduce((n,r)=>n+r.amountCents,0);
  const income=total('income'),expense=total('expense');
  if(![income,expense,income-expense].every(Number.isSafeInteger))throw Error('累计金额超出可计算范围');
  const categories=type=>{if(groups){const report=groups.statisticsReport({financeRecords:rows});return groups.chartCategories(report,{type,mode:'auto'}).parts.map(r=>({name:r.category,value:r.amountCents/100,count:r.count,percent:(type==='income'?income:expense)>0?r.amountCents/(type==='income'?income:expense)*100:0}));}const amounts=new Map();for(const r of rows.filter(r=>r.recordType===type)){const k=r.category||'未分类';amounts.set(k,(amounts.get(k)||0)+r.amountCents);}return [...amounts].map(([name,amount])=>({name,value:amount/100}));};
  return {records:rows,incomeTotal:income/100,expenseTotal:expense/100,balance:(income-expense)/100,incomeCategories:categories('income'),expenseCategories:categories('expense')};
}
