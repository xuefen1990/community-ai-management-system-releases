'use strict';

(function exposeContractFeeModel(root) {
  const text = (value) => String(value ?? '').trim();
  const nowIso = (now) => (typeof now === 'string' ? now : (now instanceof Date ? now : new Date()).toISOString());
  const identifier = (prefix, now = Date.now()) => `${prefix}-${Number(now)}-${Math.random().toString(36).slice(2, 9)}`;

  function amountToCents(value) {
    const cleaned = text(value).replace(/[￥¥元,，\s]/gu, '');
    if (!cleaned) return 0;
    const amount = Number(cleaned);
    if (!Number.isFinite(amount)) throw new TypeError(`金额格式无效：${value}`);
    return Math.round(amount * 100);
  }

  function centsToYuan(value) { return (Number(value || 0) / 100).toFixed(2); }
  function numberValue(value) {
    const cleaned = text(value).replace(/[,，\s人口亩]/gu, '');
    const result = Number(cleaned || 0);
    if (!Number.isFinite(result)) throw new TypeError(`数值格式无效：${value}`);
    return result;
  }

  function normalizeBankCard(value) { return text(value).replace(/[\s-]/gu, ''); }
  function personName(person) { return text(person?.name || person?.person_name || person?.resident_name); }
  function personGroup(person) { return text(person?.village_group || person?.villageGroup || person?.group || person?.group_name); }
  function personStatus(person) { return text(person?.status || person?.registry_status || person?.registryStatus); }
  function personId(person) { return text(person?.id || person?.personId || person?.id_card || person?.idCard); }

  function bankAccounts(person) {
    const accounts = Array.isArray(person?.bankAccounts) ? person.bankAccounts.filter((item) => normalizeBankCard(item?.cardNumber)) : [];
    if (accounts.length) return accounts;
    const legacy = normalizeBankCard(person?.bank_card || person?.bank_account || person?.bankCard);
    return legacy ? [{ id: `legacy-${legacy}`, cardNumber: legacy, isDefault: true, source: 'legacy' }] : [];
  }

  function defaultBankCard(person) {
    const accounts = bankAccounts(person);
    return normalizeBankCard(accounts.find((item) => item.isDefault)?.cardNumber || accounts[0]?.cardNumber);
  }

  function setDefaultBankCard(person, cardNumber, { source = 'contract-fee-import', now = new Date() } = {}) {
    const card = normalizeBankCard(cardNumber);
    if (!card) return { person, changed: false, previousCard: defaultBankCard(person), nextCard: '' };
    const updatedAt = nowIso(now);
    const previousCard = defaultBankCard(person);
    const accounts = bankAccounts(person).map((item) => ({ ...item, isDefault: normalizeBankCard(item.cardNumber) === card }));
    let account = accounts.find((item) => normalizeBankCard(item.cardNumber) === card);
    if (!account) {
      account = { id: identifier('bank-account', now instanceof Date ? now.getTime() : Date.now()), cardNumber: card, isDefault: true, source, createdAt: updatedAt, updatedAt };
      accounts.push(account);
    } else account.updatedAt = updatedAt;
    accounts.forEach((item) => { item.isDefault = item === account; });
    person.bankAccounts = accounts;
    person.bank_card = card;
    person.bank_account = card;
    person.bankCard = card;
    person.updated_at = updatedAt;
    return { person, changed: previousCard !== card, previousCard, nextCard: card };
  }

  function calculateAmount({ calculationType = 'direct', quantity = 0, unitPrice = 0, directAmount = 0 } = {}) {
    if (calculationType === 'direct') return amountToCents(directAmount);
    if (!['population', 'acreage'].includes(calculationType)) throw new TypeError('不支持的计算方式');
    return Math.round(numberValue(quantity) * amountToCents(unitPrice));
  }

  function matchImportedRows({ rows = [], personnel = [], selectedGroups = [], resolutions = {} } = {}) {
    const groupSet = new Set(selectedGroups.map(text).filter(Boolean));
    const candidates = personnel.filter((person) => groupSet.has(personGroup(person)));
    return rows.map((row, index) => {
      const rowId = text(row.id) || `import-row-${index + 1}`;
      const resolvedId = text(resolutions[rowId]);
      const resolved = resolvedId && candidates.find((person) => personId(person) === resolvedId);
      const matches = candidates.filter((person) => personName(person) === text(row.name));
      const person = resolved || (matches.length === 1 ? matches[0] : null);
      return {
        ...row,
        id: rowId,
        matchStatus: person ? 'matched' : (matches.length > 1 ? 'ambiguous' : 'missing'),
        person: person || null,
        candidates: matches,
        groupName: person ? personGroup(person) : '',
        existingBankCard: person ? defaultBankCard(person) : '',
        bankCardConflict: Boolean(person && defaultBankCard(person) && normalizeBankCard(row.bankCard) && defaultBankCard(person) !== normalizeBankCard(row.bankCard)),
      };
    });
  }

  function ledgerItemFromMatch(match, now = new Date(), requestedCalculationType = '') {
    if (!match?.person) throw new Error('发放台账存在未匹配居民');
    const population = numberValue(match.population);
    const acreage = numberValue(match.acreage);
    const unitPrice = text(match.unitPrice);
    let calculationType = requestedCalculationType || 'direct'; let quantity = 0;
    if (calculationType === 'population') {
      if (population <= 0) throw new Error(`${personName(match.person)}缺少人口数据，不能按人口分配`);
      quantity = population;
    } else if (calculationType === 'acreage') {
      if (acreage <= 0) throw new Error(`${personName(match.person)}缺少亩数数据，不能按亩数分配`);
      quantity = acreage;
    } else if (population > 0) { calculationType = 'population'; quantity = population; }
    else if (acreage > 0) { calculationType = 'acreage'; quantity = acreage; }
    const calculatedAmountCents = calculateAmount({ calculationType, quantity, unitPrice, directAmount: match.amount });
    const importedAmountCents = amountToCents(match.amount);
    return {
      id: identifier('contract-fee-item', now instanceof Date ? now.getTime() : Date.now()),
      personId: personId(match.person),
      name: personName(match.person),
      groupName: personGroup(match.person),
      calculationType,
      quantity,
      unitPriceCents: amountToCents(unitPrice),
      calculatedAmountCents,
      plannedAmountCents: importedAmountCents || calculatedAmountCents,
      bankCard: normalizeBankCard(match.bankCard) || defaultBankCard(match.person),
      active: true,
      sourceRowNumber: match.sourceRowNumber || null,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    };
  }

  function createContract(value, { now = new Date(), id } = {}) {
    if (!text(value?.name)) throw new Error('请填写合同名称');
    if (!text(value?.startDate) || !text(value?.endDate)) throw new Error('请填写完整合同期限');
    if (String(value.endDate) < String(value.startDate)) throw new Error('合同结束日期不能早于开始日期');
    return {
      id: id || identifier('resource-contract', now instanceof Date ? now.getTime() : Date.now()),
      name: text(value.name), contractNumber: text(value.contractNumber), contractorName: text(value.contractorName),
      resourceType: text(value.resourceType) || '土地', amountCents: amountToCents(value.amount),
      startDate: text(value.startDate), endDate: text(value.endDate), landParcelIds: [...new Set((value.landParcelIds || []).map(text).filter(Boolean))],
      notes: text(value.notes), attachments: Array.isArray(value.attachments) ? value.attachments : [], status: 'active',
      createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function createLedger({ contractId, matches, source = {}, calculationType = '' }, { now = new Date(), id } = {}) {
    if (!text(contractId)) throw new Error('必须选择对应合同');
    if (calculationType && !['population', 'acreage'].includes(calculationType)) throw new Error('承包费分配方式只能选择按人口或按亩数');
    const items = matches.map((match) => ledgerItemFromMatch(match, now, calculationType));
    if (!items.length) throw new Error('台账中至少需要一名居民');
    return {
      id: id || identifier('contract-fee-ledger', now instanceof Date ? now.getTime() : Date.now()), contractId: text(contractId),
      calculationType: calculationType || '', items, source: { fileName: text(source.fileName), sheetName: text(source.sheetName), importedAt: nowIso(now) },
      createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function copyLedger(ledger, newContractId, { now = new Date(), id } = {}) {
    const copied = structuredClone(ledger);
    copied.id = id || identifier('contract-fee-ledger', now instanceof Date ? now.getTime() : Date.now());
    copied.contractId = text(newContractId);
    copied.copiedFromLedgerId = ledger.id;
    copied.items = copied.items.map((item, index) => ({ ...item, id: `${copied.id}-item-${index + 1}`, createdAt: nowIso(now), updatedAt: nowIso(now) }));
    copied.createdAt = nowIso(now); copied.updatedAt = nowIso(now);
    return copied;
  }

  function replaceLedgerPerson(ledger, itemId, person, reason, { now = new Date() } = {}) {
    if (!text(reason)) throw new Error('更换领取人必须填写原因');
    const next = structuredClone(ledger);
    const item = next.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error('未找到台账居民');
    item.personId = personId(person); item.name = personName(person); item.groupName = personGroup(person); item.bankCard = defaultBankCard(person);
    item.changeReason = text(reason); item.updatedAt = nowIso(now); next.updatedAt = nowIso(now);
    return next;
  }

  function createBatch({ ledger, contract, batchDate, differenceExplanation = '' }, { now = new Date(), id } = {}) {
    if (!ledger || !contract || ledger.contractId !== contract.id) throw new Error('台账与合同不匹配');
    const batchId = id || identifier('contract-fee-batch', now instanceof Date ? now.getTime() : Date.now());
    return {
      id: batchId, ledgerId: ledger.id, contractId: contract.id, contractName: contract.name,
      contractStartDate: contract.startDate, contractEndDate: contract.endDate, contractAmountCents: Number(contract.amountCents || 0),
      batchDate: text(batchDate), differenceExplanation: text(differenceExplanation), status: 'draft',
      items: ledger.items.filter((item) => item.active !== false).map((item, index) => ({
        id: `${batchId}-item-${index + 1}`, ledgerItemId: item.id, personId: item.personId, name: item.name, groupName: item.groupName,
        calculationType: item.calculationType, quantity: item.quantity, unitPriceCents: item.unitPriceCents,
        calculatedAmountCents: item.calculatedAmountCents, finalAmountCents: item.plannedAmountCents,
        adjustmentReason: '', bankCard: item.bankCard, paymentStatus: 'pending', paymentNote: '',
      })),
      createdAt: nowIso(now), updatedAt: nowIso(now), reviewedAt: null, exportedAt: null, completedAt: null,
    };
  }

  function summarizeBatch(batch) {
    const groupTotals = {};
    for (const item of batch?.items || []) groupTotals[item.groupName || '未分组'] = (groupTotals[item.groupName || '未分组'] || 0) + Number(item.finalAmountCents || 0);
    const totalCents = Object.values(groupTotals).reduce((sum, value) => sum + value, 0);
    return { groupTotals, totalCents, differenceCents: Number(batch?.contractAmountCents || 0) - totalCents };
  }

  function validateBatch(batch) {
    const errors = [];
    if (!text(batch?.batchDate)) errors.push('请填写实际发放日期');
    for (const item of batch?.items || []) {
      if (!normalizeBankCard(item.bankCard)) errors.push(`${item.name}缺少银行卡号`);
      if (Number(item.finalAmountCents) !== Number(item.calculatedAmountCents) && !text(item.adjustmentReason)) errors.push(`${item.name}调整金额后必须填写原因`);
    }
    const summary = summarizeBatch(batch);
    if (summary.differenceCents !== 0 && !text(batch?.differenceExplanation)) errors.push('合同金额与居民发放总额不一致，请填写差额用途说明');
    return { ok: errors.length === 0, errors, ...summary };
  }

  function deriveBatchStatus(batch) {
    if (batch.status === 'draft') return batch.status;
    const statuses = (batch.items || []).map((item) => item.paymentStatus);
    if (statuses.length && statuses.every((status) => status === 'paid')) return 'completed';
    if (statuses.some((status) => status === 'paid')) return 'partial';
    return batch.exportedAt ? 'exported' : batch.status;
  }

  function reviewBatch(batch, { now = new Date() } = {}) {
    const validation = validateBatch(batch); if (!validation.ok) throw new Error(validation.errors.join('；'));
    return { ...structuredClone(batch), status: 'reviewed', reviewedAt: nowIso(now), updatedAt: nowIso(now) };
  }

  function markBatchExported(batch, { now = new Date(), exportedFiles = [] } = {}) {
    if (!['reviewed', 'exported', 'partial'].includes(batch.status)) throw new Error('批次核对完成后才能导出');
    return { ...structuredClone(batch), status: 'exported', exportedAt: nowIso(now), exportedFiles, updatedAt: nowIso(now) };
  }

  function updatePaymentResults(batch, results, { now = new Date() } = {}) {
    const next = structuredClone(batch); const byId = new Map((results || []).map((item) => [item.itemId, item]));
    next.items.forEach((item) => { const result = byId.get(item.id); if (!result) return; item.paymentStatus = result.status; item.paymentNote = text(result.note); item.paidAt = result.status === 'paid' ? nowIso(now) : null; });
    next.status = deriveBatchStatus(next); next.updatedAt = nowIso(now); if (next.status === 'completed') next.completedAt = nowIso(now);
    return next;
  }

  function createReceipt({ contractId, amount, receivedDate }, { now = new Date(), id } = {}) {
    if (!text(contractId)) throw new Error('请选择对应合同');
    if (!text(receivedDate)) throw new Error('请填写实际到账日期');
    return { id: id || identifier('contract-fee-receipt', now instanceof Date ? now.getTime() : Date.now()), contractId: text(contractId), amountCents: amountToCents(amount), status: 'paid', receivedDate: text(receivedDate), createdAt: nowIso(now) };
  }

  function createAdvance({ contractId, batchId, amount, advancedDate }, { now = new Date(), id } = {}) {
    if (!text(contractId) || !text(batchId)) throw new Error('垫付记录必须对应合同和发放批次');
    if (!text(advancedDate)) throw new Error('请填写垫付日期');
    return { id: id || identifier('contract-fee-advance', now instanceof Date ? now.getTime() : Date.now()), contractId: text(contractId), batchId: text(batchId), amountCents: amountToCents(amount), advancedDate: text(advancedDate), status: 'pending_reimbursement', reimbursedDate: null, createdAt: nowIso(now), updatedAt: nowIso(now) };
  }

  function reimburseAdvance(advance, reimbursedDate, { now = new Date() } = {}) {
    if (!text(reimbursedDate)) throw new Error('请填写实际归还日期');
    return { ...structuredClone(advance), status: 'reimbursed', reimbursedDate: text(reimbursedDate), updatedAt: nowIso(now) };
  }

  const DEFAULT_DISBURSEMENT_CATEGORIES = Object.freeze([
    { code: 'contract_fee', name: '承包费', groupExport: true, contractOptional: true },
    { code: 'subsidy', name: '补贴', groupExport: true, contractOptional: false },
    { code: 'salary', name: '固定工资', groupExport: false, contractOptional: false },
    { code: 'casual_labor', name: '杂工工资', groupExport: false, contractOptional: false },
    { code: 'public_service_salary', name: '公共服务运行人员工资', groupExport: false, contractOptional: false },
  ]);

  function defaultDisbursementCategories() { return DEFAULT_DISBURSEMENT_CATEGORIES.map((item) => ({ ...item, id: `category-${item.code}`, builtIn: true, active: true })); }
  function normalizeDisbursementCollections(database) {
    if (!Array.isArray(database.disbursementCategories) || !database.disbursementCategories.length) database.disbursementCategories = defaultDisbursementCategories();
    if (!Array.isArray(database.disbursementBatches)) database.disbursementBatches = [];
    return database;
  }
  function createDisbursementCategory(value, { now = new Date(), id } = {}) {
    if (!text(value?.name)) throw new Error('请填写资金类别名称');
    return { id: id || identifier('disbursement-category', now instanceof Date ? now.getTime() : Date.now()), code: text(value.code) || `custom-${Date.now()}`, name: text(value.name), groupExport: Boolean(value.groupExport), contractOptional: Boolean(value.contractOptional), builtIn: false, active: value.active !== false, createdAt: nowIso(now), updatedAt: nowIso(now) };
  }
  function disbursementItem(value, personnel = [], { now = new Date(), id } = {}) {
    const person = personnel.find((item) => personId(item) === text(value.personId));
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('每一笔发放都必须填写收款人');
    const amountCents = amountToCents(value.amount);
    if (amountCents < 0) throw new Error('发放金额不能小于零');
    return { id: id || identifier('disbursement-item', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : '', recipientKind: person ? 'resident' : 'temporary', name, groupName: person ? personGroup(person) : text(value.groupName), bankCard: person ? (normalizeBankCard(value.bankCard) || defaultBankCard(person)) : normalizeBankCard(value.bankCard), amountCents, paymentStatus: text(value.paymentStatus) || 'pending', paymentNote: text(value.paymentNote), createdAt: nowIso(now), updatedAt: nowIso(now) };
  }
  function createDisbursementBatch(value, { personnel = [], now = new Date(), id } = {}) {
    if (!text(value?.categoryId) || !text(value?.categoryName)) throw new Error('请选择资金类别');
    if (!text(value?.period)) throw new Error('请填写发放期间');
    const items = (value.items || []).map((item, index) => disbursementItem(item, personnel, { now, id: `${id || identifier('disbursement-batch', now instanceof Date ? now.getTime() : Date.now())}-item-${index + 1}` }));
    if (!items.length) throw new Error('请至少添加一名收款人');
    const directPaid = Boolean(value.directPaid);
    if (directPaid && !text(value.directPaymentReason)) throw new Error('直接登记为已发放时必须填写经办说明');
    const batchId = id || identifier('disbursement-batch', now instanceof Date ? now.getTime() : Date.now());
    return { id: batchId, categoryId: text(value.categoryId), categoryName: text(value.categoryName), period: text(value.period), batchDate: text(value.batchDate), contractId: text(value.contractId), status: directPaid ? 'completed' : 'draft', directPaymentReason: text(value.directPaymentReason), items: items.map((item, index) => ({ ...item, id: `${batchId}-item-${index + 1}`, paymentStatus: directPaid ? 'paid' : item.paymentStatus, paidAt: directPaid ? nowIso(now) : null })), attachments: Array.isArray(value.attachments) ? value.attachments : [], notes: text(value.notes), createdAt: nowIso(now), updatedAt: nowIso(now), reviewedAt: null, completedAt: directPaid ? nowIso(now) : null };
  }
  function summarizeDisbursementBatch(batch) { return { totalCents: (batch?.items || []).reduce((sum, item) => sum + Number(item.amountCents || 0), 0), recipientCount: (batch?.items || []).length, paidCount: (batch?.items || []).filter((item) => item.paymentStatus === 'paid').length }; }
  function reviewDisbursementBatch(batch, { now = new Date() } = {}) { if (!batch?.items?.length) throw new Error('批次没有收款明细'); return { ...structuredClone(batch), status: 'reviewed', reviewedAt: nowIso(now), updatedAt: nowIso(now) }; }
  function markDisbursementBatchPaid(batch, { now = new Date(), note = '' } = {}) { if (!['reviewed', 'draft'].includes(batch.status)) throw new Error('该批次当前不能登记发放'); const next = structuredClone(batch); next.items.forEach((item) => { item.paymentStatus = 'paid'; item.paidAt = nowIso(now); item.paymentNote = text(note) || item.paymentNote; }); next.status = 'completed'; next.completedAt = nowIso(now); next.updatedAt = nowIso(now); return next; }
  function summarizeDisbursementDashboard(batches = []) { const totalsByCategory = {}; let totalCents = 0; let pendingReview = 0; let completed = 0; for (const batch of batches) { const total = summarizeDisbursementBatch(batch).totalCents; totalCents += total; totalsByCategory[batch.categoryName || '未分类'] = (totalsByCategory[batch.categoryName || '未分类'] || 0) + total; if (batch.status === 'draft') pendingReview += 1; if (batch.status === 'completed') completed += 1; } return { totalCents, pendingReview, completed, totalsByCategory }; }

  const DISBURSEMENT_TEMPLATE_KEYS = Object.freeze({ positionSalary: 'position_salary', publicService: 'public_service', casualLabor: 'casual_labor', contractFee: 'contract_fee' });

  function normalizeProfile(value, personnel = [], { now = new Date(), id } = {}) {
    const person = personnel.find((item) => personId(item) === text(value.personId));
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('请填写人员姓名');
    const templateKey = text(value.templateKey) || DISBURSEMENT_TEMPLATE_KEYS.positionSalary;
    if (![DISBURSEMENT_TEMPLATE_KEYS.positionSalary, DISBURSEMENT_TEMPLATE_KEYS.publicService].includes(templateKey)) throw new Error('固定人员台账仅支持岗位工资或公共服务人员');
    return {
      id: id || identifier('disbursement-profile', now instanceof Date ? now.getTime() : Date.now()), templateKey,
      personId: person ? personId(person) : text(value.personId), name, groupName: person ? personGroup(person) : text(value.groupName),
      role: text(value.role), responsibilityArea: text(value.responsibilityArea), bankCard: person ? (normalizeBankCard(value.bankCard) || defaultBankCard(person)) : normalizeBankCard(value.bankCard),
      standardCents: amountToCents(value.standard), active: value.active !== false, notes: text(value.notes),
      createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function templateItem(value, personnel = [], templateKey, { now = new Date(), id } = {}) {
    const person = personnel.find((item) => personId(item) === text(value.personId));
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('每一笔发放都必须填写收款人');
    const unitPriceCents = amountToCents(value.unitPrice || value.standard || 0);
    const quantity = numberValue(value.quantity || value.months || value.workDays || 0);
    const deductionsCents = amountToCents(value.deductions || 0);
    let calculatedAmountCents = amountToCents(value.amount || 0);
    if (templateKey === DISBURSEMENT_TEMPLATE_KEYS.positionSalary || templateKey === DISBURSEMENT_TEMPLATE_KEYS.casualLabor) calculatedAmountCents = Math.round(quantity * unitPriceCents);
    if (templateKey === DISBURSEMENT_TEMPLATE_KEYS.publicService && !calculatedAmountCents) calculatedAmountCents = unitPriceCents;
    const finalAmountCents = value.finalAmount === undefined || text(value.finalAmount) === '' ? calculatedAmountCents - deductionsCents : amountToCents(value.finalAmount);
    if (finalAmountCents < 0) throw new Error(`${name}的实发金额不能小于零`);
    return {
      id: id || identifier('template-item', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : text(value.personId),
      recipientKind: person ? 'resident' : 'temporary', name, groupName: person ? personGroup(person) : text(value.groupName),
      role: text(value.role), responsibilityArea: text(value.responsibilityArea), workDate: text(value.workDate), workItem: text(value.workItem),
      bankCard: person ? (normalizeBankCard(value.bankCard) || defaultBankCard(person)) : normalizeBankCard(value.bankCard),
      unitPriceCents, quantity, deductionsCents, calculatedAmountCents, amountCents: finalAmountCents,
      paymentStatus: text(value.paymentStatus) || 'pending', paymentNote: text(value.paymentNote), remark: text(value.remark), createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function createTemplateDisbursementBatch(value, { personnel = [], now = new Date(), id } = {}) {
    const templateKey = text(value.templateKey);
    if (!Object.values(DISBURSEMENT_TEMPLATE_KEYS).includes(templateKey)) throw new Error('请选择发放模板');
    if (!text(value.period)) throw new Error('请填写发放期间');
    const batchId = id || identifier('template-disbursement-batch', now instanceof Date ? now.getTime() : Date.now());
    const items = (value.items || []).map((item, index) => templateItem(item, personnel, templateKey, { now, id: `${batchId}-item-${index + 1}` }));
    if (!items.length) throw new Error('请至少添加一名收款人');
    return {
      id: batchId, categoryId: text(value.categoryId), categoryName: text(value.categoryName), templateKey, period: text(value.period), batchDate: text(value.batchDate),
      title: text(value.title), villageName: text(value.villageName), unitName: text(value.unitName), signers: { approver: text(value.approver), maker: text(value.maker), handler: text(value.handler) },
      status: 'draft', items, notes: text(value.notes), createdAt: nowIso(now), updatedAt: nowIso(now), reviewedAt: null, completedAt: null,
    };
  }

  function normalizedSubsidyRecord(value, personnel = [], { now = new Date(), id } = {}) {
    const idCard = text(value.idCard || value.id_card).toUpperCase();
    const explicitPerson = personnel.find((person) => personId(person) === text(value.personId));
    const candidates = explicitPerson ? [explicitPerson] : (idCard ? personnel.filter((person) => text(person.id_card || person.idCard).toUpperCase() === idCard) : personnel.filter((person) => personGroup(person) === text(value.groupName || value.group) && personName(person) === text(value.name)));
    const person = candidates.length === 1 ? candidates[0] : null;
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('补贴记录必须填写姓名');
    const eligibleArea = numberValue(value.eligibleArea ?? value.eligible_area ?? value.area);
    const standardCents = value.standardCents === undefined ? amountToCents(value.standard ?? value.unitPrice ?? 0) : Number(value.standardCents || 0);
    const calculatedAmountCents = Math.round(eligibleArea * standardCents);
    const amountCents = value.amount === undefined || text(value.amount) === '' ? calculatedAmountCents : amountToCents(value.amount);
    return {
      id: id || identifier('farmland-subsidy-record', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : text(value.personId),
      matchStatus: person ? 'matched' : (candidates.length > 1 ? 'ambiguous' : 'missing'), name, groupName: person ? personGroup(person) : text(value.groupName || value.group),
      category: text(value.category) === 'village_cadre' ? 'village_cadre' : 'household', idCard, bankName: text(value.bankName || value.bank), bankCard: normalizeBankCard(value.bankCard || value.cardNumber),
      ownershipArea: numberValue(value.ownershipArea ?? value.ownership_area ?? eligibleArea), excludedArea: numberValue(value.excludedArea ?? value.excluded_area ?? 0), eligibleArea,
      standardCents, calculatedAmountCents, amountCents, phone: text(value.phone), remark: text(value.remark), adjustmentReason: text(value.adjustmentReason),
      createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function createFarmlandSubsidyLedger(value, { personnel = [], now = new Date(), id } = {}) {
    if (!text(value.year)) throw new Error('请填写补贴年度');
    const ledgerId = id || identifier('farmland-subsidy-ledger', now instanceof Date ? now.getTime() : Date.now());
    const records = (value.records || []).map((item, index) => normalizedSubsidyRecord(item, personnel, { now, id: `${ledgerId}-record-${index + 1}` }));
    if (!records.length) throw new Error('年度补贴台账至少需要一条记录');
    return { id: ledgerId, year: text(value.year), villageName: text(value.villageName), streetName: text(value.streetName), status: 'draft', records, corrections: [], createdAt: nowIso(now), updatedAt: nowIso(now) };
  }

  function summarizeFarmlandSubsidyLedger(ledger) {
    const records = ledger?.records || []; const groupTotals = {};
    for (const record of records) {
      const group = record.groupName || '未分组';
      const total = groupTotals[group] || { householdCount: 0, ownershipArea: 0, excludedArea: 0, eligibleArea: 0, amountCents: 0 };
      if (record.category === 'household') { total.householdCount += 1; total.ownershipArea += Number(record.ownershipArea || 0); total.excludedArea += Number(record.excludedArea || 0); total.eligibleArea += Number(record.eligibleArea || 0); total.amountCents += Number(record.amountCents || 0); }
      groupTotals[group] = total;
    }
    const totalAmountCents = records.reduce((sum, record) => sum + Number(record.amountCents || 0), 0);
    return { totalAmountCents, totalRecords: records.length, groupTotals, villageCadreRecords: records.filter((item) => item.category === 'village_cadre') };
  }

  function validateFarmlandSubsidyLedger(ledger) {
    const errors = [];
    for (const record of ledger?.records || []) {
      if (record.matchStatus !== 'matched') errors.push(`${record.name}尚未关联居民档案`);
      if (!text(record.idCard)) errors.push(`${record.name}缺少身份证号`);
      if (!normalizeBankCard(record.bankCard)) errors.push(`${record.name}缺少一卡通号`);
      if (Number(record.amountCents) !== Number(record.calculatedAmountCents) && !text(record.adjustmentReason)) errors.push(`${record.name}调整金额后必须填写原因`);
    }
    return { ok: errors.length === 0, errors, ...summarizeFarmlandSubsidyLedger(ledger) };
  }

  function correctFarmlandSubsidyRecord(ledger, recordId, value, { personnel = [], now = new Date() } = {}) {
    if (!text(value.correctionReason)) throw new Error('更正补贴数据必须填写原因');
    const current = (ledger?.records || []).find((item) => item.id === recordId);
    if (!current) throw new Error('未找到补贴记录');
    const next = structuredClone(ledger); const index = next.records.findIndex((item) => item.id === recordId);
    const replacement = normalizedSubsidyRecord({ ...current, ...value }, personnel, { now, id: current.id }); replacement.createdAt = current.createdAt;
    next.records.splice(index, 1, replacement); next.status = 'correcting'; next.updatedAt = nowIso(now);
    next.corrections.push({ id: identifier('farmland-subsidy-correction', now instanceof Date ? now.getTime() : Date.now()), recordId, reason: text(value.correctionReason), before: current, after: replacement, correctedAt: nowIso(now) });
    return next;
  }

  const api = {
    amountToCents, centsToYuan, numberValue, normalizeBankCard, personName, personGroup, personStatus, personId,
    bankAccounts, defaultBankCard, setDefaultBankCard, calculateAmount, matchImportedRows, createContract, createLedger,
    copyLedger, replaceLedgerPerson, createBatch, summarizeBatch, validateBatch, deriveBatchStatus, reviewBatch,
    markBatchExported, updatePaymentResults, createReceipt, createAdvance, reimburseAdvance,
    defaultDisbursementCategories, normalizeDisbursementCollections, createDisbursementCategory, createDisbursementBatch,
    summarizeDisbursementBatch, reviewDisbursementBatch, markDisbursementBatchPaid, summarizeDisbursementDashboard,
    DISBURSEMENT_TEMPLATE_KEYS, normalizeProfile, templateItem, createTemplateDisbursementBatch,
    normalizedSubsidyRecord, createFarmlandSubsidyLedger, summarizeFarmlandSubsidyLedger, validateFarmlandSubsidyLedger, correctFarmlandSubsidyRecord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContractFeeModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
