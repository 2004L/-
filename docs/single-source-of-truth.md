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

## 把正式表摊开给运营看（已接通）

「单一事实来源」如果只有代码知道，运营就只能看到派生出来的图表。管理后台现在多了两块只读窗口：

- **在住客人**（`admin.list_in_house_guests`）：每笔在住记录的房号、脱敏姓名与尾号、入住时间、晚数、账本状态与余额、在住消费，以及**这间房是否需要服务**。房号挂不上的在住记录不会被丢掉，而是以"未分配"留在列表里——系统说不清住哪间的客人，恰恰是前台最需要看到的那个。
- **数据库浏览**（`admin.get_database_schema` / `admin.get_table_rows`）：列出数据库里真实存在的表与行数，可以预览任意一张表的前 20 行。凭据类字段（`password_hash`、`password_salt`、`session_token_hash`、`identity_token`、`phone_hash`）一律脱敏，全部只读。

安全边界：表名只从 `sqlite_master` 里取，请求里给的名字必须命中这份清单才会被执行，因此不可能通过表名拼接注入；内部表（`sqlite_*`、`_cf_*`、`d1_*`）不出现。浏览原始数据库需要 `admin:read_database`，只给店长和老板；前台和客房实测都是 403。

服务需求是这块里唯一的写操作（`admin.set_room_service_need`，权限 `admin:service`，四个角色都有）：一间房要么现在需要点什么，要么不需要，所以一间房只有一行 `room_service_needs`；清除需求是把行翻成 `done` 而不是删除，"这间房是谁说没问题的"永远答得出来。它不动房态也不动账务，所以和打扫完成一样不需要确认弹窗。

用例：`scripts/test-inhouse-d1.mjs`（32 项，真实 D1）。

## 旧数据投影的挂接规则（2026-09-19 修正）

`demo_orders` 是每个浏览器会话自己的一套假订单，而 `reservations` 在 (hotel_id, reservation_no) 上唯一 —— 也就是说，同一个订单号只可能有一条正式预订存在。旧数据投影原来给子记录起名用的是**当前会话自己造的 id**（`stay-` + `demo_orders.id`），于是：

- 第一个会话赢了唯一约束，其余会话写出的入住记录指向一条**从未创建成功的预订** —— 每开一个新会话就多几行，演示库攒到 47 行；
- 唯一那个 id 恰好对上的会话，则给同一条预订写出**第二条入住记录**，同一间房在在住列表里出现两次，其中一条还挂着"在住客人没有账本"。

现在投影改成**按订单号解析真实存在的那条预订**，并用它的 id 当作子记录的 id（`stay-` + `reservations.id`，与终端入住流程完全一致），再加"该预订已有入住记录就不再写"的判断。两端于是落到同一行上。

同时入住记录的**状态以预订为准**：只有预订自己是"已入住/已离店"时，投影才补写入住记录，并且直接沿用预订的状态。理由很简单 —— `demo_orders` 是会话级投影，某个会话可能还留着早已过期的"在住"，把它抄进正式表就会造出一位预订说"他不在店"的客人。

护栏：`scripts/test-legacy-projection-d1.mjs`（23 项，真实 D1）跑的就是 `lib/legacy-projection-core.ts` 里那份 SQL，覆盖两个会话投影同一订单号、重复投影幂等、过期会话状态不许覆盖预订事实、终端流程随后接管同一行。

## 演示界面 vs 正式账（2026-09-20 对齐）

两本账指的不是两个数据库，而是同一库里两组表：

- **正式账**：`reservations` / `orders` / `stays` / `folios` / `rooms`。一个订单号只有一条预订。
- **演示侧**：`demo_orders`，每个浏览器会话各自一套 8 笔假订单。终端和「数据概览」读的都是它。

之前的毛病是两边各说各话：入住回写不带会话条件（一次入住把**所有**会话里那一笔订单都盖成"在住"），退房**完全不回写**（客人走了界面还显示在住），新会话又是照一份写死的模板播种（模板说 4821 待入住，正式账说它已入住）。结果是 40 行分叉 —— 拿这些订单演示，要么走五步才失败，要么直接查不到人。

现在四条规则一起管住：

1. **入住回写只写当前会话**（`projectCheckinToLegacy` 必须带 `sessionId`）：一个客人到店，不该改写别的会话的历史。
2. **退房也回写**：`checkoutConfirm` 成功后就地对齐，"客人已经走了"立刻反映到界面。
3. **播种时按真账对齐**：新会话插完模板行后立刻对齐一次，所以新开的会话一开始就和真账一致。
4. **清理时释放演示侧**：删除已退房闭环之前，先把对应的假订单放回"待入住"（`demoOrderReleaseStatement`，在删表之前跑，因为删完就没有可对照的记录了）。

**对齐只改"不可能的组合"。** 判定方式是枚举（`mirrorFragments`）：界面说在住、订单却是待入住/已退房；界面说已离店、订单却不是已离店；界面说待入住、订单却已入住或已离店……这些组合不可能描述同一位客人，所以按订单纠正。反过来，「待入住 + 订单已确认」「已确认入住单 + 订单已确认」都是办理途中的合法状态，一律不碰 —— 否则客人正站在终端前办理，状态会被回退。

