# GitHub 本机更新同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在没有公网账号服务时发布 GitHub 安装包，并将更新 ZIP 同步到本机或局域网账号服务，提示已安装客户端更新。

**Architecture:** 发布脚本将 GitHub Release 与后端同步解耦：GitHub 发布始终执行，只有三项后端配置齐全时才同步后端。独立本机同步脚本下载 GitHub 更新 ZIP 并调用既有的后端版本发布接口；客户端继续通过本机后端检查与下载更新。

**Tech Stack:** Node.js 20、GitHub CLI、GitHub Actions、Express 更新接口、Node 测试框架。

---

### Task 1: 允许 GitHub-only 发布

**Files:**
- Modify: `scripts/release-sync.mjs`
- Modify: `tests/scripts/publish-desktop-update-workflow.test.mjs`

- [ ] **Step 1: 写失败测试**

在测试文件增加：

```js
test('release sync publishes GitHub assets even when backend configuration is absent', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'scripts', 'release-sync.mjs'), 'utf8');
  assert.match(source, /function hasBackendPublishConfig\(\)/u);
  assert.match(source, /if \(hasBackendPublishConfig\(\)\)/u);
  assert.match(source, /backendSynced: false/u);
});
```

- [ ] **Step 2: 验证失败**

运行 `node --test tests/scripts/publish-desktop-update-workflow.test.mjs`，预期失败并提示缺少 `hasBackendPublishConfig`。

- [ ] **Step 3: 最小实现**

在 `scripts/release-sync.mjs` 定义 `hasBackendPublishConfig()`，仅当 `COMMUNITY_AI_BACKEND_URL`、`COMMUNITY_AI_BACKEND_ADMIN_PHONE`、`COMMUNITY_AI_BACKEND_ADMIN_PASSWORD` 均存在时调用 `publishToBackend()`；GitHub Release 创建与资产上传始终执行。最终结果输出需包含：

```js
backendVersion: backendRelease?.latestVersion || null,
backendSynced: Boolean(backendRelease),
```

- [ ] **Step 4: 验证通过并提交**

运行 `node --test tests/scripts/publish-desktop-update-workflow.test.mjs`，预期通过。随后：

```bash
git add scripts/release-sync.mjs tests/scripts/publish-desktop-update-workflow.test.mjs
git commit -m "feat: allow GitHub-only update releases"
```

### Task 2: 增加本机更新包同步命令

**Files:**
- Create: `scripts/sync-local-update.mjs`
- Modify: `app/package.json`
- Modify: `tests/scripts/publish-desktop-update-workflow.test.mjs`

- [ ] **Step 1: 写失败测试**

在测试文件增加：

```js
test('local update sync downloads the release zip and publishes it to the configured backend', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'scripts', 'sync-local-update.mjs'), 'utf8');
  assert.match(source, /release.*download/u);
  assert.match(source, /\/api\/auth\/login/u);
  assert.match(source, /\/api\/update\/publish/u);
  assert.match(source, /COMMUNITY_AI_BACKEND_URL/u);
});
```

- [ ] **Step 2: 验证失败**

运行 `node --test tests/scripts/publish-desktop-update-workflow.test.mjs`，预期失败并提示同步脚本不存在。

- [ ] **Step 3: 最小实现**

创建 `scripts/sync-local-update.mjs`：版本默认为 `app/package.json` 的版本；发布 `0.3.13` 时下载 `v0.3.13` 的 `community-ai-management-system-0.3.13-arm64.zip`；使用 `COMMUNITY_AI_BACKEND_URL`（默认 `http://127.0.0.1:3000`）与必填管理员账号密码登录；用 `FormData` 上传 ZIP 到 `/api/update/publish`；最后访问 `/api/update/check?version=0.0.0&platform=darwin-arm64&channel=stable` 并断言返回版本相同。

在 `app/package.json` 增加：

```json
"release:sync-local": "node ../scripts/sync-local-update.mjs"
```

- [ ] **Step 4: 验证通过并提交**

运行 `node --test tests/scripts/publish-desktop-update-workflow.test.mjs`，预期通过。随后：

```bash
git add scripts/sync-local-update.mjs app/package.json tests/scripts/publish-desktop-update-workflow.test.mjs
git commit -m "feat: add local update package synchronization"
```

### Task 3: 发布并同步 0.3.13

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `docs/releases/0.3.13.md`

- [ ] **Step 1: 升级版本与发行说明**

将两个版本文件从 `0.3.12` 改为 `0.3.13`，并创建：

```md
# 0.3.13

- GitHub 可独立生成和发布 macOS 安装包与更新 ZIP。
- 本机或局域网账号服务可同步 GitHub 更新包，使已安装客户端提示并下载更新。
```

- [ ] **Step 2: 运行验证**

```bash
node scripts/verify-release-inputs.mjs
npm --prefix app test
npm --prefix backend test
```

预期：发行说明与全部测试通过。

- [ ] **Step 3: 创建发布标签**

```bash
git add app/package.json app/package-lock.json docs/releases/0.3.13.md
git commit -m "release: prepare v0.3.13"
git push origin HEAD
git tag -a v0.3.13 -m "社区AI管理系统 v0.3.13"
git push origin v0.3.13
```

- [ ] **Step 4: 核对云端资产与本机提示记录**

等待 GitHub Actions 成功后，在本机管理员账号和密码已作为环境变量提供给同步命令的终端中运行 `npm --prefix app run release:sync-local`。

预期：Release 包含 DMG、更新 ZIP、`latest-mac.yml`；本机后端返回 `latestVersion: "0.3.13"`，低版本客户端检查更新时出现提示。
