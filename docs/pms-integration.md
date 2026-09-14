# PMS 接入参考（临时占位）

## 选型

首个联调参考使用 QloApps `1.6.1`。QloApps 是开源酒店管理与预订系统，官方 Web Service 文档覆盖订单、房态和价格查询，适合作为 API 适配器的第一套样例。真实生产接入前，需要由酒店确认具体版本、部署地址、授权方式和接口范围。

备选学习对象：Kamra PMS（REST API、前台入住/退房和受控 AI 工具层）以及 inPMS（OpenAPI、WebSocket、HMAC Webhook 和适配器注册表）。这两个项目适合参考现代事件和权限设计，但不替代酒店实际使用的 PMS。

## 环境变量

```text
PMS_PROVIDER=qloapps
PMS_VERSION=1.6.1
PMS_BASE_URL=https://pms.example.local/api
PMS_API_KEY=TEMP_PMS_API_KEY_REPLACE_ME
```

`TEMP_PMS_API_KEY_REPLACE_ME` 是临时占位符，不能用于生产。替换真实密钥后，还要先在测试环境验证权限、限流、超时、重试和审计，再打开真实写入。

## 首期接口契约

前端只调用本项目的 `/api/pms/*`，由适配器转换为具体 PMS API，避免把 PMS 结构写死在前端。

| 本项目接口 | 作用 | 关键字段 |
| --- | --- | --- |
| `GET /api/pms/orders?phone=` | 手机号优先匹配订单 | `orderId`、`source`、`status`、`guestPhone` |
| `GET /api/pms/rooms` | 查询指定日期可售房间 | `propertyCode`、`roomTypeCode`、`roomNumber`、`status` |
| `POST /api/pms/hold` | 临时锁房 | `reservationId`、`roomNumber`、`expiresInSeconds`、`idempotencyKey` |
| `POST /api/pms/checkin` | 登记实际入住 | `reservationId`、`policeReceipt`、`actualCheckInAt` |
| `POST /api/pms/checkout` | 登记退房并触发保洁 | `reservationId`、`actualCheckOutAt` |

## 酒店编码设计

编码采用“门店-业务对象-本地编号”结构，便于多门店迁移：

- 酒店：`GZ-HAOS-001`
- 房型：`GZ-HAOS-001-DLX-KING`（高楼层大床房）、`GZ-HAOS-001-DLX-TWIN`（高楼层双床房）
- 房间：`GZ-HAOS-001-1208`、`GZ-HAOS-001-1210`

房型和房间号只是示范映射，正式上线必须从目标酒店 PMS 导出后建立映射表，不应凭 AI 猜测。

## 安全边界

本地小模型可以做语音沟通、订单检索、脱敏和风险解释；锁房、入住、退房等写操作必须经过固定业务规则、权限校验和幂等键。身份证原始字段不进入模型上下文，公安登记回执只作为受控业务字段传递。
