# 公文拟写功能实施计划

日期：2026-08-13  
对应设计：`docs/superpowers/specs/2026-08-13-ai-document-drafting-design.md`

## 实施原则

- 每项任务先补自动测试，再实现最小可用代码。
- 公文、版本、引用和写作画像只能通过受控服务修改，不由新增页面直接整体覆盖数据库。
- AI 只能获得用户主动勾选的数据；测试必须证明未勾选数据不会进入提示内容。
- 先完成本地持久化与无 AI 的完整工作流，再接入生成、画像和导出。
- 每个阶段独立提交，避免与现有混淆渲染脚本进行无关重构。

## 阶段 1：数据模型与模板目录

### 任务 1.1：扩展版本化数据库

修改：

- `app/src/main/empty-database.js`
- `app/src/main/database-store.js`
- `app/tests/main/database-store.test.js`

测试先行：

- 新数据库包含 `documentDrafts`、`documentVersions`、`documentReferences`、`documentTemplates` 和 `writingProfiles`。
- 旧数据库读取时自动补齐五个空集合，已有业务数据不变。
- 数据库版本升级，重复读取迁移结果保持一致。
- 两个并发领域更新通过原子 `update` 接口串行执行，不发生后写覆盖先写。

实现：

- 将业务数据库版本提升至 2。
- 在归一化阶段补齐新集合并保留现有 `lands`/`landParcel` 兼容逻辑。
- 为存储增加受写队列保护的 `update(mutator)`，在同一临界区内完成读取、修改和原子写入。

验证：`node --test --test-name-pattern="database|document" tests/**/*.test.js`

提交：`feat: add document drafting data collections`

### 任务 1.2：建立模板目录与字段校验

新建：

- `app/src/main/document-template-catalog.js`
- `app/tests/main/document-template-catalog.test.js`

测试先行：

- 返回五种报告、五种合同和两个自定义入口。
- 每个模板具有稳定编号、文档类型、字段、必填项和章节结构。
- 校验器拒绝未知模板和缺少必填字段，允许模板专属字段。

实现：

- 用不可变配置定义内置模板。
- 提供 `listTemplates`、`getTemplate`、`validateFields` 和自定义模板字段校验。

提交：`feat: add report and contract template catalog`

## 阶段 2：公文领域服务

### 任务 2.1：实现公文、版本与权限规则

新建：

- `app/src/main/document-drafting-service.js`
- `app/tests/main/document-drafting-service.test.js`

测试先行：

- 创建草稿时保存创建人、模板字段快照、可见范围和首个版本。
- 接受 AI 整篇改写或主动保存时创建递增版本，不覆盖旧版本。
- 只有创建人可修改、定稿、归档和删除。
- 所有管理员可查看和引用共享公文；私有公文仅创建人可见。
- 归档不改变草稿或定稿状态。
- 从历史公文新建另一类型时建立显式引用。

实现：

- 服务构造参数注入数据库、模板目录、当前账号读取器、时钟和编号生成器。
- 所有写操作使用数据库存储的原子 `update` 接口。
- 提供列表、读取、创建、更新草稿、保存版本、恢复版本、定稿、归档和跨类型新建。

提交：`feat: add versioned document drafting service`

### 任务 2.2：实现本地搜索与推荐

新建：

- `app/src/main/document-recommendation.js`
- `app/tests/main/document-recommendation.test.js`

测试先行：

- 标题、模板字段和正文关键词能命中候选。
- 同主题、同对象、同类事项、近期定稿和既往使用获得可预测权重。
- 私有且非本人公文不会出现在候选中。
- 每项推荐返回可读原因，排序稳定。

实现：

- 使用中文友好的规范化、关键词切分和确定性评分。
- 不引入向量数据库；返回最高相关的有限候选集。

提交：`feat: recommend related document history`

### 任务 2.3：实现受控上下文与 AI 拟写

新建：

