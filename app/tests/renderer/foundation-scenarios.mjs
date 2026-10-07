// This fixture only talks to the synthetic in-memory service launched by the
// test runner. It never imports a production preload or opens a user database.
const errors = [];
const failedRequests = [];
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason)));
const syntheticAuth = { state: 'licensed', phone: '测试账户', phoneMasked: '测试账户', message: '', trialRemainingMs: 0 };
const authScenario = new URLSearchParams(location.search).has('auth');
const childScenario = new URLSearchParams(location.search).has('child');
const lanActions = [];
let signedIn = !authScenario;
let submittedApplication = null;
let testAiSettings = { mode: 'online', localModelPath: '', online: { baseUrl: 'https://synthetic.invalid/v1', model: 'synthetic', hasApiKey: false } };
let testBackups = [];
let importGrid = null;
const importSnapshots = new Map();
const sampleOperations=[{id:'op-phone',type:'resident_phone_update',module:'居民一户一档',object:{name:'合成居民'},before:{phone:'10000000000'},after:{phone:'10000000001'},status:'completed',recoverable:true,operator:{name:'测试管理员'},createdAt:'2026-09-09T00:00:00Z'},{id:'op-failed',type:'work_item_create',module:'工作管理',object:{name:'测试事项'},before:{},after:{record:{name:'测试事项',internalId:'hidden'}},status:'failed',recoverable:false}];
window.api = {
  platform: 'darwin',
  bootstrapProductAuth: async () => signedIn ? syntheticAuth : { state: 'login-required', message: '请登录社区账号' },
  loginProductAuth: async value => { if (value.phone !== '10000000000' || value.password !== 'synthetic-test-only') throw new Error('测试账号不匹配'); signedIn = true; return syntheticAuth; },
  getLoginPrefill: async () => ({ phone: '10000000000', password: '', remembered: false }),
  submitUnitAdminApplication: async value => { submittedApplication = value; return { ok: true }; },
  refreshProductAuth: async () => syntheticAuth,
  businessRequest: async input => {
    if (childScenario) {
      failedRequests.push({ path: input.path, error: { message: '尚未连接局域网主电脑' } });
      return { ok: false, error: { message: '尚未连接局域网主电脑' } };
    }
    const response = await fetch('/fixture-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!result.ok) failedRequests.push({ path: input.path, error: result.error });
    return result;
  },
  getVersion: async () => '测试基础',
  getLanShareInfo: async () => ({ enabled: false, connection: { status: 'unconfigured', baseUrl: '' } }),
  updateLanShareConfig: async value => { lanActions.push(value); return value.action === 'scan' ? { hosts: [] } : { ok: true }; },
  readDb: async () => (await fetch('/fixture-db')).json(),
  readFoundationWorkspace: async () => ({ database: await window.api.readDb(), token: 'synthetic' }),
  writeFoundationWorkspace: async ({ after }) => { await window.api.writeDb(after); return { ok: true, database: after, token: 'synthetic' }; },
  writeDb: async database => (await fetch('/fixture-db', { method: 'POST', body: JSON.stringify(database) })).json(),
  listAiAssistantOperations: async () => structuredClone(sampleOperations),
  undoAiAssistantOperation: async ({operationId}) => {sampleOperations.find(item=>item.id===operationId).status='undone';return{message:'已撤销该操作'};},
  getAiSettings: async () => structuredClone(testAiSettings),
  scanLocalModels: async () => [],
  getInternalAiServerStatus: async () => ({ running: false }),
  saveAiSettings: async value => { testAiSettings = value; return value; },
  testOnlineAi: async () => ({ content: 'synthetic connection test' }),
  getDbDir: async () => '/synthetic-test-only/data',
  selectExcelFile: async () => ({ filePath: '/synthetic-test-only/import.xlsx', fileName: '合成导入.xlsx' }),
  readFoundationExcelColumns: async () => structuredClone(importGrid),
  createV3ImportSnapshot: async value => { importSnapshots.set(typeof value === 'string' ? value : value.id, await window.api.readDb()); return { success: true }; },
  listV3AutoBackups: async () => ({ backups: testBackups }),
  createV3Backup: async () => { testBackups.push({ relativePath: 'backup-synthetic', createdAt: '2026-09-08T00:00:00Z', sizeBytes: 100, manifest: { files: [], missingFiles: [] } }); return { success: true, filesCount: 0 }; },
  getLocalAuthStatus: async () => ({ authenticated: true, account: childScenario
    ? { name: '合成子账号', phone: '10000000000', role: 'member', permissions: {} }
    : { name: '合成账号', phone: '10000000000', role: 'unit_admin' }, entitlement: { type: 'licensed' } }),
  getAccountPreferences: async () => ({}),
  getRemoteServerConfig: async () => ({ baseUrl: 'http://127.0.0.1:3000' }),
  converseWithAiAssistant: async () => ({ content: '合成数据测试回复', provider: 'system' }),
  printCertificateDocument: async () => ({ ok: true, data: { ok: true, preview: true } }),
  exportCertificateDocument: async () => ({ ok: true, data: { ok: true, path: '/synthetic/certificate.docx' } }),
  selectCertificateWordTemplate: async () => ({ ok: true, data: { ok: false, canceled: true } }),
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function until(check, label) { for (let i = 0; i < 100; i++) {
  const error = document.querySelector('.foundation-extension-error');
  if (error) throw new Error(`${label}：${error.textContent}`);
  if (check()) return; await pause(50);
} throw new Error(`等待超时：${label}`); }
async function untilAsync(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await pause(50); } throw new Error(`等待超时：${label}`); }
function fill(root, selector, value) {
  let input = root.querySelector(selector); if (input && !['INPUT', 'TEXTAREA', 'SELECT'].includes(input.tagName)) input = input.querySelector('input,textarea,select');
  assert(input, `找不到输入字段 ${selector}`); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
}
try {
  const started = performance.now();
  const { foundation } = await import('../../src/renderer/foundation/bootstrap.mjs');
  if (childScenario) {
    await until(() => document.querySelector('[data-testid="community-lan-settings"]'), '子账号主电脑连接页');
    assert(foundation.router.currentRoute.value.path === '/settings', '无主机时应进入系统设置');
    assert(foundation.router.currentRoute.value.query.tab === 'lan', '应显示局域网连接设置');
    assert(document.querySelector('[data-testid="community-lan-ip"]'), '应能手动输入主电脑 IP');
    assert(document.querySelector('[data-testid="community-lan-scan"]'), '应能重新扫描主电脑');
    assert(!document.querySelector('[data-testid="settings-tabs-bar"]'), '连接前不应打开其他设置');
    await until(() => lanActions.some(item => item.action === 'scan'), '首次进入连接页自动扫描');
    assert(failedRequests.length === 0, '连接前不应请求业务数据');
    fill(document, '[data-testid="community-lan-ip"]', '192.168.2.106');
    await until(() => ![...document.querySelectorAll('[data-testid="community-lan-settings"] button')].find(item => item.textContent === '测试连接').disabled, '手动测试连接按钮可用');
    [...document.querySelectorAll('[data-testid="community-lan-settings"] button')].find(item => item.textContent === '测试连接').click();
    await until(() => lanActions.some(item => item.action === 'check' && item.ip === '192.168.2.106'), '手动输入 IP 后测试连接');
    document.body.dataset.testResult = JSON.stringify({ ok: true, child: { connectionPage: true, autoScan: true, manualIp: true, noOtherSettings: true }, failedRequests, errors });
    await new Promise(() => {});
  }
  if (authScenario) {
    await until(() => document.querySelector('[data-testid="community-auth-submit"]'), '社区账号登录页');
    const inputValue = (id, value) => { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    [...document.querySelectorAll('.auth-link')].find(button => button.textContent === '申请开通单位').click();
    await pause(30);
    inputValue('application-name', '合成申请人'); inputValue('login-phone', '10000000000');
    inputValue('login-password', 'synthetic-test-only'); inputValue('application-password-confirm', 'synthetic-test-only');
    inputValue('application-organization', '合成测试单位');
    document.querySelector('[data-testid="community-auth-submit"]').click();
    await until(() => submittedApplication?.organizationName === '合成测试单位', '单位开户申请');
    await until(() => document.querySelector('[role="status"]')?.textContent.includes('申请已提交'), '申请待审核提示');
    assert(!document.querySelector('[data-testid="business-shell"]'), '提交申请不能自动获得登录授权');
    inputValue('login-password', 'synthetic-test-only'); document.querySelector('[data-testid="community-auth-submit"]').click();
    await until(() => document.querySelector('[data-testid="business-shell"]'), '社区账号登录');
    await until(() => foundation.router.currentRoute.value.path === '/overview', '登录后默认进入工作台');
    document.body.dataset.testResult = JSON.stringify({ ok: true, auth: { defaultRoute: foundation.router.currentRoute.value.path }, failedRequests, errors });
    await new Promise(() => {});
  }
  if (new URLSearchParams(location.search).has('drafting')) {
    await foundation.router.push('/drafting');
    await until(() => document.querySelector('#documentConversationInput'), '公文拟写');
    const signatureFields = document.querySelector('#documentSignatureFields');
    const signatureInput = document.querySelector('#documentSignatureUnit');
    const issuedDateInput = document.querySelector('#documentIssuedDate');
    assert(signatureFields && signatureInput && issuedDateInput, '公文拟写应显示可编辑的报告署名和日期');
    assert(signatureInput.value === '', '未设置社区名称时报告署名应为空');
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(issuedDateInput.value), '报告日期应默认带入当天日期');
    document.querySelector('#documentEditor').innerHTML = '<p data-doc-role="signature">旧署名</p><p data-doc-role="date">2026年1月1日</p>';
    fill(document, '#documentSignatureUnit', '合成测试社区居民委员会');
    fill(document, '#documentIssuedDate', '2026-10-08');
    assert(document.querySelector('[data-doc-role="signature"]').textContent === '合成测试社区居民委员会', '修改署名应立即同步 A4 预览');
    assert(document.querySelector('[data-doc-role="date"]').textContent === '2026年10月8日', '修改日期应立即同步为中文日期');
    document.querySelector('#documentKindContract').click();
    assert(signatureFields.classList.contains('hidden'), '合同模式不应显示报告落款');
    document.querySelector('#documentKindReport').click();
    assert(!signatureFields.classList.contains('hidden'), '报告模式应恢复显示报告落款');
    document.body.dataset.testResult = JSON.stringify({ ok: true, drafting: { editableSignature: true, editableDate: true, previewSync: true, contractHidesFooter: true }, failedRequests, errors });
    await new Promise(() => {});
  }
  if (new URLSearchParams(location.search).has('certificate')) {
    await foundation.router.push('/certificate-management');
    await until(() => foundation.router.currentRoute.value.path === '/certificate-workspace', '旧证明地址自动跳转新版');
    await foundation.router.push('/certificate-workspace');
    await until(() => document.querySelector('.cm-shell'), '新版证明管理');
    assert(document.querySelectorAll('.menu-item').length === new Set([...document.querySelectorAll('.menu-item')].map(item => item.textContent.trim())).size, '侧栏不能出现重复菜单');
    assert([...document.querySelectorAll('.cm-tabs button')].map(item => item.textContent.trim()).join('|') === '开具证明|AI 开具|开具记录|模板管理', '证明管理应显示四个清晰入口');
    await until(() => document.querySelector('[data-action="select-template"][data-id="tpl_residency"]'), '证明模板载入');
    document.querySelector('[data-action="select-template"][data-id="tpl_residency"]').click();
    await until(() => document.querySelector('[data-resident-search="person1"]'), '居民联想输入框');
    fill(document, '[data-resident-search="person1"]', '测试居民1');
    await until(() => document.querySelectorAll('[data-action="choose-resident"]').length > 1, '同名候选列表');
    document.querySelector('[data-action="choose-resident"]').click();
    await until(() => document.querySelector('.cm-selected-resident'), '居民资料已带入');
    assert(document.querySelectorAll('.cm-selected-resident').length === 1, '必须由工作人员明确选择一名居民');
    assert(document.querySelector('.cm-a4')?.textContent.includes('测试居民1'), 'A4 预览应显示选择的居民');
    [...document.querySelectorAll('.cm-tabs button')].find(item => item.textContent.trim() === 'AI 开具').click();
    await until(() => document.querySelector('.cm-ai-layout'), 'AI 开具双栏工作台');
    assert(document.querySelector('[data-ai-input]'), 'AI 开具应提供连续对话输入框');
    assert(document.querySelector('[data-ai-content]'), 'AI 开具应提供可人工编辑的正文');
    for (const action of ['ai-send', 'ai-issue-single', 'ai-save-template-issue']) {
      const button = document.querySelector(`[data-action="${action}"]`);
      const textRange = document.createRange(); textRange.selectNodeContents(button);
      assert(getComputedStyle(button).whiteSpace === 'nowrap' && textRange.getBoundingClientRect().height < button.getBoundingClientRect().height, `${action} 按钮文字不应换行`);
    }
    const actionBar = document.querySelector('.cm-ai-actions').getBoundingClientRect();
    const resultPanel = document.querySelector('.cm-ai-result').getBoundingClientRect();
    assert(actionBar.left - resultPanel.left < 30 && resultPanel.right - actionBar.right < 30, 'AI 开具操作栏应使用结果面板的完整宽度');
    document.querySelector('.cm-ai-actions').scrollIntoView({ block: 'center' });
    document.body.dataset.testResult = JSON.stringify({ ok: true, certificate: { tabs: 4, residentCandidates: true, archiveReadonly: true, a4Preview: true, aiWorkspace: true }, failedRequests, errors });
    await new Promise(() => {});
  }
  await foundation.router.push('/personnel');
  await foundation.personnel.load();
  await until(() => document.querySelectorAll('.el-table__body tbody tr').length > 0, '居民列表');
  const tableRows = () => document.querySelectorAll('.el-table__body tbody tr').length;
  const initialRows = tableRows();
  assert(foundation.personnel.people.length === 10000, '应加载全部一万名合成居民');
  assert(initialRows === 15, `当前页应只绘制 15 行，实际 ${initialRows}`);
  if (new URLSearchParams(location.search).has('performance')) {
    await pause(500);
    const scroll = document.querySelector('.el-table__body-wrapper .el-scrollbar__wrap');
    assert(scroll && scroll.scrollHeight > scroll.clientHeight, '需要可滚动的真实表格视口');
    const frames = [], pageTimes = [];
    const observer = new PerformanceObserver(entries => { for (const entry of entries.getEntries()) longTasks.push(Math.round(entry.duration)); });
    const longTasks = []; observer.observe({ type: 'longtask', buffered: false });
    const started = performance.now(); let previous;
    await new Promise(resolve => {
      const frame = timestamp => {
        if (previous !== undefined) frames.push(timestamp - previous); previous = timestamp;
        scroll.scrollTop = (Math.sin(frames.length / 12) + 1) / 2 * (scroll.scrollHeight - scroll.clientHeight);
        if (frames.length >= 120) resolve(); else requestAnimationFrame(frame);
      }; requestAnimationFrame(frame);
    });
    const filtered = foundation.personnel.filtered;
    for (let page = 2; page <= 11; page++) {
      const begin = performance.now(); foundation.personnel.page = page;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      pageTimes.push(performance.now() - begin);
      assert(foundation.personnel.filtered === filtered, '翻页不得重新筛选排序全库');
    }
    observer.disconnect();
    const ordered = [...frames].sort((a, b) => a - b);
    document.body.dataset.testResult = JSON.stringify({ ok: true, loadedPeople: 10000, renderedRows: tableRows(),
      performance: { environment: 'headless Chrome, real clock, synthetic data, not installed Electron', frames: frames.length,
        frameMedianMs: ordered[Math.floor(ordered.length / 2)], frameP95Ms: ordered[Math.floor(ordered.length * .95)],
        framesOver50ms: frames.filter(ms => ms > 50).length, maxFrameMs: Math.max(...frames), longTasksMs: longTasks,
        pagePaintMs: pageTimes, totalMs: performance.now() - started }, failedRequests, errors });
  } else {
  const startupMs = Math.round(performance.now() - started);
  const firstPerson = foundation.personnel.pagination.items[0].id;
  const filteredBefore = foundation.personnel.filtered;
  const pageStarted = performance.now();
  foundation.personnel.page = 2;
  await until(() => foundation.personnel.pagination.items[0].id !== firstPerson, '第二页');
  await pause(100);
  const pageMs = Math.round(performance.now() - pageStarted);
  assert(foundation.personnel.filtered === filteredBefore, '翻页应复用筛选排序缓存');
  assert(tableRows() === 15, '翻页后仍只绘制 15 行');
  const accountButton = document.querySelector('[data-testid^="accounts-person-"]');
  assert(accountButton, '居民行应保留账户资料入口');
  accountButton.click();
  await until(() => document.querySelector('#sec_accounts'), '居民编辑账户栏目');
  assert(!document.querySelector('#resident-subsidy-profile-overlay'), '账户不应再打开独立窗口');
  const recordChecks = [
    ['sec_payments', 'workbench-synthetic-batch', '发放批次'],
    ['sec_operations', 'resident-change-synthetic', '记录编号'],
    ['sec_sources', 'farmland-subsidy-synthetic', '原始记录号'],
  ];
  for (const [sectionId, rawValue, detailLabel] of recordChecks) {
    document.querySelector(`[data-editor-nav="${sectionId}"]`)?.click();
    await until(() => document.querySelector(`#${sectionId} .cf-table`), `${sectionId} 记录表`);
    const section = document.querySelector(`#${sectionId}`);
    assert(section.querySelectorAll('[data-resident-record-pagination]').length <= 1, `${sectionId} 分页不能重复`);
    assert(!section.querySelector('.cf-table')?.innerText.includes(rawValue), `${sectionId} 主表不能直接显示原始编码`);
    const detail = section.querySelector('.resident-record-details');
    assert(detail, `${sectionId} 应提供详情入口`);
    detail.open = true;
    assert(detail.textContent.includes(rawValue), `${sectionId} 详情应保留原始编码`);
    assert(detail.textContent.includes(detailLabel), `${sectionId} 详情应显示字段名称`);
  }
  document.querySelector('[data-testid="person-form-dialog"] .el-dialog__headerbtn').click();
  await until(() => !document.querySelector('[data-testid="person-form-dialog"]'), '关闭居民编辑');
  await foundation.router.push('/funds');
  await until(() => document.querySelector('#tab-contract-fees [data-cf-action="choose-disbursement-type"]'), '资金发放中心');
  await foundation.router.push('/work');
  await until(() => document.querySelector('#tab-work-management [data-act="create"]'), '工作事项');
  await foundation.router.push('/personnel');
  await until(() => tableRows() === 15, '返回居民档案');
  await foundation.router.push('/work');
  await until(() => document.querySelector('#tab-work-management [data-act="create"]'), '重新进入工作事项');
  await foundation.router.push('/drafting');
  await until(() => document.querySelector('#documentConversationInput'), '公文拟写');
  const signatureFields = document.querySelector('#documentSignatureFields');
  const signatureInput = document.querySelector('#documentSignatureUnit');
  const issuedDateInput = document.querySelector('#documentIssuedDate');
  assert(signatureFields && signatureInput && issuedDateInput, '公文拟写应显示可编辑的报告署名和日期');
  assert(signatureInput.value === '', '未设置社区名称时报告署名应为空');
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(issuedDateInput.value), '报告日期应默认带入当天日期');
  document.querySelector('#documentKindContract').click();
  assert(signatureFields.classList.contains('hidden'), '合同模式不应显示报告落款');
  document.querySelector('#documentKindReport').click();
  assert(!signatureFields.classList.contains('hidden'), '报告模式应恢复显示报告落款');
  document.querySelector('#documentConversationInput').value = '切页后应保留的草稿需求';
  await until(() => document.querySelector('#aiCopilotToggleBtn'), 'AI 悬浮入口');
  document.querySelector('#aiCopilotToggleBtn').click();
  await until(() => typeof window.sendDesktopAiMessage === 'function', 'AI 助理');
  document.querySelector('#aiDesktopInputText').value = '合成测试查询';
  document.querySelector('#aiDesktopSendBtn').click();
  await until(() => document.querySelector('#aiDesktopChatContainer').textContent.includes('合成数据测试回复'), 'AI 对话回复');
  document.querySelector('#aiCopilotCloseBtn').click();
  await foundation.router.push('/assistant-records');
  await until(() => document.querySelector('[data-ai-assistant-operation-list]'), 'AI 操作记录');
  await foundation.router.push('/drafting');
  assert(document.querySelector('#documentConversationInput').value === '切页后应保留的草稿需求', '切页不能清空未完成的公文需求');
  await foundation.router.push('/personnel');
  await until(() => tableRows() === 15, '完成后返回居民档案');
  const inventory = [];
  const modes = new URLSearchParams(location.search);
  if (modes.has('imports')) {
    importGrid = { headers: ['姓名', '身份证号', '户号', '村民小组'], allRows: [{ '姓名': '合成导入人员', '身份证号': '11010519491231002X', '户号': '999999', '村民小组': '合成组' }], totalRows: 1 };
    document.querySelector('[data-testid="personnel-import-trigger"]').click();
    await until(() => document.querySelector('[data-testid="personnel-import-batch"]'), '人员导入菜单');
    document.querySelector('[data-testid="personnel-import-batch"]').click();
    await until(() => document.querySelector('[data-testid="import-dropzone"]'), '人员表格选择');
    document.querySelector('[data-testid="import-dropzone"]').click();
    await until(() => document.querySelector('[data-testid="confirm-import-btn"]:not([disabled])'), '人员字段映射');
    document.querySelector('[data-testid="confirm-import-btn"]').click();
    await untilAsync(async () => (await window.api.readDb()).personnel.some(person => person.name === '合成导入人员'), '人员实际入库');
    await until(() => document.querySelector('[data-testid="import-done-btn"]:not([disabled])'), '人员导入完成');
    document.querySelector('[data-testid="import-done-btn"]').click();
    const imported = await window.api.readDb(), job = imported.personnelImportRecords.at(-1);
    assert(importSnapshots.get(job.id)?.personnel.length === 10000, '导入批次应关联写入前快照');
    inventory.push({ importedPeople: imported.personnel.length - 10000, importSnapshotBeforeWrites: true });
    await foundation.router.push('/land');
    await until(() => document.querySelector('[data-testid="land-import-menu-trigger"]'), '土地页面');
    importGrid = { headers: ['地块编号', '地块名称', '面积'], allRows: [{ 地块编号: '0001', 地块名称: '合成导入地块', 面积: '2.50' }], totalRows: 1 };
    document.querySelector('[data-testid="land-import-menu-trigger"]').click();
    await until(() => document.querySelector('[data-testid="opt-batch-import-land"]'), '土地导入菜单');
    document.querySelector('[data-testid="opt-batch-import-land"]').click();
    await until(() => document.querySelector('[data-testid="land-import-dropzone"]'), '土地表格选择');
    document.querySelector('[data-testid="land-import-dropzone"]').click();
    await until(() => document.querySelector('[data-testid="btn-confirm-land-excel-import"]:not([disabled])'), '土地字段映射');
    document.querySelector('[data-testid="btn-confirm-land-excel-import"]').click();
    await untilAsync(async () => (await window.api.readDb()).landParcel?.some(parcel => parcel.parcel_code === '0001'), '土地实际入库');
    await untilAsync(async () => (await window.api.readDb()).landImportRecords?.length > 0, '土地导入历史');
    const landDb = await window.api.readDb(), landJob = landDb.landImportRecords.at(-1);
    assert(landDb.landParcel[0].area === 2.5, '导入面积与 Excel 一致');
    assert(!importSnapshots.get(landJob.id)?.landParcel?.length, '土地快照应在写入前');
    inventory.push({ importedLand: landDb.landParcel.length, area: landDb.landParcel[0].area, landSnapshotBeforeWrites: true });
  }
  if (modes.has('navigation')) {
    for (const [label, path] of [['证明管理', '/certificate-workspace'], ['资金发放中心', '/funds'], ['工作事项', '/work'], ['公文拟写', '/drafting'], ['AI 操作记录', '/assistant-records']]) {
      const menu = [...document.querySelectorAll('.menu-item')].find(element => element.textContent.trim() === label);
      assert(menu, `缺少菜单 ${label}`); menu.click();
      await until(() => foundation.router.currentRoute.value.path === path, `实际点击菜单 ${label}`);
      await pause(30);
      assert(document.querySelectorAll('.menu-item.active').length === 1, '侧栏只应有一个选中菜单');
      assert(document.querySelector('.menu-item.active').textContent.trim() === label, `菜单高亮应匹配 ${label}`);
    }
    await window.communityFoundationNavigate({ target: 'tab-personnel', filters: { query: 'SYNTHETIC-0000042' } });
    await until(() => document.querySelector('input[placeholder^="搜索姓名/身份证/户号/手机"]').value === 'SYNTHETIC-0000042', '居民筛选已带入');
    await window.communityFoundationNavigate({ target: 'tab-personnel', filters: { query: '' } });
    await until(() => tableRows() === 15, '同页面重复定位可清除筛选');
    await window.communityFoundationNavigate({ target: 'tab-duty', recordSource: { kind: 'duty', date: '2026-08-15' } });
    await until(() => document.querySelector('[data-testid="day-cell-2026-08-15"]')?.classList.contains('selected'), '值班记录定位月份及日期');
    await window.communityFoundationNavigate({ target: 'tab-certificate', recordSource: { kind: 'certificate', query: '合成查询码' } });
    const search = document.querySelector('[data-testid="input-certificate-record-search"]');
    assert((search.matches('input') ? search : search.querySelector('input')).value === '合成查询码', '证明台账已按记录查询');
    inventory.push({ navigation: 'sidebar clicks, resident filters, duty date and certificate history verified' });
  }
  if (modes.has('settings')) {
    await foundation.router.push('/settings');
    await until(() => document.querySelector('[data-testid="settings-tab-backup"]'), '系统设置');
    document.querySelector('[data-testid="settings-tab-backup"]').click();
    await until(() => document.querySelector('[data-testid="community-backup-create"]:not([disabled])'), '社区备份设置');
    document.querySelector('[data-testid="community-backup-create"]').click();
    await until(() => document.querySelector('.foundation-backup-row'), '备份列表刷新');
    document.querySelector('[data-testid="settings-tab-account"]').click();
    await until(() => document.querySelector('[data-testid="community-update-check"]:not([disabled])'), '账号与更新入口');
    document.querySelector('[data-testid="settings-tab-ai-assistant"]').click();
    await until(() => document.querySelector('[data-testid="community-ai-save"]:not([disabled])'), 'AI 配置');
    const input = document.querySelectorAll('[data-testid="community-ai-settings"] input')[2];
    input.value = 'synthetic-saved-model'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="community-ai-save"]').click();
    await until(() => testAiSettings.online.model === 'synthetic-saved-model', 'AI 设置实际保存');
    inventory.push({ settings: 'backup/account/AI native panels verified' });
  }
  if (modes.has('menu')) {
    await foundation.router.push('/settings');
    await until(() => document.querySelector('[data-testid="settings-tab-menu"]'), '菜单设置入口');
    document.querySelector('[data-testid="settings-tab-menu"]').click();
    await until(() => document.querySelector('[data-testid="menu-settings-panel"]'), '菜单设置面板');
    const sidebar = () => [...document.querySelectorAll('.menu-item')].map(item => item.textContent.trim());
    const cards = [...document.querySelectorAll('[data-testid^="menu-config-"]')];
    assert(cards.length === foundation.shell.allMenus.length, '设置页必须列出左侧菜单的全部模块');
    assert(document.querySelector('[data-testid="menu-config-work-management"]'), '设置页应包含扩展菜单');
    fill(document, '[aria-label="工作事项的左侧名称"]', '合成待办');
    fill(document, '[aria-label="工作事项的排序号"]', '1');
    document.querySelector('[data-testid="save-menu-settings"]').click();
    await until(() => sidebar()[0] === '合成待办', '保存后左侧菜单立即更新顺序和名称');
    const saved = JSON.parse(localStorage.getItem('cwt_menu_visibility_config'));
    assert(saved['work-management'].order === 1, '排序号应持久保存');
    document.querySelector('[data-testid="reset-menu-settings"]').click();
    await until(() => sidebar()[0] === '工作台', '恢复默认菜单顺序');
    inventory.push({ menu: 'all modules, alias, order and reset verified' });
  }
  if (modes.has('interaction')) {
    assert(![...document.querySelectorAll('.menu-item')].some(item=>item.textContent.trim()==='AI 助理'), '不再保留 AI 独立菜单');
    const db=await window.api.readDb(),person=db.personnel.find(p=>p.id==='synthetic-0');
    const cardBase='11010119900101001',weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
    person.idCard=cardBase+'10X98765432'[[...cardBase].reduce((sum,n,i)=>sum+Number(n)*weights[i],0)%11];
    person.bankAccounts=[];person.disbursementHistory=[{id:'paid',amountCents:12300,categoryName:'合成费用',batchDate:'2026-09-01'}];
    db.residentCustomFields=[{id:'contact',name:'紧急联系人',type:'text'}];await window.api.writeDb(db);
    await foundation.personnel.load({force:true});foundation.personnel.page=1;await pause(200);
    document.querySelector('[data-testid="accounts-person-synthetic-0"]').click();await until(()=>document.querySelector('#sec_accounts input'),'账户编辑载入');
    const form=document.querySelector('[data-testid="person-form-dialog"]');
    fill(form,'input#p_phone','10000000001');fill(form,'[data-resident-new-card]','6222021234567890');fill(form,'[data-resident-new-bank]','合成银行');
    fill(form,'[data-resident-custom-field="contact"]','测试联系人');
    document.querySelector('[data-editor-nav="sec_payments"]').click();await pause(350);
    assert(form.querySelector('[data-resident-new-card]').value==='6222021234567890','切换栏目保留卡号草稿');
    assert((await window.api.readDb()).personnel[0].bankAccounts.length===0,'确认保存前不得写入账户');
    form.querySelector('#saveModalBtn').click();
    await untilAsync(async()=>{const saved=(await window.api.readDb()).personnel.find(p=>p.id==='synthetic-0');return saved.phone==='10000000001'&&saved.bankAccounts?.length===1;},'基础与账户统一保存');
    const saved=(await window.api.readDb()).personnel.find(p=>p.id==='synthetic-0');assert(saved.customFields.contact==='测试联系人','扩展资料统一保存');assert(saved.disbursementHistory[0].amountCents===12300,'保留发放历史');
    await until(()=>!document.querySelector('[data-testid="person-form-dialog"]'),'统一保存后关闭');
    document.querySelector('[data-testid="edit-person-synthetic-0"]').click();await until(()=>document.querySelector('#sec_accounts'),'重新打开编辑');
    fill(document,'input#p_phone','10000000002');document.querySelector('.person-form-el-dialog .el-dialog__headerbtn').click();
    await until(()=>document.querySelector('.app-el-confirm-dialog'),'关闭未保存提醒');
    [...document.querySelectorAll('.app-el-confirm-dialog button')].find(button=>/取消/.test(button.textContent)).click();await pause(150);
    assert(document.querySelector('input#p_phone').value==='10000000002','取消关闭保留输入');
    document.querySelector('.person-form-el-dialog .el-dialog__headerbtn').click();await until(()=>document.querySelector('.app-el-confirm-dialog'),'确认放弃');
    [...document.querySelectorAll('.app-el-confirm-dialog button')].find(button=>/确定|确认/.test(button.textContent)).click();await until(()=>!document.querySelector('[data-testid="person-form-dialog"]'),'放弃修改关闭');
    assert((await window.api.readDb()).personnel.find(p=>p.id==='synthetic-0').phone==='10000000001','放弃修改不写入数据库');
    await foundation.router.push('/assistant-records');await until(()=>document.querySelector('.ai-operation-row'),'中文 AI 记录');
    const record=document.querySelector('.ai-operation-row');record.querySelector('.ai-operation-details').click();
    assert(record.textContent.includes('联系电话')&&record.textContent.includes('修改前')&&record.textContent.includes('测试管理员'),'显示中文对照与操作人');
    assert(!document.querySelector('[data-ai-assistant-operation-list]').textContent.includes('resident_phone_update'),'不显示内部操作代码');
    record.querySelector('.ai-operation-undo').click();await until(()=>document.querySelector('.app-el-confirm-dialog'),'撤销影响确认');
    assert(document.querySelector('.app-el-confirm-dialog').textContent.includes('10000000001 → 10000000000'),'撤销先展示恢复影响');
    [...document.querySelectorAll('.app-el-confirm-dialog button')].find(button=>/确定|确认/.test(button.textContent)).click();
    await until(()=>document.querySelector('.ai-operation-row').textContent.includes('已撤销'),'撤销后状态更新');
    assert(!document.querySelector('.ai-operation-row .ai-operation-undo'),'已撤销记录不能重复撤销');
    await foundation.router.push('/personnel');await pause(200);
    inventory.push({unifiedEditorSave:true,discardProtected:true,paymentsPreserved:true,readableOperations:true,undoConfirmed:true});
  }
  if (modes.has('forms')) {
    for (const [path, buttonId] of [['/finance', 'btn-add-finance'], ['/visits', 'btn-add-visit'], ['/land', 'btn-add-land'], ['/party', 'btn-header-add-external'], ['/certificate', 'btn-open-create-template']]) {
      await foundation.router.push(path); await until(() => document.querySelector(`[data-testid="${buttonId}"]`), path);
      document.querySelector(`[data-testid="${buttonId}"]`).click(); await pause(300);
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.getBoundingClientRect().height > 0 && element.getAttribute('aria-hidden') !== 'true');
      inventory.push({ path, text: dialog?.innerText, fields: [...(dialog?.querySelectorAll('input,textarea,select,button') || [])].map(element => ({ tag: element.tagName, id: element.dataset.testid || element.id, placeholder: element.placeholder, text: element.tagName === 'BUTTON' ? element.textContent.trim() : '', type: element.type })) });
      let collection;
      if (path === '/finance') {
        fill(dialog, 'input[placeholder="例如: 1200.00"]', '123.45'); fill(dialog, 'input[placeholder="例如：村委会办公用品采购、上级拨入专项资金"]', '合成表单收入');
        dialog.querySelector('[data-testid="btn-submit-finance-dialog"]').click(); collection = 'finances';
      } else if (path === '/visits') {
        fill(dialog, 'input[placeholder="输入姓名或手机号联想，也可手填"]', '合成来访人');
        fill(dialog, 'textarea[placeholder="详细记录群众反映的问题、诉求或咨询内容"]', '合成来访事项');
        dialog.querySelector('[data-testid="btn-submit-visit-dialog"]').click(); collection = 'visitRecords';
      } else if (path === '/land') {
        fill(dialog, '[data-testid="input-parcel-code"]', 'SYNTHETIC-LAND'); fill(dialog, '[data-testid="input-parcel-name"]', '合成地块');
        fill(dialog, '[data-testid="input-parcel-area"]', '2.50'); fill(dialog, '[data-testid="input-search-contractor"]', '合成合作社');
        await pause(30); dialog.querySelector('[data-testid="btn-add-contractor-entity"]').click(); await pause(30);
        dialog.querySelector('[data-testid="btn-submit-land-form"]').click(); collection = 'landParcel';
      } else if (path === '/party') {
        fill(dialog, 'input[placeholder="输入党员姓名"]', '合成流动党员');
        [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === '保存党员信息').click(); collection = 'partyMembers';
      } else if (path === '/certificate') {
        fill(dialog, '[data-testid="input-tpl-name"]', '合成证明模板'); fill(dialog, '[data-testid="input-tpl-title"]', '合成证明');
        fill(dialog, '[data-testid="input-tpl-content"]', '兹证明 {村民姓名}，仅用于合成测试。');
        dialog.querySelector('[data-testid="btn-save-template"]').click(); collection = 'certificateTemplates';
      }
      await untilAsync(async () => (await window.api.readDb())[collection]?.length > 0, `${path} 表单写入数据库`);
      await until(() => ![...document.querySelectorAll('[role="dialog"]')].some(element => element.getBoundingClientRect().height > 0 && element.getAttribute('aria-hidden') !== 'true'), `${path} 保存后关闭弹窗`);
      inventory.at(-1).savedCollection = collection;
      await foundation.router.push('/personnel'); await foundation.router.push(path); await pause(200);
    }
  }
  if (new URLSearchParams(location.search).has('inventory')) {
    for (const path of ['/overview', '/statistics', '/party', '/visits', '/village-duty', '/finance', '/land', '/certificate', '/documents', '/settings']) {
      await foundation.router.push(path); await pause(500);
      inventory.push({ path, text: document.querySelector('.app-main')?.innerText.slice(0, 250), controls: [...document.querySelectorAll('.app-main [data-testid]')].filter(element => ['BUTTON', 'INPUT'].includes(element.tagName)).map(element => ({ id: element.dataset.testid, text: element.textContent?.trim() || element.placeholder })).slice(0, 35) });
    }
    await foundation.router.push('/personnel'); await pause(100);
  }
  document.body.dataset.testResult = JSON.stringify({ ok: true, loadedPeople: 10000, renderedRows: initialRows,
    cachedResultsReused: true, extensionRoutes: ['resident-account', 'funds', 'work', 'drafting', 'assistant', 'assistant-records'],
    preservesUnfinishedForm: true, virtualTimeMetrics: { startupMs, pageMs }, inventory, failedRequests, errors });
  assert(errors.length === 0, `页面异常：${errors.join('; ')}`);
  assert(failedRequests.length === 0, `业务接口失败：${JSON.stringify(failedRequests)}`);
  }
} catch (error) { document.body.dataset.testResult = JSON.stringify({ ok: false, error: error.message, errors }); }
