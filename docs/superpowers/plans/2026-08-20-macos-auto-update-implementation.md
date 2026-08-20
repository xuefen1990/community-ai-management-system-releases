# Mac 安装包与 GitHub 自动更新实施计划

> 依据 `docs/superpowers/specs/2026-08-20-macos-auto-update-design.md`。本计划先完成可测试的应用内更新能力，再接入用户的 GitHub 发布仓库和 Apple 签名身份。

## 用户前置事项

1. 使用个人 Apple ID 申请 Apple Developer Program，完成付款与身份验证。
2. 创建 GitHub 账号。
3. 创建一个公开、无源码的更新仓库；仅允许保存 Release 安装包、`latest-mac.yml`、`.zip` 和更新说明。
4. 提供该仓库的 GitHub 地址。在需要发布首个正式版本时，由用户本人登录 GitHub 和 Apple，或在其本机安全地配置发布凭据。

## 1. 更新服务与发布配置

修改 `app/package.json` 与 `app/electron-builder.yml`：添加 `electron-updater`，配置 Apple 芯片 Mac 的 `dmg`、`zip` 和 GitHub 发布目标。发布仓库由显式配置提供，不把任何 GitHub 令牌写入源码。

新增 `app/src/main/update-service.js`：封装启动检查、用户确认后下载、进度、已下载、错误和重启安装；开发环境禁用真实更新检查；失败永远不阻塞主窗口。

验证：为更新服务提供可替换的 updater 适配器，测试检查、下载、失败和重启调用。

## 2. 受限 IPC 与预加载桥接

扩展 `app/src/shared/ipc-contract.js`、`app/src/preload/index.js` 和 `app/src/main/ipc-handlers.js`：只暴露检查、下载、安装和订阅更新状态的最小接口。渲染层不接触 GitHub 地址、发布令牌或 Electron 更新对象。

验证：补充 IPC 合约测试，确保新通道被注册且预加载层没有泄露 Node 权限。

## 3. 用户界面

新增可复用的更新提示：展示新版本号、Release 更新说明、“立即更新”和“暂不更新”。用户确认下载后展示百分比、传输速度与失败提示；下载完毕时展示“重启并安装”。

启动后静默检查：发现新版本才出现弹窗；用户本次拒绝更新不写入永久忽略状态，下一次启动再次检查。设置界面加入“检查更新”入口，供用户手动检查。

验证：渲染层测试覆盖有更新、无更新、取消、下载进度、下载错误与重启安装。

## 4. 打包、签名和发布流程

先生成未签名测试 `.dmg`，确认可拖入“应用程序”并启动。Apple 账号可用后，配置 Developer ID Application 签名与公证凭据；构建过程不记录凭据。

在 GitHub 创建测试 Release：发布 `.dmg`、`.zip`、`latest-mac.yml` 和更新说明。以一个旧版本安装包验证完整升级流程后，再发布正式版本。

验证：检查签名、公证、安装位置、版本号、更新元数据完整性和失败回退；完成一次真实的旧版本到新版本升级。

## 完成条件

- 已签名的 Apple 芯片 Mac `.dmg` 能安装到“应用程序”。
- 应用只在用户确认后下载更新；稍后更新会在下次启动再次提示。
- GitHub Release 发布后，可从旧版本自动检查、下载、重启并完成升级。
- 更新失败不会损坏现有应用或本地社区业务数据。
