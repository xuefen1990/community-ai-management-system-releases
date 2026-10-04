'use strict';

const crypto = require('node:crypto');
const { normalizeIdCard, isValidIdCard } = require('../shared/personnel-excel-parser');
const contractModel = require('../shared/contract-fee-model');

function list(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? '').trim(); }
function moneyCents(item = {}) {
  for (const key of ['finalAmountCents', 'amountCents', 'actualAmountCents', 'allocatedAmountCents']) {
    if (Number.isFinite(Number(item[key]))) return Math.round(Number(item[key]));
  }
  for (const key of ['finalAmount', 'amount', 'actualAmount', 'allocatedAmount']) {
    if (Number.isFinite(Number(item[key]))) return Math.round(Number(item[key]) * 100);
  }
  return 0;
}
function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20); }
function finding(rule, subjectKey, title, summary, evidence, source = {}) {
  const key = `${rule}:${subjectKey}`;
  return { key, rule, title, summary, evidence, evidenceHash: stableHash(evidence), source, severity: source.severity || 'warning' };
}
function personName(person) { return text(person.name || person.residentName || person.person_name) || '未命名居民'; }
function activeCards(person) {
  const accounts = contractModel.bankAccounts(person).filter(contractModel.isCurrentBankAccount);
  return [...new Set(accounts.map(item => contractModel.normalizeBankCard(item.cardNumber)).filter(Boolean))];
}
function scanPersonnel(database) {
  const findings = [];
  const byIdentity = new Map();
  const cardOwners = new Map();
  for (const person of list(database.personnel)) {
    const id = text(person.id || person.personId || person.idCard || person.id_card);
    const name = personName(person);
    const identity = normalizeIdCard(person.idCard || person.id_card);
    if (!identity) findings.push(finding('resident-id-missing', id, `${name}缺少身份证号`, '居民档案缺少身份证号，需要人工补充或确认不适用', [{ label: '居民', value: name }], { module: 'personnel', recordId: id }));
    else if (!isValidIdCard(identity)) findings.push(finding('resident-id-invalid', id, `${name}身份证号格式异常`, '身份证号位数、出生日期或校验码不符合规则', [{ label: '身份证号', value: identity }], { module: 'personnel', recordId: id, severity: 'high' }));
    else {
      const group = byIdentity.get(identity) || [];
      group.push({ id, name }); byIdentity.set(identity, group);
    }
    const cards = activeCards(person);
    if (cards.length > 1) findings.push(finding('resident-multiple-cards', id, `${name}有多张在用收款卡`, '请核对默认收款卡和其他在用卡是否都应保留', cards.map(value => ({ label: '银行卡号', value })), { module: 'personnel', recordId: id }));
    for (const card of cards) { const owners = cardOwners.get(card) || []; owners.push({ id, name }); cardOwners.set(card, owners); }
  }
  for (const [identity, people] of byIdentity) if (people.length > 1) findings.push(finding('resident-id-duplicate', identity, '多个居民使用同一身份证号', '同一身份证号关联了多份居民档案，请人工核对是否重复建档', people.map(item => ({ label: item.name, value: identity })), { module: 'personnel', severity: 'high' }));
  for (const [card, people] of cardOwners) if (people.length > 1) findings.push(finding('shared-bank-card', card, '多人共用同一张银行卡', '系统只提示核对，不会合并居民或修改银行卡', people.map(item => ({ label: item.name, value: card })), { module: 'personnel' }));
  return findings;
}
function declaredBatchCents(batch) {
  for (const key of ['totalAmountCents', 'totalCents', 'expectedAmountCents', 'allocatedAmountCents']) if (Number.isFinite(Number(batch[key]))) return Math.round(Number(batch[key]));
  for (const key of ['totalAmount', 'expectedAmount', 'allocatedAmount']) if (Number.isFinite(Number(batch[key]))) return Math.round(Number(batch[key]) * 100);
  return null;
}
function scanBatches(database) {
  const findings = [];
  for (const [collection, label, module] of [['disbursementBatches', '发放批次', 'disbursement'], ['contractFeeBatches', '承包费批次', 'contract-fee']]) {
    for (const batch of list(database[collection])) {
      const declared = declaredBatchCents(batch);
      const items = list(batch.items || batch.rows || batch.records);
      if (declared === null || !items.length) continue;
      const detail = items.reduce((total, item) => total + moneyCents(item), 0);
      if (declared !== detail) findings.push(finding(`${module}-total-mismatch`, text(batch.id), `${label}汇总金额与明细不一致`, `汇总金额与逐户明细相差 ¥${(Math.abs(declared - detail) / 100).toFixed(2)}`, [
        { label: '批次', value: text(batch.title || batch.name || batch.categoryName || batch.contractName || batch.period || batch.id) },
        { label: '汇总金额', value: `¥${(declared / 100).toFixed(2)}` }, { label: '明细合计', value: `¥${(detail / 100).toFixed(2)}` },
      ], { module, recordId: batch.id, severity: 'high' }));
    }
  }
  return findings;
}
function scanContracts(database, now) {
  const findings = [];
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const contract of [...list(database.resourceContracts), ...list(database.landParcel)]) {
    const endDate = text(contract.endDate || contract.contractEnd || contract.contract_end);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(endDate) || endDate > soon) continue;
    const expired = endDate < today;
    findings.push(finding(expired ? 'contract-expired' : 'contract-expiring', text(contract.id || `${contract.name}-${endDate}`),
      `${text(contract.name || contract.contractName || contract.parcel_name) || '合同'}${expired ? '已到期' : '即将到期'}`,
      expired ? '请核对续签、收回或归档状态' : '合同将在 60 天内到期，请提前办理', [{ label: '到期日期', value: endDate }],
      { module: 'land', recordId: contract.id, severity: expired ? 'high' : 'warning' }));
  }
  return findings;
}
function scanTemplates(database) {
  const findings = [];
  for (const template of list(database.certificateTemplates)) {
    if (template.enabled === false || template.status === 'disabled') continue;
    const body = text(template.content || template.body || template.contentText);
    const fields = list(template.fields || template.variables);
    const missing = fields.filter(field => field.required !== false).filter(field => {
      const label = text(field.label || field.name || field.key);
      const key = text(field.key);
      return label && !body.includes(`{${label}}`) && (!key || !body.includes(`{${key}}`));
    });
    if (missing.length) findings.push(finding('certificate-template-fields', text(template.id), `${text(template.name) || '证明模板'}缺少字段占位`, '必填字段没有放入证明正文，开具时可能无法显示', missing.map(field => ({ label: '缺少字段', value: text(field.label || field.name || field.key) })), { module: 'certificate', recordId: template.id }));
  }
  return findings;
}
function scanImports(database) {
  const findings = [];
  for (const entry of list(database.aiFileIndexEntries)) {
    const report = entry.importReport || {};
    const count = Number(report.conflictRows || report.failedRows || 0);
    const keyWarnings = list(entry.warnings).filter(value => /重复|缺少|冲突|未识别/u.test(text(value)));
    if (!count && !keyWarnings.length) continue;
    findings.push(finding('import-file-review', text(entry.id), `${text(entry.fileName) || '导入文件'}存在待核对项`, '导入中的重复人员、冲突或关键字段缺失不会被自动覆盖', [
      ...(count ? [{ label: '冲突或失败', value: `${count} 条` }] : []), ...keyWarnings.map(value => ({ label: '识别提示', value: text(value) })),
    ], { module: 'ai-files', recordId: entry.id }));
  }
  return findings;
}

