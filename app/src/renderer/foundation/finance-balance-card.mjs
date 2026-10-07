import { createElementVNode as h, ref, onMounted, onBeforeUnmount } from './vendor/assets/foundation-runtime.mjs';

const money = cents => (Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function installOverviewBalance({ router }) {
  const OverviewBalanceCard = { name: 'OverviewWithAccountBalance', setup() {
    const balance = ref(null), allowed = ref(false), error = ref(''), busy = ref(false);
    let active = true, sequence = 0, day = new Date().toLocaleDateString('sv-SE'), timer;
    async function refresh() {
      const id = ++sequence; busy.value = true;
      try {
        const status = await window.api.getLocalAuthStatus();
        if (!active || id !== sequence) return;
        allowed.value = status.authenticated === true && (status.account?.role !== 'member' || status.account.permissions?.finance?.includes('view'));
        if (!allowed.value) { balance.value = null; return; }
        const result = await window.api.businessRequest({ method: 'GET', path: '/api/v3/finance-account-balance' });
        if (!active || id !== sequence) return;
        if (!result?.ok) throw new Error(result?.error?.message || '余额暂无法读取');
        balance.value = result.data; error.value = '';
      } catch (cause) { if (active && id === sequence) { balance.value = null; error.value = cause.message || '余额暂无法读取'; } }
      finally { if (active && id === sequence) busy.value = false; }
    }
    onMounted(() => {
      refresh(); window.addEventListener('focus', refresh); window.addEventListener('community-finance-changed', refresh);
      timer = setInterval(() => { const today = new Date().toLocaleDateString('sv-SE'); if (today !== day) { day = today; refresh(); } }, 60000);
    });
    onBeforeUnmount(() => { active = false; sequence++; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('community-finance-changed', refresh); });
    return () => allowed.value ? h('section', { class: 'wb-stat-card card-blue community-overview-balance', 'aria-label': '账户余额', 'data-testid': 'overview-account-balance' }, [
        h('div', {}, [h('span', {}, '账户余额'),
          h('strong', { class: balance.value?.amountCents < 0 ? 'negative' : '' }, error.value ? '暂无法读取' : busy.value && !balance.value ? '读取中…' : balance.value?.status === 'ready' ? `¥ ${money(balance.value.amountCents)}` : balance.value?.status === 'before-opening' ? '无法计算' : '待设置'),
          h('small', {}, error.value || (balance.value?.status === 'ready' ? `截至 ${balance.value.asOfDate} · 按完整台账累计` : balance.value?.status === 'before-opening' ? '早于期初日期，无法计算' : '请主账号在财务收支中设置期初余额'))]),
        h('button', { onClick: () => router.push('/finance') }, '查看财务收支'),
        error.value ? h('button', { onClick: refresh, disabled: busy.value }, '重试') : null,
      ]) : null;
  } };
  window.communityOverviewBalanceCard = OverviewBalanceCard;
}
