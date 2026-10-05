# 财务 AI 分类“模型返回内容无效”修复

日期：2026-10-05

## 原因与修复

- 新积分调度路径未沿用 DeepSeek V4 普通任务禁用默认思考的适配。生产模型为 deepseek-v4-flash；脱敏两条摘要、600 输出 Token 的调用复现空正文。
- 普通任务对官方 DeepSeek V4／deepseek-flash 明确发送 thinking.type=disabled；深度任务保持 enabled。依据 https://api-docs.deepseek.com/guides/thinking_mode/ 。不读取思考内容作为业务正文。
- 模型内容兼容文字分块与 choices.text，统一为正文字符串。空正文、格式错误、乱码分别返回明确错误；仍拒绝损坏字符，避免乱码写入科目。
- 客户端分类由每批 25 条降至 12 条，缩短解释，兼容数组和 results/categories/items 包装。缺项或格式错误拆分重试直至单条；单条失败保留待重试，不阻断后续批次。原金额、日期、方向与摘要不变，保留成功结果和规则识别。

## 验证

- 客户端 749/749；后端 32/32；语法与 git diff --check 通过。
- 回归覆盖坏批次拆分、缺项／截断结果、单条失败不影响其余、兼容分块正文、旧格式、空正文精确错误、乱码拒绝及默认思考仅适配官方 DeepSeek。
- 同一脱敏实际模型请求：修复前 AI_EMPTY_RESPONSE；修复后 2 条完整 JSON 分类，finishReason=stop，usageTokens=118。
- 现有根目录 npm run dev 独立进程自动加载，开发后端 /api/health 200。

## ECS

只上传 backend/src/services/aiModelDispatch.js。部署前比对源文件 SHA-256 与本次修改前快照，备份分别保存在 C:/community-ai/deploy-backups/2026-10-05-finance-ai-response 与后续 thinking 修正备份目录。上传后比对哈希、检查 JS 语法，重启 CommunityAIBackend；任务运行，3000 端口监听。https://xuefeng0901.cn/api/health 返回 200，未登录的模型入口保持 401。

未修改密钥、环境配置、生产积分开关或云端数据库；未打包、登记更新或推送 GitHub。原始 Excel 尚未提供，实际模型验证使用脱敏摘要。
