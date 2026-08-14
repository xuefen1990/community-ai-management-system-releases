# 直接生成式公文拟写实施计划

日期：2026-08-14  
对应设计：`docs/superpowers/specs/2026-08-14-direct-document-drafting-design.md`

## 实施原则

- 先用自动测试锁定“直接生成、没有追问、补充后全文重写”的新行为，再修改实现。
- 保留现有 IPC 名称和草稿、版本、引用数据结构，减少升级风险。
- 旧对话消息只做兼容保留，新界面不读取、不显示，也不新增依赖。
- 生成失败或返回空正文时，不清空左侧输入、不覆盖右侧正文、不创建空版本。
- 右侧人工编辑在重新生成前必须先保存，确保 AI 使用用户当前看到的正文。

## 阶段 1：直接生成规则

修改：

- `app/src/main/document-conversation-interpreter.js`
- `app/tests/main/document-conversation-interpreter.test.js`

实现：

- 将模型指令从“追问或生成”改为“始终生成完整正文”。
- 输出结构移除 `needs_input` 语义，要求正文必填。
- 合同关键字段缺失时，不阻断生成；字段值统一补为“【待补充】”。
- 普通缺失信息允许省略，继续禁止虚构姓名、金额、日期、主体和政策编号。
- 补充修改时明确要求结合当前正文返回重新生成后的完整正文。

## 阶段 2：草稿服务与版本

修改：

- `app/src/main/document-drafting-service.js`
- `app/tests/main/document-drafting-service.test.js`

实现：

- `converse` 保留为兼容入口，但每次有效输入都直接调用 AI 生成正文。
- 移除自动历史意图追问、引用确认消息和缺失字段追问分支。
- 首次生成自动创建草稿；补充生成使用当前工作正文和本轮要求。
- 成功生成后保存新版本并更新草稿、类型、模板、标题和引用。
- 失败或空正文时保留当前草稿与版本，不生成 AI 消息或空版本。
- 旧 `documentDraftMessages` 和 `conversationState` 数据继续可读取，不删除。

## 阶段 3：单输入框双栏界面

修改：

- `app/src/renderer/js/document-drafting-ui.js`
- `app/src/renderer/style.css`
- `app/tests/renderer/document-drafting-ui.test.js`

实现：

- 删除消息流、“AI 已理解”摘要、AI 追问提示和引用候选消息卡。
- 左侧显示说明卡、公文类型、一个大输入框、主要生成按钮和折叠式参考设置。
- 首次状态使用“描述需要拟写的内容 / 开始 AI 拟写”。
- 已有正文后切换为“补充修改要求 / 根据补充重新生成”。
- 只有生成成功才清空输入框；失败时保留输入和右侧正文。
- 重新生成前立即保存右侧编辑内容，并将其作为服务端当前正文。
- 保留自动保存、版本、历史、互通、引用、定稿、复制、打印和导出功能。

## 阶段 4：使用说明与回归

修改：

- `docs/features/document-drafting.md`

验证：

- 更新使用说明，删除对话追问和消息流描述。
- 运行公文解释器、服务和渲染器测试。
- 运行 `npm test` 全量回归和 `git diff --check`。
- 在桌面应用中检查首次生成、右侧编辑、补充重写、失败保留和版本恢复。
- 保存最终界面截图；如发布包受本次代码影响，则重新构建 Apple Silicon 安装包。

## 提交安排

1. `test: specify direct document drafting behavior`
2. `feat: simplify document drafting to direct generation`
3. `docs: update direct drafting guidance`
