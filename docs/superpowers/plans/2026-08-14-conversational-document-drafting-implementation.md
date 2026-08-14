# 对话式公文拟写工作台实施计划

日期：2026-08-14  
对应设计：`docs/superpowers/specs/2026-08-14-conversational-document-drafting-design.md`

## 实施原则

- 先补自动测试，再实现最小代码。
- 复用现有公文、版本、引用、历史、画像和导出服务，不重建成熟能力。
- 对话结果必须经过结构校验；AI 返回异常时不得覆盖现有正文或创建空版本。
- 历史候选默认不进入上下文，只有用户确认的版本可以用于生成。
- 每个阶段完成后运行相关测试，最终运行应用全量测试并做桌面端验收。

## 阶段 1：会话数据与需求解释

### 任务 1.1：扩展数据库兼容层

修改：

- `app/src/main/empty-database.js`
- `app/src/main/database-store.js`
- `app/tests/main/database-store.test.js`

实现：

- 数据库版本提升至 3，新增 `documentDraftMessages` 集合。
- 旧数据库自动补齐集合，已有公文数据保持不变。
- 公文草稿按需增加 `conversationState`，旧草稿无需迁移即可打开。

### 任务 1.2：新增对话需求解释器

新建：

- `app/src/main/document-conversation-interpreter.js`
- `app/tests/main/document-conversation-interpreter.test.js`

实现：

- 提供本地公文类型判断和默认模板选择。
- 构造严格 JSON 的 AI 对话提示，包含当前摘要、对话、最新版正文和已确认来源。
- 解析并校验 AI 返回的类型、模板、字段、下一步动作、追问和完整正文。
- 合同缺少主体、标的、金额或计价、期限、付款、违约和争议解决时强制返回追问。
- AI JSON 异常时返回可读错误，不把异常字段写入草稿。

## 阶段 2：对话式公文服务

### 任务 2.1：实现连续对话与版本生成

修改：

- `app/src/main/document-drafting-service.js`
- `app/tests/main/document-drafting-service.test.js`

实现：

- 增加 `converse`：首次描述创建可恢复草稿并保存消息；后续补充复用同一草稿。
- 每轮调用需求解释器；缺信息时只保存追问，不生成正文。
- 可生成时保存标准字段、完整正文、新版本、AI 提供方和当前对话状态。
- 重新生成只新增版本，不覆盖旧版本。
- `getDocument` 同时返回对话消息，旧草稿根据字段快照生成简短摘要。

### 任务 2.2：实现历史引用确认

修改：

- `app/src/main/document-drafting-service.js`
- `app/tests/main/document-drafting-service.test.js`

实现：

- 识别“参考之前/前几天/那份报告或合同”等意图并返回最多三条候选。
- 候选未确认时不调用正文生成。
- 用户确认后使用现有上下文组装器读取具体版本，并把引用写入新版本。
- 报告转合同或合同转报告时仍执行合同关键字段校验。

## 阶段 3：受控 IPC

修改：

- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/main/ipc-handlers.js`
- `app/tests/preload/ipc-contract.test.js`
- `app/tests/main/ipc-handlers.test.js`

实现：

- 新增单一 `converseDraftDocument` 接口，接收草稿编号、消息、类型偏好和已确认来源。
- 服务端始终从当前登录会话确定管理员，不接受渲染层传入账号编号。
- 继续使用统一安全错误包装，不暴露堆栈、密钥或原始数据库。

## 阶段 4：对话式双栏界面

修改：

- `app/src/renderer/js/document-drafting-ui.js`
- `app/src/renderer/style.css`
- `app/tests/renderer/document-drafting-ui.test.js`

实现：

- 删除四步指示器和主流程长字段表单。
- 新建页面改为左侧对话、右侧公文预览，顶部只保留新建、历史和写作偏好入口。
- 首屏显示大描述框和报告/合同自动识别切换；生成后显示固定的补充修改输入框。
- 渲染用户消息、AI 追问、生成状态、已理解摘要和历史候选确认卡。
- 历史引用和模板/可见范围放入折叠式高级设置。
- 保留编辑器、自动保存、版本保存、复制、定稿、打印、Word/PDF 导出和历史记录动作。
- 900px 以下改为上下布局，并保持现有深浅主题变量。

## 阶段 5：回归与桌面验收

自动验证：

- `cd app && npm test`
- `git diff --check`

桌面端验证：

- 一段完整描述直接生成报告。
- 简略描述触发追问，补充后继续生成。
- 补充“语气更正式”等要求后生成新版本，旧版本仍可恢复。
- “参考前几天那份报告”先出现候选，确认后生成合同。
- DeepSeek 失败时对话和现有正文不丢失。
- 历史、编辑、定稿、打印、Word/PDF 和写作画像保持可用。
- 在实际应用中完成视觉检查并保存成果截图。

## 提交安排

1. `test: specify conversational drafting behavior`
2. `feat: add conversational drafting service`
3. `feat: replace drafting form with AI conversation`
4. `docs: update conversational drafting guidance`
