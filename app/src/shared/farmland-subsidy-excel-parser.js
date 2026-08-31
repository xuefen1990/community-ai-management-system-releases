'use strict';

(function exposeFarmlandSubsidyExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalized = (value) => text(value).replace(/[\s_（）()\-:：\n]/gu, '').toLowerCase();
  const number = (value) => {
    const parsed = Number(text(value).replace(/[￥¥元亩,，\s]/gu, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const findColumn = (row, aliases) => (row || []).findIndex((cell) => aliases.some((alias) => normalized(cell) === normalized(alias)));
  const findHeader = (grid, needed) => {
    for (let rowIndex = 0; rowIndex < Math.min((grid || []).length, 12); rowIndex += 1) {
      const map = {}; for (const [key, aliases] of Object.entries(needed)) { const index = findColumn(grid[rowIndex], aliases); if (index >= 0) map[key] = index; }
      if (map.name !== undefined && map.amount !== undefined) return { rowIndex, map };
    }
    return null;
  };
  const footer = (row) => /^(合计|总计|制表|审核|填表|说明)/u.test(text(row?.[0]));

  function parsePaymentGrid(grid, cadreNames = new Set()) {
    const header = findHeader(grid, {
      name: ['户主姓名', '姓名'], idCard: ['身份证号', '身份证'], bankName: ['开户行'], bankCard: ['一卡通号', '卡号', '银行账号'],
      village: ['村'], groupName: ['村民组', '组别'], eligibleArea: ['应享受补贴面积（亩）', '应享受补贴面积', '补贴依据面积（亩）'], standard: ['补贴标准（元/亩）', '补贴标准'], amount: ['补贴金额（元）', '补贴金额', '金额'], remark: ['备注'],
    });
    if (!header) throw new Error('未识别到地力补贴兑付清册表头');
    const records = [];
    for (let index = header.rowIndex + 1; index < grid.length; index += 1) {
      const row = grid[index] || []; if (!row.some((cell) => text(cell)) || footer(row)) continue;
      const get = (key) => header.map[key] === undefined ? '' : row[header.map[key]];
      const name = text(get('name')); if (!name) continue;
      records.push({ name, idCard: text(get('idCard')), bankName: text(get('bankName')), bankCard: text(get('bankCard')).replace(/[\s-]/gu, ''), villageName: text(get('village')), groupName: text(get('groupName')), eligibleArea: number(get('eligibleArea')), ownershipArea: number(get('eligibleArea')), standard: number(get('standard')), amount: number(get('amount')), remark: text(get('remark')), category: cadreNames.has(name) ? 'village_cadre' : 'household', sourceRowNumber: index + 1 });
    }
    if (!records.length) throw new Error('地力补贴兑付清册中没有可导入人员');
    return { records, headerRowNumber: header.rowIndex + 1 };
  }

  function parseCadreNames(grid) {
    const header = findHeader(grid, { name: ['户主姓名', '姓名'], amount: ['补贴金额（元）', '补贴金额', '金额'] });
    if (!header) return [];
    return grid.slice(header.rowIndex + 1).filter((row) => row?.some((cell) => text(cell)) && !footer(row)).map((row) => text(row[header.map.name])).filter(Boolean);
  }

  function parseFarmlandSubsidyWorkbook(sheets = {}) {
    const paymentName = Object.keys(sheets).find((name) => /兑付清册/u.test(name));
    if (!paymentName) throw new Error('未找到“地力补贴兑付清册”工作表');
    const cadreName = Object.keys(sheets).find((name) => /附件\s*1-4/u.test(name));
    const cadreNames = new Set(cadreName ? parseCadreNames(sheets[cadreName]) : []);
    const result = parsePaymentGrid(sheets[paymentName], cadreNames);
    return { ...result, paymentSheetName: paymentName, cadreSheetName: cadreName || '', sheetNames: Object.keys(sheets) };
  }

  const api = { parsePaymentGrid, parseCadreNames, parseFarmlandSubsidyWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FarmlandSubsidyExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
