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

  function ledgerItemFromMatch(match, now = new Date()) {
    if (!match?.person) throw new Error('发放台账存在未匹配居民');
    const population = numberValue(match.population);
    const acreage = numberValue(match.acreage);
    const unitPrice = text(match.unitPrice);
    let calculationType = 'direct'; let quantity = 0;
    if (population > 0) { calculationType = 'population'; quantity = population; }
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

  function createLedger({ contractId, matches, source = {} }, { now = new Date(), id } = {}) {
    if (!text(contractId)) throw new Error('必须选择对应合同');
    const items = matches.map((match) => ledgerItemFromMatch(match, now));
    if (!items.length) throw new Error('台账中至少需要一名居民');
    return {
      id: id || identifier('contract-fee-ledger', now instanceof Date ? now.getTime() : Date.now()), contractId: text(contractId),
      items, source: { fileName: text(source.fileName), sheetName: text(source.sheetName), importedAt: nowIso(now) },
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

  const api = {
    amountToCents, centsToYuan, numberValue, normalizeBankCard, personName, personGroup, personStatus, personId,
    bankAccounts, defaultBankCard, setDefaultBankCard, calculateAmount, matchImportedRows, createContract, createLedger,
    copyLedger, replaceLedgerPerson, createBatch, summarizeBatch, validateBatch, deriveBatchStatus, reviewBatch,
    markBatchExported, updatePaymentResults, createReceipt, createAdvance, reimburseAdvance,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContractFeeModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
