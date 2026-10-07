// Invoked only by disposable Chrome/Electron fixtures with synthetic data.
import { foundation } from '../../src/renderer/foundation/bootstrap.mjs';

const menus = [
  ['工作台', '/overview'], ['数据统计', '/statistics'], ['居民档案', '/personnel'],
  ['党员管理', '/party'], ['民情记录', '/visits'], ['公文拟写', '/drafting'],
  ['证明管理', '/certificate-workspace'], ['电子档案柜', '/documents'], ['资金发放中心', '/funds'],
  ['财务收支', '/finance'], ['土地承包确权', '/land'], ['村务值班', '/village-duty'],
  ['工作事项', '/work'], ['AI 操作记录', '/assistant-records'], ['系统设置', '/settings'],
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const visible = element => {
  if (!element?.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (y < bounds.top || y > bounds.bottom)) return false;
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (x < bounds.left || x > bounds.right)) return false;
  }
  return true;
};

export async function openGreenSkinRoute(route) {
  const label = menus.find(item => item[1] === route)?.[0];
  const button = [...document.querySelectorAll('.sidebar-menu .menu-item')].find(item => item.textContent.trim() === label);
  assert(button, `菜单缺失：${label}`);
  button.click();
  for (let i = 0; i < 120; i++) {
    if (foundation.router.currentRoute.value.path === route && document.querySelector('.app-main')?.innerText.trim()
      && !document.querySelector('.foundation-extension-error')) {
      await pause(160);
      if (!document.querySelector('.tab-loading-overlay') && !document.querySelector('.foundation-extension-error')) return;
    }
    await pause(50);
  }
  throw new Error(`页面未就绪：${route}`);
}

export async function checkGreenSkinLayout(width, height) {
  const sidebar = document.querySelector('.app-sidebar');
  const main = document.querySelector('.app-main');
  assert(document.body.classList.contains('community-green-skin'), '覆盖皮肤未加载');
  assert(getComputedStyle(sidebar).backgroundColor === 'rgb(255, 255, 255)', '侧栏应为白色');
  assert(document.querySelectorAll('#community-skin-titlebar').length === 1, '标题栏必须唯一');
  assert(getComputedStyle(document.querySelector('.app-wrapper')).backgroundImage === 'none', '旧背景图在底部露出');
  assert(getComputedStyle(document.querySelector('#community-skin-titlebar')).webkitAppRegion === 'drag', '标题栏不能拖动窗口');
  assert([...document.querySelectorAll('.sidebar-menu .menu-item')].map(item => item.textContent.trim()).join('|') === menus.map(item => item[0]).join('|'), '15 项默认菜单名称或顺序不正确');
  assert([...document.querySelectorAll('[data-skin-group-start]')].map(item => item.dataset.skinGroupStart).join('|') === '常用|居民服务|办公文书|资金土地|值班事项|智能与系统', '侧栏分类缺失或重复');
  const results = [];
  for (const [label, route] of menus) {
    await openGreenSkinRoute(route);
    assert(!document.querySelector('.foundation-extension-error'), `${label} 扩展错误`);
    assert(main.getBoundingClientRect().top >= 34, `${label} 内容与标题栏重叠`);
    assert(document.documentElement.scrollWidth <= width + 1, `${label} 窗口横向溢出`);
    assert(main.scrollWidth <= main.clientWidth + 2, `${label} 主区域横向溢出：${main.scrollWidth}/${main.clientWidth}`);
    const active = document.querySelector('.sidebar-menu .menu-item.active');
    assert(active?.textContent.trim() === label, `${label} 选中项错误`);
    for (const button of document.querySelectorAll('.sidebar-menu .menu-item')) {
      const text = button.querySelector('.menu-item-label');
      assert(!text || text.scrollWidth <= text.clientWidth + 1, `${label} 菜单文字截断`);
    }
    const control = [...main.querySelectorAll('button')].find(button => visible(button) && !button.disabled
      && button.getBoundingClientRect().top >= main.getBoundingClientRect().top
      && button.getBoundingClientRect().bottom < height - 76);
    if (control) {
      const rect = control.getBoundingClientRect();
      const point = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      assert(point && (point === control || control.contains(point)), `${label} 按钮被覆盖：${control.textContent.trim()}`);
    }
    const launcher = document.querySelector('#aiCopilotToggleBtn');
    const rect = launcher.getBoundingClientRect();
    assert(rect.width > 0 && rect.height >= 32 && rect.height <= 42, 'AI 浮钮尺寸不正确');
    assert(rect.right <= width && rect.bottom <= height, 'AI 浮钮超出窗口');
    assert(rect.top >= main.getBoundingClientRect().bottom, `AI 浮钮与业务滚动区重叠：${label} launcher=${rect.top} main=${main.getBoundingClientRect().bottom} margin=${getComputedStyle(main).marginBottom}`);
    const footer = document.querySelector('.sidebar-footer');
    assert(footer.getBoundingClientRect().bottom <= height + 1, `侧栏底部操作超出窗口：${footer.getBoundingClientRect().bottom}/${height}`);
    if (route === '/overview') {
      const cards = [...document.querySelectorAll('.wb-compact-grid > .wb-stat-card')];
      assert(cards.length === 5, '首页应保留五类真实摘要');
      assert(document.querySelectorAll('.wb-quick-buttons-row button').length === 8, '首页高频入口丢失');
      for (const card of cards) assert(card.scrollWidth <= card.clientWidth + 1, '首页卡片内容横向截断');
      assert(main.innerText.includes('本月') && main.innerText.includes('1年'), '首页业务统计口径改变');
      const colors = cards.map(card => getComputedStyle(card, '::before').backgroundColor);
      assert(new Set(colors).size === 5, '首页五色顶边缺失');
    }
    if (route === '/personnel') {
      const body = main.querySelector('.el-table__body-wrapper');
      assert(body && body.getBoundingClientRect().height >= 150, '居民表格被摘要挤压，无法查看数据行');
    }
    results.push({ label, route, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, clickableControl: control?.textContent.trim() });
  }
  for (const [, route] of [...menus].reverse()) await openGreenSkinRoute(route);
  assert(document.querySelectorAll('#community-skin-titlebar').length === 1, '切换后标题栏重复');
  return { width, height, pages: results, reverseNavigation: true };
}

