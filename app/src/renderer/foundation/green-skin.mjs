// Presentation-only shell decoration. No store, router, persistence or IPC calls.
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
  };
}

if (typeof document !== 'undefined') installGreenSkin(document, window.api?.platform);
