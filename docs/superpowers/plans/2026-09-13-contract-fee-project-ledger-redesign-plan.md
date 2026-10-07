# 承包费项目台账重设计实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 在当前会话按任务实施。步骤使用复选框跟踪；遵循项目约定，只在开发模式预览，不打包、不安装、不发布。

**目标：** 在现有资金发放中心中实现按年度、承包项目和组别管理的长期台账，使同一组可以拥有多个互不混合的承包项目，并完成固定总额、核定总人口或亩数、自定义字段、人工尾差、按来源字段输出、签字明细表和各组汇总表。

**总体方案：** 继续使用 `contractFeeDistributionPlans` 表示年度承包项目，使用其 `groups` 表示各组独立计算方案，使用 `contractFeeDistributionBatches` 保存冻结快照；通过兼容归一化补充项目身份、家庭身份、自定义字段、核定依据总数和来源输出模板快照。新建专用承包费台账界面模块，现有资金工作台继续承担纸张预览和打印，主进程继续受控读取和导出电子表格。

**现有技术：** Electron 31、原生 JavaScript、Foundation 页面适配、Node `node:test`、`xlsx`、现有 JSON/单位共享工作区。

---

## 文件与职责

| 文件 | 计划变更 |
| --- | --- |
| `app/src/shared/contract-fee-model.js` | 扩展项目、组别、家庭、字段、公式、固定总额、参考单价和尾差纯模型。 |
| `app/src/shared/contract-fee-excel-parser.js` | 保留原始表头和自定义字段，识别户主、收款人、人口、亩数、银行卡并支持人工列映射。 |
| `app/src/main/contract-fee-file-service.js` | 新增项目成果文件导出；各组汇总和签字明细分别成表，银行卡按文本完整保存。 |
| `app/src/shared/ipc-contract.js` | 增加项目成果文件导出通道。 |
| `app/src/main/ipc-handlers.js` | 注册受控导出处理。 |
| `app/src/preload/index.js` | 暴露最小项目导出接口。 |
| `app/src/renderer/js/contract-fee-ledger-ui.js` | 新增承包费项目总览、导入向导、项目编辑、字段规则、尾差和年度复用界面。 |
| `app/src/renderer/css/contract-fee-ledger.css` | 新增效果稿对应的卡片、紧凑表格、固定工具栏、右侧规则栏和打印样式。 |
| `app/src/renderer/js/contract-fee-workspace.js` | 保留资金中心路由和数据桥接，调用新界面；修正批次与打印表按稳定明细编号同步。 |
| `app/src/renderer/index.html` | 在资金工作区之前加载新增样式和界面脚本。 |
| `app/src/renderer/foundation/extensions.mjs` | Foundation 入口按同样顺序加载新资源。 |
| `app/src/main/empty-database.js` | 为承包费年度方案和发放批次补充默认空集合。 |
| `backend/src/services/unitWorkspaceService.js` | 把两个承包费集合纳入现有财务权限。 |
| `app/tests/shared/contract-fee-model.test.js` | 覆盖项目、家庭、公式、固定总额和尾差。 |
| `app/tests/shared/contract-fee-excel-parser.test.js` | 覆盖自定义列、原始值、完整银行卡和独立导入。 |
| `app/tests/main/contract-fee-file-service.test.js` | 覆盖汇总表、签字表、共用卡双行和完整卡号。 |
| `app/tests/renderer/contract-fee-ledger-ui.test.js` | 新增页面结构、中文操作和加载顺序测试。 |
| `app/tests/renderer/workbench-dom-scenarios.js` | 增加真实交互场景和大台账分页场景。 |
| `app/tests/main/database-store.test.js` | 验证新增默认集合与旧数据兼容。 |
| `backend/tests/unit-workspace-contract-fee-permissions.test.js` | 验证新增集合继续使用财务权限。 |

## 任务 0：备份与基线检查

**涉及文件：** 不修改业务文件。

- [ ] 记录 `git status --short`，保存本次开始前已有的未提交修改清单，避免把其他工作误认为本次改动。
- [ ] 按用户 2026-09-13 最新决定，不备份旧软件、不复制旧版本；依靠现有源码差异和专项测试控制本次变更范围。
- [ ] 运行现有承包费模型、解析、文件服务和渲染结构测试，记录基线结果：

