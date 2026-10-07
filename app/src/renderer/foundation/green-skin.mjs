// Presentation only: read the existing visible menus, never write business state.
import { foundation } from './bootstrap.mjs';
import { menuGroupLabel } from './menu-configuration.mjs';
const TITLEBAR_ID = 'community-skin-titlebar';

export function installGreenSkin(document, platform) {
  document.body.classList.add('community-green-skin');
  if (!['darwin', 'win32', 'linux'].includes(platform)) return () => {};
  document.body.classList.add('community-desktop-skin');
  document.body.dataset.skinPlatform = platform;

  const decorate = () => {
    const shell = document.querySelector('[data-testid="business-shell"]');
    const existing = document.getElementById(TITLEBAR_ID);
    if (!shell) {
      existing?.remove();
      document.body.classList.remove('community-skin-shell-ready');
      return;
    }
    if (!existing) {
      const titlebar = document.createElement('header');
      titlebar.id = TITLEBAR_ID;
      titlebar.className = 'community-skin-titlebar';
      const title = document.createElement('span');
      title.textContent = document.title;
      titlebar.append(title);
      // Keep the decoration outside the framework-owned tree.
      document.body.append(titlebar);
    }
    document.body.classList.add('community-skin-shell-ready');
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
