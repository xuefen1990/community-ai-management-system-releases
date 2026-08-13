# 社区AI管理系统详细实施计划

日期：2026-08-13  
对应设计：`docs/superpowers/specs/2026-08-13-community-ai-management-system-design.md`

## 实施原则

- 原始 DMG 和原始解包基线只读保存，任何开发都在副本中完成。
- 每个阶段先建立可验证的最小结果，再进入下一阶段。
- 视觉保真与数据安全同等优先；涉及写库、授权和在线 AI 的功能必须有自动测试。
- 每完成一个阶段进行一次本地提交，确保可以单独回退。
- 不把用户数据库、API 密钥、授权私钥、GGUF 模型、构建缓存或 DMG 大文件提交进版本库。

## 阶段 0：项目安全基线

### 任务 0.1：建立忽略规则和目录说明

文件：

- 新建 `.gitignore`
- 新建 `README.md`
- 新建 `source-original/README.md`

内容：

- 忽略 `.superpowers/`、`node_modules/`、`dist/`、`release/`、本地数据目录、日志、模型、密钥和生成的安装包。
- 说明原始 DMG、原始解包目录、可开发工程和授权工具之间的边界。
- 明确授权私钥不得进入主程序和 Git。

验证：

- `git status --short` 只显示预期的源码和文档。
- 原始 DMG 保持现有 SHA-256 不变。

提交：`chore: establish project safety baseline`

### 任务 0.2：记录原安装包元数据

文件：

- 新建 `docs/baseline/dmg-metadata.md`
- 新建 `docs/baseline/dmg-sha256.txt`

记录：

- DMG 文件名、大小、SHA-256、挂载卷名。
- 原应用版本、Electron 版本、包标识、架构和签名状态。
- `app.asar` 与 `app.asar.unpacked` 的大小。

验证：重新计算校验值并与记录一致。

## 阶段 1：完整解包与校验

### 任务 1.1：实现可重复的 ASAR 提取工具

文件：

- 新建 `scripts/extract-asar.mjs`
- 新建 `scripts/lib/asar-reader.mjs`
- 新建 `tests/scripts/asar-reader.test.mjs`

行为：

- 读取 ASAR header，处理普通文件、目录、链接和 `unpacked` 条目。
- 禁止路径穿越，所有输出必须位于指定目标目录。
- 保留文件字节，不做格式化或内容重写。
- 提取完成后输出文件数量和失败列表。

测试：

- 正确读取 header 和文件偏移。
- 拒绝 `../`、绝对路径和越界 offset。
- 对已知文件 `package.json`、`index.html`、`style.css` 验证内容和大小。

提交：`build: add safe asar extraction tooling`

### 任务 1.2：生成原始解包基线

目录：

- `source-original/app-asar/`
- `source-original/app-asar-unpacked/`
- `source-original/manifest/`

行为：

- 完整提取 `app.asar`。
- 完整复制 `app.asar.unpacked`。
- 生成相对路径、文件大小、权限和 SHA-256 清单。
- 保存原始 `Info.plist` 和安装包图标。

验证：

- 提取文件数量与 ASAR header 一致。
- 抽检 HTML、CSS、JavaScript、PNG、JPG、Dylib 和 Node 原生模块。
- `package.json` 显示 `village-system` 2.3.0。
- 基线目录设为只读；后续步骤不直接编辑其中内容。

提交：`chore: record extracted application baseline`

## 阶段 2：页面与调用接口盘点

### 任务 2.1：建立功能清单

文件：

- 新建 `docs/baseline/page-inventory.md`
- 新建 `docs/baseline/ipc-inventory.md`
- 新建 `docs/baseline/asset-inventory.md`

内容：

- 列出每个侧边栏页面、子页面、弹窗、表格、按钮和空状态。
- 从预加载层列出全部 `window` API、IPC channel、参数和返回结果。
- 列出图片、图标、字体、背景和主题资源及其引用位置。

验证：

- 页面清单覆盖登录、工作台及全部业务模块。
- IPC 清单覆盖数据库、备份、Excel、档案、局域网录入和 AI。

### 任务 2.2：捕获原版视觉基线

文件：

- 新建 `docs/baseline/screenshots/`
- 新建 `docs/baseline/visual-checklist.md`

行为：

- 在固定窗口尺寸下捕获登录页、深色主题、侧边栏、各模块和关键弹窗。
- 对无法通过原授权进入的页面，使用只读开发副本加载原始 HTML 和静态数据，不修改原始基线。
- 记录窗口尺寸、主题、页面状态和截图来源。

验证：每个主要页面至少包含默认状态和空数据状态。

提交：`docs: capture original application baseline`

## 阶段 3：可开发 Electron 工程

### 任务 3.1：建立 ARM64 开发工程

文件：

