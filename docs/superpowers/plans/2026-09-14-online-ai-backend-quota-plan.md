# 在线 AI 后端网关与单位 Token 额度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面端在线 AI 改为通过现有账号后端调用，并为每个单位增加永久有效、用完即止、可购买追加的共享 Token 额度。

**Architecture:** 保留本地 AI 和现有 AI 助理业务流程；仅把 `AiRouter` 的在线分支改为使用现有 `RemoteAuthService` 的 Bearer 会话请求后端 `/api/ai`。后端用单位级额度账户和不可变额度流水包住 Provider 调用，在请求前预留、成功后按实际 Token 结算、失败时释放。桌面端只显示额度和用量，不再保存或编辑在线供应商密钥。

**Tech Stack:** Node.js CommonJS、Express 4、现有 JSON 后端数据库、JWT Bearer 认证、Electron IPC/contextBridge、Vue 运行时扩展（`settings-panels.mjs`）、原生后端管理 HTML。

---

## 文件地图

- Create: `backend/src/services/aiQuotaService.js` — 单位额度账户、预留、结算、流水和可见范围查询。
- Create: `backend/src/routes/adminAiRoutes.js` — 平台管理员的默认额度、单位额度和充值/调整接口。
- Modify: `backend/src/database.js` — 新增额度集合、默认配置和旧数据兼容初始化。
- Modify: `backend/src/config.js`、`backend/.env.example` — 新单位默认 Token 配置。
- Modify: `backend/src/services/aiService.js` — 在 Provider 调用外接入额度预留与实际结算，并把单位信息写入用量记录。
- Modify: `backend/src/routes/aiRoutes.js` — 增加用户可见额度、流水和分页用量接口。
- Modify: `backend/src/index.js` — 挂载管理员 AI 路由。
- Modify: `backend/src/admin/index.html`、`backend/src/admin/tenant-management.js` — 后台显示单位额度、设置默认值和追加额度。
- Create: `backend/tests/ai-quota-service.test.js` — 额度账户与并发结算单元测试。
- Modify: `backend/tests/admin-console.test.js` 或 Create: `backend/tests/ai-quota-routes.test.js` — 后端接口和管理员权限测试。
- Modify: `app/src/main/ai-router.js` — 在线请求改走后端，保留本地/自动模式。
- Modify: `app/src/main/ipc-handlers.js`、`app/src/preload/index.js`、`app/src/shared/ipc-contract.js` — 增加额度摘要、明细和后端在线测试的安全桥接。
- Modify: `app/src/main/ai-settings-store.js` — 保留本地设置，加入一次性旧在线配置迁移与清理。
- Modify: `app/src/main/index.js` — 将 `authService` 传给 `AiRouter`，不再把在线 Provider 配置作为桌面端调用依赖。
- Modify: `app/src/renderer/foundation/settings-panels.mjs` — 移除在线地址/模型/密钥输入，加入后端状态、额度卡片和用量明细。
- Modify: `app/src/renderer/foundation/foundation.css` — 额度卡片、进度状态和明细表样式。
- Modify: `app/tests/main/ai-router.test.js`、`app/tests/main/ai-settings-store.test.js` — 后端在线路由和旧配置迁移测试。
- Create: `app/tests/renderer/ai-quota-panel.test.js` — 额度卡片、余额不足和明细显示测试。
- Regenerate: `app/src/renderer/foundation/vendor/assets/foundation-runtime.mjs` — 仅通过现有 `scripts/dev/foundation.mjs` 刷新，不手工编辑生成文件。

## Task 1: 建立后端额度模型和原子扣减服务

**Files:**
- Create: `backend/src/services/aiQuotaService.js`
- Modify: `backend/src/database.js`
- Modify: `backend/src/config.js`
- Modify: `backend/.env.example`
- Test: `backend/tests/ai-quota-service.test.js`

- [ ] **Step 1: Write failing tests for default allocation, permanent balance and ledger history**

覆盖以下行为：为新单位初始化默认额度；购买额度增加余额但不清除已用量；人工减少不能让余额小于零；流水包含类型、数量、操作人和原因；没有额度的单位返回余额为零。

测试命令：

```bash
npm --prefix backend test -- --test-name-pattern="额度"
```

预期：新增测试在服务尚未实现时失败。

- [ ] **Step 2: Add collections and default configuration without changing existing records**

在 `DEFAULT_DATA` 增加 `ai_quotas`、`ai_quota_ledger` 集合；在 `config.ai` 增加 `defaultQuotaTokens`，读取 `AI_DEFAULT_QUOTA_TOKENS`，默认值由配置决定而不是桌面端写死。`ensureDefaultData()` 只为已有组织补建缺失额度账户，不重写已有账户余额。

- [ ] **Step 3: Implement the quota service API**

实现下列明确接口：

```js
ensureOrganizationQuota(organizationId)
getQuotaSummary(organizationId)
listQuotaLedger(organizationId, options)
grantInitialQuota(organizationId, tokens, actorId, reason)
adjustQuota(organizationId, tokens, actorId, reason, type)
reserve(organizationId, requestId, estimatedTokens, userId)
settle(organizationId, requestId, actualTokens, metadata)
release(organizationId, requestId, reason)
```

