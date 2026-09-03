'use strict';

function selectSettingsTab(tabName, { buttons = [], cards = [], logsPanel = null } = {}) {
  if (!tabName) return false;

  for (const button of buttons) {
    const isActive = button.dataset.settingsTab === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  }

  for (const card of cards) {
    card.classList.toggle('hidden', card.dataset.settingsSection !== tabName);
  }

  if (logsPanel) logsPanel.classList.toggle('hidden', tabName !== 'logs');
  return true;
}

function initializeSettingsTabs(root = document) {
  const tabbar = root.getElementById('settingsTabbar');
  if (!tabbar) return false;

  const buttons = [...tabbar.querySelectorAll('[data-settings-tab]')];
  if (!buttons.length) return false;

  const cards = [...root.querySelectorAll('[data-settings-section]')];
  const logsPanel = root.getElementById('settingsPanelLogs');
  const showTab = (tabName) => selectSettingsTab(tabName, { buttons, cards, logsPanel });

  for (const button of buttons) {
    button.addEventListener('click', () => showTab(button.dataset.settingsTab));
  }

  const initialTab = buttons.find((button) => button.classList.contains('active'))?.dataset.settingsTab
    || buttons[0].dataset.settingsTab;
  return showTab(initialTab);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializeSettingsTabs, selectSettingsTab };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initializeSettingsTabs(), { once: true });
  else initializeSettingsTabs();
}
