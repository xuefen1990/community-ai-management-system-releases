'use strict';
(function (root) {
  const M = root.DisbursementWorkbenchModel;
  const E = M.esc;
  const uid = () => root.crypto.randomUUID();
  const option = (values, selected) => values.map((v) => `<option value="${E(v[0])}"${String(v[0]) === String(selected) ? ' selected' : ''}>${E(v[1])}</option>`).join('');
  const input = (key, label, value, type = 'text', attrs = '') => `<label>${E(label)}<input data-field="${E(key)}" type="${type}" value="${E(value)}" ${attrs}></label>`;
  const printCSS = `.wb-sheet{box-sizing:border-box;background:#fff;color:#000;overflow:hidden;margin:0;break-after:page;page-break-after:always}.wb-sheet:last-child{break-after:auto;page-break-after:auto}.wb-sheet *{box-sizing:border-box}.wb-sheet h1{font-size:18pt;margin:0 0 5mm;text-align:center;line-height:1.3}.wb-meta,.wb-signers{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2mm;margin:3mm 0;font-size:10pt;line-height:1.4}.wb-meta span{display:inline-block}.wb-sheet table{width:100%;border-collapse:collapse;table-layout:fixed}.wb-sheet td,.wb-sheet th{border:.25mm solid #000;padding:1mm;position:relative;line-height:1.3}.wb-page-subtotal td,.wb-grand-total td{font-weight:700;text-align:right}.wb-sheet td.wb-total-amount{font-size:8pt;white-space:normal;overflow-wrap:anywhere;word-break:break-all;line-height:1.15}.wb-grip{display:none}@media print{html,body{margin:0!important;padding:0!important}.wb-sheet{box-shadow:none!important}.wb-selected{outline:none!important}}`;
  function open(context) {
    const { model, template, people } = context;
    let batch = context.batch ? M.copy(context.batch) : null;
    let editable = !batch || ['draft', 'prepared'].includes(batch.status);
    let draft = batch?.workbenchDraft ? M.copy(batch.workbenchDraft) : {
      id: batch?.id || `workbench-${uid()}`, templateKey: batch?.templateKey || template.key, templateId: batch?.templateId || template.id,
      categoryId: batch?.categoryId || context.category.id, categoryName: batch?.categoryName || context.category.name,
      title: batch?.title || template.title || template.name, period: batch?.period ?? context.initialPeriod ?? `${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月`,
      batchDate: batch?.batchDate || new Date().toLocaleDateString('en-CA'), villageName: batch?.villageName || context.villageName,
      approver: batch?.signers?.approver || '', maker: batch?.signers?.maker || '', handler: batch?.signers?.handler || '', notes: batch?.notes || '', isTest: batch?.isTest || false,
      printSettings: M.copy(batch?.printSettings || template.workbenchPrintSettings || { paper: template.paper || 'A5', orientation: template.orientation || 'portrait', rowsPerPage: template.rowsPerPage || 10, margins: { top: 12, bottom: 12, left: 12, right: 12 } }),
      visualLayout: M.layout(batch?.visualLayout || template.visualLayout), metadataValues: M.copy(batch?.metadataValues || {}), rows: (context.initialItems || batch?.items || []).map((r) => M.rawItem(r, model)),
    };
    draft.id = batch?.id || draft.id;
    draft.rows = draft.rows.map((r) => {
      let row = { ...r, id: r.id || uid() };
      if (editable && !row.personId) {
        const direct = M.matchResident(row, people, model);
        const recurring = ['position_salary', 'public_service'].includes(template.workbenchKind || template.key) || context.category?.entryMode === 'recurring';
        const confirmed = recurring ? M.matchConfirmedResident(row, context.history, people, model, { categoryId: draft.categoryId, categoryName: draft.categoryName, templateKey: draft.templateKey, excludeBatchId: batch?.id }) : null;
        const resident = direct && confirmed && model.personId(direct) !== model.personId(confirmed) ? null : direct || confirmed;
        if (resident) row = M.link(row, resident, template, model);
      }
      return !M.text(row.finalAmount) ? M.recalculate(row, template.workbenchKind || draft.templateKey, model, draft.visualLayout?.calculation) : row;
    });
    draft.visualLayout = M.layout(draft.visualLayout);
    draft.visualLayout.metadataFields ||= M.metadataFields(draft.visualLayout);
    draft.metadataValues ||= {};
    draft.printSettings.margins ||= { top: 12, bottom: 12, left: 12, right: 12 };
    let cols = M.columns(template, draft.templateKey, draft.visualLayout);
    const originalAmountColumn = { key: 'originalAmount', label: '原表金额（对照）', numeric: true };
    if (draft.rows.some((r) => r.originalAmount !== undefined) && !cols.some((c) => c.key === 'originalAmount')) {
      cols.splice(Math.max(0, cols.length - 1), 0, originalAmountColumn);
    }
    draft.visualLayout.editorColumns ||= M.copy(cols);
    // A reused batch can already have an older saved layout. Add the reference
    // column to that layout as well, so it remains available after reopening.
    if (draft.rows.some((r) => r.originalAmount !== undefined)
      && !draft.visualLayout.editorColumns.some((c) => c.key === 'originalAmount')) {
      draft.visualLayout.editorColumns.splice(Math.max(0, draft.visualLayout.editorColumns.length - 1), 0, originalAmountColumn);
    }
    // Keep every imported column available without crowding the default table.
    for (const label of new Set(draft.rows.flatMap((r) => Object.keys(r.customData || {}).filter((k) => M.text(r.customData[k]))))) {
      if (!draft.visualLayout.editorColumns.some((c) => c.key === `custom:${label}`)) draft.visualLayout.editorColumns.push({key:`custom:${label}`,label,visible:false,numeric:draft.rows.filter((r) => M.text(r.customData?.[label])).every((r) => Number.isFinite(Number(r.customData[label])))});
    }
    if (!Array.isArray(draft.visualLayout.printColumns)) draft.visualLayout.printColumns = M.printColumns(template, draft.templateKey, draft.visualLayout);
    const checkedRows = new Set();
    let pendingExcel = null;
    let mappingSheetIndex = -1;
    let search = '';
    const filteredRows = () => draft.rows.filter((r) => !search || `${r.name || ''} ${r.groupName || ''}`.includes(search));
    const calculate = (r) => M.recalculate(r, template.workbenchKind || draft.templateKey, model, draft.visualLayout.calculation);
    function syncColumns() { cols = M.columns(template, draft.templateKey, draft.visualLayout); }

    let mode = batch?.workbenchDraft?.ready === false ? 'edit' : context.preview || !editable ? 'preview' : 'edit';
    let printers = [], printerName = '', printerError = '';
    let page = 0, editPage = 0, pageSize = 20, pages = [[]], pageScales = [1], selected = null, saveTimer, saveChain = Promise.resolve();
    let revision = 0, savedRevision = 0, saving = false, disposed = false, saveError = '', layoutError = '', layoutNotice = '', frames = 0;
    const undo = [];
    const overlay = document.createElement('div'); overlay.id = 'disbursement-workbench'; overlay.className = 'wb-overlay';
    document.getElementById('cf-modal-overlay')?.remove();
    document.body.appendChild(overlay);
    const $ = (selector) => overlay.querySelector(selector);
    const all = (selector) => [...overlay.querySelectorAll(selector)];
    function dirty() {
      revision += 1; saveError = ''; clearTimeout(saveTimer); updateStatus();
      if (editable) saveTimer = setTimeout(() => { persist().catch(() => {}); }, 1000);
    }
    function remember() { if (!editable) return; undo.push(M.copy(draft)); if (undo.length > 30) undo.shift(); }
    function updateStatus() {
      const node = $('[data-save-status]'); if (node) node.textContent = !editable ? '历史记录 · 只读' : saveError || (saving ? '正在保存…' : savedRevision < revision ? '草稿待保存' : batch ? '草稿已保存' : '尚未保存');
      if (node) node.classList.toggle('wb-error', Boolean(saveError));
    }
    function persist(strict = false) {
      clearTimeout(saveTimer);
      const snapshot = M.copy(draft), captured = revision;
      // Validation is performed before queueing a destructive transition such as print/complete.
      if (strict) M.build(snapshot, batch, template, people, model, { strict: true });
      const job = saveChain.catch(() => {}).then(async () => {
        if (!editable || (captured <= savedRevision && batch)) return batch;
        saving = true; updateStatus();
        try {
          const next = M.build(snapshot, batch, template, people, model);
          batch = await context.saveBatch(next);
          savedRevision = captured; saveError = ''; return batch;
        } catch (error) { saveError = `保存失败：${error.message}。可点击重试保存`; throw error; }
        finally { saving = false; if (!disposed) updateStatus(); }
      });
      saveChain = job; return job;
    }
    function fail(error) {
      const message = error.message || String(error);
      const node = $('[data-error]'); if (node) { node.textContent = message; node.hidden = false; }
      const duplicateName = mode === 'edit' ? message.match(/^(.+?)在居民档案中有重名/u)?.[1] : '';
      if (duplicateName && draft.rows.some((row) => row.name === duplicateName && !row.personId)) {
        search = duplicateName; editPage = 0; const searchBox = $('[data-search]'); if (searchBox) searchBox.value = search;
        renderRows();
        const row = filteredRows().find((item) => !item.personId);
        const chooser = all('[data-choose-person]').find((button) => button.dataset.choosePerson === row?.id);
        if (chooser) { chooser.scrollIntoView({ block: 'center' }); suggestions(chooser, row, row.name); }
      }
    }
    function actionButton(key, label, disabled = false) { return `<button type="button" data-action="${key}"${disabled ? ' disabled' : ''}>${label}</button>`; }
    function shell() {
      overlay.innerHTML = `<section class="wb-window" role="dialog" aria-modal="true" aria-label="资金发放工作台"><header><div><strong>${mode === 'edit' ? '编辑发放表' : '打印预览'}</strong><small>${E(template.name || '')} · ${editable ? '仅修改本批次' : '已锁定，只读'}</small></div><span data-save-status></span>${actionButton('close', '关闭')}</header><p data-error class="wb-error" role="alert" hidden></p><main></main><footer>${editable ? actionButton('undo', '撤销') + actionButton('save', '重试 / 保存草稿') + actionButton('discard', '放弃未保存修改') : ''}<span data-summary></span>${mode === 'edit' ? actionButton('preview', '打印预览 →') : `${editable ? actionButton('edit', '返回编辑表') + actionButton('prepare', '准备打印') : ''}${actionButton('export', '导出 Excel')}${['printed', 'partial'].includes(batch?.status) ? actionButton('complete', '确认本批全部已发放') + actionButton('exceptions', '处理例外人员') : ''}${actionButton('print', '打印')}`}</footer></section>`;
      syncColumns(); if (mode === 'edit') renderEditor(); else renderPreviewShell();
      updateStatus(); summary();
    }
    function summary() {
      const total = draft.rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.finalAmount)) ? model.amountToCents(r.finalAmount || 0) : 0), 0);
      const node = $('[data-summary]'); if (node) node.textContent = `${draft.rows.filter((r) => M.text(r.name)).length} 人 · 合计 ¥${model.centsToYuan(total)}`;
    }
    const metaFields = () => M.metadataFields(draft.visualLayout);
    const metaValue = (key) => key.startsWith('custom:') ? draft.metadataValues[key.slice(7)] || '' : draft[key] || '';
    function metadata() {
      return `<div class="wb-metadata">${input('title', '表格标题', draft.title)}${metaFields().map((field) => field.key === 'period' ? `<label>${E(field.label)}（选填）<input data-meta-field="period" value="${E(metaValue('period'))}" placeholder="例如：7~9月"></label><label class="wb-check"><input type="checkbox" data-show-period${draft.visualLayout.showPeriod !== false ? ' checked' : ''}>打印时显示期间</label>` : `<label>${E(field.label)}<input data-meta-field="${E(field.key)}" type="${field.key === 'batchDate' ? 'date' : 'text'}" value="${E(metaValue(field.key))}"></label>`).join('')}<label><input type="checkbox" data-field="isTest"${draft.isTest ? ' checked' : ''}>测试批次</label></div>`;
    }
    function renderEditor() {
      $('main').innerHTML = `${metadata()}<div class="wb-toolbar">${actionButton('add', '＋ 添加人员')}${actionButton('import-excel', '导入 Excel')}<span>首次遇到重名时核对并选择；周期性发放复用已确认的人员。空银行卡可留空。</span></div><section class="wb-excel-review" hidden></section><div class="wb-bulk-bar"><input data-search placeholder="搜索姓名或组别" value="${E(search)}">${actionButton('bulk-panel', '批量填写')}${actionButton('rule-panel', '金额计算')}${actionButton('columns-panel', '字段与眉头')}<span data-selection></span></div><section class="wb-tools-panel" hidden></section><div class="wb-grid-host"></div><div class="wb-editor-pages"></div><div class="wb-candidates" role="listbox" hidden></div>`;
      renderRows(); if (pendingExcel) reviewExcel();
    }
    function excelSections() {
      return (pendingExcel?.sheets || []).flatMap((sheet, sheetIndex) => (sheet.sections || []).filter((section) => section.rows?.length).map((section) => ({ ...section, sheetIndex, sheetName: sheet.sheetName, key: `${sheetIndex}:${section.sectionIndex}` })));
    }
    function reviewExcel() {
      const panel = $('.wb-excel-review'); if (!panel) return;
      if (!pendingExcel) { panel.hidden = true; panel.innerHTML = ''; return; }
      const sections = excelSections(), skipped = (pendingExcel.sheets || []).filter((sheet) => sheet.error || sheet.requiresMapping);
      panel.hidden = false;
      panel.innerHTML = `<h3>核对 Excel 人员 · ${E(pendingExcel.fileName || '')}</h3><p>勾选要加入当前批次的工作表。导入后可在下方修改人员、字段和金额。</p>${sections.map((section) => `<label class="wb-excel-section"><input type="checkbox" data-excel-section="${E(section.key)}" checked><span><strong>${E(section.sheetName)}${sections.filter((part) => part.sheetIndex === section.sheetIndex).length > 1 ? ` · 第 ${section.sectionIndex + 1} 段` : ''}</strong><small>${section.rows.length} 人${section.title ? ` · ${E(section.title)}` : ''}</small></span></label>`).join('')}${skipped.map((sheet) => `<div class="wb-excel-missing"><span>${E(sheet.sheetName)}：${E(sheet.error || '未识别表头')}</span>${sheet.rawGrid?.length ? `<button type="button" data-map-excel="${pendingExcel.sheets.indexOf(sheet)}">手动对应字段</button>` : ''}</div>`).join('')}<label class="wb-excel-mode">导入方式<select data-excel-mode><option value="append">追加到现有人员后</option><option value="replace">替换当前批次人员</option></select></label><div class="wb-excel-actions">${actionButton('confirm-excel', '确认加入当前批次')}${actionButton('cancel-excel', '取消')}</div>`;
    }
    function reviewMapping(sheetIndex) {
      const sheet = pendingExcel?.sheets?.[sheetIndex]; if (!sheet?.rawGrid?.length) throw new Error('该工作表没有可核对的数据');
      mappingSheetIndex = sheetIndex;
      const width = Math.max(0, ...sheet.rawGrid.slice(0, 30).map((row) => row.length));
      const options = Array.from({ length: width }, (_, index) => [index, sheet.columns?.[index] || `第 ${index + 1} 列`]);
      const field = (key, label, required = false) => `<label>${label}<select data-excel-map="${key}">${required ? '' : '<option value="">不对应</option>'}${option(options, '')}</select></label>`;
      const panel = $('.wb-excel-review'); panel.hidden = false;
      panel.innerHTML = `<h3>对应字段 · ${E(sheet.sheetName)}</h3><p>选择表头所在行及姓名列；没有身份证号也可以导入。金额等其余字段按实际表格对应。</p><div class="wb-excel-mapping"><label>表头所在行（无表头填 0）<input data-excel-header type="number" min="0" value="${Number(sheet.headerRowNumber || 1)}"></label>${field('name','姓名 *',true)}${field('amount','本期金额')}${field('bankCard','银行卡号')}${field('groupName','组别')}${field('quantity','数量 / 月份')}${field('unitPrice','单价')}${field('idCard','身份证号')}</div><div class="wb-excel-actions">${actionButton('apply-excel-mapping','确认对应')}${actionButton('back-excel','返回核对')}</div>`;
    }
    function importedItem(source) {
      const amount = M.text(source.amount);
      return M.rawItem({ id: uid(), name: source.name, idCard: source.idCard, groupName: source.groupName, phone: source.phone, role: source.role, responsibilityArea: source.responsibilityArea, workDate: source.workDate, workItem: source.workItem, quantity: source.quantity || source.months || '', unitPrice: source.unitPrice || '', finalAmount: amount, originalAmount: amount, manualAmount: Boolean(amount), adjustmentReason: amount ? 'Excel 导入金额' : '', bankCard: source.bankCard, remark: source.remark, customData: source.rawData || {} }, model);
    }
    function get(row, key) { return key.startsWith('custom:') ? row.customData?.[key.slice(7)] ?? '' : row[key] ?? ''; }
    function set(row, key, value) { if (key.startsWith('custom:')) { row.customData ||= {}; row.customData[key.slice(7)] = value; } else row[key] = value; }
    function renderRows() {
      editPage = Math.min(editPage, Math.max(0, Math.ceil(filteredRows().length / pageSize) - 1));
      const visible = filteredRows().slice(editPage * pageSize, (editPage + 1) * pageSize);
      $('.wb-grid-host').innerHTML = `<table class="wb-grid"><thead><tr><th><input type="checkbox" data-check-page aria-label="勾选本页"></th><th>序号</th>${cols.map((c) => `<th>${E(c.label)}</th>`).join('')}<th>调整原因</th><th>居民关联 / 操作</th></tr></thead><tbody>${visible.map((r, i) => `<tr data-row="${E(r.id)}"><td><input type="checkbox" data-check-row="${E(r.id)}" aria-label="勾选${E(r.name)}"${checkedRows.has(r.id) ? ' checked' : ''}></td><td>${editPage * pageSize + i + 1}</td>${cols.map((c) => `<td><input aria-label="${E(c.label)}" data-cell="${E(c.key)}" value="${E(get(r, c.key))}"${c.key === 'originalAmount' ? ' readonly' : ''}${c.numeric ? ' inputmode="decimal"' : ''} autocomplete="off"></td>`).join('')}<td><input data-cell="adjustmentReason" aria-label="手工调整原因" placeholder="手工改金额时填写" value="${E(r.adjustmentReason)}"></td><td><span class="wb-linked">${E(r.personId ? `${r.groupName || '未分组'} · ${r.idCard ? r.idCard.slice(-4) : '已关联'}` : '临时 / 待选择')}</span>${!r.personId && M.text(r.name) ? `<button type="button" data-choose-person="${E(r.id)}">选择居民</button>` : ''}<button type="button" data-delete="${E(r.id)}">删除</button>${r.manualAmount ? `<button type="button" data-auto="${E(r.id)}">恢复计算</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $('[data-selection]').textContent = `已选 ${checkedRows.size} 人 · 筛选 ${filteredRows().length} 人`;
      $('.wb-editor-pages').innerHTML = `${actionButton('first', '首页', editPage === 0)}${actionButton('prev', '上一页', editPage === 0)}<span>第 ${editPage + 1} / ${Math.max(1, Math.ceil(filteredRows().length / pageSize))} 页</span>${actionButton('next', '下一页', (editPage + 1) * pageSize >= filteredRows().length)}<label>每页 <select data-page-size>${option([10,20,50].map((n) => [n, `${n} 人`]), pageSize)}</select></label>`;
    }
    function columnSettingsHtml(fields) {
      const printed = draft.visualLayout.printColumns;
      const sourceFields = [...M.columns(template, draft.templateKey, {}), ...(draft.visualLayout.archivedEditorColumns || []), ...printed.filter((column) => column.key !== '_sequence')];
      const available = [...new Map(sourceFields.map((column) => [column.key, column])).values()].filter((column) => !fields.some((field) => field.key === column.key));
      const addablePrint = fields.filter((column) => !printed.some((item) => item.key === column.key));
      return `<div class="wb-field-panels"><section class="wb-field-card"><div class="wb-field-panel-head"><div><h3>打印列</h3><p>调整打印表的列名和顺序；删除后仅从打印表移除。</p></div></div>
        <div class="wb-field-list">${printed.map((column, index) => `<div class="wb-field-row"><span class="wb-field-order">${String(index + 1).padStart(2, '0')}</span><input data-print-column-label="${index}" value="${E(column.label)}" aria-label="第${index + 1}个打印列名称"><div class="wb-field-actions"><button type="button" data-print-column-up="${index}" aria-label="上移${E(column.label)}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-print-column-down="${index}" aria-label="下移${E(column.label)}"${index === printed.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-print-column-remove="${index}"${printed.length === 1 ? ' disabled' : ''}>删除</button></div></div>`).join('')}</div>
        <div class="wb-field-add"><select data-print-column-source aria-label="选择要添加的打印字段"><option value="">选择录入字段</option>${option(addablePrint.map((column) => [column.key, column.label]))}</select>${actionButton('print-column-add', '添加到打印表')}</div></section><section class="wb-field-card">
        <div class="wb-field-panel-head"><div><h3>录入字段</h3><p>可改名、删除或重新添加。删除字段不清空已有人员资料；姓名和实发金额是办理必填。</p></div></div>
        <div class="wb-field-list">${fields.map((column, index) => `<div class="wb-field-row"><span class="wb-field-order">${String(index + 1).padStart(2, '0')}</span><input data-column-label="${index}" value="${E(column.label)}" aria-label="第${index + 1}个录入字段名称"><div class="wb-field-actions">${column.key.startsWith('custom:') ? `<select data-column-numeric="${index}" aria-label="${E(column.label)}字段类型"><option value="text"${column.numeric ? '' : ' selected'}>文字</option><option value="number"${column.numeric ? ' selected' : ''}>数字</option></select>` : ''}<button type="button" data-column-toggle="${index}"${['name', 'finalAmount'].includes(column.key) ? ' disabled title="办理必填字段"' : ''}>${column.visible === false ? '显示' : '隐藏'}</button><button type="button" data-remove-column="${index}"${['name', 'finalAmount'].includes(column.key) ? ' disabled title="办理必填字段"' : ''}>删除</button></div></div>`).join('')}</div>
        <div class="wb-field-add"><select data-editor-column-source aria-label="重新添加已有字段"><option value="">选择已有字段</option>${option(available.map((column) => [column.key, column.label]))}</select>${actionButton('editor-column-restore', '添加已有字段')}<input data-new-column placeholder="新字段名称" aria-label="新字段名称"><select data-new-column-type aria-label="新字段类型"><option value="text">文字</option><option value="number">数字</option></select>${actionButton('column-add', '新建字段')}</div></section></div>
        <div class="wb-field-panel-head wb-field-section"><div><h3>顶部填写项</h3><p>修改名称、顺序或移除填写项；保存到模板后，今后新建的批次沿用。已保存批次不受影响。</p></div></div><div class="wb-field-list">${metaFields().map((field, index) => `<div class="wb-field-row"><span class="wb-field-order">${String(index + 1).padStart(2, '0')}</span><input data-meta-label="${index}" value="${E(field.label)}" aria-label="顶部填写项名称"><div class="wb-field-actions"><button type="button" data-meta-up="${index}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-meta-down="${index}"${index === metaFields().length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-meta-remove="${index}">删除</button></div></div>`).join('')}</div><div class="wb-field-add"><input data-new-meta-label placeholder="新填写项名称，例如：发放依据" aria-label="新填写项名称">${actionButton('meta-add', '＋ 添加填写项')}</div><div class="wb-field-panel-head wb-field-section"><div><h3>表头补充信息</h3><p>需要在打印标题下增加项目、标准等说明时填写。</p></div></div>${(draft.visualLayout.headers || []).map((header, index) => `<div class="wb-header-row"><input data-header-label="${index}" value="${E(header.label)}" aria-label="补充信息名称"><input data-header-value="${index}" value="${E(header.value)}" aria-label="补充信息内容"><button type="button" data-remove-header="${index}">删除</button></div>`).join('')}<div class="wb-field-panel-footer">${actionButton('header-add', '＋ 添加信息')}${actionButton('template-save', '保存字段到当前模板')}${actionButton('panel-close', '收起设置')}</div>`;
    }
    function toolPanel(kind) {
      const panel = $('.wb-tools-panel'); panel.hidden = false;
      const fields = draft.visualLayout.editorColumns;
      const numeric = fields.filter((c) => c.numeric && !['finalAmount','originalAmount'].includes(c.key));
      const choices = (list, selected) => option(list.map((c) => [c.key,c.label]), selected);
      if (kind === 'bulk') panel.innerHTML = `<h3>批量填写</h3><div class="wb-tool-fields"><label>填写字段<select data-bulk-key>${choices(cols.filter((c) => !['name','bankCard','originalAmount'].includes(c.key)))}</select></label><label>统一内容<input data-bulk-value></label><label>作用范围<select data-bulk-scope><option value="selected">已勾选 ${checkedRows.size} 人</option><option value="filtered">当前筛选 ${filteredRows().length} 人（含其他页）</option><option value="all">全部 ${draft.rows.length} 人</option></select></label><label>填写方式<select data-bulk-mode><option value="empty">只填空白</option><option value="replace">替换已有内容</option></select></label></div><p>修改单价后自动计算；已手工调整的金额会保留。每次批量修改可撤销。</p>${actionButton('bulk-apply','应用填写')}${actionButton('panel-close','收起')}`;
      if (kind === 'rule') { const rule = draft.visualLayout.calculation || {}; panel.innerHTML = `<h3>本期金额计算</h3><div class="wb-tool-fields"><label>计算方式<select data-rule-mode>${option([['default','模板原计算方式'],['multiply','数量 × 单价 − 扣除'],['uniform','每人统一金额'],['manual','逐人手工填写']],rule.mode || 'default')}</select></label><label>数量字段<select data-rule-quantity>${choices(numeric,rule.quantity || 'quantity')}</select></label><label>单价字段<select data-rule-price>${choices(numeric,rule.price || 'unitPrice')}</select></label><label>扣除字段<select data-rule-deduction><option value="">不扣除</option>${choices(numeric,rule.deduction)}</select></label><label>统一金额（元）<input data-rule-amount inputmode="decimal" value="${E(rule.amount || '')}"></label></div><p>按分计算并四舍五入；保留手工调整金额，原表金额不变。</p>${actionButton('rule-apply','应用并计算全部人员')}${actionButton('panel-close','收起')}`; }
      if (kind === 'columns') panel.innerHTML = columnSettingsHtml(fields);
    }
    function suggestions(control, row, query = control.value) {
      const box = $('.wb-candidates'); if (!box) return;
      const found = M.candidates(query, people, model);
      if (!found.matches.length) { box.hidden = true; return; }
      const rect = control.getBoundingClientRect();
      box.hidden = false; box.style.left = `${Math.min(rect.left, root.innerWidth - 370)}px`; box.style.top = `${Math.min(rect.bottom + 3, root.innerHeight - 240)}px`;
      box.innerHTML = `<small>${found.exact.length > 1 ? '存在重名，请核对组别、证件及银行卡尾号后选择' : '选择居民后关联档案'}${found.total > 20 ? '（仅显示前20条，请细化姓名）' : ''}</small>${found.matches.map((p) => `<button type="button" role="option" data-person="${E(model.personId(p))}" data-target-row="${E(row.id)}">${E(model.personName(p))} · ${E(model.personGroup(p) || '未分组')} · 证件尾号 ${E(String(p.id_card || p.idCard || '').slice(-4) || '未填')} · 银行卡尾号 ${E(model.defaultBankCard(p).slice(-4) || '未填')}</button>`).join('')}`;
    }
    function refreshRowValue(row, key) {
      const tr = all('[data-row]').find((n) => n.dataset.row === row.id);
      tr?.querySelectorAll('[data-cell]').forEach((n) => { if (!key || n.dataset.cell === key) n.value = get(row, n.dataset.cell); });
      const status = tr?.querySelector('.wb-linked'); if (status) status.textContent = row.personId ? `${row.groupName || '未分组'} · ${row.idCard?.slice(-4) || '已关联'}` : '临时 / 待选择';
      const chooser = tr?.querySelector('[data-choose-person]');
      if (chooser && (row.personId || !M.text(row.name))) chooser.remove();
      else if (!chooser && !row.personId && M.text(row.name)) {
        const button = root.document.createElement('button'); button.type = 'button'; button.dataset.choosePerson = row.id; button.textContent = '选择居民';
        tr?.querySelector('[data-delete]')?.before(button);
      }
    }
    function selectPerson(id, person) {
      const index = draft.rows.findIndex((r) => r.id === id); if (index < 0) return;
      remember(); draft.rows[index] = M.link(draft.rows[index], person, template, model);
      renderRows(); const box = $('.wb-candidates'); if (box) box.hidden = true;
      const error = $('[data-error]'); if (error?.textContent.includes(`${draft.rows[index].name}在居民档案中有重名`)) { error.hidden = true; error.textContent = ''; }
      dirty();
    }
    const printColumns = () => M.printColumns(template, draft.templateKey, draft.visualLayout);
    function dimensions() {
      let size = draft.printSettings.paper === 'A4' ? [210, 297] : [148, 210];
      if (draft.printSettings.orientation === 'landscape') size = size.reverse();
      return { width: size[0], height: size[1], inner: size[0] - draft.printSettings.margins.left - draft.printSettings.margins.right };
    }
    function widths() {
      const columns = printColumns(), inner = dimensions().inner;
      const values = columns.map((c) => M.clamp(draft.visualLayout.widths[c.key], 2, 300, c.key === 'bankCard' ? 38 : c.key === '_sequence' ? 8 : c.key === 'workItem' ? 30 : 18));
      const sum = values.reduce((a,b) => a+b, 0); return values.map((v) => v * inner / sum);
    }
    function changeWidth(key, target) {
      const columns = printColumns(), w = widths(), i = columns.findIndex((c) => c.key === key), j = i === w.length - 1 ? i - 1 : i + 1;
      if (i < 0 || j < 0) return;
      const next = M.clamp(target, 3, w[i] + w[j] - 3, w[i]); w[j] += w[i] - next; w[i] = next;
      columns.forEach((c, index) => { draft.visualLayout.widths[c.key] = w[index]; });
    }
    function cellStyle(rowId, key) { return { ...draft.visualLayout.table, ...draft.visualLayout.cells[`${rowId}:${key}`] }; }
    function tableHead(interactive) {
      const w = widths();
      return `<colgroup>${w.map((v) => `<col style="width:${v}mm">`).join('')}</colgroup><thead><tr>${printColumns().map((c) => `<th data-print-cell="${E(c.key)}" data-print-row="_head" style="${M.cssStyle({ ...cellStyle('_head', c.key), bold: true })}">${E(draft.visualLayout.labels[c.key] || c.label)}${interactive ? `<span class="wb-grip wb-col-grip" data-col-grip="${E(c.key)}" title="拖动调整列宽"></span>` : ''}</th>`).join('')}</tr></thead>`;
    }
    function tableRow(index, interactive) {
      const row = draft.rows[index];
      return `<tr style="height:${M.clamp(draft.visualLayout.heights[row.id], 5, 80, draft.visualLayout.rowHeight)}mm" data-measure-row="${index}">${printColumns().map((c, i) => `<td data-print-cell="${E(c.key)}" data-print-row="${E(row.id)}" style="${M.cssStyle(cellStyle(row.id, c.key))}">${E(c.key === '_sequence' ? index + 1 : get(row, c.key))}${interactive && i === 0 ? `<span class="wb-grip wb-row-grip" data-row-grip="${E(row.id)}" title="拖动调整行高"></span>` : ''}</td>`).join('')}</tr>`;
    }
    function heading(interactive = false) {
      const fields = metaFields().filter((field) => !['approver', 'maker', 'handler', 'notes'].includes(field.key) && (field.key !== 'period' || draft.visualLayout.showPeriod !== false && M.text(draft.period)));
      const offset = (key) => draft.visualLayout.metadataOffsets?.[key] || {};
      const maxY = Math.max(0, ...fields.map((field) => M.clamp(offset(field.key).y, -3, 12, 0)));
      const heightStyle = maxY > 0 ? ` style="min-height:${7 + maxY}mm"` : '';
      return `<h1 data-print-row="_title" data-print-cell="title" style="${M.cssStyle({ ...draft.visualLayout.table, size: 18, bold: true, ...draft.visualLayout.cells['_title:title'] })}">${E(draft.title)}</h1><div class="wb-meta"${heightStyle}>${fields.map((field) => { const x = M.clamp(offset(field.key).x, -300, 300, 0), y = M.clamp(offset(field.key).y, -3, 12, 0); return `<span data-print-row="_meta" data-print-cell="${E(field.key)}"${interactive && ['period','batchDate','villageName'].includes(field.key) ? ` data-meta-drag="${E(field.key)}" title="拖动调整打印位置"` : ''} style="${M.cssStyle(cellStyle('_meta',field.key))}${x || y ? `;transform:translate(${x}mm,${y}mm)` : ''}">${E(field.label)}：${E(metaValue(field.key))}</span>`; }).join('')}<span>单位：元</span>${(draft.visualLayout.headers || []).map((h) => `<span>${E(h.label)}：${E(h.value)}</span>`).join('')}</div>`;
    }
    function amountFor(indices) {
      return indices.reduce((sum, index) => sum + (Number.isFinite(Number(draft.rows[index]?.finalAmount)) ? model.amountToCents(draft.rows[index].finalAmount || 0) : 0), 0);
    }
    function tableTotals(indices, pageIndex, totalPages) {
      const columns = printColumns();
      const subtotal = amountFor(indices); const grandTotal = amountFor(draft.rows.map((_row, index) => index));
      const row = (label, amount, count) => {
        const cells = M.totalCells(columns, label, `¥${model.centsToYuan(amount)}`, count);
        return `<tr class="${label === '本页小计' ? 'wb-page-subtotal' : 'wb-grand-total'}">${cells.map((cell) => `<td colspan="${cell.colspan}"${cell.text.includes('¥') ? ' class="wb-total-amount"' : ''}>${E(cell.text)}</td>`).join('')}</tr>`;
      };
      return `<tfoot>${M.totalLabels(totalPages, pageIndex).map((label) => row(label, label === '本页小计' ? subtotal : grandTotal, label === '本页小计' ? indices.length : draft.rows.length)).join('')}</tfoot>`;
    }
    function foot(pageIndex, totalPages) {
      return `<div class="wb-signers">${template.showSigners === false ? '' : metaFields().filter((field) => ['approver','maker','handler'].includes(field.key)).map((field) => `<span data-print-row="_meta" data-print-cell="${E(field.key)}" style="${M.cssStyle(cellStyle('_meta',field.key))}">${E(field.label)}：${E(metaValue(field.key))}</span>`).join('')}<span>第 ${pageIndex + 1}/${totalPages} 页</span></div>`;
    }
    function sheet(indices, pageIndex, interactive = false, compression = pageScales[pageIndex] || 1) {
      const d = dimensions(), m = draft.printSettings.margins;
      return `<article class="wb-sheet" data-page-paper="${draft.printSettings.paper}" data-page-orientation="${draft.printSettings.orientation}" style="width:${d.width}mm;height:${d.height}mm;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;font-family:'${draft.visualLayout.table.font}',serif"><div class="wb-sheet-content" style="transform:scaleY(${compression});transform-origin:top center">${heading(interactive)}<table>${tableHead(interactive)}<tbody>${indices.map((index) => tableRow(index, interactive)).join('')}</tbody>${tableTotals(indices, pageIndex, pages.length)}</table>${foot(pageIndex, pages.length)}</div></article>`;
    }
    function measurePages() {
      const measure = document.createElement('div'); measure.className = 'wb-measure';
      const d = dimensions(), m = draft.printSettings.margins;
      const perPage = Math.max(1, Math.round(M.clamp(draft.printSettings.rowsPerPage, 1, 50, 10)));
      pages = Array.from({ length: Math.max(1, Math.ceil(draft.rows.length / perPage)) }, (_item, index) => draft.rows.map((_row, rowIndex) => rowIndex).slice(index * perPage, (index + 1) * perPage));
      measure.innerHTML = pages.map((indices, index) => sheet(indices, index, false, 1)).join('');
      overlay.appendChild(measure);
      try {
        const paper = measure.querySelector('.wb-sheet'); const pxPerMm = paper.getBoundingClientRect().width / d.width;
        const available = (d.height - m.top - m.bottom) * pxPerMm;
        if (available <= 0) throw new Error('标题、眉头或边距占满了纸张，请调整后打印');
        pageScales = [...measure.querySelectorAll('.wb-sheet')].map((sheetNode) => Math.min(1, available / Math.max(1, sheetNode.querySelector('.wb-sheet-content').getBoundingClientRect().height)));
        const smallest = Math.min(...pageScales);
        layoutNotice = smallest < 0.99 ? `已按每页 ${perPage} 人排列；为放入 ${draft.printSettings.paper} 纸张，内容已自动紧凑到 ${Math.round(smallest * 100)}%。` : `已按每页 ${perPage} 人排列。`;
        page = Math.max(0, Math.min(page, pages.length - 1)); layoutError = '';
      } catch (error) { layoutError = error.message; layoutNotice = ''; pages = [draft.rows.map((_, i) => i)]; pageScales = [1]; page = 0; }
      finally { measure.remove(); }
    }
    function renderPreviewShell() {
      const s = draft.printSettings, l = draft.visualLayout;
      $('main').innerHTML = `<div class="wb-preview"><aside class="wb-settings"><fieldset${editable ? '' : ' disabled'}><h3>纸张设置</h3><label>纸张<select data-setting="paper">${option([['A4','A4'],['A5','A5']], s.paper)}</select></label><label>方向<select data-setting="orientation">${option([['portrait','纵向'],['landscape','横向']], s.orientation)}</select></label><label>每页人数<select data-setting="rowsPerPage">${option([[8,'8 人'],[9,'9 人'],[10,'10 人（默认）'],[11,'11 人'],[12,'12 人'],[15,'15 人'],[20,'20 人']], s.rowsPerPage)}</select></label><div class="wb-margin-grid">${[['top','上'],['bottom','下'],['left','左'],['right','右']].map(([k, name]) => `<label>${name}边距 mm<input type="number" min="0" max="40" data-margin="${k}" value="${s.margins[k]}"></label>`).join('')}</div><h3>整表格式</h3><label>字体<select data-table="font">${option(M.fonts.map((f) => [f, ({'Songti SC':'宋体（Mac）',SimSun:'宋体','PingFang SC':'苹方','Microsoft YaHei':'微软雅黑'})[f] || f]), l.table.font)}</select></label><label>字号 pt<input type="number" min="6" max="36" data-table="size" value="${l.table.size}"></label><label>默认行高 mm<input type="number" min="5" max="50" data-row-height value="${l.rowHeight}"></label><p>选择人数后右侧页码会按对应人数排列。A5 默认 10 人，需 11 人时直接选择 11 人。</p><h3>表头位置</h3><p>在纸张预览上拖动发放期间、发放日期和编制单位；位置会用于全部打印页。</p>${actionButton('meta-position-reset','恢复默认位置')}${actionButton('template-save','保存到当前模板')}${actionButton('template-copy','另存新模板')}</fieldset></aside><section class="wb-paper-area"><div class="wb-layout-error" role="alert"></div><div class="wb-layout-notice" role="status"></div><div class="wb-paper-holder"></div></section><aside class="wb-inspector"><h3>页面</h3><div class="wb-page-list"></div><h3>选中单元格</h3><div class="wb-cell-inspector">点击标题、眉头、表头或数据单元格。</div></aside></div>`;
      const settings = $('.wb-settings');
      settings.insertAdjacentHTML('afterbegin', `<div class="wb-printer-control"><h3>直接打印</h3><label>打印机<select data-printer aria-label="选择打印机"><option value="">正在读取打印机…</option></select></label><p data-printer-status role="status"></p>${actionButton('refresh-printers', '刷新打印机')}</div>`);
      refreshPrinters();
      redrawPreview(true);
    }
    async function refreshPrinters() {
      try {
        printers = await context.listPrinters();
        if (disposed || mode !== 'preview') return;
        if (!printers.some((printer) => printer.name === printerName)) printerName = printers.find((printer) => printer.isDefault)?.name || printers[0]?.name || '';
        printerError = printers.length ? '' : '未找到打印机，请连接打印机后刷新。';
      } catch (error) { printers = []; printerName = ''; printerError = `读取打印机失败：${error.message}`; }
      const select = $('[data-printer]'), status = $('[data-printer-status]');
      if (select) select.innerHTML = printers.length ? option(printers.map((printer) => [printer.name, `${printer.displayName}${printer.isDefault ? '（默认）' : ''}`]), printerName) : '<option value="">暂无可用打印机</option>';
      if (status) status.textContent = printerError || '按当前预览的纸张与方向直接送印。';
    }
    function redrawPreview(measure = true) {
      if (disposed || mode !== 'preview') return;
      if (measure) measurePages();
      $('.wb-layout-error').textContent = layoutError;
      $('.wb-layout-notice').textContent = layoutNotice;
      $('.wb-paper-holder').innerHTML = sheet(pages[page], page, editable);
      $('.wb-page-list').innerHTML = pages.map((p, i) => `<button type="button" data-page="${i}"${i === page ? ' class="active" aria-current="page"' : ''}>第 ${i + 1} 页 · ${p.length} 人</button>`).join('');
      fit(); selectHighlight();
    }
    function fit() {
      const paper = $('.wb-paper-holder .wb-sheet'), holder = $('.wb-paper-holder'); if (!paper || !holder) return;
      const zoom = Math.min(1.5, Math.max(.2, (holder.clientWidth - 24) / (dimensions().width * 96 / 25.4)));
      paper.style.zoom = zoom;
    }
    function selectHighlight() {
      all('.wb-selected').forEach((n) => n.classList.remove('wb-selected'));
      if (!selected) return;
      all('[data-print-cell]').find((n) => n.dataset.printCell === selected.key && n.dataset.printRow === selected.row)?.classList.add('wb-selected');
    }
    function inspector() {
      if (!selected || !$('.wb-cell-inspector')) return;
      const { row, key } = selected, record = draft.rows.find((r) => r.id === row), c = printColumns().find((v) => v.key === key);
      const s = cellStyle(row, key), format = M.style(row === '_title' ? { ...s, size:18, bold:true, ...draft.visualLayout.cells['_title:title'] } : s), canFormat = true;
      const value = row === '_title' || row === '_meta' ? draft[key] : row === '_head' ? draft.visualLayout.labels[key] || c?.label : get(record || {}, key);
      $('.wb-cell-inspector').innerHTML = `<fieldset${editable ? '' : ' disabled'}><strong>${E(c?.label || key)}</strong>${key !== '_sequence' && key !== 'name' && key !== 'originalAmount' ? `<label>内容<textarea data-selected-value>${E(value)}</textarea></label>` : `<p>${E(key === 'name' ? '姓名请在编辑表中修改，以便重新确认居民关联。' : '序号自动生成')}</p>`}${canFormat ? `<label>字体<select data-selected-style="font">${option(M.fonts.map((f) => [f,f]), format.font)}</select></label><label>字号<input type="number" min="6" max="36" data-selected-style="size" value="${format.size}"></label><label>对齐<select data-selected-style="align">${option([['left','左'],['center','居中'],['right','右']], format.align)}</select></label><label>垂直<select data-selected-style="vertical">${option([['top','靠上'],['middle','居中'],['bottom','靠下']], format.vertical)}</select></label><label><input type="checkbox" data-selected-style="bold"${format.bold ? ' checked' : ''}>加粗</label><label><input type="checkbox" data-selected-style="wrap"${format.wrap ? ' checked' : ''}>自动换行</label>` : ''}${c ? `<label>列宽 mm<input type="number" min="3" step="0.5" data-selected-width value="${widths()[printColumns().findIndex((column) => column.key === c.key)].toFixed(1)}"></label>` : ''}${record ? `<label>手工调整原因<input data-selected-reason value="${E(record.adjustmentReason)}"></label><label>行高 mm<input type="number" min="5" max="80" step="0.5" data-selected-height value="${draft.visualLayout.heights[row] || draft.visualLayout.rowHeight}"></label>${actionButton('delete-selected', '删除这名人员')}` : ''}</fieldset>`;
      selectHighlight();
    }
    async function close() {
      try { await persist(); } catch (error) { fail(error); return; }
      disposed = true; clearTimeout(saveTimer); cancelAnimationFrame(frames); root.removeEventListener('resize', fit); root.removeEventListener('beforeunload', beforeUnload); overlay.remove(); context.closed();
    }
    function beforeUnload(event) { if (savedRevision < revision || saving) { event.preventDefault(); event.returnValue = ''; } }
    async function execute(action) {
      if (action === 'import-excel') {
        if (typeof context.selectAndReadExcel !== 'function') throw new Error('当前环境暂不支持选择 Excel 文件');
        const result = await context.selectAndReadExcel();
        if (!result?.ok) { if (!result?.canceled) throw new Error(result?.error || 'Excel 导入失败'); return; }
        pendingExcel = result.data; reviewExcel(); return;
      }
      if (action === 'cancel-excel') { pendingExcel = null; reviewExcel(); return; }
      if (action === 'back-excel') { mappingSheetIndex = -1; reviewExcel(); return; }
      if (action === 'apply-excel-mapping') {
        const sheet = pendingExcel?.sheets?.[mappingSheetIndex];
        if (!sheet) throw new Error('工作表已失效，请重新选择文件');
        if (!root.DisbursementExcelParser) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '../shared/disbursement-excel-parser.js'; script.onload = resolve; script.onerror = () => reject(new Error('Excel 识别工具加载失败，请重试')); document.head.appendChild(script); });
        const fields = {};
        for (const control of all('[data-excel-map]')) if (control.value !== '') fields[control.dataset.excelMap] = Number(control.value);
        if (new Set(Object.values(fields)).size !== Object.keys(fields).length) throw new Error('同一列不能对应多个字段');
        const parsed = root.DisbursementExcelParser.parseDisbursementExcelGrid(sheet.rawGrid, { fields, headerRowNumber: Number($('[data-excel-header]').value) });
        pendingExcel.sheets[mappingSheetIndex] = { ...sheet, ...parsed, sheetName: sheet.sheetName };
        mappingSheetIndex = -1; reviewExcel(); return;
      }
      if (action === 'confirm-excel') {
        const selected = new Set(all('[data-excel-section]:checked').map((node) => node.dataset.excelSection));
        const sources = excelSections().filter((section) => selected.has(section.key)).flatMap((section) => section.rows);
        if (!sources.length) throw new Error('请至少选择一段包含人员的工作表');
        const existing = draft.rows.filter((row) => ['name', 'bankCard', 'finalAmount', 'quantity', 'unitPrice', 'workItem', 'role', 'remark'].some((key) => M.text(row[key])) || Object.values(row.customData || {}).some((value) => M.text(value)));
        const replace = $('[data-excel-mode]').value === 'replace';
        if (replace && existing.length && !root.confirm(`将用 Excel 中的 ${sources.length} 人替换当前批次已有的 ${existing.length} 人，可用“撤销”恢复。继续吗？`)) return;
        remember();
        const imported = sources.map((source) => {
          let row = importedItem(source);
          const person = M.matchResident(row, people, model);
          if (person) row = M.link(row, person, template, model);
          return row;
        });
        draft.rows = [...(replace ? [] : existing), ...imported];
        if (imported.some((row) => M.text(row.originalAmount)) && !draft.visualLayout.editorColumns.some((column) => column.key === 'originalAmount')) {
          draft.visualLayout.editorColumns.splice(Math.max(0, draft.visualLayout.editorColumns.length - 1), 0, { key: 'originalAmount', label: '原表金额（对照）', numeric: true });
        }
        for (const label of new Set(imported.flatMap((row) => Object.keys(row.customData || {}).filter((key) => M.text(row.customData[key]))))) {
          if (!draft.visualLayout.editorColumns.some((column) => column.key === `custom:${label}`)) draft.visualLayout.editorColumns.push({ key: `custom:${label}`, label, visible: false, numeric: false });
        }
        pendingExcel = null; reviewExcel(); editPage = Math.floor(existing.length / pageSize); syncColumns(); dirty(); renderRows(); summary(); return;
      }
      if (action === 'panel-close') { $('.wb-tools-panel').hidden = true; return; }
      if (action === 'meta-position-reset') { remember(); draft.visualLayout.metadataOffsets = {}; dirty(); redrawPreview(); return; }
      if (['bulk-panel','rule-panel','columns-panel'].includes(action)) { toolPanel(action.split('-')[0]); return; }
      if (action === 'bulk-apply') {
        const scope = $('[data-bulk-scope]').value;
        const ids = scope === 'all' ? draft.rows.map((r) => r.id) : scope === 'filtered' ? filteredRows().map((r) => r.id) : [...checkedRows];
        if (!ids.length) throw new Error('请先勾选人员，或选择当前筛选/全部人员');
        const key = $('[data-bulk-key]').value, onlyEmpty = $('[data-bulk-mode]').value === 'empty';
        const next = M.bulk(draft.rows, {ids, key, value: $('[data-bulk-value]').value, onlyEmpty}, {...template, key: draft.templateKey, visualLayout: draft.visualLayout}, model);
        const changed = next.filter((r,i) => JSON.stringify(r) !== JSON.stringify(draft.rows[i])).length;
        if (!onlyEmpty && !root.confirm(`将替换 ${changed} 人的“${cols.find((c) => c.key === key)?.label}”，可撤销。继续吗？`)) return;
        remember(); draft.rows = next; dirty(); renderRows(); summary(); $('.wb-tools-panel').hidden = true; return;
      }
      if (action === 'rule-apply') {
        const rule = {mode: $('[data-rule-mode]').value, quantity: $('[data-rule-quantity]').value, price: $('[data-rule-price]').value, deduction: $('[data-rule-deduction]').value, amount: $('[data-rule-amount]').value};
        if (rule.mode === 'multiply' && (!rule.quantity || !rule.price)) throw new Error('请先添加数字字段，再选择数量和单价');
        if (rule.mode === 'uniform' && (!M.text(rule.amount) || !Number.isFinite(Number(rule.amount)) || Number(rule.amount) < 0)) throw new Error('请输入非负统一金额');
        remember(); draft.visualLayout.calculation = rule; draft.rows = draft.rows.map(calculate); dirty(); renderRows(); summary(); $('.wb-tools-panel').hidden = true; return;
      }
      if (action === 'column-add') {
        const label = M.text($('[data-new-column]').value); if (!label) throw new Error('请填写字段名称');
        if (draft.visualLayout.editorColumns.some((c) => c.label === label)) throw new Error('已有同名字段');
        remember(); const column = {key: `custom:${uid()}`,label,numeric:$('[data-new-column-type]').value === 'number'}; draft.visualLayout.editorColumns.push(column); draft.visualLayout.printColumns.push({ ...column }); syncColumns(); dirty(); renderRows(); toolPanel('columns'); return;
      }
      if (action === 'editor-column-restore') {
        const key = $('[data-editor-column-source]')?.value;
        const available = [...M.columns(template, draft.templateKey, {}), ...(draft.visualLayout.archivedEditorColumns || []), ...draft.visualLayout.printColumns];
        const column = available.find((item) => item.key === key);
        if (!column || draft.visualLayout.editorColumns.some((item) => item.key === key)) throw new Error('请选择要添加的已有字段');
        remember(); draft.visualLayout.editorColumns.push({ ...column, visible: true }); syncColumns(); dirty(); renderRows(); toolPanel('columns'); return;
      }
      if (action === 'print-column-add') {
        const key = $('[data-print-column-source]')?.value, column = draft.visualLayout.editorColumns.find((item) => item.key === key);
        if (!column) throw new Error('请选择要添加的字段');
        remember(); draft.visualLayout.printColumns.push({ key: column.key, label: column.label, numeric: column.numeric }); draft.visualLayout.labels[column.key] = column.label; dirty(); toolPanel('columns'); return;
      }
      if (action === 'header-add') { remember(); (draft.visualLayout.headers ||= []).push({id:uid(),label:'项目名称',value:''}); dirty(); toolPanel('columns'); return; }
      if (action === 'meta-add') {
        const label = M.text($('[data-new-meta-label]')?.value);
        if (!label) throw new Error('请填写新填写项名称');
        if (metaFields().some((field) => field.label === label)) throw new Error('已有同名填写项');
        remember(); draft.visualLayout.metadataFields.push({ key: `custom:${uid()}`, label }); dirty();
        $('.wb-metadata').outerHTML = metadata(); toolPanel('columns'); return;
      }
      if (action === 'discard') {
        if (!root.confirm('放弃尚未保存的修改并关闭？已经自动保存的草稿会保留。')) return;
        clearTimeout(saveTimer); await saveChain.catch(() => {}); savedRevision = revision; disposed = true;
        root.removeEventListener('resize', fit); root.removeEventListener('beforeunload', beforeUnload); overlay.remove(); context.closed(); return;
      }
      if (action === 'close') return close();
      if (action === 'refresh-printers') return refreshPrinters();
      if (action === 'save') return persist();
      if (action === 'preview') { await persist(true); mode = 'preview'; selected = null; shell(); return; }
      if (action === 'edit') { mode = 'edit'; shell(); return; }
      if (action === 'first' || action === 'prev' || action === 'next') { editPage = action === 'first' ? 0 : Math.max(0, editPage + (action === 'prev' ? -1 : 1)); renderRows(); return; }
      if (action === 'undo' && undo.length) { draft = undo.pop(); dirty(); shell(); return; }
      if (action === 'add') { remember(); draft.rows.push({ id: uid(), name: '', bankCard: '', customData: {} }); editPage = Math.floor((draft.rows.length - 1) / pageSize); renderRows(); dirty(); return; }
      if (action === 'delete-selected') return deleteRow(selected?.row);
      if (['template-save','template-copy'].includes(action)) {
        const name = action === 'template-copy' ? root.prompt('新模板名称', `${template.name}（副本）`) : template.name; if (!M.text(name)) return;
        if (action === 'template-save' && !root.confirm('把当前版式保存为该模板的默认版式？已有批次不会改变。')) return;
        const visualLayout = M.copy(draft.visualLayout); visualLayout.heights = {}; visualLayout.cells = Object.fromEntries(Object.entries(visualLayout.cells).filter(([k]) => k.startsWith('_')));
        await context.saveTemplate({ ...template, name, title: draft.title, visualLayout, workbenchKind: template.workbenchKind || draft.templateKey, workbenchPrintSettings: M.copy(draft.printSettings), paper: draft.printSettings.paper, orientation: draft.printSettings.orientation, rowsPerPage: draft.printSettings.rowsPerPage }, action === 'template-copy');
        return;
      }
      if (['prepare','export','complete','exceptions','print'].includes(action)) {
        if (editable) await persist(true);
        if (layoutError && action === 'print') throw new Error(layoutError);
        if (action === 'print') {
          if (typeof context.beforePrint === 'function') await context.beforePrint(batch);
          measurePages(); if (layoutError) throw new Error(layoutError);
          if (!printerName) throw new Error(printerError || '请先选择打印机');
          const printSize = dimensions();
          const html = `<!doctype html><html><head><meta charset="utf-8"><title>发放表打印</title><style>${printCSS}@page{size:${printSize.width}mm ${printSize.height}mm!important;margin:0!important}html,body{width:${printSize.width}mm!important;margin:0!important;padding:0!important}@media print{.wb-sheet{width:${printSize.width}mm!important;height:${printSize.height}mm!important;margin:0!important}}</style></head><body>${pages.map((p,i) => sheet(p,i,false)).join('')}</body></html>`;
          const result = await context.printPages({ printerName, paper: draft.printSettings.paper, orientation: draft.printSettings.orientation, pageCount: pages.length, html });
          if (!result?.ok) throw new Error(result?.error || '打印任务提交失败');
          if (['draft','prepared'].includes(batch.status)) { batch = await context.markPrinted(batch); editable = false; }
          shell();
          const status = $('[data-printer-status]'); if (status) status.textContent = `已向 ${printers.find((printer) => printer.name === printerName)?.displayName || printerName} 提交 ${pages.length} 页打印任务。请核对纸张输出后再确认发放。`;
          return;
        }
        if (action === 'export') return context.export(batch.id);
        if (action === 'prepare') { batch = await context.prepare(batch); return; }
        if (action === 'complete') {
          await close(); return context.complete(batch.id, true);
        }
        if (action === 'exceptions') { await close(); return context.complete(batch.id, false); }
      }
    }
    function deleteRow(id) {
      if (!editable) return;
      const row = draft.rows.find((r) => r.id === id); if (!row) return;
      if (!root.confirm(`从本次发放表中删除“${row.name || '空白行'}”？不会删除居民档案。`)) return;
      remember(); draft.rows = draft.rows.filter((r) => r.id !== id); selected = null; dirty(); summary(); mode === 'edit' ? renderRows() : redrawPreview();
    }
    overlay.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button) {
        event.preventDefault(); event.stopPropagation();
        if (button.disabled) return;
        const perform = async () => {
          if (button.dataset.columnToggle !== undefined) { const column = draft.visualLayout.editorColumns[Number(button.dataset.columnToggle)]; if (['name','finalAmount'].includes(column.key)) throw new Error('姓名和实发金额为办理必填字段'); remember(); column.visible = column.visible === false; syncColumns(); dirty(); renderRows(); toolPanel('columns'); return; }
          for (const [attribute, direction] of [['printColumnUp', -1], ['printColumnDown', 1]]) if (button.dataset[attribute] !== undefined) { const index = Number(button.dataset[attribute]), target = index + direction, list = draft.visualLayout.printColumns; if (target >= 0 && target < list.length) { remember(); [list[index],list[target]] = [list[target],list[index]]; dirty(); toolPanel('columns'); } return; }
          if (button.dataset.printColumnRemove !== undefined) { if (draft.visualLayout.printColumns.length <= 1) throw new Error('打印表至少保留一列'); remember(); draft.visualLayout.printColumns.splice(Number(button.dataset.printColumnRemove), 1); dirty(); toolPanel('columns'); return; }
          for (const [attribute, direction] of [['metaUp', -1], ['metaDown', 1]]) if (button.dataset[attribute] !== undefined) { const index = Number(button.dataset[attribute]), target = index + direction, list = draft.visualLayout.metadataFields; if (target >= 0 && target < list.length) { remember(); [list[index],list[target]] = [list[target],list[index]]; dirty(); $('.wb-metadata').outerHTML = metadata(); toolPanel('columns'); } return; }
          if (button.dataset.metaRemove !== undefined) { remember(); draft.visualLayout.metadataFields.splice(Number(button.dataset.metaRemove), 1); dirty(); $('.wb-metadata').outerHTML = metadata(); toolPanel('columns'); return; }
          if (button.dataset.removeColumn !== undefined) {
            const i = Number(button.dataset.removeColumn), key = draft.visualLayout.editorColumns[i].key, rule = draft.visualLayout.calculation || {};
            if (['name', 'finalAmount'].includes(key)) throw new Error('姓名和实发金额为办理必填字段，可从打印列中删除');
            if ([rule.quantity,rule.price,rule.deduction].includes(key)) throw new Error('这个字段正在用于金额计算，请先更换计算字段');
            if (draft.visualLayout.printColumns.length === 1 && draft.visualLayout.printColumns[0].key === key) throw new Error('打印表至少保留一列');
            remember();
            const [removed] = draft.visualLayout.editorColumns.splice(i,1);
            draft.visualLayout.archivedEditorColumns ||= [];
            if (!draft.visualLayout.archivedEditorColumns.some((item) => item.key === key)) draft.visualLayout.archivedEditorColumns.push(removed);
            draft.visualLayout.printColumns = draft.visualLayout.printColumns.filter((column) => column.key !== key);
            syncColumns(); dirty(); renderRows(); toolPanel('columns'); return;
          }
          if (button.dataset.removeHeader !== undefined) { remember(); draft.visualLayout.headers.splice(Number(button.dataset.removeHeader),1); dirty(); toolPanel('columns'); return; }
          if (button.dataset.mapExcel !== undefined) { reviewMapping(Number(button.dataset.mapExcel)); return; }
          if (button.dataset.action) { button.disabled = true; try { await execute(button.dataset.action); } finally { if (button.isConnected) button.disabled = false; } }
          else if (button.dataset.choosePerson) { const row = draft.rows.find((r) => r.id === button.dataset.choosePerson); if (row) suggestions(button, row, row.name); }
          else if (button.dataset.person) { const p = people.find((r) => model.personId(r) === button.dataset.person); if (p) selectPerson(button.dataset.targetRow, p); }
          else if (button.dataset.delete) deleteRow(button.dataset.delete);
          else if (button.dataset.auto) { remember(); const i = draft.rows.findIndex((r) => r.id === button.dataset.auto); draft.rows[i].manualAmount = false; draft.rows[i].adjustmentReason = ''; draft.rows[i] = calculate(draft.rows[i]); dirty(); renderRows(); summary(); }
          else if (button.dataset.page !== undefined) { page = Number(button.dataset.page); redrawPreview(false); }
        }; perform().catch(fail); return;
      }
      const cell = event.target.closest('[data-print-cell]'); if (cell) { selected = { row: cell.dataset.printRow, key: cell.dataset.printCell }; inspector(); }
    });
    overlay.addEventListener('input', (event) => {
      if (!editable || event.isComposing) return;
      const control = event.target;
      if (control.hasAttribute('data-search')) { search = control.value.trim(); editPage = 0; renderRows(); return; }
      if (control.hasAttribute('data-show-period')) { remember(); draft.visualLayout.showPeriod = control.checked; dirty(); return; }
      if (control.dataset.metaField) { remember(); if (control.dataset.metaField.startsWith('custom:')) draft.metadataValues[control.dataset.metaField.slice(7)] = control.value; else draft[control.dataset.metaField] = control.value; dirty(); return; }
      if (control.dataset.field) { remember(); draft[control.dataset.field] = control.type === 'checkbox' ? control.checked : control.value; dirty(); return; }
      if (!control.dataset.cell) return;
      const id = control.closest('[data-row]').dataset.row, index = draft.rows.findIndex((r) => r.id === id); if (index < 0) return;
      remember(); let row = draft.rows[index]; const key = control.dataset.cell;
      if (key === 'name' && row.personId && control.value !== row.name) row = M.unlink(row, template);
      set(row, key, control.value); if (key === 'finalAmount') row.manualAmount = true;
      if (key !== 'finalAmount' && key !== 'adjustmentReason') row = calculate(row);
      draft.rows[index] = row;
      if (key === 'name') { refreshRowValue(row, 'bankCard'); suggestions(control, row); }
      if (key !== 'finalAmount' && key !== 'adjustmentReason') refreshRowValue(row, 'finalAmount');
      dirty(); summary();
    });
    overlay.addEventListener('compositionend', (event) => event.target.dispatchEvent(new Event('input', { bubbles: true })));
    overlay.addEventListener('change', (event) => {
      const c = event.target;
      if (c.hasAttribute('data-printer')) { printerName = c.value; return; }
      if (c.hasAttribute('data-check-page')) { filteredRows().slice(editPage*pageSize,(editPage+1)*pageSize).forEach((r) => c.checked ? checkedRows.add(r.id) : checkedRows.delete(r.id)); renderRows(); return; }
      if (c.dataset.checkRow) { c.checked ? checkedRows.add(c.dataset.checkRow) : checkedRows.delete(c.dataset.checkRow); renderRows(); return; }
      if (editable && c.matches('[data-print-column-label],[data-column-visible],[data-column-label],[data-column-numeric],[data-meta-label],[data-header-label],[data-header-value]')) {
        if (c.dataset.printColumnLabel !== undefined && !M.text(c.value)) { fail(new Error('打印列名称不能为空')); return; }
        if (c.hasAttribute('data-column-label') && !M.text(c.value)) { fail(new Error('字段名称不能为空')); return; }
        if (c.hasAttribute('data-meta-label') && !M.text(c.value)) { fail(new Error('顶部填写项名称不能为空')); return; }
        if (c.hasAttribute('data-meta-label') && metaFields().some((field, index) => index !== Number(c.dataset.metaLabel) && field.label === M.text(c.value))) { fail(new Error('顶部填写项名称不能重复')); return; }
        if (c.dataset.columnNumeric !== undefined) {
          const column = draft.visualLayout.editorColumns[Number(c.dataset.columnNumeric)];
          const rule = draft.visualLayout.calculation || {};
          if (c.value !== 'number' && [rule.quantity, rule.price, rule.deduction].includes(column.key)) {
            c.value = 'number'; fail(new Error('这个字段正在用于金额计算，请先更换计算字段')); return;
          }
        }
        remember();
        if (c.dataset.printColumnLabel !== undefined) { const column = draft.visualLayout.printColumns[Number(c.dataset.printColumnLabel)]; column.label = c.value.trim(); draft.visualLayout.labels[column.key] = column.label; }
        if (c.dataset.columnVisible !== undefined) draft.visualLayout.editorColumns[Number(c.dataset.columnVisible)].visible = c.checked;
        if (c.dataset.columnLabel !== undefined) {
          const column = draft.visualLayout.editorColumns[Number(c.dataset.columnLabel)];
          column.label = c.value.trim();
        }
        if (c.dataset.columnNumeric !== undefined) {
          const column = draft.visualLayout.editorColumns[Number(c.dataset.columnNumeric)];
          column.numeric = c.value === 'number';
        }
        if (c.dataset.headerLabel !== undefined) draft.visualLayout.headers[Number(c.dataset.headerLabel)].label = c.value;
        if (c.dataset.metaLabel !== undefined) { draft.visualLayout.metadataFields[Number(c.dataset.metaLabel)].label = c.value.trim(); $('.wb-metadata').outerHTML = metadata(); }
        if (c.dataset.headerValue !== undefined) draft.visualLayout.headers[Number(c.dataset.headerValue)].value = c.value;
        syncColumns(); dirty(); renderRows(); return;
      }
      if (editable && c.hasAttribute('data-selected-reason') && selected) { const row = draft.rows.find((r) => r.id === selected.row); if (row) { remember(); row.adjustmentReason = c.value; dirty(); } return; }
      if (c.dataset.pageSize !== undefined) { pageSize = Number(c.value); editPage = 0; renderRows(); return; }
      if (!editable) return;
      if (c.dataset.cell === 'name') {
        const row = draft.rows.find((r) => r.id === c.closest('[data-row]').dataset.row), found = M.candidates(c.value, people, model);
        if (found.exact.length === 1 && !row.personId) selectPerson(row.id, found.exact[0]); return;
      }
      if (mode !== 'preview' || !c.matches('[data-setting],[data-margin],[data-table],[data-row-height],[data-selected-style],[data-selected-value],[data-selected-width],[data-selected-height]')) return;
      remember();
      if (c.dataset.setting) draft.printSettings[c.dataset.setting] = c.dataset.setting === 'rowsPerPage' ? Math.round(M.clamp(c.value,1,50,10)) : c.value;
      if (c.dataset.margin) draft.printSettings.margins[c.dataset.margin] = M.clamp(c.value,0,40,12);
      if (c.dataset.table) { draft.visualLayout.table[c.dataset.table] = c.value; draft.visualLayout.table = M.style(draft.visualLayout.table); }
      if (c.hasAttribute('data-row-height')) draft.visualLayout.rowHeight = M.clamp(c.value,5,50,8);
      if (selected) {
        if (c.dataset.selectedStyle) { const key = `${selected.row}:${selected.key}`; draft.visualLayout.cells[key] = { ...cellStyle(selected.row, selected.key), [c.dataset.selectedStyle]: c.type === 'checkbox' ? c.checked : c.value }; }
        if (c.hasAttribute('data-selected-width')) changeWidth(selected.key, c.value);
        if (c.hasAttribute('data-selected-height')) draft.visualLayout.heights[selected.row] = M.clamp(c.value,5,80,8);
        if (c.hasAttribute('data-selected-value')) {
          if (selected.row === '_head') draft.visualLayout.labels[selected.key] = c.value;
          else if (selected.row.startsWith('_')) draft[selected.key] = c.value;
          else { const row = draft.rows.find((r) => r.id === selected.row); set(row, selected.key, c.value); if (selected.key === 'finalAmount') row.manualAmount = true; if (selected.key !== 'finalAmount') Object.assign(row, calculate(row)); }
        }
      }
      dirty(); redrawPreview(); summary();
    });
    overlay.addEventListener('pointerdown', (event) => {
      const meta = event.target.closest('[data-meta-drag]');
      if (meta && editable && mode === 'preview') {
        event.preventDefault();
        const key = meta.dataset.metaDrag, position = draft.visualLayout.metadataOffsets?.[key] || {};
        const startX = M.clamp(position.x, -300, 300, 0), startY = M.clamp(position.y, -3, 12, 0);
        const paper = $('.wb-sheet'), widthPerMm = paper.getBoundingClientRect().width / dimensions().width;
        const heightPerMm = widthPerMm * (pageScales[page] || 1);
        const metaRect = meta.getBoundingClientRect(), areaRect = meta.closest('.wb-meta').getBoundingClientRect();
        const baseLeft = metaRect.left - startX * widthPerMm, baseRight = metaRect.right - startX * widthPerMm;
        const minX = (areaRect.left - baseLeft) / widthPerMm, maxX = (areaRect.right - baseRight) / widthPerMm;
        const originX = event.clientX, originY = event.clientY;
        let moved = false;
        const move = (next) => {
          if (!moved && Math.hypot(next.clientX - originX, next.clientY - originY) < 2) return;
          if (!moved) { remember(); moved = true; }
          const x = Math.round(M.clamp(startX + (next.clientX - originX) / widthPerMm, minX, maxX, startX) * 10) / 10;
          const y = Math.round(M.clamp(startY + (next.clientY - originY) / heightPerMm, -3, 12, startY) * 10) / 10;
          draft.visualLayout.metadataOffsets ||= {};
          draft.visualLayout.metadataOffsets[key] = { x, y };
          meta.style.transform = `translate(${x}mm,${y}mm)`;
        };
        const finish = () => {
          root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', finish); root.removeEventListener('pointercancel', finish);
          if (moved) { dirty(); redrawPreview(); inspector(); }
        };
        root.addEventListener('pointermove', move); root.addEventListener('pointerup', finish, { once: true }); root.addEventListener('pointercancel', finish, { once: true });
        return;
      }
      const grip = event.target.closest('[data-col-grip],[data-row-grip]'); if (!grip || !editable) return;
      event.preventDefault(); remember();
      const column = grip.dataset.colGrip, row = grip.dataset.rowGrip, start = column ? event.clientX : event.clientY;
      const zoom = Number($('.wb-sheet').style.zoom) || 1;
      const original = column ? widths()[printColumns().findIndex((c) => c.key === column)] : (draft.visualLayout.heights[row] || draft.visualLayout.rowHeight);
      const move = (e) => { const delta = ((column ? e.clientX : e.clientY) - start) / zoom * 25.4 / 96; if (column) changeWidth(column, original + delta); else draft.visualLayout.heights[row] = M.clamp(original + delta,5,80,8); cancelAnimationFrame(frames); frames = requestAnimationFrame(() => redrawPreview(false)); };
      const finish = () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', finish); root.removeEventListener('pointercancel', finish); dirty(); redrawPreview(); inspector(); };
      root.addEventListener('pointermove', move); root.addEventListener('pointerup', finish, { once:true }); root.addEventListener('pointercancel', finish, { once:true });
    });
    root.addEventListener('resize', fit); root.addEventListener('beforeunload', beforeUnload);
    shell();
    return { close };
  }
  root.DisbursementWorkbench = Object.freeze({ open, printCSS });
})(window);
