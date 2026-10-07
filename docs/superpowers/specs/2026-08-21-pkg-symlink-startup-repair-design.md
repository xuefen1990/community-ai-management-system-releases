# PKG 启动修复设计

## 根因

v0.1.5 的打包脚本使用 Node 复制应用时没有保留相对链接。Electron Framework 内的链接因此被写成构建目录的绝对路径。安装后的签名校验失败，Electron Helper 随即崩溃，应用无法打开。

## 方案

保留现有的点击安装方式和固定安装目标，但复制应用时原样保留相对链接；在生成 PKG 前对待打包的应用运行严格签名校验。继续使用当前 App 内部版本号，避免旧版本的迁移问题；更新 ZIP 与 `latest-mac.yml` 保持不变。

## 验证

构建后从 PKG 提取 Payload 到临时目录，验证：

1. 应用位于 `Applications/社区AI管理系统.app`。
2. Framework 内链接仍指向 `Versions/Current/...`，不包含构建目录。
3. `codesign --verify --deep --strict` 通过。
4. 直接启动临时应用并确认进程不会立即崩溃。

随后发布 v0.1.6，并仅建议用户下载该版本的 PKG。
