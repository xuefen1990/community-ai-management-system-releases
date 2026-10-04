import { app, router, useAppStore, usePersonnelStore, useOverviewStore } from './vendor/assets/foundation-runtime.mjs';
import { installExtensions, loadScript } from './extensions.mjs';
import { installCommunityAccountGate } from './account-gate.mjs';
import { installCommunitySettings } from './settings-panels.mjs';
import { installSettingsReferenceSync } from './settings-reference-sync.mjs';
import { installResidentEditor } from './resident-editor.mjs';
import { installHouseholdMemberRegistration } from './household-member-registration.mjs';
import { initializeMenuConfiguration } from './settings-panels.mjs';
import { needsLanSetup } from './workspace-connection.mjs';

// The desktop preload supplies authenticated operations backed by our own
// account service and database. Never start a browser/LAN trial implicitly.
if (typeof window.api?.bootstrapProductAuth !== 'function' || typeof window.api?.businessRequest !== 'function') {
  document.querySelector('#app').textContent = '新版基础尚未连接社区账户和业务服务，请返回当前正式版本。';
  throw new Error('Community foundation bridge is required');
}

const shell = useAppStore();
window.communityMayLoadBusiness = async () => !await needsLanSetup(window.api);
installCommunityAccountGate();
shell.villageName = '社区名称';
shell.villageSubtitle = '社区AI管理系统';
installExtensions({ router, shell });
initializeMenuConfiguration(shell);
installCommunitySettings();
installSettingsReferenceSync();
installResidentEditor(loadScript);
installHouseholdMemberRegistration(loadScript);
app.mount('#app');
// Subscribe before the native startup update check can emit its result.
loadScript('js/update-ui.js').catch(error => window.showToast(error.message, 'error'));

export const foundation = { app, router, shell, personnel: usePersonnelStore(), overview: useOverviewStore() };
