'use strict';

function text(value) { return String(value ?? '').trim(); }

const TOOL_RULES = Object.freeze([
  { id: 'funds.pending-summary', pattern: /(待发|未发|尚未发).{0,12}(资金|款|承包费|补贴)|(资金|款|承包费|补贴).{0,12}(待发|未发|尚未发)/u, label: '查询待发资金' },
  { id: 'funds.paid-summary', pattern: /(资金|发放|承包费|补贴|实发|多少钱|金额)/u, label: '核对已发资金' },
  { id: 'land.resident-parcels-query', pattern: /(谁|居民|(?:村民|居民)|户|姓名).{0,12}(土地|地块|亩)|(土地|地块|亩).{0,12}(谁|居民|(?:村民|居民)|户|姓名)|(?:的|名下).{0,4}(土地|地块|承包地|亩数)/u, label: '核对居民土地' },
  { id: 'land.total-area-query', pattern: /(土地|地块|亩数|面积)/u, label: '统计土地面积' },
  { id: 'contract.expiry-query', pattern: /(合同).{0,10}(到期|期限)|(到期).{0,10}(合同)/u, label: '查询到期合同' },
  { id: 'contract.receipt-query', pattern: /(合同|承包人).{0,10}(到账|缴费|收款)/u, label: '核对合同到账' },
  { id: 'certificate.history-query', pattern: /(证明|开具记录)/u, label: '查询证明记录' },
  { id: 'resident.relationship-query', pattern: /(关系|亲属|同户)/u, label: '核对家庭关系' },
  { id: 'resident.overview', pattern: /(居民|(?:村民|居民)|档案|基本情况)/u, label: '查询居民档案' },
  { id: 'party.member-query', pattern: /(党员|党内)/u, label: '查询党员资料' },
  { id: 'finance.summary-query', pattern: /(财务|收入|支出|结余)/u, label: '统计财务收支' },
  { id: 'work.status-query', pattern: /(工作事项|待办|进行中|已完成工作)/u, label: '查询工作事项' },
  { id: 'document.final-query', pattern: /(公文|定稿)/u, label: '查询公文' },
]);

class AiTaskPlanner {
  constructor({ registry } = {}) { this.registry = registry; }

  plan(request) {
    const requested = text(request);
    if (/(?:^|[；;，,。\s])(?:新增|新建|登记|修改|更改|删除|清空|恢复|停用|移除|归档)[^？?]*(?:[：:]|=)/u.test(requested)) return null;
    const available = new Set(this.registry?.list?.().map(tool => tool.id) || []);
    const matched = [];
    for (const rule of TOOL_RULES) {
      const position = requested.search(rule.pattern);
      if (position >= 0 && available.has(rule.id) && !matched.some(item => item.id === rule.id)) matched.push({ ...rule, position });
    }
    matched.sort((left, right) => left.position - right.position);
    const complexSignal = /(同时|并且|然后|再|以及|分别|汇总|核对|异常|导出|生成.{0,6}表)/u.test(requested);
    if (!complexSignal || matched.length < 2) return null;
    const steps = matched.map((rule, index) => ({
      id: `step-${index + 1}`,
      title: rule.label,
      toolId: rule.id,
      status: 'pending',
      resultSummary: '',
    }));
    return {
      title: requested.slice(0, 48),
      originalRequest: requested,
      clarifiedRequest: requested,
      status: 'pending',
      steps,
      requestedExport: /(导出|生成.{0,6}表)/u.test(requested),
      modelTier: 'deep',
      tokenStatus: 'local-first',
    };
  }
}

module.exports = { AiTaskPlanner, TOOL_RULES };
