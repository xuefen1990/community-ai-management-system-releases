// Local presentation extension: retain the original account and action handlers.
import { useAuthStore, useDialogStore } from './vendor/assets/foundation-runtime.mjs';

const icons = {
  screen: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  theme: '<path d="m9.5 4 .7-2h3.6l.7 2 1.6.9 2.1-.4 1.8 3.1-1.4 1.7v1.9l1.4 1.7-1.8 3.1-2.1-.4-1.6.9-.7 2h-3.6l-.7-2-1.6-.9-2.1.4-1.8-3.1 1.4-1.7V9.3L4 7.6l1.8-3.1 2.1.4z" transform="translate(0 1)"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sync: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/>',
  privacy: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  logout: '<path d="M9 4H5v16h4m5-12 4 4-4 4m-5-4h10"/>',
};
const originals = {
  theme: 'sidebar-theme-customizer', sync: 'sidebar-sync-token',
  privacy: 'sidebar-privacy-agreement', logout: 'sidebar-logout',
};

function icon(document, name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name]; // Fixed local SVG paths, never account or business data.
  return svg;
}

export function installSidebarFooter({ document, router, shell }) {
  const view = document.defaultView;
  const auth = useAuthStore();
  const notify = message => useDialogStore().notify({ type: 'error', message });
  const href = new URL('./sidebar-footer.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link);
  }
  let mounted, scheduled = false, disposed = false;
  const enabledMenus = () => new Set((shell.allowedMenus || []).map(menu => menu.key));
  const source = action => mounted?.card.querySelector(`[data-testid="${originals[action]}"]`);
  const available = action => {
    const button = source(action);
    return !!button && !button.disabled && button.getAttribute('aria-busy') !== 'true' && !button.classList.contains('is-loading');
  };
  const button = (key, label, handler, menu = false) => {
    const element = document.createElement('button');
    element.type = 'button'; element.className = menu ? 'community-footer-menu-item' : 'community-footer-shortcut';
    element.dataset.testid = `community-footer-${key}`;
    element.setAttribute('aria-label', label); element.title = label;
    element.append(icon(document, key));
    if (menu) { element.setAttribute('role', 'menuitem'); const text = document.createElement('span'); text.textContent = label; element.append(text); }
    element.addEventListener('click', handler);
    return element;
  };
  const close = (restoreFocus = false) => {
    if (!mounted) return;
    mounted.menu.hidden = true;
    mounted.more.setAttribute('aria-expanded', 'false');
    if (restoreFocus && mounted.more.isConnected) mounted.more.focus();
  };
  const runOriginal = action => {
    if (!available(action)) { notify('此操作暂不可用，请稍后重试。'); return; }
    const target = source(action);
    close(true);
    target.click(); // Reuse refresh, privacy, appearance and logout confirmation as-is.
  };
  const navigate = async (menu, target) => {
    close();
    if (!enabledMenus().has(menu) || menu === 'settings' && auth.isLanClient) return;
    try { await router.push(target); }
    catch (error) { notify(error.message || '打开页面失败，请稍后重试。'); }
  };
  const update = () => {
    if (!mounted) return;
    const menus = enabledMenus();
    const disabled = (element, value) => { if (element.disabled !== value) element.disabled = value; };
    disabled(mounted.screen, !menus.has('statistics'));
    disabled(mounted.mobile, !menus.has('settings') || auth.isLanClient);
    disabled(mounted.theme, !available('theme'));
    for (const [key, item] of Object.entries(mounted.items)) {
      item.hidden = !source(key);
      disabled(item, !available(key));
    }
  };
  const toggle = () => {
    if (!mounted.menu.hidden) { close(); return; }
    update(); mounted.menu.hidden = false; mounted.more.setAttribute('aria-expanded', 'true');
    const anchor = mounted.more.getBoundingClientRect(), bounds = mounted.menu.getBoundingClientRect();
    mounted.menu.style.left = `${Math.max(8, Math.min(anchor.left, view.innerWidth - bounds.width - 8))}px`;
    mounted.menu.style.top = `${Math.max(8, anchor.top - bounds.height - 8)}px`;
    mounted.menu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
  };
  const detach = () => {
    if (!mounted) return;
    mounted.card.classList.remove('community-footer-enhanced');
    mounted.toolbar.remove(); mounted.menu.remove(); mounted = null;
  };
  const decorate = () => {
    const card = document.querySelector('[data-testid="business-shell"] .sidebar-footer .admin-profile-card');
    if (mounted?.card !== card || mounted && !mounted.toolbar.isConnected) detach();
    if (!card || disposed) return;
    if (!mounted) {
      const toolbar = document.createElement('div'); toolbar.className = 'community-footer-shortcuts';
      toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', '快捷工具');
      const menu = document.createElement('div'); menu.className = 'community-footer-menu'; menu.id = 'community-sidebar-more-menu';
      menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '更多操作'); menu.hidden = true;
      const screen = button('screen', '打开数据大屏', () => { void navigate('statistics', { name: 'statistics', query: { screen: '1' } }); });
      const mobile = button('mobile', '手机互联', () => { void navigate('settings', { name: 'settings', query: { tab: 'mobile' } }); });
      const theme = button('theme', '切换皮肤与字号大小', () => runOriginal('theme'));
      const more = button('more', '更多操作', toggle);
      more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', menu.id);
      more.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); if (menu.hidden) toggle(); } });
      const items = {};
      for (const [key, label] of [['sync', '刷新授权额度'], ['privacy', '数据存储与服务说明'], ['logout', '退出登录']]) {
        items[key] = button(key, label, () => runOriginal(key), true); menu.append(items[key]);
      }
      toolbar.append(screen, mobile, theme, more); card.append(toolbar); document.body.append(menu);
      mounted = { card, toolbar, menu, screen, mobile, theme, more, items };
      card.classList.add('community-footer-enhanced');
    }
    update();
  };
  const observer = new view.MutationObserver(() => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed) decorate(); });
  });
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-busy'] });
  const outside = event => { if (mounted && !mounted.menu.contains(event.target) && !mounted.more.contains(event.target)) close(); };
  const keydown = event => {
    if (!mounted || mounted.menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...mounted.menu.querySelectorAll('button:not([hidden]):not(:disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  const focusout = () => queueMicrotask(() => { if (mounted && !mounted.menu.contains(document.activeElement) && document.activeElement !== mounted.more) close(); });
  const resized = () => close();
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keydown);
  document.addEventListener('focusin', focusout); view.addEventListener('resize', resized);
  const removeRouteHook = router.afterEach(() => close());
  decorate();
  return () => {
    disposed = true; observer.disconnect(); removeRouteHook(); detach();
    document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown);
    document.removeEventListener('focusin', focusout); view.removeEventListener('resize', resized);
  };
}
