# AI 系统管理员助手实施计划

**设计依据：** `docs/superpowers/specs/2026-09-21-ai-system-administrator-assistant-design.md`  
**现有基线：** 已完成的 AI 总控中心、AI 任务单、文件识别、OCR 核对、业务导入、电子档案、证明模板、权限、Token 额度和撤销体系  
**实施日期：** 2026-09-21  
**实施方式：** 只在现有项目上增量改造；日常预览使用根目录 `npm run dev`；本计划不打包、不安装、不改正式数据

## 一、最终目标

将现有 AI 助理升级为系统统一的智能办事入口。工作人员上传文字、图片、Word、PDF 或 Excel 后，AI 应能：

1. 先保存原文件，识别材料类型和业务用途；
2. 查询系统中已有的档案分类、证明模板和业务记录；
3. 优先复用已有对象，避免重复分类、重复模板和重复业务数据；
4. 在缺少普通档案分类时自动创建，在涉及正式业务写入时按风险等级确认；
5. 通过现有业务服务完成归档、模板草稿、导入、修改和撤销，不直接自由写数据库；
6. 支持图片缩略图、原图查看、OCR 和视觉理解；
7. 普通对话不再反复弹出 Token 提示，高消耗任务才在执行前提醒；
8. 每次实际写入都有通俗中文记录、执行后复核和可用的撤销入口。

## 二、现有能力与改造边界

### 2.1 直接复用的现有能力

- `app/src/main/ai-assistant-service.js`：现有连续对话、查询、确认、写入和撤销入口；
- `app/src/main/ai-task-service.js`、`app/src/main/ai-task-planner.js`：任务单和步骤状态；
- `app/src/main/ai-tools/registry.js`、`read-tools.js`、`write-tools.js`：统一 AI 工具注册体系；
- `app/src/main/ai-file-task-service.js`：文件选择、指纹查重、Excel/Word/PDF/图片解析、OCR 核对和业务移交；
- `app/src/main/foundation-document-service.js`、`foundation-file-protocol.js`：电子档案保存、受控文件访问；
- `app/src/main/foundation-business-service.js`：字典和业务接口；
- `app/src/main/foundation-certificate-service.js`、`certificate-document-service.js`：证明模板版本、开具、导出和打印；
- `app/src/main/ai-router.js`、`ai-model-routing.js`：本机/在线模型选择；
- 后端模型服务、永久 Token 额度、用量流水和单位账号权限；
- `aiAssistantOperations`、`aiTasks`、`aiFileIndexEntries`：操作、任务和文件索引数据。

### 2.2 明确不做的事情

- 不重建 Electron、渲染进程、后端或数据库；
- 不新增一套与现有 AI 工具注册中心并行的编排框架；
- 不让模型直接执行 SQL、直接修改 JSON 文件或绕过业务校验；
- 不搬动或重写现有正式档案；
- 不把身份证号、银行卡号等敏感内容写入 AI 长期记忆；
- 日常开发阶段不修改版本号、不生成 DMG、不安装应用。

## 三、兼容与数据原则

1. **旧档案保持原样。** 已经归为“AI 任务原文件”的记录继续可查，不批量移动；新上传文件使用新的“待归档”流程。
2. **旧索引向后兼容。** `aiFileIndexEntries` 没有新状态字段时按“已归档”读取；新增字段只做增量补充。
3. **原文件只存一份。** 待归档状态仍由电子档案服务安全保存原件，AI 索引只保存文件编号、哈希、识别结果和关联信息。
4. **档案分类复用现有字典。** 分类继续使用 `foundationDictionaries` 中的 `document_category`，在现有字典项上增量支持别名，不建第二套分类表。
5. **证明模板复用现有版本模型。** AI 新建的是草稿；只有工作人员确认预览后才调用现有发布能力。
6. **操作记录继续使用 `aiAssistantOperations`。** 新能力补充 `toolId`、影响预览、确认历史、核验和撤销信息，不另建重复日志。
7. **业务记录写入前重新读取。** 确认期间目标对象发生变化时停止执行，要求重新核对。

## 四、分阶段实施

## 阶段 0：锁定回归基线和补齐场景测试

