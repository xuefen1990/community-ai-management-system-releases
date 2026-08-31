'use strict';

function text(value) {
  return String(value ?? '').trim();
}

function yearFrom(value) {
  const matched = text(value).match(/(?:19|20)\d{2}/u);
  return matched ? Number(matched[0]) : null;
}

function cents(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value) {
  return `¥${(cents(value) / 100).toFixed(2)}`;
}

function personId(person) {
  return text(person?.id || person?.personId || person?.id_card || person?.idCard);
}

function personName(person) {
  return text(person?.name || person?.person_name || person?.resident_name);
}

function personGroup(person) {
  return text(person?.village_group || person?.villageGroup || person?.group || person?.group_name);
}

function paymentYear(item, batch) {
  return yearFrom(item?.paidAt)
    || yearFrom(batch?.completedAt)
    || yearFrom(batch?.batchDate)
    || yearFrom(batch?.period)
    || yearFrom(batch?.createdAt);
}

function lastUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'user' && text(message.content));
}

function isAnnualAmountQuestion(message) {
  const value = text(message);
  return /(发了|发放|实发|已发|累计).{0,18}(多少钱|多少|金额|总额|合计)|(多少钱|多少|金额|总额|合计).{0,18}(发了|发放|实发|已发|累计)/u.test(value);
}

function isSystemDataRequest(message) {
  const value = text(message);
  return /(村民|居民|人员|档案|发放|资金|承包费|补贴|合同|地块|值班|党员|台账|系统).{0,24}(多少|查询|查|统计|修改|新增|删除|导出|跳转|打开|看看|信息|记录)/u.test(value)
    || /(查询|查|统计|修改|新增|删除|导出|跳转|打开).{0,24}(村民|居民|人员|档案|发放|资金|承包费|补贴|合同|地块|值班|党员|台账|系统)/u.test(value);
}

function navigationTarget(message) {
  const value = text(message);
  if (!/(打开|进入|跳转|去).{0,14}(资金发放|发放中心)|(资金发放|发放中心).{0,14}(打开|进入|跳转|去)/u.test(value)) return null;
  return { target: 'tab-contract-fees', label: '资金发放中心' };
}

class AiAssistantService {
  constructor({ databaseStore, aiRouter, now = () => new Date() } = {}) {
    if (!databaseStore?.read) throw new TypeError('databaseStore is required');
    this.databaseStore = databaseStore;
    this.aiRouter = aiRouter;
    this.now = now;
    this.pendingAction = null;
  }

  currentYear() {
    return this.now().getFullYear();
  }

  resolveYear(message) {
    return yearFrom(message)
      || (/(今年|本年|本年度|这年度|这一年)/u.test(text(message)) ? this.currentYear() : null);
  }

  resolveRecipient(database, message) {
    const requested = text(message);
    const people = (database.personnel || [])
      .map((person) => ({ id: personId(person), name: personName(person), groupName: personGroup(person) }))
      .filter((person) => person.name && requested.includes(person.name));
    const longestNameLength = Math.max(0, ...people.map((person) => person.name.length));
    const sameNamePeople = people.filter((person) => person.name.length === longestNameLength);
    const groupSpecified = sameNamePeople.filter((person) => person.groupName && requested.includes(person.groupName));
    const matchedPeople = groupSpecified.length ? groupSpecified : sameNamePeople;
    if (matchedPeople.length === 1) return { kind: 'resident', recipient: matchedPeople[0] };
    if (matchedPeople.length > 1) return { kind: 'ambiguous', candidates: matchedPeople };

    const known = this.collectRecipients(database)
      .filter((recipient) => requested.includes(recipient.name));
    const longestKnownName = Math.max(0, ...known.map((recipient) => recipient.name.length));
    const matchedKnown = known.filter((recipient) => recipient.name.length === longestKnownName);
    if (matchedKnown.length === 1) return { kind: 'temporary', recipient: matchedKnown[0] };
    if (matchedKnown.length > 1) return { kind: 'ambiguous', candidates: matchedKnown };
    return { kind: 'missing' };
  }

