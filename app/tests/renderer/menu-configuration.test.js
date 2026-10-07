const test = require('node:test');
const assert = require('node:assert/strict');

test('菜单设置覆盖扩展菜单，排序和名称在保存后可重建', async () => {
  const { menuRows, moveMenuRow, menuConfigFromRows, sortMenuItems } = await import('../../src/renderer/foundation/menu-configuration.mjs');
  const menus = [
    { key: 'overview', label: '工作台' },
    { key: 'work-management', label: '工作事项' },
    { key: 'settings', label: '系统设置' },
  ];
  const rows = moveMenuRow(menuRows(menus), 'work-management', 1);
  rows[0].customAlias = '待办事项';
  rows[0].visible = false;
  const saved = menuConfigFromRows(rows);
  assert.deepEqual(sortMenuItems(menus, saved).map(item => item.key), ['work-management', 'overview', 'settings']);
  assert.equal(saved['work-management'].customAlias, '待办事项');
  assert.equal(saved['work-management'].visible, false);
  assert.equal(saved.settings.visible, true);
  assert.deepEqual(sortMenuItems(menus, {}, menus).map(item => item.key), menus.map(item => item.key));
});

test('默认菜单与截图顺序一致，设置中的排序号从 1 连续排列', async () => {
  const { orderDefaultMenus, menuRows } = await import('../../src/renderer/foundation/menu-configuration.mjs');
  const keys = [
    'overview', 'statistics', 'personnel', 'party', 'visit-records',
    'village-duty', 'finance', 'land', 'certificate-management', 'documents',
    'settings', 'ai-assistant-records', 'contract-fees', 'work-management',
    'document-drafting',
  ];
  const rows = menuRows(orderDefaultMenus(keys.map(key => ({ key, label: key }))));
  assert.deepEqual(rows.map(row => row.key), [
    'overview', 'statistics', 'personnel', 'party', 'document-drafting',
    'certificate-management', 'visit-records', 'contract-fees', 'village-duty',
    'finance', 'work-management', 'land', 'documents', 'ai-assistant-records',
    'settings',
  ]);
  assert.deepEqual(rows.map(row => row.order), Array.from({ length: 15 }, (_, index) => index + 1));
});

test('居民档案仅替换默认 label，保留菜单身份、输入和自定义别名', async () => {
  const { orderDefaultMenus, menuRows, menuConfigFromRows } = await import('../../src/renderer/foundation/menu-configuration.mjs');
  const original = { key: 'personnel', label: '居民一户一档', tab: 'personnel', route: '/personnel' };
  const [display] = orderDefaultMenus([original]);
  assert.deepEqual(display, { ...original, label: '居民档案' });
  assert.equal(original.label, '居民一户一档');
  const [row] = menuRows([original], { personnel: { customAlias: '本村名册', visible: false } });
  assert.equal(row.label, '居民档案');
  assert.equal(row.customAlias, '本村名册');
  assert.equal(row.visible, false);
  assert.equal(menuConfigFromRows([row]).personnel.customAlias, '本村名册');
});
