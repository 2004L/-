# Docker 生产候选配置

## 当前状态

这套项目使用 Vinext/Wrangler 运行时和本地 D1 绑定。`Dockerfile.production`
把它封装成可持久化的服务器运行容器，D1/Wrangler 状态写入 `/data/wrangler`，
由 Compose 映射到项目目录的 `runtime/wrangler`。

这是一套“生产候选配置”，不是把 Cloudflare D1 自动变成外部高可用数据库。
正式生产前必须决定：继续使用受控的 Wrangler 本地持久化，还是迁移到正式数据库
适配器。不要在没有备份和恢复演练前把真实酒店数据放进去。

## 首次启动

```powershell
Copy-Item .env.production.example .env.production
# 编辑 .env.production，写入服务器上的密钥；不要提交该文件
New-Item -ItemType Directory -Force runtime\wrangler, runtime\logs
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

健康检查：

```text
http://127.0.0.1:8787/api/pms/ping
```

当前默认 `PMS_PROVIDER=simulator`，所以不会误连真实 PMS。只有 Kamra
适配器通过只读验收后，才把它切换为 `kamra`，并同时配置真实的内部 URL、API
凭据和门店映射。

## D 盘存储

项目容器卷位于：

```text
D:\AI无人酒店\runtime\wrangler
D:\AI无人酒店\runtime\logs
```

Docker Desktop 的 Linux 数据盘仍需通过 Docker Desktop 设置中的
`Resources -> Advanced -> Disk image location` 迁移到 `D:\DockerDesktopData`。
不要手动复制或删除 `docker_data.vhdx`。

## 发布前检查

- `docker compose ... ps` 中服务为 `healthy`；
- 重启容器后演示数据仍在；
- `pnpm security:check`、TypeScript、核心验收通过；
- `.env.production`、API key、身份证和完整手机号不进入镜像和 Git；
- Caddy/Nginx 只暴露 HTTPS 入口，8787 仅绑定 `127.0.0.1`；
- Kamra 与 Hotel Agent OS 使用内部 Docker 网络，Kamra 后台不能裸露公网；
- 备份和恢复演练完成后，才允许使用真实酒店数据。
