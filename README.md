# 社区AI管理系统 v1.2.2

本分支包含已发布的 1.2.2 桌面应用和本机后端完整源码；不包含用户数据、凭据、安装包或本机模型。

## 开发预览

需要 Node.js 20.13 或更新版本。

```sh
npm run dev:setup
npm run dev
```

开发版使用 app/.dev/user-data 独立数据和本机端口 3301，不会覆盖正式数据。服务登录及在线 AI 按现有账号服务配置使用。

## 测试

```sh
npm test
ADMIN_PASSWORD=local-test-only-password JWT_SECRET=local-test-only-signing-key npm --prefix backend test
```

后端测试命令中的值仅用于临时测试；正式服务器需独立配置强密码和签名密钥，不使用这些测试值。

## 构建与更新

Windows 构建：npm --prefix app run build:win:x64。
Mac 本机构建：npm --prefix app run build:arm64；该流程需本机已有 ARM64 应用模板及 source-original/app-asar 中的原始运行依赖，这些二进制未上传仓库。

正式更新由 https://xuefeng0901.cn/api/update/ 提供，发布凭据使用本机钥匙串，不存入源码。

发行说明见 docs/releases/1.2.2.md。