```bash
node --test app/tests/shared/contract-fee-model.test.js \
  app/tests/shared/contract-fee-excel-parser.test.js \
  app/tests/main/contract-fee-file-service.test.js \
  app/tests/renderer/contract-fee-workspace.test.js
```

- [ ] 确认根目录开发模式仍使用 `app/.dev/user-data`，不读取和写入正式应用数据。

完成标准：存在可回退备份和基线记录，未修改版本号、安装包或正式数据。

## 任务 1：补齐存储集合和财务权限

**涉及文件：**

- 修改 `app/src/main/empty-database.js`
- 修改 `backend/src/services/unitWorkspaceService.js`
- 修改 `app/tests/main/database-store.test.js`
- 修改 `backend/tests/unit-workspace-contract-fee-permissions.test.js`

- [ ] 先增加失败测试，要求空数据库包含 `contractFeeDistributionPlans` 和 `contractFeeDistributionBatches` 两个数组。
- [ ] 增加后端权限测试，要求两个集合都映射到现有 `finance` 权限。
- [ ] 在空数据库中补充两个空集合；保持现有数据库版本和其他集合不变，使用现有归一化自动兼容旧数据。
- [ ] 在单位共享工作区权限映射中补充两个集合，不新增权限名称。
- [ ] 运行：

```bash
node --test app/tests/main/database-store.test.js \
  backend/tests/unit-workspace-contract-fee-permissions.test.js
```

完成标准：本机和共享工作区均能保存年度项目及批次，普通财务权限账号不会丢失这两个集合。

## 任务 2：扩展承包项目、家庭和年度兼容模型

**涉及文件：**

- 修改 `app/src/shared/contract-fee-model.js`
- 修改 `app/tests/shared/contract-fee-model.test.js`

- [ ] 为旧年度方案增加兼容测试：没有项目身份、户主/收款人分离字段和自定义字段的旧记录仍能读取、复制和生成批次。
- [ ] 为“同一组两个独立项目”增加测试，确认两个方案的名单、金额、公式和批次互不影响。
- [ ] 扩展年度方案归一化：增加稳定项目编号和项目名称，同时兼容现有 `parcelName`。
- [ ] 扩展组别归一化：增加字段定义、计算依据字段、结构化公式、导入信息和输出列配置。
- [ ] 扩展家庭明细：增加家庭稳定编号、户主、收款人、收款居民、完整银行卡、自定义数据、原始导入数据和移出状态；继续保留现有字段供旧代码读取。
- [ ] 调整重复检查：序号、同名收款人和相同银行卡都不能作为家庭唯一身份；共用银行卡不拦截、不合并。仅同一项目内重复的家庭稳定编号需要人工处理。
- [ ] 调整年度复制：继承项目身份、家庭、银行卡、字段和公式，生成新的年度方案及明细编号；旧年度不变。
- [ ] 运行：

```bash
node --test app/tests/shared/contract-fee-model.test.js
```

完成标准：现有数据无需一次性迁移；同组多个项目和户主/收款人分离具有稳定数据身份。

## 任务 3：实现安全的自定义字段和固定总额计算

**涉及文件：**

- 修改 `app/src/shared/contract-fee-model.js`
- 修改 `app/tests/shared/contract-fee-model.test.js`

- [ ] 先写数字字段、计算字段、字段依赖、循环引用、除零、负数和删除被引用字段的失败测试。
- [ ] 使用结构化字段编号和运算符实现中文公式，不使用动态代码执行。
- [ ] 将人口、亩数和自定义数字转换成固定小数位整数参与计算，避免 JavaScript 小数误差。
- [ ] 为组别增加 `expectedBasisTotal`（核定总人口或亩数），计算 `actualBasisTotal` 和 `basisDifference`；旧数据没有核定值时以明细合计作为兼容值，不回写历史批次。
- [ ] 明细依据合计与核定总数不一致时返回中文校验错误，禁止生成批次、打印和正式导出；项目编辑页仍允许保存草稿并继续修正。
- [ ] 实现固定总额算法：参考单价向下保留到分；每户基础金额向下保留到分；尾差单独保存。
- [ ] 增加“大枣园”场景测试：核定 107.31 亩、固定总额 80,482.50 元时，参考单价为 750.00 元/亩，94 户明细合计严格一致且无尾差。
- [ ] 增加以下明确场景：