- 新建 `app/package.json`
- 新建 `app/electron-builder.yml`
- 新建 `app/src/main/index.js`
- 新建 `app/src/preload/index.js`
- 新建 `app/src/renderer/`
- 新建 `app/tests/main/window-config.test.js`

配置：

- 产品名：社区AI管理系统
- 应用标识：`com.community.ai.management`
- Electron：31.7.7
- 目标：macOS ARM64 DMG
- 开启 `contextIsolation`，关闭 `nodeIntegration`。
- 使用独立 `userData` 目录。

测试：

- BrowserWindow 安全配置正确。
- 新名称、包标识和数据目录不等于原版。
- 开发启动能显示登录页且无控制台致命错误。

提交：`feat: bootstrap community AI electron app`

### 任务 3.2：复制保真界面资源

来源：`source-original/app-asar/`  
目标：`app/src/renderer/`

复制：

- `index.html`
- `style.css`
- 登录背景
- 前端依赖库
- 可读业务模块
- 原渲染脚本参考副本

要求：

- 首次复制保持字节一致。
- 后续品牌和功能改动单独提交，便于比较差异。

验证：复制前后 SHA-256 一致。

提交：`feat: import fidelity UI baseline`

## 阶段 4：品牌替换

### 任务 4.1：制作新 Logo 与应用图标

依据：用户上传的品牌参考图。

文件：

- 新建 `app/assets/brand/logo-master.png`
- 新建 `app/assets/brand/logo-transparent.png`
- 新建 `app/assets/brand/icon-1024.png`
- 生成 `app/build/icon.icns`
- 新建 `docs/brand/asset-usage.md`

要求：

- 保留绿色圆环、房屋轮廓、橙色 AI 和浅青色圆角底。
- 清除参考图的低分辨率锯齿和压缩痕迹。
- 生成 16–1024 px 的 macOS 图标尺寸并检查小尺寸识别度。
- Logo 透明版适配登录页和侧边栏。

验证：逐尺寸检查边缘、透明通道、居中和安全边距。

提交：`feat: add community AI brand assets`

### 任务 4.2：替换产品名称与品牌引用

修改：

- HTML 标题、登录页、侧边栏、帮助、隐私说明和版本信息。
- Electron 菜单、窗口标题、安装包名称和 `Info.plist`。
- 所有原 Logo 与图标引用。

测试：

- 全项目搜索不再出现面向用户的“村务通管理系统”。
- “AI 牛小二”作为原业务功能名称继续保留。
- 新应用可与原版同时安装。

提交：`feat: rebrand application as community AI system`

## 阶段 5：兼容桥接与本地数据服务

### 任务 5.1：建立可读预加载接口

文件：

- 修改 `app/src/preload/index.js`
- 新建 `app/src/shared/ipc-contract.js`
- 新建 `app/tests/preload/ipc-contract.test.js`

要求：

- 按原页面需要暴露数据库、备份、文件、Excel、局域网和 AI 方法。
- 所有参数通过结构校验后再进入主进程。
- 不暴露任意文件读取、命令执行或原始 `ipcRenderer`。

验证：接口名称与 `docs/baseline/ipc-inventory.md` 一致。

### 任务 5.2：实现加密数据存储

文件：

- 新建 `app/src/main/services/data-store.js`
- 新建 `app/src/main/services/key-service.js`
- 新建 `app/src/main/services/atomic-file.js`
- 新建 `app/src/main/schemas/database-schema.js`
- 新建 `app/tests/main/data-store.test.js`
- 新建 `app/tests/main/atomic-file.test.js`

测试先行：

- 空数据库可初始化并读取。
- AES-256-GCM 加解密往返一致。
- 密文被篡改时拒绝读取。
- 写入中断不覆盖旧数据。
- 数据版本不兼容时进入恢复流程。

实现：

- 使用随机数据密钥和随机 nonce。
- 使用 Electron `safeStorage` 保护数据密钥。
- 采用临时文件、同步、校验和原子替换。

提交：`feat: add encrypted atomic local data store`

### 任务 5.3：实现业务兼容数据形状

文件：

- 新建 `app/src/main/services/database-adapter.js`
- 新建 `app/src/main/schemas/business-records.js`
- 新建 `app/tests/main/database-adapter.test.js`

要求：

- 新空数据库包含原页面所需的默认数组、设置和版本字段。
- `readDb`/`writeDb` 的参数和返回值兼容原渲染层。
- 非法字段、重复 ID 和不安全路径被拒绝。

提交：`feat: implement renderer-compatible data adapter`

## 阶段 6：本地账号与离线授权

### 任务 6.1：实现本地账号

文件：

- 新建 `app/src/main/services/auth-service.js`
- 新建 `app/src/main/services/credential-service.js`
- 新建 `app/tests/main/auth-service.test.js`

