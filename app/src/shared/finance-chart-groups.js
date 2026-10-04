(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.CommunityFinanceChartGroups = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Display groups never rewrite the category stored on a ledger record.
  const definitions = {
    income: [
      ['补偿', /补偿|赔偿|征收|征地/u],
      ['捐赠', /捐赠|捐款|捐助/u],
      ['拨款与补助', /拨款|补助|补贴|经费|帮扶资金|工资.*收入|社保.*收入/u],
      ['经营与租赁', /经营|租赁|租金|承包|土地流转|利息/u],
      ['服务与管理', /管理费|物业|劳务|服务费|施工费|清表|会费/u],
    ],
    expense: [
      ['补偿', /补偿|赔偿/u],
      ['环境管护', /垃圾|清运|保洁|绿化|环境|除雪|防尘|清淤/u],
      ['工程建设', /工程|施工|排涝|排水|改造|土方|拆除|道路|安装|机械作业|设施.*维护|维修/u],
      ['人员与劳务', /工资|社保|报酬|劳务|福利|体检/u],
      ['办公与日常', /办公|饮用水|桶装水|瓶装水|日用品|通信|差旅|诉讼|评估|工作餐|记账|租车|运输|家具|设备|灯具|宣传|摄影|租金|土地流转/u],
      ['公共服务', /水电费|(?:^|[,，；、\s])(?:水费|电费)(?:[,，；、\s]|$)|公益|慰问|帮扶|文化活动|图书/u],
    ],
  };
  const generic = /^(?:其他收入|其他支出|未分类|未归类|办公支出|工程建设|环境整治|公益支出|维修维护|集体经营收入|上级拨款|补贴资金)$/u;
  function groupFor(type, category, summary = '') {
    const name = String(category || '').trim();
    const match = text => definitions[type]?.find(([, pattern]) => pattern.test(text))?.[0];
    if (!generic.test(name)) {
      const specific = match(name);
      if (specific) return specific;
    }
    // Only explicit purposes in the summary can refine a broad category.
    const purpose = match(String(summary || '').replace(/^(?:收|付|支出|收入)\s*[:：]?\s*/u, ''));
    if (purpose) return purpose;
    return match(name) || (/^其他(?:收入|支出)$/u.test(name) ? '其他' : '未归类');
  }
  function chartCategories(report = {}, { type = 'expense', mode = 'auto' } = {}) {
    const details = (report.categories || []).filter(item => item.type === type && item.amountCents > 0);
    const start = new Date(`${report.startDate}T00:00:00Z`);
    const threeMonths = new Date(start); threeMonths.setUTCMonth(start.getUTCMonth() + 3);
    const longPeriod = new Date(`${report.endDate}T00:00:00Z`) > threeMonths;
    const resolvedMode = mode === 'summary' || mode === 'auto' && (details.length > 12 || longPeriod && details.length > 8) ? 'summary' : 'detail';
    if (resolvedMode === 'detail') return { mode: resolvedMode, parts: details.map(item => ({ ...item, categories: [item.category] })) };
    const groups = new Map();
    function add(type, category, summary, amountCents, count, id) {
      const label = groupFor(type, category, summary);
      const group = groups.get(label) || { type, category: label, grouped: true, amountCents: 0, count: 0, categories: new Set(), recordIds: [] };
      group.amountCents += amountCents; group.count += count; group.categories.add(category);
      if (id != null) group.recordIds.push(String(id));
      groups.set(label, group);
    }
    if (Array.isArray(report.records) && report.records.length) {
      for (const row of report.records) {
        const rowType = row.recordType || row.type;
        const amount = Number.isSafeInteger(row.amountCents) ? row.amountCents : Math.round(Number(row.amount || 0) * 100);
        if (rowType === type && Number.isSafeInteger(amount) && amount > 0) add(type, String(row.category || '').trim() || '未分类', row.summary, amount, 1, row.id);
      }
    } else for (const item of details) add(type, item.category, '', item.amountCents, item.count, null);
    return { mode: resolvedMode, parts: [...groups.values()].map(item => ({ ...item, categories: [...item.categories] }))
      .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category, 'zh-CN')) };
  }
  return { groupFor, chartCategories };
}));
