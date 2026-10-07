# 资金发放首页与批量编辑 Implementation Plan

> **For agentic workers:** 使用 executing-plans 逐项实施；按其建议将独立界面和导入任务分工执行。遵循项目约定，不提交、不发布。

**Goal:** 从复用名单开始，统一填写本期标准、计算金额并自定义表格。

**Architecture:** 继续使用现有工作台，纯模型处理批量变更、计算与配置，编辑器负责选择/筛选/预览；模板和批次快照承载配置，旧记录兼容。

**Tech Stack:** Electron、原生 JavaScript、现有 Foundation/Vue 适配、Node test、隔离 Chrome DOM 场景。

## 步骤

- [x] 备份七个涉及的源码文件到 app/.dev/backups/funds-bulk-20260909-155500，记录原有未提交修改。
- [x] 首页：修改 contract-fee-workspace.js 和对应 CSS，提供最近正式历史名单复用、待办、紧凑分页与设置入口，保留原操作选择器。
- [x] 导入：修改 disbursement-excel-parser.js 并测试签字行、混合数值、人口/面积、未知列保留和完整手工映射；不修改原文件。
- [x] 模型：扩展 disbursement-workbench-model.js 的字段、批量、计算规则与原表金额属性；测试跨页选中、只填空白、人工金额保护、负数、字段计算依赖、保存与复用。
- [x] 编辑器：修改 disbursement-workbench.js 与 CSS，添加勾选、筛选、批量填写、计算规则、字段和眉头设置；修改作为一次撤销快照，沿用串行保存和失败重试。
- [x] 集成：导入数据标记原表金额，模板与批次保留扩展属性，导出和打印使用同一字段配置；核对现有金额与居民同步接口。
- [x] 验证：运行 node --test tests/shared/disbursement-workbench-model.test.js tests/shared/disbursement-excel-parser.test.js，再运行工作台 DOM 与 Foundation 场景和完整 app 测试。检查差异、备份与开发预览，不操作生产发放数据。

## 验收示例

```js
// 56 人跨页选择全部，人口为 13、4，统一单价 130：本期实发分别 1690、520；原表金额不变。
// 单人手工金额有原因时，修改单价默认不覆盖；选择覆盖后恢复自动计算，撤销恢复整次操作。
// 自定义数字字段“本期面积”乘“单价”，删除“本期面积”被依赖检查拦截。
// 自定义眉头“项目名称”与新增字段跨保存、重新打开、打印和导出均保留。
```
