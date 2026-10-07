import { router } from './vendor/assets/foundation-runtime.mjs';
import { PartyView286, DutyView286 } from './vendor/party-duty-286.mjs';

export function installPartyDutyReference() {
  for (const [name, path, component, menuKey, tabId] of [
    ['party', '/party', PartyView286, 'party', 'tab-party'],
    ['village-duty', '/village-duty', DutyView286, 'village-duty', 'tab-village-duty'],
  ]) {
    const existing = router.getRoutes().find(route => route.name === name);
    router.addRoute({ name, path, component, meta: { ...existing?.meta, menuKey, tabId, requiresAuth: true } });
  }
}
