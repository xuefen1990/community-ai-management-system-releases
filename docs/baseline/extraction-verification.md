# 原始代码解包验证报告

验证日期：2026-08-13

## 解包结果

- ASAR 目录数：560
- ASAR 文件数：3,328
- ASAR 内容字节数：113,616,871
- 解包目录磁盘占用：约 117 MB
- 独立 `app.asar.unpacked` 文件数：14
- 独立原生资源磁盘占用：约 12 MB
- 应用包补充资源：`Info.plist`、`icon.icns`
- ASAR 链接条目：0

## 字节一致性抽检

以下文件从 ASAR 指定 offset 直接读取后，与解包文件逐字节一致：

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `package.json` | 178 | `3d4728ffd05a17a4033b38ee772adbfb3bc8bf800ef55d5b82f6a383e30ce8a5` |
| `index.html` | 243,928 | `08cf2c620eb4238eeedd3d4b77136895bd71a6e5644fe9a3dccfcc0128225b4e` |
| `style.css` | 180,887 | `ab13b54771f392851d6f2732a53e3565edbe634d210ef2c72f60a814b624ab55` |
| `logo.png` | 359,331 | `2109aea7683999bbfd9791e57089c7c9b4e42e753a5fb8a51d6cd6a37dd26fc1` |
| `renderer.js` | 2,422,632 | `e1fe4e35c4de0183bcf0e5161c921b9f9cfbe3627089cbaafc244cec8e64f3e0` |
| `main.js` | 203,419 | `aa195c332625782e3e6435c84f30afc953fe1e4cd569529bf15fba8a3e848bde` |

## 原生资源验证

- `app.asar.unpacked` 的 14 个文件均能在完整解包目录找到相同路径。
- 14 个文件的 SHA-256 全部一致，无缺失或不匹配。
- `llama-addon.node` 已确认为 ARM64 Mach-O 动态共享库。
- Metal、M1、M2/M3、M4 相关运行库均已保留。

## 安全验证

ASAR 提取工具已通过四项自动测试：

1. 输出路径限制在目标目录内。
2. 拒绝不安全的文件名和路径穿越。
3. 文本和二进制文件提取后保持原始字节。
4. 拒绝超过 ASAR 文件边界的 offset 或 size。

## 清单文件

- `source-original/manifest/app-asar-files.tsv`
- `source-original/manifest/app-asar-unpacked-files.tsv`
- `source-original/manifest/app-bundle-files.tsv`

每条记录包含类型、权限、大小、SHA-256、相对路径和链接目标。

