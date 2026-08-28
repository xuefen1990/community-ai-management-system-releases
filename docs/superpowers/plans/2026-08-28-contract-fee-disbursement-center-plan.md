# 承包费发放中心实施计划

日期：2026-08-28
状态：待用户审阅实施计划
对应设计：`docs/superpowers/specs/2026-08-28-contract-fee-disbursement-center-design.md`

## 1. 实施目标

在不破坏现有居民、土地、财务、单位共享和备份能力的前提下，新增可维护的“资金发放中心”底座，并完成第一阶段承包费发放功能：

- 建立独立合同档案；
- 首次从 Excel 建立合同发放台账；
- 在已选组内按姓名匹配居民并补齐银行卡；
- 从长期台账生成实际发放批次；
- 自动计算、人工调整、差额说明和历史快照；
- 每组导出一个独立 Excel 文件；
- 记录线下转账结果、异常人员、历史欠发；
- 独立记录承包方缴费、少量垫付及冲回；
- 支持续签合同复制旧台账。

本计划只写实施步骤，不在计划阶段修改功能代码。

## 2. 当前项目约束

- 本地数据库由 `app/src/main/empty-database.js`、`database-store.js` 和 `remote-database-store.js` 共同维护。
- 登录单位后，业务数据通过后端单位共享工作区同步；新增数据集合必须加入后端权限映射。
- 居民主档存放在 `personnel`，组别主要使用 `village_group`；历史数据还存在兼容字段，不能只读取一种字段名。
- 土地档案存放在 `landParcel`，已有地块编号、面积、承包人身份证号、合同起止日期等字段，但不具备完整的“一份合同关联多个地块”能力。
- 现有 Excel 读取和 XLSX 依赖可以复用，但人员导入解析器强制身份证号，不适合承包费表，必须新增专用解析器。
- `app/src/renderer/renderer.js` 体积大且经过混淆。新业务逻辑必须放在独立模块，避免直接向该文件继续堆叠逻辑。
- 现有工作区有其他未提交改动；实施时每个提交只能包含本功能实际修改的文件。

## 3. 建议的数据集合

数据库版本由 3 升级为 4，新增以下数组；旧数据库读取时自动补为空数组，不迁移或覆盖原记录：

- `resourceContracts`：合同档案及关联地块；
- `contractFeeLedgers`：一份合同对应的一套长期发放台账；
- `contractFeeBatches`：每次实际发放及冻结快照；
- `contractFeeReceipts`：承包方足额缴费记录；
- `contractFeeAdvances`：居委会垫付与冲回记录。

居民银行卡使用 `personnel[].bankAccounts` 数组，单项包含卡号、是否默认、来源、创建和更新时间。读取时兼容旧的 `bank_card`、`bank_account` 等字段；写入新数据时以 `bankAccounts` 为准，并同步默认卡兼容字段，避免旧页面读取不到。

金额在业务模型中统一转换为“分”的整数计算，界面和 Excel 再格式化为元，避免小数乘法误差。

## 4. 实施顺序

### 任务 1：建立数据库 v4 骨架与兼容测试

涉及文件：

- 修改 `app/src/main/empty-database.js`
- 修改 `app/src/main/database-store.js`
- 修改 `app/src/main/remote-database-store.js`
- 修改 `app/tests/main/database-store.test.js`
- 新建 `app/tests/main/remote-database-store.test.js`

步骤：

1. 先添加失败测试，验证空数据库包含五个新集合且版本为 4。
2. 添加旧版数据库兼容测试：读取版本 3 数据时保留全部原记录，并自动补齐新集合。
3. 添加远程工作区归一化测试，保证缺失集合不会变成 `undefined`。
4. 实现数据库默认值和兼容归一化。
5. 运行：`node --test app/tests/main/database-store.test.js app/tests/main/remote-database-store.test.js`。

完成标准：旧数据无损，新旧本地/远程数据库都能稳定返回完整结构。

### 任务 2：实现纯业务模型

涉及文件：

- 新建 `app/src/shared/contract-fee-model.js`
- 新建 `app/tests/shared/contract-fee-model.test.js`

