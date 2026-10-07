'use strict';

const clean = value => String(value ?? '').normalize('NFKC').trim();
const chineseMonths = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
function periodOf(value) {
  const text = clean(value);
  const year = Number(text.match(/(?:^|[^\d])((?:19|20|21)\d{2})(?:[^\d]|$)/u)?.[1]) || null;
  const range = text.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*月?\s*[-–—~至到]\s*(1[0-2]|0?[1-9])\s*月/u);
  if (range) return {year,month:null,monthRange:{start:Number(range[1]),end:Number(range[2])}};
  const chineseMonth = text.match(/(?:^|[^一二三四五六七八九十])(十一|十二|十|[一二三四五六七八九])\s*月/u)?.[1];
  const month = Number(text.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*月/u)?.[1])
    || chineseMonths.indexOf(chineseMonth) + 1 || null;
  return {year,month};
}

// Only standalone period labels before a real header are title evidence.
// A salary summary mentioning a service period is never a date context.
function periodLabel(value) {
  return /^(?:(?:报表|所属|统计|会计|账期|期间|日期|时间|月份|年月)\s*[:：]?\s*)?(?:(?:19|20|21)\d{2}\s*年\s*)?(?:(?:1[0-2]|0?[1-9]|十一|十二|[一二三四五六七八九十])\s*月(?:\s*[-–—~至到]\s*(?:1[0-2]|0?[1-9])\s*月)?|(?:1[0-2]|0?[1-9])\s*[-–—~至到]\s*(?:1[0-2]|0?[1-9])\s*月)\s*(?:份|财务明细|财务收支(?:明细)?表|财务收支明细)?$/u.test(clean(value))
    || /^(?:(?:报表|所属|统计|会计|年份|年度)\s*[:：]?\s*)?(?:19|20|21)\d{2}\s*年(?:度)?\s*(?:账本|台账|财务明细|财务收支(?:明细)?表)?$/u.test(clean(value));
}
function contextOf({sheetName='',fileName='',labels=[],year,confirmation}={}) {
  const evidence = [{source:'sheet',label:'工作表名称',text:clean(sheetName),...periodOf(sheetName)},
    ...labels.filter(item=>periodLabel(item.text)).map(item=>({source:'header',label:`原表第 ${item.sourceRowNumber} 行`,...item,...periodOf(item.text)})),
    {source:'file',label:'文件名',text:clean(fileName),...periodOf(fileName)}];
  const primary = evidence.filter(item=>item.source!=='file');
  const yearSources = primary.some(item=>item.year) ? primary.filter(item=>item.year) : evidence.filter(item=>item.year);
  const monthSources = primary.some(item=>item.month || item.monthRange) ? primary.filter(item=>item.month || item.monthRange) : evidence.filter(item=>item.month || item.monthRange);
  const years=[...new Set(yearSources.map(item=>item.year))];
  const periods=[...new Set(monthSources.map(item=>item.monthRange?`${item.monthRange.start}-${item.monthRange.end}`:String(item.month)))];
  const conflicts=[];
  if(years.length>1) conflicts.push('年份依据不一致');
  if(periods.length>1) conflicts.push('月份依据不一致');
  const explicitYear = Number(year);
  const confirmed = confirmation && Number.isInteger(confirmation.year) && confirmation.year>=1900 && confirmation.year<=2199
    && Number.isInteger(confirmation.month) && confirmation.month>=1 && confirmation.month<=12;
  const contextYear = confirmed ? confirmation.year : Number.isInteger(explicitYear) && explicitYear>=1900 && explicitYear<=2199 ? explicitYear : years.length===1 ? years[0] : null;
  const period = periods.length===1 ? monthSources[0] : null;
  return {year:contextYear,month:confirmed?confirmation.month:period?.month || null,
    ...(!confirmed && period?.monthRange?{monthRange:period.monthRange}:{}),evidence,
    conflicts:confirmed?[]:conflicts,needsConfirmation:!confirmed && (!contextYear || !period || conflicts.length>0),
    ...(confirmed?{confirmation:{...confirmation},source:'confirmed'}:{source:'metadata'})};
}
module.exports={contextOf,periodLabel};
