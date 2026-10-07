function tokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count).toLocaleString('zh-CN') : '—';
}

function quotaFromResponse(response) {
  return response?.quota || response?.data?.quota || response?.data || response?.result?.quota || response?.result || response || {};
}

export function createAiTokenStatus({ api = globalThis.window?.api, documentRef = globalThis.document } = {}) {
  let remainingTokens = null;
  let lastUsedTokens = null;
  let refreshPromise = null;
  let creditsMode = false;
  let remainingCredits = null;
  let lastUsedCredits = null;

  function sync() {
    for (const element of documentRef?.querySelectorAll?.('[data-ai-token-status]') || []) {
      const used = element.querySelector('[data-ai-token-used]');
      const remaining = element.querySelector('[data-ai-token-remaining]');
      if(creditsMode){if(used)used.textContent=lastUsedCredits===null?'本次消耗 — 积分':`本次消耗 ${lastUsedCredits.toLocaleString('zh-CN',{maximumFractionDigits:4})} 积分`;if(remaining)remaining.textContent=remainingCredits===null?'积分读取中':`余量 ${remainingCredits.toLocaleString('zh-CN',{maximumFractionDigits:4})} 积分`;element.title='主账号与子账号共用积分，内部步骤汇总结算';continue;}
      if (used) used.textContent = lastUsedTokens === null ? '本次消耗 — Token' : `本次消耗 ${tokenCount(lastUsedTokens)} Token`;
      if (remaining) remaining.textContent = remainingTokens === null ? '余量读取中' : `余量 ${tokenCount(remainingTokens)} Token`;
      element.title = '所有 AI 对话窗口共用此账号的 Token 额度';
    }
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (typeof api?.getAiQuota !== 'function') { sync(); return null; }
    refreshPromise = Promise.resolve(api.getAiQuota())
      .then((response) => {
        const quota = quotaFromResponse(response);
        creditsMode=quota.billingUnit==='credits';
        if(creditsMode&&Number.isFinite(Number(quota.remainingCredits)))remainingCredits=Number(quota.remainingCredits);
        const available = Number(quota.remainingTokens ?? quota.availableTokens);
        if (response?.ok === false) throw new Error(response.error || '额度暂不可用');
        if (Number.isFinite(available) && available >= 0) remainingTokens = available;
        sync();
        return quota;
      })
      .catch(() => { sync(); return null; })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function record({ actualTokens, chargedCredits, remainingCredits:nextCredits, billingUnit, remainingTokens: nextRemainingTokens } = {}) {
    if(billingUnit==='credits')creditsMode=true;
    if(chargedCredits!==null&&chargedCredits!==undefined&&Number.isFinite(Number(chargedCredits)))lastUsedCredits=Number(chargedCredits);
    if(nextCredits!==null&&nextCredits!==undefined&&Number.isFinite(Number(nextCredits)))remainingCredits=Number(nextCredits);
    const used = Number(actualTokens);
    if (Number.isFinite(used) && used >= 0) lastUsedTokens = used;
    const remaining = Number(nextRemainingTokens);
    if (nextRemainingTokens !== null && nextRemainingTokens !== undefined && Number.isFinite(remaining) && remaining >= 0) {
      remainingTokens = remaining;
      sync();
      return Promise.resolve(remainingTokens);
    }
    sync();
    return refresh();
  }

  sync();
  return { refresh, record, sync, getState: () => ({ remainingTokens, lastUsedTokens }) };
}

export function installAiTokenStatus(options) {
  const target = options?.windowRef || globalThis.window;
  if (!target) return null;
  if (!target.communityAiTokenStatus) target.communityAiTokenStatus = createAiTokenStatus(options);
  return target.communityAiTokenStatus;
}