**目标：** 在修改行为前固定当前能力，防止新功能破坏已有查询、OCR、导入、证明和撤销。

### 涉及文件

- 扩展 `app/tests/main/ai-file-task-service.test.js`
- 扩展 `app/tests/main/ai-tool-registry.test.js`
- 扩展 `app/tests/main/foundation-document-service.test.js`
- 扩展 `app/tests/main/foundation-certificate-service.test.js`
- 扩展 `app/tests/renderer/ai-settings-ui.test.js`
- 扩展 `app/tests/preload/ipc-contract.test.js`

### 工作内容

1. 固定当前重复文件指纹、OCR 核对、业务移交、模板版本和撤销行为；
2. 增加旧 `aiFileIndexEntries` 缺少新字段时仍可读取的测试；
3. 记录当前开发数据目录和正式数据目录隔离结果；
4. 运行 App 与后端现有测试，保存失败基线；
5. 后续每阶段只在当前基线上增加测试，不删除已有断言来迁就新实现。

### 完成后可见效果

该阶段不改变界面，作用是确保后续每一步都能安全回归。

---

## 阶段 1：统一待归档、通用分类和档案类别创建

**目标：** 上传文件后不再立即归为“AI 任务原文件”，而是先进入待归档状态；AI 能识别常用材料并复用或创建档案分类。

### 新增文件

- `app/src/main/ai-document-category-service.js`
- `app/tests/main/ai-document-category-service.test.js`

### 修改文件

- `app/src/main/ai-file-task-service.js`
- `app/src/main/foundation-document-service.js`
- `app/src/main/foundation-personnel-actions.js`
- `app/src/main/empty-database.js`
- `app/src/main/index.js`
- `app/src/main/ipc-handlers.js`
- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/renderer/js/ai-settings-ui.js`
- `app/src/renderer/foundation/assistant-extension.css`
- 对应主进程、preload 和渲染测试

### 数据字段

在 `aiFileIndexEntries` 上增量增加：

- `archiveState`：`pending`、`classified`、`archived`、`deferred`；
- `documentId`：电子档案原件编号；
- `suggestedCategory`、`finalCategory`；
- `classification`：材料类型、置信度、匹配依据和候选用途；
- `categoryDecision`：复用、创建、改选或暂不归档；
- `businessLinks`：与模板、居民、合同或其他业务对象的关联。

字典项增量支持 `aliases`，例如“合同”“协议”“承包合同材料”都可命中“合同档案”。旧字典没有 `aliases` 时按空数组处理。

### 工作内容

1. 修改 `analyzeFile()`：先通过电子档案服务保存原件，但标记为“待归档”，不再默认展示为“AI 任务原文件”；
2. 扩展材料规则：合同/协议、证明模板、已开具证明、公文、居民资料、土地材料、发放和财务表、党员/民情/值班/工作材料、图片和未知材料；
3. 分类返回中文用途、置信度、命中关键词或字段依据；
4. 类别服务执行名称标准化、别名匹配、近义匹配和重复检查；
5. 高可信且已有分类时自动归档；缺少普通分类时显示“创建并归档 / 选择其他分类 / 暂不归档”；
6. 新建普通分类通过现有字典业务入口完成，并登记低风险 AI 操作；
7. 分类不确定、同名对象不唯一或用途冲突时只问一个最关键问题；
8. 结果卡显示原文件、识别用途、当前归档位置、判断依据和撤销入口；
9. 同一文件再次上传时复用原件，并询问是复用现有业务关联还是建立新关联。

### 测试场景

- 上传合同，已有“合同档案”时直接复用；
- 只有“合同材料”别名时仍匹配“合同档案”；
- 缺少分类时可创建一次，第二次不重复创建；
- 名称只差空格、标点或“材料/档案”后缀时不重复；
- 未知材料保留在待归档区，不产生错误业务数据；
- 旧“AI 任务原文件”记录仍能打开；
- 文件重复上传不复制第二份原件。

### 完成后可见效果

上传合同或其他材料后，聊天中会明确显示“识别为什么、准备放哪里、是否需要创建分类”，而不是固定归入同一个技术分类。

---

## 阶段 2：证明模板识别、查重、草稿和发布

**目标：** 上传证明模板后，AI 能识别模板结构，查找已有模板，生成草稿和预览；重复模板不再无条件新建。

### 新增文件

- `app/src/main/ai-certificate-template-intake-service.js`
- `app/tests/main/ai-certificate-template-intake-service.test.js`

### 修改文件

- `app/src/main/ai-file-task-service.js`
- `app/src/main/foundation-certificate-service.js`
- `app/src/shared/certificate-management-model.js`
- `app/src/main/ai-tools/write-tools.js`
- `app/src/main/ai-tools/registry.js`
- `app/src/main/ai-assistant-service.js`
- `app/src/main/ipc-handlers.js`
- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/renderer/js/ai-settings-ui.js`
- `app/src/renderer/js/certificate-management-ui.js`
- `app/src/renderer/foundation/certificate-management.css`
- 对应主进程、共享模型、preload 和渲染测试