  collectRecipients(database) {
    const recipients = [];
    const add = (item) => {
      const name = text(item?.name);
      if (!name) return;
      recipients.push({ id: text(item?.personId), name, groupName: text(item?.groupName) });
    };
    for (const batch of database.disbursementBatches || []) for (const item of batch.items || []) add(item);
    for (const batch of database.contractFeeBatches || []) for (const item of batch.items || []) add(item);
    const distinct = new Map();
    for (const recipient of recipients) {
      const key = `${recipient.id}|${recipient.name}|${recipient.groupName}`;
      distinct.set(key, recipient);
    }
    return [...distinct.values()];
  }

  collectAnnualPayments(database, recipient, year) {
    const records = [];
    const sameRecipient = (item) => recipient.id
      ? text(item?.personId) === recipient.id
      : text(item?.name) === recipient.name && text(item?.groupName) === recipient.groupName;
    const append = ({ batch, item, source, amountCents }) => {
      if (item?.paymentStatus !== 'paid' || !sameRecipient(item) || paymentYear(item, batch) !== year) return;
      records.push({
        source,
        categoryName: text(batch.categoryName || batch.contractName || source),
        amountCents: cents(amountCents),
        date: text(item.paidAt || batch.completedAt || batch.batchDate || batch.period),
        batchId: text(batch.id),
      });
    };
    for (const batch of database.disbursementBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '通用发放批次', amountCents: item.amountCents });
    }
    for (const batch of database.contractFeeBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '合同发放批次', amountCents: item.finalAmountCents ?? item.amountCents });
    }
    return records;
  }

  subsidyLedgerNotice(database, recipient, year) {
    const found = (database.farmlandSubsidyLedgers || []).some((ledger) => yearFrom(ledger.year) === year && (ledger.records || []).some((record) => (
      recipient.id ? text(record.personId) === recipient.id : text(record.name) === recipient.name && text(record.groupName) === recipient.groupName
    )));
    return found ? '地力补贴台账目前没有“已发放”状态，因此未计入本次实发合计。' : '';
  }

  formatAnnualAnswer({ recipient, records, year, subsidyNotice }) {
    const total = records.reduce((sum, record) => sum + record.amountCents, 0);
    if (!records.length) {
      return `${year} 年未查到“${recipient.name}”已登记发放的资金记录。${subsidyNotice || '只统计状态为“已发放”的记录。'}`;
    }
    const categories = new Map();
    for (const record of records) categories.set(record.categoryName, (categories.get(record.categoryName) || 0) + 1);
    const sourceText = [...categories.entries()].map(([name, count]) => `${name}${count}笔`).join('、');
    return `${year} 年“${recipient.name}”已登记发放共计 ${formatMoney(total)}，共 ${records.length} 笔（${sourceText}）。统计范围：通用发放批次和合同发放批次，按实际登记的发放日期计入。${subsidyNotice}`;
  }

  phoneUpdateProposal(database, message) {
    const requestedPhone = text(message).match(/(?:电话|手机(?:号)?).{0,12}?(?:改成|修改为|换成|更新为)\s*(1\d{10})/u)?.[1];
    if (!requestedPhone) return null;
    const resolved = this.resolveRecipient(database, message);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要修改哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') return { content: '我没有识别出要修改电话的居民。请补充姓名；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const person = (database.personnel || []).find((item) => personId(item) === resolved.recipient.id);
    const field = Object.prototype.hasOwnProperty.call(person || {}, 'phone') ? 'phone'
      : Object.prototype.hasOwnProperty.call(person || {}, 'mobile_phone') ? 'mobile_phone'
        : Object.prototype.hasOwnProperty.call(person || {}, 'mobilePhone') ? 'mobilePhone' : 'phone';
    const previousPhone = text(person?.[field]);
    if (previousPhone === requestedPhone) return { content: `${resolved.recipient.name}的手机号已经是 ${requestedPhone}，无需修改。`, provider: 'system', handled: true };
    this.pendingAction = {
      id: `ai-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'resident_phone_update',
      riskLevel: 'normal',
      personId: resolved.recipient.id,
      personName: resolved.recipient.name,
      groupName: resolved.recipient.groupName,
      field,
      before: { phone: previousPhone },
      after: { phone: requestedPhone },
      proposedAt: this.now().toISOString(),
    };
    return {
      content: `请确认修改：${resolved.recipient.name}${resolved.recipient.groupName ? `（${resolved.recipient.groupName}）` : ''}的手机号将从“${previousPhone || '未填写'}”改为“${requestedPhone}”。回复“确认”后执行；回复“取消”则不修改。`,
      provider: 'system', handled: true, needsConfirmation: true,
      action: { type: 'confirm', riskLevel: 'normal', before: this.pendingAction.before, after: this.pendingAction.after },
    };
  }

  async recordOperation(draft, database) {
    if (!Array.isArray(database.aiAssistantOperations)) database.aiAssistantOperations = [];
    database.aiAssistantOperations.push({
      id: draft.id || `ai-operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'ai_assistant',
      ...draft,
      createdAt: draft.createdAt || this.now().toISOString(),
    });
  }

  async executePendingAction() {
    const action = this.pendingAction;
    if (!action) return null;
    if (action.type !== 'resident_phone_update') throw new Error('暂不支持该 AI 操作类型');
    const outcome = await this.databaseStore.update(async (database) => {
      const person = (database.personnel || []).find((item) => personId(item) === action.personId);
      if (!person) throw new Error('该居民档案已不存在，请重新确认后再操作');
      const currentPhone = text(person[action.field]);
      if (currentPhone !== action.before.phone) throw new Error('居民电话已被其他操作修改，请重新查询后再确认');
      person[action.field] = action.after.phone;
      person.updated_at = this.now().toISOString();
      await this.recordOperation({
        id: action.id,
        type: action.type,
        module: '村民一户一档',
        object: { id: action.personId, name: action.personName, groupName: action.groupName },
        riskLevel: action.riskLevel,
        status: 'completed',
        before: action.before,
        after: action.after,
        recoverable: true,
        completedAt: this.now().toISOString(),
      }, database);
      return { person: { name: action.personName, groupName: action.groupName } };
    });
    this.pendingAction = null;
    return { content: `已修改${outcome.result.person.name}的手机号，并已写入 AI 助理记录。需要恢复时，请到“AI 助理记录”中手动撤销。`, provider: 'system', handled: true };
  }

  async cancelPendingAction() {
    if (!this.pendingAction) return null;
    const action = this.pendingAction;
    this.pendingAction = null;
    if (action.riskLevel === 'high') {
      await this.databaseStore.update(async (database) => this.recordOperation({
        id: action.id, type: action.type, module: 'AI 助理', object: { name: action.personName || '未指定对象' }, riskLevel: 'high', status: 'cancelled', before: action.before, after: action.after, recoverable: false,
      }, database));
    }
    return { content: '已取消，本次操作没有修改系统数据。', provider: 'system', handled: true };
  }

  async listOperations({ limit = 100 } = {}) {
    const database = await this.databaseStore.read();
    return [...(database.aiAssistantOperations || [])]
      .sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  async undoOperation({ operationId } = {}) {
    const id = text(operationId);
    if (!id) throw new Error('请选择需要撤销的操作记录');
    const outcome = await this.databaseStore.update(async (database) => {
      const operation = (database.aiAssistantOperations || []).find((item) => item.id === id);
      if (!operation) throw new Error('未找到该 AI 操作记录');
      if (!operation.recoverable || operation.status !== 'completed') throw new Error('该记录当前不能撤销');
      if (operation.type !== 'resident_phone_update') throw new Error('该操作类型暂不支持撤销');
      const person = (database.personnel || []).find((item) => personId(item) === text(operation.object?.id));
      if (!person) throw new Error('对应居民档案已不存在，不能自动撤销');
      const field = Object.prototype.hasOwnProperty.call(person, 'phone') ? 'phone'
        : Object.prototype.hasOwnProperty.call(person, 'mobile_phone') ? 'mobile_phone'
          : Object.prototype.hasOwnProperty.call(person, 'mobilePhone') ? 'mobilePhone' : 'phone';
      if (text(person[field]) !== text(operation.after?.phone)) throw new Error('该电话后来又被修改，不能自动撤销，请人工核对');
      person[field] = text(operation.before?.phone);
      person.updated_at = this.now().toISOString();
      operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
      await this.recordOperation({
        type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
        before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
      }, database);
      return { name: text(operation.object?.name) };
    });
    return { ok: true, message: `已撤销${outcome.result.name || '该居民'}的手机号修改。` };
  }

  async answerDirectQuestion(message) {
    if (!isAnnualAmountQuestion(message)) return null;
    const year = this.resolveYear(message);
    if (!year) return { content: '请告诉我需要查询哪一年，例如“张三 2026 年共计发了多少钱？”。我会只统计该年度已登记发放的记录。', provider: 'system', handled: true };
    const database = await this.databaseStore.read();
    const resolved = this.resolveRecipient(database, message);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要查询哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind === 'missing') return { content: '我没有识别出要查询的人员。请补充姓名；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const records = this.collectAnnualPayments(database, resolved.recipient, year);
    return {
      content: this.formatAnnualAnswer({
        recipient: resolved.recipient,
        records,
        year,
        subsidyNotice: this.subsidyLedgerNotice(database, resolved.recipient, year),
      }),
      provider: 'system',
      handled: true,
      data: { year, recipient: resolved.recipient, records },
    };
  }

  async converse({ messages } = {}) {
    const userMessage = lastUserMessage(messages);
    if (!userMessage) throw new Error('请先输入需要办理或查询的事项');
    if (this.pendingAction && /^(确认|同意|执行|好的|可以)$/u.test(text(userMessage.content))) return this.executePendingAction();
    if (this.pendingAction && /^(取消|不执行|算了|不要)$/u.test(text(userMessage.content))) return this.cancelPendingAction();
    const direct = await this.answerDirectQuestion(userMessage.content);
    if (direct) return direct;
    const database = await this.databaseStore.read();
    const phoneProposal = this.phoneUpdateProposal(database, userMessage.content);
    if (phoneProposal) return phoneProposal;
    const navigation = navigationTarget(userMessage.content);
    if (navigation) {
      return {
        content: `已为您打开${navigation.label}。`,
        provider: 'system',
        handled: true,
        action: { type: 'navigate', ...navigation },
      };
    }
    if (isSystemDataRequest(userMessage.content)) {
      return {
        content: '为避免误查或误操作，我还需要您说明具体对象和要办理的事项。例如“查询一组张三 2026 年的发放明细”或“打开资金发放中心”。信息不明确时，我不会自行猜测。',
        provider: 'system',
        handled: true,
        needsConfirmation: true,
      };
    }
    if (!this.aiRouter?.chat) return { content: 'AI 对话服务暂不可用，请稍后重试。', provider: 'system', handled: true };
    return this.aiRouter.chat({
      messages: [
        { role: 'system', content: '你是社区AI管理系统的 AI 助理。不得编造、猜测或声称已查询系统数据；对任何不清楚的系统操作或数据请求，必须先请操作员补充对象、范围或年度。' },
        ...(Array.isArray(messages) ? messages : []).slice(-12),
      ],
    });
  }
}

module.exports = { AiAssistantService, formatMoney, isAnnualAmountQuestion, isSystemDataRequest, paymentYear };
