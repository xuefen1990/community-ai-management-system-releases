# 在线 AI 响应兼容性修复实施计划

日期：2026-08-14  
对应设计：`docs/superpowers/specs/2026-08-14-online-ai-response-compatibility-design.md`

## 实施原则

- 测试先行：先复现 DeepSeek 响应被误判和纯正文被拒绝，再修改实现。
- 保持现有接口、设置结构、密钥存储和公文版本结构不变。
- 优先使用结构化结果；只在无法解析 JSON 时将非空文本降级为完整正文。
- 任何失败均发生在新版本写入前，不覆盖用户当前正文。
- 不记录或显示 API 密钥、服务端原始响应和模型内部推理内容。

## 阶段 1：在线响应标准化

修改：

- `app/tests/main/openai-compatible-client.test.js`
- `app/src/main/openai-compatible-client.js`

实现：

- 增加标准消息字符串、消息分段数组和兼容文本字段测试。
- 将可见文本提取封装成单一函数，过滤空片段与非文本片段。
- 官方 DeepSeek V4 请求默认关闭思考模式，并将在线等待上限提高到 120 秒。
- 服务端在成功状态中携带错误对象时，优先显示服务端错误信息。
- 没有最终可见文本时返回明确错误，不把推理字段当作最终公文。

## 阶段 2：公文纯正文降级

修改：

- `app/tests/main/document-conversation-interpreter.test.js`
- `app/src/main/document-conversation-interpreter.js`

实现：

- 保留现有严格 JSON 和 Markdown JSON 解析行为。
- 无法找到或解析 JSON，但响应为非空文本时，使用当前类型、模板和字段形成 `ready` 结果。
- 报告直接使用纯正文；合同继续补全关键字段占位符，并在正文末尾生成待补充事项。
- 空响应继续报错，避免创建空版本。

## 阶段 3：服务级回归

修改：

- `app/tests/main/document-drafting-service.test.js`

验证：

- 纯正文 AI 响应可以创建新版本并更新右侧正文。
- AI 返回空内容或抛错时，不新增版本、不覆盖旧正文。
- 补充生成仍基于当前人工编辑后的全文。

## 阶段 4：全量验证与交付

验证：

- 运行客户端、解释器和公文服务相关测试。
- 运行 `npm test` 全量回归与 `git diff --check`。
- 构建 Apple Silicon 安装包，并核对生成文件、更新时间和 SHA-256。
- 确认最终安装包包含新版直接生成式公文界面。

## 提交安排

1. `test: cover online AI response compatibility`
2. `fix: accept compatible online AI document responses`
3. `build: refresh Apple Silicon installer`（仅在构建产物纳入版本管理时使用）
