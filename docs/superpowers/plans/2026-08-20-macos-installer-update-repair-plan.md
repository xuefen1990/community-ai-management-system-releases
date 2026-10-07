# macOS 安装与更新修复实施清单

1. 将 GitHub 更新配置在打包阶段写入应用 Resources，并在签名前完成。
2. 仅允许已安装在 Applications 的生产应用检查或下载更新；其他位置显示安装提示。
3. 将版本提升到 0.1.2，并添加配置与安装位置的测试。
4. 生成并检查 DMG、ZIP、更新清单及应用签名。
5. 按用户授权在 GitHub Releases 发布 0.1.2 的三项文件，并由用户从 Applications 进行验证。
