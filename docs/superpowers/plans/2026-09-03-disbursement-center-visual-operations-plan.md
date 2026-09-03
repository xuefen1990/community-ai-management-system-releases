# 资金发放中心可视化操作实施计划

> 已确认范围：批次回收与复制、测试标记、默认模板直接编辑、预览列布局、所有发放表统一居民资料同步、可视化核对、快速查询与居民资金记录。完成后发布为应用内可更新版本。

## 1. 扩展批次与模板数据模型

**文件：**

- `app/src/shared/contract-fee-model.js`
- `app/src/main/empty-database.js`
- `app/tests/shared/contract-fee-model.test.js`
- `app/tests/main/database-store.test.js`

**工作：**

1. 为模板扩展可编辑的布局字段（列顺序、列宽、隐藏列、默认打印设置与系统原始快照），兼容旧模板和旧批次。
2. 为批次扩展测试标记、回收信息、复制来源、资料同步状态、同步结果和冻结快照。
3. 增加整批移入回收站、恢复、彻底清除和复制为草稿的纯模型方法。
4. 统一所有模板批次的居民资料同步计划：身份证优先，姓名与组别辅助，冲突由操作员决定，不自动覆盖已有信息。
5. 增加批次核对结果：重名、无卡号、银行卡更新、手调金额和同期间重复人员。

**验证：** 模型测试覆盖旧数据兼容、整批回收／恢复／清除、复制继承布局、卡号更新提示、冲突决策、同步状态及核对分类。

## 2. 实现通用居民资料同步与资金记录

**文件：**

- `app/src/shared/contract-fee-model.js`
- `app/src/renderer/js/contract-fee-workspace.js`
- `app/src/renderer/js/resident-subsidy-profile.js`
- `app/tests/shared/contract-fee-model.test.js`
- `app/tests/renderer/contract-fee-workspace.test.js`
- `app/tests/renderer/resident-subsidy-profile.test.js`

**工作：**

1. 复用地力补贴的“预览 → 确认同步”流程，应用到承包费、固定工资、杂工、公共服务人员和后续模板批次。
2. 资料为空时补充身份证号、手机、银行卡、开户行、组别等；资料不同则提供采用新资料或保留原资料。
3. 记录每条同步的来源批次、字段、处理方式和时间，供居民档案查询。
4. 居民档案增加资金记录页签，按时间列出补贴、工资、承包费等，链接至对应批次。

**验证：** 覆盖唯一匹配、重名阻止、资料冲突、仅本次使用、确认同步、跨类型发放记录和居民查询。

## 3. 改造批次列表与安全清理操作

**文件：**

- `app/src/renderer/js/contract-fee-workspace.js`
- `app/src/renderer/css/contract-fee-workspace.css`
- `app/tests/renderer/contract-fee-workspace.test.js`

**工作：**

1. 为全部发放批次加入状态、资料同步状态、测试标记、查询和筛选。
2. 增加批次操作：查看、复制、移入回收站；在回收站支持恢复与彻底清除。
3. 删除前展示批次名称、期间、人数和金额，二次确认后执行整批操作。
4. 加入姓名、身份证号或尾号、银行卡尾号、组别、日期、模板、资金类别、状态和测试标记查询。

**验证：** 覆盖测试批次筛选、整批删除范围、恢复、永久清除、复制入口和多条件查询。

## 4. 开放默认模板编辑与可视化模板卡片

**文件：**

- `app/src/renderer/js/contract-fee-workspace.js`
- `app/src/renderer/css/contract-fee-workspace.css`
- `app/tests/renderer/contract-fee-workspace.test.js`

**工作：**

1. 默认模板与自定义模板都可直接编辑；提供恢复系统原始模板。
2. 模板列表改为卡片化信息，显示适用业务、纸张、方向、每页人数与字段摘要。
3. 新建批次加入可视化步骤条：选择模板、添加人员、核对资料、打印／发放。
4. 保证模板修改只影响后续新批次，历史批次始终引用自己的模板快照。

**验证：** 覆盖默认模板编辑、恢复原始模板、卡片信息、批次快照不变及新批次使用新布局。

## 5. 实现打印预览布局编辑和核对卡

**文件：**

- `app/src/renderer/js/contract-fee-workspace.js`
- `app/src/renderer/css/contract-fee-workspace.css`
- `app/tests/renderer/contract-fee-workspace.test.js`

**工作：**

1. 为打印预览增加显式“编辑布局”模式，支持列排序、列宽、显示／隐藏字段；保留现有纸张、方向、人数和边距设置。
2. 调整后允许保存到当前模板或另存为新模板；不支持自由拖动单元格或合并单元格。
3. 新建和预览前显示可点击核对卡，定位到对应人员行。
4. 继续保留草稿与准备打印状态的行编辑／删除，打印或发放完成后锁定。

**验证：** 覆盖布局保存、另存、恢复默认、打印内容采用布局快照、核对卡分类与定位、锁定规则。

## 6. 回归测试、应用打包与自动更新发布

**工作：**

1. 运行新增模型和渲染测试，再运行 `npm test --prefix app` 全量测试。
2. 手工验证：导入／录入 → 同步预览 → 确认 → 居民档案查看 → 复制批次 → 预览布局 → 回收与恢复。
3. 只暂存本次实际修改文件，审查差异后提交并推送。
4. 提升应用版本，编写发行说明，创建并推送一致的版本标签，触发自动更新发布。
5. 验证 Release 同时包含 DMG、应用内 ZIP 更新包和 `latest-mac.yml`，再告知用户可在应用内更新。
