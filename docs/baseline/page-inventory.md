# 原版页面清单

- 侧边栏入口：11
- 内容区域：14
- 模态弹窗：25
- 页面脚本：40

## 侧边栏入口

| 顺序 | 页面 | 目标 ID |
| ---: | --- | --- |
| 1 | 工作台 | `tab-overview` |
| 2 | 数据统计 | `tab-statistics` |
| 3 | 村民一户一档 | `tab-personnel` |
| 4 | 党员管理 | `tab-party` |
| 5 | 民情记录 | `tab-visit-records` |
| 6 | 村里值班 | `tab-duty` |
| 7 | 财务收支 | `tab-finance` |
| 8 | 土地承包确权 | `tab-land` |
| 9 | 证明开具 | `tab-certificate` |
| 10 | 电子档案柜 | `tab-documents` |
| 11 | 系统设置 | `tab-settings` |

## 内容区域

| ID | class |
| --- | --- |
| `tab-overview` | `tab-content` |
| `tab-statistics` | `tab-content hidden` |
| `tab-personnel` | `tab-content hidden` |
| `tab-visit-records` | `tab-content hidden` |
| `tab-party` | `tab-content hidden` |
| `tab-duty` | `tab-content hidden` |
| `tab-finance` | `tab-content hidden` |
| `tab-land` | `tab-content hidden` |
| `tab-certificate` | `tab-content hidden` |
| `tab-documents` | `tab-content hidden` |
| `sub-tab-search` | `sub-tab-content` |
| `sub-tab-import` | `sub-tab-content hidden` |
| `tab-operation-logs` | `tab-content hidden` |
| `tab-settings` | `tab-content hidden` |

## 模态弹窗

| ID | 标题 |
| --- | --- |
| `customStatSettingsModal` | 顶部统计显示 |
| `customLandStatSettingsModal` | 选择显示的地块统计指标 |
| `customCareStatsModal` | 配置重点关爱群体指标 (自由勾选) |
| `customDocStatSettingsModal` | 选择显示的电子档案统计指标 |
| `mobileUploadQrModal` | 📱 手机扫码拍照直传 |
| `customRelationModal` | 新增与户主关系类别 |
| `batchEditGroupModal` | 批量修改全户村民小组 |
| `landImportHistoryModal` | 地块导入记录与回滚 |
| `personnelImportHistoryModal` | 人员导入记录 |
| `excelImportReportModal` | 📥 Excel 缝合导入结果核对 |
| `editSpecialCategoryModal` | ✏️ 编辑自定义专项类别 |
| `dataModal` | 新增数据 |
| `editPartyMemberModal` | 🚩 党员与发展档案管理 |
| `editPartyActivistModal` | 🌱 积极分子与发展档案管理 |
| `certTemplateEditModal` | 📝 自定义证明模板管理 |
| `certHistoryModal` | 📜 证明开具历史台账与防伪溯源 共 0 条记录 |
| `landExcelImportModal` | 批量导入地块权属数据 |
| `excelImportModal` | 人员信息补充配对 |
| `import12345Modal` | 📞 12345 便民热线工单 Excel 智能导入 |
| `helpModal` | 📖 系统操作与快捷键指南 |
| `batchEditPersonnelModal` | ✏️ 批量修改村民信息 已勾选 0 人 |
| `landDetailModal` | 🌾 地块档案详情 |
| `batchExportModal` | 📊 导出字段自选配置中心 (.xlsx) 已选 0 人 |
| `privacyAgreementModal` | 数据安全承诺 · 使用须知 |
| `mobileVoiceModal` | 手机口述快捷录入协同 |

## 页面直接加载的脚本

- `js/echarts.min.js`
- `js/core/qrcode.min.js`
- `js/core/xlsx.full.min.js`
- `js/core/utils.js`
- `js/modules/household-360.js`
- `js/modules/duty-flexible.js`
- `js/modules/certificate.js`
- `js/modules/party.js`
- `js/modules/appeal_visit_skill.js`
- `js/modules/visit_skills.js`
- `js/modules/personnel_skills.js`
- `js/modules/ai/ai_config.js?v=5.4.0`
- `js/modules/ai/ai_workflow.js?v=5.4.0`
- `js/modules/ai/ai_audit_logger.js?v=5.4.0`
- `js/modules/ai/ai_masking_utils.js?v=5.4.0`
- `js/modules/ai/ai_confirmation_guard.js?v=5.4.0`
- `js/modules/ai/ai_llm_client.js?v=5.4.0`
- `js/modules/ai/dictionary/person_dictionary.js?v=5.4.0`
- `js/modules/ai/dictionary/record_dictionary.js?v=5.4.0`
- `js/modules/ai/schemas/person_skill_schemas.js?v=5.4.0`
- `js/modules/ai/schemas/record_skill_schemas.js?v=5.4.0`
- `js/modules/ai/ai_dictionary_registry.js?v=5.4.0`
- `js/modules/ai/ai_schema_validator.js?v=5.4.0`
- `js/modules/ai/ai_skill_registry.js?v=5.4.0`
- `js/modules/ai/ai_text_normalizer.js?v=5.4.0`
- `js/modules/ai/ai_entity_extractor.js?v=5.4.0`
- `js/modules/ai/ai_conversation_manager.js?v=5.4.0`
- `js/modules/ai/ai_mode_router.js?v=5.4.0`
- `js/modules/ai/ai_prompt_context.js?v=5.5.0`
- `js/modules/ai/skills_person.js?v=5.5.0`
- `js/modules/ai/skills_record.js?v=5.5.0`
- `js/modules/ai/skills_stats.js?v=5.5.0`
- `js/modules/ai/skills_ui.js?v=5.5.0`
- `js/modules/ai/skills_party.js?v=5.6.0`
- `js/modules/ai/skills_duty.js?v=5.6.0`
- `js/modules/ai/skills_household.js?v=5.6.0`
- `js/modules/ai/skills_land.js?v=5.6.0`
- `js/modules/ai/ai_orchestrator.js?v=5.5.0`
- `js/modules/ai/ai_ui_adapter.js?v=5.4.0`
- `renderer.js`

## 样式与图片引用

- 样式：`style.css?v=19`
- 图片：`logo.png`（Logo）
