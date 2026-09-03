# 资金发放中心在线表格与 Excel 导入实施计划

> 已确认范围：只在本地开发与测试；不打包、不推送、不发布。

## 1. 扩展领域模型与兼容迁移

**文件**：

- 修改 `app/src/shared/contract-fee-model.js`
- 修改 `app/src/main/empty-database.js`
- 修改 `app/tests/shared/contract-fee-model.test.js`
- 修改 `app/tests/main/database-store.test.js`

**工作内容**：

1. 将当前仅字符串数组形式的 `disbursementTemplates.fields` 升级为字段对象：键、显示名、列宽、来源（居民／批次／手工／计算）、数据类型、计算配置和是否打印。
2. 为旧模板和旧批次补齐兼容默认值，保证既有工资、公共服务、杂工和承包费数据仍可打开、编辑和打印。
3. 扩展模板的标题、单位、方向、签名栏、页码及打印选项；保留内置模板，同时支持复制和空白新建。
4. 扩展批次与明细：导入来源、原始列值、字段映射、模板快照、编辑记录、银行卡处理选择、居民匹配状态和同步结果。
5. 将批次状态规范为 `draft`（核对中）、`prepared`（准备打印）、`printed`（已打印）、`completed`（发放完成），完成后拒绝直接编辑；新增更正批次引用原批次并保存原因。
6. 复用 `bankAccounts` 和 `setDefaultBankCard`，新增“仅本次使用”与“同步居民档案”两种账户变更结果，确保多卡且仅一张默认卡。

**验证**：为字段兼容、模板快照、金额人工调整原因、银行卡同步策略、批次锁定与更正批次补充模型单元测试。

## 2. 新增通用发放 Excel 导入与导出服务

**文件**：

- 新增 `app/src/shared/disbursement-excel-parser.js`
- 修改 `app/src/main/contract-fee-file-service.js`
- 修改 `app/src/shared/ipc-contract.js`
- 修改 `app/src/main/ipc-handlers.js`
- 修改 `app/src/preload/index.js`
- 新增 `app/tests/shared/disbursement-excel-parser.test.js`
- 修改 `app/tests/main/contract-fee-file-service.test.js`
- 修改 `app/tests/preload/ipc-contract.test.js`
- 修改 `app/tests/main/ipc-handlers.test.js`

**工作内容**：

1. 基于现有 Excel 原始单元格读取能力，识别工作表、标题行、表头、数据行与常用字段别名（姓名、身份证、组别、银行卡、金额、单价、数量、月份、备注等）。
2. 保留每行原始字段值、原始工作表名称和行号，避免银行卡或身份证在导入时被 Excel 科学计数法破坏。
3. 当表头无法可靠识别时，返回“字段映射确认”所需的列名和样例行，不直接写入批次。
4. 提供通用的“导入发放明细”IPC；保留承包费、地力补贴既有专用导入接口不变。
5. 以模板快照导出当前发放表；打印数据和导出数据均来自同一批次快照，保证一致。

**验证**：用工资、杂工、承包费三类样例测试表头识别、银行卡原样保留、字段映射回退和批次行数据生成。

## 3. 实现居民匹配、冲突核对与发放完成同步

**文件**：

- 修改 `app/src/shared/contract-fee-model.js`
- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/renderer/js/resident-subsidy-profile.js`
- 修改 `app/tests/shared/contract-fee-model.test.js`
- 修改 `app/tests/renderer/contract-fee-workspace.test.js`
- 修改 `app/tests/renderer/resident-subsidy-profile.test.js`

**工作内容**：

1. 导入后按身份证优先、姓名加组别其次匹配居民；同名、多候选、卡号不同或未找到居民均生成待处理项。
2. 在待处理界面支持逐条与全选批量确认；只有唯一且安全的匹配才允许批量处理，重名仍要求人工选人。
3. 点击“发放完成”前生成同步清单：相同卡号、仅本次使用、新增银行卡、更新默认银行卡和未同步项目分别列示。
4. 提交完成时只对已确认的居民写入银行卡资料；写入记录来源、旧值、新值、操作人选择和时间，失败可重试且不重复新增卡。
5. 居民资料标签页显示多张卡、默认卡和发放来源；现有补贴资料显示能力保持不变。

**验证**：覆盖身份证匹配、姓名加组别匹配、重名拦截、卡号冲突选择、批量安全边界、完成同步和失败重试。

## 4. 重构资金发放中心为在线表格工作台

**文件**：

- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/renderer/css/contract-fee-workspace.css`
- 修改 `app/src/renderer/index.html`（只在需要增加容器或资源版本号时）
- 修改 `app/tests/renderer/contract-fee-workspace.test.js`

**工作内容**：

1. 模板管理页支持查看、复制、从空白新建、编辑字段来源与打印配置；不提供自由合并单元格。
2. 新建批次页支持选择模板、选择居民、导入 Excel；选择居民后自动填充居民档案字段与默认卡。
3. 在线表格支持单元格编辑、增删行、金额自动计算、人工修改原因、人员重新关联和银行卡变更确认弹窗。
4. 批次详情页显示模板快照、导入信息、待处理数、同步状态和更正批次入口；完成状态页面只读。
5. 所有操作统一经过现有局部事件绑定，避免大表格渲染时按钮失效或点击无响应。

**验证**：覆盖模板创建／复制、导入入口、行编辑、重名选择、卡号确认、状态转换及历史批次只读。

## 5. 按模板生成预览与打印页面

**文件**：

- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/renderer/css/contract-fee-workspace.css`
- 修改 `app/tests/renderer/contract-fee-workspace.test.js`

**工作内容**：

1. 新增打印预览视图：左侧打印设置、中间纸张成品、右侧页面缩略图。
2. 按模板字段和列宽生成表格，支持 A4/A5、横竖版、每页人数、银行卡显示和签名栏控制。
3. 依据每页人数自动分页；编辑表格后预览即时更新。
4. 打印确认后记录打印时间与设置，打印内容使用批次快照，不受后续模板变更影响。

**验证**：检查工资 A5 十人分页、承包费 A4 分页、模板列显示、总计与页面计数、编辑后实时更新。

## 6. 全量回归与本地交付

**文件**：仅在第 1—5 步涉及的测试文件内补充测试。

**工作内容**：

1. 执行新增的模型、解析、文件服务、预加载和渲染测试。
2. 执行桌面端全量测试，核对既有合同台账、地力补贴、居民资料与发放模板功能没有回归。
3. 使用本地应用进行一次导入→核对→编辑→预览→发放完成→居民银行卡查询的人工验证。
4. 仅本地提交与保留修改；不创建版本、不打包、不推送、不发布。