业务模型提供可同时在 Node 测试和渲染层使用的纯函数：

- 读取居民姓名、组别、状态和默认银行卡的兼容字段；
- 规范化卡号和金额；
- 按人口、亩数或直接金额计算；
- 生成合同、台账、发放批次、收款和垫付记录；
- 汇总各组小计、居民发放总额和合同差额；
- 校验人工调整原因和合同差额说明；
- 冻结批次居民快照；
- 计算草稿、待核对、已导出、部分完成和已完成状态；
- 把未成功居民保留为待处理或历史欠发；
- 更换台账居民但不修改历史批次；
- 复制续签合同台账；
- 标记垫付待冲回和已冲回。

测试覆盖金额精度、状态转换、历史快照不变、人员替换、部分失败、差额说明、垫付冲回和非法状态转换。

运行：`node --test app/tests/shared/contract-fee-model.test.js`。

完成标准：所有资金和状态规则不依赖页面即可验证。

### 任务 3：实现承包费 Excel 专用解析与居民匹配

涉及文件：

- 新建 `app/src/shared/contract-fee-excel-parser.js`
- 新建 `app/tests/shared/contract-fee-excel-parser.test.js`
- 扩展 `app/src/shared/contract-fee-model.js`
- 扩展 `app/tests/shared/contract-fee-model.test.js`

步骤：

1. 先写表头识别测试，覆盖标题行以及姓名、人口/人数、亩数/面积、单价、金额、卡号/银行卡号等别名。
2. 测试过滤空白行、合计行、填表说明和尾部备注。
3. 测试金额、面积、人口和卡号的规范化，同时保留原始单元格内容供核对。
4. 实现“已选组范围 + 姓名”匹配：唯一匹配、未匹配、跨组同名和组内重复分别返回明确状态。
5. 实现人工指定居民后的重新校验。
6. 测试首次确认时写入默认银行卡；后续卡号不一致时只产生“待确认变更”，不得静默覆盖。

运行：`node --test app/tests/shared/contract-fee-excel-parser.test.js app/tests/shared/contract-fee-model.test.js`。

完成标准：没有身份证号的承包费表也能安全建台账，所有歧义必须显式确认。

### 任务 4：实现合同附件、Excel 预览与按组导出服务

涉及文件：

- 新建 `app/src/main/contract-fee-file-service.js`
- 新建 `app/tests/main/contract-fee-file-service.test.js`
- 修改 `app/src/shared/ipc-contract.js`
- 修改 `app/src/preload/index.js`
- 修改 `app/src/main/ipc-handlers.js`
- 修改 `app/tests/main/ipc-handlers.test.js`
- 修改 `app/tests/preload/ipc-contract.test.js`

新增受控接口：

- 选择并读取承包费 Excel，调用专用解析器返回预览；
- 选择合同附件并复制到本系统受控附件目录；
- 选择导出文件夹；
- 按组生成独立 `.xlsx` 文件。

导出服务必须：

- 清理文件名中的非法字符；
- 防止写出用户选择目录之外；
- 每组生成一个文件，包含合同名称、完整合同期限、发放日期、姓名、人口/亩数、单价、最终金额和卡号；
- 在末尾写入组内合计；
- 单个文件失败时返回明确结果，不把批次误标为已导出。

测试使用临时目录和真实 XLSX 文件验证文件名、分组、数值、合计、取消选择和错误返回。

运行：`node --test app/tests/main/contract-fee-file-service.test.js app/tests/main/ipc-handlers.test.js app/tests/preload/ipc-contract.test.js`。

完成标准：渲染页面不直接任意访问文件系统，导入、附件和导出都经过受控接口。

### 任务 5：建立合同档案与土地关联

涉及文件：

- 扩展 `app/src/shared/contract-fee-model.js`
- 扩展 `app/tests/shared/contract-fee-model.test.js`
- 新建 `app/src/renderer/js/contract-fee-workspace.js`
- 新建 `app/src/renderer/css/contract-fee-workspace.css`
- 修改 `app/src/renderer/index.html`
- 新建 `app/tests/renderer/contract-fee-workspace.test.js`

步骤：

