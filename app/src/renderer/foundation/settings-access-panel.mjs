import { createElementVNode as h, ref, onMounted, onBeforeUnmount } from './vendor/assets/foundation-runtime.mjs';
import { loadScript } from './extensions.mjs';

export const AccessManagementPanel = { props: { cadre: Object }, setup(props) {
  const loading = ref(true), error = ref(''), role = ref('');
  let host;
  onMounted(async () => {
    try {
      const status = await window.api.getLocalAuthStatus();
      role.value = status?.account?.role || '';
      if (['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(role.value)) {
        await loadScript('js/unit-member-management-ui.js');
        await window.unitMemberManagement.open(status, { mount: host, prefill: props.cadre || null });
      }
    } catch (cause) { error.value = cause?.message || '无法读取子账号授权信息'; }
    finally { loading.value = false; }
  });
  onBeforeUnmount(() => window.unitMemberManagement?.close());
  return () => h('section', { class: 'foundation-access-section', 'data-testid': 'community-access-management' }, [
    loading.value ? h('p', { role: 'status' }, '正在读取子账号与权限…') : null,
    error.value ? h('p', { role: 'alert', class: 'foundation-setting-message is-error' }, error.value) : null,
    !loading.value && !error.value && !['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(role.value)
      ? h('div', { class: 'settings-card foundation-reference-card' }, [h('div', { class: 'card-header' }, [h('h3', {}, '子账号与权限')]), h('div', { class: 'card-body' }, [h('p', {}, '只有主账号可以开通子账号和分配权限。')])]) : null,
    h('div', { class: 'foundation-access-host', ref: element => { host = element; } }),
  ]);
} };
