# AI 能力与业务接口基线清单

**日期：** 2026-09-20  
**适用范围：** AI 助理总控中心第一批实施  
**说明：** 本清单记录当前实际运行路径，作为后续迁移依据，不代表重新建设业务模块。

## 当前权威运行链

```text
app/src/main/index.js
  → AiAssistantService
  → RemoteDatabaseStore / JsonDatabaseStore
  → AiRouter
  → 后端 /ai/chat
  → renderer/foundation/floating-assistant.mjs
  → renderer/js/ai-settings-ui.js
```

当前 Electron 主窗口加载 `renderer/foundation/index.html`。右下角 AI 助理由 `foundation/extensions.mjs` 安装，实际对话界面由 `ai-settings-ui.js` 提供。

## 旧 AI 模块核对

`renderer/js/modules/ai/` 中保留了早期的编排、技能、确认、审计和页面适配代码。旧 `renderer/index.html` 会加载这些脚本，但当前主窗口不加载该页面。

处理结论：

- 当前实施不继续扩展这套旧模块；
- 暂不删除，避免影响尚未发现的兼容入口；
- 新能力统一进入主进程工具注册中心；
- 后续确认没有调用后，再单独清理。

## 现有只读能力

| 能力 | 当前实现 | 数据来源 | 权限模块 | 第一批处理 |
| --- | --- | --- | --- | --- |
| 居民基本情况 | `answerResidentOverview` | `personnel` | `personnel:view` | 迁入统一工具 |
| 身份证号查询 | `answerIdentityCardQuestion` | `personnel` | `personnel:view` | 迁入统一工具 |
| 家庭关系查询 | `answerResidentRelationshipQuestion` | `personnel`、`households` | `personnel:view` | 迁入统一工具 |
| 已发资金查询 | `answerDirectQuestion` | 通用发放、承包费发放 | `finance:view` | 迁入统一工具 |
| 待发资金查询 | `answerPendingFundingQuestion` | 通用发放、承包费发放 | `finance:view` | 迁入统一工具 |
| 值班查询 | `answerDutyQuestion` | `dutyRecords` | `work:view` | 迁入统一工具 |
| 合同到期 | `answerContractExpiryQuestion` | `resourceContracts` | `finance:view` | 迁入统一工具 |
| 合同到账 | `answerContractReceiptQuestion` | `resourceContracts`、`contractFeeReceipts` | `finance:view` | 迁入统一工具 |
| 党员查询 | `answerPartyMemberQuestion` | `partyMembers` | `party:view` | 迁入统一工具 |
| 土地面积 | `answerLandAreaQuestion` | `landParcel`、`lands` | `land:view` | 迁入统一工具 |
| 居民承包地 | `answerLandContractorQuestion` | 居民与地块关联 | `land:view`、`personnel:view` | 迁入统一工具 |
| 工作状态 | `answerWorkStatusQuestion` | `workItems` | `work:view` | 迁入统一工具 |
| 已定稿公文 | `answerFinalDocumentQuestion` | `documentDrafts` | `document:view` | 迁入统一工具 |
| 证明历史 | `answerCertificateQuestion` | `certificates` | `certificate:view` | 迁入统一工具 |
| 财务汇总 | `answerFinanceSummaryQuestion` | `finances` | `finance:view` | 迁入统一工具 |
| 模块数量 | `answerModuleCount` | 当前账号可读取的集合 | 对应模块 `view` | 迁入统一工具 |
| 页面跳转 | `navigationTarget` | 页面路由 | 当前登录状态 | 迁入统一工具 |

远程单位工作区在后端按成员权限过滤数据集合，因此 AI 读取到的是当前账号有权查看的数据。工具目录仍登记所需权限，供后续统一确认和界面说明使用。

## 现有写入能力

以下能力保留在 `AiAssistantService`，第一批不改执行逻辑：

- 居民电话、住址、村民组修改；
- 土地地块、民情记录、值班和工作事项新增；
- 工作状态修改和可恢复删除；
- 证明记录删除和公文归档；
- 党员阶段修改；
- 资源合同、合同到账和财务记录新增；
- 财务记录修改与清空；
- 社区名称修改；
- 单位成员停用；
- 数据库备份恢复。

后续阶段再将这些操作登记为 R1 或 R2 工具，并统一持久化确认、执行核验和撤销规则。

## 已有安全与资源能力

- 在线 AI 通过后端调用，桌面端不保存正式密钥；
- 对话、个人记忆和单位规则由后端保存；
- 单位永久 Token 额度、预留、结算、返还和用量明细已经存在；
- 数据库支持原子写入、写入排队、备份和恢复；
- 电子档案支持复制、哈希核对、回收站和关联业务对象；
- 高风险 AI 操作已有二次确认和部分撤销能力。

## 第一批不处理

- 不增加新的写操作；
- 不改变业务表单；
- 不增加 AI 文件上传；
- 不增加任务规划器；
- 不调整 Token 套餐；
- 不删除旧 AI 文件；
- 不构建或安装正式版本。
