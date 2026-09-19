# A2 第一步：离店与账务闭环

编制日期：2026-09-19　对应《路线图 v2.0》主线 A 的 A2
状态：**离店、账务、房态回归已跑通并接进终端首屏**（真实 D1、双连接 SQLite、入住到退房闭环均有验收用例）

---

## 1. 这一步解决什么

在这之前系统是「入住机」：能把客人送进房间，但客人走了以后，钱和房都没有归宿。

- `folios`（客人账本）与 `ledger_entries`（只追加分录）在迁移 0008 里就建好了，**零写入方**。
- `reservation_status_logs` 也是零写入方。
- 没有人回答「退房时该补收多少 / 该退多少」。
- 没有区分「客人已经离店」和「钱已经结清」。

现在这四件事都有了确定行为。

| 能力 | 载体 |
| --- | --- |
| 开账与押金 | `openFolioWith` |
| 在住消费挂账 | `postChargeWith` |
| 退房报价 | `quoteCheckoutWith` |
| 结算（补收 / 退还）与关账 | `settleFolioWith` |
| 离店、预订收尾、房态转脏 | `checkoutStayWith` |
| 清洁完成转可售 | `markRoomCleanWith` |
| 账实相符与状态合规校验 | `verifyFolioLedger` / `verifyFolioMatchesStay` |

代码位置：

- `lib/settlement-core.ts` — 账务领域逻辑（不接触数据库，只跑 `SqlRunner` 端口）
- `lib/checkout-core.ts` — 离店与房态
- `lib/folio.ts` — D1 适配
- `lib/hotel-core.ts` — 新增 `FOLIO_STATUS`、`LEDGER_ENTRY_TYPES`、分录符号表、`STAY_STATUS_ALLOWED_FOLIO_STATUS`

---

## 2. 金额符号约定（唯一口径）

`ledger_entries.amount` 与 `folios.balance` 使用同一套符号：

| 方向 | 符号 | 分录类型 |
| --- | --- | --- |
| 客人欠酒店 | 正 | `room_charge`、`consumption`、`refund`、`adjustment` |
| 酒店欠客人 | 负 | `deposit`、`settlement` |

于是 **`balance = 0` 就是「钱闭上了」**。押金记 −300，房费 +380，补收 −130，三条相加正好为 0。

`adjustment` 是唯一由调用方直接给出带符号金额的类型，用于人工更正，其它五种必须传正数量级、由 `signedLedgerAmount` 决定符号。

### balance 是缓存，不是事实

`folios.balance` 永远由分录推导，且推导写在单条 SQL 里：

```sql
UPDATE folios SET balance = (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE ...)
```

这样「账实相符」不是靠祈祷，而是结构上成立；即使某次写入中断，下一次重算就自愈，不会留下一个比分录更超前的余额。

---

## 3. 幂等：确定性分录键

分录键不来自调用方，而来自入住单本身：

| 键 | 用途 |
| --- | --- |
| `deposit:<stayId>` | 押金 |
| `room-charge:<stayId>` | 房费 |
| `settlement:<stayId>` | 补收 |
| `refund:<stayId>` | 退还 |

因此**一张入住单只可能存在一笔押金、一笔房费、一笔补收、一笔退款**。重试、并发、换一个 requestId 再来一次，都不可能重复收客人的钱。调用方自己的 `requestId` 仍然保留在 `reference_id` 里用于追溯。

同一幂等键换成不同金额或不同分录类型会被拒绝（`folio_idempotency_key_reused`），而不是被当成重放静默接受。

---

## 4. 状态机：为什么 `settling` 必须存在

```
open ──► settling ──► closed
```

关账分两步 CAS（`open → settling`，`settling → closed`），不是为了好看：它让「已离店、钱没结完」成为一个**可见、可恢复**的状态。若进程在两步之间中断，账本停在 `settling`，正好是需要人工跟进的信号。

这一点刻意规避了本仓库踩过的坑：`READY_FOR_ONSITE_HANDOFF` 曾是代码写得出、流程走不到的孤儿状态。所以 `FOLIO_STATUS` 只保留三个可达值，没有 `void` 之类用不上的枚举。

### 「住宿结束 ≠ 退款完成」的判定表

| 入住单状态 | 允许的账本状态 |
| --- | --- |
| `IDENTITY_PENDING` / `IDENTITY_VERIFIED` | 无要求（还没开账） |
| `IN_HOUSE` | `open` |
| `CHECKED_OUT` | `settling` 或 `closed` |

`CHECKED_OUT` 同时接受 `settling` 与 `closed` 是刻意的：客人离店时账还没结完（比如要退押金）是合规的；离店了账还开着（`open`）则会被 `verifyFolioMatchesStay` 报成 `folio_status_not_allowed_for_stay:open`。

---

## 5. 报价口径

退房报价只认正式表：

- 房费 = `Σ reservation_rooms.nightly_rate` × `reservations.nights`
- 应付 = 房费 + 在住消费 + 人工更正
- 已付 = 押金 + 已补收 − 已退还
- `due = 应付 − 已付`，正数需补收，负数需退还

**不使用 `reservations.total_amount`**。该字段在本地库里是回填占位（8 条全是 680/300，与晚数房型无关），拿它算钱会直接把错误金额推给客人。报价同时返回：

- `missingRate` — 没有房价时拒绝凭猜测报价
- `amountMismatch` — 占位金额与真实应付不一致时给出告警