### 工作内容

1. 从 Word、PDF、图片识别模板名称、分类、标题、正文、固定文字、动态字段、人工字段、署名、日期格式和多人结构；
2. 将“姓名、身份证号、住址”等字段映射到现有居民档案字段，把“关系、用途、说明”等识别为人工字段；
3. 按“完全相同、同名不同内容、正文近似、没有匹配”四级查重；
4. 完全相同时直接复用并建立文件关联；
5. 同名不同内容时显示逐项差异，提供“更新现有模板 / 另存为新版本 / 取消”；
6. 正文近似时优先建议复用，工作人员仍可选择新建草稿；
7. 没有匹配时自动创建草稿，不立即发布；
8. 在 AI 对话中提供模板预览、字段编辑和版式检查入口；
9. 点击发布时走现有模板版本服务和一次确认；
10. 原始模板文件继续保存在电子档案柜，并与模板编号、版本和 AI 任务关联；
11. 草稿失败或关闭窗口后可继续，不留下半发布模板。

### 测试场景

- 再次上传同一模板只复用，不新增；
- 同名正文有差异时能看到差异并选择更新或新版本；
- 双人关系证明能生成两组居民字段和一个人工关系字段；
- 图片 OCR 不确定的身份证占位不会被错误固定到模板；
- 预览确认前模板不出现在正式开具列表；
- 发布后可在证明管理中正常搜索、开具、打印；
- 撤销草稿创建不影响原始档案文件。

### 完成后可见效果

工作人员可把现有证明样张直接交给 AI，先看到整理好的模板草稿与打印预览，再决定复用、更新或发布。

---

## 阶段 3：图片缩略图、原图预览和视觉模型路由

**目标：** 对话框真正支持查看图片；需要理解版面、表格、印章、勾选或画面内容时，后端自动使用视觉模型。

### 新增文件

- `app/src/main/ai-vision-service.js`
- `app/tests/main/ai-vision-service.test.js`
- `app/src/renderer/foundation/ai-file-viewer.mjs`
- `app/src/renderer/foundation/ai-file-viewer.css`
- `app/tests/renderer/ai-file-viewer.test.js`

### 修改文件

- `app/src/main/ai-file-task-service.js`
- `app/src/main/ai-router.js`
- `app/src/main/ai-model-routing.js`
- `app/src/main/foundation-file-protocol.js`
- `app/src/main/ai-settings-store.js`
- `app/src/main/ipc-handlers.js`
- `app/src/shared/ipc-contract.js`
- `app/src/preload/index.js`
- `app/src/renderer/js/ai-settings-ui.js`
- `app/src/renderer/foundation/assistant-extension.css`
- `backend/src/services/aiService.js`
- `backend/src/services/aiModelRouting.js`
- `backend/src/routes/aiRoutes.js`
- `backend/src/admin/index.html`
- `backend/src/database.js`
- `backend/tests/ai-model-routing.test.js`
- 相关 App 和后端测试

### 工作内容

