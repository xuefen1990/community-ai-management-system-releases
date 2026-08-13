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

详细范围见 [设计文档](docs/superpowers/specs/2026-08-13-community-ai-management-system-design.md)，执行顺序见 [实施计划](docs/superpowers/plans/2026-08-13-community-ai-management-system-implementation.md)。

