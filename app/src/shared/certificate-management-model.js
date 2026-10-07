'use strict';

(function exposeCertificateManagementModel(root) {
  const list = value => Array.isArray(value) ? value : [];
  const text = value => value == null ? '' : String(value).trim();
  const clone = value => structuredClone(value);
  const VARIABLE_PATTERN = /\{([^{}]+)\}/gu;

  function localIsoDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatCertificateDate(value) {
    const raw = text(value);
    const matched = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/u);
    if (!matched) return raw;
    return `${matched[1]}年${matched[2].padStart(2, '0')}月${matched[3].padStart(2, '0')}日`;
  }

  const DEFAULT_FIELDS = Object.freeze({
    '居民姓名': { key: 'person1.name', label: '居民姓名', type: 'resident', source: 'archive', subjectKey: 'person1', required: true },
    '身份证号': { key: 'person1.idCard', label: '身份证号', type: 'text', source: 'archive', subjectKey: 'person1', required: true },
    '性别': { key: 'person1.gender', label: '性别', type: 'text', source: 'archive', subjectKey: 'person1' },
    '出生日期': { key: 'person1.birthDate', label: '出生日期', type: 'date', source: 'archive', subjectKey: 'person1' },
    '年龄': { key: 'person1.age', label: '年龄', type: 'number', source: 'archive', subjectKey: 'person1' },
    '民族': { key: 'person1.ethnicity', label: '民族', type: 'text', source: 'archive', subjectKey: 'person1' },
    '联系电话': { key: 'person1.phone', label: '联系电话', type: 'text', source: 'archive', subjectKey: 'person1' },
    '居民小组': { key: 'person1.villageGroup', label: '居民小组', type: 'text', source: 'archive', subjectKey: 'person1' },
    '户号': { key: 'person1.householdNo', label: '户号', type: 'text', source: 'household', subjectKey: 'person1' },
    '常住地址': { key: 'person1.address', label: '常住地址', type: 'text', source: 'household', subjectKey: 'person1' },
    '第二居民姓名': { key: 'person2.name', label: '第二居民姓名', type: 'resident', source: 'archive', subjectKey: 'person2', required: true },
    '第二居民身份证号': { key: 'person2.idCard', label: '第二居民身份证号', type: 'text', source: 'archive', subjectKey: 'person2', required: true },
    '双方关系': { key: 'manual.relationship', label: '双方关系', type: 'text', source: 'manual', required: true },
    '家庭人口数': { key: 'household.population', label: '家庭人口数', type: 'number', source: 'household' },
    '承包地块数': { key: 'land.count', label: '承包地块数', type: 'number', source: 'land' },
    '承包总面积': { key: 'land.areaMu', label: '承包总面积', type: 'number', source: 'land' },
    '地块明细': { key: 'land.details', label: '地块明细', type: 'textarea', source: 'land' },
    '开具日期': { key: 'system.issuedDate', label: '开具日期', type: 'date', source: 'system' },
    '经办人': { key: 'system.operatorName', label: '经办人', type: 'text', source: 'system' },
    '单位名称': { key: 'system.organizationName', label: '单位名称', type: 'text', source: 'system' },
  });

  function slug(value) {
    return text(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '') || 'field';
  }

  function extractTemplateVariables(content) {
    return [...new Set([...String(content || '').matchAll(VARIABLE_PATTERN)].map(match => text(match[1])).filter(Boolean))];
  }

  function defaultFieldForVariable(label) {
    const canonical = text(label).replace(/村民/gu, '居民');
    if (DEFAULT_FIELDS[canonical]) return { ...clone(DEFAULT_FIELDS[canonical]), label: text(label) };
    if (/^第二(?:位)?(?:居民|村民|当事人)(?:姓名)?$/u.test(text(label))) return { ...clone(DEFAULT_FIELDS['第二居民姓名']), label: text(label) };
    if (/^第二(?:位)?(?:居民|村民|当事人)身份证号$/u.test(text(label))) return { ...clone(DEFAULT_FIELDS['第二居民身份证号']), label: text(label) };
    if (/^(?:两人之间关系|二人关系)$/u.test(text(label))) return { ...clone(DEFAULT_FIELDS['双方关系']), label: text(label) };
    const key = `manual.${slug(label)}`;
    return { key, label: text(label), type: /时间|日期/u.test(label) ? 'date' : /原因|说明|描述|明细|事项/u.test(label) ? 'textarea' : 'text', source: 'manual', required: true };
  }

  function residentProperty(field = {}) {
    const label = text(field.label || field.name || field.variable);
    const key = text(field.key || field.fieldKey);
    const suffix = key.includes('.') ? key.split('.').slice(1).join('.') : '';
    if (['name', 'idCard', 'gender', 'birthDate', 'age', 'ethnicity', 'phone', 'villageGroup', 'householdNo', 'address'].includes(suffix)) return suffix;
    if (/身份证/u.test(label)) return 'idCard';
    if (/性别/u.test(label)) return 'gender';
    if (/出生/u.test(label)) return 'birthDate';
    if (/年龄/u.test(label)) return 'age';
    if (/民族/u.test(label)) return 'ethnicity';
    if (/电话|手机/u.test(label)) return 'phone';
    if (/小组|组别/u.test(label)) return 'villageGroup';
    if (/户号/u.test(label)) return 'householdNo';
    if (/地址/u.test(label)) return 'address';
    return 'name';
  }

  function residentSubjectFor(field = {}) {
    const explicit = text(field.subjectKey);
    if (/^person\d+$/u.test(explicit)) return explicit;
    const keyMatch = text(field.key || field.fieldKey).match(/^(person\d+)\./u);
    if (keyMatch) return keyMatch[1];
    const label = text(field.label || field.name || field.variable);
    const chineseNumber = label.match(/第\s*([二三四五六七八九十\d]+)\s*(?:位)?(?:居民|村民|当事人|人员)/u)?.[1];
    if (chineseNumber) {
      const numberMap = { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      return `person${numberMap[chineseNumber] || Number(chineseNumber) || 1}`;
    }
    if (/另一位|另一人|对方/u.test(label)) return 'person2';
    return 'person1';
  }

  function bindResidentField(field = {}, subjectKey = residentSubjectFor(field)) {
    const subject = /^person\d+$/u.test(text(subjectKey)) ? text(subjectKey) : 'person1';
    const property = residentProperty(field);
    return { ...clone(field), source: 'archive', subjectKey: subject, key: `${subject}.${property}`,
      type: property === 'name' ? 'resident' : property === 'birthDate' ? 'date' : property === 'age' ? 'number' : 'text', readOnly: true };
  }

  function normalizeCertificateField(field, index = 0) {
    const input = typeof field === 'string' ? { label: field } : (field || {});
    const fallback = defaultFieldForVariable(input.label || input.name || input.variable || `字段${index + 1}`);
    const source = ['archive', 'household', 'land', 'manual', 'system'].includes(input.source) ? input.source : fallback.source;
    const normalized = { ...clone(input), ...fallback, ...clone(input),
      key: text(input.key || input.fieldKey || fallback.key),
      label: text(input.label || input.name || input.variable || fallback.label),
      type: text(input.type || fallback.type), source,
      required: input.required == null ? Boolean(fallback.required) : Boolean(input.required),
      order: Number.isFinite(Number(input.order)) ? Number(input.order) : index,
      readOnly: source !== 'manual',
    };
    if (normalized.source === 'archive') return bindResidentField(normalized, residentSubjectFor(normalized));
    if (!normalized.subjectKey && normalized.key.startsWith('person')) normalized.subjectKey = normalized.key.split('.')[0];
    return normalized;
  }

  function inferSubjects(fields) {
    const keys = new Set(fields.map(field => field.subjectKey).filter(Boolean));
    if (!keys.size && fields.some(field => field.source === 'household')) keys.add('person1');
    return [...keys].sort().map((key, index) => ({ key, label: index ? `第${index + 1}位当事人` : '当事人', required: true }));
  }

  function normalizeTemplateVersion(version, template = {}) {
    const content = String(version?.content ?? template.content ?? '');
    const supplied = list(version?.fields).length ? version.fields : list(template.fields).length ? template.fields : list(template.variables);
    const fields = (supplied.length ? supplied : extractTemplateVariables(content)).map(normalizeCertificateField).sort((a, b) => a.order - b.order);
    const inferredSubjects = inferSubjects(fields);
    const suppliedSubjects = list(version?.subjects).length ? version.subjects : list(template.subjects);
    const suppliedByKey = new Map(suppliedSubjects.map(subject => [text(subject.key), clone(subject)]));
    const subjects = inferredSubjects.map(subject => ({ ...subject, ...(suppliedByKey.get(subject.key) || {}), key: subject.key }));
    return { ...clone(version || {}), versionNumber: Math.max(1, Number(version?.versionNumber || version?.number || 1)),
      title: text(version?.title || template.title || template.name), content, fields,
      subjects,
      wordPath: version?.wordPath || version?.filePath || template.wordPath || template.filePath || '',
      createdAt: version?.createdAt || template.updatedAt || template.createdAt || null,
    };
  }

  function normalizeCertificateTemplate(template = {}) {
    const oldVersions = list(template.versions);
    const versions = oldVersions.length ? oldVersions.map(item => normalizeTemplateVersion(item, template)) : [normalizeTemplateVersion(null, template)];
    versions.sort((a, b) => a.versionNumber - b.versionNumber);
    const currentVersion = Math.max(1, Number(template.currentVersion || versions.at(-1)?.versionNumber || 1));
    const active = versions.find(item => item.versionNumber === currentVersion) || versions.at(-1);
    return { ...clone(template), schemaVersion: 2, id: text(template.id), name: text(template.name), category: text(template.category || '其他证明'),
      status: template.status || (template.disabled ? 'inactive' : 'active'), builtin: Boolean(template.builtin || template.isSystem),
      currentVersion: active.versionNumber, versions, title: active.title, content: active.content, fields: clone(active.fields), subjects: clone(active.subjects),
      sealEnabled: Boolean(template.sealEnabled ?? template.redSeal), wordPath: template.wordPath || template.filePath || '',
    };
  }

  function publishTemplateVersion(template, changes = {}, metadata = {}) {
    const current = normalizeCertificateTemplate(template);
    const versionNumber = current.versions.reduce((max, item) => Math.max(max, item.versionNumber), 0) + 1;
    const versionInput = { ...current.versions.at(-1), ...clone(changes), versionNumber,
      createdAt: metadata.now || new Date().toISOString(), createdBy: metadata.operatorName || '' };
    if (Object.hasOwn(changes, 'fields') && !Object.hasOwn(changes, 'subjects')) delete versionInput.subjects;
    const version = normalizeTemplateVersion(versionInput, { ...current, ...changes });
    return normalizeCertificateTemplate({ ...current, ...clone(changes), currentVersion: versionNumber, versions: [...current.versions, version], updatedAt: version.createdAt });
  }

  function getPath(object, path) {
    return text(path).split('.').reduce((value, key) => value == null ? undefined : value[key], object);
  }

  function buildSubjectSnapshot(person = {}, household = {}, landRows = []) {
    const birthDate = text(person.birthDate || person.birth_date);
    const birthYear = Number(birthDate.slice(0, 4));
    const age = Number.isInteger(birthYear) && birthYear > 0 ? new Date().getFullYear() - birthYear : '';
    const areaMu = list(landRows).reduce((sum, item) => sum + Number(item.areaMu ?? item.area ?? 0), 0);
    return { id: person.id || null, name: text(person.name), idCard: text(person.idCard || person.id_card || person.externalIdCard),
      gender: text(person.gender), birthDate, age, ethnicity: text(person.ethnicity || person.nation), phone: text(person.phone),
      villageGroup: text(person.villageGroup || person.village_group), householdNo: text(person.householdNo || person.household_id || household.householdNo),
      address: text(person.address || person.residentialAddress || household.address), registryStatus: text(person.registryStatus || person.registry_status),
      household: { id: household.id || person.householdId || null, headName: text(household.headName), population: Number(household.population || 0), address: text(household.address) },
      land: { count: list(landRows).length, areaMu: Number(areaMu.toFixed(2)), details: list(landRows).map(item => text(item.name || item.parcelName)).filter(Boolean).join('、') },
      source: person.temporary ? 'manual' : 'archive', temporary: Boolean(person.temporary) };
  }

  function replaceSubject(draft, subjectKey, snapshot) {
    const next = clone(draft || {}); next.subjects ||= {}; next.subjects[subjectKey] = snapshot ? clone(snapshot) : null; return next;
  }

  function contextValue(context, key) {
    if (key.startsWith('person')) return getPath(context.subjects || {}, key);
    if (key.startsWith('household.')) return getPath(context.subjects?.person1?.household || context.household || {}, key.slice(10));
    if (key.startsWith('land.')) return getPath(context.subjects?.person1?.land || context.land || {}, key.slice(5));
    return getPath(context, key);
  }

  function resolveFieldValue(field, context) {
    const normalized = normalizeCertificateField(field);
    const direct = context.values?.[normalized.key];
    return direct ?? contextValue(context, normalized.key) ?? '';
  }

  function renderCertificateContent(templateVersion, context = {}) {
    const version = normalizeTemplateVersion(templateVersion, templateVersion);
    const labels = new Map(version.fields.map(field => [field.label, resolveFieldValue(field, context)]));
    const missingVariables = [];
    const content = version.content.replace(VARIABLE_PATTERN, (_match, label) => {
      const value = labels.get(text(label));
      if (value === '' || value == null) { missingVariables.push(text(label)); return `{${text(label)}}`; }
      return String(value);
    });
    return { title: version.title, content, missingVariables: [...new Set(missingVariables)] };
  }

  function validateCertificateDraft(draft = {}, templateVersion = {}) {
    const version = normalizeTemplateVersion(templateVersion, templateVersion); const errors = [];
    for (const subject of version.subjects) if (subject.required !== false && !draft.subjects?.[subject.key]) errors.push(`${subject.label}尚未选择居民`);
    for (const field of version.fields) if (field.required && text(resolveFieldValue(field, draft)) === '') errors.push(`${field.label}不能为空`);
    for (const label of renderCertificateContent(version, draft).missingVariables) errors.push(`正文中的“${label}”尚未填写`);
    return { ok: !errors.length, errors: [...new Set(errors)] };
  }

  function createCertificateDraft(template, context = {}) {
    const normalized = normalizeCertificateTemplate(template);
    return { id: context.id || '', templateId: normalized.id, templateVersion: normalized.currentVersion, status: 'draft',
      subjects: clone(context.subjects || {}), values: clone(context.values || {}), system: clone(context.system || {}), createdAt: context.createdAt || new Date().toISOString() };
  }

  function createIssuedRecord(draft, templateVersion, metadata = {}) {
    const aiReviewed = draft.aiReviewed === true && text(draft.outputOverride?.content);
    if (!aiReviewed) {
      const validation = validateCertificateDraft(draft, templateVersion);
      if (!validation.ok) throw new Error(validation.errors.join('；'));
    }
    const rendered = aiReviewed ? { title: text(draft.outputOverride.title) || text(templateVersion.title), content: text(draft.outputOverride.content) }
      : renderCertificateContent(templateVersion, draft);
    const templateSnapshot = normalizeTemplateVersion(templateVersion, templateVersion);
    if (aiReviewed) templateSnapshot.wordPath = '';
    return { ...clone(draft), id: metadata.id || draft.id, status: '有效', internalRecordNo: metadata.internalRecordNo || '',
      issuedAt: metadata.issuedAt || new Date().toISOString(), operatorName: metadata.operatorName || '',
      templateSnapshot, subjectSnapshots: clone(draft.subjects || {}),
      valueSnapshot: clone(draft.values || {}), outputSnapshot: { title: rendered.title, content: rendered.content } };
  }

  function copyIssuedRecordToDraft(record) {
    return { templateId: record.templateId, templateVersion: record.templateVersion, status: 'draft', subjects: clone(record.subjectSnapshots || record.subjects || {}),
      values: clone(record.valueSnapshot || record.values || {}), system: {}, copiedFromRecordId: record.id, createdAt: new Date().toISOString() };
  }

  function voidIssuedRecord(record, reason, metadata = {}) {
    if (!text(reason)) throw new Error('作废证明必须填写原因');
    return { ...clone(record), status: '已作废', voidReason: text(reason), voidedAt: metadata.now || new Date().toISOString(), voidedBy: metadata.operatorName || '' };
  }

  function replaceEvery(content, value, placeholder) {
    const needle = text(value);
    return needle ? content.split(needle).join(placeholder) : content;
  }

  function createTemplateFromAiDraft(aiDraft = {}) {
    let content = String(aiDraft.content || '');
    const subjects = aiDraft.subjects || {};
    const subjectDefinitions = [
      ['person1', '居民姓名', '身份证号'],
      ['person2', '第二居民姓名', '第二居民身份证号'],
      ['person3', '第三居民姓名', '第三居民身份证号'],
    ];
    for (const [subjectKey, nameLabel, idLabel] of subjectDefinitions) {
      const subject = subjects[subjectKey] || {};
      content = replaceEvery(content, subject.idCard, `{${idLabel}}`);
      content = replaceEvery(content, subject.phone, `{${subjectKey === 'person1' ? '联系电话' : `${nameLabel}联系电话`}}`);
      content = replaceEvery(content, subject.address, `{${subjectKey === 'person1' ? '常住地址' : `${nameLabel}常住地址`}}`);
      content = replaceEvery(content, subject.name || aiDraft.residentNames?.[Number(subjectKey.slice(6)) - 1], `{${nameLabel}}`);
    }
    const manualValues = aiDraft.manualValues && typeof aiDraft.manualValues === 'object' ? aiDraft.manualValues : {};
    for (const [label, value] of Object.entries(manualValues)) content = replaceEvery(content, value, `{${text(label)}}`);
    const variables = extractTemplateVariables(content);
    const fields = variables.map((label, index) => normalizeCertificateField(defaultFieldForVariable(label), index));
    for (const [label] of Object.entries(manualValues)) if (!fields.some(field => field.label === text(label))) fields.push(normalizeCertificateField({ label, source: 'manual', required: true }, fields.length));
    return normalizeCertificateTemplate({
      id: '', name: text(aiDraft.templateName || aiDraft.title || 'AI 生成证明模板'), category: text(aiDraft.category || 'AI 开具'),
      title: text(aiDraft.title || '证明'), content, fields, subjects: inferSubjects(fields), builtin: false,
    });
  }

  function comparableCertificateText(value, replaceVariables = false) {
    let normalized = String(value || '').normalize('NFKC').toLocaleLowerCase();
    if (replaceVariables) normalized = normalized.replace(VARIABLE_PATTERN, '{}');
    return normalized.replaceAll(/[\s\p{P}\p{S}]/gu, '');
  }

  function certificateTextSimilarity(left, right) {
    const a = comparableCertificateText(left, true);
    const b = comparableCertificateText(right, true);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = value => {
      const result = new Set();
      for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
      if (!result.size) result.add(value);
      return result;
    };
    const leftGrams = grams(a); const rightGrams = grams(b);
    let shared = 0;
    for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
    return shared / (leftGrams.size + rightGrams.size - shared);
  }

  function compareCertificateTemplates(generatedTemplate, templates = []) {
    const generated = normalizeCertificateTemplate(generatedTemplate || {});
    const rows = list(templates).filter(item => item && !item.aiTemporary).map(normalizeCertificateTemplate);
    const generatedContent = comparableCertificateText(generated.content, true);
    const generatedName = comparableCertificateText(generated.name);
    const generatedTitle = comparableCertificateText(generated.title);
    const ranked = rows.map(item => {
      const sameContent = Boolean(generatedContent) && generatedContent === comparableCertificateText(item.content, true);
      const sameName = Boolean(generatedName) && generatedName === comparableCertificateText(item.name);
      const sameTitle = Boolean(generatedTitle) && generatedTitle === comparableCertificateText(item.title);
      const similarity = certificateTextSimilarity(generated.content, item.content);
      const level = sameContent ? 'exact' : sameName ? 'same-name' : similarity >= 0.62 || (sameTitle && similarity >= 0.45) ? 'similar' : 'none';
      const differences = [];
      if (!sameTitle) differences.push({ field: 'title', label: '证明标题', current: item.title, incoming: generated.title });
      if (!sameContent) differences.push({ field: 'content', label: '证明正文', current: item.content, incoming: generated.content });
      const currentFields = item.fields.map(field => field.label).join('、');
      const incomingFields = generated.fields.map(field => field.label).join('、');
      if (currentFields !== incomingFields) differences.push({ field: 'fields', label: '填写字段', current: currentFields, incoming: incomingFields });
      return { level, similarity: Number(similarity.toFixed(3)), template: item, differences };
    }).sort((left, right) => {
      const weight = { exact: 4, 'same-name': 3, similar: 2, none: 1 };
      return weight[right.level] - weight[left.level] || right.similarity - left.similarity;
    });
    return ranked[0] || { level: 'none', similarity: 0, template: null, differences: [] };
  }

  function findDuplicateCertificateTemplate(generatedTemplate, templates, preferredId = '') {
    const rows = list(templates).filter(item => item && !item.aiTemporary);
    const preferred = rows.find(item => text(item.id) === text(preferredId));
    if (preferred) return preferred;
    const generated = normalizeCertificateTemplate(generatedTemplate || {});
    const contentKey = comparableCertificateText(generated.content, true);
    const titleKey = comparableCertificateText(generated.title);
    const nameKey = comparableCertificateText(generated.name);
    return rows.find(item => {
      const candidate = normalizeCertificateTemplate(item);
      if (contentKey && contentKey === comparableCertificateText(candidate.content, true)) return true;
      if (nameKey && nameKey === comparableCertificateText(candidate.name)) return true;
      return titleKey && titleKey === comparableCertificateText(candidate.title);
    }) || null;
  }

  const api = { localIsoDate, formatCertificateDate, extractTemplateVariables, defaultFieldForVariable, bindResidentField, normalizeCertificateField, normalizeTemplateVersion, normalizeCertificateTemplate,
    publishTemplateVersion, buildSubjectSnapshot, replaceSubject, resolveFieldValue, renderCertificateContent, validateCertificateDraft,
    createCertificateDraft, createIssuedRecord, copyIssuedRecordToDraft, voidIssuedRecord, createTemplateFromAiDraft, findDuplicateCertificateTemplate,
    comparableCertificateText, certificateTextSimilarity, compareCertificateTemplates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CertificateManagementModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