**订单是全局共享的，所以真相要传到每个副本**：对齐按 `hotel_id` 做全量（`demoOrderReconcileAllStatement`），否则那些再也不会被打开的旧会话会一直挂着过期副本。这条也做成了后台按钮：**「数据」区块 → 对齐演示数据**（`admin.reconcile_demo_orders`，权限 `admin:purge_data`，写审计）。实测：40 行分叉 → 点一次 → 0 行；再点一次报 0 修正，幂等。

护栏：`scripts/test-legacy-projection-d1.mjs`（32 项，真实 D1）覆盖挂接与对齐；`scripts/test-checkin-d1.mjs` 覆盖"另一个会话的同一笔订单没有被改写"。

## 门店知识库（RAG 第一版）

政策问答不再来自代码：`knowledge_documents` + `knowledge_chunks` + FTS5（对**写入时切好的二元词**建索引，解决中文两字查询），命中带出处、命中不到转人工。详见 `docs/knowledge-base.md`。

政策**录入选在后台**：店长在「政策知识库」面板里增删改（`admin:manage_knowledge`，只给 owner/manager），保存与停用都要先出确认单再执行；试问走的是终端同一条检索路径。改版自动 +1，停用不删切片。前台与客房只答不问、改不了答案。

**在表里的那份才是真相**：预置语料走 `INSERT OR IGNORE`，改迁移文件不会更新已经迁移过的库。演示库里的停车政策就曾因此停在旧正文（客人问「地库怎么走」转人工，而评测读迁移文件是 26/26）；现在按后台改版同步到 v2，`地库 / 车库 / 停车费 / 停车位` 四种问法都命中并带出处。

护栏：`scripts/test-knowledge-d1.mjs`（27 项）· `scripts/test-knowledge-admin-d1.mjs`（55 项）· `scripts/test-knowledge-eval-d1.mjs`（38 条召回评测，进 CI：正例 ≥ 90%、硬负例零误答）· `scripts/acceptance-knowledge-admin.mjs`（真机 27 项）。全量测试 31 套（`npm test`）。

## 测试会话的备注（不删，只标注）

演示库里已有的历史脏数据是**本机反复手工测试**留下的，决定保留而不删除。为了以后能一眼分清，`demo_sessions` 增加 `note` 字段（迁移 `0018_demo_session_note.sql`），现有 14 个会话已标注为「本机测试会话」（标注人：梁学泽，2026-09-19）。

标注在管理后台「数据」区块里直接可见：打开 `demo_sessions` 表就能看到 `note` 列。

那 47 条"指向不存在预订"的入住记录属于这些会话，它们的 id 里带着会话编号，所以按备注筛出来是这样：

```sql
-- 带测试备注的会话留下的入住记录
SELECT s.id, s.status
FROM stays s
JOIN demo_sessions d ON s.id LIKE 'stay-' || d.id || '-order-%'
WHERE d.note IS NOT NULL;

-- 其中真正"无主"的那些：指向的预订已经不存在
SELECT s.id
FROM stays s
JOIN demo_sessions d ON s.id LIKE 'stay-' || d.id || '-order-%'
WHERE d.note IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = s.reservation_id);
```

约定：**新会话不自动带备注**（自动生成的备注没有信息量）。只有确认是手工测试留下的会话才标注，这样「有备注」就等价于「这是测试残留」。

## Phase 2（客人流程切正式表，第一刀已完成）

- 新增 `lib/checkin-core.ts`：正式办理层，负责 `orders`、`reservations`、`reservation_rooms`、`rooms`、`room_status_logs`、`reservation_status_logs`、`stays` 的幂等写入；`lib/checkin.ts` 是 D1 适配层。
- `app/api/demo/[action]/route.ts` 改为正式表优先：种子订单、现场订单、锁房、入住确认都先写正式表，再把状态与房间号投影回 `demo_orders`，会话 UI 不变。
- 锁房用 `rooms.status` 的 CAS（空闲→已锁），房间被他人占用时拒绝；入住确认用 `reservations.status` 的 CAS（已确认→已入住），已取消预订无法确认。
- 终端不再指定房号：`holdFormalRoom` 省略 `roomNumber` 时由服务端从「可售（`VACANT_CLEAN`）且未被在住预订占用」的房里挑一间，并把结果写回 `reservation_rooms.room_id`；挑不到就是 `no_sellable_room`。脏房永远不会被挑中。
- 房态关键写入（锁房、入住确认）**不再降级**：失败会写 `FORMAL_SYNC_FAILED` 审计事件并返回 `handoff` 让前台接手，客人流程停在明确停点，而不是带着没落库的房态继续往下走；只有外观类投影（`demo_orders` 的状态与房号）失败才告警继续。
- `confirmFormalCheckin` 在写任何数据之前先确认房间确实处于 `HELD`/`OCCUPIED`，否则抛 `room_not_held`；不这样挡一次，就会留下「客人在住、房间仍被当成空房」的幽灵在住记录。
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
