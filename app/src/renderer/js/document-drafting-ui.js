'use strict';

(function documentDraftingModule() {
  const api = window.api;
  if (!api) return;

  const state = {
    view: 'workspace',
    preferredKind: 'auto',
    current: null,
    layout: null,
    savedSelectionRange: null,
    preview: { mode: 'page', scale: 1, resizeObserver: null, mutationObserver: null, frame: null },
    selectedReferences: new Map(),
    autosaveTimer: null,
  };

  const BUSINESS_LABELS = {
    personnel: '村民档案', households: '家庭档案', partyMembers: '党员信息',
    visitRecords: '民情记录', dutyRecords: '值班记录', finances: '财务记录',
    landParcel: '土地记录', certificates: '证明记录', documents: '电子档案',
  };

  const DOCUMENT_LAYOUT_PRESETS = {
    request: { preset: 'request', paper: 'A4', titleFont: 'heiti', titleSize: 22, titleBold: true, bodyFont: 'fangsong', bodySize: 16, lineSpacing: 28.95, firstLineChars: 2, margins: { top: 30, right: 26, bottom: 35, left: 28 }, addressee: '晓店街道办事处', signatureUnit: '陆庄社区居民委员会' },
    report: { preset: 'report', paper: 'A4', titleFont: 'songti', titleSize: 24, titleBold: true, bodyFont: 'fangsong', bodySize: 16, lineSpacing: 28.95, firstLineChars: 2, margins: { top: 25.4, right: 31.75, bottom: 25.4, left: 31.75 }, addressee: '晓店街道办事处', signatureUnit: '陆庄社区居民委员会' },
  };

  const DOCUMENT_FONT_FAMILIES = {
    fangsong: '"FangSong_GB2312", "FangSong", "STFangsong", "仿宋", "Songti SC", serif',
    songti: '"Songti SC", "STSong", "宋体", serif',
    heiti: '"Heiti SC", "STHeiti", "黑体", sans-serif',
    kaiti: '"Kaiti SC", "STKaiti", "楷体", serif',
  };

  const A4_ASPECT_RATIO = 297 / 210;

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function cloneLayout(layout) {
    return JSON.parse(JSON.stringify(layout || DOCUMENT_LAYOUT_PRESETS.report));
  }

  function layoutPreset(name, current = null) {
    const preset = cloneLayout(DOCUMENT_LAYOUT_PRESETS[name] || DOCUMENT_LAYOUT_PRESETS.report);
    if (current) {
      preset.addressee = current.addressee || preset.addressee;
      preset.signatureUnit = current.signatureUnit || preset.signatureUnit;
    }
    return preset;
  }

  function currentTitle() {
    return document.querySelector('#documentEditor [data-doc-role="title"]')?.innerText.trim()
      || state.current?.document?.title
      || '';
  }

  function currentLayout() {
    return cloneLayout(state.layout || DOCUMENT_LAYOUT_PRESETS.report);
  }

  function inferMarginPreset(layout) {
    const margins = layout.margins || {};
    const close = (left, right) => Math.abs(Number(left) - Number(right)) < 0.1;
    const reference = DOCUMENT_LAYOUT_PRESETS[layout.preset]?.margins || DOCUMENT_LAYOUT_PRESETS.report.margins;
    if (Object.keys(reference).every((key) => close(margins[key], reference[key]))) return 'reference';
    if (['top', 'right', 'bottom', 'left'].every((key) => close(margins[key], 25))) return 'standard';
    if (['top', 'right', 'bottom', 'left'].every((key) => close(margins[key], 20))) return 'compact';
    return 'custom';
  }

  function updateEditorLayout() {
    const editor = document.getElementById('documentEditor');
    if (!editor || !state.layout) return;
    const layout = state.layout;
    editor.style.setProperty('--document-body-font', DOCUMENT_FONT_FAMILIES[layout.bodyFont] || DOCUMENT_FONT_FAMILIES.fangsong);
    editor.style.setProperty('--document-body-size', `${layout.bodySize}pt`);
    editor.style.setProperty('--document-line-spacing', `${layout.lineSpacing}pt`);
    editor.style.setProperty('--document-signature-spacing', `${layout.lineSpacing * 2}pt`);
    editor.style.setProperty('--document-title-font', DOCUMENT_FONT_FAMILIES[layout.titleFont] || DOCUMENT_FONT_FAMILIES.heiti);
    editor.style.setProperty('--document-title-size', `${layout.titleSize}pt`);
    editor.style.setProperty('--document-title-weight', layout.titleBold ? '700' : '400');
    editor.style.setProperty('--document-first-indent', `${layout.firstLineChars}em`);
    editor.style.padding = `${layout.margins.top}mm ${layout.margins.right}mm ${layout.margins.bottom}mm ${layout.margins.left}mm`;
    scheduleEditorPreviewUpdate();
  }

  function clampPreviewScale(value) {
    return Math.min(1.25, Math.max(0.35, Number(value) || 1));
  }

  function updateEditorPreview() {
    const editor = document.getElementById('documentEditor');
    const viewport = document.getElementById('documentEditorViewport');
    const stage = document.getElementById('documentEditorStage');
    if (!editor || !viewport || !stage || !editor.offsetWidth) return;
    const paperWidth = editor.offsetWidth;
    const paperHeight = paperWidth * A4_ASPECT_RATIO;
    const availableWidth = Math.max(1, viewport.clientWidth - 30);
    const availableHeight = Math.max(1, viewport.clientHeight - 30);
    if (state.preview.mode === 'page') state.preview.scale = clampPreviewScale(Math.min(availableWidth / paperWidth, availableHeight / paperHeight));
    else if (state.preview.mode === 'width') state.preview.scale = clampPreviewScale(availableWidth / paperWidth);
    else if (state.preview.mode === 'actual') state.preview.scale = 1;
    const contentHeight = Math.max(paperHeight, editor.scrollHeight);
    editor.style.transform = `scale(${state.preview.scale})`;
    stage.style.width = `${Math.ceil(paperWidth * state.preview.scale)}px`;
    stage.style.height = `${Math.ceil(contentHeight * state.preview.scale)}px`;
    const percentage = Math.round(state.preview.scale * 100);
    const value = document.getElementById('documentPreviewZoomValue');
    if (value) value.textContent = `${percentage}%`;
    const modeSelect = document.getElementById('documentPreviewZoomMode');
    if (modeSelect) modeSelect.value = state.preview.mode;
  }

  function scheduleEditorPreviewUpdate() {
    if (state.preview.frame) window.cancelAnimationFrame?.(state.preview.frame);
    const run = () => {
      state.preview.frame = null;
      updateEditorPreview();
    };
    state.preview.frame = window.requestAnimationFrame ? window.requestAnimationFrame(run) : window.setTimeout(run, 0);
  }

  function setPreviewMode(mode) {
    if (!['page', 'width', 'actual', 'manual'].includes(mode)) return;
    state.preview.mode = mode;
    scheduleEditorPreviewUpdate();
  }

  function adjustPreviewScale(change) {
    state.preview.mode = 'manual';
    state.preview.scale = clampPreviewScale(state.preview.scale + change);
    scheduleEditorPreviewUpdate();
  }

  function applyLayoutToUi(layout) {
    state.layout = cloneLayout(layout || DOCUMENT_LAYOUT_PRESETS.report);
    const setValue = (id, value) => { const element = document.getElementById(id); if (element) element.value = String(value); };
    setValue('documentLayoutPreset', state.layout.preset);
    setValue('documentAddressee', state.layout.addressee);
    setValue('documentSignatureUnit', state.layout.signatureUnit);
    setValue('documentInlineFont', state.layout.bodyFont);
    setValue('documentInlineSize', state.layout.bodySize);
    setValue('documentLineSpacing', state.layout.lineSpacing);
    const marginPreset = inferMarginPreset(state.layout);
    const marginSelect = document.getElementById('documentMarginPreset');
    if (marginSelect) {
      if (marginPreset === 'custom' && !marginSelect.querySelector('option[value="custom"]')) marginSelect.insertAdjacentHTML('beforeend', '<option value="custom">自定义设置</option>');
      marginSelect.value = marginPreset;
    }
    updateEditorLayout();
  }

  function syncIdentityFieldsToEditor() {
    const editor = document.getElementById('documentEditor');
    const addressee = editor?.querySelector('[data-doc-role="addressee"]');
    const signature = editor?.querySelector('[data-doc-role="signature"]');
    if (addressee) addressee.textContent = `${state.layout.addressee}：`;
    if (signature) signature.textContent = state.layout.signatureUnit;
  }

  function syncIdentityFieldsFromEditor() {
    const editor = document.getElementById('documentEditor');
    const addressee = editor?.querySelector('[data-doc-role="addressee"]')?.innerText.trim().replace(/[：:]$/u, '');
    const signature = editor?.querySelector('[data-doc-role="signature"]')?.innerText.trim();
    if (addressee) state.layout.addressee = addressee;
    if (signature) state.layout.signatureUnit = signature;
    const addresseeInput = document.getElementById('documentAddressee');
    const signatureInput = document.getElementById('documentSignatureUnit');
    if (addresseeInput && addressee) addresseeInput.value = addressee;
    if (signatureInput && signature) signatureInput.value = signature;
  }

  function selectedRangeInsideEditor() {
    const selection = window.getSelection?.();
    const editor = document.getElementById('documentEditor');
    const rangeIsUsable = (range) => Boolean(range?.commonAncestorContainer?.isConnected && editor?.contains(range.commonAncestorContainer));
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (rangeIsUsable(range)) return range;
    }
    return rangeIsUsable(state.savedSelectionRange) && !state.savedSelectionRange.collapsed ? state.savedSelectionRange : null;
  }

  function clearInlineOverrides(attribute) {
    const editor = document.getElementById('documentEditor');
    if (!editor) return;
    editor.querySelectorAll(`[${attribute}]`).forEach((element) => element.removeAttribute(attribute));
    editor.querySelectorAll('span:not([data-doc-font]):not([data-doc-size])').forEach((span) => span.replaceWith(...span.childNodes));
    editor.normalize();
  }

  function applyInlineFormat(attribute, value) {
    const range = selectedRangeInsideEditor();
    if (!range) {
      state.savedSelectionRange = null;
      clearInlineOverrides(attribute);
      if (attribute === 'data-doc-font') {
        state.layout.bodyFont = value;
        state.layout.titleFont = value;
      } else {
        state.layout.bodySize = Number(value);
        state.layout.titleSize = Number(value);
      }
      applyLayoutToUi(state.layout);
      queueAutosave();
      return;
    }
    const span = document.createElement('span');
    span.setAttribute(attribute, String(value));
    try {
      range.surroundContents(span);
    } catch {
      span.append(range.extractContents());
      range.insertNode(span);
    }
    span.querySelectorAll(`[${attribute}]`).forEach((element) => element.removeAttribute(attribute));
    span.querySelectorAll('span:not([data-doc-font]):not([data-doc-size])').forEach((element) => element.replaceWith(...element.childNodes));
    const selection = window.getSelection();
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.addRange(nextRange);
    state.savedSelectionRange = nextRange.cloneRange();
    scheduleEditorPreviewUpdate();
    queueAutosave();
  }

  function applyParagraphAlignment(alignment) {
    const selection = window.getSelection?.();
    let node = selection?.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const editor = document.getElementById('documentEditor');
    const block = node?.closest?.('p,h1,h2,h3,h4,li,blockquote');
    if (block && editor.contains(block)) {
      block.dataset.docAlign = alignment;
      queueAutosave();
    }
    editor.focus();
  }

  function sectionMarkup() {
    return `<section class="tab-content hidden" id="tab-document-drafting">
      <div class="content-header document-drafting-header">
        <div><h2>公文拟写 <span class="header-sub-tag">描述需求，AI 直接生成</span></h2><p class="text-secondary">输入一段内容即可生成报告或合同；右侧可直接修改，也可补充要求重新生成全文。</p></div>
        <div class="document-header-actions"><button class="btn btn-outline" id="documentProfileBtn">我的写作偏好</button><button class="btn btn-outline" id="documentHistoryBtn">历史记录</button><button class="btn btn-primary" id="documentNewDraftBtn">＋ 新建公文</button></div>
      </div>
      <div id="documentWorkspaceView" class="document-workspace-view">
        <div class="document-conversation-grid">
          <aside class="document-chat-panel">
            <div class="document-chat-header"><div><strong>🤖 AI 公文助手</strong><small>说清事项和要求，AI 立即生成完整公文</small></div><span id="documentDraftStatus" class="badge badge-info">新公文</span></div>
            <div class="document-kind-switch" aria-label="公文类型">
              <button class="active" id="documentKindAuto" data-document-kind="auto">自动识别</button>
              <button id="documentKindReport" data-document-kind="report">报告</button>
              <button id="documentKindContract" data-document-kind="contract">合同</button>
            </div>
            <div id="documentDirectIntro" class="document-direct-intro">
              <b>只需描述一次，直接生成全文</b>
              <p>可写明事项、对象、金额、时间和重点要求。资料不完整时，AI 会先完成可写内容，合同关键缺项将标记“【待补充】”。</p>
              <div class="document-prompt-examples"><button data-example="写一份申请拨付过渡房费用的请示，说明事项、金额和拨付要求。">费用请示示例</button><button data-example="写一份社区保洁服务合同，已知内容直接写入，缺少的关键条款标记待补充。">服务合同示例</button></div>
            </div>
            <div class="document-chat-composer">
              <label for="documentConversationInput" id="documentConversationLabel">描述需要拟写的内容</label>
              <textarea id="documentConversationInput" rows="5" placeholder="例如：写一份申请拨付小杨庄过渡房费用的请示。东七组占地40余亩，每亩900元，合计36000元，请求按期拨付。"></textarea>
              <div class="document-composer-actions"><span id="documentReferenceCount">未引用历史资料</span><button class="btn btn-primary" id="documentConversationSendBtn">✦ 开始 AI 拟写</button></div>
              <p class="document-chat-hint">生成后可直接修改右侧正文；整体不满意时，在同一输入框补充要求并重新生成全文。</p>
            </div>
            <details class="document-advanced-settings">
              <summary>参考资料与高级设置</summary>
              <label class="document-field-label" for="documentVisibility">可见范围</label>
              <select id="documentVisibility" class="document-control"><option value="shared">社区共享</option><option value="private">仅自己可见</option></select>
              <label class="document-field-label" for="documentHistoryReferenceQuery">手动查找历史公文</label>
              <div class="document-inline-picker"><input id="documentHistoryReferenceQuery" class="document-control" placeholder="输入标题或事项关键词"><button class="btn btn-outline" id="documentRefreshRecommendationsBtn">查找</button></div>
              <div id="documentRecommendedReferences" class="document-reference-list"></div>
              <label class="document-field-label" for="documentBusinessCollection">选择业务资料</label>
              <div class="document-inline-picker"><select id="documentBusinessCollection" class="document-control">${Object.entries(BUSINESS_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><button class="btn btn-outline" id="documentLoadBusinessBtn">加载</button></div>
              <div id="documentBusinessReferences" class="document-reference-list"></div>
            </details>
          </aside>
          <main class="document-editor-panel">
            <div class="document-editor-toolbar"><div class="document-format-toolbar"><select id="documentInlineFont" aria-label="字体"><option value="fangsong">仿宋</option><option value="songti">宋体</option><option value="heiti">黑体</option><option value="kaiti">楷体</option></select><select id="documentInlineSize" aria-label="字号"><option value="22">二号</option><option value="18">小二</option><option value="16">三号</option><option value="15">小三</option><option value="14">四号</option><option value="12">小四</option></select><button type="button" data-editor-command="bold"><b>B</b></button><button type="button" data-editor-command="insertUnorderedList">• 列表</button><button type="button" data-editor-align="left">左对齐</button><button type="button" data-editor-align="center">居中</button><button type="button" data-editor-align="right">右对齐</button><button type="button" id="documentFormatToggle">版式设置</button></div><div class="document-editor-meta"><div class="document-preview-toolbar" aria-label="A4 预览缩放"><select id="documentPreviewZoomMode" aria-label="预览比例"><option value="page">适合页面</option><option value="width">适合宽度</option><option value="actual">100%</option><option value="manual" hidden>自定义</option></select><button type="button" id="documentPreviewZoomOut" title="缩小预览">−</button><span id="documentPreviewZoomValue">100%</span><button type="button" id="documentPreviewZoomIn" title="放大预览">＋</button></div><span id="documentAutosaveStatus">等待描述</span></div></div>
            <div id="documentFormatPanel" class="document-format-panel hidden"><label>参考版式<select id="documentLayoutPreset"><option value="request">请示版（样稿一）</option><option value="report">报告版（样稿二）</option></select></label><label>抬头<input id="documentAddressee" value="晓店街道办事处"></label><label>落款单位<input id="documentSignatureUnit" value="陆庄社区居民委员会"></label><label>正文行距<select id="documentLineSpacing"><option value="28.95">固定 29 磅</option><option value="24">固定 24 磅</option><option value="32">固定 32 磅</option><option value="36">固定 36 磅</option></select></label><label>页边距<select id="documentMarginPreset"><option value="reference">参考样稿</option><option value="standard">标准</option><option value="compact">紧凑</option></select></label><button type="button" class="btn btn-outline" id="documentRestoreLayoutBtn">恢复样稿版式</button><small>无选区时字体字号作用于全文；选中文字后只调整选中内容。</small></div>
            <div id="documentContractWarning" class="document-contract-warning hidden">合同由 AI 辅助生成，请重点核对主体、金额、期限、付款、违约责任和争议解决条款。</div>
            <div id="documentEditorViewport" class="document-editor-viewport"><div id="documentEditorStage" class="document-editor-stage"><div id="documentEditor" class="document-editor" contenteditable="true" data-placeholder="在左侧描述需求后，生成的公文会出现在这里"></div></div></div>
            <div id="documentSourceSummary" class="document-source-summary hidden"></div>
            <div class="document-editor-footer"><div><button class="btn btn-outline" id="documentCopyBtn">复制</button><button class="btn btn-outline" id="documentSaveVersionBtn">保存新版本</button><button class="btn btn-outline" id="documentVersionsBtn">版本记录</button><button class="btn btn-outline" id="documentPrintBtn">打印预览</button><button class="btn btn-outline" id="documentExportWordBtn">导出 Word</button><button class="btn btn-outline" id="documentExportPdfBtn">导出 PDF</button></div><button class="btn btn-primary" id="documentFinalizeBtn">标记定稿</button></div>
          </main>
        </div>
      </div>
      <div id="documentHistoryView" class="document-history-view hidden"><div class="document-history-heading"><button class="btn btn-outline" id="documentBackToWorkspaceBtn">← 返回拟写</button><h3>历史记录</h3></div><div class="document-history-filters"><input id="documentHistoryQuery" class="document-control" placeholder="搜索标题或正文"><select id="documentHistoryKind" class="document-control"><option value="">全部类型</option><option value="report">报告</option><option value="contract">合同</option></select><select id="documentHistoryStatus" class="document-control"><option value="">全部状态</option><option value="draft">草稿</option><option value="final">定稿</option></select><button class="btn btn-primary" id="documentHistorySearchBtn">查询</button></div><div id="documentHistoryList" class="document-history-list"><div class="document-empty">暂无公文记录</div></div></div>
      <div id="documentVersionsPanel" class="document-profile-panel hidden"><div class="document-profile-card"><div class="document-card-title"><span>版本记录</span><button class="btn btn-text" id="documentVersionsCloseBtn">关闭</button></div><div id="documentVersionsList" class="document-version-list"></div></div></div>
      <div id="documentProfilePanel" class="document-profile-panel hidden"><div class="document-profile-card"><div class="document-card-title"><span>我的写作偏好</span><button class="btn btn-text" id="documentProfileCloseBtn">关闭</button></div><p id="documentProfileSummary" class="document-help">尚未从定稿中学习写作偏好。</p><label class="document-field-label">常用语气</label><select id="documentProfileTone" class="document-control"><option value="正式务实">正式务实</option><option value="简洁明确">简洁明确</option><option value="严谨规范">严谨规范</option></select><label class="document-field-label">常用称谓</label><input id="documentProfileSalutation" class="document-control" placeholder="例如：尊敬的各位领导："><label class="document-field-label">常用结尾</label><input id="documentProfileClosing" class="document-control" placeholder="例如：特此报告。"><div class="document-profile-actions"><button class="btn btn-outline" id="documentProfileResetBtn">重置偏好</button><button class="btn btn-primary" id="documentProfileSaveBtn">保存偏好</button></div></div></div>
    </section>`;
  }

  function showMessage(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else if (type === 'error') window.alert(message);
  }

  async function callApi(name, ...args) {
    if (typeof api[name] !== 'function') throw new Error('当前版本缺少公文拟写接口');
    const response = await api[name](...args);
    if (response?.ok === false) throw new Error(response.error || '操作失败');
    return response?.ok === true && Object.hasOwn(response, 'data') ? response.data : response;
  }

  function referenceKey(reference) {
    return reference.type === 'document'
      ? `document:${reference.documentId}:${reference.versionId}`
      : `business:${reference.collection}:${reference.recordIds?.join(',')}`;
  }

  function updateReferenceCount() {
    const count = state.selectedReferences.size;
    document.getElementById('documentReferenceCount').textContent = count ? `已确认引用 ${count} 项资料` : '未引用历史资料';
  }

  function updateKindUi(kind = state.preferredKind) {
    state.preferredKind = kind;
    document.querySelectorAll('[data-document-kind]').forEach((button) => button.classList.toggle('active', button.dataset.documentKind === kind));
    const effectiveKind = state.current?.document?.documentKind || (kind === 'auto' ? null : kind);
    document.getElementById('documentContractWarning')?.classList.toggle('hidden', effectiveKind !== 'contract');
  }

  function updateDraftStatus() {
    const documentValue = state.current?.document;
    const badge = document.getElementById('documentDraftStatus');
    const isFinal = documentValue?.status === 'final';
    badge.textContent = !documentValue ? '新公文' : `${documentValue.documentKind === 'contract' ? '合同' : '报告'} · ${isFinal ? '已定稿' : '草稿'}`;
    document.getElementById('documentEditor').contentEditable = isFinal ? 'false' : 'true';
    document.getElementById('documentFinalizeBtn').textContent = isFinal ? '取消定稿后编辑' : '标记定稿';
    document.getElementById('documentConversationSendBtn').disabled = Boolean(isFinal);
    document.getElementById('documentSaveVersionBtn').disabled = Boolean(isFinal);
    document.querySelectorAll('#documentFormatPanel input, #documentFormatPanel select, #documentFormatPanel button, .document-format-toolbar select, .document-format-toolbar button').forEach((control) => { control.disabled = Boolean(isFinal); });
    document.getElementById('documentConversationLabel').textContent = documentValue?.workingContentText ? '补充修改要求' : '描述需要拟写的内容';
    document.getElementById('documentConversationInput').placeholder = documentValue?.workingContentText
      ? '例如：语气更正式，增加分期付款依据，并结合右侧当前正文重新生成全文……'
      : '例如：写一份申请拨付小杨庄过渡房费用的请示。东七组占地40余亩，每亩900元，合计36000元，请求按期拨付。';
    document.getElementById('documentConversationSendBtn').textContent = documentValue?.workingContentText ? '↻ 根据补充重新生成' : '✦ 开始 AI 拟写';
    updateKindUi(state.preferredKind);
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) button.dataset.originalText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : (button.dataset.originalText || button.textContent);
  }

  function showSourceSummary(result) {
    const container = document.getElementById('documentSourceSummary');
    const references = result.references || [];
    container.classList.toggle('hidden', references.length === 0 && !(result.omitted || []).length);
    container.innerHTML = `<b>本稿参考来源</b>${references.length ? `<ul>${references.map((reference) => `<li>${escapeHtml(reference.sourceTitle)}</li>`).join('')}</ul>` : '<p>本稿未引用历史或业务资料。</p>'}${(result.omitted || []).length ? `<p class="document-warning-text">因上下文长度限制，未使用：${result.omitted.map((item) => escapeHtml(item.sourceTitle)).join('、')}</p>` : ''}`;
  }

  async function submitConversation(messageOverride = null) {
    const input = document.getElementById('documentConversationInput');
    const message = messageOverride === null ? input.value.trim() : messageOverride;
    if (!message) throw new Error(state.current?.document?.workingContentText ? '请先填写补充修改要求' : '请先描述需要拟写的内容');
    const button = document.getElementById('documentConversationSendBtn');
    setBusy(button, true, 'AI 正在处理…');
    document.getElementById('documentAutosaveStatus').textContent = state.current?.document?.workingContentText ? '正在根据补充要求重新生成…' : 'AI 正在拟写完整公文…';
    try {
      if (state.current?.document) {
        clearTimeout(state.autosaveTimer);
        state.current.document = await callApi('saveDraftDocument', {
          documentId: state.current.document.id,
          title: currentTitle(),
          visibility: document.getElementById('documentVisibility').value,
          contentHtml: document.getElementById('documentEditor').innerHTML,
          contentText: document.getElementById('documentEditor').innerText,
          layout: currentLayout(),
        });
      }
      const result = await callApi('converseDraftDocument', {
        documentId: state.current?.document?.id || null,
        message,
        preferredKind: state.preferredKind,
        confirmedReferences: [...state.selectedReferences.values()],
        layout: currentLayout(),
      });
      const versions = state.current?.versions || [];
      state.current = {
        document: result.document,
        versions: result.version ? [result.version, ...versions] : versions,
        references: state.current?.references || [],
      };
      if (result.version) {
        input.value = '';
        state.savedSelectionRange = null;
        document.getElementById('documentEditor').innerHTML = result.version.contentHtml;
        applyLayoutToUi(result.document.layout || result.version.layoutSnapshot || state.layout);
        document.getElementById('documentAutosaveStatus').textContent = `AI 已生成 · 版本 ${result.version.versionNumber}`;
        showSourceSummary(result);
        showMessage(versions.length ? '已根据补充要求重新生成全文，上一版本已保留' : '公文已生成，右侧正文可以直接修改');
      } else {
        throw new Error('AI 未返回有效正文，请重试');
      }
      updateDraftStatus();
      if (result.document?.visibility !== document.getElementById('documentVisibility').value) {
        state.current.document = await callApi('saveDraftDocument', { documentId: result.document.id, visibility: document.getElementById('documentVisibility').value });
      }
    } catch (error) {
      document.getElementById('documentAutosaveStatus').textContent = state.current?.document?.workingContentText ? '现有正文已保留，可重试' : '生成失败，输入内容仍保留';
      showMessage(error.message, 'error');
    } finally {
      setBusy(button, false);
      updateDraftStatus();
    }
  }

  async function refreshRecommendations() {
    if (!state.current?.document?.id) throw new Error('请先描述事项，再查找相关历史公文');
    const query = document.getElementById('documentHistoryReferenceQuery').value.trim();
    const items = await callApi('recommendDraftReferences', { documentId: state.current.document.id, query: { title: query, keyPoints: query } });
    const container = document.getElementById('documentRecommendedReferences');
    container.innerHTML = items.length ? items.slice(0, 6).map((item) => `<label class="document-reference-item"><input type="checkbox" data-reference-document-id="${escapeHtml(item.documentId)}" data-reference-version-id="${escapeHtml(item.versionId)}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml((item.reasons || []).join(' · ') || '相关历史')}</small></span></label>`).join('') : '<div class="document-empty-small">没有找到相关历史公文</div>';
  }

  async function loadBusinessSources() {
    const collection = document.getElementById('documentBusinessCollection').value;
    const records = await callApi('listDraftBusinessSources', { collection });
    const container = document.getElementById('documentBusinessReferences');
    container.innerHTML = records.length ? records.map((record) => `<label class="document-reference-item"><input type="checkbox" data-business-id="${escapeHtml(record.id)}"><span><b>${escapeHtml(record.title)}</b><small>${escapeHtml(record.summary)}</small></span></label>`).join('') : '<div class="document-empty-small">该分类暂无可选数据</div>';
  }

  async function saveEditorDraft() {
    if (!state.current?.document) return;
    document.getElementById('documentAutosaveStatus').textContent = '保存中…';
    try {
      state.current.document = await callApi('saveDraftDocument', {
        documentId: state.current.document.id,
        title: currentTitle(),
        visibility: document.getElementById('documentVisibility').value,
        contentHtml: document.getElementById('documentEditor').innerHTML,
        contentText: document.getElementById('documentEditor').innerText,
        layout: currentLayout(),
      });
      document.getElementById('documentAutosaveStatus').textContent = '已自动保存';
    } catch (error) {
      document.getElementById('documentAutosaveStatus').textContent = '自动保存失败，请复制正文';
      showMessage(error.message, 'error');
    }
  }

  function queueAutosave() {
    if (!state.current?.document) return;
    document.getElementById('documentAutosaveStatus').textContent = '有未保存修改';
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveEditorDraft, 900);
  }

  async function saveVersion() {
    if (!state.current?.document) throw new Error('请先生成公文');
    await saveEditorDraft();
    const version = await callApi('saveDraftVersion', { documentId: state.current.document.id, contentHtml: document.getElementById('documentEditor').innerHTML, contentText: document.getElementById('documentEditor').innerText, layout: currentLayout(), changeOrigin: 'human', changeSummary: '人工保存版本' });
    state.current.document.currentVersionId = version.id;
    state.current.versions = [version, ...(state.current.versions || [])];
    document.getElementById('documentAutosaveStatus').textContent = `已保存版本 ${version.versionNumber}`;
    showMessage('新版本已保存');
  }

  async function toggleFinalStatus() {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status === 'final') {
      if (!window.confirm('取消定稿后才能继续编辑，确认继续吗？')) return;
      state.current.document = await callApi('reopenDraftDocument', state.current.document.id);
      updateDraftStatus();
      return;
    }
    if (!window.confirm('确认已经人工核验内容并标记定稿吗？')) return;
    await saveVersion();
    state.current.document = await callApi('finalizeDraftDocument', state.current.document.id);
    updateDraftStatus();
    showMessage('文稿已定稿，并更新写作偏好');
  }

  async function copyCurrent() {
    const text = document.getElementById('documentEditor').innerText.trim();
    if (!text) throw new Error('当前没有可复制的正文');
    await navigator.clipboard.writeText(text);
    showMessage('正文已复制');
  }

  async function exportCurrent(format) {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status !== 'final') await saveVersion();
    const result = await callApi('exportDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId, format });
    if (!result.canceled) showMessage(`${format === 'pdf' ? 'PDF' : 'Word'} 已导出`);
  }

  async function printCurrent() {
    if (!state.current?.document) throw new Error('请先生成公文');
    if (state.current.document.status !== 'final') await saveVersion();
    const result = await callApi('printDraftDocument', { documentId: state.current.document.id, versionId: state.current.document.currentVersionId });
    if (result?.preview) showMessage('已打开真实 A4 打印预览，可在预览窗口中继续打印');
  }

  function showVersions() {
    if (!state.current?.document) throw new Error('当前还没有版本记录');
    const items = state.current.versions || [];
    document.getElementById('documentVersionsList').innerHTML = items.length ? items.map((version) => `<div class="document-version-item"><div><b>版本 ${version.versionNumber}</b><small>${escapeHtml(version.changeSummary || '')} · ${escapeHtml(new Date(version.createdAt).toLocaleString('zh-CN'))}</small></div><button class="btn btn-outline" data-restore-version-id="${escapeHtml(version.id)}">恢复此版本</button></div>`).join('') : '<div class="document-empty-small">暂无版本</div>';
    document.getElementById('documentVersionsPanel').classList.remove('hidden');
  }

  async function restoreVersion(versionId) {
    await callApi('restoreDraftVersion', { documentId: state.current.document.id, versionId });
    document.getElementById('documentVersionsPanel').classList.add('hidden');
    await openDocument(state.current.document.id);
    showMessage('已恢复为一个新的版本');
  }

  function historyCard(item) {
    return `<article class="document-history-card"><div class="document-history-main"><div class="document-history-title"><span class="badge ${item.documentKind === 'contract' ? 'badge-warning' : 'badge-info'}">${item.documentKind === 'contract' ? '合同' : '报告'}</span><b>${escapeHtml(item.title)}</b></div><p>${item.status === 'final' ? '已定稿' : '草稿'} · ${item.visibility === 'private' ? '仅自己' : '社区共享'}</p><small>更新于 ${escapeHtml(new Date(item.updatedAt).toLocaleString('zh-CN'))}</small></div><div class="document-history-actions"><button class="btn btn-outline" data-history-action="open" data-document-id="${escapeHtml(item.id)}">继续编辑</button><button class="btn btn-outline" data-history-action="report" data-document-id="${escapeHtml(item.id)}">基于此文写报告</button><button class="btn btn-outline" data-history-action="contract" data-document-id="${escapeHtml(item.id)}">基于此文写合同</button><button class="btn btn-outline" data-history-action="word" data-document-id="${escapeHtml(item.id)}">Word</button><button class="btn btn-outline" data-history-action="archive" data-document-id="${escapeHtml(item.id)}">归档</button></div></article>`;
  }

  async function loadHistory() {
    const filters = { query: document.getElementById('documentHistoryQuery').value, documentKind: document.getElementById('documentHistoryKind').value, status: document.getElementById('documentHistoryStatus').value };
    const items = await callApi('listDraftDocuments', filters);
    document.getElementById('documentHistoryList').innerHTML = items.length ? items.map(historyCard).join('') : '<div class="document-empty">暂无符合条件的公文记录</div>';
  }

  function switchView(view) {
    state.view = view;
    document.getElementById('documentWorkspaceView').classList.toggle('hidden', view !== 'workspace');
    document.getElementById('documentHistoryView').classList.toggle('hidden', view !== 'history');
    if (view === 'history') return loadHistory();
    scheduleEditorPreviewUpdate();
    return Promise.resolve();
  }

  async function openDocument(documentId) {
    state.current = await callApi('getDraftDocument', documentId);
    state.savedSelectionRange = null;
    state.preferredKind = state.current.document.documentKind;
    state.selectedReferences.clear();
    for (const reference of state.current.document.pendingReferences || []) state.selectedReferences.set(referenceKey(reference), reference);
    const currentVersion = state.current.versions.find((version) => version.id === state.current.document.currentVersionId);
    document.getElementById('documentEditor').innerHTML = state.current.document.workingContentHtml || currentVersion?.contentHtml || '';
    applyLayoutToUi(state.current.document.layout || currentVersion?.layoutSnapshot || DOCUMENT_LAYOUT_PRESETS.report);
    document.getElementById('documentVisibility').value = state.current.document.visibility;
    updateReferenceCount();
    updateDraftStatus();
    document.getElementById('documentAutosaveStatus').textContent = `已打开 · ${state.current.versions.length} 个版本`;
    await switchView('workspace');
  }

  async function handleHistoryAction(event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const { historyAction: action, documentId } = button.dataset;
    if (action === 'open') await openDocument(documentId);
    else if (action === 'report' || action === 'contract') {
      const result = await callApi('createDraftFromHistory', { sourceDocumentId: documentId, targetTemplateId: action === 'report' ? 'report-work' : 'contract-service' });
      await openDocument(result.document.id);
    } else if (action === 'word') {
      const result = await callApi('exportDraftDocument', { documentId, format: 'docx' });
      if (!result.canceled) showMessage('Word 已导出');
    } else if (action === 'archive' && window.confirm('确认归档这份公文吗？')) {
      await callApi('archiveDraftDocument', documentId);
      await loadHistory();
    }
  }

  async function resetDraft() {
    state.current = null;
    state.preferredKind = 'auto';
    state.savedSelectionRange = null;
    state.preview.mode = 'page';
    state.selectedReferences.clear();
    document.getElementById('documentConversationInput').value = '';
    document.getElementById('documentEditor').innerHTML = '';
    document.getElementById('documentSourceSummary').classList.add('hidden');
    document.getElementById('documentRecommendedReferences').innerHTML = '';
    document.getElementById('documentBusinessReferences').innerHTML = '';
    try {
      applyLayoutToUi(await callApi('getDraftLayoutDefaults', { templateId: 'report-request' }));
    } catch {
      applyLayoutToUi(DOCUMENT_LAYOUT_PRESETS.request);
    }
    updateReferenceCount();
    updateDraftStatus();
    document.getElementById('documentAutosaveStatus').textContent = '等待描述';
    await switchView('workspace');
  }

  async function openProfile() {
    const profile = await callApi('getWritingProfile');
    document.getElementById('documentProfileSummary').textContent = profile ? `已根据 ${profile.finalizedCount || 0} 份定稿学习，最后更新：${profile.updatedAt ? new Date(profile.updatedAt).toLocaleString('zh-CN') : '暂无'}` : '尚未从定稿中学习写作偏好。';
    document.getElementById('documentProfileTone').value = profile?.preferredTone || '正式务实';
    document.getElementById('documentProfileSalutation').value = profile?.preferredSalutation || '';
    document.getElementById('documentProfileClosing').value = profile?.preferredClosing || '';
    document.getElementById('documentProfilePanel').classList.remove('hidden');
  }

  async function saveProfile() {
    await callApi('saveWritingProfile', { preferredTone: document.getElementById('documentProfileTone').value, preferredSalutation: document.getElementById('documentProfileSalutation').value, preferredClosing: document.getElementById('documentProfileClosing').value });
    showMessage('写作偏好已保存');
    document.getElementById('documentProfilePanel').classList.add('hidden');
  }

  function bind(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, async (domEvent) => {
      try { await handler(domEvent); } catch (error) { showMessage(error.message, 'error'); }
    });
  }

  function injectPage() {
    if (!document.getElementById('tab-document-drafting')) document.getElementById('tab-certificate')?.insertAdjacentHTML('beforebegin', sectionMarkup());
    const quickRow = document.querySelector('.wb-quick-buttons-row');
    if (quickRow && !document.getElementById('workbenchDocumentDraftingBtn')) {
      const button = document.createElement('button');
      button.className = 'action-card-btn';
      button.id = 'workbenchDocumentDraftingBtn';
      button.innerHTML = '<span class="icon-circle bg-green">文</span><span>公文拟写</span>';
      button.addEventListener('click', () => window.switchTab?.('tab-document-drafting'));
      quickRow.appendChild(button);
    }
  }

  function bindReferenceLists() {
    document.getElementById('documentRecommendedReferences').addEventListener('change', (event) => {
      const input = event.target.closest('[data-reference-document-id]');
      if (!input) return;
      const reference = { type: 'document', documentId: input.dataset.referenceDocumentId, versionId: input.dataset.referenceVersionId, selectedBy: 'user' };
      if (input.checked) state.selectedReferences.set(referenceKey(reference), reference);
      else state.selectedReferences.delete(referenceKey(reference));
      updateReferenceCount();
    });
    document.getElementById('documentBusinessReferences').addEventListener('change', (event) => {
      const input = event.target.closest('[data-business-id]');
      if (!input) return;
      const collection = document.getElementById('documentBusinessCollection').value;
      const reference = { type: 'business', collection, recordIds: [input.dataset.businessId], title: BUSINESS_LABELS[collection], selectedBy: 'user' };
      if (input.checked) state.selectedReferences.set(referenceKey(reference), reference);
      else state.selectedReferences.delete(referenceKey(reference));
      updateReferenceCount();
    });
  }

  async function initialize() {
    injectPage();
    if (!document.getElementById('tab-document-drafting')) return;
    bind('documentConversationSendBtn', 'click', () => submitConversation());
    bind('documentNewDraftBtn', 'click', resetDraft);
    bind('documentHistoryBtn', 'click', () => switchView('history'));
    bind('documentBackToWorkspaceBtn', 'click', () => switchView('workspace'));
    bind('documentRefreshRecommendationsBtn', 'click', refreshRecommendations);
    bind('documentLoadBusinessBtn', 'click', loadBusinessSources);
    bind('documentSaveVersionBtn', 'click', saveVersion);
    bind('documentVersionsBtn', 'click', showVersions);
    bind('documentVersionsCloseBtn', 'click', () => document.getElementById('documentVersionsPanel').classList.add('hidden'));
    bind('documentFinalizeBtn', 'click', toggleFinalStatus);
    bind('documentCopyBtn', 'click', copyCurrent);
    bind('documentPrintBtn', 'click', printCurrent);
    bind('documentExportWordBtn', 'click', () => exportCurrent('docx'));
    bind('documentExportPdfBtn', 'click', () => exportCurrent('pdf'));
    bind('documentHistorySearchBtn', 'click', loadHistory);
    bind('documentProfileBtn', 'click', openProfile);
    bind('documentProfileCloseBtn', 'click', () => document.getElementById('documentProfilePanel').classList.add('hidden'));
    bind('documentProfileSaveBtn', 'click', saveProfile);
    bind('documentProfileResetBtn', 'click', async () => { if (window.confirm('重置写作偏好不会删除历史公文，确认继续吗？')) { await callApi('resetWritingProfile'); await openProfile(); } });
    document.querySelectorAll('[data-document-kind]').forEach((button) => button.addEventListener('click', () => updateKindUi(button.dataset.documentKind)));
    document.getElementById('documentConversationInput').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitConversation().catch((error) => showMessage(error.message, 'error')); });
    document.getElementById('documentDirectIntro').addEventListener('click', (event) => {
      const example = event.target.closest('[data-example]');
      if (example) document.getElementById('documentConversationInput').value = example.dataset.example;
    });
    document.getElementById('documentHistoryList').addEventListener('click', (event) => handleHistoryAction(event).catch((error) => showMessage(error.message, 'error')));
    document.getElementById('documentVersionsList').addEventListener('click', (event) => { const button = event.target.closest('[data-restore-version-id]'); if (button) restoreVersion(button.dataset.restoreVersionId).catch((error) => showMessage(error.message, 'error')); });
    document.getElementById('documentEditor').addEventListener('input', () => { syncIdentityFieldsFromEditor(); scheduleEditorPreviewUpdate(); queueAutosave(); });
    document.querySelectorAll('[data-editor-command]').forEach((button) => button.addEventListener('click', () => { document.execCommand(button.dataset.editorCommand, false); document.getElementById('documentEditor').focus(); queueAutosave(); }));
    document.querySelectorAll('[data-editor-align]').forEach((button) => button.addEventListener('click', () => applyParagraphAlignment(button.dataset.editorAlign)));
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection?.();
      const editor = document.getElementById('documentEditor');
      if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        state.savedSelectionRange = selection.isCollapsed ? null : selection.getRangeAt(0).cloneRange();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const editor = document.getElementById('documentEditor');
      if (editor.contains(event.target) || event.target.closest?.('#documentInlineFont, #documentInlineSize')) return;
      state.savedSelectionRange = null;
    });
    bind('documentFormatToggle', 'click', () => document.getElementById('documentFormatPanel').classList.toggle('hidden'));
    bind('documentInlineFont', 'change', (event) => applyInlineFormat('data-doc-font', event.target.value));
    bind('documentInlineSize', 'change', (event) => applyInlineFormat('data-doc-size', event.target.value));
    bind('documentPreviewZoomMode', 'change', (event) => setPreviewMode(event.target.value));
    bind('documentPreviewZoomOut', 'click', () => adjustPreviewScale(-0.1));
    bind('documentPreviewZoomIn', 'click', () => adjustPreviewScale(0.1));
    bind('documentLayoutPreset', 'change', (event) => { applyLayoutToUi(layoutPreset(event.target.value, state.layout)); syncIdentityFieldsToEditor(); queueAutosave(); });
    bind('documentRestoreLayoutBtn', 'click', () => { applyLayoutToUi(layoutPreset(document.getElementById('documentLayoutPreset').value, state.layout)); syncIdentityFieldsToEditor(); queueAutosave(); showMessage('已恢复参考样稿版式'); });
    bind('documentAddressee', 'input', (event) => { state.layout.addressee = event.target.value.trim() || DOCUMENT_LAYOUT_PRESETS[state.layout.preset].addressee; syncIdentityFieldsToEditor(); queueAutosave(); });
    bind('documentSignatureUnit', 'input', (event) => { state.layout.signatureUnit = event.target.value.trim() || DOCUMENT_LAYOUT_PRESETS[state.layout.preset].signatureUnit; syncIdentityFieldsToEditor(); queueAutosave(); });
    bind('documentLineSpacing', 'change', (event) => { state.layout.lineSpacing = Number(event.target.value); applyLayoutToUi(state.layout); queueAutosave(); });
    bind('documentMarginPreset', 'change', (event) => {
      if (event.target.value === 'reference') state.layout.margins = cloneLayout(DOCUMENT_LAYOUT_PRESETS[state.layout.preset].margins);
      else if (event.target.value === 'standard') state.layout.margins = { top: 25, right: 25, bottom: 25, left: 25 };
      else if (event.target.value === 'compact') state.layout.margins = { top: 20, right: 20, bottom: 20, left: 20 };
      applyLayoutToUi(state.layout);
      queueAutosave();
    });
    const previewViewport = document.getElementById('documentEditorViewport');
    const editor = document.getElementById('documentEditor');
    if (typeof ResizeObserver === 'function') {
      state.preview.resizeObserver = new ResizeObserver(scheduleEditorPreviewUpdate);
      state.preview.resizeObserver.observe(previewViewport);
      state.preview.resizeObserver.observe(editor);
    } else window.addEventListener('resize', scheduleEditorPreviewUpdate);
    if (typeof MutationObserver === 'function') {
      state.preview.mutationObserver = new MutationObserver(scheduleEditorPreviewUpdate);
      state.preview.mutationObserver.observe(editor, { childList: true, subtree: true, characterData: true });
    }
    bindReferenceLists();
    await resetDraft();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}());