class AiAnomalyService {
  constructor({ databaseStore, now = () => new Date() } = {}) {
    if (!databaseStore?.read || !databaseStore?.update) throw new TypeError('databaseStore is required');
    this.databaseStore = databaseStore; this.now = now;
  }
  detect(database) { return [...scanPersonnel(database), ...scanBatches(database), ...scanContracts(database, this.now()), ...scanTemplates(database), ...scanImports(database)]; }
  async scan() {
    const database = await this.databaseStore.read();
    const detected = this.detect(database);
    const scannedAt = this.now().toISOString();
    const outcome = await this.databaseStore.update(draft => {
      const previous = new Map(list(draft.aiAnomalyFindings).map(item => [item.key, item]));
      const activeKeys = new Set();
      for (const candidate of detected) {
        activeKeys.add(candidate.key);
        const existing = previous.get(candidate.key);
        const unchanged = existing?.evidenceHash === candidate.evidenceHash;
        const next = { ...candidate, id: existing?.id || `anomaly-${stableHash(candidate.key)}`, status: unchanged ? (existing.status || 'open') : 'open',
          note: unchanged ? text(existing.note) : '', createdAt: existing?.createdAt || scannedAt, lastSeenAt: scannedAt, updatedAt: scannedAt };
        previous.set(candidate.key, next);
      }
      for (const [key, existing] of previous) if (!activeKeys.has(key) && existing.status === 'open') previous.set(key, { ...existing, status: 'resolved', resolvedAutomatically: true, updatedAt: scannedAt });
      draft.aiAnomalyFindings = [...previous.values()];
      draft.aiAnomalyScan = { lastScannedAt: scannedAt, detectedCount: detected.length };
      return { findings: draft.aiAnomalyFindings, scan: draft.aiAnomalyScan };
    });
    return { ok: true, ...outcome.result };
  }
  async list({ status = 'open' } = {}) {
    const database = await this.databaseStore.read();
    const findings = list(database.aiAnomalyFindings).filter(item => !status || item.status === status)
      .sort((left, right) => text(right.lastSeenAt).localeCompare(text(left.lastSeenAt)));
    return { findings, scan: database.aiAnomalyScan || null };
  }
  async update({ id, status, note = '' } = {}) {
    if (!['open', 'ignored', 'resolved', 'not-applicable'].includes(status)) throw new Error('异常处理状态不正确');
    const outcome = await this.databaseStore.update(draft => {
      const item = list(draft.aiAnomalyFindings).find(row => row.id === text(id));
      if (!item) throw new Error('没有找到该核对建议');
      Object.assign(item, { status, note: text(note), updatedAt: this.now().toISOString(), resolvedAutomatically: false });
      return item;
    });
    return { ok: true, finding: outcome.result };
  }
}

module.exports = { AiAnomalyService, scanPersonnel, scanBatches, scanContracts, scanTemplates, scanImports, moneyCents };
