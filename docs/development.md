# 开发模式

在项目根目录执行：

```sh
npm run dev
```

命令直接运行根目录的 `node_modules/electron` 和工作目录中的现有源码，不生成安装包，也不修改 `/Applications` 中的正式 App。关闭开发窗口或在启动终端按 Ctrl+C，会停止开发 Electron、开发后端和文件监听。`app` 目录的原有 `npm start` 仍保留为直接运行 Electron 的命令；日常开发请使用根目录的 `npm run dev`，避免误用正式数据目录。

首次准备一台新电脑时，安装 Node.js 20.13 或更高版本，然后在根目录执行 `npm run dev:setup` 安装现有 app/backend 锁定依赖。当前 Mac 的旧 Electron 31 开发运行时被系统拦截，因此开发工具单独固定为 Electron 41.0.0（根目录依赖）；正式版仍保留 Electron 31.7.7（`app/package.json`），不升级生产运行时。新版开发运行时已通过官方发行校验并实际启动。开发与生产运行时有版本差异，正式发布前仍应按生产配置回归。

## 保存之后的行为

| 修改位置 | 自动行为 |
| --- | --- |
| `app/src/renderer` 中已加载的 CSS | 替换样式表，保留当前窗口与输入 |
| `app/src/renderer` 中的 HTML、JS、MJS 或图片 | 刷新当前页面，重新载入源码 |
| `app/src/main`、`app/src/preload`、`app/src/shared`、`app/src/legacy` | 重启开发 Electron |
| `backend/src` | 重启开发后端和开发 Electron |
| `scripts/foundation-adaptations.cjs` | 从已保存的原始前端资源重新生成适配文件并刷新，无需 DMG |
| `app/package.json` | 重启开发 Electron；新增依赖仍需安装依赖 |

监听按连续保存合并，通常在保存后几秒内完成。CSS 更新保留输入；JS/HTML 刷新或主进程重启会丢失尚未保存的表单和内存状态，请先保存需要保留的测试数据。主进程重启尽量回到原页面。出现代码错误时查看终端，修复并再次保存即可重试。

当前项目是 Electron + Vue 3 / Element Plus 编译资源 + 自有 JS/MJS/CSS 扩展。它没有 `.vue`、TS、React 源码编译链，所以这里使用 Electron 自动刷新，不声称实现 Vue 组件级 HMR。不要直接编辑压缩的 `foundation-runtime.mjs` 来长期维护功能：优先编辑 `foundation/*.mjs` 和 `foundation.css`；涉及原始界面挂钩时编辑 `scripts/foundation-adaptations.cjs`。若将来确实引入 `.vue` 或 TS 源文件，再加入对应编译器。

## 数据和服务隔离

- 正式版继续使用原数据目录；macOS 默认位于 `~/Library/Application Support/社区AI管理系统`。该目录和内部加密身份保留旧名，界面、安装名称及关于面板使用“村居AI管理系统”。
- 开发版使用 `app/.dev/user-data`。第一次启动复制已有业务数据、应用内附件和账号数据作为开发快照，重写属于正式数据目录的内部路径；以后不会覆盖开发副本或写回正式数据。
- 开发版默认将账号、业务 API 和在线 AI 都连接到隔离的本地后端 `http://127.0.0.1:3301`，并使用独立的数据副本。开发账号配置不会沿用副本中旧的正式服务器地址。仅在明确需要测试指定服务时，才通过 `COMMUNITY_DEV_REMOTE_SERVER_URL` 临时覆盖；覆盖后业务保存请求会写入该服务的单位数据。
- 账号快照优先使用本项目已有 `backend/data/backend.db`，否则使用正式 App 自管后端快照。通过独立开发目录校验的非打包预览会复用有效的记住账号，或使用本机预览身份；启动和代码修改后重启直接进入工作台，无需人工登录。正式版登录与在线 AI 账号验证保持正常。
- 数据副本、凭据、缓存和日志已加入 Git 忽略，正式打包配置也不会包含 `.dev`。
- 文件选择、导出和打开外部文件仍按原功能操作用户指定的路径；调试时应选择测试文件。开发副本并非操作系统文件沙箱。
- 修改开发后端设置不会切换到正式服务器；开发版自动检查更新已关闭，原有发布版配置不变。

`COMMUNITY_DEV_PORT=3302 npm run dev` 可更换开发端口。3301 被占用时会停止并说明原因，不会连到陌生服务。开发数据目录可通过 `COMMUNITY_DEV_USER_DATA` 指定，必须是新的独立目录或此前初始化的开发目录。

首次需要空白测试环境时：

```sh
COMMUNITY_DEV_USER_DATA="$PWD/app/.dev-empty/user-data" npm run dev -- --fresh
```

`--fresh` 只控制新目录的初始化，不清空现有开发数据。

## 调试

`npm run dev:tools` 启动并打开 DevTools，也可以在开发窗口按 Command+Option+I。错误输出位于启动终端和 `app/.dev/dev.log`。`app/.dev/runtime.json` 记录开发进程、刷新次数、独立后端地址和数据目录，方便确认是否运行了开发版。默认不开放远程调试端口。需要重复验证时先以 `COMMUNITY_DEV_DEBUG=1 npm run dev` 启动，再用 Node 20 执行 `node --experimental-websocket scripts/check-development.mjs`，或 Node 22+ 执行 `node scripts/check-development.mjs`；测试会临时保存并恢复源码标记，不写业务数据。

## 正式发布

确认功能后才执行：

```sh
npm run build
```

沿用现有 ARM64 macOS 构建流程，生成 `.app`、`.dmg`、应用内更新 ZIP 和 `latest-mac.yml`。本地构建依赖项目原有的已安装模板；CI 构建仍使用 `npm --prefix app run build:ci:arm64` 和 electron-builder。原有打包配置和其他工具的配置未删除。当前主应用的配置只有 macOS 目标，未发现 Windows 目标配置。

构建本身不登记更新，不提交或上传 GitHub。正式发布时按项目约定另行提高版本号、补充发行说明并登记本机更新。
