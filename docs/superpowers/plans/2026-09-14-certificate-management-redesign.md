# 证明管理板块重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有证明管理改造成“选择证明类型—搜索居民—自动带入档案—填写人工字段—实时预览—确认开具并打印”的单份证明工作台，同时提供可维护、可版本化的模板和可追溯的开具记录。

**Architecture:** 沿用当前 Electron 31、主进程本地业务服务、preload 安全桥和朋友版 Vue 外壳。新增独立的证明管理扩展页面，由现有扩展路由接管“证明管理”菜单；共享模型负责模板、字段、快照和校验，主进程服务负责事务、内部编号、历史兼容和文件输出，渲染层只负责交互与展示。旧批量数据和旧模板按需读取兼容，不执行破坏性迁移。

**Tech Stack:** Electron 31、Node.js CommonJS 主进程、原生 HTML/CSS/JavaScript 扩展页、现有 Foundation Business API、Node `node:test`、现有 Word/PDF 输出服务；为替换已上传 `.docx` 占位符增加轻量 ZIP 依赖 `pizzip`，不更换现有框架或构建工具。

---

## 实施边界

- 本轮只在根目录 `npm run dev` 的开发版和 `app/.dev/user-data` 独立数据中验证。
- 不提高版本号，不打包 `.app`/`.dmg`，不安装应用，不提交或推送 GitHub。
- 不改“一户一档”的保存方式；证明管理只读居民、家庭和土地资料。
- 不删除旧批量证明、历史证明、旧模板或已归档文件；只取消新建批量证明的界面入口。
- 不直接手改 `app/src/renderer/foundation/vendor/assets/foundation-runtime.mjs` 的压缩业务代码。

## 任务 1：建立证明模板与开具快照的共享模型

**Files:**
- Create: `app/src/shared/certificate-management-model.js`
- Create: `app/tests/shared/certificate-management-model.test.js`

- [ ] **Step 1: 先写旧模板兼容失败测试**

覆盖现有 `{村民姓名}`、`{身份证号}`、`variables`/`fields`、`redSeal`/`sealEnabled` 等旧字段，期望统一得到中文字段定义、适用对象、状态和“第 1 版”。

```js
test('旧模板会转换为可视化字段且保留原正文', () => {
  const template = normalizeCertificateTemplate({
    id: 'tpl_relation',
    name: '亲属关系证明',
    content: '{村民姓名}与{第二村民姓名}系{双方关系}关系',
    redSeal: true,
  });
  assert.equal(template.currentVersion, 1);
  assert.deepEqual(template.subjects.map(item => item.key), ['person1', 'person2']);
  assert.equal(template.fields.find(item => item.label === '双方关系').source, 'manual');
});
```

- [ ] **Step 2: 实现兼容规范化和稳定字段标识**

实现并导出：

- `normalizeCertificateTemplate(template)`；
- `extractTemplateVariables(content)`；
- `normalizeCertificateField(field)`；
- `normalizeTemplateVersion(version, template)`；
- `defaultFieldForVariable(label)`。

共享文件采用当前项目已有的 UMD 形式，同时支持主进程 `require()` 和渲染进程 `window.CertificateManagementModel`。

- [ ] **Step 3: 写字段取值、正文渲染和串值保护测试**

测试两位居民使用 `person1.*`、`person2.*` 独立命名空间；更换第一位居民后只清空第一位居民的档案值；未替换变量返回具体中文错误。

- [ ] **Step 4: 实现字段取值和校验**

实现并导出：

- `buildSubjectSnapshot(person, household, landRows)`；
- `replaceSubject(draft, subjectKey, snapshot)`；
- `resolveFieldValue(field, context)`；
- `renderCertificateContent(templateVersion, context)`；
- `validateCertificateDraft(draft, templateVersion)`。

自动字段标记 `source: 'archive'|'household'|'land'|'system'` 并只读；人工字段标记 `source: 'manual'`。校验结果必须指出“第几位当事人 + 缺失字段”，不能只返回笼统失败。

- [ ] **Step 5: 写版本、快照和内部编号隐藏规则测试**

