import { statisticsFinanceChart, ChartCard, createElementVNode as h, createVNode, ref, computed } from './vendor/assets/foundation-runtime.mjs';
import '../../shared/finance-chart-groups.js';
const groups = globalThis.CommunityFinanceChartGroups;
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = cents => (cents / 100).toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2});
export function installStatisticsFinanceChart() {
  statisticsFinanceChart.setup = props => {
    const type=ref('expense'),mode=ref('auto');
    const data=computed(()=>groups.chartCategories(groups.statisticsReport(props.profile),{type:type.value,mode:mode.value}));
    const option=computed(()=>({
      tooltip:{trigger:'item',appendTo:'body',confine:true,extraCssText:'max-width:min(320px,80vw);max-height:60vh;overflow-y:auto;white-space:normal;overflow-wrap:anywhere;',
        formatter:item=>{const part=data.value.parts[item.dataIndex];return part?`<strong>${esc(part.category)}</strong><br>金额：${money(part.amountCents)} 元<br>占比：${Number(item.percent).toFixed(2)}%${part.categories.length>1||part.categories[0]!==part.category?`<br>具体科目：${part.categories.map(esc).join('、')}`:''}`:'';}},
      legend:{type:'scroll',bottom:4,left:'center',width:'90%',tooltip:{show:true},textStyle:{width:110,overflow:'truncate'}},
      series:[{type:'pie',radius:['38%','65%'],center:['50%','43%'],label:{show:false},labelLine:{show:false},emphasis:{label:{show:false}},avoidLabelOverlap:true,
        itemStyle:{borderColor:'#fff',borderWidth:2},data:data.value.parts.map(part=>({name:part.category,value:part.amountCents/100}))}],
      ...(data.value.parts.length?{}:{graphic:{type:'text',left:'center',top:'middle',style:{text:type.value==='income'?'暂无收入数据':'暂无支出数据',fill:'#64748b'}}}),
    }));
    return ()=>h('section',{class:'statistics-finance-group', 'aria-label':'收支科目占比'},[
      h('div',{class:'statistics-finance-controls'},[
        ...[['expense','支出'],['income','收入']].map(([value,label])=>h('button',{type:'button',class:type.value===value?'active':'',onClick:()=>{type.value=value;},'aria-pressed':type.value===value},label)),
        h('label',{},['展示方式 ',h('select',{'aria-label':'统计科目展示方式',value:mode.value,onChange:event=>{mode.value=event.target.value;}},[['auto','自动'],['summary','汇总大类'],['detail','具体科目']].map(([value,label])=>h('option',{value},label)))]),
      ]),
      createVNode(ChartCard,{title:`📂 ${type.value==='income'?'收入':'支出'}类别占比 · ${data.value.mode==='summary'?'汇总大类':'具体科目'}`,domId:'chartFinanceBars',option:option.value}),
    ]);
  };
}
