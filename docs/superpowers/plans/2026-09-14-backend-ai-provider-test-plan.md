# 后端 AI 模型连接测试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在模型新增/编辑窗口中提供保存前的后端连接测试，并安全显示中文测试结果。

**Architecture:** 管理页将当前表单参数发送给管理员专用测试接口。`aiService` 合并表单参数和已有服务密钥后，直接调用 OpenAI 兼容的 `/chat/completions`，返回精简结果；该调用绕过单位额度和业务用量记录。

**Tech Stack:** Node.js、Express、原生 HTTP/HTTPS、原生浏览器 JavaScript、Node Test Runner

---

### Task 1: 后端测试接口

**Files:**
- Modify: `backend/tests/admin-console.test.js`
- Modify: `backend/src/services/aiService.js`
- Modify: `backend/src/routes/aiRoutes.js`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/admin-console.test.js` 中启动本机模拟 AI 服务，并验证管理员可测试未保存配置和已有配置：

```js
const mockAi = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer secret-api-key');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    model: body.model,
    choices: [{ message: { content: '连接成功' } }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  }));
});

const tested = await request(url, '/ai/providers/test', {
  token: adminToken,
  method: 'POST',
  body: { providerId: provider.body.provider.id, apiKey: '', defaultModel: 'demo-chat' },
});
assert.equal(tested.status, 200);
assert.equal(tested.body.success, true);
assert.equal(tested.body.totalTokens, 10);
assert.equal(tested.body.reply, '连接成功');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix backend test`

Expected: FAIL，因为 `/api/ai/providers/test` 尚不存在。

- [ ] **Step 3: 实现模型测试服务**

在 `backend/src/services/aiService.js` 中增加：

```js
function chatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const root = url.pathname.replace(/\/+$/u, '');
  url.pathname = `${root}/chat/completions`.replace(/\/{2,}/gu, '/');
  return url;
}

function resolveProviderTestInput({ providerId, baseUrl, apiKey, defaultModel }) {
  const saved = providerId ? db.findById('ai_providers', providerId) : null;
  if (providerId && !saved) {
    const error = new Error('AI 模型服务不存在');
    error.statusCode = 404;
    throw error;
  }
  const resolved = {
    id: saved?.id || null,
    baseUrl: String(baseUrl || saved?.base_url || '').trim(),
    apiKey: String(apiKey || (saved ? decrypt(saved.api_key_encrypted) : '')).trim(),
    model: String(defaultModel || saved?.default_model || '').trim(),
  };
  assertProviderInput({ baseUrl: resolved.baseUrl, defaultModel: resolved.model });
  if (!resolved.apiKey) {
    const error = new Error('API 密钥不能为空');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}
```

实现 `testProviderConnection()`：发送固定消息“请只回复：连接成功”、`max_tokens: 16`、`stream: false`；返回 `{ success, model, latencyMs, promptTokens, completionTokens, totalTokens, reply }`。网络错误、超时、HTTP 错误和无正文响应转换为中文错误，响应中不含密钥。

- [ ] **Step 4: 注册管理员接口**

在 `backend/src/routes/aiRoutes.js` 中新增：

```js
router.post('/providers/test', authRequired, adminRequired, async (req, res, next) => {
  try {
    const result = await aiService.testProviderConnection(req.body || {});
    authService.writeAuditLog(req.user.id, 'test_ai_provider', req.body?.providerId || 'unsaved', JSON.stringify({ success: true, model: result.model, latencyMs: result.latencyMs }), req.ip);
    res.json(result);
  } catch (error) {
    authService.writeAuditLog(req.user.id, 'test_ai_provider', req.body?.providerId || 'unsaved', JSON.stringify({ success: false }), req.ip);
    next(error);
  }
});
```

- [ ] **Step 5: 运行后端测试**

Run: `npm --prefix backend test`

Expected: 4 项后端测试全部通过，新增模型测试断言通过。

### Task 2: 管理页测试按钮和结果

**Files:**
- Modify: `backend/src/admin/index.html`
- Test: `backend/tests/admin-console.test.js`

- [ ] **Step 1: 增加页面静态断言**

```js
assert.match(staticHtml, /id="testProvider"/u);
assert.match(staticHtml, /providerTestResult/u);
assert.match(staticHtml, /\/ai\/providers\/test/u);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix backend test`

Expected: FAIL，因为管理页还没有测试按钮。

- [ ] **Step 3: 添加测试交互**

在模型表单中加入结果区域与按钮：

```html
<div id="providerTestResult" class="provider-test-result hidden" role="status"></div>
<button type="button" id="testProvider" class="ghost">测试连接</button>
```

点击后调用 `/ai/providers/test`。按钮显示“正在测试…”，成功显示模型、耗时、Token 和回复；失败显示中文错误。测试结束后恢复按钮，表单保持打开且不自动保存。

- [ ] **Step 4: 添加结果样式**

```css
.provider-test-result{margin-top:14px;padding:12px;border-radius:8px}
.provider-test-result.success{color:#166534;background:#f0fdf4;border:1px solid #bbf7d0}
.provider-test-result.failure{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca}
```

- [ ] **Step 5: 运行后端测试**

Run: `npm --prefix backend test`

Expected: 全部通过。

### Task 3: 开发模式联调

**Files:**
- Verify: `app/.dev/runtime.json`
- Verify: `app/.dev/dev.log`

- [ ] **Step 1: 检查语法和差异**

Run: `node --check backend/src/services/aiService.js && node --check backend/src/routes/aiRoutes.js && git diff --check`

Expected: 无输出且退出码为 0。

- [ ] **Step 2: 确认开发后端自动重启**

Run: `tail -n 30 app/.dev/dev.log`

Expected: 出现“检测到保存”“后端服务已启动”“页面已就绪”。

- [ ] **Step 3: 最终回归**

Run: `npm --prefix backend test && npm --prefix app test`

Expected: 后端和桌面端完整测试全部通过。

本计划不包含 Git 提交、打包、安装、版本号修改或正式数据写入，以符合项目日常开发约定。
