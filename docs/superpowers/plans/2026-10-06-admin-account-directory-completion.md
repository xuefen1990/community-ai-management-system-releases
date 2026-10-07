# 账号后台按主账号整理（2026-10-06）

## 实施范围

依据用户引用并要求实施的“整理账号后台架构”对话最终方案，后台以主账号手机号展示和查找账号，成员关系复用稳定的 `main_account_id`。手机号不是关联主键，不新增单位或租户层级，不迁移历史归属。

- 数据总览：统计主账号、子账号，近期注册列表仅展示主账号。
- 账号管理：默认主账号列表；点击查看子账号进入详情。展示手机号、姓名、岗位、状态、注册与最后登录时间、创建人，并保留既有授权、密码重置、停用和删除操作。
- 主账号与子账号分别搜索及分页；搜索成员姓名或手机号可找到所属主账号。返回列表保留列表条件；管理操作后刷新当前详情。
- 归属异常单独查看，平台管理员可通过范围选择查看；不猜测归属。
- 新成员保存 `created_by`、`position_preset`。历史创建人取明确字段或 `create_unit_member` 创建日志；没有依据显示“未记录”。绑定主账号与创建人分别呈现。
- 新增 `/api/admin/accounts` 与 `/api/admin/accounts/:accountId`，沿用认证及管理员校验，不扩大成员访问权限，返回数据不含密码散列。

## 验证

- `npm --prefix backend test`：33 项通过。
- 新增服务回归：默认仅主账号、停用成员计数、成员搜索定位主账号、分页、创建字段和日志来源、未知创建人、归属隔离、手机号变化后关系不变、异常归属、脱敏返回。
- HTTP 集成：无登录 401，子账号访问 403，管理员列表与成员明细正确，新成员创建人和岗位可读取。
- 独立测试数据库 UI：总览、账号列表、查看子账号、返回列表、中文成员搜索均验证。测试身份与正式数据隔离。
- 根目录 `npm run dev` 的既有独立开发预览保持运行，本机后端健康接口正常；本次管理后台页面使用独立测试数据额外验证。

## ECS 同步

2026-10-06 仅同步如下 6 个运行文件：

- `backend/src/routes/adminRoutes.js`
- `backend/src/services/adminService.js`
- `backend/src/services/authService.js`
- `backend/src/services/adminAccountDirectory.js`
- `backend/src/admin/index.html`
- `backend/src/admin/account-management.js`

同步前原有 4 个文件 SHA256 与本次修改前基线一致；新增文件无冲突。原文件备份至 `C:/community-ai/deploy-backups/2026-10-06-account-directory`。上传后核验文件 SHA256 和 JS 语法，重启 `CommunityAIBackend`。

验证生产域名 `https://xuefeng0901.cn/api/health` 正常；管理员只读查询确认默认列表为主账号、成员归属正确，后台首页与新增脚本返回 200。同步不包含环境配置、凭据、数据库或其他既有改动。未新增数据库迁移。

本次未改客户端版本号、未打包、未登记应用更新、未提交或推送 GitHub。积分启用及历史余额转换不在本次范围内。
