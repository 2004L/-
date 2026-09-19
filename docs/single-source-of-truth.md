# 单一事实来源：字段权威归属与迁移计划

目标模型把商业交易与住宿事实拆开：`orders` 管交易，`reservations` 管住宿，`rooms` 管实体房间，
`room_assignments` 管分房，`payments`/`refunds` 管支付，`check_ins` 管入住验证。
当前仓库只落地了 `reservations`/`rooms` 的骨架，`orders`、`payments`、`check_ins`、
`room_assignments` 尚未建立独立表。

## 权威归属

| 事实 | 目标权威表 | 当前载体 | 现状 |
| --- | --- | --- | --- |
| 商业订单金额、币种、商业状态 | `orders` | `orders`；`demo_orders` 为只读投影 | 已建立 `orders` 表，金额修改走该表并投影回演示层 |
| 住宿日期、房型、预订状态 | `reservations` | `reservations` | 已有，但只由旧演示数据投影，非主写入路径 |
| 实体房间与维护状态 | `rooms` | `rooms` | 已有，id 曾有两套命名，本次收敛为 `room-<hotel>-<room_number>` |
| 谁被分到哪间房 | `room_assignments` | `reservation_rooms` | 雏形，缺少分配时间、释放时间、分配人 |
| 支付请求与结果 | `payments` / `refunds` | `walk_in_payments`（演示） | 未建立正式支付模型 |
| 入住验证与时间 | `check_ins` | `stays` | 雏形，仅由回填写入 |
| 房态变更审计 | `room_status_logs` | `room_status_logs` | 已由管理员换房写入 |
| 预订状态审计 | `reservation_status_logs` | 无写入 | 表已建，代码零引用 |
| 账务对账 | `folios` / `ledger_entries` | 无写入 | 表已建，零引用 |

`demo_orders` 是演示 UI 投影，最终退化为只读兼容层；它不应再作为正式写入目标。

## 写入路径

| 入口 | 当前写入 | 目标写入 |
| --- | --- | --- |
| 顾客入住 `app/api/demo/[action]/route.ts` | `demo_orders`、`checkin_cases`、`external_commands` | 经 Booking/Check-in 服务写 `orders`/`reservations`/`rooms`/`check_ins`，`demo_orders` 由投影回填 |
| AI 对话 `app/api/agent/turn/route.ts` | 无（只返回 tool_call） | 保持不变，只调用受权限工具 |
| 管理后台 `lib/admin-service.ts` | `reservations`/`rooms` + `demo_orders` 兼容 | `reservations`/`rooms` 为唯一写入，去掉 `demo_orders` 兼容写 |
| PMS 目录 `lib/pms-core-sync.ts` | `rooms` 元数据 | 只同步元数据，房态由 CAS 工作流写 |
| 旧数据兼容 `lib/legacy-core-sync.ts` | `demo_orders` → 正式表 | 保留只读回填，Phase 2 移除 |

## Phase 0（本次已完成）

- 状态映射收敛到 `lib/hotel-core.ts` 的 `LEGACY_ORDER_STATUS_TO_RESERVATION`，投影 SQL 由该常量生成，不再散落 `CASE`。
- `rooms` id 统一为 `room-<hotel>-<room_number>`；PMS 目录同步改为 `ON CONFLICT(hotel_id, room_number)` upsert，只更新元数据，保留房态 `status` 与 `version`。
- 工作流 transition 先校验 `current_step` 再写 `workflow_runs`，消除先改状态再报错的部分写入。
- `/api/pms/*` 增加 `ping` 免鉴权连通性检查；业务操作要求管理员会话；`orders`/`rooms` 改读正式表；`hold`/`checkin`/`checkout` 返回 501，等待 Phase 1 的正式流程。

## Phase 1（第一刀已完成）

- 新增 `orders` 表（`db/schema.ts`、迁移 `drizzle/0013_orders.sql`）与 `ORDER_STATUS` 状态机（`lib/hotel-core.ts`）。
- 订单服务 `lib/orders.ts`：`ensureOrdersSchema`、`updateOrderAmount`（带版本号）、`transitionOrderStatus`（先断言合法流转）、`projectOrderToLegacy`。
- 管理员金额调整改为写 `orders`，再单向投影回 `demo_orders`；`reservations` 不再承载金额权威，管理员查询通过 `LEFT JOIN orders` 读取金额并保留回落。
- 旧数据投影 `lib/legacy-core-sync.ts` 同步回填 `orders`。

仍待 Phase 1 后续：

- 把顾客入住主流程从 `demo_orders` 迁到 Booking/Check-in 服务。
- `reservations` 的 `total_amount`/`deposit_amount` 字段在确认无读取方后由迁移移除。
- `orders` 状态变更写入独立审计表（当前写 `admin_audit_events`）。

## 订单字段读写归属审计

审计字段：`room_amount`、`deposit_amount`、`total_amount`、`paid_amount`、`status`、`reservation_no`。

