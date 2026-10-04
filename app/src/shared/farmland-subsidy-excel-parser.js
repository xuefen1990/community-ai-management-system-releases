'use strict';

(function exposeFarmlandSubsidyExcelParser(root) {
  const text = (value) => String(value ?? '').trim();
  const normalized = (value) => text(value).replace(/[\s_（）()\-:：\n]/gu, '').toLowerCase();
  const number = (value) => {
    const parsed = Number(text(value).replace(/[￥¥元亩,，\s]/gu, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const findColumn = (row, aliases) => (row || []).findIndex((cell) => aliases.some((alias) => normalized(cell) === normalized(alias)));
  const findHeader = (grid, needed, required = ['name', 'amount']) => {
    for (let rowIndex = 0; rowIndex < Math.min((grid || []).length, 12); rowIndex += 1) {
      const map = {}; for (const [key, aliases] of Object.entries(needed)) { const index = findColumn(grid[rowIndex], aliases); if (index >= 0) map[key] = index; }
      if (required.every((key) => map[key] !== undefined)) return { rowIndex, map };
    }
    return null;
  };
  const footer = (row) => /^(合计|总计|制表|审核|填表|说明)/u.test(text(row?.[0]));

  function parsePaymentGrid(grid, cadreNames = new Set()) {
    const header = findHeader(grid, {
      name: ['户主姓名', '姓名'], idCard: ['身份证号', '身份证'], bankName: ['开户行'], bankCard: ['一卡通号', '卡号', '银行账号'], phone: ['联系电话', '手机号码', '手机号', '联系电话手机号'],
      village: ['村'], groupName: ['村民组', '组别'], eligibleArea: ['应享受补贴面积（亩）', '应享受补贴面积', '补贴依据面积（亩）'], standard: ['补贴标准（元/亩）', '补贴标准'], amount: ['补贴金额（元）', '补贴金额', '金额'], remark: ['备注'],
    });
    if (!header) throw new Error('未识别到地力补贴兑付清册表头');
    const records = [];
    for (let index = header.rowIndex + 1; index < grid.length; index += 1) {
      const row = grid[index] || []; if (!row.some((cell) => text(cell)) || footer(row)) continue;
      const get = (key) => header.map[key] === undefined ? '' : row[header.map[key]];
      const name = text(get('name')); if (!name) continue;
      records.push({ name, idCard: text(get('idCard')), bankName: text(get('bankName')), bankCard: text(get('bankCard')).replace(/[\s-]/gu, ''), phone: text(get('phone')).replace(/[\s-]/gu, ''), villageName: text(get('village')), groupName: text(get('groupName')), eligibleArea: number(get('eligibleArea')), ownershipArea: number(get('eligibleArea')), standard: number(get('standard')), amount: number(get('amount')), remark: text(get('remark')), category: cadreNames.has(name) ? 'village_cadre' : 'household', sourceRowNumber: index + 1 });
    }
    if (!records.length) throw new Error('地力补贴兑付清册中没有可导入人员');
    return { records, headerRowNumber: header.rowIndex + 1 };
  }

  function parseCadreNames(grid) {
    const header = findHeader(grid, { name: ['户主姓名', '姓名'], amount: ['补贴金额（元）', '补贴金额', '金额'] });
    if (!header) return [];
    return grid.slice(header.rowIndex + 1).filter((row) => row?.some((cell) => text(cell)) && !footer(row)).map((row) => text(row[header.map.name])).filter(Boolean);
  }

  function parseContactRows(grid, sheetName) {
    const header = findHeader(grid, {
      name: ['户主姓名', '姓名'], idCard: ['身份证号', '身份证'], groupName: ['村民组', '组别'], phone: ['联系电话', '手机号码', '手机号', '联系电话手机号'],
    }, ['name', 'phone']);
    if (!header) return [];
    const get = (row, key) => header.map[key] === undefined ? '' : row[header.map[key]];
    return grid.slice(header.rowIndex + 1).filter((row) => row?.some((cell) => text(cell)) && !footer(row)).map((row) => ({
      name: text(get(row, 'name')), idCard: text(get(row, 'idCard')).replace(/\s/gu, '').toUpperCase(), groupName: text(get(row, 'groupName')), phone: text(get(row, 'phone')).replace(/[\s-]/gu, ''), sheetName,
    })).filter((row) => row.name && row.phone);
  }

  function enrichRecordsFromAttachments(records, sheets, paymentName) {
    const allContacts = Object.entries(sheets).filter(([name]) => name !== paymentName).flatMap(([name, grid]) => parseContactRows(grid, name));
    const warnings = [];
    for (const contact of allContacts) {
      const idMatches = contact.idCard ? records.filter((record) => text(record.idCard).replace(/\s/gu, '').toUpperCase() === contact.idCard) : [];
      const groupMatches = !contact.idCard && contact.groupName ? records.filter((record) => record.name === contact.name && record.groupName === contact.groupName) : [];
      const matches = idMatches.length ? idMatches : groupMatches;
      if (matches.length !== 1) { warnings.push({ sheetName: contact.sheetName, name: contact.name, groupName: contact.groupName, reason: matches.length ? '附件资料匹配到多名人员' : '附件资料未匹配到主表人员' }); continue; }
      const record = matches[0];
      if (!record.phone) record.phone = contact.phone;
      else if (record.phone !== contact.phone) warnings.push({ sheetName: contact.sheetName, name: contact.name, groupName: contact.groupName, reason: '附件联系电话与主表不一致' });
    }
    return { records, warnings };
  }

  function parseFarmlandSubsidyWorkbook(sheets = {}) {
    const paymentName = Object.keys(sheets).find((name) => /兑付清册/u.test(name));
    if (!paymentName) throw new Error('未找到“地力补贴兑付清册”工作表');
    const cadreName = Object.keys(sheets).find((name) => /附件\s*1-4/u.test(name));
    const cadreNames = new Set(cadreName ? parseCadreNames(sheets[cadreName]) : []);
    const result = parsePaymentGrid(sheets[paymentName], cadreNames);
    const enriched = enrichRecordsFromAttachments(result.records, sheets, paymentName);
    return { ...result, records: enriched.records, warnings: enriched.warnings, paymentSheetName: paymentName, cadreSheetName: cadreName || '', sheetNames: Object.keys(sheets) };
  }

  const api = { parsePaymentGrid, parseCadreNames, parseContactRows, enrichRecordsFromAttachments, parseFarmlandSubsidyWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FarmlandSubsidyExcelParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