`amountMismatch` 归入 `warnings` 而不是 `issues`：它是脏投影的数据质量问题，不是账务不平；把它混进阻断问题里，真实的不平就会被噪声淹没。

### 恒等式（测试里交叉校验）

```
balance = due − roomTotal + postedRoomCharge
```

---

## 6. 离店与房态回归

`checkoutStayWith` 依次做三件事，每件都是 CAS：

1. `stays`：`IN_HOUSE → CHECKED_OUT`，写 `checked_out_at`
2. `reservations`：`CHECKED_IN → CHECKED_OUT`，写 `reservation_status_logs`（该表首个写入方）
3. `rooms`：`OCCUPIED → VACANT_DIRTY`，写 `room_status_logs`

房间**不会**直接变成 `VACANT_CLEAN`。没有人打扫过的房间就是脏房，把它标成可售是酒店业务里最贵的错误之一。清洁由 `markRoomCleanWith` 单独确认（`VACANT_DIRTY → VACANT_CLEAN`），重复调用幂等且不重复写流水。

---

## 7. 验收用例

| 用例 | 位置 | 覆盖 |
| --- | --- | --- |
| 真实 D1 集成 | `scripts/test-settlement-d1.mjs` | 开账/挂账/报价/离店/结算/退款/清洁/关账保护/恒等式，35 项 |
| 双连接并发 | `scripts/test-settlement-concurrency.mjs` | 并发开账、并发挂账、并发离店、并发结算、关账后重放，22 项 |
| 迁移与运行时 DDL 漂移 | `scripts/test-schema-drift.mjs` | 20 张表 + 5 个补列的一致性 |
| 入住到退房闭环 | `scripts/test-checkin-checkout-loop.mjs` | 终端入住 → 终端退房 → 打扫回可售，25 项 |

关键断言：并发结算时**恰好一个调用方完成关账**，另一个识别为幂等；房费与补收各只入账一次；退款走反向分录；结算后余额归零且账实相符。

---

## 8. 顺带查出的库问题

新增 `pnpm db:audit`（只读）：把 `drizzle/*.sql` 应用到内存库，再和真实数据库逐表逐列比对。首次运行立刻查出本地 D1 快照有两处漂移：

- 缺表 `orders`（0013 创建）
- 缺列 `admin_audit_events.action_id`（0012 创建）

第二项是**活 bug**：`lib/admin-service.ts` 的换房、改金额、发卡、公安登记四条审计写入都带 `action_id`，而这些对象此前只由迁移创建，本地库从未跑过迁移。已按仓库既有范式在 `lib/tenant.ts` 的守护式补列里补上 `action_id`，前四项不再依赖迁移是否被执行。

根因不是迁移写错了——`scripts/test-schema-drift.mjs` 证明迁移与运行时 DDL **完全一致**——而是**没有任何环节会执行迁移**：本地库靠运行时 bootstrap 长出来，于是「代码用到但 bootstrap 不管」的对象会一直缺。

建议：把 `pnpm db:audit` 加进发布门禁，并在部署流程里真正执行一次 `drizzle/*.sql`。这是 A0 起点固化尚未收掉的一角。

---

## 9. 终端入口（已接通）

首屏不再直接进对话，而是先让客人选业务（`components/terminal-checkout.tsx` 的 `TerminalModeChooser`，两张卡片带入场与掠光动画，`prefers-reduced-motion` 下全部动画禁用）：

| 入口 | 交互 | 后端 |
| --- | --- | --- |
| 办理入住 | 进入既有对话式入住流程 | 既有 `checkin-*` 动作 |
| 办理退房 | 房间号 + 预订手机号后四位 → 核对账目 → 确认结算 | `checkout-lookup`（只读）/ `checkout-confirm`（写入） |

- 退房刻意拆成两次请求：先出报价（不写任何账），客人看清应补收或应退多少之后才确认；确认时服务端**重算**报价，屏幕上的金额不参与结算计算。
- `checkout-confirm` 里「房间释放」与「账目结清」是两次写入：结算失败返回 `202 + needs_followup`，房间已转待清洁、账留在 `settling`，由前台接手——客人已经走了这件事不会被报成失败。
- 还没接房卡读卡器，所以用「房间号 + 手机号后四位」两要素识别；任一不匹配即查不到，同一房间出现多笔在住会停在 `ambiguous` 转人工。
- 闭环用例（`scripts/test-checkin-checkout-loop.mjs`）先跑一遍终端入住，再用同一台终端查退房，覆盖：两要素识别、开账带押金、房费 = 每晚房价 × 晚数、补收 = 房费 − 押金、离店后查不到、重复退房幂等、打扫后房间回可售、四段房态流水齐备。
- 该用例上线即查出一个真 bug：`findInHouseStaysWith` 把 D1 返回的下划线字段当驼峰字段用，`stayId` / `guestNameMasked` 全是 `undefined`，终端退房会一路撞到 `invalid_stay_id`。已改为显式行映射。

---

## 10. 还没做的（A2 剩余部分）

- 把 A2 的四个动作注册进 `workflow_runs`，让 AI 走同一条受控路径（终端已接，AI 工具面未接）
- 发票开具（`invoice.issue`）；`payments` 表与 `walk_in_payments` 的正式化，退款才有资金侧对手方
- 长住多晚的分段结算、部分退款、跨班次交接
- `folios` 目前一次结清；`settling` 状态下的多次部分结算尚未支持
- 房态仍是单值 `ROOM_STATUS`，规范要求的五维房态（占用/清洁/维修/锁房/售卖）尚未拆分