1. 在资金发放中心提供合同列表、新建、编辑、附件、到期状态和发放台账入口。
2. 合同字段包括名称/编号、承包方、资源类型、合同金额、完整起止日期、备注和附件。
3. 支持从现有 `landParcel` 中选择一个或多个地块关联到合同。
4. 不自动把旧地块转成合同，避免错误地把多个地块拆成多份合同；在合同表单中提供“从已有地块带入”操作。
5. 在土地详情中增加“查看/建立对应合同与发放台账”的快捷入口。
6. 到期提醒沿用完整合同起止日期，不创建五个预拆分周期。

UI 测试验证资金发放中心菜单、页面骨架、合同必填字段和土地快捷入口均存在；纯模型测试验证合同金额、期限和关联地块。

完成标准：一份合同可以关联多个地块，并成为发放台账的唯一业务依据。

### 任务 6：实现资金发放中心页面骨架

涉及文件：

- 扩展 `app/src/renderer/index.html`
- 扩展 `app/src/renderer/css/contract-fee-workspace.css`
- 扩展 `app/src/renderer/js/contract-fee-workspace.js`
- 扩展 `app/tests/renderer/contract-fee-workspace.test.js`
- 修改 `backend/src/services/unitWorkspaceService.js`
- 修改 `backend/tests/admin-console.test.js` 或新增单位工作区权限测试

页面包含：

- 发放总览；
- 合同发放台账；
- 发放记录；
- 待处理事项。

实现要求：

- 新页面逻辑独立，不写入混淆的 `renderer.js`；
- 复用现有主题变量、表格、弹窗和按钮风格；
- 支持窄窗口下的堆叠和横向表格滚动；
- 登录单位时正常响应共享工作区变更事件；
- 第一阶段把新增数据集合映射到现有 `finance` 权限，避免同步时成员看不到或写不回；
- 单位管理员保持完整权限，普通成员遵守财务查看、修改和导出权限。

运行：`node --test app/tests/renderer/contract-fee-workspace.test.js` 和 `npm test --prefix backend`。

完成标准：新入口不破坏现有页面切换，权限和远程共享行为正确。

### 任务 7：完成首次 Excel 建台账向导

涉及文件：

- 扩展 `app/src/renderer/js/contract-fee-workspace.js`
- 可按职责拆分新建 `app/src/renderer/js/contract-fee-import-ui.js`
- 扩展 `app/src/renderer/css/contract-fee-workspace.css`
- 新建或扩展 `app/tests/renderer/contract-fee-import-ui.test.js`

向导步骤：

1. 选择尚无台账的合同；
2. 上传 Excel；
3. 勾选一个或多个涉及组；
4. 确认字段识别；
5. 查看匹配、同名、未匹配、金额差异和卡号异常；
6. 手动解决歧义；
7. 确认建立台账并补齐居民银行卡。

保存前再次读取最新数据库并验证合同仍无台账，防止重复创建。保存失败时页面保留预览和人工选择，便于重试。

完成标准：Excel 只承担首次建台账，不在后续发放页面提供“每年重新导入”入口。

### 任务 8：完成长期台账维护与人员变更

涉及文件：

- 扩展 `app/src/renderer/js/contract-fee-workspace.js`
- 可按职责拆分新建 `app/src/renderer/js/contract-fee-ledger-ui.js`
- 扩展模型与对应测试

功能：

- 按合同、组别和人员状态查看台账；
- 编辑人口、亩数、单价、直接金额和默认卡；
- 居民去世、迁出或状态变化时显示提醒但不自动删除；
- 支持停止发放或直接替换为新的居民；
- 替换必须记录原因，只影响未来批次；
- 后续发现不同卡号时弹出确认，不静默覆盖居民主档；
- 续签合同可复制旧合同台账。

完成标准：台账是长期来源，历史批次是冻结快照，两者修改互不反向污染。

### 任务 9：完成发放批次计算、核对和冻结

涉及文件：

- 扩展 `app/src/renderer/js/contract-fee-workspace.js`
- 可按职责拆分新建 `app/src/renderer/js/contract-fee-batch-ui.js`
- 扩展模型与对应测试

流程：

