# Kamra 测试实例接入（K0/K1）

当前阶段只接入 Kamra 的只读订单和房态，不开放换房、入住、退房、支付、发卡或公安提交。

## 运行方式

在 `.env.production` 或部署平台密钥中设置：

```env
PMS_PROVIDER=kamra
KAMRA_BASE_URL=http://kamra
KAMRA_API_KEY=<测试服务账号的 key>
KAMRA_API_SECRET=<测试服务账号的 secret>
KAMRA_PROPERTY=<测试酒店 property 标识>
KAMRA_SITE_HOST=kamra.localhost
KAMRA_TIMEOUT_MS=5000
```

未配置 Kamra 时保持 `PMS_PROVIDER=simulator`，现有演示数据和回放用例不变。密钥只放在运行环境，不进入模型提示词、浏览器或 Git。

## 已接入映射

| Hotel Agent OS | Kamra REST 方法 |
| --- | --- |
| 查询订单 | `kamra.api.find_reservations` |
| 查询房态 | `kamra.api.front_desk_snapshot` |

适配器会把 Kamra 响应归一化为 `PmsOrder` / `PmsRoom`，并通过 `hotel_id` 与 `KAMRA_PROPERTY` 做门店隔离。请求带有超时和 `X-Request-ID`；失败时返回 502，不写入本地房态或订单。

## 验收

1. `/api/pms/ping` 显示 `adapter: kamra`，不显示密钥。
2. 管理员查询订单和房间时，结果的结构与 simulator 一致。
3. Kamra 停止、超时、401、property 不存在时，界面显示可理解的失败原因，不能产生本地状态变化。
4. `PMS_PROVIDER=simulator` 下原有 `test:cases`、并发和不变量测试仍然通过。
5. 只有完成只读验收后，才进入换房等写操作的契约设计。
# 本地 Docker 演示实例

当前演示环境由两个 Docker Compose 项目组成：

- Hotel Agent OS：`D:\AI无人酒店\docker-compose.production.yml`，本机访问 `http://127.0.0.1:8787`。
- Kamra：`D:\Kamra-PMS\frappe_docker`，本机访问 `http://127.0.0.1:8090`，站点为 `kamra.localhost`。

Kamra 的前端容器通过 `overrides/compose.hotel-agent-network.yaml` 加入
`hotel-agent-os-private` 网络，并以容器别名 `kamra` 提供给 Hotel Agent OS。
因此 Hotel Agent OS 使用内网地址 `http://kamra:8080`，不依赖宿主机端口转发。

建议直接运行项目脚本（会先检查 Docker 引擎）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\AI无人酒店\scripts\start-kamra-local.ps1
```

等价的手动启动顺序：

```powershell
docker network create hotel-agent-os-private 2>$null
docker compose -p kamra `
  -f compose.yaml `
  -f overrides/compose.mariadb.yaml `
  -f overrides/compose.redis.yaml `
  -f overrides/compose.noproxy.yaml `
  -f overrides/compose.hotel-agent-network.yaml up -d

docker compose -f D:\AI无人酒店\docker-compose.production.yml up -d
```

`PMS_PROVIDER=kamra` 时，订单和房态查询走 Kamra；写入型 PMS 操作仍由 Hotel Agent OS 的工具契约和管理员确认层拦截，当前演示不会直接改 Kamra 数据。

## 演示数据

演示物业为 `Hotel Agent OS Demo`，已准备待入住、已入住、已取消和尾号重复订单，以及空闲/占用房间。数据均为假数据，不含真实客人信息。

## 验收

先检查两个健康接口：

```powershell
Invoke-WebRequest http://127.0.0.1:8787/api/health
Invoke-WebRequest http://127.0.0.1:8787/api/pms/ping
```

`/api/pms/ping` 返回 `adapter=kamra`、`mode=live-ready` 后，再从管理员后台执行订单和房态查询。