验证发布后版本从 1 连续增加到 2；旧版本对象不被修改；开具快照包含模板正文、字段、居民快照和输出数据；`internalRecordNo` 不进入正文变量和导出内容。

- [ ] **Step 6: 实现版本和记录构造函数**

实现并导出：

- `publishTemplateVersion(template, changes, metadata)`；
- `createCertificateDraft(template, context)`；
- `createIssuedRecord(draft, templateVersion, metadata)`；
- `copyIssuedRecordToDraft(record)`；
- `voidIssuedRecord(record, reason, metadata)`。

- [ ] **Step 7: 运行共享模型测试**

Run: `node --test app/tests/shared/certificate-management-model.test.js`

Expected: 所有测试通过，错误信息为中文，旧模板正文和未知扩展字段未丢失。

## 任务 2：增加证明管理主进程事务服务

**Files:**
- Create: `app/src/main/foundation-certificate-service.js`
- Modify: `app/src/main/foundation-business-service.js`
- Modify: `app/src/main/foundation-domains.js`
- Modify: `app/src/main/foundation-certificate-templates.json`
- Create: `app/tests/main/foundation-certificate-service.test.js`
- Modify: `app/tests/main/foundation-domains.test.js`
- Modify: `app/tests/main/foundation-business-service.test.js`

- [ ] **Step 1: 写居民候选和同名保护测试**

构造两名同名居民，验证 `GET /api/v3/certificate-residents?keyword=张三` 返回两张候选卡需要的姓名、组别、出生日期/年龄、户主/关系和脱敏身份证提示，但不自动指定其中一人；按身份证号或户号也可搜索。

- [ ] **Step 2: 实现只读居民搜索和证明资料聚合**

在 `foundation-certificate-service.js` 中复用 `buildPersonnelView()`，实现：

- `searchCertificateResidents(database, params)`；
- `certificateResidentContext(database, personId)`；
- 家庭人口、户主、住址、土地数量/面积/明细聚合；
- 最多返回 20 个候选，空关键字不扫描全库。

在 `FoundationBusinessService.read()` 中注册：

- `GET /certificate-residents`；
- `GET /certificate-residents/:id/context`。

- [ ] **Step 3: 写模板 CRUD、发布和旧模板覆盖测试**

验证内置模板可编辑但默认 JSON 不被覆盖；编辑内置模板会在 `certificateTemplates` 建立同 ID 覆盖记录；发布产生连续“第 N 版”；复制生成新 ID；已使用模板只能停用；未使用自建模板才允许删除；恢复默认模板保留回收记录。

- [ ] **Step 4: 实现模板事务**

在专用服务中接管以下路径，旧 `/certificate-templates` 调用仍然可用：

- `GET/POST /certificate-templates`；
- `GET/PATCH /certificate-templates/:id`；
- `POST /certificate-templates/:id/publish`；
- `POST /certificate-templates/:id/copy`；
- `POST /certificate-templates/:id/status`；
- `DELETE /certificate-templates/:id`；
- `POST /certificate-templates/restore-defaults`。

旧长时间戳版本只在读取时显示为连续版次，原字段仍保留。新增字段写入 `schemaVersion: 2`、`versions`、`currentVersion` 和 `status`。

- [ ] **Step 5: 写开具幂等、编号、快照和作废测试**

验证：

- 同一 `operationUuid` 连续提交两次只生成一条记录；
- 内部编号按本单位数据库和年度递增，例如 `CERT-2026-0001`；
- 打印失败不回滚已成功保存的证明；
- 历史记录保存模板版本、正文、字段值和两位居民快照；
- 作废必须有原因并保留原记录；
- 记录禁止物理删除。

- [ ] **Step 6: 实现草稿、开具、复制和作废事务**

接管：

- `GET/POST /certificate-records`；
- `GET/PATCH /certificate-records/:id`，仅允许保存草稿；
- `POST /certificate-records/:id/issue`；
- `POST /certificate-records/:id/copy`，返回未保存的新草稿数据；
- `POST /certificate-records/:id/void`。

