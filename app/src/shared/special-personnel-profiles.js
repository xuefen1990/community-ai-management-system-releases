'use strict';

(function exposeSpecialPersonnelProfiles(root) {
  const text = (value) => String(value ?? '').trim();
  const normalize = (value) => text(value).replace(/[\s_（）()\-/]/g, '').toLocaleLowerCase('zh-CN');
  const normalizeIdCard = (value) => text(value).replace(/\s/g, '').toUpperCase();

  const COMMON_FIELD_DEFINITIONS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '村民姓名', '人员姓名', '名字'] },
    { key: 'idCard', label: '身份证号', aliases: ['身份证号', '身份证号码', '公民身份号码', '公民身份证号码', '证件号码'], required: true },
    { key: 'gender', label: '性别', aliases: ['性别'] },
    { key: 'ethnicity', label: '民族', aliases: ['民族'] },
    { key: 'birth_date', label: '出生日期', aliases: ['出生日期', '出生年月', '生日'] },
    { key: 'education', label: '学历', aliases: ['学历', '文化程度'] },
    { key: 'phone', label: '联系电话', aliases: ['联系电话', '手机号码', '手机号', '联系电话手机号', '电话', '联系方式'] },
    { key: 'household_id', label: '户号', aliases: ['户号', '家庭户号', '家庭编号'] },
    { key: 'village_group', label: '村民小组', aliases: ['村民小组', '村组', '小组', '组别'] },
    { key: 'relation_to_head', label: '与户主关系', aliases: ['与户主关系', '户主关系', '关系'] },
    { key: 'address', label: '住址', aliases: ['住址', '地址', '详细地址', '家庭住址'] },
  ];
  const SPECIAL_FIELD_DEFINITIONS = {
    '党员': [
      { key: 'party_branch', label: '所属党支部', aliases: ['所属党支部', '党支部', '所属党组织', '党组织'] },
      { key: 'party_join_date', label: '加入党组织日期', aliases: ['加入党组织日期', '入党日期', '入党时间', '加入党组织时间'] },
      { key: 'party_full_member_date', label: '转为正式党员日期', aliases: ['转为正式党员日期', '转正日期', '转正时间'] },
      { key: 'party_stage', label: '党员阶段', aliases: ['党员阶段', '党员类型', '发展阶段'] },
      { key: 'party_duty', label: '党内职务', aliases: ['党内职务', '党内岗位', '职务'] },
    ],
    '退役军人': [
      { key: 'service_unit', label: '服役部队', aliases: ['服役部队', '原部队', '服役单位'] },
      { key: 'enlistment_date', label: '入伍日期', aliases: ['入伍日期', '入伍时间'] },
      { key: 'discharge_date', label: '退役日期', aliases: ['退役日期', '退伍日期', '退役时间'] },
      { key: 'military_rank', label: '军衔/职务', aliases: ['军衔', '军队职务', '服役职务'] },
      { key: 'veteran_card_no', label: '优待证号', aliases: ['优待证号', '优待证'] },
      { key: 'placement_status', label: '安置/就业状态', aliases: ['安置状态', '就业状态', '安置就业状态'] },
    ],
    '低保户': [
      { key: 'assistance_category', label: '保障类别', aliases: ['保障类别', '低保类别', '救助类别'] },
      { key: 'recognition_date', label: '认定日期', aliases: ['认定日期', '享受日期', '审批日期'] },
      { key: 'assistance_amount', label: '保障金额', aliases: ['保障金额', '低保金额', '月保障金额'] },
      { key: 'household_size', label: '家庭人口', aliases: ['家庭人口', '保障人数', '家庭成员数'] },
      { key: 'hardship_reason', label: '致困原因', aliases: ['致困原因', '困难原因'] },
    ],
    '特困难户': [
      { key: 'assistance_category', label: '保障类别', aliases: ['保障类别', '特困类别', '救助类别'] },
      { key: 'recognition_date', label: '认定日期', aliases: ['认定日期', '享受日期', '审批日期'] },
      { key: 'assistance_amount', label: '保障金额', aliases: ['保障金额', '特困金额', '月保障金额'] },
      { key: 'household_size', label: '家庭人口', aliases: ['家庭人口', '保障人数', '家庭成员数'] },
      { key: 'hardship_reason', label: '致困原因', aliases: ['致困原因', '困难原因'] },
    ],
    '残疾人': [
      { key: 'disability_type', label: '残疾类别', aliases: ['残疾类别', '残疾类型'] },
      { key: 'disability_level', label: '残疾等级', aliases: ['残疾等级'] },
      { key: 'disability_card_no', label: '残疾证号', aliases: ['残疾证号', '残疾证号码'] },
      { key: 'disability_card_date', label: '发证日期', aliases: ['发证日期', '残疾证发证日期'] },
    ],
    '监测户': [
      { key: 'recognition_date', label: '识别日期', aliases: ['识别日期', '纳入监测日期'] },
      { key: 'risk_category', label: '风险类别', aliases: ['风险类别', '监测风险'] },
      { key: 'support_person', label: '帮扶责任人', aliases: ['帮扶责任人', '帮扶干部'] },
      { key: 'support_status', label: '帮扶状态', aliases: ['帮扶状态'] },
    ],
    '脱贫户': [
      { key: 'recognition_date', label: '识别日期', aliases: ['识别日期', '脱贫日期'] },
      { key: 'risk_category', label: '风险类别', aliases: ['风险类别'] },
      { key: 'support_person', label: '帮扶责任人', aliases: ['帮扶责任人', '帮扶干部'] },
      { key: 'support_status', label: '帮扶状态', aliases: ['帮扶状态'] },
    ],
  };

  function getSpecialFieldDefinitions(identity) {
    return SPECIAL_FIELD_DEFINITIONS[text(identity)] || [];
  }

  function getFieldDefinitions(identity) {
    return [...COMMON_FIELD_DEFINITIONS, ...getSpecialFieldDefinitions(identity)];
  }

  function inferredColumn(columns, aliases) {
    const targets = aliases.map(normalize);
    return (columns || []).find((column) => targets.includes(normalize(column))) || '';
  }

  function mappedValues(row, selection, definitions) {
    return Object.fromEntries((definitions || []).flatMap((field) => {
      const value = text(row?.[selection?.[field.key]]);
      return value ? [[field.key, value]] : [];
    }));
  }

  function mergeNonEmpty(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
      const cleaned = text(value);
      if (cleaned) target[key] = cleaned;
    });
    return target;
  }

  function buildSpecialProfile({ identity, idCard, personId, row, selection, columns, now }) {
    const fields = mappedValues(row, selection, getSpecialFieldDefinitions(identity));
    const selectedColumns = new Set(Object.values(selection || {}).filter(Boolean));
    const extraFields = Object.fromEntries((columns || []).flatMap((column) => {
      const value = text(row?.[column]);
      return value && !selectedColumns.has(column) ? [[column, value]] : [];
    }));
    return { identity: text(identity), idCard: normalizeIdCard(idCard), personId: text(personId), fields, extraFields, updated_at: now };
  }

  function upsertSpecialProfile(profiles, incoming, now) {
    const list = Array.isArray(profiles) ? profiles : [];
    const index = list.findIndex((profile) => text(profile?.identity) === incoming.identity && normalizeIdCard(profile?.idCard) === incoming.idCard);
    if (index < 0) {
      list.push({ id: `special-profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, ...incoming, created_at: now, updated_at: now });
      return { status: 'added', profile: list[list.length - 1] };
    }
    const profile = list[index];
    profile.personId = incoming.personId || profile.personId;
    profile.fields = mergeNonEmpty({ ...(profile.fields || {}) }, incoming.fields);
    profile.extraFields = mergeNonEmpty({ ...(profile.extraFields || {}) }, incoming.extraFields);
    profile.updated_at = now;
    return { status: 'updated', profile };
  }

  function upsertPartyMember(partyMembers, person, fields, now) {
    const list = Array.isArray(partyMembers) ? partyMembers : [];
    const idCard = normalizeIdCard(person?.idCard || person?.id_card);
    const index = list.findIndex((member) => normalizeIdCard(member?.idCard || member?.id_card) === idCard);
    const incoming = {
      name: text(person?.name), person_name: text(person?.name), personId: text(person?.id), person_id: text(person?.id),
      idCard, id_card: idCard, phone: text(person?.phone), village_group: text(person?.village_group), group: text(person?.village_group),
      branch: text(fields?.party_branch), party_branch: text(fields?.party_branch), join_date: text(fields?.party_join_date), party_join_date: text(fields?.party_join_date),
      formal_member_date: text(fields?.party_full_member_date), stage: text(fields?.party_stage) || '正式党员', duty: text(fields?.party_duty) || '普通党员',
      member_type: '本村党员', updated_at: now,
    };
    if (index < 0) {
      list.push({ id: `party-member-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, ...incoming, created_at: now });
      return { status: 'added', member: list[list.length - 1] };
    }
    mergeNonEmpty(list[index], incoming);
    list[index].updated_at = now;
    return { status: 'updated', member: list[index] };
  }

  const api = { COMMON_FIELD_DEFINITIONS, getSpecialFieldDefinitions, getFieldDefinitions, inferredColumn, mappedValues, buildSpecialProfile, upsertSpecialProfile, upsertPartyMember };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SpecialPersonnelProfiles = api;
}(typeof window !== 'undefined' ? window : null));
