# 居民登记信息紧凑版 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Electron/Foundation 居民编辑界面中落地 A 方案，让账户、发放、操作和来源记录更紧凑、更易读，同时保留原始编码详情、现有数据接口和编辑流程。

**Architecture:** 新增一个无副作用的居民记录展示适配器，统一处理来源、状态、日期、账户和操作文字；现有居民档案渲染器只负责组合界面和事件。Foundation 编辑器与旧版资金工作区按现有脚本加载机制共享该适配器，CSS 继续放在各自已经加载的样式文件中，避免替换运行时或业务模型。

**Tech Stack:** Electron 31、Foundation Vue runtime、原生 JavaScript/IIFE、Node `node:test`、现有 `contract-fee-model.js` 数据模型。

---

## 文件与职责

| 文件 | 变更职责 |
| --- | --- |
| `app/src/shared/resident-record-presentation.js` | 新增。提供中文来源/状态/操作名称、日期、账户摘要和详情字段整理；同时支持浏览器全局和 CommonJS 测试引入。 |
| `app/src/renderer/js/resident-subsidy-profile.js` | 使用展示适配器重排居民编辑中的收款账户、费用发放、操作、来源页面；加入折叠详情和统一紧凑分页。 |
| `app/src/renderer/foundation/resident-editor.mjs` | Foundation 编辑器加载居民展示适配器后再加载居民资料脚本，保证新增渲染器在新版模板中可用。 |
| `app/src/renderer/js/contract-fee-workspace.js` | 旧版资金工作区加载居民资料脚本前先加载展示适配器，保持旧入口兼容。 |
| `app/src/renderer/css/contract-fee-workspace.css` | 旧版编辑弹窗的紧凑表格、详情折叠、分页和响应式布局。 |
| `app/src/renderer/foundation/foundation.css` | Foundation 编辑弹窗的对应样式，限定在 `.resident-editor-extras` 下。 |
| `app/tests/shared/resident-record-presentation.test.js` | 展示适配器的纯函数测试。 |
| `app/tests/renderer/resident-subsidy-profile.test.js` | 居民资料脚本的结构、详情入口、中文字段和分页行为约束。 |
| `app/tests/renderer/contract-fee-workspace.test.js` | 旧版脚本加载顺序和样式资源约束。 |

### Task 1: 建立统一的居民记录展示适配器

**Files:**
- Create: `app/src/shared/resident-record-presentation.js`
- Create: `app/tests/shared/resident-record-presentation.test.js`

- [ ] **Step 1: 写展示适配器失败测试**

测试通过 CommonJS 引入适配器，覆盖来源、批次、状态、日期、账户和未知值保留：

```js
const presentation = require('../../src/shared/resident-record-presentation.js');

test('把来源编码转换为中文名称并保留原始值', () => {
  assert.equal(presentation.sourceLabel('farmland_subsidy_import'), '土地补贴导入');
  assert.equal(presentation.sourceLabel('disbursement_import'), '发放记录导入');
  assert.equal(presentation.sourceLabel('workbench-c7627b2a'), '工作台发放');
  assert.equal(presentation.sourceLabel('new-source'), '其他来源');
  assert.equal(presentation.sourceDetail('new-source'), 'new-source');
});

test('把日期和费用状态转换为稳定的业务显示文本', () => {
  assert.equal(presentation.dateLabel('2026年09月06日'), '2026-09-06');
  assert.equal(presentation.dateLabel('2026-09-06T23:14:00Z'), '2026-09-06');
  assert.equal(presentation.dateLabel(''), '未填写');
  assert.equal(presentation.paymentStatusLabel('paid'), '已发放');
  assert.equal(presentation.paymentStatusLabel('pending'), '未发放');
});

test('费用记录和操作记录提供可读摘要', () => {
  const payment = { categoryName: '固定工资', role: '东二组组长', amountCents: 240000, bankName: '交通银行', bankCard: '6222000000000731', batchId: 'workbench-c7627b2a' };
  assert.equal(presentation.paymentItemLabel(payment), '固定工资 · 东二组组长');
  assert.equal(presentation.accountLabel(payment), '交通银行 · 尾号0731');
  assert.equal(presentation.operationLabel({ type: 'resident_phone_update', object: { name: '陆敬辉' }, before: { phone: '无' }, after: { phone: '13800000000' } }), '修改联系电话');
});
```

- [ ] **Step 2: 运行测试确认适配器尚不存在**

