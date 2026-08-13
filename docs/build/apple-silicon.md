# Apple Silicon 构建说明

当前版本仅构建 macOS ARM64。构建流程复用已验证的原版 Electron 31.7.7 ARM64 运行时，并将新的主进程、预加载层、界面、图标和原版已附带的 ARM64 Metal AI 依赖装入独立应用包。

前置条件：

- `/Applications/村务通管理系统.app` 存在，作为只读 Electron 运行时模板。
- `source-original/app-asar/node_modules` 已由项目提取脚本生成。
- `app/build/icon.icns` 已生成。

构建命令：

```sh
cd app
npm run build:arm64
```

输出位置：`app/release/社区AI管理系统-0.1.0-arm64.dmg`。

构建脚本会：

1. 创建独立 bundle `社区AI管理系统.app`。
2. 设置独立标识 `com.community.ai.management.dev`。
3. 替换品牌图标和应用源码。
4. 加入 ARM64 Metal 本地 AI 组件。
5. 执行 ad-hoc 深度签名与校验。
6. 创建带 Applications 快捷方式的压缩 DMG。

正式对外发布前仍建议申请 Apple Developer ID 并执行公证；ad-hoc 签名适合当前本机测试和内部验收。
