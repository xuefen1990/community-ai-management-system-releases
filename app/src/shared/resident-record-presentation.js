(function exposeResidentRecordPresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ResidentRecordPresentation = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const sourceNames = {
    farmland_subsidy_import: '土地补贴导入',
    disbursement_import: '发放记录导入',
    resident_profile: '居民档案',
    resident_profile_edit: '居民资料编辑',
  };

  const statusNames = {
    paid: '已发放',
    completed: '已完成',
    pending: '未发放',
    failed: '未执行',
    cancelled: '已取消',
    undone: '已撤销',
  };

  const operationNames = {
    resident_phone_update: '修改联系电话',
    resident_address_update: '修改家庭地址',
    resident_group_update: "调整居民组",
    resident_profile_update: '更新居民资料',
    disbursement_import: '导入发放记录',
    farmland_subsidy_import: '导入土地补贴记录',
  };

  const text = (value) => String(value ?? '').trim();

  function dateLabel(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const raw = text(value);
    if (!raw) return '未填写';

    const match = raw.match(/((?:19|20)\d{2})[^0-9]?(\d{1,2})[^0-9]?(\d{1,2})/u);
    if (!match) return raw.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  function sourceLabel(value) {
    const raw = text(value);
    if (sourceNames[raw]) return sourceNames[raw];
    if (raw.startsWith('workbench-')) return '工作台发放';
    if (raw.startsWith('template-disbursement-batch-')) return '模板发放';
    return raw ? '其他来源' : '居民档案';
  }

  function sourceDetail(value) {
    return text(value) || '未记录原始来源';
  }

  function paymentStatusLabel(value) {
    const raw = text(value);
    return statusNames[raw] || (raw ? raw : '未填写');
  }

  function paymentItemLabel(item) {
    const value = item || {};
    const category = text(value.categoryName || value.category);
    const detail = text(value.workItem || value.role || value.responsibilityArea || value.remark || value.period);
    return [category, detail].filter(Boolean).join(' · ') || '其他发放';
  }

  function accountLabel(item) {
    const value = item || {};
    const bank = text(value.bankName || value.bank);
    const card = text(value.bankCard || value.cardNumber).replace(/[\s-]/gu, '');
    return card ? `${bank || '收款账户'} · 尾号${card.slice(-4)}` : '未设置';
  }

  function operationLabel(item) {
    const value = item || {};
    const type = text(value.type);
    return operationNames[type] || text(value.action) || '资料更新';
  }

  function operationResultLabel(item) {
    const raw = text(item?.status);
    return statusNames[raw] || (raw ? raw : '已完成');
  }

  function batchLabel(value) {
    const raw = text(value);
    if (raw.startsWith('workbench-')) return '工作台发放';
    if (raw.startsWith('template-disbursement-batch-')) return '模板发放';
    return raw ? '历史发放批次' : '未记录批次';
  }

  return {
    dateLabel,
    sourceLabel,
    sourceDetail,
    paymentStatusLabel,
    paymentItemLabel,
    accountLabel,
    operationLabel,
    operationResultLabel,
    batchLabel,
  };
});