测试：

- 手机号格式和密码长度校验。
- `scrypt` 加盐哈希验证成功与失败路径。
- 不同账号或不同盐不会产生相同存储值。
- 记住登录状态不保存明文密码。

提交：`feat: add local account authentication`

### 任务 6.2：实现 30 天试用与验签

文件：

- 新建 `app/src/main/services/license-service.js`
- 新建 `app/src/main/services/machine-id.js`
- 新建 `app/src/shared/license-format.js`
- 新建 `app/tests/main/license-service.test.js`

测试：

- 注册开始 30 天试用。
- 未到期、到期和永久授权状态正确。
- 授权设备码不一致、内容被篡改或签名无效时拒绝。
- 月度、年度、永久授权均能验签。
- 明显时间回拨产生警告但不删除数据。

提交：`feat: add offline trial and license verification`

### 任务 6.3：制作独立授权码工具

文件：

- 新建 `license-generator/package.json`
- 新建 `license-generator/src/index.js`
- 新建 `license-generator/src/key-store.js`
- 新建 `license-generator/tests/generator.test.js`
- 新建 `license-generator/README.md`

要求：

- 第一次使用时生成 Ed25519 密钥对。
- 私钥只存放在授权工具的受保护本地目录。
- 支持输入设备码并选择月度、年度或永久授权。
- 输出可复制的授权字符串和可核对的授权摘要。

验证：生成的授权可由主程序公钥验签，主程序不能生成授权。

提交：`feat: add offline license generator`

### 任务 6.4：接入原版登录界面

修改：

- 登录、注册、忘记密码和授权设置相关页面逻辑。
- 保持原视觉结构，只替换远程请求为本地服务调用。

端到端测试：

- 注册 → 登录 → 查看试用状态。
- 到期状态 → 复制设备码 → 输入授权码 → 恢复登录。
- 错误密码、错误授权码和时间异常提示正确。

提交：`feat: connect local licensing to original auth UI`

## 阶段 7：文件、Excel、备份和局域网能力

### 任务 7.1：实现备份与恢复

文件：

- 新建 `app/src/main/services/backup-service.js`
- 新建 `app/tests/main/backup-service.test.js`

测试：

- 创建、列出、验证和恢复备份。
- 恢复前自动快照。
- 损坏或版本不兼容的备份被拒绝。
- 自动备份按保留策略滚动清理。

### 任务 7.2：实现档案文件库与回收站

文件：

- 新建 `app/src/main/services/archive-service.js`
- 新建 `app/tests/main/archive-service.test.js`

测试：

- 归档、移动到回收站、恢复和永久删除。
- 路径穿越和数据目录外操作被拒绝。
- 文件名冲突采用可预测的重命名策略。

### 任务 7.3：恢复 Excel 与手机局域网录入

文件：

- 新建 `app/src/main/services/excel-service.js`
- 整合 `app/src/main/services/mobile-upload-service.js`
- 新建 `app/tests/main/excel-service.test.js`
- 新建 `app/tests/main/mobile-upload-service.test.js`

验证：

- 导入前预览与字段错误提示。
- 导出字段预设与自选字段。
- 服务只绑定本地局域网，使用随机会话口令和过期时间。
- 上传文件类型、大小和目标路径受到限制。

提交：`feat: restore local files excel backup and mobile workflows`

## 阶段 8：本地 AI

### 任务 8.1：建立模型目录和扫描

文件：

- 新建 `app/src/main/ai/model-registry.js`
- 新建 `app/src/main/ai/model-validator.js`
- 新建 `app/tests/main/ai/model-registry.test.js`

测试：

- 扫描合法 GGUF。
- 排除未完成下载、零字节或扩展名错误的文件。
- 读取不到模型时返回明确状态。

### 任务 8.2：实现模型下载与手动导入

文件：

- 新建 `app/src/main/ai/model-downloader.js`
- 新建 `app/src/main/ai/model-importer.js`
- 新建 `app/tests/main/ai/model-downloader.test.js`

测试：

- 进度、暂停、恢复和取消。
- 断点续传服务不支持时安全重新下载。
- SHA-256 不匹配时不发布模型。
- 手动导入使用复制到受控目录，不直接依赖外部路径。

### 任务 8.3：接入 node-llama-cpp 与 Metal

文件：

- 新建 `app/src/main/ai/local-llm-service.js`
- 新建 `app/src/main/ai/prompt-runner.js`
- 新建 `app/tests/main/ai/local-llm-service.test.js`

验证：

- ARM64 原生模块加载。
- 可启动、停止和切换模型。
- 内存不足、模型损坏和上下文超限给出可读提示。
- 使用一个小型测试 GGUF 完成真实推理烟雾测试。

提交：`feat: add managed local GGUF AI runtime`

