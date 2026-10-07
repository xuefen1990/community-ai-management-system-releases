# 精简方案核对与本地执行记录（2026-09-27）

来源：《精简方案_Codex执行版.pdf》。其提交、打包和强制回退步骤与本项目日常开发约定冲突，本次按实际引用关系分批清理，没有提交、打包、发布或同步 ECS。开始时工作区已有大量未提交改动，清理前对拟删文件做了仓库外原样备份。

## 已执行

| 批次 | 内容 | 文件数 | 原文件字节数 |
| --- | --- | ---: | ---: |
| 旧页面入口 | 根部 `renderer` 的旧 `index.html`、`renderer.js`、`style.css`、三张旧页面图片及 `mobile_upload.html` | 7 | 4,606,358 |
| 旧库与模块 | 旧 ECharts、html2canvas、`core/utils.js`、7 个旧功能模块、28 个旧 AI 模块 | 38 | 7,976,197 |
| 合计 | 另移除一个本来已空的 `app/src/legacy/server/` 目录 | 45 | 12,582,555 |

主进程只加载 `foundation/index.html`；手机上传页面由 `foundation-mobile-upload.js` 在请求时生成。第二批文件名已在应用、测试、构建脚本和网站中逐项核查，现行入口不加载它们。旧页面相关断言已改为核查现行 `foundation` 加载链，或随退役界面移除。

原文件备份位于 `~/Downloads/社区AI管理系统精简备份-20260927/`：`community-ai-legacy-renderer-22d179b229.tar` 和 `community-ai-legacy-modules-acc1fc3490.tar`。前者包括删除前带未提交修改的旧 `index.html`、`style.css`。

## 核对后保留

- `work-management.js` 是现行 `foundation/extensions.mjs` 的工作事项模块。
- `resident-subsidy-profile.js` 由现行 `foundation/resident-editor.mjs` 加载，不能按 PDF 的“只被旧登录 UI 加载”判断删除。
- `local-auth-ui.js` 及其动态加载的人事脚本虽然不在当前主入口链上，但部分文件有现存修改和独立测试。PDF 没有列出所称“6 个文件”的完整名称，实际动态脚本数也不止 6 个；本轮保留，待逐项确认数据处理功能的替代覆盖后再退役。
- `foundation/vendor/` 是当前基础页面的来源包，`provenance.json` 记录原始文件。原始 bundle 仍引用 `logo-I1jcNb58.png`，不按“零引用”直接移除该组来源资源。
- `workspace/slim/p1-findings.md` 在当前项目和下载目录均未找到，无法核对和执行“74 处未使用导出”清单。
- `/Applications/村务通管理系统.app` 确实存在，构建脚本以其可执行文件和 Helper 名称作为模板来源；因此保留脚本中的旧名称路径。
- 离线授权接线、工作事项 Excel 导出组件、原始适配包归档等 PDF 标为待选择的事项未改动。安装包体积也未通过正式打包验证。

## 验证

- 桌面端 `npm --prefix app test`：572 项通过、0 项失败。测试数较清理前 586 项减少，原因是退役页面的样式和导航断言不再适用。
- 后端 `npm --prefix backend test`：15 项通过、0 项失败（后端代码未在本次修改）。
- 开发版在删除后重启成功，仍加载 `foundation/index.html`，本机后端 `/api/health` 返回 `ok`。
- 隔离浏览器场景：公文拟写 `drafting`、现行菜单 `navigation` 通过；导航场景中资金发放入口的旧测试选择器已更新为现行 `choose-disbursement-type`。
- `git diff --check` 通过。
