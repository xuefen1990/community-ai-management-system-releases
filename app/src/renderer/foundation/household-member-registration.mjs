const baseRelations = ['子', '女', '孙子', '孙女', '外孙', '外孙女', '配偶', '父亲', '母亲', '兄弟', '姐妹', '其他'];
const registryTypes = ['本村常住户籍', '本村非常住户籍', '非本村户籍', '外来人员'];

const text = value => value == null ? '' : String(value).trim();
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}
function option(value, label = value) {
  const element = document.createElement('option');
  element.value = value; element.textContent = label;
  return element;
}
function field(label, control, required = false) {
  const wrapper = node('label', 'household-member-field');
  const title = node('span', 'household-member-field-label', label);
  if (required) title.appendChild(node('b', 'household-member-required', ' *'));
  wrapper.append(title, control);
  return wrapper;
}
function ageAt(birthDate, today = new Date()) {
  const match = text(birthDate).match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return '';
  let age = today.getFullYear() - Number(match[1]);
  if (today.getMonth() + 1 < Number(match[2]) || (today.getMonth() + 1 === Number(match[2]) && today.getDate() < Number(match[3]))) age--;
  return age >= 0 ? String(age) : '';
}

function relationshipOptions(dictionaryRows = [], householdMembers = []) {
  const values = new Set(baseRelations);
  for (const row of dictionaryRows) {
    const value = text(row?.label || row?.name || row?.value);
    if (value) values.add(value);
  }
  for (const member of householdMembers) {
    const value = text(member?.relationToHead || member);
    if (value) values.add(value);
  }
  values.delete('户主');
  values.delete('本人');
  return [...values];
}