## 阶段 9：在线 AI 与双通道路由

### 任务 9.1：实现 OpenAI 兼容客户端

文件：

- 新建 `app/src/main/ai/openai-compatible-client.js`
- 新建 `app/src/main/services/secret-service.js`
- 新建 `app/tests/main/ai/openai-compatible-client.test.js`

测试：

- 自定义 Base URL、模型和超时。
- API Key 通过钥匙串保存且不进入日志。
- 401、429、超时和无效 JSON 返回明确错误。
- 使用本地 mock server 测试，不依赖真实付费 API。

### 任务 9.2：实现 AI 路由、脱敏和确认守卫

文件：

- 新建 `app/src/main/ai/ai-router.js`
- 整合 `app/src/renderer/js/modules/ai/` 可读模块
- 新建 `app/tests/main/ai/ai-router.test.js`
- 新建 `app/tests/main/ai/privacy-guard.test.js`

测试：

- 本地、在线、自动模式路由正确。
- 自动模式本地失败后必须等待用户确认，不能直接外发。
- 手机号、身份证号等敏感字段可被识别和脱敏。
- AI 返回只能形成预览，未确认时不能调用写库接口。

### 任务 9.3：接入设置页和 AI 牛小二

修改：

- AI 模式选择、模型管理、在线配置、连接测试和状态提示。
- 保留原 AI 牛小二业务技能和确认流程。

端到端验证：

- 本地查询与结构化预览。
- 在线 mock API 查询。
- 自动回退确认。
- AI 建议确认后写库、取消后无写入。

提交：`feat: add privacy-safe local and online AI routing`

## 阶段 10：视觉与业务回归

### 任务 10.1：建立端到端测试框架

文件：

- 新建 `app/playwright.config.js`
- 新建 `app/tests/e2e/auth.spec.js`
- 新建 `app/tests/e2e/navigation.spec.js`
- 新建 `app/tests/e2e/business-modules.spec.js`
- 新建 `app/tests/e2e/ai.spec.js`

覆盖：

- 登录、注册、授权。
- 十二个主要功能区域和关键弹窗。
- 深浅主题、窗口尺寸和空状态。
- 增删改查、搜索、筛选、导入导出。
- 本地 AI、在线 mock AI 和确认写库。

### 任务 10.2：逐页视觉对照

文件：

- 新建 `docs/acceptance/visual-diff/`
- 新建 `docs/acceptance/visual-report.md`

行为：

- 使用相同窗口尺寸比较原版与新版截图。
- 标记允许差异：名称、Logo、图标、本地授权与双 AI 设置。
- 修复其余字体、间距、颜色、边框、阴影和状态差异。

完成门槛：所有主要页面经过人工确认，无明显布局和文字遗漏。

提交：`test: complete visual and business regression coverage`

## 阶段 11：ARM64 打包与交付

### 任务 11.1：构建和签名

文件：

- 修改 `app/electron-builder.yml`
- 新建 `scripts/build-arm64.sh`
- 新建 `docs/release/build-guide.md`

行为：

- 清洁安装依赖。
- 构建 ARM64 `.app` 和 `.dmg`。
- 本地交付使用 ad-hoc 签名。
- 验证 `app.asar`、`app.asar.unpacked` 和原生 Metal 库位置。

验证：

- `codesign --verify --deep --strict` 通过。
- `spctl` 结果和本地打开方式记录在交付说明中。
- 应用架构为 ARM64。

### 任务 11.2：安装与共存验证

验证：

- 从 DMG 拖入应用程序目录并启动。
- 原版和新版同时存在，包标识、窗口标题和数据目录不同。
- 新版卸载和重装不影响原版。
- 新版数据、授权、备份和模型在重启后保持。

### 任务 11.3：最终交付检查

交付：

- 原始解包基线及 manifest
- 可开发源码工程
- ARM64 `.app` 与 `.dmg`
- 独立授权码工具
- 构建、使用、备份、授权和 AI 配置说明
- 功能验收表和视觉对照报告

最终命令：

- 运行全部单元测试。
- 运行全部 Electron 端到端测试。
- 执行生产构建。
- 验证签名、架构和安装。
- 检查 Git 状态，确认无密钥、模型、用户数据或缓存被提交。

提交：`release: prepare community AI system ARM64 delivery`

## 阶段完成顺序

严格按以下顺序执行：

1. 安全基线
2. 完整解包
3. 页面与接口盘点
4. Electron 可开发工程
5. 品牌替换
6. 数据与兼容接口
7. 本地账号与离线授权
8. 文件、Excel、备份和局域网
9. 本地 AI
10. 在线 AI 与双通道路由
11. 视觉和业务回归
12. ARM64 打包与最终交付

每个阶段只有在测试通过、差异记录完整并提交后，才能进入下一阶段。
