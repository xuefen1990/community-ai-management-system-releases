'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..', '..');

test('renderer loads local authentication after the compatibility renderer', async () => {
  const html = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const rendererIndex = html.indexOf('<script src="renderer.js"></script>');
  const localAuthIndex = html.indexOf('<script src="js/local-auth-ui.js"></script>');
  assert.ok(rendererIndex >= 0);
  assert.ok(localAuthIndex > rendererIndex);
});

test('local authentication UI uses only the preload bridge', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /window\.api/u);
  assert.match(source, /loginLocalAccount/u);
  assert.match(source, /activateOfflineLicense/u);
  assert.match(source, /listLocalAccountEntitlements/u);
  assert.match(source, /getLoginPrefill/u);
  assert.match(source, /getStartupEntitlement/u);
  assert.match(source, /clearLoginPrefill/u);
  assert.match(source, /getRemoteServerConfig/u);
  assert.match(source, /setRemoteServerConfig/u);
  assert.match(source, /checkRemoteServerConnection/u);
  assert.match(source, /账号服务器设置/u);
  assert.match(source, /记住登录/u);
  assert.match(source, /免费体验已结束/u);
  assert.match(source, /removeLegacyTrialArtifacts/u);
  assert.match(source, /installShortLivedTrialRemoval/u);
  assert.match(source, /update-ui\.js/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('unit application panel separates scrollable fields from fixed actions', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);
  assert.match(source, /unit-application-panel/u);
  assert.match(source, /unit-application-scroll/u);
  assert.match(source, /unit-application-actions/u);
  assert.match(source, /unit-application-passwords/u);
  assert.match(style, /\.unit-application-panel\s*\{/u);
  assert.match(style, /\.unit-application-scroll\s*\{/u);
  assert.match(style, /\.unit-application-actions\s*\{/u);
  assert.match(style, /@media\s*\(max-width:\s*640px\)/u);
});

test('login startup checks the previous account entitlement before showing a reminder', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  const start = source.indexOf('async function prepareAuthorizedStartup()');
  const end = source.indexOf('async function enterDashboard(status)');
  const startupSource = source.slice(start, end);

  assert.match(startupSource, /installShortLivedTrialRemoval\(\);/u);
  assert.match(startupSource, /showExpiryReminder\(startupSummary\.entitlement\);/u);
  assert.match(source, /function friendlyRemoteError\(error\)/u);
  assert.match(source, /openRemoteServerSettings/u);
  assert.match(source, /setError\('reg', friendlyRemoteError\(error\)\)/u);
});

test('personnel Excel import is loaded after legacy UI and persists through the preload bridge', async () => {
  const [adapter, importer] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-excel-import.js'), 'utf8'),
  ]);
  assert.match(adapter, /personnel-excel-import\.js/u);
  assert.match(adapter, /personnel-import-merge\.js/u);
  assert.match(importer, /importExcelBtn/u);
  assert.match(importer, /batchImportExcelBtn/u);
  assert.match(importer, /excelFileInput/u);
  assert.match(importer, /confirmExcelImportBtn/u);
  assert.match(importer, /window\.api\?\.readDb/u);
  assert.match(importer, /window\.api\?\.writeDb/u);
  assert.match(importer, /身份证号/u);
  assert.match(importer, /专项标签/u);
  assert.match(importer, /唯一合并凭证/u);
  assert.match(importer, /personnelImportRecords/u);
  assert.match(importer, /skippedReasons/u);
  assert.match(importer, /function refreshPersonnelWorkspace\(\)/u);
  assert.match(importer, /await window\.loadDatabase\(\)/u);
  assert.match(importer, /window\.renderOverview\(\)/u);
  assert.match(importer, /window\.filterPersonnel\(\)/u);
  assert.doesNotMatch(importer, /window\.location\.reload/u);
  assert.doesNotMatch(importer, /require\(|ipcRenderer|node:/u);
});

test('personnel search safely filters imported and historical field variants in real time', async () => {
  const [adapter, search] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-search.js'), 'utf8'),
  ]);
  assert.match(adapter, /personnel-search\.js/u);
  assert.match(search, /searchPersonnel/u);
  assert.match(search, /clearSearchPersonnel/u);
  assert.match(search, /person_name/u);
  assert.match(search, /idCard/u);
  assert.match(search, /household_id/u);
  assert.match(search, /mobile_phone/u);
  assert.match(search, /personnelCurrentPage\s*=\s*1/u);
  assert.match(search, /renderPersonnelResults\(results\)/u);
  assert.match(search, /search\.removeAttribute\('oninput'\)/u);
  assert.match(search, /filterGroup/u);
  assert.match(search, /filterIdentity/u);
  assert.match(search, /filterGender/u);
  assert.match(search, /filterRelation/u);
  assert.match(search, /filterAge/u);
  assert.match(search, /filterDataAudit/u);
  assert.match(search, /filterRegistryStatus/u);
  assert.match(search, /specialIdentities/u);
  assert.match(search, /clearPersonnelFilters/u);
  assert.doesNotMatch(search, /require\(|ipcRenderer|node:/u);
});

test('party stage statistic cards are loaded through the readable local auth adapter', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /party-stage-stat-cards\.js/u);
  assert.match(source, /data-party-stage-stat-cards/u);
});