每个写操作必须在内存数据库的同一同步调用链中先检查余额、写账户和写流水；通过 `request_id` 去重，重复预留/结算不能再次扣减。`settle` 只允许把预留额度结算为实际扣减并退回差额；`release` 将未结算预留归还余额。

- [ ] **Step 4: Run the focused quota tests**

```bash
npm --prefix backend test -- --test-name-pattern="额度"
```

预期：额度服务测试全部通过。

## Task 2: 把后端 Provider 调用接入单位额度

**Files:**
- Modify: `backend/src/services/aiService.js`
- Modify: `backend/src/routes/aiRoutes.js`
- Test: `backend/tests/ai-quota-service.test.js`
- Test: `backend/tests/ai-quota-routes.test.js`

- [ ] **Step 1: Add failing tests for quota guard around successful and failed AI calls**

使用可注入的 HTTP 传输或本地测试 Provider，验证：余额不足时 Provider 不被调用；成功响应按返回的 `usage.total_tokens` 扣减；超时/非 200/解析失败释放预留；两个账号共享同一单位余额；相同请求编号不会重复扣费。

- [ ] **Step 2: Add organization and charged-token fields to AI usage records**

`aiService.chat(userId, options)` 先通过账号找到组织，生成或接收 `requestId`，调用 `aiQuotaService.reserve()`；现有 `recordUsage()` 增加 `organization_id`、`charged_tokens`、`charge_source`、`request_id`。保留现有 Provider 选择、加密密钥和模型逻辑。

- [ ] **Step 3: Settle or release quota on every Provider outcome**

非流式请求在响应结束时读取 `usage.total_tokens` 并调用 `settle()`；供应商没有返回用量时使用后端保守估算值并标记 `charge_source: 'estimated'`。网络错误、超时、取消和 JSON 解析错误调用 `release()`，再记录失败用量。

流式接口沿用当前 SSE 转发，在收到结束事件后结算；连接中断时释放尚未结算的预留，并记录失败原因。

- [ ] **Step 4: Add user-visible quota and usage endpoints**

在 `aiRoutes.js` 增加：

```text
GET /api/ai/quota
GET /api/ai/quota/ledger?page=1&pageSize=20
GET /api/ai/usage/detail?page=1&pageSize=20&accountId=&model=&status=
```

单位管理员可读取本单位范围，普通成员只返回自己的明细；任何响应都使用中文字段标签需要的稳定 JSON 字段，不返回 API 密钥。

- [ ] **Step 5: Run backend AI and quota tests**

```bash
npm --prefix backend test
```

预期：新增额度测试和原有后端测试全部通过。

## Task 3: 增加平台管理员额度管理和充值流水

**Files:**
- Create: `backend/src/routes/adminAiRoutes.js`
- Modify: `backend/src/index.js`
- Modify: `backend/src/admin/index.html`
- Modify: `backend/src/admin/tenant-management.js`
- Test: `backend/tests/ai-quota-routes.test.js`

- [ ] **Step 1: Write failing authorization and API tests**

验证平台管理员可以查看单位额度、设置新单位默认值、为指定单位追加购买额度或人工调整；单位管理员和成员访问管理员写接口得到 403；每次调整写入现有审计日志。

- [ ] **Step 2: Implement admin-only routes**

挂载 `/api/admin/ai`，实现：

```text
GET /api/admin/ai/default-quota
PUT /api/admin/ai/default-quota
GET /api/admin/ai/quotas
PUT /api/admin/ai/quotas/:organizationId
POST /api/admin/ai/quotas/:organizationId/grants
GET /api/admin/ai/usage
```

写入请求必须校验 Token 为非负整数、人工减少不超过当前可用余额，并要求中文原因；购买/充值使用正数追加流水。

- [ ] **Step 3: Extend the existing admin page**

在后台导航增加“单位 AI 额度”，页面显示单位、总额度、已使用、预留、剩余和最近使用时间；提供“设置新单位默认额度”和指定单位“购买/追加额度”表单。所有提交成功、余额不足和权限错误使用现有中文提示机制。

- [ ] **Step 4: Run admin route and page regression tests**

```bash
npm --prefix backend test
```

预期：管理员页原有账号、模型、更新和日志功能不受影响，额度接口测试通过。

## Task 4: 把 Electron 在线 AI 切换到后端并迁移旧配置

**Files:**
- Modify: `app/src/main/ai-router.js`
- Modify: `app/src/main/index.js`
- Modify: `app/src/main/ipc-handlers.js`
- Modify: `app/src/main/ai-settings-store.js`
- Modify: `app/src/preload/index.js`
- Modify: `app/src/shared/ipc-contract.js`
- Test: `app/tests/main/ai-router.test.js`
- Test: `app/tests/main/ai-settings-store.test.js`

- [ ] **Step 1: Write failing tests for backend online routing and local fallback**

构造假的 `authService.request()`，验证在线模式请求 `/ai/chat` 并附带登录令牌；自动模式本地模型成功时不访问后端，本地失败且后端可用时访问后端；后端返回额度不足时保留中文错误；没有登录令牌时不尝试直连旧 Provider。

