# GitHub 稳定推送配置

## 目标

让本项目在这台 Mac 上使用简单、持久的 GitHub 认证方式，并让后续 Codex 对话在完成本次工作后按约定提交和推送本次改动。

## 已确认状态

- `origin` 使用 HTTPS 地址：`xuefen1990/community-ai-management-system-releases`。
- Git 已启用 macOS Keychain (`osxkeychain`) 凭据助手。
- 已通过不产生写入的模拟推送验证当前凭据具备该仓库的推送权限。
- GitHub CLI 已安装但未登录；它不是 Git 推送的必要条件。

## 方案

保留现有的 HTTPS + macOS Keychain 认证，不额外创建 SSH 密钥或添加另一套 GitHub CLI 凭据。新增项目级协作约定：完成本次改动、完成必要验证后，仅提交并推送本次改动；出现冲突、认证或验证问题时停止并说明。

## 验证和异常处理

推送前检查工作区与远程地址，避免混入其他未提交工作。当前环境的本地代理未运行时可能造成连接失败；这种情况下不改变系统代理设置，而是报告网络状态并等待用户恢复网络或代理。
