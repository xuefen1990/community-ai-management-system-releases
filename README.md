# 社区AI管理系统

本项目基于用户提供的“村务通管理系统 v2.3.0 ARM64”安装包进行高保真复刻和可维护性改造。

当前目标平台为 Apple 芯片 Mac。新系统使用独立应用标识和数据目录，可与原版共存。

## 目录边界

- `source-original/`：原始解包基线，仅用于对照，不直接修改。
- `app/`：社区AI管理系统可开发源码工程。
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

## 发布与更新

每次完成改动都会提交并推送。需要面向已安装用户发布时，提高 `app/package.json` 的版本号、补充 `docs/releases/<version>.md` 发行说明并推送对应 `v<version>` 标签；GitHub Actions 会在 macOS 上构建 DMG、应用内 ZIP 更新包和更新清单，同步发布到 GitHub 与更新后端。用户可在任意已安装客户端点击“检查更新”完成下载和安装。

本机 GitHub 登录只需首次执行一次；之后用于推送的 Git 凭据由 macOS 钥匙串复用。可用 `npm --prefix app run github:verify` 非交互地确认当前窗口可访问 GitHub；发布工作流使用独立的临时令牌。

首次启用自动发布时，在 GitHub 仓库的 Actions Secrets 中一次性配置 `COMMUNITY_AI_BACKEND_URL`、`COMMUNITY_AI_BACKEND_ADMIN_PHONE` 和 `COMMUNITY_AI_BACKEND_ADMIN_PASSWORD`。这些值只供发布工作流上传更新包，不会提交到仓库；配置完成后，后续所有版本标签均自动发布，无需再次进行 GitHub 授权。
