'use strict';

(function registerWorkManagementModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WorkManagementModel = api;
}(typeof window === 'undefined' ? null : window, () => {
  const WORK_STATUSES = Object.freeze(['未开始', '进行中', '已完成', '已归档']);
  const RESOURCE_CATEGORIES = Object.freeze(['人员', '机械', '材料', '车辆']);

  function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function roundMoney(value) {
    return Math.round((numeric(value) + Number.EPSILON) * 100) / 100;
  }

  function dayKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('日期无效');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  function createWorkNumber(workItems, date = new Date()) {
    const prefix = `GZ-${dayKey(date)}-`;
    const largestSequence = (Array.isArray(workItems) ? workItems : [])
      .map((item) => String(item?.number || ''))
      .filter((number) => number.startsWith(prefix))
      .map((number) => Number(number.slice(prefix.length)))
      .filter(Number.isInteger)
      .reduce((largest, sequence) => Math.max(largest, sequence), 0);
    return `${prefix}${String(largestSequence + 1).padStart(3, '0')}`;
  }

  function calculateResourceAmount(entry = {}) {
    const hasFormula = entry.quantity !== '' && entry.quantity !== undefined
      && entry.unitPrice !== '' && entry.unitPrice !== undefined;
    if (!hasFormula) return roundMoney(entry.amount);
    const quantity = numeric(entry.quantity);
    const duration = entry.duration === '' || entry.duration === undefined ? 1 : numeric(entry.duration);
    return roundMoney(quantity * duration * numeric(entry.unitPrice));
  }

  function getWorkTotal(entries, workId) {
    return roundMoney((Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.workId === workId)
      .reduce((total, entry) => total + calculateResourceAmount(entry), 0));
  }

  function summarizeResources(entries, workId) {
    const totals = Object.fromEntries(RESOURCE_CATEGORIES.map((category) => [category, 0]));
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry.workId !== workId) continue;
      const category = RESOURCE_CATEGORIES.includes(entry.category) ? entry.category : '材料';
      totals[category] = roundMoney(totals[category] + calculateResourceAmount(entry));
    }
    return { ...totals, total: roundMoney(Object.values(totals).reduce((sum, value) => sum + value, 0)) };
  }

  function validateWork(work = {}) {
    const errors = {};
    for (const [field, label] of Object.entries({
      name: '工作名称', type: '工作类型', location: '地点', startDate: '开始日期', responsiblePerson: '责任人',
    })) {
      if (!String(work[field] || '').trim()) errors[field] = `${label}不能为空`;
    }
    if (work.startDate && work.plannedEndDate && work.plannedEndDate < work.startDate) {
      errors.plannedEndDate = '计划完成日期不能早于开始日期';
    }
    return errors;
  }

  function validateTransition(work = {}, targetStatus, acceptance) {
    if (!WORK_STATUSES.includes(targetStatus)) return '状态无效';
    if (work.status === '已归档' && targetStatus !== '进行中') return '已归档工作需先取消归档';
    if (targetStatus === '已完成') {
      const errors = validateWork(work);
      if (Object.keys(errors).length) return '请先补齐基本信息';
      if (!String(acceptance?.conclusion || '').trim()) return '请先填写验收结论';
    }
    if (targetStatus === '已归档' && work.status !== '已完成') return '只有已完成的工作可以归档';
    return null;
  }

  function isWorkReadyToArchive(work, acceptance) {
    return validateTransition(work, '已完成', acceptance) === null;
  }

  return {
    WORK_STATUSES,
    RESOURCE_CATEGORIES,
    roundMoney,
    dayKey,
    createWorkNumber,
    calculateResourceAmount,
    getWorkTotal,
    summarizeResources,
    validateWork,
    validateTransition,
    isWorkReadyToArchive,
  };
}));
