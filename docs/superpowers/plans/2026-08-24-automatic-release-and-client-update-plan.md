# 自动发布与客户端更新实施计划

> 已确认规格：`docs/superpowers/specs/2026-08-24-automatic-release-and-client-update-design.md`

1. 新增 `scripts/build-ci-arm64-dmg.mjs`，以 Electron Builder 从已提交源码构建 ARM64 应用，重新写入更新源配置、执行稳定的 ad-hoc 签名，并生成与现有协议一致的 DMG、ZIP 和 `latest-mac.yml`。
2. 让 `scripts/release-sync.mjs` 根据 `COMMUNITY_AI_CI_BUILD=1` 选择该 CI 打包入口，保留原有本机模板打包方式；新增标签与版本、发行说明一致性校验。
3. 新增只在 `v*` 标签上运行的 GitHub Actions 工作流：安装锁定依赖、运行前后端测试、构建并调用现有发布编排；后端发布参数只从 Secrets 读取。
4. 新增非交互 GitHub 凭据检查脚本，并在项目协作约定中规定首次登录后复用 macOS 钥匙串/GitHub CLI 凭据，不在新窗口重复授权。
5. 以静态工作流测试覆盖触发条件、Secrets、构建路径、版本验证与凭据检查；运行相关测试和语法校验，再只提交本次文件并推送。
