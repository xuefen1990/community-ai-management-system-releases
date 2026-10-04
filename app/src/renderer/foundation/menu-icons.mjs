const ICONS = Object.freeze({
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  statistics: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  residents: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  party: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  visits: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  finance: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  land: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  certificate: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  archive: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6M9 14h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.1a2 2 0 1 1-4 0V19a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1h-.1a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.5 1 1.7 1.7 0 0 0-.1 1.1z"/>',
  ai: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z"/>',
  money: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 16h3"/><path d="M7 6V4h12"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/><path d="m14 11 3 3"/>',
  generic: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
});

const MENU_ICON_KEYS = Object.freeze({
  overview: 'overview', statistics: 'statistics', personnel: 'residents', residents: 'residents',
  party: 'party', 'visit-records': 'visits', 'village-duty': 'calendar', duty: 'calendar',
  finance: 'finance', land: 'land', certificate: 'certificate', 'certificate-workspace': 'certificate',
  'certificate-management': 'certificate', documents: 'archive', settings: 'settings',
  'ai-assistant-records': 'ai', 'contract-fees': 'money', 'work-management': 'tasks',
  'document-drafting': 'document',
});

const SEMANTIC_ICON_RULES = [
  [/ai|智能|助手|人工智能/i, 'ai'],
  [/fund|fee|money|finance|资金|发放|财务|承包费/i, 'money'],
  [/work|task|事项|待办|任务/i, 'tasks'],
  [/draft|document|公文|拟写|文件/i, 'document'],
  [/certificate|proof|证明|证件/i, 'certificate'],
  [/archive|record|档案|归档/i, 'archive'],
  [/resident|personnel|people|居民|人员|人口/i, 'residents'],
  [/party|党员|党建/i, 'party'],
  [/visit|民情|记录/i, 'visits'],
  [/duty|calendar|值班|日历/i, 'calendar'],
  [/land|plot|土地|地块|承包/i, 'land'],
  [/statistic|chart|统计|报表/i, 'statistics'],
  [/setting|config|系统设置|配置/i, 'settings'],
];

/** Resolve trusted inline SVG content for a stable menu key or a new menu's semantic label. */
export function resolveMenuIcon({ key = '', iconKey = '', label = '', svgContent = '' } = {}) {
  if (typeof svgContent === 'string' && svgContent.trim()) return svgContent;
  if (iconKey && ICONS[iconKey]) return ICONS[iconKey];
  if (MENU_ICON_KEYS[key]) return ICONS[MENU_ICON_KEYS[key]];
  const semanticText = `${key} ${label}`;
  const match = SEMANTIC_ICON_RULES.find(([pattern]) => pattern.test(semanticText));
  return ICONS[match?.[1] || 'generic'];
}
