'use strict';
(function (root) {
  const M = root.DisbursementWorkbenchModel;
  const E = M.esc;
  const uid = () => root.crypto.randomUUID();
  const option = (values, selected) => values.map((v) => `<option value="${E(v[0])}"${String(v[0]) === String(selected) ? ' selected' : ''}>${E(v[1])}</option>`).join('');
  const input = (key, label, value, type = 'text', attrs = '') => `<label>${E(label)}<input data-field="${E(key)}" type="${type}" value="${E(value)}" ${attrs}></label>`;
  const printCSS = `.wb-sheet{box-sizing:border-box;background:white;color:#000;overflow:hidden;margin:0;break-after:page}.wb-sheet:last-child{break-after:auto}.wb-sheet *{box-sizing:border-box}.wb-sheet h1{font-size:18pt;margin:0 0 5mm;text-align:center;line-height:1.3}.wb-meta,.wb-signers{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2mm;margin:3mm 0;font-size:10pt;line-height:1.4}.wb-sheet table{width:100%;border-collapse:collapse;table-layout:fixed}.wb-sheet td,.wb-sheet th{border:.25mm solid #000;padding:1mm;position:relative;line-height:1.3}.wb-total{font-size:10pt;text-align:right;margin:3mm 0}.wb-grip{display:none}@media print{body{margin:0}.wb-selected{outline:none!important}}`;
  function open(context) {
    const { model, template, people } = context;
    let batch = context.batch ? M.copy(context.batch) : null;
    const editable = !batch || ['draft', 'prepared'].includes(batch.status);
    let draft = batch?.workbenchDraft ? M.copy(batch.workbenchDraft) : {
      id: batch?.id || `workbench-${uid()}`, templateKey: batch?.templateKey || template.key, templateId: batch?.templateId || template.id,
      categoryId: batch?.categoryId || context.category.id, categoryName: batch?.categoryName || context.category.name,
      title: batch?.title || template.title || template.name, period: batch?.period || `${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月`,
      batchDate: batch?.batchDate || new Date().toLocaleDateString('en-CA'), villageName: batch?.villageName || context.villageName,
      approver: batch?.signers?.approver || '', maker: batch?.signers?.maker || '', handler: batch?.signers?.handler || '', notes: batch?.notes || '', isTest: batch?.isTest || false,
      printSettings: M.copy(batch?.printSettings || template.workbenchPrintSettings || { paper: template.paper || 'A5', orientation: template.orientation || 'portrait', rowsPerPage: template.rowsPerPage || 10, margins: { top: 12, bottom: 12, left: 12, right: 12 } }),
      visualLayout: M.layout(batch?.visualLayout || template.visualLayout), rows: (context.initialItems || batch?.items || []).map((r) => M.rawItem(r, model)),
    };
    draft.id = batch?.id || draft.id;
    draft.rows = draft.rows.map((r) => {
      const row = { ...r, id: r.id || uid() };
      return !M.text(row.finalAmount) ? M.recalculate(row, template.workbenchKind || draft.templateKey, model) : row;
    });
    draft.visualLayout = M.layout(draft.visualLayout);
    draft.printSettings.margins ||= { top: 12, bottom: 12, left: 12, right: 12 };
    const cols = M.columns(template, draft.templateKey);
    let mode = batch?.workbenchDraft?.ready === false ? 'edit' : context.preview || !editable ? 'preview' : 'edit';
    let page = 0, editPage = 0, pageSize = 20, pages = [[]], selected = null, saveTimer, saveChain = Promise.resolve();
    let revision = 0, savedRevision = 0, saving = false, disposed = false, saveError = '', layoutError = '', frames = 0;
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
    function fail(error) { const node = $('[data-error]'); if (node) { node.textContent = error.message || String(error); node.hidden = false; } }
    function actionButton(key, label, disabled = false) { return `<button type="button" data-action="${key}"${disabled ? ' disabled' : ''}>${label}</button>`; }
    function shell() {
      overlay.innerHTML = `<section class="wb-window" role="dialog" aria-modal="true" aria-label="资金发放工作台"><header><div><strong>${mode === 'edit' ? '编辑发放表' : '打印预览'}</strong><small>${E(template.name || '')} · ${editable ? '仅修改本批次' : '已锁定，只读'}</small></div><span data-save-status></span>${actionButton('close', '关闭')}</header><p data-error class="wb-error" role="alert" hidden></p><main></main><footer>${editable ? actionButton('undo', '撤销') + actionButton('save', '重试 / 保存草稿') + actionButton('discard', '放弃未保存修改') : ''}<span data-summary></span>${mode === 'edit' ? actionButton('preview', '打印预览 →') : `${editable ? actionButton('edit', '返回编辑表') + actionButton('prepare', '准备打印') : ''}${actionButton('export', '导出 Excel')}${editable || batch?.status === 'printed' ? actionButton('complete', '发放完成') : ''}${actionButton('print', '打印')}`}</footer></section>`;
      if (mode === 'edit') renderEditor(); else renderPreviewShell();
      updateStatus(); summary();
    }
    function summary() {
      const total = draft.rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.finalAmount)) ? model.amountToCents(r.finalAmount || 0) : 0), 0);
      const node = $('[data-summary]'); if (node) node.textContent = `${draft.rows.filter((r) => M.text(r.name)).length} 人 · 合计 ¥${model.centsToYuan(total)}`;
    }
    function metadata() {
      return `<div class="wb-metadata">${input('title', '表格标题', draft.title)}${input('period', '发放期间', draft.period)}${input('batchDate', '发放日期', draft.batchDate, 'date')}${input('villageName', '编制单位', draft.villageName)}${input('approver', '审批人', draft.approver)}${input('maker', '制表人', draft.maker)}${input('handler', '经办人', draft.handler)}${input('notes', '备注', draft.notes)}<label><input type="checkbox" data-field="isTest"${draft.isTest ? ' checked' : ''}>测试批次</label></div>`;
    }
    function renderEditor() {
      $('main').innerHTML = `${metadata()}<div class="wb-toolbar">${actionButton('add', '＋ 添加人员')}<label>复用同类历史人员 <select data-reuse><option value="">请选择历史批次</option>${context.history.filter((b) => b.id !== draft.id && (b.templateId === draft.templateId || b.templateKey === draft.templateKey)).map((b) => `<option value="${E(b.id)}">${E(b.title)} · ${E(b.period)} · ${b.items?.length || 0} 人</option>`).join('')}</select></label>${actionButton('reuse', '复用人员与版式')}<span>输入姓名查询；重名需人工选择。空银行卡可留空。</span></div><div class="wb-grid-host"></div><div class="wb-editor-pages"></div><div class="wb-candidates" role="listbox" hidden></div>`;
      renderRows();
    }
    function get(row, key) { return key.startsWith('custom:') ? row.customData?.[key.slice(7)] ?? '' : row[key] ?? ''; }
    function set(row, key, value) { if (key.startsWith('custom:')) { row.customData ||= {}; row.customData[key.slice(7)] = value; } else row[key] = value; }
    function renderRows() {
      editPage = Math.min(editPage, Math.max(0, Math.ceil(draft.rows.length / pageSize) - 1));
      const visible = draft.rows.slice(editPage * pageSize, (editPage + 1) * pageSize);
      $('.wb-grid-host').innerHTML = `<table class="wb-grid"><thead><tr><th>序号</th>${cols.map((c) => `<th>${E(c.label)}</th>`).join('')}<th>调整原因</th><th>居民关联 / 操作</th></tr></thead><tbody>${visible.map((r, i) => `<tr data-row="${E(r.id)}"><td>${editPage * pageSize + i + 1}</td>${cols.map((c) => `<td><input aria-label="${E(c.label)}" data-cell="${E(c.key)}" value="${E(get(r, c.key))}"${c.numeric ? ' inputmode="decimal"' : ''} autocomplete="off"></td>`).join('')}<td><input data-cell="adjustmentReason" aria-label="手工调整原因" placeholder="手工改金额时填写" value="${E(r.adjustmentReason)}"></td><td><span class="wb-linked">${E(r.personId ? `${r.groupName || '未分组'} · ${r.idCard ? r.idCard.slice(-4) : '已关联'}` : '临时 / 待选择')}</span><button type="button" data-delete="${E(r.id)}">删除</button>${r.manualAmount ? `<button type="button" data-auto="${E(r.id)}">恢复计算</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      $('.wb-editor-pages').innerHTML = `${actionButton('first', '首页', editPage === 0)}${actionButton('prev', '上一页', editPage === 0)}<span>第 ${editPage + 1} / ${Math.max(1, Math.ceil(draft.rows.length / pageSize))} 页</span>${actionButton('next', '下一页', (editPage + 1) * pageSize >= draft.rows.length)}<label>每页 <select data-page-size>${option([10,20,50].map((n) => [n, `${n} 人`]), pageSize)}</select></label>`;
    }
    function suggestions(control, row) {
      const box = $('.wb-candidates'); if (!box) return;
      const found = M.candidates(control.value, people, model);
      if (!found.matches.length) { box.hidden = true; return; }
      const rect = control.getBoundingClientRect();
      box.hidden = false; box.style.left = `${Math.min(rect.left, root.innerWidth - 370)}px`; box.style.top = `${Math.min(rect.bottom + 3, root.innerHeight - 240)}px`;
      box.innerHTML = `<small>${found.exact.length > 1 ? '存在重名，请人工选择' : '选择居民后带入默认银行卡'}${found.total > 20 ? '（仅显示前20条，请细化姓名）' : ''}</small>${found.matches.map((p) => `<button type="button" role="option" data-person="${E(model.personId(p))}" data-target-row="${E(row.id)}">${E(model.personName(p))} · ${E(model.personGroup(p) || '未分组')} · 身份证尾号 ${E(String(p.id_card || p.idCard || '').slice(-4) || '未填写')}</button>`).join('')}`;
    }
    function refreshRowValue(row, key) {
      const tr = all('[data-row]').find((n) => n.dataset.row === row.id);
      tr?.querySelectorAll('[data-cell]').forEach((n) => { if (!key || n.dataset.cell === key) n.value = get(row, n.dataset.cell); });
      const status = tr?.querySelector('.wb-linked'); if (status) status.textContent = row.personId ? `${row.groupName || '未分组'} · ${row.idCard?.slice(-4) || '已关联'}` : '临时 / 待选择';
    }
    function selectPerson(id, person) {
      const index = draft.rows.findIndex((r) => r.id === id); if (index < 0) return;
      remember(); draft.rows[index] = M.link(draft.rows[index], person, template, model);
      refreshRowValue(draft.rows[index]); const box = $('.wb-candidates'); if (box) box.hidden = true; dirty();
    }
    const printColumns = () => [{ key: '_sequence', label: '序号' }, ...cols];
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
    function heading() {
      return `<h1 data-print-row="_title" data-print-cell="title" style="${M.cssStyle({ ...draft.visualLayout.table, size: 18, bold: true, ...draft.visualLayout.cells['_title:title'] })}">${E(draft.title)}</h1><div class="wb-meta">${[['villageName','编制单位'],['period','期间'],['batchDate','日期']].map(([k,l]) => `<span data-print-row="_meta" data-print-cell="${k}" style="${M.cssStyle(cellStyle('_meta',k))}">${l}：${E(draft[k])}</span>`).join('')}<span>单位：元</span></div>`;
    }
    function foot(pageIndex, totalPages) {
      const amount = draft.rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.finalAmount)) ? model.amountToCents(r.finalAmount || 0) : 0), 0);
      return `<div class="wb-total">${pageIndex === totalPages - 1 ? `总计 ¥${model.centsToYuan(amount)} · ${draft.rows.length} 人` : '（续下页）'}</div><div class="wb-signers">${[['approver','审批人'],['maker','制表人'],['handler','经办人']].map(([k,l]) => `<span data-print-row="_meta" data-print-cell="${k}" style="${M.cssStyle(cellStyle('_meta',k))}">${l}：${E(draft[k])}</span>`).join('')}<span>第 ${pageIndex + 1}/${totalPages} 页</span></div>`;
    }
    function sheet(indices, pageIndex, interactive = false) {
      const d = dimensions(), m = draft.printSettings.margins;
      return `<article class="wb-sheet" style="width:${d.width}mm;height:${d.height}mm;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;font-family:'${draft.visualLayout.table.font}',serif">${heading()}<table>${tableHead(interactive)}<tbody>${indices.map((index) => tableRow(index, interactive)).join('')}</tbody></table>${foot(pageIndex, pages.length)}</article>`;
    }
    function measurePages() {
      const measure = document.createElement('div'); measure.className = 'wb-measure';
      const d = dimensions(), m = draft.printSettings.margins;
      measure.innerHTML = sheet(draft.rows.map((_, i) => i), 0);
      overlay.appendChild(measure);
      try {
        const paper = measure.querySelector('.wb-sheet'); const pxPerMm = paper.getBoundingClientRect().width / d.width;
        const measureHeight = (sel) => { const node = measure.querySelector(sel); const css = root.getComputedStyle(node); return node.getBoundingClientRect().height + parseFloat(css.marginTop || 0) + parseFloat(css.marginBottom || 0); };
        const reserved = measureHeight('h1') + measureHeight('.wb-meta') + measureHeight('thead') + measureHeight('.wb-total') + measureHeight('.wb-signers') + 2 * pxPerMm;
        const heights = [...measure.querySelectorAll('[data-measure-row]')].map((r) => r.getBoundingClientRect().height);
        const available = (d.height - m.top - m.bottom) * pxPerMm - reserved;
        if (available <= 0) throw new Error('标题、眉头或边距占满了纸张，请调整后打印');
        pages = M.paginate(heights, available, draft.printSettings.rowsPerPage);
        page = Math.max(0, Math.min(page, pages.length - 1)); layoutError = '';
      } catch (error) { layoutError = error.message; pages = [draft.rows.map((_, i) => i)]; page = 0; }
      finally { measure.remove(); }
    }
    function renderPreviewShell() {
      const s = draft.printSettings, l = draft.visualLayout;
      $('main').innerHTML = `<div class="wb-preview"><aside class="wb-settings"><fieldset${editable ? '' : ' disabled'}><h3>纸张设置</h3><label>纸张<select data-setting="paper">${option([['A4','A4'],['A5','A5']], s.paper)}</select></label><label>方向<select data-setting="orientation">${option([['portrait','纵向'],['landscape','横向']], s.orientation)}</select></label><label>每页最多人数<input type="number" min="1" max="50" data-setting="rowsPerPage" value="${s.rowsPerPage}"></label><div class="wb-margin-grid">${[['top','上'],['bottom','下'],['left','左'],['right','右']].map(([k, name]) => `<label>${name}边距 mm<input type="number" min="0" max="40" data-margin="${k}" value="${s.margins[k]}"></label>`).join('')}</div><h3>整表格式</h3><label>字体<select data-table="font">${option(M.fonts.map((f) => [f, ({'Songti SC':'宋体（Mac）',SimSun:'宋体','PingFang SC':'苹方','Microsoft YaHei':'微软雅黑'})[f] || f]), l.table.font)}</select></label><label>字号 pt<input type="number" min="6" max="36" data-table="size" value="${l.table.size}"></label><label>默认行高 mm<input type="number" min="5" max="50" data-row-height value="${l.rowHeight}"></label><p>点击纸张中的单元格，在右侧修改。表头右边和序号下边可拖动。</p>${actionButton('template-save','保存到当前模板')}${actionButton('template-copy','另存新模板')}</fieldset></aside><section class="wb-paper-area"><div class="wb-layout-error" role="alert"></div><div class="wb-paper-holder"></div></section><aside class="wb-inspector"><h3>页面</h3><div class="wb-page-list"></div><h3>选中单元格</h3><div class="wb-cell-inspector">点击标题、眉头、表头或数据单元格。</div></aside></div>`;
      redrawPreview(true);
    }
    function redrawPreview(measure = true) {
      if (disposed || mode !== 'preview') return;
      if (measure) measurePages();
      $('.wb-layout-error').textContent = layoutError;
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
      $('.wb-cell-inspector').innerHTML = `<fieldset${editable ? '' : ' disabled'}><strong>${E(c?.label || key)}</strong>${key !== '_sequence' && key !== 'name' ? `<label>内容<textarea data-selected-value>${E(value)}</textarea></label>` : `<p>${E(key === 'name' ? '姓名请在编辑表中修改，以便重新确认居民关联。' : '序号自动生成')}</p>`}${canFormat ? `<label>字体<select data-selected-style="font">${option(M.fonts.map((f) => [f,f]), format.font)}</select></label><label>字号<input type="number" min="6" max="36" data-selected-style="size" value="${format.size}"></label><label>对齐<select data-selected-style="align">${option([['left','左'],['center','居中'],['right','右']], format.align)}</select></label><label>垂直<select data-selected-style="vertical">${option([['top','靠上'],['middle','居中'],['bottom','靠下']], format.vertical)}</select></label><label><input type="checkbox" data-selected-style="bold"${format.bold ? ' checked' : ''}>加粗</label><label><input type="checkbox" data-selected-style="wrap"${format.wrap ? ' checked' : ''}>自动换行</label>` : ''}${c ? `<label>列宽 mm<input type="number" min="3" step="0.5" data-selected-width value="${widths()[printColumns().indexOf(c)].toFixed(1)}"></label>` : ''}${record ? `<label>手工调整原因<input data-selected-reason value="${E(record.adjustmentReason)}"></label><label>行高 mm<input type="number" min="5" max="80" step="0.5" data-selected-height value="${draft.visualLayout.heights[row] || draft.visualLayout.rowHeight}"></label>${actionButton('delete-selected', '删除这名人员')}` : ''}</fieldset>`;
      selectHighlight();
    }
    async function close() {
      try { await persist(); } catch (error) { fail(error); return; }
      disposed = true; clearTimeout(saveTimer); cancelAnimationFrame(frames); root.removeEventListener('resize', fit); root.removeEventListener('beforeunload', beforeUnload); overlay.remove(); context.closed();
    }
    function beforeUnload(event) { if (savedRevision < revision || saving) { event.preventDefault(); event.returnValue = ''; } }
    async function execute(action) {
      if (action === 'discard') {
        if (!root.confirm('放弃尚未保存的修改并关闭？已经自动保存的草稿会保留。')) return;
        clearTimeout(saveTimer); await saveChain.catch(() => {}); savedRevision = revision; disposed = true;
        root.removeEventListener('resize', fit); root.removeEventListener('beforeunload', beforeUnload); overlay.remove(); context.closed(); return;
      }
      if (action === 'close') return close();
      if (action === 'save') return persist();
      if (action === 'preview') { await persist(true); mode = 'preview'; selected = null; shell(); return; }
      if (action === 'edit') { mode = 'edit'; shell(); return; }
      if (action === 'first' || action === 'prev' || action === 'next') { editPage = action === 'first' ? 0 : Math.max(0, editPage + (action === 'prev' ? -1 : 1)); renderRows(); return; }
      if (action === 'undo' && undo.length) { draft = undo.pop(); dirty(); shell(); return; }
      if (action === 'add') { remember(); draft.rows.push({ id: uid(), name: '', bankCard: '', customData: {} }); editPage = Math.floor((draft.rows.length - 1) / pageSize); renderRows(); dirty(); return; }
      if (action === 'reuse') {
        const source = context.history.find((b) => b.id === $('[data-reuse]').value); if (!source) throw new Error('请先选择历史批次');
        if (draft.rows.some((r) => M.text(r.name)) && !root.confirm('将用历史人员替换当前草稿人员；原历史批次不会改变。继续吗？')) return;
        remember(); draft.rows = M.reuse(source, template, people, model).map((r) => ({ ...r, id: uid() }));
        draft.visualLayout = M.layout(source.visualLayout || draft.visualLayout); draft.visualLayout.heights = {}; draft.visualLayout.cells = Object.fromEntries(Object.entries(draft.visualLayout.cells).filter(([k]) => k.startsWith('_')));
        draft.printSettings = M.copy(source.printSettings || draft.printSettings); dirty(); renderRows(); summary(); return;
      }
      if (action === 'delete-selected') return deleteRow(selected?.row);
      if (['template-save','template-copy'].includes(action)) {
        const name = action === 'template-copy' ? root.prompt('新模板名称', `${template.name}（副本）`) : template.name; if (!M.text(name)) return;
        if (action === 'template-save' && !root.confirm('把当前版式保存为该模板的默认版式？已有批次不会改变。')) return;
        const visualLayout = M.copy(draft.visualLayout); visualLayout.heights = {}; visualLayout.cells = Object.fromEntries(Object.entries(visualLayout.cells).filter(([k]) => k.startsWith('_')));
        await context.saveTemplate({ ...template, name, title: draft.title, visualLayout, workbenchKind: template.workbenchKind || draft.templateKey, workbenchPrintSettings: M.copy(draft.printSettings), paper: draft.printSettings.paper, orientation: draft.printSettings.orientation, rowsPerPage: draft.printSettings.rowsPerPage }, action === 'template-copy');
        return;
      }
      if (['prepare','export','complete','print'].includes(action)) {
        if (editable) await persist(true);
        if (layoutError && action === 'print') throw new Error(layoutError);
        if (action === 'print') {
          measurePages(); if (layoutError) throw new Error(layoutError);
          const popup = root.open('', '_blank'); if (!popup) throw new Error('无法打开打印窗口，请允许打印窗口');
          popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>发放表打印</title><style>${printCSS}@page{size:${draft.printSettings.paper} ${draft.printSettings.orientation};margin:0}</style></head><body>${pages.map((p,i) => sheet(p,i,false)).join('')}</body></html>`); popup.document.close();
          await popup.document.fonts.ready; popup.focus(); popup.print();
          if (['draft','prepared','printed'].includes(batch.status) && root.confirm('打印是否已成功完成？确认后登记打印状态；取消则保持原状态。')) { batch = await context.markPrinted(batch); await close(); }
          return;
        }
        if (action === 'export') return context.export(batch.id);
        if (action === 'prepare') { batch = await context.prepare(batch); return; }
        if (action === 'complete') {
          if (!root.confirm('确认本批次已实际发放完成？随后将核对银行卡并写入居民记录。')) return;
          await close(); return context.complete(batch.id);
        }
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
          if (button.dataset.action) { button.disabled = true; try { await execute(button.dataset.action); } finally { if (button.isConnected) button.disabled = false; } }
          else if (button.dataset.person) { const p = people.find((r) => model.personId(r) === button.dataset.person); if (p) selectPerson(button.dataset.targetRow, p); }
          else if (button.dataset.delete) deleteRow(button.dataset.delete);
          else if (button.dataset.auto) { remember(); const i = draft.rows.findIndex((r) => r.id === button.dataset.auto); draft.rows[i].manualAmount = false; draft.rows[i].adjustmentReason = ''; draft.rows[i] = M.recalculate(draft.rows[i], template.workbenchKind || draft.templateKey, model); dirty(); renderRows(); summary(); }
          else if (button.dataset.page !== undefined) { page = Number(button.dataset.page); redrawPreview(false); }
        }; perform().catch(fail); return;
      }
      const cell = event.target.closest('[data-print-cell]'); if (cell) { selected = { row: cell.dataset.printRow, key: cell.dataset.printCell }; inspector(); }
    });
    overlay.addEventListener('input', (event) => {
      if (!editable || event.isComposing) return;
      const control = event.target;
      if (control.dataset.field) { remember(); draft[control.dataset.field] = control.type === 'checkbox' ? control.checked : control.value; dirty(); return; }
      if (!control.dataset.cell) return;
      const id = control.closest('[data-row]').dataset.row, index = draft.rows.findIndex((r) => r.id === id); if (index < 0) return;
      remember(); let row = draft.rows[index]; const key = control.dataset.cell;
      if (key === 'name' && row.personId && control.value !== row.name) row = M.unlink(row, template);
      set(row, key, control.value); if (key === 'finalAmount') row.manualAmount = true;
      if (['quantity','unitPrice','deductions'].includes(key)) row = M.recalculate(row, template.workbenchKind || draft.templateKey, model);
      draft.rows[index] = row;
      if (key === 'name') { refreshRowValue(row, 'bankCard'); suggestions(control, row); }
      if (['quantity','unitPrice','deductions'].includes(key)) refreshRowValue(row, 'finalAmount');
      dirty(); summary();
    });
    overlay.addEventListener('compositionend', (event) => event.target.dispatchEvent(new Event('input', { bubbles: true })));
    overlay.addEventListener('change', (event) => {
      const c = event.target;
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
          else { const row = draft.rows.find((r) => r.id === selected.row); set(row, selected.key, c.value); if (selected.key === 'finalAmount') row.manualAmount = true; if (['quantity','unitPrice','deductions'].includes(selected.key)) Object.assign(row, M.recalculate(row, template.workbenchKind || draft.templateKey, model)); }
        }
      }
      dirty(); redrawPreview(); summary();
    });
    overlay.addEventListener('pointerdown', (event) => {
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