1. 在文件卡上显示图片缩略图和页数；
2. 点击后打开查看器，支持放大、缩小、适应窗口、旋转、翻页和关闭；
3. 通过现有受控文件协议读取原件，禁止渲染层直接访问任意磁盘路径；
4. OCR 继续负责文字、日期、号码和金额提取；
5. 视觉理解负责版面、表格关系、勾选项、印章、签字位置、照片内容和多页关联；
6. 后端模型配置增加“文字能力/视觉能力”标识以及独立的视觉默认模型；
7. 管理后台测试接口同时验证模型是否真的接受图片，不只验证文字连通；
8. App 根据任务自动选择文字模型或视觉模型，前端仍只保存后端服务器地址；
9. 发送敏感图片前显示具体用途确认，记录用途和时间，不把原始敏感号码写入长期记忆；
10. 视觉模型不可用时保留图片预览和 OCR，并明确显示“当前仅完成文字提取”。

### 测试场景

- 单图、多图和 PDF 多页均可预览；
- 旋转和缩放不修改原文件；
- 非当前单位文件不能通过文件协议访问；
- 纯文字任务不误调用视觉模型；
- 图片任务优先调用视觉模型，失败后回退 OCR；
- 后端测试能区分“文字可用、视觉不可用”；
- 敏感图片没有确认时不发送在线模型。

### 完成后可见效果

上传图片后可以直接在聊天框中看缩略图和原图；AI 能说明图片中的结构、勾选、表格和印章位置，而不只返回提取文字。

---

## 阶段 4：扩展全系统操作能力和分级确认

**目标：** AI 可以在当前账号权限范围内操作各业务板块，同时统一使用现有工具注册、业务服务、确认、复核和撤销。

### 修改文件

- `app/src/main/ai-tools/tool-definition.js`
- `app/src/main/ai-tools/registry.js`
- `app/src/main/ai-tools/read-tools.js`
- `app/src/main/ai-tools/write-tools.js`
- `app/src/main/ai-assistant-service.js`
- `app/src/main/ai-task-planner.js`
- `app/src/main/ai-task-service.js`
- `app/src/main/ai-semantic-service.js`
- `app/src/shared/ai-operation-presentation.js`
- 各现有业务服务中缺少的受控写入方法
- `app/src/renderer/js/ai-settings-ui.js`
- 相关主进程、共享模型和渲染测试

### 工作内容

1. 为每个工具补齐：中文名称、输入、权限、风险、执行服务、前置检查、影响预览、后置复核、撤销和可发送给在线模型的摘要；
2. 先接入档案分类、证明模板、合同台账、公文草稿和已有文件导入能力；
3. 再核对居民、家庭、土地、资金、财务、党员、民情、值班、工作事项和系统设置的现有工具；
4. 低风险操作自动完成：原件保存、匹配分类、普通分类创建、模板草稿、预览、非敏感标签和关联；
5. 普通写入一次确认：模板发布/更新、合同台账、居民和土地修改、业务导入；
6. 高风险操作二次确认：删除、批量覆盖、正式资金发放、清空台账、备份恢复、账号权限和关键设置；
7. 确认卡只写工作人员看得懂的“将新增什么、修改什么、保留什么”，技术代码收进详情；
8. 执行后重新读取目标记录验证结果，验证失败标记为失败并给出恢复入口；
9. 支持撤销的操作保存执行前快照和撤销条件；
10. 信息不足时只追问一个决定下一步的关键问题，不猜测目标。

### 测试场景

- 普通用户不能让 AI 越权修改管理员设置；
- 创建档案类别和模板草稿可自动完成并可撤销；
- 发布模板只确认一次；
- 删除模板或批量覆盖必须确认两次；
- 第一次确认后目标版本发生变化时禁止执行；
- 成功操作有中文记录，失败操作不产生半成品；
- 撤销后复核目标确实恢复。

### 完成后可见效果

AI 不再只是给建议，而是能在聊天中展示清楚的办理方案，按风险要求完成创建、修改、归档和导入，并提供查看结果或撤销。

---

## 阶段 5：Token 提醒、低余额提示和实际用量

**目标：** 去掉每次普通对话前的打断式 Token 弹窗，只在真正高消耗或额度不足时提醒。

### 修改文件

