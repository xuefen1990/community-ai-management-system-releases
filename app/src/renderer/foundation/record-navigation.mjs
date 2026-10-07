const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function waitFor(selector) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const element = document.querySelector(selector);
    if (element) return element;
    await pause();
  }
  throw new Error('页面已打开，但对应记录入口尚未加载，请重试');
}
async function search(selector, query) {
  const element = await waitFor(selector);
  const input = element.matches('input,textarea') ? element : element.querySelector('input,textarea');
  if (!input) throw new Error('未找到记录筛选入口');
  input.value = String(query);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function selectDutyDate(value) {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('值班记录日期不正确');
  const title = await waitFor('[data-testid="text-current-month"]');
  const target = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  const current = title.textContent.match(/(\d+)年(\d+)月/);
  if (!current) throw new Error('无法识别当前值班月份');
  const offset = target - (Number(current[1]) * 12 + Number(current[2]));
  if (Math.abs(offset) > 1200) throw new Error('该记录日期超出可定位范围');
  const button = await waitFor(`[data-testid="btn-${offset < 0 ? 'prev' : 'next'}-month"]`);
  for (let index = 0; index < Math.abs(offset); index++) button.click();
  // Vue batches these month changes into one render and one settled data view.
  await pause();
  (await waitFor(`[data-testid="day-cell-${date}"]`)).click();
}
function call(module, method, argument) {
  if (typeof module?.[method] !== 'function') throw new Error('对应业务记录入口未加载，请重试');
  return module[method](argument);
}
export async function navigateToRecord(action) {
  const source = action.recordSource;
  if (action.evidenceSource) return call(window.ContractFeeWorkspace, 'openEvidenceSource', action.evidenceSource);
  if (source?.kind === 'work') return call(window.WorkManagement, 'openWork', source.id);
  if (source?.kind === 'document') return call(window.DocumentDrafting, 'openDocument', source.id);
  if (source?.kind === 'duty') return selectDutyDate(source.date);
  if (source?.kind === 'certificate') {
    if (typeof window.CertificateManagementUI?.openRecords === 'function') {
      return window.CertificateManagementUI.openRecords(source.query || action.filters?.query || '');
    }
    (await waitFor('[data-testid="btn-open-cert-history"]')).click();
    return search('[data-testid="input-search-history"]', source.query || action.filters?.query || '');
  }
  if (source) return call(window.ContractFeeWorkspace, 'openRecordSource', source);
  if (action.filters?.query == null) return;
  const selector = {
    'tab-personnel': 'input[placeholder^="搜索姓名/身份证/户号/手机"]',
    'tab-party': '[data-testid="search-party-input"]',
    'tab-finance': '[data-testid="search-finance-input"]',
    'tab-visit-records': '[data-testid="search-visit-input"]',
    'tab-land': '[data-testid="search-land-input"]',
  }[action.target];
  if (!selector) throw new Error('页面已打开，但尚不能自动定位该类记录');
  await search(selector, action.filters.query);
}