1. 从合同台账创建草稿批次；
2. 保存合同完整期限和当次实际发放日期；
3. 自动计算每人金额；
4. 人工调整必须填写原因并同时显示系统计算值；
5. 汇总各组小计和居民发放总额；
6. 与合同金额比较，存在未发给居民的差额时要求说明用途；
7. 未解决人员或银行卡异常时保持草稿或待核对；
8. 核对通过后冻结居民、组别、卡号、计算依据和金额快照。

完成标准：任何已核对或已完成批次都不会因主档和台账变化而改写。

### 任务 10：完成按组导出与线下转账确认

涉及文件：

- 扩展 `app/src/renderer/js/contract-fee-batch-ui.js`
- 扩展相关模型、主进程服务和测试

功能：

- 调用受控导出服务，每组生成独立 Excel；
- 所有组导出成功后把批次标为“已导出”；
- 线下转账后支持整批成功确认；
- 支持把个别卡号错误、退回或未成功人员标为待处理；
- 部分成功时批次为“部分完成”；
- 异常人员处理完毕后才进入“已完成”；
- 某次未发金额保留为原批次的历史欠发，不自动并入下一批。

完成标准：批次总状态可由个人结果可靠推导，不允许界面直接写出自相矛盾状态。

### 任务 11：完成收款、垫付和冲回

涉及文件：

- 扩展 `app/src/renderer/js/contract-fee-workspace.js`
- 扩展模型与对应测试

功能：

- 合同收款只提供未缴、已足额缴纳和实际缴费日期；
- 未缴时仍允许创建居民发放批次；
- 发放批次可标记资金来源为合同款或居委会垫付；
- 垫付记录包含金额、日期和对应批次；
- 承包款到账后提示待冲回垫付款；
- 人工确认后记录冲回日期和已冲回状态。

完成标准：合同收款和居民发放独立，又能查询垫付与后续冲回关系。

### 任务 12：全量验证、文档与交付

涉及文件：

- 新建 `docs/features/contract-fee-disbursement-center.md`
- 按实际修改补充相关测试文件
- 如用户决定发布，再单独修改版本和发行说明

自动验证：

1. `npm test --prefix app`
2. `npm test --prefix backend`
3. `git diff --check`

人工验收：

- 首次单组、多组台账导入；
- 同名、未匹配、银行卡变化和金额差异；
- 按人口、亩数和直接金额计算；
- 人工调整及原因；
- 合同差额用途说明；
- 人员状态变化与替换；
- 每组独立 Excel 导出；
- 部分转账失败、历史欠发；
- 合同未收款先发、垫付和冲回；
- 续签合同复制台账；
- 本地账号和单位共享账号下的数据刷新；
- 浅色/深色主题和窄窗口布局；
- 现有居民、土地、财务、备份和恢复功能无回归。

交付规则：

- 只提交本功能实际修改的文件，不带入当前工作区已有改动；
- 验证通过后创建清晰提交并推送当前 `origin`；
- 本计划不自动创建版本标签。只有用户确认需要向已安装客户端发布时，才另行提高版本、补充发行说明并创建匹配标签。

## 5. 实施检查点

为降低一次性改动过大的风险，建议按以下检查点逐段完成：

1. 数据与纯模型通过测试；
2. Excel、附件和导出服务通过测试；
3. 合同档案和资金发放中心页面可用；
4. 首次建台账完整跑通；
5. 发放、导出、转账确认完整跑通；
6. 收款、历史欠发、垫付与续签完整跑通；
7. 全量测试和人工验收通过。

每个检查点完成后先查看差异和测试结果，再进入下一阶段。出现数据库兼容、远程版本冲突或导出文件异常时，停止推进并先修复该层问题。

## 6. 非本阶段事项

- 工资、杂工、地力补贴、秸秆补贴和稻谷补贴模板；
- 银行接口或自动转账；
- 承包方分期、少缴、多缴和补缴；
- 自动决定去世或迁出居民的权益归属；
- 复杂会计凭证或总账系统；
- 自动发布新版本。

这些事项不得在本阶段顺手加入，避免扩大范围和影响承包费主流程验收。
