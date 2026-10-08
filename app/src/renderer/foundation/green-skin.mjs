// Presentation only: read the existing visible menus, never write business state.
import { foundation } from './bootstrap.mjs';
import { menuGroupLabel } from './menu-configuration.mjs';
const TITLEBAR_ID = 'community-skin-titlebar';

export function installGreenSkin(document, platform) {
  document.body.classList.add('community-green-skin');
  if (!['darwin', 'win32', 'linux'].includes(platform)) return () => {};
  document.body.classList.add('community-desktop-skin');
  document.body.dataset.skinPlatform = platform;

  // Keep only the outer desktop viewport anchored. Inner business scroll
  // positions remain owned by their existing pages. Focus can leave a stale
  // document offset when the authenticated shell first replaces the login.
  const alignShell = () => {
    if (document.body.classList.contains('community-skin-shell-ready') && document.scrollingElement?.scrollTop) document.scrollingElement.scrollTop = 0;
  };
  const view = document.defaultView;
  view?.addEventListener('scroll', alignShell);
  view?.addEventListener('resize', alignShell);

  const decorate = () => {
    const shell = document.querySelector('[data-testid="business-shell"]');
    const existing = document.getElementById(TITLEBAR_ID);
    if (!shell) {
      existing?.remove();
      document.body.classList.remove('community-skin-shell-ready');
      return;
    }
    // Remove the old presentation bar on hot reload; native controls remain.
    existing?.remove();
    document.body.classList.add('community-skin-shell-ready');
    alignShell();
    const buttons = [...shell.querySelectorAll('.sidebar-menu .menu-item')];
    const menus = foundation.shell.allowedMenus;
    let previousGroup = '';
    buttons.forEach((button, index) => {
      const menu = menus[index];
      const group = menu ? menuGroupLabel(menu.key) : '';
      // No node reparenting or menu-order changes in the framework-owned tree.
      // Headings annotate each contiguous group, also respecting saved sorting.
      if (group && group !== previousGroup) button.dataset.skinGroupStart = group;
      else delete button.dataset.skinGroupStart;
      if (menu) {
        button.setAttribute('aria-label', menu.label);
        button.setAttribute('aria-description', group ? `${group}分类` : '');
      }
      previousGroup = group;
    });
  };
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; decorate(); });
  });
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  decorate();
  return () => {
    observer.disconnect();
    view?.removeEventListener('scroll', alignShell);
    view?.removeEventListener('resize', alignShell);
    document.getElementById(TITLEBAR_ID)?.remove();
    document.body.classList.remove('community-green-skin', 'community-desktop-skin', 'community-skin-shell-ready');
    delete document.body.dataset.skinPlatform;
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(button => {
      delete button.dataset.skinGroupStart;
      button.removeAttribute('aria-label');
      button.removeAttribute('aria-description');
    });
  };
}

if (typeof document !== 'undefined') installGreenSkin(document, window.api?.platform);