```text
一组：20,000.00 元 ÷ 253 人 → 79.05 元/人；基础合计 19,999.65 元；尾差 0.35 元。
二组：10,000.00 元 ÷ 143 人 → 69.93 元/人；尾差 0.01 元。
三组：20,000.00 元 ÷ 200.00 亩 → 100.00 元/亩；尾差 0.00 元。
```

- [ ] 实现“指定一户补入全部尾差”，分别保存基础金额、尾差补入和最终金额；只有差额为零才允许核对。
- [ ] 修改总额、公式、计发依据或家庭数值时清除失效尾差并重新计算。
- [ ] 保留旧版手工金额读取能力，但新的主流程只突出“尾差补入”，防止随意覆盖固定总额计算结果。
- [ ] 运行模型测试。

完成标准：显示单价和每户金额均精确到分，人工补入后每组最终金额严格等于固定总额。

## 任务 4：扩展每项目独立导入和字段映射

**涉及文件：**

- 修改 `app/src/shared/contract-fee-excel-parser.js`
- 修改 `app/src/main/contract-fee-file-service.js`
- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/tests/shared/contract-fee-excel-parser.test.js`
- 修改 `app/tests/main/contract-fee-file-service.test.js`

- [ ] 增加测试：大枣园和鱼塘分别导入后生成两个方案，不共享名单或原始字段。
- [ ] 扩展常用列识别：组别、户主、收款人、人口、亩数、银行卡、开户行、备注。
- [ ] 像现有通用发放解析器一样保留全部原始列、重复列名、未命名列、源行号和排除行原因。
- [ ] 文件读取返回全部工作表名称和每张表的预览；多工作表文件必须由用户选择具体工作表后再解析，不能继续固定读取第一张表。
- [ ] 识别“每亩/元”“租金（元）”等来源表头，并允许分别映射到参考单价和最终金额；映射失败时保留为原始自定义列。
- [ ] 从合计行和说明行提取“核定总人口或亩数、固定总额、来源单价”候选值，只用于确认页预填，未经确认不写入项目。
- [ ] 无法可靠识别表头时返回人工映射信息，不凭列位置猜测姓名、银行卡或金额。
- [ ] 过滤合计、签字、说明和空白行；银行卡始终按字符串处理，保留前导零和长号码。
- [ ] 导入前要求选择年度、项目名称、组别、固定总额、核定依据总数和计算依据；导入成功后保存原始文件名、工作表名、标题、表头行号、列名、列顺序、建议列宽和系统字段映射为 `outputTemplateSnapshot`。
- [ ] 银行卡相同、收款人相同的两行分别保留；真正同一源行重复导入时显示核对提示。
- [ ] 运行解析与文件读取测试。

完成标准：每个项目独立导入，所有有用列均可在字段管理中继续使用，原文件不被修改。

## 任务 5：实现承包费台账总览页

**涉及文件：**

- 新建 `app/src/renderer/js/contract-fee-ledger-ui.js`
- 新建 `app/src/renderer/css/contract-fee-ledger.css`
- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/renderer/index.html`
- 修改 `app/src/renderer/foundation/extensions.mjs`
- 新建 `app/tests/renderer/contract-fee-ledger-ui.test.js`
- 修改 `app/tests/renderer/contract-fee-workspace.test.js`

- [ ] 先增加资源加载、页面中文名称、稳定操作属性和现有路由兼容测试。
- [ ] 在资金工作区之前加载新增界面模块和样式；Foundation 与旧入口保持相同顺序。
- [ ] 保留 `contract-fee-workspace.js` 的数据读取、保存、通知和其他资金类别，承包费项目页面委托给新模块，避免继续扩大 1500 多行的工作区脚本。
- [ ] 按确认效果稿实现顶部五项摘要和项目总览、年度汇总、历史年度、打印与导出栏目。
- [ ] 默认按组别显示项目卡；同一组的大枣园、鱼塘等分别显示。一个项目涉及多个组时，各组卡片进入同一项目并定位相应组。
- [ ] 项目卡显示固定总额、计算方式、计发依据、参考单价、尾差、家庭数、状态和明确下一步。
- [ ] 新建项目和导入项目表进入同一分步向导，避免重复入口。
- [ ] 使用事件委托和局部重新渲染，年度切换、组别展开和项目状态变化不刷新整个资金中心。
- [ ] 运行渲染结构测试。

