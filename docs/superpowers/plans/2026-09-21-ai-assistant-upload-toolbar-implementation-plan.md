# AI 助理图标式上传工具栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 助理现有的大文字“添加文件”入口替换为上传文件、上传图片、扫描材料三个紧凑图标按钮，并改善附件等待卡片。

**Architecture:** 保留现有 `selectAiAssistantFiles` IPC 和 `AiFileTaskService` 分析流程，只给选择请求增加 `selectionKind`，由主进程决定文件筛选器。渲染层负责生成三按钮工具栏、按钮忙碌状态和附件卡；CSS 只作用于 AI 悬浮窗。

**Tech Stack:** Electron、Node.js、原生 JavaScript、HTML/SVG、CSS、Node Test Runner

**项目约束：** 本次只运行开发模式和测试；不提交 Git、不打包、不安装、不修改正式数据。

---

### Task 1: 为三个入口提供准确的文件筛选器

**Files:**
- Modify: `app/src/main/ai-file-task-service.js:217-232`
- Test: `app/tests/main/ai-file-task-service.test.js`

- [ ] **Step 1: 写入失败测试**

新增测试，使用记录 `showOpenDialog` 参数的假对话框，分别调用：

```js
await service.selectAndAnalyze({ conversationId: 'c1', selectionKind: 'file' });
await service.selectAndAnalyze({ conversationId: 'c1', selectionKind: 'image' });
await service.selectAndAnalyze({ conversationId: 'c1', selectionKind: 'scan' });
```

断言标题分别为“上传文件”“上传图片”“选择扫描材料”，图片筛选器不包含 Excel，普通文件筛选器不包含图片，扫描材料同时支持 PDF 与图片。

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --test tests/main/ai-file-task-service.test.js`  
Expected: 新增的筛选器断言失败。

- [ ] **Step 3: 增加筛选配置**

在 `ai-file-task-service.js` 增加：

```js
const FILE_SELECTIONS = Object.freeze({
  file: { title: '上传文件', name: 'Word、PDF、Excel 和文本', extensions: ['xlsx', 'xls', 'csv', 'docx', 'pdf', 'txt'] },
  image: { title: '上传图片', name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
  scan: { title: '选择扫描材料', name: '扫描版 PDF 或图片', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] },
});
```

`selectAndAnalyze()` 接收 `selectionKind`，非法值回到 `file`，分析和归档逻辑保持不变。

- [ ] **Step 4: 运行主进程测试**

Run: `node --test tests/main/ai-file-task-service.test.js`  
Expected: PASS。

---

### Task 2: 将单一文字按钮替换成三按钮图标工具栏

**Files:**
- Modify: `app/src/renderer/js/ai-settings-ui.js:1169-1213,1537-1550`
- Test: `app/tests/renderer/ai-settings-ui.test.js`

- [ ] **Step 1: 写入渲染层结构测试**

断言源码包含三个稳定入口：

```js
assert.match(source, /data-ai-attachment-kind="file"/u);
assert.match(source, /data-ai-attachment-kind="image"/u);
assert.match(source, /data-ai-attachment-kind="scan"/u);
assert.match(source, /上传文件/u);
assert.match(source, /上传图片/u);
assert.match(source, /扫描材料/u);
assert.doesNotMatch(source, /先识别和核对，确认后才导入/u);
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --test tests/renderer/ai-settings-ui.test.js`  
Expected: 三入口断言失败。

- [ ] **Step 3: 实现图标按钮和独立忙碌状态**

把 `selectAssistantFiles()` 改为接收 `selectionKind`，调用：

```js
api.selectAiAssistantFiles({ conversationId, selectionKind });
```

工具栏由配置数组生成。每个按钮包含内联 SVG、`<span>` 中文标签和对应 `data-ai-attachment-kind`。处理中仅禁用三个入口并在被点击按钮上显示“选择中”或“识别中”，结束后恢复原图标和文字。

- [ ] **Step 4: 改造附件等待卡**

附件卡增加类型图标、短文件名、中文状态和移除按钮；图片在存在安全预览地址时显示缩略图。移除按钮只更新 `pendingAttachments`，不删除电子档案原件。

- [ ] **Step 5: 运行渲染层测试**

Run: `node --test tests/renderer/ai-settings-ui.test.js`  
Expected: PASS。

---

### Task 3: 完成视觉样式、动效和窄窗口适配

**Files:**
- Modify: `app/src/renderer/foundation/assistant-extension.css:60-67`
- Test: `app/tests/renderer/ai-settings-ui.test.js`

- [ ] **Step 1: 增加样式断言**

断言 CSS 包含 `ai-attachment-tool-button`、`ai-attachment-icon`、`ai-attachment-chip`、`translateY(-1px)`、横向溢出处理和 `prefers-reduced-motion`。

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --test tests/renderer/ai-settings-ui.test.js`  
Expected: 新样式断言失败。

- [ ] **Step 3: 编写限定在悬浮 AI 窗口内的 CSS**

实现三列等宽布局、54–58 像素按钮、20 像素线性图标、11–12 像素中文标签、浅绿色主入口、悬停上移和按压缩放。附件卡采用紧凑横向布局，并对长文件名使用省略号。

- [ ] **Step 4: 运行相关测试与语法检查**

Run:

```bash
node --check src/renderer/js/ai-settings-ui.js
node --test tests/main/ai-file-task-service.test.js tests/renderer/ai-settings-ui.test.js tests/preload/ipc-contract.test.js
```

Expected: 全部 PASS。

---

### Task 4: 全量回归与开发版查看

**Files:**
- Verify only: existing App source and development configuration

- [ ] **Step 1: 运行完整 App 测试**

Run: `npm --prefix app test`  
Expected: 全部测试通过。

- [ ] **Step 2: 验证开发模式热更新**

Run: `node scripts/check-development.mjs`  
Expected: CSS 更新保留窗口、渲染进程刷新、preload 和主进程自动重启均为 `ok: true`。

- [ ] **Step 3: 在正在运行的开发版核对界面**

确认三个入口图标清楚、文字不放大、输入框与发送按钮无遮挡、附件可移除。开发数据继续使用 `app/.dev/user-data`。
