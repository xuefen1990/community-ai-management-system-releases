# 原始解包基线

本目录保存从“村务通管理系统 v2.3.0 ARM64”安装包中提取的原始文件，用于界面、文字、资源、调用接口和功能对照。

- `app-asar/`：`app.asar` 的完整解包内容。
- `app-asar-unpacked/`：Electron 原生模块与动态库。
- `manifest/`：安装包和解包文件的校验清单。

`app-asar/` 与 `app-asar-unpacked/` 不纳入 Git，但会保留在本地交付目录。生成后不得直接编辑；可开发副本必须从此目录复制到 `app/`。

