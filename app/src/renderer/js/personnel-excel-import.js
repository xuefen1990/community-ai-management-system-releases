(() => {
  'use strict';

  const getExcelParser = () => window.PersonnelExcelParser;
  const getProfileTools = () => window.SpecialPersonnelProfiles;
  const importState = { columns: [], rows: [], fileName: '', sheetName: '', detectedIdentity: '', headerRowNumber: 0, ignoredRows: 0 };
  const text = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => text(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const normalizeHeader = (value) => getExcelParser()?.normalizeHeader(value) || text(value).replace(/[\s_（）()\-]/g, '').toLowerCase();
  const getMergeTools = () => window.PersonnelImportMerge;

  function fieldDefinitions(identity = selectedIdentity()) {
    return getProfileTools()?.getFieldDefinitions(identity) || getExcelParser()?.FIELD_DEFINITIONS || [];
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') return window.showToast(message, type);
    window.alert(message);
  }

  function closeModal() {
    const modal = document.getElementById('excelImportModal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
  }

  function mapping() {
    return Object.fromEntries(fieldDefinitions().map((field) => [field.key, document.querySelector(`[data-personnel-import-field="${field.key}"]`)?.value || '']));
  }

  function selectedIdentity() {
    return text(document.getElementById('excelImportCustomIdentity')?.value) || text(document.getElementById('excelImportIdentity')?.value);
  }

  function renderPreview() {
    const header = document.getElementById('excelPreviewHead');
    const body = document.getElementById('excelPreviewBody');
    if (!header || !body) return;
    header.innerHTML = `<tr>${importState.columns.map((column) => `<th style="padding:8px 10px;text-align:left;white-space:nowrap;">${escapeHtml(column)}</th>`).join('')}</tr>`;
    body.innerHTML = importState.rows.slice(0, 3).map((row) => `<tr>${importState.columns.map((column) => `<td style="padding:8px 10px;border-top:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(row[column])}</td>`).join('')}</tr>`).join('');
  }

  function renderIdentitySelector() {
    const tools = getMergeTools();
    const identities = tools?.SPECIAL_IDENTITIES || [];
    importState.detectedIdentity = tools?.detectSpecialIdentity({ fileName: importState.fileName, sheetName: importState.sheetName, columns: importState.columns }) || '';
    const options = identities.map(({ label }) => `<option value="${escapeHtml(label)}"${label === importState.detectedIdentity ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const detectedHint = importState.detectedIdentity
      ? `已自动识别为“<b>${escapeHtml(importState.detectedIdentity)}</b>”，如不正确可手动修改。`
      : '未能唯一识别专项身份，请选择标签后再导入。';
    return `<div style="display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:center;font-size:13px;color:var(--text-primary);margin-bottom:8px;"><span>专项标签 <b style="color:#ef4444">*</b></span><div style="display:grid;gap:6px;"><select id="excelImportIdentity" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-primary);"><option value="">请选择标签</option>${options}</select><input id="excelImportCustomIdentity" type="text" maxlength="30" placeholder="或输入其他标签（优先使用此项）" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-primary);"><small style="color:var(--text-secondary);line-height:1.45;">${detectedHint}</small></div></div>`;
  }

  function renderMappingFields() {
    const container = document.getElementById('excelMappingContainer');
    if (!container) return;
    const profileTools = getProfileTools();
    const identity = selectedIdentity();
    const definitions = fieldDefinitions(identity);
    const specialCount = profileTools?.getSpecialFieldDefinitions(identity).length || 0;
    container.innerHTML = definitions.map((field) => {
      const suggested = profileTools?.inferredColumn(importState.columns, field.aliases) || importState.columns.find((column) => field.aliases.map(normalizeHeader).includes(normalizeHeader(column))) || '';
      return `<label style="display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:center;font-size:13px;color:var(--text-primary);"><span>${escapeHtml(field.label)}${field.required ? ' <b style="color:#ef4444">*</b>' : ''}</span><select data-personnel-import-field="${field.key}" style="padding:7px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-primary);"><option value="">本次不导入</option>${importState.columns.map((column) => `<option value="${escapeHtml(column)}"${column === suggested ? ' selected' : ''}>${escapeHtml(column)}</option>`).join('')}</select></label>`;
    }).join('');
    const summary = document.getElementById('excelMappingSummary');
    if (summary) summary.innerHTML = `<div style="padding:9px 12px;background:rgba(16,185,129,.08);border-radius:8px;color:var(--text-primary);font-size:13px;">已读取 <b>${escapeHtml(importState.fileName)}</b>（工作表：<b>${escapeHtml(importState.sheetName)}</b>），第 <b>${importState.headerRowNumber}</b> 行为表头，共 <b>${importState.rows.length}</b> 条有效数据${importState.ignoredRows ? `，已自动忽略 <b>${importState.ignoredRows}</b> 条无效行` : ''}${identity ? `；将写入“<b>${escapeHtml(identity)}</b>”专项档案${specialCount ? `及 <b>${specialCount}</b> 个专属字段` : ''}` : ''}。</div>`;
  }

  function openMappingModal() {
    const modal = document.getElementById('excelImportModal');
    const container = document.getElementById('excelMappingContainer');
    const confirm = document.getElementById('confirmExcelImportBtn');
    if (!modal || !container || !confirm) return;
    document.getElementById('excelImportModalTitle').textContent = '专项人员信息导入';
    document.getElementById('excelImportModeHint').innerHTML = '系统将以<b>身份证号</b>作为唯一合并凭证：匹配到已有居民时仅补充非空信息并追加标签；找不到居民时会新建档案。无效或缺失身份证号不会按姓名自动合并。';
    document.getElementById('excelImportScopeSelector').innerHTML = renderIdentitySelector();
    renderMappingFields();
    document.getElementById('excelImportIdentity')?.addEventListener('change', renderMappingFields);
    document.getElementById('excelImportCustomIdentity')?.addEventListener('input', renderMappingFields);
    document.getElementById('excelImportStats').textContent = `将核对 ${importState.rows.length} 条数据（预览仅显示前 3 条）`;
    confirm.textContent = `确认导入 ${importState.rows.length} 人`;
    renderPreview();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function personFromRow(row, selected) {
    const person = {};
    for (const field of getProfileTools()?.COMMON_FIELD_DEFINITIONS || getExcelParser()?.FIELD_DEFINITIONS || []) if (selected[field.key]) person[field.key] = text(row[selected[field.key]]);
    if (['男', 'male', 'M'].includes(person.gender)) person.gender = '男';
    if (['女', 'female', 'F'].includes(person.gender)) person.gender = '女';
    return person;
  }

  async function refreshPersonnelWorkspace() {
    if (typeof window.loadDatabase === 'function') await window.loadDatabase();
    if (typeof window.renderOverview === 'function') window.renderOverview();
    if (typeof window.filterPersonnel === 'function') window.filterPersonnel();
  }

  async function persistImport() {
    const selected = mapping();
    const identity = selectedIdentity();
    const tools = getMergeTools();
    const profileTools = getProfileTools();
    if (!tools) return showToast('专项人员合并组件尚未加载，请重新打开软件后再试', 'error');
    if (!profileTools) return showToast('专项档案组件尚未加载，请重新打开软件后再试', 'error');
    if (!selected.idCard) return showToast('专项人员合并必须选择“身份证号”对应列', 'error');
    if (!identity) return showToast('请确认或手动选择本次导入的专项标签', 'error');
    if (!window.api?.readDb || !window.api?.writeDb) return showToast('当前运行环境无法写入本地数据，请使用桌面安装版软件', 'error');
    const confirm = document.getElementById('confirmExcelImportBtn');
    const originalLabel = confirm.textContent;
    confirm.disabled = true;
    confirm.textContent = '正在保存…';
    try {
      const database = await window.api.readDb();
      const personnel = Array.isArray(database.personnel) ? database.personnel : [];
      const specialPersonnelProfiles = Array.isArray(database.specialPersonnelProfiles) ? database.specialPersonnelProfiles : [];
      const partyMembers = Array.isArray(database.partyMembers) ? database.partyMembers : [];
      const importedAt = new Date().toISOString();
      const skippedReasons = {};
      let added = 0; let merged = 0; let skipped = 0; let labelsAdded = 0; let profilesAdded = 0; let profilesUpdated = 0; let partyMembersAdded = 0; let partyMembersUpdated = 0;
      const skip = (reason) => { skipped += 1; skippedReasons[reason] = (skippedReasons[reason] || 0) + 1; };
      for (const row of importState.rows) {
        const incoming = personFromRow(row, selected);
        const idCard = tools.normalizeIdCard(incoming.idCard);
        if (!idCard) { skip('缺少身份证号'); continue; }
        if (!tools.isValidIdCard(idCard)) { skip('身份证号格式或校验错误'); continue; }
        incoming.idCard = idCard;
        const match = tools.findUniquePersonById(personnel, idCard);
        if (match.status === 'duplicate') { skip('本地身份证号重复'); continue; }
        let person;
        if (match.status === 'matched') {
          if (tools.mergeResidentInformation(match.person, incoming, identity, importedAt).identityAdded) labelsAdded += 1;
          merged += 1;
          person = match.person;
        } else {
          if (!incoming.name) { skip('未匹配居民且缺少姓名'); continue; }
          person = { id: `personnel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, created_at: importedAt };
          if (tools.mergeResidentInformation(person, incoming, identity, importedAt).identityAdded) labelsAdded += 1;
          personnel.push(person);
          added += 1;
        }
        const profile = profileTools.buildSpecialProfile({ identity, idCard, personId: person.id, row, selection: selected, columns: importState.columns, now: importedAt });
        if (profileTools.upsertSpecialProfile(specialPersonnelProfiles, profile, importedAt).status === 'added') profilesAdded += 1;
        else profilesUpdated += 1;
        if (identity === '党员') {
          const partyResult = profileTools.upsertPartyMember(partyMembers, person, profile.fields, importedAt);
          if (partyResult.status === 'added') partyMembersAdded += 1;
          else partyMembersUpdated += 1;
        }
      }
      database.personnel = personnel;
      database.specialPersonnelProfiles = specialPersonnelProfiles;
      if (identity === '党员') database.partyMembers = partyMembers;
      database.personnelImportRecords = [...(Array.isArray(database.personnelImportRecords) ? database.personnelImportRecords : []), {
        id: `personnel-import-${Date.now()}`, fileName: importState.fileName, sheetName: importState.sheetName, importedAt, identity,
        detectedIdentity: importState.detectedIdentity || null, added, merged, labelsAdded, profilesAdded, profilesUpdated, partyMembersAdded, partyMembersUpdated, skipped, skippedReasons, total: importState.rows.length,
      }];
      const result = await window.api.writeDb(database);
      if (!result?.ok) throw new Error(result?.error || '本地数据保存失败');
      closeModal();
      try {
        await refreshPersonnelWorkspace();
      } catch (refreshError) {
        console.error('导入完成后刷新人员列表失败：', refreshError);
      }
      showToast(`导入完成：新增 ${added} 人，合并 ${merged} 人，新增专项档案 ${profilesAdded} 条、更新 ${profilesUpdated} 条${identity === '党员' ? `，党员台账新增 ${partyMembersAdded} 条、更新 ${partyMembersUpdated} 条` : ''}${skipped ? `，跳过 ${skipped} 条` : ''}`, 'success');
    } catch (error) {
      showToast(error?.message || '导入失败，请检查表格内容后重试', 'error');
    } finally {
      confirm.disabled = false;
      confirm.textContent = originalLabel;
    }
  }

  async function readSelectedFile(file) {
    if (!file) return;
    if (!window.XLSX) return showToast('表格处理组件尚未加载，请重新打开软件后再试', 'error');
    const parser = getExcelParser();
    if (!parser) return showToast('人员表格识别组件尚未加载，请重新打开软件后再试', 'error');
    try {
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const grid = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
      const parsed = parser.parsePersonnelExcelGrid(grid);
      importState.columns = parsed.columns;
      importState.rows = parsed.rows;
      importState.headerRowNumber = parsed.headerRowNumber;
      importState.ignoredRows = parsed.ignoredRows;
      importState.fileName = file.name;
      importState.sheetName = sheetName;
      openMappingModal();
    } catch (error) {
      showToast(error?.message || '表格读取失败，请使用 .xlsx、.xls 或 .csv 文件', 'error');
    }
  }

  function install() {
    const previousInput = document.getElementById('excelFileInput');
    const importButtons = document.querySelectorAll('#importExcelBtn, #batchImportExcelBtn');
    const previousConfirm = document.getElementById('confirmExcelImportBtn');
    if (!previousInput || importButtons.length === 0 || !previousConfirm) return;
    const input = previousInput.cloneNode(true);
    previousInput.replaceWith(input);
    const confirm = previousConfirm.cloneNode(true);
    previousConfirm.replaceWith(confirm);
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#importExcelBtn, #batchImportExcelBtn')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof window.closePersonnelImportMenu === 'function') window.closePersonnelImportMenu();
      input.value = '';
      input.click();
    }, true);
    input.addEventListener('change', () => readSelectedFile(input.files?.[0]));
    confirm.addEventListener('click', persistImport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
