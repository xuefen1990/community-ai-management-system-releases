# PKG 安装位置修复设计

## 问题

v0.1.3 的安装包留下了 `com.community.ai.management` 安装收据，但应用程序目录中没有实际的 `社区AI管理系统.app`。组件式打包的安装位置在此环境中未能可靠落到 `/Applications`。

## 方案

v0.1.4 改用根目录载荷：构建临时的 `Applications/社区AI管理系统.app` 目录树，再由 `pkgbuild --root` 以根目录 `/` 为安装位置打包。这样载荷自身包含完整的 `Applications` 路径，安装后唯一目标为 `/Applications/社区AI管理系统.app`。

保留 ZIP 与 `latest-mac.yml`，供应用内更新下载。首次安装仍采用双击 PKG、按“继续 / 安装”的方式。

## 验证

构建后检查 PKG 载荷必须以 `./Applications/社区AI管理系统.app` 开头。随后安装到本机并检查 `/Applications/社区AI管理系统.app` 存在、其签名有效；验证通过后才发布 v0.1.4。

## 范围

本次只修复安装落点与发布版本，不改变登录、授权或业务功能。