- `app/src/main/ai-settings-store.js`
- `app/src/main/ai-router.js`
- `app/src/renderer/js/ai-settings-ui.js`
- `app/src/renderer/foundation/assistant-extension.css`
- `app/src/main/empty-database.js`
- `backend/src/services/aiService.js`
- `backend/src/services/aiQuotaService.js`
- `backend/src/routes/aiRoutes.js`
- 对应 App 和后端测试

### 设置项

- `high_cost_only`：仅高消耗提醒，默认；
- `always`：每次在线调用提醒；
- `insufficient_only`：只在额度不足时阻止并提醒。

### 工作内容

1. 估算接口返回任务等级、预计 Token、剩余额度和提醒原因；
2. 本机规则、数据库查询、分类匹配、查重和 OCR 不弹提示；
3. 普通短对话直接执行，结束后在消息下方显示实际 Token；
4. 长文档、多图片、视觉理解和复杂跨模块任务超过阈值时只确认一次；
5. 单位余额低于 20% 时在 AI 窗口顶部显示非阻断提示；
6. 额度不足时停止在线调用，但保留文字、附件、待办步骤和本机识别结果；
7. 设置页面提供三种提醒偏好和通俗说明；
8. 相同任务的连续对话不重复确认，只有新增附件或任务等级明显升高时重新估算；
9. 用量明细继续由后端记账，前端不得自行扣减。

### 测试场景

- 普通问答不弹 `window.confirm`；
- OCR 和本地分类不消耗在线 Token；
- 高消耗图片任务只提醒一次；
- 低余额只显示顶部提示，不阻止普通任务；
- 额度不足时输入和文件不会丢失；
- 实际用量与后端流水一致；
- 切换为“每次提醒”后恢复逐次确认。

### 完成后可见效果

日常对话会直接进行；只有长文档、多图片等明显高消耗任务才询问，回复下面可查看本次实际用量。

---

## 阶段 6：一体化验收与开发版体验

**目标：** 将五个功能阶段串成完整业务流程，并在开发模式下让用户逐项体验。

### 自动验证

每阶段完成后运行相关定向测试，最终统一运行：

```bash
npm --prefix app test
npm --prefix backend test
node scripts/check-development.mjs
```

随后用根目录开发命令启动或保持开发版：

```bash
npm run dev
```

需要查看开发者工具时使用：

```bash
npm run dev:tools
```

### 人工验收主流程

1. 上传合同，复用或创建“合同档案”，查看归档结果并撤销；
2. 再次上传同一合同，确认不重复保存原件；
3. 上传 Word 证明模板，查看查重、草稿、字段和打印预览；
4. 上传同名不同内容模板，选择更新或新版本；
5. 上传图片，查看缩略图、放大、旋转、OCR 和视觉说明；
6. 让 AI 创建普通档案分类，确认自动完成并留下操作记录；
7. 让 AI 发布模板，确认只需一次确认；
8. 尝试删除或批量覆盖，确认必须二次核对；
9. 连续进行普通问答，确认不再反复弹出 Token 提示；
10. 重启开发版，确认聊天、附件和未完成任务可以继续。

### 最终完成标准

- 设计文档第 13 节的验收标准全部满足；
- App 与后端测试全部通过；
- 开发模式热更新、页面刷新和主进程自动重启正常；
- 开发数据只写入 `app/.dev/user-data`；
- 正式版本号、正式数据库和现有安装包没有变化；
- 未经用户明确要求，不执行打包、安装、Git 提交、推送、标签或 Release。

## 五、实施顺序与每阶段停靠点

按以下顺序连续实施，每完成一阶段先汇报可见结果和测试结果，再进入下一阶段：

1. 阶段 0 + 阶段 1：先解决“上传后放哪里、缺少分类如何创建”；
2. 阶段 2：完成证明模板智能识别与去重；
3. 阶段 3：完成图片查看和视觉理解；
4. 阶段 4：扩展全系统受控操作；
5. 阶段 5：完成 Token 体验优化；
6. 阶段 6：开发版完整验收。

任何阶段出现数据模型或权限不确定时，先保持文件和任务为待处理状态，不提前写入正式业务记录。这样每一阶段都能独立使用、独立验证，也能在下一阶段继续扩展，不需要推倒重来。
