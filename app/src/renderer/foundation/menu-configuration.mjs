const CONFIG_KEY = 'cwt_menu_visibility_config';

const DEFAULT_MENU_KEYS = [
  'overview', 'statistics', 'personnel', 'party', 'document-drafting',
  'certificate-management', 'visit-records', 'contract-fees', 'village-duty',
  'finance', 'work-management', 'land', 'documents', 'ai-assistant-records',
  'settings',
];

export function orderDefaultMenus(menus) {
  const position = new Map(DEFAULT_MENU_KEYS.map((key, index) => [key, index]));
  return [...menus].sort((a, b) =>
    (position.get(a.key) ?? DEFAULT_MENU_KEYS.length) - (position.get(b.key) ?? DEFAULT_MENU_KEYS.length)
    || menus.indexOf(a) - menus.indexOf(b));
}

export function readMenuConfiguration() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function sortMenuItems(menus, config = {}, defaults = menus) {
  const defaultPosition = new Map(defaults.map((menu, index) => [menu.key, index]));
  return [...menus].sort((a, b) => {
    const originalA = defaultPosition.get(a.key) ?? menus.indexOf(a);
    const originalB = defaultPosition.get(b.key) ?? menus.indexOf(b);
    const positionA = Number(config[a.key]?.order);
    const positionB = Number(config[b.key]?.order);
    const rankA = Number.isInteger(positionA) && positionA > 0 ? positionA : originalA + 1;
    const rankB = Number.isInteger(positionB) && positionB > 0 ? positionB : originalB + 1;
    return rankA - rankB || originalA - originalB;
  });
}

export function moveMenuRow(rows, key, target) {
  const from = rows.findIndex(row => row.key === key);
  const position = Number(target);
  if (from < 0 || !Number.isInteger(position) || position < 1 || position > rows.length) return rows;
  const reordered = rows.slice();
  const [row] = reordered.splice(from, 1);
  reordered.splice(position - 1, 0, row);
  return reordered.map((item, index) => ({ ...item, order: index + 1 }));
}

export function menuRows(menus, config = {}) {
  return menus.map((menu, index) => ({
    key: menu.key,
    label: menu.label,
    svgContent: menu.svgContent,
    icon: menu.icon,
    visible: menu.key === 'settings' || config[menu.key]?.visible !== false,
    customAlias: config[menu.key]?.customAlias || '',
    order: index + 1,
  }));
}

export function menuConfigFromRows(rows) {
  return Object.fromEntries(rows.map((row, index) => [row.key, {
    visible: row.key === 'settings' || row.visible,
    customAlias: row.customAlias.trim(),
    order: index + 1,
  }]));
}