- `app/src/main/document-context-builder.js`
- `app/tests/main/document-context-builder.test.js`

修改：

- `app/src/main/document-drafting-service.js`
- `app/tests/main/document-drafting-service.test.js`

测试先行：

- 只读取请求中明确选择且当前账号有权访问的来源。
- 业务数据集合使用允许列表，不能请求任意数据库键。
- 每个历史或业务片段带来源标识并生成引用摘要。
- 超长上下文优先保留表单和手选来源，再压缩推荐来源。
- AI 超时、空返回或格式错误不创建有效版本。

实现：

- 允许引用 `personnel`、`households`、`partyMembers`、`visitRecords`、`dutyRecords`、`finances`、`landParcel`、`certificates` 和 `documents` 中的选中记录或明确选择的聚合摘要。
- 将模板、字段、个人偏好和受控来源组装为清晰的系统/用户消息。
- 通过现有 `aiRouter.chat` 调用本地或在线 AI，并把正文、提供方和引用写入新版本。

提交：`feat: generate documents from selected context`

## 阶段 3：个人写作偏好

### 任务 3.1：实现可读画像的提炼与管理

新建：

- `app/src/main/writing-profile-service.js`
- `app/tests/main/writing-profile-service.test.js`

测试先行：

- 只有本人新定稿触发画像更新。
- 草稿、他人定稿和归档但未定稿的内容不参与学习。
- 重复且近期写法权重更高，累计定稿数和来源编号准确。
- 提炼失败不影响公文定稿，并保留旧画像。
- 管理员可查看、编辑和重置本人画像。

实现：

- 首版用确定性文本特征提取称谓、章节顺序、段落长度、列表习惯和常见开头/结尾。
- 可选地调用 AI 补充风格摘要，但结果必须归一化为可读结构，失败时回退到本地提取。
- 画像写入 `writingProfiles`，生成上下文时仅载入当前管理员画像。

提交：`feat: learn per-admin writing preferences`

## 阶段 4：受控 IPC 与导出

### 任务 4.1：暴露公文专用接口

修改：

- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/main/ipc-handlers.js`
- `app/src/main/index.js`
- `app/tests/preload/ipc-contract.test.js`
- `app/tests/main/ipc-handlers.test.js`（新建）

测试先行：

- 预加载层只暴露列模板、列历史、读写草稿、保存版本、推荐来源、生成、定稿、画像管理和导出等明确方法。
- 渲染层不能传入账号编号冒充其他管理员，服务始终从当前会话读取账号。
- IPC 错误统一返回可展示信息，不泄露堆栈或密钥。

实现：

- 注册专用 channel 并注入 `DocumentDraftingService`。
- 保持 `contextIsolation`，不暴露原始 `ipcRenderer`、文件系统或任意数据库查询。

提交：`feat: expose secure document drafting IPC`

### 任务 4.2：实现 Word、PDF 与打印导出

修改：

- `app/package.json`
- `app/package-lock.json`
- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/main/ipc-handlers.js`

新建：

- `app/src/main/document-export-service.js`
- `app/tests/main/document-export-service.test.js`

测试先行：

- 文件名清理路径字符并包含标题和版本号。
- Word 输出为有效 `.docx` ZIP/OOXML，包含标题、段落和列表。
- PDF 失败或用户取消保存不会改变公文数据。
- 导出只使用当前账号有权读取的指定版本。

实现：

- 增加锁定版本的轻量 `.docx` 生成依赖。
- PDF 使用隔离的隐藏打印窗口和 `printToPDF`，通过保存对话框选择目标。
- 打印使用同一安全 HTML 和样式；不加载远程资源或执行文稿脚本。

提交：`feat: export drafted documents to Word and PDF`

## 阶段 5：公文拟写界面

### 任务 5.1：增加一级入口与页面骨架

修改：

- `app/src/renderer/index.html`
- `app/src/renderer/style.css`
- `app/tests/renderer/document-drafting-ui.test.js`（新建）

