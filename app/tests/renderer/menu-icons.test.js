const test = require('node:test');
const assert = require('node:assert/strict');

test('extension menu icons are distinct and resolve by stable key', async () => {
  const { resolveMenuIcon } = await import('../../src/renderer/foundation/menu-icons.mjs');
  const menuKeys = ['ai-assistant-records', 'contract-fees', 'work-management', 'document-drafting'];
  const icons = menuKeys.map(key => resolveMenuIcon({ key }));
  assert.equal(new Set(icons).size, menuKeys.length);
  assert.ok(icons.every(icon => icon.includes('<')));
});

test('new menu items can provide an icon key or SVG and get semantic fallback', async () => {
  const { resolveMenuIcon } = await import('../../src/renderer/foundation/menu-icons.mjs');
  assert.equal(resolveMenuIcon({ iconKey: 'calendar' }), resolveMenuIcon({ key: 'village-duty' }));
  assert.equal(resolveMenuIcon({ key: 'new-funds-page', label: '专项资金管理' }), resolveMenuIcon({ iconKey: 'money' }));
  assert.equal(resolveMenuIcon({ key: 'new-menu', svgContent: '<circle cx="12" cy="12" r="4"/>' }), '<circle cx="12" cy="12" r="4"/>');
  assert.ok(resolveMenuIcon({ key: 'new-menu', label: '未知功能' }).includes('<rect'));
});
