# PKG Bundle 迁移修复设计

## 根因

v0.1.4 的 PKG 虽然包含 `Applications/社区AI管理系统.app`，但内部 App 仍使用模板的 `2.3.0` 版本，并被 `pkgbuild` 标记为可迁移 Bundle。macOS 因此记录安装收据却不稳定地落盘应用。

## 修复

v0.1.5 将 App 的 `CFBundleShortVersionString` 与 `CFBundleVersion` 同步到发布版本 `0.1.5`。同时为 PKG 提供组件规则：目标路径固定为 `Applications/社区AI管理系统.app`、不可迁移、关闭基于旧 Bundle 版本的检查，并以升级方式覆盖同一 App。

## 验证

构建后检查 PackageInfo 必须满足：主 App 版本为 `0.1.5`，没有 `<relocate>` 节点，且 Bundle 路径为 `./Applications/社区AI管理系统.app`。签名、ZIP 与更新清单同样需要通过检查。