export function installHouseholdMemberRegistration(loadScript) {
  const ready = loadScript('../shared/chinese-identity-card.js');
  window.communityCreateHouseholdMemberRegistration = ({ getProfile, selected, emit, dialogs }) => {
    let root = null;
    let detail = null;
    let dialogFooter = null;
    let context = null;
    let relations = [...baseRelations];
    let controls = null;
    let duplicate = null;
    let duplicateHouseholdNo = '';
    let lastLookupIdentity = '';
    let lookupSequence = 0;
    let lookupTimer = null;
    let saving = false;
    let disposed = false;

    const request = async (method, path, body) => {
      const result = await window.api.businessRequest({ method, path: `/api/v3${path}`, body });
      if (!result.ok) throw Object.assign(new Error(result.error?.message || '操作失败'), { code: result.error?.code });
      return result.data;
    };
    const locate = () => {
      root = document.querySelector('.household-360-dialog #foundation-household-member-root');
      detail = root?.nextElementSibling || null;
      dialogFooter = root?.closest('.el-dialog')?.querySelector('.el-dialog__footer') || null;
      return root;
    };
    const showError = message => {
      if (!controls) return;
      controls.error.textContent = text(message);
      controls.error.hidden = !text(message);
    };
    const setSaving = value => {
      saving = value;
      if (!controls) return;
      controls.finish.disabled = value;
      controls.continue.disabled = value;
      controls.cancel.disabled = value;
      controls.finish.textContent = value ? '正在保存…' : (duplicate ? '将已有居民加入本户' : '保存并完成');
    };
    const inheritedSummary = () => {
      const values = [
        `户号 ${context.householdNo}`,
        context.head?.name ? `户主 ${context.head.name}` : '未标记户主',
        context.villageGroupName || '未划组',
        context.address || '家庭地址暂未登记',
      ];
      controls.inherited.replaceChildren(...values.map(value => node('span', 'household-member-inherited-pill', value)));
    };
    const clearDuplicate = () => {
      duplicate = null; duplicateHouseholdNo = '';
      if (!controls) return;
      controls.existing.hidden = true;
      controls.name.disabled = false;
      controls.finish.disabled = false;
      controls.continue.hidden = false;
      controls.finish.textContent = '保存并完成';
      controls.registryType.disabled = false;
      controls.optional.hidden = false;
      controls.population.hidden = false;
    };
    const lookupIdentity = async profile => {
      const sequence = ++lookupSequence;
      controls.identityState.textContent = '正在检查是否已有档案…';
      try {
        const result = await request('GET', `/people?keyword=${encodeURIComponent(profile.normalized)}&limit=20`);
        if (sequence !== lookupSequence || disposed) return false;
        lastLookupIdentity = profile.normalized;
        duplicate = (result.items || []).find(person => window.CommunityIdentityCard.normalize(person.idCard) === profile.normalized) || null;
        if (!duplicate) {
          clearDuplicate();
          controls.identityState.textContent = '身份证号校验通过，未发现重复档案';
          controls.identityState.className = 'household-member-identity-state is-valid';
          return true;
        }
        duplicateHouseholdNo = '';
        if (duplicate.householdId) {
          try {
            const householdResult = await request('GET', `/households/${encodeURIComponent(duplicate.householdId)}`);
            duplicateHouseholdNo = householdResult.item?.householdNo || '';
          } catch (_) { /* The exact resident match is still authoritative. */ }
        }
        if (sequence !== lookupSequence || disposed) return false;
        controls.name.value = duplicate.name || '';
        controls.name.disabled = true;
        controls.existing.hidden = false;
        controls.existingTitle.textContent = `已找到居民档案：${duplicate.name || '未命名居民'}`;
        controls.existingMeta.textContent = duplicateHouseholdNo
          ? `当前户号：${duplicateHouseholdNo}。系统不会重复建档。`
          : '该居民尚未归入家庭，系统不会重复建档。';
        controls.continue.hidden = true;
        controls.registryType.disabled = true;
        controls.optional.hidden = true;
        controls.population.hidden = true;
        controls.finish.textContent = duplicateHouseholdNo === context.householdNo ? '该居民已在本户' : '将已有居民加入本户';
        controls.finish.disabled = duplicateHouseholdNo === context.householdNo;
        controls.identityState.textContent = '该身份证号已有档案';
        controls.identityState.className = 'household-member-identity-state is-existing';
        return true;
      } catch (error) {
        if (sequence !== lookupSequence) return false;
        clearDuplicate(); showError(error.message);
        return false;
      }
    };
    const updateIdentity = () => {
      clearTimeout(lookupTimer); lookupSequence++;
      lastLookupIdentity = '';
      clearDuplicate(); showError('');
      controls.idCard.value = window.CommunityIdentityCard.normalize(controls.idCard.value);
      const profile = window.CommunityIdentityCard.validate(controls.idCard.value);
      controls.birthDate.textContent = profile.valid ? profile.birthDate : '等待有效身份证号';
      controls.gender.textContent = profile.valid ? profile.gender : '-';
      controls.age.textContent = profile.valid ? `${ageAt(profile.birthDate)} 岁` : '-';
      controls.identityState.textContent = controls.idCard.value ? `身份证号${profile.reason}` : '输入后自动识别出生日期和性别';
      controls.identityState.className = `household-member-identity-state${profile.valid ? ' is-valid' : controls.idCard.value ? ' is-error' : ''}`;
      if (profile.valid) lookupTimer = setTimeout(() => lookupIdentity(profile), 250);
    };
    const resetMemberFields = () => {
      duplicate = null; duplicateHouseholdNo = ''; lastLookupIdentity = ''; lookupSequence++; clearTimeout(lookupTimer);
      controls.form.reset();
      controls.registryType.value = context.registryType || registryTypes[0];
      controls.countInPopulation.checked = true;
      controls.name.disabled = false;
      controls.birthDate.textContent = '等待有效身份证号';
      controls.gender.textContent = '-'; controls.age.textContent = '-';
      controls.identityState.textContent = '输入后自动识别出生日期和性别';
      controls.identityState.className = 'household-member-identity-state';
      controls.existing.hidden = true; controls.continue.hidden = false; controls.finish.disabled = false;
      controls.finish.textContent = '保存并完成'; showError('');
      inheritedSummary();
      controls.idCard.focus();
    };
    const close = async (force = false) => {
      if (!root || (saving && !force)) return;
      const dirty = controls && [controls.idCard.value, controls.name.value, controls.relation.value, controls.phone.value].some(text);
      if (!force && dirty && !await dialogs.confirm('已填写的新成员资料尚未保存，确定返回成员详情吗？', { title: '放弃未保存内容' })) return;
      clearTimeout(lookupTimer); lookupSequence++;
      root.replaceChildren(); root.hidden = true;
      if (detail) detail.hidden = false;
      if (dialogFooter) dialogFooter.hidden = false;
      controls = null; context = null; duplicate = null;
    };
    const submit = async keepOpen => {
      if (saving || !controls || !context) return;
      showError('');
      const identity = window.CommunityIdentityCard.validate(controls.idCard.value);
      if (!identity.valid) { showError(`身份证号${identity.reason}`); controls.idCard.focus(); return; }
      if (lastLookupIdentity !== identity.normalized && !await lookupIdentity(identity)) return;
      if (duplicate && duplicateHouseholdNo === context.householdNo) { showError('该居民已经是当前家庭成员'); return; }
      if (!text(controls.relation.value)) { showError('请选择新成员与户主的关系'); controls.relation.focus(); return; }
      if (!duplicate && !text(controls.name.value)) { showError('请填写新成员姓名'); controls.name.focus(); return; }
      const name = duplicate?.name || text(controls.name.value);
      const relation = text(controls.relation.value);
      const summary = `将“${name}”登记为${context.head?.name || `户号 ${context.householdNo}`}户家庭成员，与户主关系为“${relation}”${controls.countInPopulation.checked ? '，计入本户人口' : ''}。`;
      const title = duplicate ? '确认调整家庭' : '确认新增家庭成员';
      const movement = duplicateHouseholdNo && duplicateHouseholdNo !== context.householdNo
        ? `\n\n该居民目前属于户号 ${duplicateHouseholdNo}，确认后将从原家庭调整到户号 ${context.householdNo}。`
        : '';
      if (!await dialogs.confirm(summary + movement, { title })) return;
      setSaving(true);
      try {
        const body = duplicate ? {
          mode: 'move-existing', contextVersion: context.version,
          existingPersonId: duplicate.id, existingPersonVersion: duplicate.version,
          relationToHead: relation, confirmedMove: Boolean(duplicateHouseholdNo && duplicateHouseholdNo !== context.householdNo),
        } : {
          mode: 'create', contextVersion: context.version,
          fields: {
            idCard: identity.normalized, name, relationToHead: relation,
            phone: text(controls.phone.value), educationLevel: text(controls.education.value), ethnicity: text(controls.ethnicity.value),
            registryType: controls.registryType.value, registryStatus: '正常', countInPopulation: controls.countInPopulation.checked,
          },
        };
        const result = await request('POST', `/households/${encodeURIComponent(context.id)}/members`, body);
        context = result.household;
        if (selected) selected.value = result.person;
        emit('refresh');
        dialogs.notify({ type: 'success', message: `已将${result.person.name}登记为本户家庭成员` });
        if (keepOpen && !duplicate) resetMemberFields();
        else await close(true);
      } catch (error) { showError(error.message); }
      finally { setSaving(false); }
    };
    const render = () => {
      const shell = node('section', 'household-member-registration');
      const header = node('header', 'household-member-registration-header');
      const heading = node('div'); heading.append(node('h4', '', '新增家庭成员'), node('p', '', '建立居民档案并自动归入当前家庭'));
      const back = node('button', 'household-member-secondary', '返回成员详情'); back.type = 'button'; back.addEventListener('click', () => close());
      header.append(heading, back);
      const inherited = node('div', 'household-member-inherited');
      const inheritedTitle = node('div', 'household-member-inherited-title', '已自动带入家庭信息');
      const inheritedValues = node('div', 'household-member-inherited-values'); inherited.append(inheritedTitle, inheritedValues);
      const error = node('div', 'household-member-error'); error.hidden = true; error.setAttribute('role', 'alert');
      const form = node('form', 'household-member-form'); form.addEventListener('submit', event => { event.preventDefault(); submit(false); });
      const idCard = document.createElement('input'); idCard.maxLength = 18; idCard.autocomplete = 'off'; idCard.placeholder = '输入18位身份证号';
      const identityState = node('div', 'household-member-identity-state', '输入后自动识别出生日期和性别');
      const identityWrap = node('div', 'household-member-id-wrap'); identityWrap.append(field('身份证号', idCard, true), identityState);
      const profile = node('div', 'household-member-derived');
      const derived = label => { const item = node('div'); item.append(node('span', '', label), node('strong', '', '-')); profile.appendChild(item); return item.lastElementChild; };
      const birthDate = derived('出生日期'); const gender = derived('性别'); const age = derived('年龄'); birthDate.textContent = '等待有效身份证号';
      const name = document.createElement('input'); name.placeholder = '输入新成员姓名';
      const relation = document.createElement('select'); relation.append(option('', '请选择')); relations.forEach(item => relation.append(option(item)));
      const registryType = document.createElement('select'); registryTypes.forEach(item => registryType.append(option(item)));
      const mainGrid = node('div', 'household-member-grid'); mainGrid.append(field('姓名', name, true), field('与户主关系', relation, true), field('户籍类型', registryType));
      const existing = node('div', 'household-member-existing'); existing.hidden = true;
      const existingTitle = node('strong'); const existingMeta = node('span'); existing.append(existingTitle, existingMeta);
      const optional = document.createElement('details'); optional.className = 'household-member-optional';
      optional.appendChild(node('summary', '', '补充资料（选填）'));
      const optionalGrid = node('div', 'household-member-grid');
      const phone = document.createElement('input'); phone.placeholder = '可留空'; phone.inputMode = 'tel';
      const education = document.createElement('select'); ['','学龄前','小学','初中','高中','中专','大专','本科','研究生'].forEach(item => education.append(option(item, item || '未填写')));
      const ethnicity = document.createElement('input'); ethnicity.placeholder = '例如：汉族';
      optionalGrid.append(field('联系电话', phone), field('文化程度', education), field('民族', ethnicity)); optional.appendChild(optionalGrid);
      const populationLabel = node('label', 'household-member-population');
      const countInPopulation = document.createElement('input'); countInPopulation.type = 'checkbox'; countInPopulation.checked = true;
      populationLabel.append(countInPopulation, node('span', '', '计入本村法定户籍总人口'));
      const actions = node('footer', 'household-member-actions');
      const cancel = node('button', 'household-member-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => close());
      const continueButton = node('button', 'household-member-secondary', '保存并继续添加'); continueButton.type = 'button'; continueButton.addEventListener('click', () => submit(true));
      const finish = node('button', 'household-member-primary', '保存并完成'); finish.type = 'submit';
      actions.append(cancel, continueButton, finish);
      form.append(identityWrap, profile, existing, mainGrid, optional, populationLabel, actions);
      shell.append(header, inherited, error, form); root.replaceChildren(shell);
      controls = { form, inherited: inheritedValues, error, idCard, identityState, birthDate, gender, age, name, relation, registryType,
        existing, existingTitle, existingMeta, optional, population: populationLabel, phone, education, ethnicity, countInPopulation, cancel, continue: continueButton, finish };
      registryType.value = context.registryType || registryTypes[0];
      idCard.addEventListener('input', updateIdentity);
      inheritedSummary(); idCard.focus();
    };
    return {
      async open() {
        if (disposed || !locate()) return;
        const profile = getProfile();
        if (!profile?.householdId || profile.isPersonal) {
          dialogs.notify({ type: 'warning', message: '请先为该居民登记户号，再添加家庭成员' }); return;
        }
        try {
          await ready;
          context = await request('GET', `/households/${encodeURIComponent(profile.householdId)}/member-registration`);
          const dictionary = await request('GET', '/dictionaries?category=household_relation&limit=1000').catch(() => ({ items: [] }));
          relations = relationshipOptions(dictionary.items, context.members);
          root.hidden = false; if (detail) detail.hidden = true; if (dialogFooter) dialogFooter.hidden = true; render();
        } catch (error) { dialogs.notify({ type: 'error', message: error.message }); }
      },
      dispose() {
        disposed = true; clearTimeout(lookupTimer); lookupSequence++;
        if (root) root.replaceChildren(); if (detail) detail.hidden = false; if (dialogFooter) dialogFooter.hidden = false;
      },
    };
  };
}

export const householdMemberRegistration = { ageAt, relationshipOptions };