| 入口 | 位置 | 读取 | 写入 | 是否依赖 `demo_orders` |
| --- | --- | --- | --- | --- |
| 顾客入住状态机 | `app/api/demo/[action]/route.ts` + `lib/checkin-core.ts` | 正式 `orders`/`reservations`/`rooms`；`demo_orders` 作为会话投影 | 正式 `orders`/`reservations`/`rooms`/`stays` + 房态与预订流水；`demo_orders` 只接收投影 | 投影写入 |
| AI 对话 | `app/api/agent/turn/route.ts`、`lib/tools.ts` | 无 | 无 | 否 |
| 管理员订单查询 | `lib/admin-service.ts` `searchOrders` | `orders` 金额（`LEFT JOIN`）、`reservations.status`（预订状态）、`reservations` 金额回落 | 无 | 兼容回落时是（已加告警与 `amount_source` 标记） |
| 管理员金额调整 | `lib/admin-service.ts` prepare/execute、`lib/orders.ts` | `orders` 金额与 `version` | `orders` 金额 + `version`（原子条件更新），单向投影 `demo_orders` 金额 | 仅投影写入 |
| 管理员换房 | `lib/admin-service.ts` `executeRoomChange` | `rooms.status/version`、`reservations` | `rooms` + `room_status_logs`；兼容镜像 `demo_orders.room_number` | 房间号兼容写入 |
| 旧数据投影 | `lib/legacy-core-sync.ts` | `demo_orders` 全量 | `orders` 回填（`INSERT OR IGNORE`，不覆盖已存在正式订单） | 是（回填来源） |
| PMS 适配 | `app/api/pms/[operation]/route.ts` | `reservations` 住宿字段 + `orders` 金额回落 | 无（写操作返回 501） | 否 |
| 订单状态机 | `lib/orders-core.ts` | `status`、`version` | `status` + `version`（检查预期旧状态） | 否 |

状态语义必须分开：

- `orders.status` 是商业订单状态（`ORDER_STATUS`），只由订单服务写入。
- `reservations.status` 是住宿预订状态（`RESERVATION_STATUS`），由预订/入住流程写入。
- `demo_orders.status` 是旧演示状态，只能作为投影来源，不能反向决定上面两者。
- 旧演示状态到两个状态机各有一张映射表（`LEGACY_ORDER_STATUS_TO_RESERVATION`、`LEGACY_STATUS_TO_ORDER_STATUS`），禁止把预订状态直接当订单状态。

## Phase 1 硬化（并发与幂等）

- 金额与状态更新改为单条原子条件更新：`... WHERE hotel_id = ? AND order_no = ? [AND version = ?]`，状态流转额外要求 `AND status = ?`。
- 影响行数为 0 时通过一次只读查询区分 `order_not_found` / `order_version_conflict` / `order_status_conflict`，不再返回虚假成功。
- 创建订单按 `(hotel_id, idempotency_key)` 幂等：重放且参数一致时返回原订单；参数不一致抛 `idempotency_key_reused`；`order_no` 冲突抛 `order_no_conflict`。
- `projectOrderToLegacy` 只单向投影正式订单拥有的金额字段；投影失败只告警、不回滚也不掩盖正式写入结果。
- 管理员查询在正式订单缺失时保留回落，但返回 `amount_source=reservation_fallback` 并打印 `[orders][compat]` 告警。
- 金额修改结果与审计会带上 `projection`（`projected` / `no_legacy_row` / `failed`），投影异常时审计详情标注“已记录告警”，正式订单写入不回滚也不被掩盖。

回落使用位置（全仓库 `COALESCE` 扫描）：仅 `lib/admin-service.ts` 的订单查询与 `app/api/pms/[operation]/route.ts` 的订单列表使用“正式订单优先、预订金额回落”，两处都带 `amount_source`/告警；`lib/tenant.ts` 的 `COALESCE` 只用于租户/酒店作用域回填，与金额无关。

集成验证：

- `pnpm test:orders-concurrency`：双连接 SQLite（D1 同引擎族），17 项断言。
- `pnpm test:orders-d1`：通过 miniflare/workerd 的真实 D1 绑定，复用同一份场景脚本，17 项断言。

## Phase 2（客人流程切正式表，第一刀已完成）

- 新增 `lib/checkin-core.ts`：正式办理层，负责 `orders`、`reservations`、`reservation_rooms`、`rooms`、`room_status_logs`、`reservation_status_logs`、`stays` 的幂等写入；`lib/checkin.ts` 是 D1 适配层。
- `app/api/demo/[action]/route.ts` 改为正式表优先：种子订单、现场订单、锁房、入住确认都先写正式表，再把状态与房间号投影回 `demo_orders`，会话 UI 不变。
- 锁房用 `rooms.status` 的 CAS（空闲→已锁），房间被他人占用时拒绝；入住确认用 `reservations.status` 的 CAS（已确认→已入住），已取消预订无法确认。
- 正式写入失败会写 `FORMAL_SYNC_FAILED` 审计事件并降级到演示投影，不会让客人流程直接报错；投影失败单独告警。
- 仍由 `walk_in_drafts`/`walk_in_payments` 承载现场报价与模拟支付，正式 `payments` 表留待后续阶段。

## Phase 2：分房、支付、入住独立化

- 建立 `room_assignments`、`payments`/`refunds`、`check_ins`；启用 `reservation_status_logs`、`folios`、`ledger_entries`。
- 库存并发控制：房间唯一占用约束 + 带有效期的库存锁定与释放。
- 幂等与失败恢复：订单创建、支付回调、入住操作均可安全重试。

## Phase 3：外部 PMS / OTA 边界

- 明确 PMS 与本地系统的权威边界：外部 PMS 拥有什么事实、本地只做副本还是覆盖。
- 用事件、Webhook 或同步任务更新本地数据，处理延迟、冲突、重试和对账。
- 接入真实支付服务商前先完成签名字段、金额与交易身份的校验。

## Phase 4：生产化

- `tenant_id`/`hotel_id` 隔离覆盖全部 API 与服务端强制校验。
- 审计、可观测性、告警（支付异常、库存冲突、同步失败）。
- 真实 D1/API 端到端并发、幂等与故障恢复自动化测试。

## 运行时提醒

当前应用运行在 Cloudflare Workers + D1(SQLite)。若后续改为 PostgreSQL + 模块化单体，
需要同时调整部署运行时、迁移工具和本地开发链路；建议先把领域模型与写入规则在现有 D1 上收敛，
再评估换库。
