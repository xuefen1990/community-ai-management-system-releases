# 社区 AI 管理系统后端

该服务负责统一保存桌面端注册账号，并在网页后台管理账号、在线大模型 API、调用用量、软件版本与审计日志。

## 启动

```bash
cp .env.example .env
npm ci
npm start
```

生产环境必须在 `.env` 中设置随机的 `JWT_SECRET`、管理员手机号和管理员密码。服务启动后，在浏览器打开 `http://服务器地址:3000/admin/` 登录管理后台。

桌面端需通过环境变量 `COMMUNITY_AI_BACKEND_URL` 指向该服务，例如：

```bash
COMMUNITY_AI_BACKEND_URL=https://api.example.com npm start
```

未配置时桌面端默认连接 `http://127.0.0.1:3000`。注册或登录无法连接该地址时会失败，以保证每个新账号都可在后端后台查看。

## 首版边界

- 仅一个超级管理员，由 `ADMIN_PHONE` 和 `ADMIN_PASSWORD` 初始化。
- 仅支持 OpenAI 兼容的在线模型 API；密钥加密保存且不会通过管理接口返回。
- 当前 JSON 数据文件适用于单个服务实例。部署到生产前请备份 `DB_PATH` 指向的数据文件。