Run: `npm --prefix app test -- tests/shared/resident-record-presentation.test.js`

Expected: FAIL，提示 `Cannot find module ... resident-record-presentation.js` 或导出函数不存在。

- [ ] **Step 3: 实现无副作用的 UMD 适配器**

实现以下公开函数并保持未知原始值可追溯：

```js
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ResidentRecordPresentation = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const sourceNames = {
    farmland_subsidy_import: '土地补贴导入',
    disbursement_import: '发放记录导入',
    resident_profile: '居民档案',
    resident_profile_edit: '居民资料编辑',
  };
  const statusNames = { paid: '已发放', completed: '已完成', pending: '未发放', failed: '未执行', cancelled: '已取消', undone: '已撤销' };
  const text = value => String(value ?? '').trim();
  const dateLabel = value => {
    const raw = text(value);
    const match = raw.match(/(19|20)\\d{2}[^0-9]?(\\d{1,2})[^0-9]?(\\d{1,2})/u);
    return match ? `${match[1]}${raw.match(/(19|20)\\d{2}/u)[0].slice(2)}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : (raw ? raw.slice(0, 10) : '未填写');
  };
  const sourceLabel = value => {
    const raw = text(value);
    if (sourceNames[raw]) return sourceNames[raw];
    if (raw.startsWith('workbench-')) return '工作台发放';
    if (raw.startsWith('template-disbursement-batch-')) return '模板发放';
    return raw ? '其他来源' : '居民档案';
  };
  const sourceDetail = value => text(value) || '未记录原始来源';
  const paymentStatusLabel = value => statusNames[text(value)] || (text(value) ? text(value) : '未填写');
  const paymentItemLabel = item => [text(item?.categoryName || item?.category), text(item?.workItem || item?.role || item?.responsibilityArea || item?.remark || item?.period)].filter(Boolean).join(' · ') || '其他发放';
  const accountLabel = item => { const bank = text(item?.bankName || item?.bank); const card = text(item?.bankCard || item?.cardNumber); return card ? `${bank || '收款账户'} · 尾号${card.slice(-4)}` : '未设置'; };
  const operationLabel = item => ({ resident_phone_update: '修改联系电话', resident_address_update: '修改家庭地址', resident_group_update: '调整村民组', disbursement_import: '导入发放记录', farmland_subsidy_import: '导入土地补贴记录' }[text(item?.type)] || text(item?.action) || '资料更新');
  const operationResultLabel = item => statusNames[text(item?.status)] || (text(item?.status) ? text(item.status) : '已完成');
  const batchLabel = value => { const raw = text(value); if (raw.startsWith('workbench-')) return '工作台发放'; if (raw.startsWith('template-disbursement-batch-')) return '模板发放'; return raw ? '历史发放批次' : '未记录批次'; };
  return { dateLabel, sourceLabel, sourceDetail, paymentStatusLabel, paymentItemLabel, accountLabel, operationLabel, operationResultLabel, batchLabel };
});
```

- [ ] **Step 4: 运行适配器测试确认通过**

Run: `npm --prefix app test -- tests/shared/resident-record-presentation.test.js`

Expected: PASS，全部展示函数测试通过。

### Task 2: 在两个渲染入口按正确顺序加载适配器

**Files:**
- Modify: `app/src/renderer/foundation/resident-editor.mjs:13-15`
- Modify: `app/src/renderer/js/contract-fee-workspace.js:1489-1493`
- Test: `app/tests/renderer/contract-fee-workspace.test.js`

- [ ] **Step 1: 增加加载顺序约束测试**

在现有脚本测试中增加以下断言，确保居民脚本前出现适配器脚本：

```js
const helperIndex = script.indexOf('resident-record-presentation.js');
const profileIndex = script.indexOf('resident-subsidy-profile.js');
assert.ok(helperIndex >= 0 && helperIndex < profileIndex, '旧版入口必须先加载居民记录展示适配器');
```

- [ ] **Step 2: 修改 Foundation 加载链**

将 `resident-editor.mjs` 的 ready 加载链改成：

```js
loadScript('../shared/contract-fee-model.js')
  .then(() => loadScript('../shared/resident-record-presentation.js'))
  .then(() => loadScript('js/resident-subsidy-profile.js'))