export async function checkGreenSkinCompatibility() {
  await openGreenSkinRoute('/personnel');
  for (let i = 0; i < 100 && !document.querySelector('[data-testid^="accounts-person-"]'); i++) await pause(50);
  assert(document.querySelector('[data-testid^="accounts-person-"]'), '居民账户入口未载入');
  document.querySelector('[data-testid^="accounts-person-"]').click();
  for (let i = 0; i < 100 && !document.querySelector('[data-testid="person-form-dialog"]'); i++) await pause(50);
  const editor = document.querySelector('[data-testid="person-form-dialog"]');
  assert(visible(editor), '居民表单未打开');
  const input = editor.querySelector('input:not([type=hidden])');
  assert(visible(input), '居民表单输入不可见');
  input.focus();
  assert(document.activeElement === input, '居民表单不可聚焦');
  editor.querySelector('.el-dialog__headerbtn').click();
  await pause(200);
  assert(!visible(document.querySelector('[data-testid="person-form-dialog"]')), '居民表单无法关闭');
  const launcher = document.querySelector('#aiCopilotToggleBtn');
  launcher.click();
  await pause(200);
  assert(launcher.getAttribute('aria-expanded') === 'true', 'AI 助理不能打开');
  document.querySelector('#aiCopilotCloseBtn').click();
  assert(launcher.getAttribute('aria-expanded') === 'false', 'AI 助理不能关闭');
  await openGreenSkinRoute('/drafting');
  assert(visible(document.querySelector('#documentEditor')), 'A4 编辑器不可见');
  assert(visible(document.querySelector('#documentSignatureUnit')), '署名表单不可见');
  const className = document.body.className;
  document.body.classList.remove('light-theme');
  document.body.classList.add('dark-theme');
  await pause(50);
  assert(getComputedStyle(document.querySelector('.app-sidebar')).backgroundColor !== 'rgb(255, 255, 255)', '皮肤覆盖了深色主题');
  document.body.className = className;
  return { residentDialog: true, formFocus: true, aiOpenClose: true, a4Editor: true, darkThemePreserved: true };
}