完成标准：总览与效果稿一致，同组多项目一目了然，工资、地力补贴和其他资金页面不受影响。

## 任务 6：实现项目编辑、字段规则和大台账性能

**涉及文件：**

- 修改 `app/src/renderer/js/contract-fee-ledger-ui.js`
- 修改 `app/src/renderer/css/contract-fee-ledger.css`
- 修改 `app/tests/renderer/contract-fee-ledger-ui.test.js`
- 修改 `app/tests/renderer/workbench-dom-scenarios.js`

- [ ] 增加真实交互场景：打开一组大枣园项目，切换组别，编辑家庭人口，修改字段公式，保存并重新打开。
- [ ] 实现全屏项目编辑页：顶部计算标准、中间家庭表、右侧字段与公式、底部金额核对和操作栏。
- [ ] 顶部同时显示核定总人口或亩数、明细实际合计、两者差额、本组固定总额、参考单价、基础金额和尾差；差额非零时显示明确中文提示。
- [ ] 家庭表一户一行，分开显示户主和收款人；完整银行卡显示且允许同卡多行，备注标明代收关系。
- [ ] 家庭表优先按导入模板快照显示原始字段名称和顺序；系统核对、来源和状态字段放在辅助区域，不因为输出隐藏而删除底层数据。
- [ ] 支持新增、改名、排序、隐藏和移除自定义字段；基础身份字段允许调整显示但不删除底层数据。
- [ ] 支持全部家庭、当前筛选结果和勾选家庭的批量填写；整次批量操作形成一个可撤销快照。
- [ ] 支持搜索、每页 20/50/100 户和紧凑分页。只渲染当前页可编辑控件，不为全部居民创建下拉框。
- [ ] 家庭移出使用现有 `active` 状态，默认不显示并可恢复；新批次不包含移出家庭，历史批次不变。
- [ ] 保存前重新读取最新数据库并核对目标方案快照；冲突时保留当前输入并提示重新加载，不能用旧页面覆盖新数据。
- [ ] 增加 500 户场景，验证初始页面只渲染一页行数、翻页和输入不重复绑定事件。

完成标准：大量台账编辑流畅，字段和公式可理解，保存失败或并发变化不会丢失输入和其他业务数据。

## 任务 7：实现尾差补入、核对和年度批次冻结

**涉及文件：**

