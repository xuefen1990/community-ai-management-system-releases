export const LAN_SETUP_ROUTE = '/connect-host';

export function isChildAccount(account) {
  return account?.role === 'member';
}

export function autoConnectHost(hosts, savedBaseUrl) {
  if (!savedBaseUrl) return null;
  const matched = (hosts || []).filter(host => host.matched);
  const savedIp = new URL(savedBaseUrl).hostname;
  return matched.find(host => host.ip === savedIp) || (matched.length === 1 ? matched[0] : null);
}

export async function needsLanSetup(api) {
  const { authenticated, account } = await api.getLocalAuthStatus();
  if (!authenticated || !isChildAccount(account)) return false;
  try {
    return (await api.getLanShareInfo())?.connection?.status !== 'online';
  } catch {
    return true;
  }
}

export async function routeAfterLogin(api) {
  return await needsLanSetup(api) ? LAN_SETUP_ROUTE : '/overview';
}