test('personnel search refreshes matching results and resets to the first page', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-search.js'), 'utf8');
  const listeners = {};
  const input = {
    value: '薛锋',
    dataset: {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
    removeAttribute: () => { input.legacyHandlerRemoved = true; },
  };
  const clearButton = { style: {}, addEventListener: () => {} };
  let rendered = null;
  const context = {
    console,
    dbState: {
      personnel: [
        { name: '李萍', phone: '13800000000' },
        { person_name: '薛锋', idCard: '320101199001011234' },
        { full_name: '王丽', household_id: '209175411' },
      ],
    },
    personnelCurrentPage: 4,
    renderPersonnel: (people) => { rendered = people; },
    window: {},
    document: {
      readyState: 'complete',
      getElementById: (id) => ({ searchPersonnel: input, clearSearchPersonnel: clearButton }[id] || null),
      querySelector: () => null,
      addEventListener: () => {},
    },
  };
  vm.runInNewContext(source, context);
  listeners.input();
  assert.equal(input.legacyHandlerRemoved, true);
  assert.equal(context.personnelCurrentPage, 1);
  assert.deepEqual(rendered.map((person) => person.person_name), ['薛锋']);
});

test('personnel filters combine group, identity and gender selections', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-search.js'), 'utf8');
  const listeners = {};
  const createInput = (value = '') => ({
    value,
    dataset: {},
    removeAttribute: () => {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
  });
  const controls = {
    searchPersonnel: createInput(),
    clearSearchPersonnel: { style: {}, addEventListener: () => {} },
    filterGroup: createInput('东一组'),
    filterIdentity: createInput('党员'),
    filterGender: createInput('女'),
    filterRelation: createInput(),
    filterAge: createInput(),
    filterDataAudit: createInput(),
    filterRegistryStatus: createInput(),
  };
  let rendered = null;
  const context = {
    console,
    dbState: { personnel: [
      { name: '薛锋', village_group: '东一组', gender: '女', tags: ['党员'] },
      { name: '李萍', village_group: '东一组', gender: '男', tags: ['党员'] },
      { name: '王丽', village_group: '西一组', gender: '女', tags: ['党员'] },
    ] },
    personnelCurrentPage: 2,
    renderPersonnel: (people) => { rendered = people; },
    window: {},
    document: {
      readyState: 'complete',
      getElementById: (id) => controls[id] || null,
      querySelector: () => null,
      addEventListener: () => {},
    },
  };
  vm.runInNewContext(source, context);
  listeners.change();
  assert.equal(context.personnelCurrentPage, 1);
  assert.deepEqual(rendered.map((person) => person.name), ['薛锋']);
});

test('household membership uses the complete household number as its only association key', async () => {
  const [adapter, membership] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'household-membership.js'), 'utf8'),
  ]);
  assert.match(adapter, /household-membership\.js/u);
  assert.match(membership, /person\?\.household_id\) === target/u);
  assert.doesNotMatch(membership, /replace\([^)]*\^0\+/u);

  const context = {
    dbState: { personnel: [
      { name: '户主甲', household_id: '00123', relation_to_head: '户主' },
      { name: '成员甲', household_id: '00123', relation_to_head: '子' },
      { name: '另一户户主', household_id: '123', relation_to_head: '户主' },
      { name: '已注销人员', household_id: '00123', registry_status: '已注销' },
    ] },
    window: {},
  };
  context.window = context;
  vm.runInNewContext(membership, context);
  assert.deepEqual(
    context.getHouseholdMembersById('00123').map((person) => person.name),
    ['户主甲', '成员甲'],
  );
  assert.deepEqual(
    context.getHouseholdMembersById('123').map((person) => person.name),
    ['另一户户主'],
  );
});

test('startup remains on the login screen with compact manual login actions', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);
  assert.match(source, /function showLoginScreen\(\)/u);
  assert.match(source, /function configureLoginActions\(\)/u);
  assert.match(source, /function installStartupLoginGuard\(\)/u);
  assert.match(source, /function keepStartupOnLoginScreen\(\)/u);
  assert.match(source, /let loginSubmission = null/u);
  assert.match(source, /登录进入工作台/u);
  assert.match(source, /切换账号/u);
  assert.match(source, /forceLoginPanel\(\)/u);
  assert.doesNotMatch(source, /window\.showPanel/u);
  assert.doesNotMatch(source, /attributeFilter:\s*\['class', 'style'\]/u);
  assert.doesNotMatch(source, /if \(currentStatus\.authenticated\) await enterDashboard\(currentStatus\)/u);
  assert.match(source, /if \(loginSubmission\) return loginSubmission/u);
  assert.match(source, /installStartupLoginGuard\(\);/u);
  assert.match(style, /\.login-action-row\s*\{/u);
  assert.match(style, /grid-template-columns:\s*minmax\(108px, 0\.8fr\) minmax\(0, 1\.35fr\)/u);
  assert.match(style, /\.remote-server-entry\s*\{/u);
  assert.match(style, /body\.auth-login-required #dashboardView\{display:none!important\}/u);
});

test('post-login uses the v0.1.3 compatibility dashboard flow', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /getElementById\('loginView'\)\?\.classList\.add\('hidden'\)/u);
  assert.match(source, /getElementById\('dashboardView'\)\?\.classList\.remove\('hidden'\)/u);
  assert.match(source, /await window\.loadDatabase\(\)/u);
  assert.match(source, /window\.renderOverview\(\)/u);
  assert.match(source, /removeLegacyTrialArtifacts\(\);/u);
  assert.match(source, /title\.parentElement\?\.parentElement\?\.parentElement/u);
  assert.doesNotMatch(source, /function setAppViewVisibility\(id, visible\)/u);
});

test('dashboard shell keeps the v0.1.3 sidebar dimensions', async () => {
  const style = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(style, /\.app-sidebar\s*\{[^}]*width:\s*250px/su);
  assert.match(style, /\.sidebar-footer\s*\{[^}]*background-color:\s*var\(--bg-sidebar-footer\)/su);
});