- [ ] **Step 2: Add authenticated backend online client behavior**

将 `AiRouter` 构造函数增加 `authService`；在线分支调用：

```js
await authService.request('/ai/chat', {
  method: 'POST',
  body: { messages },
});
```

返回结构继续归一化为 `{ ok, content, usage, model, provider: 'online' }`，以免 `ai-assistant-service.js` 和公文拟写流程改变。删除在线分支对 `OpenAiCompatibleClient` 和本机 API 密钥的依赖，但保留本地模式。

- [ ] **Step 3: Migrate test-online-ai and model lookup**

`testOnlineAi` 改为后端小请求，前端按钮文案明确“会消耗少量 Token”；模型列表通过 `GET /api/ai/models` 获取。对话调用、测试调用和模型列表都复用 `RemoteAuthService` 的服务器地址和 Bearer 令牌。

- [ ] **Step 4: Add one-time legacy configuration migration**

在 `AiSettingsStore` 增加迁移标记和 `migrateLegacyOnlineSettings()`：保留 `mode`、`localModelPath` 等本地设置；旧 `baseUrl`、`model`、`encryptedApiKey` 仅识别并标记为旧配置，不读取、不发送；完成后安全删除旧在线字段。迁移失败不得删除文件，下一次启动可重试。

- [ ] **Step 5: Wire IPC and run focused Electron tests**

新增 `getAiQuota`、`getAiUsageDetail`、`getAiModels` 等安全桥接方法，禁止渲染进程直接读取密钥。运行：

```bash
npm --prefix app test -- --test-name-pattern="AI|额度|在线"
```

预期：Electron 主进程和设置迁移测试通过。

## Task 5: 在桌面端 AI 页面增加额度和用量统计

**Files:**
- Modify: `app/src/renderer/foundation/settings-panels.mjs`
- Modify: `app/src/renderer/foundation/foundation.css`
- Create: `app/tests/renderer/ai-quota-panel.test.js`
- Regenerate: `app/src/renderer/foundation/vendor/assets/foundation-runtime.mjs`

- [ ] **Step 1: Write failing renderer tests**

用现有渲染测试的最小 DOM/假 API 约定，验证页面出现“单位总额度、已使用 Token、剩余 Token、永久有效、我的使用量”；余额为零时出现“请联系平台管理员购买额度”；明细不显示 Provider ID、请求 ID 或 API 密钥；本地模式显示“不消耗在线 Token”。

- [ ] **Step 2: Replace online provider fields with backend status and quota panel**

在 `installCommunitySettings()` 的 AI 面板中移除在线地址、在线模型和 API 密钥字段，保留本机模型选择与运行方式；增加并行加载 `getAiQuota()`、`getAiUsageDetail()` 和 `getAiModels()` 的状态卡片、进度条和分页明细。后端地址只在现有“社区单位服务”设置中配置。

- [ ] **Step 3: Add readable status and error handling**

把后端错误映射成中文状态：未登录/地址不可达、授权失效、额度不足、服务暂时不可用。余额卡片按充足/较低/用完显示绿色/橙色/红色，并注明额度永久有效。本地 AI 请求不更新在线额度卡片。

- [ ] **Step 4: Refresh the generated foundation runtime**

完成源文件后执行：

```bash
node --input-type=module -e "import('./scripts/dev/foundation.mjs').then(({refreshFoundation})=>refreshFoundation(process.cwd()))"
```

禁止直接编辑 `foundation-runtime.mjs`；刷新后检查生成差异只来自本次 AI 页面调整。

- [ ] **Step 5: Run renderer and full app tests**

```bash
npm --prefix app test
```

预期：额度面板测试和既有 450 项应用测试全部通过。

## Task 6: 开发环境联调、迁移验收和回归

**Files:**
- Modify only if validation exposes a concrete defect in the files above.
- Test: `backend/tests/` and `app/tests/`

- [ ] **Step 1: Start the isolated development environment**

```bash
npm run dev
```

使用开发数据和开发后端，不连接正式数据库；在后端管理页配置一个测试 Provider 和一个测试单位额度。

- [ ] **Step 2: Verify the end-to-end flow without packaging**

按顺序验证：登录 → AI 页面显示单位额度 → 在线对话扣减 Token → 明细出现账号/模型/输入/输出/总 Token → 额度为零时阻止请求 → 平台管理员追加额度 → 同一单位再次可用 → 本地模式不扣额度。

- [ ] **Step 3: Verify legacy migration safety**

使用含旧在线字段的临时开发配置启动一次，确认旧密钥没有出现在网络请求和后端日志中，迁移完成后本地只保留本机模型配置；确认居民档案、资金发放中心和其他工作区数据未被改写。

- [ ] **Step 4: Run final checks**

```bash
node --check backend/src/services/aiQuotaService.js
node --check backend/src/routes/adminAiRoutes.js
node --check app/src/main/ai-router.js
git diff --check
npm --prefix backend test
npm --prefix app test
```

预期：全部通过；不执行 `build`、`package`、安装或版本号修改。用户确认准备发布后，再按项目正式发布流程处理。
