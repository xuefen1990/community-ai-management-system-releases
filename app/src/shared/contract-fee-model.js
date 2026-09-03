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
    if (!Array.isArray(database.disbursementRecycleBin)) database.disbursementRecycleBin = [];
    const storedTemplates = Array.isArray(database.disbursementTemplates) ? database.disbursementTemplates : [];
    const storedByKey = new Map(storedTemplates.map((item) => [text(item?.key), item]));
    database.disbursementTemplates = [
      ...defaultDisbursementTemplates().map((template) => ({ ...template, ...(storedByKey.get(template.key) || {}), id: template.id, key: template.key, builtIn: true, fields: normalizeTemplateFields(storedByKey.get(template.key)?.fields || template.fields) })),
      ...storedTemplates.filter((template) => !DEFAULT_DISBURSEMENT_TEMPLATES.some((defaultTemplate) => defaultTemplate.key === text(template?.key))).map((template) => normalizeDisbursementTemplate(template, { id: template.id || undefined })),
    ];
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
    return { id: id || identifier('disbursement-item', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : '', recipientKind: person ? 'resident' : 'temporary', name, groupName: person ? personGroup(person) : text(value.groupName), idCard: normalizedIdCard(value.idCard || value.id_card), phone: normalizedPhone(value.phone || value.mobile), bankName: text(value.bankName || value.bank), bankCard: person ? (normalizeBankCard(value.bankCard) || defaultBankCard(person)) : normalizeBankCard(value.bankCard), amountCents, paymentStatus: text(value.paymentStatus) || 'pending', paymentNote: text(value.paymentNote), createdAt: nowIso(now), updatedAt: nowIso(now) };
  }
  function createDisbursementBatch(value, { personnel = [], now = new Date(), id } = {}) {
    if (!text(value?.categoryId) || !text(value?.categoryName)) throw new Error('请选择资金类别');
    if (!text(value?.period)) throw new Error('请填写发放期间');
    const items = (value.items || []).map((item, index) => disbursementItem(item, personnel, { now, id: `${id || identifier('disbursement-batch', now instanceof Date ? now.getTime() : Date.now())}-item-${index + 1}` }));
    if (!items.length) throw new Error('请至少添加一名收款人');
    const directPaid = Boolean(value.directPaid);
    if (directPaid && !text(value.directPaymentReason)) throw new Error('直接登记为已发放时必须填写经办说明');
    const batchId = id || identifier('disbursement-batch', now instanceof Date ? now.getTime() : Date.now());
    return { id: batchId, categoryId: text(value.categoryId), categoryName: text(value.categoryName), period: text(value.period), batchDate: text(value.batchDate), contractId: text(value.contractId), status: directPaid ? 'completed' : 'draft', directPaymentReason: text(value.directPaymentReason), isTest: Boolean(value.isTest), items: items.map((item, index) => ({ ...item, id: `${batchId}-item-${index + 1}`, paymentStatus: directPaid ? 'paid' : item.paymentStatus, paidAt: directPaid ? nowIso(now) : null })), attachments: Array.isArray(value.attachments) ? value.attachments : [], notes: text(value.notes), createdAt: nowIso(now), updatedAt: nowIso(now), reviewedAt: null, completedAt: directPaid ? nowIso(now) : null };
  }
  function summarizeDisbursementBatch(batch) { return { totalCents: (batch?.items || []).reduce((sum, item) => sum + Number(item.amountCents || 0), 0), recipientCount: (batch?.items || []).length, paidCount: (batch?.items || []).filter((item) => item.paymentStatus === 'paid').length }; }
  function reviewDisbursementBatch(batch, { now = new Date() } = {}) { if (!batch?.items?.length) throw new Error('批次没有收款明细'); return { ...structuredClone(batch), status: 'reviewed', reviewedAt: nowIso(now), updatedAt: nowIso(now) }; }
  function markDisbursementBatchPaid(batch, { now = new Date(), note = '' } = {}) { if (!['reviewed', 'draft', 'prepared', 'printed'].includes(batch.status)) throw new Error('该批次当前不能登记发放'); const next = structuredClone(batch); next.items.forEach((item) => { item.paymentStatus = 'paid'; item.paidAt = nowIso(now); item.paymentNote = text(note) || item.paymentNote; }); next.status = 'completed'; next.completedAt = nowIso(now); next.updatedAt = nowIso(now); return next; }
  function summarizeDisbursementDashboard(batches = []) { const totalsByCategory = {}; let totalCents = 0; let pendingReview = 0; let completed = 0; for (const batch of batches) { const total = summarizeDisbursementBatch(batch).totalCents; totalCents += total; totalsByCategory[batch.categoryName || '未分类'] = (totalsByCategory[batch.categoryName || '未分类'] || 0) + total; if (batch.status === 'draft') pendingReview += 1; if (batch.status === 'completed') completed += 1; } return { totalCents, pendingReview, completed, totalsByCategory }; }

  function recycleDisbursementBatch(batch, { now = new Date(), reason = '' } = {}) {
    if (!batch?.id) throw new Error('未找到要清理的发放批次');
    return { ...structuredClone(batch), recycleInfo: { recycledAt: nowIso(now), reason: text(reason), previousStatus: text(batch.status) || 'draft' } };
  }

  function restoreDisbursementBatch(batch, { now = new Date() } = {}) {
    if (!batch?.recycleInfo) throw new Error('该批次不在回收站中');
    const next = structuredClone(batch); next.status = text(next.recycleInfo.previousStatus) || 'draft'; delete next.recycleInfo; next.updatedAt = nowIso(now); return next;
  }

  function copyDisbursementBatch(batch, personnel = [], { now = new Date(), id } = {}) {
    if (!batch?.items?.length) throw new Error('该批次没有可复制的发放明细');
    const batchId = id || identifier('disbursement-batch-copy', now instanceof Date ? now.getTime() : Date.now());
    const next = structuredClone(batch); next.id = batchId; next.copiedFromBatchId = text(batch.id); next.status = 'draft'; next.preparedAt = null; next.printedAt = null; next.reviewedAt = null; next.completedAt = null; next.createdAt = nowIso(now); next.updatedAt = nowIso(now); delete next.recycleInfo;
    next.items = next.items.map((item, index) => {
      const person = (personnel || []).find((entry) => personId(entry) === text(item.personId));
      const bankCard = person ? defaultBankCard(person) : normalizeBankCard(item.bankCard);
      return { ...item, id: `${batchId}-item-${index + 1}`, name: person ? personName(person) : item.name, groupName: person ? personGroup(person) : item.groupName, bankCard, paymentStatus: 'pending', paidAt: null, paymentNote: '', residentSnapshot: person ? { personId: personId(person), name: personName(person), groupName: personGroup(person), bankCard } : item.residentSnapshot, createdAt: nowIso(now), updatedAt: nowIso(now) };
    });
    next.residentSyncResults = []; return next;
  }

  function disbursementBatchIssues(batch, personnel = []) {
    const issues = [];
    const seen = new Set();
    for (const item of batch?.items || []) {
      const key = `${text(item.name)}|${text(item.groupName)}`;
      if (seen.has(key)) issues.push({ type: 'duplicate', itemId: item.id, message: `${item.name}在本批次重复出现` }); else seen.add(key);
      if (!normalizeBankCard(item.bankCard)) issues.push({ type: 'missing-bank-card', itemId: item.id, message: `${item.name}缺少银行卡号` });
      if (Number(item.amountCents) !== Number(item.automaticAmountCents ?? item.amountCents) && text(item.adjustmentReason)) issues.push({ type: 'adjusted-amount', itemId: item.id, message: `${item.name}已手动调整金额` });
      const candidates = disbursementResidentCandidates(item, personnel);
      if (!text(item.personId) && candidates.length > 1) issues.push({ type: 'ambiguous-person', itemId: item.id, message: `${item.name}存在重名居民，待人工确认` });
      const person = (personnel || []).find((entry) => personId(entry) === text(item.personId));
      if (person && normalizeBankCard(item.bankCard) && defaultBankCard(person) && normalizeBankCard(item.bankCard) !== defaultBankCard(person)) issues.push({ type: 'updated-bank-card', itemId: item.id, message: `${item.name}的银行卡与居民档案不同` });
    }
    return issues;
  }

  function disbursementBatchSyncStatus(batch, personnel = []) {
    if (Array.isArray(batch?.residentSyncResults) && batch.residentSyncResults.length >= (batch?.items || []).length) return { code: 'synced', label: '已同步', count: 0 };
    const plan = disbursementResidentSyncPlan(batch, personnel);
    const manual = plan.filter((item) => ['manual', 'missing'].includes(item.status));
    return manual.length ? { code: 'manual', label: '待人工确认', count: manual.length } : { code: 'pending', label: `待同步 ${plan.length} 人`, count: plan.length };
  }

  const DISBURSEMENT_TEMPLATE_KEYS = Object.freeze({ positionSalary: 'position_salary', publicService: 'public_service', casualLabor: 'casual_labor', contractFee: 'contract_fee' });

  const DEFAULT_DISBURSEMENT_TEMPLATES = Object.freeze([
    { id: 'template-position-salary', key: 'position_salary', name: '岗位工资 / 补贴', categoryCode: 'salary', builtIn: true, paper: 'A5', rowsPerPage: 10, title: '工资结算单', description: '村组干部、党小组长、监督委员；月标准 × 月数', fields: ['职务', '月份', '月标准', '扣除款', '实发金额'] },
    { id: 'template-public-service', key: 'public_service', name: '公共服务人员报酬', categoryCode: 'public_service_salary', builtIn: true, paper: 'A5', rowsPerPage: 10, title: '农村公共服务运行维护人员报酬发放表', description: '负责区域、银行卡号和报酬金额', fields: ['负责区域', '实发金额'] },
    { id: 'template-casual-labor', key: 'casual_labor', name: '杂工补贴', categoryCode: 'casual_labor', builtIn: true, paper: 'A5', rowsPerPage: 10, title: '村级务工补贴发放表', description: '用工日期、事项、工日 × 单价', fields: ['用工日期', '用工事项', '工日', '单价', '实发金额'] },
    { id: 'template-contract-fee', key: 'contract_fee', name: '承包费', categoryCode: 'contract_fee', builtIn: true, paper: 'A4', rowsPerPage: 20, title: '土地租金发放明细', description: '按人口或地亩数核算的承包费明细', fields: ['姓名', '人口/亩数', '单价', '金额', '银行卡号'] },
  ]);

  function defaultDisbursementTemplates() {
    return DEFAULT_DISBURSEMENT_TEMPLATES.map((template) => ({ ...structuredClone(template), active: true, createdAt: null, updatedAt: null }));
  }

  function normalizeTemplateFields(fields) {
    const values = Array.isArray(fields) ? fields : text(fields).split(/[、，,\n]/u);
    return [...new Set(values.map((value) => text(typeof value === 'string' ? value : value?.label)).filter(Boolean))];
  }

  function templateFieldKey(value, index = 0) {
    const source = text(typeof value === 'string' ? value : value?.key || value?.label);
    return text(source.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '_').replace(/^_+|_+$/gu, '')) || `field_${index + 1}`;
  }

  function normalizeTemplateColumns(value) {
    const source = Array.isArray(value?.columns) && value.columns.length ? value.columns : (Array.isArray(value?.fields) ? value.fields : text(value?.fields).split(/[、，,\n]/u));
    const seen = new Set();
    return source.map((field, index) => {
      const label = text(typeof field === 'string' ? field : field?.label || field?.key);
      if (!label) return null;
      let key = templateFieldKey(field, index); let suffix = 2;
      while (seen.has(key)) { key = `${templateFieldKey(field, index)}_${suffix}`; suffix += 1; }
      seen.add(key);
      const sourceType = text(typeof field === 'string' ? '' : field?.source) || 'manual';
      return {
        key, label, source: ['resident', 'batch', 'manual', 'calculation'].includes(sourceType) ? sourceType : 'manual',
        residentField: text(typeof field === 'string' ? '' : field?.residentField), calculation: text(typeof field === 'string' ? '' : field?.calculation),
        width: Math.max(60, Math.min(360, Math.round(numberValue(typeof field === 'string' ? 120 : field?.width || 120) || 120))), visible: typeof field === 'string' ? true : field?.visible !== false,
      };
    }).filter(Boolean);
  }

  function normalizeDisbursementTemplate(value, { now = new Date(), id } = {}) {
    const name = text(value?.name);
    if (!name) throw new Error('请填写发放模板名称');
    const paper = text(value?.paper || 'A5').toUpperCase();
    if (!['A4', 'A5'].includes(paper)) throw new Error('打印纸张仅支持 A4 或 A5');
    const rowsPerPage = Math.max(1, Math.min(50, Math.round(numberValue(value?.rowsPerPage || (paper === 'A5' ? 10 : 20)) || 10)));
    const fields = normalizeTemplateFields(value?.fields);
    if (!fields.length) throw new Error('请至少保留一个自定义字段');
    return {
      id: id || text(value?.id) || identifier('disbursement-template', now instanceof Date ? now.getTime() : Date.now()),
      key: text(value?.key) || `custom_${Date.now()}`,
      name, categoryCode: text(value?.categoryCode), builtIn: Boolean(value?.builtIn), active: value?.active !== false,
      paper, rowsPerPage, title: text(value?.title) || name, description: text(value?.description), fields,
      columns: normalizeTemplateColumns(value), orientation: text(value?.orientation || 'portrait') === 'landscape' ? 'landscape' : 'portrait',
      showBankCard: value?.showBankCard !== false, showSigners: value?.showSigners !== false,
      previewLayout: value?.previewLayout && typeof value.previewLayout === 'object' ? structuredClone(value.previewLayout) : {},
      createdAt: text(value?.createdAt) || nowIso(now), updatedAt: nowIso(now),
    };
  }

  function createDisbursementTemplate(value, options = {}) { return normalizeDisbursementTemplate({ ...value, builtIn: false }, options); }

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
    const sameNamePeople = !person && text(value.name) ? personnel.filter((item) => personName(item) === text(value.name)) : [];
    if (sameNamePeople.length > 1) throw new Error(`${text(value.name)}在居民档案中有重名，请按组别和证件或银行卡尾号手工确认具体人员`);
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('每一笔发放都必须填写收款人');
    const unitPriceCents = amountToCents(value.unitPrice || value.standard || 0);
    const quantity = numberValue(value.quantity || value.months || value.workDays || 0);
    const deductionsCents = amountToCents(value.deductions || 0);
    let calculatedAmountCents = amountToCents(value.amount || value.finalAmount || 0);
    if (templateKey === DISBURSEMENT_TEMPLATE_KEYS.positionSalary || templateKey === DISBURSEMENT_TEMPLATE_KEYS.casualLabor) calculatedAmountCents = Math.round(quantity * unitPriceCents);
    if (templateKey === DISBURSEMENT_TEMPLATE_KEYS.publicService && !calculatedAmountCents) calculatedAmountCents = unitPriceCents;
    const automaticAmountCents = calculatedAmountCents - deductionsCents;
    const finalAmountCents = value.finalAmount === undefined || text(value.finalAmount) === '' ? automaticAmountCents : amountToCents(value.finalAmount);
    if (finalAmountCents < 0) throw new Error(`${name}的实发金额不能小于零`);
    if (value.finalAmount !== undefined && text(value.finalAmount) !== '' && finalAmountCents !== automaticAmountCents && !text(value.adjustmentReason)) throw new Error(`${name}的实发金额已手工调整，请填写调整原因`);
    return {
      id: id || identifier('template-item', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : text(value.personId),
      recipientKind: person ? 'resident' : 'temporary', name, groupName: person ? personGroup(person) : text(value.groupName),
      // Imported Excel details may contain an ID card before a resident is chosen.
      // Keep it with the draft so the completion step can match the resident safely.
      idCard: normalizedIdCard(value.idCard || value.id_card), phone: normalizedPhone(value.phone || value.mobile), bankName: text(value.bankName || value.bank),
      role: text(value.role), responsibilityArea: text(value.responsibilityArea), workDate: text(value.workDate), workItem: text(value.workItem),
      bankCard: person ? (normalizeBankCard(value.bankCard) || defaultBankCard(person)) : normalizeBankCard(value.bankCard),
      unitPriceCents, quantity, deductionsCents, calculatedAmountCents, automaticAmountCents, amountCents: finalAmountCents,
      adjustmentReason: text(value.adjustmentReason), residentSnapshot: person ? { personId: personId(person), name, groupName: personGroup(person), bankCard: normalizeBankCard(value.bankCard) || defaultBankCard(person) } : null,
      customData: value.customData && typeof value.customData === 'object' ? structuredClone(value.customData) : {},
      paymentStatus: text(value.paymentStatus) || 'pending', paymentNote: text(value.paymentNote), remark: text(value.remark), createdAt: nowIso(now), updatedAt: nowIso(now),
    };
  }

  function normalizePrintMargins(value = {}) {
    const clamp = (input, fallback) => {
      const raw = text(input);
      return Math.max(0, Math.min(40, Math.round(raw === '' ? fallback : numberValue(input))));
    };
    return {
      top: clamp(value.top, 12), bottom: clamp(value.bottom, 12),
      left: clamp(value.left, 12), right: clamp(value.right, 12),
    };
  }

  function normalizeTemplatePrintSettings(value = {}, templateKey = '') {
    const paper = text(value.paper || (templateKey === DISBURSEMENT_TEMPLATE_KEYS.contractFee ? 'A4' : 'A5')).toUpperCase();
    return {
      paper: ['A4', 'A5'].includes(paper) ? paper : 'A5',
      orientation: text(value.orientation) === 'landscape' ? 'landscape' : 'portrait',
      rowsPerPage: Math.max(1, Math.min(50, Math.round(numberValue(value.rowsPerPage || (paper === 'A4' ? 20 : 10)) || 10))),
      margins: normalizePrintMargins(value.margins),
    };
  }

  function createTemplateDisbursementBatch(value, { personnel = [], now = new Date(), id } = {}) {
    const templateKey = text(value.templateKey);
    if (!Object.values(DISBURSEMENT_TEMPLATE_KEYS).includes(templateKey) && !text(value.templateId)) throw new Error('请选择发放模板');
    if (!text(value.period)) throw new Error('请填写发放期间');
    const batchId = id || identifier('template-disbursement-batch', now instanceof Date ? now.getTime() : Date.now());
    const items = (value.items || []).map((item, index) => templateItem(item, personnel, templateKey, { now, id: `${batchId}-item-${index + 1}` }));
    if (!items.length) throw new Error('请至少添加一名收款人');
    return {
      id: batchId, categoryId: text(value.categoryId), categoryName: text(value.categoryName), templateKey, period: text(value.period), batchDate: text(value.batchDate),
      templateId: text(value.templateId), templateSnapshot: value.templateSnapshot ? structuredClone(value.templateSnapshot) : null,
      printSettings: normalizeTemplatePrintSettings({ ...value.printSettings, paper: value.printSettings?.paper || value.paper, rowsPerPage: value.printSettings?.rowsPerPage || value.rowsPerPage, orientation: value.printSettings?.orientation || value.orientation }, templateKey),
      title: text(value.title), villageName: text(value.villageName), unitName: text(value.unitName), signers: { approver: text(value.approver), maker: text(value.maker), handler: text(value.handler) },
      status: 'draft', isTest: Boolean(value.isTest), items, notes: text(value.notes), createdAt: nowIso(now), updatedAt: nowIso(now), preparedAt: null, printedAt: null, reviewedAt: null, completedAt: null,
    };
  }

  function prepareTemplateDisbursementBatch(batch, { now = new Date() } = {}) {
    if (!batch?.items?.length) throw new Error('批次没有发放明细');
    return { ...structuredClone(batch), status: 'prepared', preparedAt: nowIso(now), updatedAt: nowIso(now) };
  }

  function markTemplateDisbursementPrinted(batch, { now = new Date() } = {}) {
    if (!['draft', 'prepared', 'printed'].includes(text(batch?.status))) throw new Error('该批次当前不能打印');
    return { ...structuredClone(batch), status: 'printed', printedAt: nowIso(now), updatedAt: nowIso(now) };
  }

  function disbursementResidentCandidates(item, personnel = []) {
    const idCard = normalizedIdCard(item?.idCard || item?.id_card || item?.residentSnapshot?.idCard);
    const name = text(item?.name); const groupName = text(item?.groupName);
    const seen = new Set(); const candidates = [];
    const add = (person, reason) => {
      const id = personId(person); if (!id || seen.has(id)) return;
      seen.add(id); candidates.push({ person, personId: id, reason });
    };
    if (idCard) personnel.filter((person) => normalizedIdCard(person?.id_card || person?.idCard) === idCard).forEach((person) => add(person, '身份证号一致'));
    if (name && groupName) personnel.filter((person) => personName(person) === name && personGroup(person) === groupName).forEach((person) => add(person, '同组同名'));
    if (name) personnel.filter((person) => personName(person) === name).forEach((person) => add(person, '同名待确认'));
    return candidates;
  }

  function disbursementResidentSyncPlan(batch, personnel = [], resolutions = {}) {
    return (batch?.items || []).map((item) => {
      const rowId = text(item.id); const resolution = resolutions[rowId] || {}; const candidateId = text(resolution.personId || item.personId);
      const candidates = disbursementResidentCandidates(item, personnel); const person = personnel.find((entry) => personId(entry) === candidateId) || (candidates.length === 1 ? candidates[0].person : null);
      if (!person) return { itemId: rowId, status: candidates.length > 1 ? 'manual' : 'missing', reason: candidates.length > 1 ? '存在重名或多个居民候选，必须人工确认' : '未找到居民档案', candidates, item };
      const incomingCard = normalizeBankCard(item.bankCard); const existingCard = defaultBankCard(person);
      const decision = text(resolution.bankCardDecision || (incomingCard && existingCard && incomingCard !== existingCard ? '' : 'sync'));
      if (incomingCard && existingCard && incomingCard !== existingCard && !['once', 'sync'].includes(decision)) return { itemId: rowId, status: 'manual', reason: '银行卡与居民默认卡不同，请选择仅本次使用或同步居民档案', personId: personId(person), person, item };
      return { itemId: rowId, status: incomingCard && existingCard && incomingCard !== existingCard ? (decision === 'sync' ? 'update-default-card' : 'once-only') : 'matched', personId: personId(person), person, item, bankCardDecision: decision || 'sync' };
    });
  }

  function disbursementResidentHistory(batch, item, now) {
    return {
      id: `disbursement-source-${text(batch?.id)}-${text(item?.id)}`,
      sourceType: 'disbursement', batchId: text(batch?.id), recordId: text(item?.id), categoryName: text(batch?.categoryName),
      templateKey: text(batch?.templateKey), period: text(batch?.period), batchDate: text(batch?.batchDate), groupName: text(item?.groupName),
      amountCents: Number(item?.amountCents || 0), paymentStatus: text(item?.paymentStatus) || 'pending', importedAt: nowIso(now),
    };
  }

  function appendDisbursementResidentHistory(person, history) {
    const records = Array.isArray(person.disbursementHistory) ? person.disbursementHistory : [];
    const index = records.findIndex((item) => text(item.batchId) === text(history.batchId) && text(item.recordId) === text(history.recordId));
    if (index >= 0) records.splice(index, 1, { ...records[index], ...history }); else records.push(history);
    person.disbursementHistory = records;
    const sources = Array.isArray(person.importSources) ? person.importSources : [];
    const source = { ...history, sourceType: 'disbursement_import' };
    const sourceIndex = sources.findIndex((item) => text(item.batchId) === text(history.batchId) && text(item.recordId) === text(history.recordId));
    if (sourceIndex >= 0) sources.splice(sourceIndex, 1, { ...sources[sourceIndex], ...source }); else sources.push(source);
    person.importSources = sources;
  }

  function disbursementResidentImportPlan(batch, personnel = [], resolutions = {}) {
    return (batch?.items || []).map((item) => {
      const resolution = resolutions[text(item.id)] || {};
      const selectedId = text(resolution.personId || item.personId);
      const candidates = disbursementResidentCandidates(item, personnel);
      const person = (personnel || []).find((entry) => personId(entry) === selectedId) || (candidates.length === 1 ? candidates[0].person : null);
      const idCard = normalizedIdCard(item.idCard);
      if (!person) {
        if (candidates.length > 1) return { itemId: item.id, status: 'manual', reason: '存在重名或多个居民候选，必须人工确认', candidates, item };
        if (!idCard) return { itemId: item.id, status: 'manual', reason: '缺少身份证号，不能自动新建居民档案', candidates, item };
        if (!text(item.name)) return { itemId: item.id, status: 'manual', reason: '缺少姓名，不能新建居民档案', candidates, item };
        return { itemId: item.id, status: 'create', reason: '未找到同身份证居民，将新建档案', item };
      }
      const conflicts = [];
      const compare = (field, existing, incoming) => { if (text(existing) && text(incoming) && text(existing) !== text(incoming)) conflicts.push({ field, residentValue: text(existing), disbursementValue: text(incoming) }); };
      compare('姓名', personName(person), item.name); compare('村民组', personGroup(person), item.groupName);
      const existingId = normalizedIdCard(person.id_card || person.idCard); if (existingId && idCard && existingId !== idCard) conflicts.push({ field: '身份证号', residentValue: existingId, disbursementValue: idCard });
      compare('手机号', residentPhone(person), normalizedPhone(item.phone));
      const incomingCard = normalizeBankCard(item.bankCard); const cards = bankAccounts(person); const hasIncomingCard = incomingCard && cards.some((account) => normalizeBankCard(account.cardNumber) === incomingCard);
      if (incomingCard && cards.length && !hasIncomingCard) conflicts.push({ field: '银行卡号', residentValue: cards.map((account) => normalizeBankCard(account.cardNumber)).join('、'), disbursementValue: incomingCard });
      compare('开户行', residentBankName(person, incomingCard), item.bankName);
      if (conflicts.length && !['keep', 'adopt'].includes(text(resolution.conflictResolution))) return { itemId: item.id, status: 'manual', reason: conflicts.map((entry) => `${entry.field}与居民档案不一致`).join('；'), conflicts, candidates, personId: personId(person), person, item };
      return { itemId: item.id, status: conflicts.length ? 'resolved' : 'merge', reason: conflicts.length ? '已人工确认资料处理方式' : '自动补充居民档案空白信息', conflicts, personId: personId(person), person, item, conflictResolution: text(resolution.conflictResolution) || 'keep' };
    });
  }

  function fillResidentFromDisbursement(person, item, batch, now, { adopt = false } = {}) {
    const changedFields = []; const fill = (key, value, aliases = []) => {
      if (!text(value) || (text(person[key] || aliases.map((alias) => person[alias]).find((entry) => text(entry))) && !adopt)) return;
      if (text(person[key]) !== text(value)) { person[key] = text(value); changedFields.push(key); }
    };
    fill('name', item.name, ['person_name', 'resident_name']); fill('village_group', item.groupName, ['villageGroup', 'group', 'group_name']); fill('phone', normalizedPhone(item.phone), ['mobile', 'mobile_phone']);
    const idCard = normalizedIdCard(item.idCard); if (idCard && (!normalizedIdCard(person.id_card || person.idCard) || adopt) && normalizedIdCard(person.id_card || person.idCard) !== idCard) { person.id_card = idCard; person.idCard = idCard; changedFields.push('idCard'); }
    const card = normalizeBankCard(item.bankCard); const knownAccount = card && bankAccounts(person).find((account) => normalizeBankCard(account.cardNumber) === card);
    if (card && (!defaultBankCard(person) || adopt)) {
      if (defaultBankCard(person) !== card) { setDefaultBankCard(person, card, { source: 'disbursement-sync', now }); changedFields.push('bankCard'); }
      const account = bankAccounts(person).find((entry) => normalizeBankCard(entry.cardNumber) === card); if (account && text(item.bankName)) account.bankName = text(item.bankName);
    } else if (knownAccount && !text(knownAccount.bankName) && text(item.bankName)) { knownAccount.bankName = text(item.bankName); changedFields.push('bankName'); }
    if (text(item.bankName) && (!text(person.bank_name || person.bankName) || adopt) && text(person.bank_name || person.bankName) !== text(item.bankName)) { person.bank_name = text(item.bankName); changedFields.push('bankName'); }
    appendDisbursementResidentHistory(person, disbursementResidentHistory(batch, item, now)); person.updated_at = nowIso(now);
    return [...new Set(changedFields)];
  }

  function syncDisbursementBatchResidents({ batch, personnel = [], resolutions = {} } = {}, { now = new Date() } = {}) {
    const nextBatch = structuredClone(batch); const nextPersonnel = structuredClone(personnel || []); const plan = disbursementResidentImportPlan(nextBatch, nextPersonnel, resolutions); const results = []; let serial = 0;
    for (const entry of plan) {
      if (entry.status === 'manual') { results.push(entry); continue; }
      const item = nextBatch.items.find((row) => text(row.id) === text(entry.itemId)); let person;
      if (entry.status === 'create') { serial += 1; person = { id: `personnel-disbursement-${now instanceof Date ? now.getTime() : Date.now()}-${serial}`, created_at: nowIso(now) }; nextPersonnel.push(person); }
      else person = nextPersonnel.find((row) => personId(row) === entry.personId);
      if (!item || !person) { results.push({ ...entry, status: 'manual', reason: '未找到待同步居民档案' }); continue; }
      const changedFields = fillResidentFromDisbursement(person, item, nextBatch, now, { adopt: entry.conflictResolution === 'adopt' });
      item.personId = personId(person); item.recipientKind = 'resident'; item.residentSnapshot = { personId: personId(person), name: personName(person), groupName: personGroup(person), bankCard: normalizeBankCard(item.bankCard) || defaultBankCard(person) };
      results.push({ ...entry, status: entry.status === 'create' ? 'created' : (entry.status === 'resolved' ? 'resolved' : 'merged'), personId: personId(person), changedFields });
    }
    nextBatch.residentSyncResults = results.filter((entry) => !['manual'].includes(entry.status)).map((entry) => ({ itemId: entry.itemId, personId: entry.personId, status: entry.status, changedFields: entry.changedFields || [], syncedAt: nowIso(now) }));
    nextBatch.residentSyncDecisions = Object.fromEntries(results.filter((entry) => entry.personId).map((entry) => [entry.itemId, { personId: entry.personId, bankCardDecision: entry.conflictResolution === 'keep' ? 'once' : 'sync' }]));
    nextBatch.updatedAt = nowIso(now);
    const summary = results.reduce((result, entry) => { if (entry.status === 'created') result.created += 1; else if (['merged', 'resolved'].includes(entry.status)) result.merged += 1; else result.manual += 1; return result; }, { created: 0, merged: 0, manual: 0 });
    return { batch: nextBatch, personnel: nextPersonnel, plan, results, summary };
  }

  function completeTemplateDisbursementBatch(batch, { personnel = [], resolutions = {}, now = new Date() } = {}) {
    if (!['draft', 'prepared', 'printed'].includes(text(batch?.status))) throw new Error('该批次当前不能登记为发放完成');
    const nextBatch = structuredClone(batch); const nextPersonnel = structuredClone(personnel || []); const plan = disbursementResidentSyncPlan(nextBatch, nextPersonnel, resolutions);
    const unresolved = plan.filter((entry) => ['manual', 'missing'].includes(entry.status));
    if (unresolved.length) throw new Error(`仍有 ${unresolved.length} 条居民关联或银行卡待处理：${unresolved.map((entry) => entry.reason).join('；')}`);
    const syncResults = [];
    for (const entry of plan) {
      const item = nextBatch.items.find((row) => text(row.id) === entry.itemId); const person = nextPersonnel.find((row) => personId(row) === entry.personId);
      if (!item || !person) continue;
      const beforeCard = defaultBankCard(person); item.personId = personId(person); item.recipientKind = 'resident'; item.residentSnapshot = { personId: personId(person), name: personName(person), groupName: personGroup(person), bankCard: normalizeBankCard(item.bankCard) || beforeCard };
      const shouldSync = entry.bankCardDecision !== 'once' && normalizeBankCard(item.bankCard);
      if (shouldSync) setDefaultBankCard(person, item.bankCard, { source: 'disbursement-complete', now });
      appendDisbursementResidentHistory(person, disbursementResidentHistory(nextBatch, item, now));
      syncResults.push({ itemId: item.id, personId: personId(person), status: entry.status, bankCardDecision: entry.bankCardDecision || 'sync', previousCard: beforeCard, nextCard: shouldSync ? defaultBankCard(person) : beforeCard, syncedAt: nowIso(now) });
    }
    nextBatch.status = 'completed'; nextBatch.completedAt = nowIso(now); nextBatch.updatedAt = nowIso(now); nextBatch.residentSyncResults = syncResults;
    nextBatch.items.forEach((item) => { item.paymentStatus = 'paid'; item.paidAt = nowIso(now); });
    return { batch: nextBatch, personnel: nextPersonnel, results: syncResults };
  }

  function normalizedSubsidyRecord(value, personnel = [], { now = new Date(), id } = {}) {
    const idCard = text(value.idCard || value.id_card).toUpperCase();
    const deferred = text(value.associationStatus) === 'deferred';
    const explicitPerson = deferred ? null : personnel.find((person) => personId(person) === text(value.personId));
    const candidates = deferred ? [] : (explicitPerson ? [explicitPerson] : (idCard ? personnel.filter((person) => text(person.id_card || person.idCard).toUpperCase() === idCard) : personnel.filter((person) => personGroup(person) === text(value.groupName || value.group) && personName(person) === text(value.name))));
    const person = candidates.length === 1 ? candidates[0] : null;
    const name = person ? personName(person) : text(value.name);
    if (!name) throw new Error('补贴记录必须填写姓名');
    const eligibleArea = numberValue(value.eligibleArea ?? value.eligible_area ?? value.area);
    const standardCents = value.standardCents === undefined ? amountToCents(value.standard ?? value.unitPrice ?? 0) : Number(value.standardCents || 0);
    const calculatedAmountCents = Math.round(eligibleArea * standardCents);
    const amountCents = value.amount === undefined || text(value.amount) === '' ? calculatedAmountCents : amountToCents(value.amount);
    return {
      id: id || identifier('farmland-subsidy-record', now instanceof Date ? now.getTime() : Date.now()), personId: person ? personId(person) : text(value.personId),
      matchStatus: person ? 'matched' : (candidates.length > 1 ? 'ambiguous' : 'missing'), associationStatus: person ? 'matched' : (text(value.associationStatus) === 'deferred' ? 'deferred' : 'pending'), associationNote: text(value.associationNote), name, groupName: person ? personGroup(person) : text(value.groupName || value.group),
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
      if (record.matchStatus !== 'matched') errors.push(`${record.name}${record.associationStatus === 'deferred' ? '暂不关联居民档案' : '尚未关联居民档案'}`);
      if (!text(record.idCard)) errors.push(`${record.name}缺少身份证号`);
      if (!normalizeBankCard(record.bankCard)) errors.push(`${record.name}缺少一卡通号`);
      if (text(record.residentSyncStatus) !== 'synced') errors.push(`${record.name}居民资料尚未同步`);
      if (Number(record.amountCents) !== Number(record.calculatedAmountCents) && !text(record.adjustmentReason)) errors.push(`${record.name}调整金额后必须填写原因`);
    }
    return { ok: errors.length === 0, errors, ...summarizeFarmlandSubsidyLedger(ledger) };
  }

  function farmlandSubsidyPersonCandidates(record, personnel = []) {
    const idCard = text(record?.idCard).toUpperCase(); const name = text(record?.name); const groupName = text(record?.groupName);
    const seen = new Set(); const result = [];
    const add = (person, reason) => {
      const id = personId(person); if (!id || seen.has(id)) return;
      seen.add(id); result.push({ person, personId: id, reason });
    };
    if (idCard) personnel.filter((person) => text(person.id_card || person.idCard).toUpperCase() === idCard).forEach((person) => add(person, '身份证号一致'));
    if (name && groupName) personnel.filter((person) => personName(person) === name && personGroup(person) === groupName).forEach((person) => add(person, '同组同名'));
    if (name) personnel.filter((person) => personName(person) === name).forEach((person) => add(person, '同名待确认'));
    return result;
  }

  function normalizedIdCard(value) { return text(value).replace(/\s/gu, '').toUpperCase(); }
  function normalizedPhone(value) { return text(value).replace(/[\s-]/gu, ''); }
  function residentPhone(person) { return normalizedPhone(person?.phone || person?.mobile || person?.mobile_phone); }
  function residentBankName(person, cardNumber = '') {
    const card = normalizeBankCard(cardNumber);
    const accounts = bankAccounts(person); const account = card ? (accounts.find((item) => normalizeBankCard(item.cardNumber) === card) || accounts[0]) : accounts[0];
    return text(account?.bankName || person?.bank_name || person?.bankName);
  }

  function subsidyResidentImportHistory(record, ledger, now) {
    return {
      id: `farmland-subsidy-source-${record.id}`,
      sourceType: 'farmland_subsidy', ledgerId: text(ledger?.id), ledgerYear: text(ledger?.year), recordId: text(record?.id),
      villageName: text(ledger?.villageName), groupName: text(record?.groupName), eligibleArea: Number(record?.eligibleArea || 0),
      standardCents: Number(record?.standardCents || 0), amountCents: Number(record?.amountCents || 0), importedAt: nowIso(now),
    };
  }

  function subsidyResidentImportPlan(ledger, selectedRecordIds = [], personnel = []) {
    const selectedIds = new Set((selectedRecordIds || []).map(text).filter(Boolean));
    const records = (ledger?.records || []).filter((record) => selectedIds.has(text(record.id)) && text(record.residentSyncStatus) !== 'synced');
    return records.map((record) => {
      const idCard = normalizedIdCard(record.idCard);
      if (!idCard) return { recordId: record.id, status: 'manual', reason: '缺少身份证号，不能自动导入', record };
      const matches = (personnel || []).filter((person) => normalizedIdCard(person.id_card || person.idCard) === idCard);
      if (matches.length > 1) return { recordId: record.id, status: 'manual', reason: '居民档案中身份证号重复', record };
      if (!matches.length) {
        if (!text(record.name)) return { recordId: record.id, status: 'manual', reason: '缺少姓名，不能新建居民档案', record };
        return { recordId: record.id, status: 'create', reason: '未找到同身份证居民，将新建档案', record };
      }
      const person = matches[0]; const nameConflict = text(personName(person)) && text(record.name) && text(personName(person)) !== text(record.name);
      const groupConflict = text(personGroup(person)) && text(record.groupName) && text(personGroup(person)) !== text(record.groupName);
      const conflicts = [];
      if (nameConflict) conflicts.push({ field: '姓名', residentValue: personName(person), subsidyValue: text(record.name) });
      if (groupConflict) conflicts.push({ field: '村民组', residentValue: personGroup(person), subsidyValue: text(record.groupName) });
      const incomingPhone = normalizedPhone(record.phone); const currentPhone = residentPhone(person);
      if (incomingPhone && currentPhone && incomingPhone !== currentPhone) conflicts.push({ field: '手机号', residentValue: currentPhone, subsidyValue: incomingPhone });
      const incomingCard = normalizeBankCard(record.bankCard); const accounts = bankAccounts(person); const hasIncomingCard = incomingCard && accounts.some((item) => normalizeBankCard(item.cardNumber) === incomingCard);
      if (incomingCard && accounts.length && !hasIncomingCard) conflicts.push({ field: '银行卡号', residentValue: accounts.map((item) => normalizeBankCard(item.cardNumber)).join('、'), subsidyValue: incomingCard });
      const incomingBankName = text(record.bankName); const currentBankName = residentBankName(person, incomingCard);
      if (incomingBankName && currentBankName && incomingBankName !== currentBankName) conflicts.push({ field: '开户行', residentValue: currentBankName, subsidyValue: incomingBankName });
      if (conflicts.length) return { recordId: record.id, status: 'manual', reason: conflicts.map((item) => `${item.field}与居民档案不一致`).join('；'), conflicts, record, personId: personId(person) };
      return { recordId: record.id, status: 'merge', reason: '身份证号一致，只补充居民档案空白信息', record, personId: personId(person) };
    });
  }

  function appendSubsidyResidentHistory(person, history) {
    const records = Array.isArray(person.farmlandSubsidyHistory) ? person.farmlandSubsidyHistory : [];
    if (!records.some((item) => text(item.ledgerId) === text(history.ledgerId) && text(item.recordId) === text(history.recordId))) records.push(history);
    person.farmlandSubsidyHistory = records;
    const sources = Array.isArray(person.importSources) ? person.importSources : [];
    if (!sources.some((item) => text(item.ledgerId) === text(history.ledgerId) && text(item.recordId) === text(history.recordId))) sources.push({ ...history, sourceType: 'farmland_subsidy_import' });
    person.importSources = sources;
  }

  function fillResidentFromSubsidy(person, record, ledger, now) {
    const changedFields = []; const fill = (key, value, aliases = []) => {
      if (!text(value) || text(person[key] || aliases.map((alias) => person[alias]).find((item) => text(item)))) return;
      person[key] = text(value); changedFields.push(key);
    };
    fill('name', record.name, ['person_name', 'resident_name']);
    fill('village_group', record.groupName, ['villageGroup', 'group', 'group_name']);
    fill('village_name', ledger?.villageName, ['villageName']);
    fill('phone', record.phone, ['mobile', 'mobile_phone']);
    if (!normalizedIdCard(person.id_card || person.idCard)) { person.id_card = normalizedIdCard(record.idCard); person.idCard = normalizedIdCard(record.idCard); changedFields.push('idCard'); }
    const card = normalizeBankCard(record.bankCard); const knownAccount = card && bankAccounts(person).find((item) => normalizeBankCard(item.cardNumber) === card);
    if (card && !defaultBankCard(person)) {
      setDefaultBankCard(person, card, { source: 'farmland-subsidy-import', now });
      const account = bankAccounts(person).find((item) => normalizeBankCard(item.cardNumber) === card);
      if (account && text(record.bankName)) account.bankName = text(record.bankName);
      if (text(record.bankName)) person.bank_name = text(record.bankName);
      changedFields.push('bankCard');
    } else if (knownAccount && !text(knownAccount.bankName) && text(record.bankName)) { knownAccount.bankName = text(record.bankName); if (!text(person.bank_name || person.bankName)) person.bank_name = text(record.bankName); changedFields.push('bankName'); }
    else if (!text(person.bank_name || person.bankName) && text(record.bankName)) { person.bank_name = text(record.bankName); changedFields.push('bankName'); }
    appendSubsidyResidentHistory(person, subsidyResidentImportHistory(record, ledger, now));
    person.updated_at = nowIso(now);
    return changedFields;
  }

  function importFarmlandSubsidyResidents({ ledger, selectedRecordIds = [], personnel = [] } = {}, { now = new Date() } = {}) {
    const nextLedger = structuredClone(ledger); const nextPersonnel = structuredClone(personnel || []); const plan = subsidyResidentImportPlan(nextLedger, selectedRecordIds, nextPersonnel);
    const results = []; let serial = 0;
    for (const item of plan) {
      if (item.status === 'manual') { results.push(item); continue; }
      const record = nextLedger.records.find((entry) => entry.id === item.recordId); let person;
      if (item.status === 'merge') person = nextPersonnel.find((entry) => personId(entry) === item.personId);
      else {
        serial += 1;
        person = { id: `personnel-subsidy-${now instanceof Date ? now.getTime() : Date.now()}-${serial}`, created_at: nowIso(now) };
        nextPersonnel.push(person);
      }
      const changedFields = fillResidentFromSubsidy(person, record, nextLedger, now);
      record.personId = personId(person); record.matchStatus = 'matched'; record.associationStatus = 'matched'; record.residentSyncStatus = 'synced'; record.associationNote = '由地力补贴批量导入居民档案并自动关联'; record.updatedAt = nowIso(now);
      results.push({ ...item, personId: personId(person), changedFields, status: item.status === 'create' ? 'created' : 'merged' });
    }
    nextLedger.updatedAt = nowIso(now);
    const summary = results.reduce((result, item) => { if (item.status === 'created') result.created += 1; else if (item.status === 'merged') result.merged += 1; else result.manual += 1; return result; }, { created: 0, merged: 0, manual: 0 });
    return { ledger: nextLedger, personnel: nextPersonnel, results, summary };
  }

  function resolveFarmlandSubsidyResidentConflict({ ledger, recordId, personId: selectedPersonId, personnel = [], resolution = 'keep' } = {}, { now = new Date() } = {}) {
    const nextLedger = structuredClone(ledger); const nextPersonnel = structuredClone(personnel || []);
    const record = (nextLedger?.records || []).find((item) => text(item.id) === text(recordId));
    const person = nextPersonnel.find((item) => personId(item) === text(selectedPersonId));
    if (!record) throw new Error('未找到补贴记录');
    if (!person) throw new Error('未找到确认关联的居民档案');
    const changedFields = fillResidentFromSubsidy(person, record, nextLedger, now);
    if (resolution === 'adopt') {
      const phone = normalizedPhone(record.phone); if (phone && residentPhone(person) !== phone) { person.phone = phone; changedFields.push('phone'); }
      const card = normalizeBankCard(record.bankCard);
      if (card && defaultBankCard(person) !== card) { setDefaultBankCard(person, card, { source: 'farmland-subsidy-manual-confirmation', now }); changedFields.push('bankCard'); }
      if (text(record.bankName)) {
        const account = bankAccounts(person).find((item) => normalizeBankCard(item.cardNumber) === normalizeBankCard(record.bankCard));
        if (account) account.bankName = text(record.bankName);
        person.bank_name = text(record.bankName); changedFields.push('bankName');
      }
    }
    record.personId = personId(person); record.matchStatus = 'matched'; record.associationStatus = 'matched'; record.residentSyncStatus = 'synced'; record.associationNote = resolution === 'adopt' ? '人工确认采用补贴表资料并同步居民档案' : '人工确认关联居民档案，保留原有资料'; record.updatedAt = nowIso(now);
    nextLedger.updatedAt = nowIso(now);
    return { ledger: nextLedger, personnel: nextPersonnel, personId: personId(person), changedFields: [...new Set(changedFields)] };
  }

  function subsidyRecordsNeedingResidentSync(ledger) {
    return (ledger?.records || []).filter((record) => record.matchStatus !== 'matched' || text(record.residentSyncStatus) !== 'synced');
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
    defaultDisbursementCategories, defaultDisbursementTemplates, normalizeDisbursementTemplate, createDisbursementTemplate, normalizeDisbursementCollections, createDisbursementCategory, createDisbursementBatch,
    summarizeDisbursementBatch, reviewDisbursementBatch, markDisbursementBatchPaid, summarizeDisbursementDashboard, recycleDisbursementBatch, restoreDisbursementBatch, copyDisbursementBatch, disbursementBatchIssues, disbursementBatchSyncStatus,
    DISBURSEMENT_TEMPLATE_KEYS, normalizeTemplateColumns, normalizeProfile, templateItem, createTemplateDisbursementBatch, prepareTemplateDisbursementBatch, markTemplateDisbursementPrinted,
    disbursementResidentCandidates, disbursementResidentSyncPlan, disbursementResidentImportPlan, syncDisbursementBatchResidents, completeTemplateDisbursementBatch,
    normalizedSubsidyRecord, createFarmlandSubsidyLedger, summarizeFarmlandSubsidyLedger, validateFarmlandSubsidyLedger, farmlandSubsidyPersonCandidates, subsidyRecordsNeedingResidentSync, subsidyResidentImportPlan, importFarmlandSubsidyResidents, resolveFarmlandSubsidyResidentConflict, correctFarmlandSubsidyRecord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContractFeeModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