编号序列保存在 `foundationCertificateSequences[year]`，在单次 `store.update()` 事务内分配。数据库本身按单位隔离，因此序列天然按单位区分；存在单位代码时使用单位代码前缀，否则使用 `CERT`。开具成功写中文操作日志。

- [ ] **Step 7: 扩展记录筛选字段**

在 `foundation-business-service.js` 的分页筛选中支持证明类型、开具日期区间、状态、姓名、身份证号和内部编号；保留旧 `certificateRecords`/`certificates` 镜像读取，防止 AI 查询和旧记录页失效。

- [ ] **Step 8: 运行主进程测试**

Run: `node --test app/tests/main/foundation-certificate-service.test.js app/tests/main/foundation-domains.test.js app/tests/main/foundation-business-service.test.js`

Expected: 证明相关测试全部通过；已有财务、土地、居民业务测试继续通过。

## 任务 3：增加证明 Word 模板归档、导出和打印能力

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/main/certificate-document-service.js`
- Modify: `app/src/main/index.js`
- Modify: `app/src/main/ipc-handlers.js`
- Modify: `app/src/shared/ipc-contract.js`
- Modify: `app/src/preload/index.js`
- Create: `app/tests/main/certificate-document-service.test.js`
- Modify: `app/tests/main/ipc-handlers.test.js`

- [ ] **Step 1: 增加 `.docx` 占位符替换依赖**

Run: `npm --prefix app install pizzip@3.2.0 --save-exact`

Expected: 仅更新 `pizzip` 及其锁文件依赖，不更换 Electron、构建器或前端框架。

- [ ] **Step 2: 写 Word 模板安全归档和变量检查测试**

验证只接受普通 `.docx` 文件，拒绝符号链接和损坏压缩包；读取 `word/document.xml` 和页眉页脚中的中文大括号变量；缺失变量返回具体列表；归档文件复制到当前单位数据目录而不依赖原文件路径。

- [ ] **Step 3: 实现 `CertificateDocumentService`**

提供：

- `selectAndArchiveWordTemplate(templateId)`；
- `inspectWordTemplate(filePath)`；
- `renderWordTemplate(templateSnapshot, values)`；
- `exportCertificate(record, 'docx'|'pdf')`；
- `printCertificate(record)`。

`.docx` 使用 `pizzip` 替换正文、页眉和页脚的 `{中文字段}`，保留原版式。没有上传 Word 时，把证明快照转换为现有 `DocumentExportService` 可接受的 A4 HTML/文本结构。内部编号只用于文件元数据和默认文件名，正文生成函数不接收内部编号变量。

- [ ] **Step 4: 增加 IPC 契约和 preload 方法**

新增：

- `selectCertificateWordTemplate`；
- `inspectCertificateWordTemplate`；
- `exportCertificateDocument`；
- `printCertificateDocument`。

所有入参先转为普通可克隆对象；主进程根据记录 ID 重新读取已保存快照，不信任渲染进程传入的正文。

- [ ] **Step 5: 写导出与打印失败恢复测试**

测试 Word 输出不含内部编号、双人字段均正确替换、系统 A4 后备可导出 Word/PDF；模拟打印失败后记录仍为“有效”且可再次打印。

- [ ] **Step 6: 运行文件服务与 IPC 测试**

Run: `node --test app/tests/main/certificate-document-service.test.js app/tests/main/ipc-handlers.test.js`

Expected: 测试生成的 docx 可重新解压读取，正文无未替换字段，IPC 错误均为可理解中文。

## 任务 4：让“证明管理”菜单进入新的独立扩展页

**Files:**
- Modify: `app/src/renderer/foundation/extensions.mjs`
- Create: `app/src/renderer/js/certificate-management-ui.js`
- Create: `app/src/renderer/foundation/certificate-management.css`
- Create: `app/tests/renderer/certificate-management-ui.test.js`

- [ ] **Step 1: 写扩展路由和菜单复用测试**

断言“证明管理”现有菜单仍只有一个，不新增重复侧栏项；`tab-certificate` 映射到 `/certificate-workspace`；新模块和样式按需加载；原 `/certificate` 页面仍可用于历史兼容排查但不作为日常入口。

- [ ] **Step 2: 扩展路由定义支持复用现有菜单**

给 `extensions.mjs` 的定义增加 `tab`、`menuKey`、`insertMenu` 配置。注册：

```js
{
  key: 'certificate-workspace',
  tab: 'tab-certificate',
  menuKey: 'certificate',
  path: '/certificate-workspace',
  insertMenu: false,
  async mount(host) { /* 加载模型、CSS 和 UI */ }
}
```

路由组件继续使用现有“离开时停放 DOM、返回时恢复未完成表单”的机制。

- [ ] **Step 3: 建立页面状态机和 API 适配器**

`certificate-management-ui.js` 只维护可序列化状态：`activeTab`、模板、当前草稿、当事人候选、预览、记录筛选、模板编辑器。统一通过 `window.api.businessRequest()` 调用 `/api/v3`，并将服务错误转成中文页内提示。

- [ ] **Step 4: 实现三个顶部页签的空壳和加载状态**

页签固定为“开具证明、开具记录、模板管理”。不渲染“快速开具、批量开具、上传 Excel、字段映射、新建批次”。加载失败提供“重新加载”，不能显示空白页面。

- [ ] **Step 5: 运行路由和基础 UI 测试**

Run: `node --test app/tests/renderer/certificate-management-ui.test.js`

Expected: 新路由加载成功、侧栏没有重复入口、三个页签均可切换并保持状态。

## 任务 5：实现居民联想、动态表单和实时 A4 预览

**Files:**
- Modify: `app/src/renderer/js/certificate-management-ui.js`
- Modify: `app/src/renderer/foundation/certificate-management.css`
- Modify: `app/tests/renderer/certificate-management-ui.test.js`
- Modify: `app/tests/renderer/foundation-fixture.html`
- Modify: `app/tests/renderer/foundation-scenarios.mjs`

- [ ] **Step 1: 写姓名联想和同名候选交互测试**

模拟输入姓名后出现候选卡片；卡片显示姓名、组别、出生日期/年龄、户主/关系、身份证识别信息；同名时必须点击确认；按身份证号/户号也可检索；键盘上下键、回车和 Esc 可操作。

- [ ] **Step 2: 实现防抖搜索组件**

输入 2 个中文字符、4 位身份证/户号字符或完整姓名后等待约 200ms 查询。选中后显示“来自一户一档”浅绿色来源标识、只读字段和“重新选择”“去一户一档更正”。不在证明页提供档案字段编辑。

- [ ] **Step 3: 实现单人、双人和家庭对象**

每个对象维护独立候选与快照。更换某位居民时只清除该对象关联值；关系证明中的“双方关系”等字段由人工填写。增加明确的“临时人员开具”入口，人工资料显示橙色标识且不写回居民库。

- [ ] **Step 4: 实现按模板生成的动态字段**

支持居民选择、档案只读、家庭资料、土地资料、单行文字、多行说明、日期、数字、选项和系统自动字段。必填、来源、顺序和说明来自当前模板版本。

- [ ] **Step 5: 实现实时 A4 预览和明确校验**

左侧变化后立即重新渲染右侧 A4。未选居民、档案缺字段、人工必填为空、正文仍含 `{字段}` 时，在对应字段旁和底部核对区显示具体中文提示。切换已有内容的模板时弹出“保留居民选择/重新开始”，只复用新模板需要的居民。

- [ ] **Step 6: 完成布局和动画**

桌面宽屏采用顶部模板区、左侧表单、右侧 A4、底部固定操作栏；窄窗口改为上下布局。切换模板、候选展开和预览更新使用 150–200ms 的淡入/位移动画；尊重 `prefers-reduced-motion`。固定操作栏为 AI 悬浮入口预留空间。

- [ ] **Step 7: 运行交互测试**

Run: `node --test app/tests/renderer/certificate-management-ui.test.js`

Expected: 单人、双人、临时人员、同名候选、更换居民、模板切换和校验场景全部通过。

## 任务 6：实现保存草稿、确认开具并打印

**Files:**
- Modify: `app/src/renderer/js/certificate-management-ui.js`
- Modify: `app/src/renderer/foundation/certificate-management.css`
- Modify: `app/tests/renderer/certificate-management-ui.test.js`
- Modify: `app/tests/renderer/foundation-scenarios.mjs`

- [ ] **Step 1: 写操作栏和重复点击测试**

验证底部始终能看到“保存草稿”“打印预览”“确认开具并打印”；存在错误时主按钮不可提交并定位第一个问题；连续双击只发送一个 `operationUuid` 请求。

- [ ] **Step 2: 实现草稿保存和离开保护**

保存草稿后记录状态为“草稿”。页面未保存时关闭/切换页签给出提示；扩展页被暂存后返回仍保留表单。

- [ ] **Step 3: 实现打印预览**

打印预览不产生正式编号，可选择系统 A4 或已上传 Word 版式；Word 变量不完整时列出字段并允许改用系统 A4。

- [ ] **Step 4: 实现“确认开具并打印”**

先调用开具事务取得唯一记录，再调用打印 IPC。打印成功显示内部编号和“查看开具记录”；打印失败显示“证明已保存，可从记录重新打印”，不得再次创建记录。

- [ ] **Step 5: 运行开具流程测试**

Run: `node --test app/tests/renderer/certificate-management-ui.test.js`

Expected: 正常打印、取消打印、打印失败、重复点击均只保存一份有效证明。

## 任务 7：重做开具记录

**Files:**
- Modify: `app/src/renderer/js/certificate-management-ui.js`
- Modify: `app/src/renderer/foundation/certificate-management.css`
- Modify: `app/tests/renderer/certificate-management-ui.test.js`

- [ ] **Step 1: 写查询、快照和作废交互测试**

覆盖按姓名、身份证号、证明类型、日期、内部编号和状态查询；查看历史记录时使用开具快照而非当前模板；作废未填原因不能提交。

- [ ] **Step 2: 实现紧凑记录列表和详情抽屉**

每行显示证明类型、当事人、开具日期、经办人、内部编号和状态。详情明确显示“开具时第 N 版”、字段快照和证明预览，不显示内部编码式原始数据。

- [ ] **Step 3: 实现记录操作**

提供“查看、重新打印、导出 Word、导出 PDF、复制开具、作废”。复制开具进入新草稿并重新生成开具日期/经办人/内部编号；作废记录仍可查看和导出且标出原因。

- [ ] **Step 4: 保留旧批量历史可见性**

旧批量记录在记录列表中显示“历史批量导入”来源标签，可以查看已有快照；不再出现新建批量入口。无法完整还原的旧字段显示中文名称和原值，不抛异常。

- [ ] **Step 5: 运行记录页测试**

Run: `node --test app/tests/renderer/certificate-management-ui.test.js`

Expected: 所有筛选和操作成功，模板后来修改不会改变历史预览。

## 任务 8：重做可视化模板管理

**Files:**
- Modify: `app/src/renderer/js/certificate-management-ui.js`
- Modify: `app/src/renderer/foundation/certificate-management.css`
- Modify: `app/tests/renderer/certificate-management-ui.test.js`

- [ ] **Step 1: 写内置模板可编辑和版本发布测试**

验证系统模板与自建模板都能编辑；首次为“第 1 版”，发布修改为“第 2 版”；列表不展示时间戳长编号；有历史记录的模板只有停用，没有物理删除。

- [ ] **Step 2: 实现模板列表**

卡片/表格显示名称、分类、适用对象、当前版次、使用状态、Word 版式状态和最近修改时间，提供“编辑、复制、试开、停用/启用、删除（仅未使用自建）、恢复默认”。

- [ ] **Step 3: 实现字段可视化编辑器**

字段可以新增、删除、重命名、拖动排序，设置类型、来源、必填和对应对象。界面只显示中文标签和来源说明，不要求工作人员填写内部键名或代码。

- [ ] **Step 4: 实现正文与字段联动**

点击字段即可在光标处插入字段标签；删除已在正文使用的字段时明确警告；正文右侧实时显示测试预览；保存草稿与“试开后发布”分开。

- [ ] **Step 5: 实现 Word 版式管理**

提供“上传/替换 Word 版式、检查字段、移除版式”。检查结果用中文列出“模板需要但 Word 缺少”和“Word 存在但模板未定义”的字段。

- [ ] **Step 6: 运行模板页测试**

Run: `node --test app/tests/renderer/certificate-management-ui.test.js`

Expected: 新增、复制、编辑、试开、发布、停用、恢复默认及 Word 检查全部通过。

## 任务 9：端到端视觉与性能验证

**Files:**
- Modify: `app/tests/renderer/foundation-dom-check.mjs`
- Modify: `app/tests/renderer/foundation-scenarios.mjs`
- Modify: `app/tests/renderer/foundation-electron-check.cjs`

- [ ] **Step 1: 增加证明管理浏览器场景**

在 10,000 条合成居民数据下进入 `/certificate-workspace`，搜索同名居民、完成双人关系证明、保存草稿、开具、查看记录、复制和作废。记录搜索请求时间和页面交互时间。

- [ ] **Step 2: 增加布局截图检查**

至少捕获：开具空态、同名候选展开、已选双人实时预览、模板编辑、开具记录五种状态。检查 A4 未被裁切、操作栏未被 AI 遮挡、候选不超出窗口、窄窗口无水平溢出。

- [ ] **Step 3: 运行 DOM 场景**

Run: `node app/tests/renderer/foundation-dom-check.mjs forms`

Expected: 输出 `ok: true`，证明管理场景无控制台异常；居民候选查询与输入反馈在日常机器上无明显卡顿。

- [ ] **Step 4: 运行 Electron 开发版检查**

Run: `node app/tests/renderer/foundation-electron-check.cjs`

Expected: Electron 打开开发数据副本，新证明页可用，preload 只暴露计划内 IPC，关闭窗口无残留进程。

## 任务 10：全量回归和用户开发版验收

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-certificate-management-redesign-design.md`（仅在实现事实与已确认方案有必要同步时）
- Modify: `docs/superpowers/plans/2026-09-14-certificate-management-redesign.md`（勾选完成项并记录验证结果）

