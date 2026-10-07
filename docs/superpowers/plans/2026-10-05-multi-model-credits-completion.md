# 多模型分流与积分计费实施记录

## 已实现

- 后台“添加模型”进入独立多卡片编辑页，可连续添加、测试文字／图片连接、批量保存；失败保留输入。服务支持文字、图片、深度、长文本、上下文容量、优先级与默认文字服务。API 密钥沿用服务器加密存储，不返回前端。
- 根据输入能力及容量挑选模型；同能力候选可在输出开始前接替失败服务。图片深度任务可分为图片识别与文字深入分析两个步骤。UTF-8 流式读取保留中文。
- 积分为真实余额与任务结算。默认每 2,000 加权 Token 一积分；文字、图片、深度权重为 1、1.5、2，最低为 1、2、3 积分。多步骤按任务汇总，超过 3 积分需确认上限；保存每个任务开始时的规则。
- 原 Token 余额按 2,000:1 转换显示，保留尾数及旧 Token 流水。内部使用整数余额单位；新流水标明积分，实际 Tokens 仍单独记录。迁移前备份，正式开关关闭时不迁移。
- 预留、结算即时持久化；重复请求及重复结算不会再次扣费。失败释放未用额度，超时未完成任务自动清理。任务响应缓存加密。
- 证明、公文、悬浮助手、成员管理与 AI 设置显示实际积分结算值和共享余额，同时兼容尚未开启积分的正式后端。

## 验证

- 根目录 `npm run dev`：独立开发版启动并监听源码，后端端口 3301 健康检查 200。开发后端积分启用，数据仅在独立开发目录。
- `npm --prefix app test`：739/739 通过。
- `npm --prefix backend test`：30/30 通过。
- 新增覆盖余额尾数、迁移幂等、多步骤结算、上限确认、并发、取消退款、重复响应、规则锁定、文字／图片／长文本／深度分流、双阶段图片深度分析、字节拆分的中文 SSE、管理员批量保存回滚及正式计费关闭。
- 独立模拟后台页面实测：连续添加文字和图片两张卡片、分别连接测试成功、保存后列表显示两项、积分规则页面显示正确。测试使用本机模拟模型，无真实账号余额或新 API 密钥参与。

## ECS 同步

仅同步本次 14 个后端文件：

- src/database.js
- src/services/aiService.js
- src/services/aiQuotaService.js
- src/services/aiModelRouting.js
- src/services/authService.js
- src/routes/aiRoutes.js
- src/routes/adminAiRoutes.js
- src/admin/index.html
- src/admin/ai-quota-management.js
- src/services/aiCreditPolicy.js
- src/services/aiCreditTasks.js
- src/services/aiModelDispatch.js
- src/admin/ai-model-management.js
- src/admin/ai-credit-policy-ui.js

部署前原有文件 SHA-256 与本次修改前快照一致，备份到服务器 `C:/community-ai/deploy-backups/2026-10-05-ai-model-credits`。上传后校验哈希和 JS 语法，重启 CommunityAIBackend，检查监听端口及进程。最终生产域名 `https://xuefeng0901.cn/api/health` 返回 200；鉴权模型接口及新增后台资源返回正常。

**生产积分开关仍关闭，真实账户未迁移。** 正式客户端继续兼容 Token 计费。本次不修改生产密钥／环境文件，不登记新版本、不打包、不上传 GitHub。生产目前仅有一项已配置服务；实际图片及其他模型需管理员填写供应商的真实模型名称、能力、地址和 API Key，连接测试后启用。