```

- [ ] **Step 3: 修改旧版动态加载链**

在 `contract-fee-workspace.js` 的 `init` 中只在未加载时串行追加两个脚本，第二个脚本等待第一个 `load` 事件成功后再追加；加载失败时移除失败节点并通过现有 `notify` 显示“居民资料展示组件加载失败”。不改变 `root.communityFoundation` 分支。

- [ ] **Step 4: 运行入口结构测试**

Run: `npm --prefix app test -- tests/renderer/contract-fee-workspace.test.js tests/renderer/resident-subsidy-profile.test.js`

Expected: PASS，旧版和 Foundation 的加载顺序断言通过。

### Task 3: 重排居民记录内容并加入可展开详情

**Files:**
- Modify: `app/src/renderer/js/resident-subsidy-profile.js:66-120`
- Modify: `app/src/renderer/js/resident-subsidy-profile.js:327-390`
- Test: `app/tests/renderer/resident-subsidy-profile.test.js`

- [ ] **Step 1: 为居民资料脚本增加结构断言**

在现有脚本测试中要求出现以下稳定选择器和中文列名：

```js
for (const selector of ['resident-record-details', 'resident-payment-status', 'resident-operation-result', 'resident-source-label', 'resident-record-pagination']) assert.match(script, new RegExp(selector, 'u'));
for (const label of ['发放日期', '事项', '发放金额', '收款账户', '状态', '资料来源', '关联记录', '变更说明', '查看详情']) assert.match(script, new RegExp(label, 'u'));
assert.match(script, /ResidentRecordPresentation\.sourceLabel/u);
assert.match(script, /ResidentRecordPresentation\.paymentItemLabel/u);
assert.match(script, /ResidentRecordPresentation\.operationLabel/u);
```

- [ ] **Step 2: 添加详情片段生成函数**

在 `resident-subsidy-profile.js` 内新增纯字符串函数，将完整编码放进原生 `details/summary`，不把原始值放进表格主列：

```js
function recordDetails(items) {
  const rows = Object.entries(items).filter(([, value]) => text(value));
  if (!rows.length) return '';
  return `<details class="resident-record-details"><summary>查看详情</summary><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>`;
}
```

- [ ] **Step 3: 重写费用发放表格和筛选区**

`paymentRecordsContent` 使用适配器生成五列：日期、事项、金额、收款账户、状态。事项单元格内追加 `recordDetails({ 发放批次: batchLabel, 原始批次号: item.batchId, ... })`；收款账户使用 `accountLabel`；金额仍使用现有 `money`。分页调用统一的 `pagination(filtered.length, page, pageSize, 'payment')`。

- [ ] **Step 4: 重写操作记录和来源记录**

操作记录主表只显示时间、操作、结果、操作人；操作单元格用 `operationLabel`，结果使用 `operationResultLabel`，详情中显示 sourceType、batchId、recordId、description 和 changedFields。只有记录明确带有现有 `recoverable === true`、`status === 'completed'` 和可用的撤销入口时才显示“撤销”；没有恢复快照的历史记录只显示“此记录不可撤销”，不伪造恢复。

来源记录主表显示资料来源、关联记录、导入时间、变更说明；资料来源使用 `sourceLabel`，关联记录显示可读摘要，完整 recordId/batchId 放详情。未知来源显示“其他来源”并在详情中保留原值。

- [ ] **Step 5: 统一分页 HTML 和分页状态**

将现有 `pagination` 输出收敛为一个 `.resident-record-pagination`：

```html
<div class="resident-record-pagination" aria-label="记录分页">
  <span>共 N 条</span><label>每页 <select>10</select> 条</label>
  <button aria-label="上一页">‹</button><span>1/1</span><button aria-label="下一页">›</button>