- [ ] **Step 1: 检查本轮差异范围**

Run: `git status --short`

Run: `git diff -- app/src/shared/certificate-management-model.js app/src/main/foundation-certificate-service.js app/src/main/certificate-document-service.js app/src/main/foundation-business-service.js app/src/main/foundation-domains.js app/src/main/foundation-certificate-templates.json app/src/main/index.js app/src/main/ipc-handlers.js app/src/shared/ipc-contract.js app/src/preload/index.js app/src/renderer/foundation/extensions.mjs app/src/renderer/foundation/certificate-management.css app/src/renderer/js/certificate-management-ui.js app/tests docs/superpowers`

Expected: 只有证明管理及必要 IPC/依赖/测试变更；不包含版本号、发布清单、打包产物和用户正式数据。

- [ ] **Step 2: 运行完整测试**

Run: `npm --prefix app test`

Expected: 全部 Node 测试通过。

- [ ] **Step 3: 运行语法和空白检查**

Run: `node --check app/src/shared/certificate-management-model.js && node --check app/src/main/foundation-certificate-service.js && node --check app/src/main/certificate-document-service.js && node --check app/src/renderer/js/certificate-management-ui.js`

Run: `git diff --check`

Expected: 全部退出码为 0。

- [ ] **Step 4: 用开发模式启动并验收主流程**

Run: `npm run dev`

Expected: 开发窗口持续打开；修改证明页面源码后自动刷新；修改主进程或 preload 后 Electron 自动重启。人工验收：

1. 姓名输入后出现候选并正确带入锁定身份证号；
2. 双人关系证明不会串人；
3. 模板可编辑、发布为易读新版本；
4. 确认开具后直接进入打印；
5. 记录能重打、导出、复制和作废；
6. 打印件无内部编号；
7. 页面无批量开具入口；
8. 正式安装版和正式数据未改变。

- [ ] **Step 5: 记录开发版验收结果**

在本计划末尾记录实际执行的测试、截图路径和仍需用户确认的视觉细节。只有用户之后明确说“准备发布”时，才进入版本号、发行说明、本机更新包和应用内更新流程。