新建：

- `app/src/renderer/js/document-drafting-ui.js`

测试先行：

- 左侧存在“公文拟写”一级入口和 `tab-document-drafting`。
- 页面加载独立模块，不包含 `require` 或 `ipcRenderer`。
- 报告、合同和历史三个页内入口、四步指示器、表单区、参考区和编辑区均存在。

实现：

- 沿用现有菜单、卡片、按钮、表格、深浅主题变量和 `switchTab` 行为。
- 使用独立可读模块管理新增功能，不向现有混淆 `renderer.js` 塞入业务逻辑。

提交：`feat: add document drafting workspace shell`

### 任务 5.2：实现模板表单、参考选择和编辑器

修改：

- `app/src/renderer/js/document-drafting-ui.js`
- `app/src/renderer/style.css`
- `app/tests/renderer/document-drafting-ui.test.js`

测试先行：

- 切换模板生成正确字段并显示缺少项。
- 推荐来源默认不自动选中；手动勾选后才进入生成请求。
- 页面切换和生成失败后保留草稿。
- AI 生成内容显示待核验状态和引用清单。
- 保存版本、恢复版本、定稿和取消定稿有明确确认。

实现：

- 使用受控 `contenteditable` 编辑区并在保存前清理 HTML。
- 输入和编辑内容防抖自动保存；失败时固定显示错误并提供复制正文。
- 历史表格支持筛选、继续编辑、跨类型新建、归档和导出。

提交：`feat: complete document drafting interactions`

### 任务 5.3：增加工作台快捷入口和个人偏好设置

修改：

- `app/src/renderer/index.html`
- `app/src/renderer/js/document-drafting-ui.js`
- `app/src/renderer/style.css`
- `app/tests/renderer/document-drafting-ui.test.js`

实现：

- 工作台快捷区增加“公文拟写”，只跳转到一级页面。
- 公文页面提供“我的写作偏好”，可查看累计定稿数、编辑偏好和重置画像。
- 重置画像使用二次确认，不删除历史公文。

提交：`feat: add drafting shortcut and preference controls`

## 阶段 6：集成验收与文档

### 任务 6.1：自动化回归

运行：

- `cd app && npm test`
- `npm test`（项目根目录，如已配置）
- `git diff --check`

覆盖：

- 数据迁移和现有业务集合不回退。
- 原有账号、授权、AI 设置和本地模型测试全部通过。
- 新增报告、合同、历史、权限、画像、AI 和导出测试通过。

### 任务 6.2：桌面端手工验收

在开发应用中验证：

- 新建工作报告、采购合同和自定义类型。
- 用历史报告生成合同，用历史合同生成报告。
- 手选历史和业务数据，核对引用来源。
- 本地 AI、在线 AI、断网、超时和敏感信息取消。
- 草稿、版本恢复、定稿、跨账号共享/私有权限和画像隔离。
- 复制、打印、Word/PDF 导出和应用重启恢复。
- 深浅主题、窄窗口、空数据、加载和错误状态。

### 任务 6.3：更新用户说明

修改：

- `README.md`
- `docs/ai/configuration.md`

新增：

- `docs/features/document-drafting.md`

说明：

- 四步拟写操作、历史互通和来源确认。
- “越来越懂你”的工作方式、可查看/编辑/重置范围。
- 合同人工核验提示、在线 AI 隐私确认和导出方式。

提交：`docs: explain AI document drafting workflow`

## 完成门槛

- 全部自动测试通过，现有测试无回退。
- 报告、合同、历史、版本、引用、画像和导出形成完整闭环。
- 未勾选数据不会进入 AI 上下文，多管理员画像和私有公文隔离有自动测试证明。
- Word 与 PDF 使用真实文件格式，导出失败不会损坏或改变公文。
- 功能在开发应用中完成一次端到端人工验收后才进入打包阶段。