</div>
```

保留现有 `data-resident-operation-page-size`、`data-resident-payment-page-size` 和页码事件委托，避免改变数据读取和缓存逻辑。

- [ ] **Step 6: 运行居民资料结构测试**

Run: `npm --prefix app test -- tests/renderer/resident-subsidy-profile.test.js`

Expected: PASS，脚本包含中文列名、详情、来源适配器和统一分页选择器。

### Task 4: 应用 A 方案紧凑布局与切换动画

**Files:**
- Modify: `app/src/renderer/css/contract-fee-workspace.css:94-152`
- Modify: `app/src/renderer/foundation/foundation.css:39-63`

- [ ] **Step 1: 先增加 CSS 结构测试断言**

在 `resident-subsidy-profile.test.js` 读取两个样式文件并断言存在 `.resident-record-pagination`、`.resident-record-details`、`.resident-profile-body` 的紧凑规则和 `@media` 规则。

- [ ] **Step 2: 调整旧版编辑弹窗样式**

在现有居民样式后增加以下规则，保留原有变量和主题：

```css
.resident-profile-body .resident-profile-section { gap: 8px; }
.resident-profile-body .cf-table { table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.resident-profile-body .cf-table th, .resident-profile-body .cf-table td { padding: 7px 8px; vertical-align: middle; line-height: 1.35; }
.resident-profile-body .resident-record-details { margin-top: 4px; font-size: 11px; }
.resident-profile-body .resident-record-details summary { color: var(--primary); cursor: pointer; list-style: none; }
.resident-profile-body .resident-record-details summary::before { content: '›'; display: inline-block; margin-right: 3px; transition: transform .18s ease; }
.resident-profile-body .resident-record-details[open] summary::before { transform: rotate(90deg); }
.resident-profile-body .resident-record-details dl { display: grid; gap: 3px; margin: 6px 0 0; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-body); }
.resident-profile-body .resident-record-details dl div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; }
.resident-profile-body .resident-record-details dt { color: var(--text-secondary); }
.resident-profile-body .resident-record-details dd { margin: 0; overflow-wrap: anywhere; }
.resident-record-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 4px; color: var(--text-secondary); font-size: 11px; }
.resident-record-pagination select, .resident-record-pagination button { min-height: 28px; padding: 3px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-card); color: var(--text-primary); }
.resident-record-pagination button:not(:disabled):hover { color: var(--primary); border-color: var(--primary); }
.resident-record-pagination button:disabled { opacity: .45; cursor: not-allowed; }
.resident-profile-embedded, .resident-editor-extras .resident-profile-body { scrollbar-gutter: stable; }
```

- [ ] **Step 3: 同步 Foundation 样式并保留响应式布局**

把相同语义的规则放进 `.resident-editor-extras` 作用域，收紧 Foundation 原来 `12px` 的表格间距；在宽度小于 `720px` 时让详情 `<dl>` 单列、分页允许换行，账户卡和筛选区继续使用现有媒体查询。

- [ ] **Step 4: 验证样式结构**

Run: `npm --prefix app test -- tests/renderer/resident-subsidy-profile.test.js`

Expected: PASS，旧版和 Foundation 样式结构断言通过。

### Task 5: 回归测试与实际开发窗口验收

**Files:**
- Modify: `app/tests/renderer/foundation-scenarios.mjs`
- Modify: `app/tests/renderer/resident-subsidy-profile.test.js`（如需补充断言）

- [ ] **Step 1: 增加合成居民记录场景**

在 Foundation 场景打开居民编辑的 `sec_accounts` 后，切换到 `sec_payments`、`sec_operations`、`sec_sources`，断言每个区只有一个 `.resident-record-pagination`，主表不直接显示 `workbench-`、`farmland_subsidy_import`，点击 `查看详情` 后才出现原始批次或来源值。

- [ ] **Step 2: 运行针对性自动化测试**

Run: `npm --prefix app test -- tests/shared/resident-record-presentation.test.js tests/renderer/resident-subsidy-profile.test.js tests/renderer/contract-fee-workspace.test.js`

Expected: PASS。

- [ ] **Step 3: 运行完整测试**

Run: `npm --prefix app test`

Expected: 全部测试通过；现有保存、账户、导入、资金发放和 AI 相关测试不受影响。

- [ ] **Step 4: 在 macOS 开发模式中进行人工验收**

运行 `npm run dev`，打开“村民一户一档”，进入一名居民的“编辑信息”：

1. 点击左侧“费用发放记录”，确认五列紧凑显示，事项、收款账户、状态为中文。
2. 点击“操作记录”和“来源与更正记录”，确认分页各出现一次，编码只在“查看详情”展开后显示。
3. 连续切换栏目，确认淡入/横向滑动不中断，左侧只有当前栏目高亮。
4. 修改联系电话并保存，确认仍能保存且不出现 `An object could not be cloned.`。
5. 返回居民列表翻页和滚动，确认没有触发整页刷新。

- [ ] **Step 5: 完成工作区检查**

Run: `git status --short` and `git diff --check`。

Expected: 只包含本次居民记录 UI 计划涉及的文件和用户已有工作区改动；无空白错误。按照项目协作约定，不自动提交或上传 GitHub。

