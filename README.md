# 村居AI管理系统

本项目使用 Electron 桌面端、村务通 v2.6.4 的 Vue 界面基础，以及村居系统自己的业务、账号与数据服务。

当前目标平台为 Apple 芯片 Mac。新系统使用独立应用标识和数据目录，可与原版共存。

## 目录边界

- `source-original/`：原始解包基线，仅用于对照，不直接修改。
- `app/`：村居AI管理系统可开发源码工程。
- `license-generator/`：独立离线授权码工具；私钥不得进入主程序或版本库。
- `docs/`：设计、实施计划、原版盘点和验收材料。
- `scripts/`：可重复的提取、校验和构建工具。

## 安全要求

- 不提交原始 DMG、GGUF 模型、用户数据、API 密钥、授权私钥或构建产物。
- 原始解包基线生成后保持只读。
- 所有开发和品牌替换都在 `app/` 中进行。

## 主要新增功能

- 对话式公文拟写：一句话生成报告或合同，可连续补充修改，支持历史引用、版本管理和跨类型互通。
- AI 可结合用户填写字段、主动勾选的历史公文和业务记录生成初稿。
- 每位管理员拥有独立、可查看和可重置的写作偏好画像。
- 定稿支持复制、打印以及 Word、PDF 导出。

公文拟写操作见 [公文拟写使用说明](docs/features/document-drafting.md)。

详细范围见 [设计文档](docs/superpowers/specs/2026-08-13-community-ai-management-system-design.md)，执行顺序见 [实施计划](docs/superpowers/plans/2026-08-13-community-ai-management-system-implementation.md)。

## 日常开发

在项目根目录执行 `npm run dev`。开发窗口直接读取当前源码，CSS 自动更新，页面脚本自动刷新，主进程和 preload 自动重启；无需打包和安装。开发数据与正式版分开。

调试命令、数据说明及保存后的行为见 [开发模式说明](docs/development.md)。

## 正式发布

功能确认完成并准备发布时再执行 `npm run build`，沿用现有 macOS 打包流程。登记应用内更新时补充版本号和发行说明；只有明确要求上传 GitHub 时，才提交、推送或发布 GitHub Release。日常修改不自动打包、安装或上传。
