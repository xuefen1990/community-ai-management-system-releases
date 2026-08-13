# 本地账号与离线授权

## 客户端

- 账号只在本机注册和登录。
- 密码使用随机盐和 `scrypt` 派生值保存，不保存明文。
- 注册后开启 30 天本地试用。
- 授权码与本机设备码绑定，支持月度、年度、永久三种类型。
- 客户端只包含 Ed25519 公钥，无法生成或篡改有效授权码。

## 管理员授权工具

独立工具位于 `license-generator/`，用于输入客户设备码并签发授权码。签名私钥位于 `license-generator/private/license-private-key.pem`，已被 Git 忽略。

安全要求：

- 授权工具只能由管理员保存和使用。
- 不得把授权工具或私钥随客户版安装包分发。
- 应将私钥备份到受控的离线介质；私钥丢失后，现有客户端仍能验证旧授权码，但无法继续签发同一密钥体系的新授权码。
- 如果私钥泄露，应更换客户端公钥并发布新版本。

初次创建密钥：

```sh
node license-generator/scripts/create-signing-key.mjs
```

脚本检测到私钥已存在时会拒绝覆盖。

构建 Apple Silicon 授权工具：

```sh
cd license-generator
npm run build:arm64
```

输出位置：`license-generator/release/社区AI授权工具-0.1.0-arm64.dmg`。该安装镜像包含签名私钥，只能由授权管理员保管。