- 修改 `app/src/renderer/js/contract-fee-ledger-ui.js`
- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/shared/contract-fee-model.js`
- 修改对应模型和渲染测试

- [ ] 在界面突出“尚待人工补入”，点击显示尾差来源、补入家庭、基础金额和补入后最终金额。
- [ ] 一次只允许指定一户接收该组全部尾差；更换家庭时撤销旧补入并重算。
- [ ] 核对时检查所有组固定总额、计发依据、空家庭、无效数字和尾差；银行卡允许为空时沿用当前资金中心规则，不额外恢复旧阻断。
- [ ] 同一银行卡和同一收款人不合并；每个家庭生成稳定的发放行编号。
- [ ] 同一项目同一年度已有草稿时打开草稿，已有完成批次时进入查看；另建一笔必须通过明确的追加入口并生成独立批次。
- [ ] 生成批次时冻结项目、组别、家庭、收款人、银行卡、字段、公式、公式规则、参考单价、基础金额、尾差和最终金额。
- [ ] 修正打印工作台回写逻辑，按稳定明细编号对应行，不能再用姓名匹配，否则同名或共用收款人会错行。

完成标准：尾差未处理不能完成；历史批次不受当前台账修改影响；同名、代收和共用卡均保持独立发放行。

## 任务 8：实现签字明细表、各组汇总表、导出和打印

**涉及文件：**

- 修改 `app/src/main/contract-fee-file-service.js`
- 修改 `app/src/shared/ipc-contract.js`
- 修改 `app/src/main/ipc-handlers.js`
- 修改 `app/src/preload/index.js`
- 修改 `app/src/renderer/js/contract-fee-ledger-ui.js`
- 修改 `app/src/renderer/js/contract-fee-workspace.js`
- 修改 `app/src/renderer/css/contract-fee-ledger.css`
- 修改 `app/tests/main/contract-fee-file-service.test.js`
- 修改渲染场景测试

- [ ] 先增加成果文件测试：一个项目包含各组汇总表和每组签字明细表。
- [ ] 新增独立项目成果导出接口，不改变现有按组导出和其他资金导出接口。
- [ ] 汇总表包含组别、项目、家庭数、计发人口/亩数、参考单价、基础金额、尾差和最终合计。
- [ ] 新增“按原表输出”：严格使用 `outputTemplateSnapshot` 中的原始中文表头和顺序，把系统最新值写入已映射列；未识别自定义列按原名称和位置输出。
- [ ] 原表已有“签章/签字”列时沿用该列；原表没有签字列时，普通按原表导出不增加字段，签字明细表只在最后补充“签字/按手印”。
- [ ] 没有导入模板快照的系统新建项目使用标准字段：户主、收款人、依据、单价、基础金额、尾差、最终金额、完整银行卡、备注和签字/按手印。
- [ ] 银行卡单元格强制文本格式；相同银行卡在两户中保留两行，测试长卡号和前导零不变。
- [ ] 打印预览与电子导出共用同一列解析函数，确保两处字段名称、顺序和金额完全一致；原始隐藏字段仍保留在批次快照。
- [ ] 复用现有资金工作台的 A4 纸张预览、页边距、行高、列宽和打印调用；增加组小计、项目合计、重复表头和页码。
- [ ] 导出或打印只读取已保存批次快照，失败时不改变完成状态，并允许原地重试。

完成标准：签字明细、组汇总、完整银行卡和总额在界面、打印和电子导出中一致。

## 任务 9：回归验证和开发窗口验收

**涉及文件：** 仅在发现问题时修改对应实现或测试。

- [ ] 运行承包费专项测试：

```bash
node --test app/tests/shared/contract-fee-model.test.js \
  app/tests/shared/contract-fee-excel-parser.test.js \
  app/tests/main/contract-fee-file-service.test.js \
  app/tests/renderer/contract-fee-workspace.test.js \
  app/tests/renderer/contract-fee-ledger-ui.test.js
```

- [ ] 运行应用全部测试：

```bash
npm test
```

- [ ] 运行后端权限回归：

```bash
npm --prefix backend test
```

- [ ] 使用根目录 `npm run dev` 打开隔离开发版，确认窗口连接 `app/.dev/user-data`，不打开正式数据。
- [ ] 在开发副本中完成完整验收：一组建立大枣园和鱼塘两个项目；二组按 10,000 元/143 人计算；三组按 20,000 元/200.00 亩计算；张三代李四收款且同卡两行；尾差补入张三户；保存后重新打开数据一致。
- [ ] 导出项目成果文件并重新读取检查：汇总金额严格平账、签字表完整卡号、共用卡保持两行、字段顺序正确。
- [ ] 使用至少 500 户开发数据检查搜索、翻页、批量填写、滚动和输入响应；开发工具无未处理错误。
- [ ] 检查 `git status` 和本次差异，只报告本次改动，不覆盖既有无关修改。
- [ ] 不修改版本号，不执行构建、打包、安装、应用内更新登记或 GitHub 操作。

完成标准：专项和完整回归全部通过，开发窗口可直接看到效果，正式版本与正式数据没有被操作。

## 最终验收清单

- [ ] 同一组的大枣园和鱼塘分别建账、分别导入、分别计算、分别输出。
- [ ] 每个项目可以包含一个或多个组，各组固定总额和计算方法独立。
- [ ] 自定义数字字段能够参与中文公式，错误公式有明确提示。
- [ ] 参考单价、基础金额、尾差和最终金额都显示到分。
- [ ] 尾差由人工指定一户补入，未平账不能完成。
- [ ] 一户一行；户主、收款人和银行卡分离；共用银行卡不合并。
- [ ] 序号重新排列不影响数据身份或历史对应。
- [ ] 项目通常一年一笔，已有记录不会被重复新建覆盖。
- [ ] 签字明细表与各组汇总表可导出、可打印，银行卡显示完整号码。
- [ ] 旧承包费方案、旧批次、工资、其他发放和地力补贴回归正常。
