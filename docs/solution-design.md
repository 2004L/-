# Hotel Agent OS 领域与技术方案稿

版本：v1.0（方案稿）　编制日期：2026-09-19
上位文档：`docs/business-facts-and-state-model.md`（业务事实与状态流转规范）、`docs/single-source-of-truth.md`（权威归属与迁移计划）
定位：把规范落到**字段、约束、接口、算法**级别，作为开发依据。规范回答「什么算成立」，本方案回答「怎么实现」。

---

## 0. 文档说明

### 0.1 范围

| 覆盖 | 不覆盖 |
| --- | --- |
| 订单 / 预订 / 住宿 / 分房 / 账务 / 政策 / 凭证的领域模型 | 真实硬件协议与驱动实现 |
| 状态机、转移表、并发与幂等规则 | 真实支付渠道对接细节 |
| 结算算法（纯函数）与政策解析 | 真实 PMS 字段级映射 |
| 三个交互入口的接口契约 | 前端视觉设计 |
| 迁移路径与验收用例 | 硬件选型 |

### 0.2 阅读顺序

先读第 1 章（总则）与第 2 章（基线），再读第 3 章（领域模型）与第 4 章（状态机），这两章是其余章节的基础。第 5、6 章（结算与政策）是本次方案的技术核心。第 13、14 章是决策与排期。

### 0.3 与现有代码的关系

本方案**保留** `lib/hotel-core.ts` 的三条状态机与 `lib/orders-core.ts` 的双端口（`SqlRunner`）设计，在此之上扩展，不推倒重来。第 13 章明确哪些现有设计需要调整。

---

## 1. 设计总则

### 1.1 分层

```
┌──────────────────────────────────────────────────────┐
│ 交互面  入口A 身份证  入口B 房卡  入口C 前台/后台        │
│         └──────────── 贯穿的 AI 层 ────────────┘       │
├──────────────────────────────────────────────────────┤
│ 应用服务  入住服务 · 退房服务 · 换房服务 · 结算服务       │
│           凭证服务 · 政策服务 · 对账服务                │
├──────────────────────────────────────────────────────┤
│ 领域内核  状态机 · 转移表 · 结算纯函数 · 政策解析         │
│           （无副作用，不接触数据库）                     │
├──────────────────────────────────────────────────────┤
│ 集成层    仓储（SqlRunner）· PMS · 支付 · 门锁 · 读证     │
└──────────────────────────────────────────────────────┘
```

**硬性约束**：领域内核不得导入数据库、网络或任何运行时依赖。`lib/hotel-core.ts` 已遵守此约束，新增的结算函数与政策解析必须同样遵守。

### 1.2 五条不变量

| 编号 | 不变量 | 违反后果 |
| --- | --- | --- |
| I1 | 事实只追加，不修改 | 无法追溯「为什么变成这样」 |
| I2 | 有副作用的操作必须有幂等键 | 重复退款、重复发卡 |
| I3 | 状态由事实推导；需要落库的状态必须带 `version` | 并发覆盖、静默丢失更新 |
| I4 | 金额只能由纯函数根据政策与事实计算 | 金额争议无法解释 |
| I5 | 无法确认成功时，不得记录为成功 | 假成功引发连锁错账 |

### 1.3 命名与数值约定

- **金额**：一律用**整数分**存储。字段名以 `_amount` 结尾，语义为分。禁止浮点。
- **时间**：一律存 ISO-8601 UTC 字符串（`2026-09-19T02:03:04.000Z`），字段名以 `_at` 结尾。业务日期另存 `business_date`（`YYYY-MM-DD`）。
- **主键**：`<prefix>-<uuid>`，前缀用于识别实体类型（`ord-`、`pay-`、`rfd-`、`fio-`、`key-`、`ral-`）。现有 `orders.id` 已使用 `ord-` 且 `projectOrderToLegacyWith` 依赖该前缀，**必须保持**。
- **状态字段**：整数枚举用 `status`（沿用现有），字符串枚举用 `_status` 后缀（如 `housekeeping_status`）以示区别。
- **作用域**：所有业务表必带 `tenant_id`、`hotel_id`，且所有查询必须带 `hotel_id` 条件。

---

## 2. 基线盘点

### 2.1 可直接复用

| 表 / 模块 | 现状 | 本方案的处理 |
| --- | --- | --- |
| `orders` | 已建立，含金额四元组、`version`、幂等键 | **保留**，新增 `order_items` 承载价格明细 |
| `reservations` | 已建立，`nights`/`room_count`/`version` | **保留**，金额字段待下线（见 12.3） |
| `rooms` | 已建立，`status` + `version` + `formalRoomId()` | **扩展**为双维度（见 4.4） |
| `room_status_logs` | 已由管理员换房写入 | **保留**，扩展为统一房态变更入口 |
| `reservation_rooms` | 分房雏形，含 `nightlyRate` | **升级**为 `room_assignments`（见 3.3.4） |
| `stays` | 骨架，仅回填写入 | **启用**为住宿事实权威表 |
| `folios` / `ledger_entries` | 表已建，零写入 | **启用**，见 5.2 |
| `hotels.business_date` | 字段已存在 | **启用**为营业日载体 |
| `hotel_terminals` | 表已建，零写入 | **启用**为终端注册（设备可信阶段） |
| `lib/orders-core.ts` | 双端口 + 原子条件更新 + 冲突分类 | **作为所有新仓储的模板** |
| `lib/hotel-core.ts` | 三条状态机 + 断言 | **扩展**，保持无副作用 |

### 2.2 已建但零写入（必须处理）

`reservation_status_logs`、`folios`、`ledger_entries`、`hotel_terminals`、`user_hotel_scopes`

### 2.3 完全缺失（必须新建）

`order_items`、`folio_items`、`settlements`、`payments`、`refunds`、`room_assignments`、`stay_guests`、`reservation_guests`、`hotel_policies`、`policy_versions`、`key_credentials`、`hotel_business_days`

---

## 3. 领域模型

### 3.1 实体关系

```
tenants ─→ hotels ─┬─→ room_types ─→ rooms
                   │
                   ├─→ hotel_policies ─→ policy_versions   (不可变)
                   │
                   ├─→ reservations ─┬─→ reservation_guests
                   │                 └─→ reservation_rooms ─┐
                   │                                        │
                   ├─→ orders ─→ order_items                │
                   │                                        │
                   ├─→ stays ─┬─→ stay_guests               │
                   │          ├─→ room_assignments ←────────┘
                   │          ├─→ folios ─┬─→ folio_items
                   │          │           └─→ ledger_entries (只追加)
                   │          └─→ key_credentials ─→ rooms
                   │
                   ├─→ settlements ─┬─→ payments
                   │                └─→ refunds
                   │
                   └─→ hotel_business_days
```

### 3.2 三条关系原则

1. **订单 ↔ 住宿**：一笔 `orders` 可对应多笔 `stays`（一次预订分多次到店）。关联通过 `stays.reservation_id` → `reservations.id` → `orders.reservation_no`。
2. **住宿 ↔ 房间**：通过 `room_assignments` 多对多。一次住宿可涉及多间房（换房、多房入住），一间房在不同时间段属于不同住宿。**禁止**把 `room_id` 直接写在 `stays` 上。
3. **住宿 ↔ 人**：通过 `stay_guests` 一对多，含 `role`（`PRIMARY` / `ACCOMPANYING`）。**禁止**用姓名或证件号作为关系键。

### 3.3 表结构设计

以下仅列出新增表与需变更字段；未列出的字段沿用现有定义。

#### 3.3.1 `order_items`（价格明细）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `oit-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | 作用域 |
| `order_id` | TEXT | → `orders.id` |
| `item_type` | TEXT | `ROOM_NIGHT` / `EXTRA` / `TAX` / `DISCOUNT` / `PENALTY` |
| `business_date` | TEXT | 该行费用归属的营业日 |
| `room_type_id` | TEXT NULL | 房费行必填 |
| `quantity` | INTEGER | 数量 |
| `unit_amount` | INTEGER | 单价（分） |
| `amount` | INTEGER | 小计（分） |
| `created_at` | TEXT | |

**约束**：`UNIQUE(hotel_id, order_id, item_type, business_date, room_type_id)`；`amount = quantity * unit_amount` 由服务层断言。

**为什么需要**：现方案用 `orders.room_amount / nights` 反推单价。多晚不同房价（周末价、节假日价）会让这个反推彻底失效，进而让结算无法解释。

#### 3.3.2 `folio_items`（账务费用行）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `fit-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | 作用域 |
| `folio_id` | TEXT | → `folios.id` |
| `item_type` | TEXT | `ROOM_NIGHT` / `EXTRA` / `TAX` / `PENALTY` / `DISCOUNT` / `DEPOSIT` |
| `description` | TEXT | 展示用描述 |
| `quantity` | INTEGER | |
| `unit_amount` | INTEGER | |
| `amount` | INTEGER | 正数为应收，负数为减免/冲销 |
| `business_date` | TEXT | 营业日 |
| `source_type` / `source_id` | TEXT | 来源（订单/消费/人工调整） |
| `idempotency_key` | TEXT | |
| `created_at` | TEXT | |

**约束**：`UNIQUE(hotel_id, idempotency_key)`。**只追加**，冲销用反向行，不修改原行。

#### 3.3.3 `settlements`（结算单）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `stl-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | 作用域 |
| `stay_id` | TEXT | → `stays.id` |
| `folio_id` | TEXT | → `folios.id` |
| `order_id` | TEXT | → `orders.id` |
| `policy_version_id` | TEXT | **计算所依据的政策版本** |
| `calc_json` | TEXT | 完整计算依据快照（输入项 + 中间量 + 规则命中） |
| `order_amount` | INTEGER | 订单应付 |
| `collected_amount` | INTEGER | 实际收款 |
| `consumed_amount` | INTEGER | 已发生费用 |
| `refundable_amount` | INTEGER | 应退金额 |
| `deposit_refund_amount` | INTEGER | 押金应返 |
| `deposit_forfeit_amount` | INTEGER | 押金应扣 |
| `adjustments_json` | TEXT | 人工调整记录 |
| `approval_id` | TEXT NULL | 人工审批 ID（超阈值时必填） |
| `status` | TEXT | `DRAFT` / `CONFIRMED` / `SETTLED` / `VOID` |
| `created_at` / `finalized_at` | TEXT | |

**为什么需要**：退房服务不得直接退「总金额」。结算单是「算多少」与「退多少」之间的强制中间层，也是客人争议时的解释依据。

#### 3.3.4 `room_assignments`（正式分房）

由 `reservation_rooms` 升级而来，需补「时间区间」与「释放原因」：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `ral-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | |
| `stay_id` | TEXT | → `stays.id` |
| `reservation_room_id` | TEXT NULL | 来源预订行 |
| `room_id` | TEXT | → `rooms.id` |
| `assigned_at` | TEXT | 生效时间 |
| `released_at` | TEXT NULL | 释放时间，NULL 表示仍占用 |
| `release_reason` | TEXT NULL | `CHECKOUT` / `ROOM_CHANGE` / `CORRECTION` / `CANCEL` |
| `assigned_by` | TEXT | 操作者 |
| `request_id` | TEXT | 关联业务请求 |
| `is_primary` | INTEGER | 是否主房 |
| `created_at` / `updated_at` | TEXT | |

**关键约束**：**同一房间在 `[assigned_at, released_at)` 区间内不得有两条 `released_at IS NULL` 的记录**。SQLite 无法直接表达区间唯一约束，用「部分唯一索引 + 服务层 CAS」组合实现：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS room_assignments_active_uq
  ON room_assignments(hotel_id, room_id) WHERE released_at IS NULL;
```

该索引保证**任一房间同时最多只有一个活跃分配**，是防超售的数据库级兜底。

#### 3.3.5 `stay_guests` / `reservation_guests`（住客）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `tenant_id` / `hotel_id` | TEXT | |
| `stay_id` / `reservation_id` | TEXT | |
| `role` | TEXT | `PRIMARY` / `ACCOMPANYING` |
| `display_name_masked` | TEXT | 脱敏姓名 |
| `identity_token` | TEXT NULL | 不可逆令牌，不存证件号 |
| `phone_last4` | TEXT NULL | |
| `checked_in_at` / `checked_out_at` | TEXT NULL | 仅 `stay_guests` |
| `created_at` / `updated_at` | TEXT | |

**授权规则**：仅 `role = PRIMARY` 可查看支付信息、申请退款、授权他人。

#### 3.3.6 `payments`（支付与预授权）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `pay-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | |
| `order_id` | TEXT | |
| `stay_id` | TEXT NULL | |
| `purpose` | TEXT | `ROOM_FEE` / `DEPOSIT` / `EXTRA` |
| `method` | TEXT | `WECHAT` / `ALIPAY` / `CARD` / `CASH` |
| `channel_txn_id` | TEXT NULL | 渠道交易号 |
| `amount` | INTEGER | 请求金额 |
| `authorized_amount` | INTEGER | 已授权金额（预授权） |
| `captured_amount` | INTEGER | 已扣款金额 |
| `status` | TEXT | 见 4.5 |
| `expires_at` | TEXT NULL | **预授权有效期，必须有** |
| `idempotency_key` | TEXT | |
| `created_at` / `updated_at` | TEXT | |

**约束**：`UNIQUE(hotel_id, idempotency_key)`；`UNIQUE(hotel_id, channel_txn_id)`（非空时）。

**预授权与扣款必须分开记**：`authorized_amount` 是资金**占用**，`captured_amount` 是资金**入账**。解除预授权只把 `authorized_amount` 归零并记 `RELEASED`，**不得**产生 `refunds` 行。

#### 3.3.7 `refunds`（退款）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `rfd-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | |
| `payment_id` | TEXT | 原支付 |
| `settlement_id` | TEXT | 来源结算单 |
| `amount` | INTEGER | |
| `reason` | TEXT | |
| `status` | TEXT | 见 4.6 |
| `channel_refund_id` | TEXT NULL | |
| `idempotency_key` | TEXT | |
| `requested_at` / `completed_at` | TEXT NULL | |
| `created_at` / `updated_at` | TEXT | |

**约束**：`UNIQUE(hotel_id, idempotency_key)`。**累计退款金额不得超过对应结算单的 `refundable_amount`**，由服务层在同一事务内校验。

#### 3.3.8 `hotel_policies` / `policy_versions`

`hotel_policies`（政策身份，可变）：

| 字段 | 说明 |
| --- | --- |
| `id` / `tenant_id` / `hotel_id` | |
| `code` | 政策编码 |
| `name` | 名称 |
| `scope` | `HOTEL` / `ROOM_TYPE` / `RATE_PLAN` |
| `scope_ref` | 适用范围 ID |
| `status` | `ACTIVE` / `RETIRED` |
| `current_version_id` | 当前生效版本 |

`policy_versions`（**不可变**）：

| 字段 | 说明 |
| --- | --- |
| `id` / `policy_id` | |
| `version_no` | 单调递增 |
| `rules_json` | 结构化规则 |
| `effective_from` / `effective_to` | 生效区间 |
| `checksum` | 内容校验和 |
| `published_by` / `published_at` | 发布者与时间 |

**唯一约束**：`UNIQUE(policy_id, version_no)`。**禁止 UPDATE `rules_json`**。新版本 = 新行。

#### 3.3.9 `key_credentials`（房卡凭证）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `key-<uuid>` |
| `tenant_id` / `hotel_id` | TEXT | |
| `stay_id` | TEXT | |
| `room_id` | TEXT | |
| `credential_ref` | TEXT | 卡号或凭证标识 |
| `key_type` | TEXT | `PHYSICAL_CARD` / `MOBILE` / `PIN` |
| `status` | TEXT | `ACTIVE` / `SUSPENDED` / `REVOKED` / `EXPIRED` |
| `issued_at` / `revoked_at` | TEXT | |
| `revoked_reason` | TEXT NULL | `CHECKOUT` / `ROOM_CHANGE` / `LOST` / `REISSUE` |
| `device_id` | TEXT NULL | 发卡设备 |
| `request_id` | TEXT | |

**约束**：`UNIQUE(hotel_id, credential_ref)`。

#### 3.3.10 `hotel_business_days`（营业日）

| 字段 | 说明 |
| --- | --- |
| `id` / `tenant_id` / `hotel_id` | |
| `business_date` | `YYYY-MM-DD` |
| `status` | `OPEN` / `CLOSED` |
| `opened_at` / `closed_at` / `closed_by` | |
| `stats_json` | 夜审快照（间夜、收入、在住数） |

**约束**：`UNIQUE(hotel_id, business_date)`。营业日关闭后，该日的账务行**禁止再写入**（冲销走当日反向行）。

### 3.4 权威归属矩阵

| 事实 | 权威表 | 唯一写入方 | 只读方 |
| --- | --- | --- | --- |
| 订单金额与商业状态 | `orders` | 订单服务 | 所有 |
| 订单价格明细 | `order_items` | 订单服务 | 结算服务 |
| 预订与房型需求 | `reservations` | 预订服务 | 入住、结算 |
| 分房 | `room_assignments` | 入住服务 | 房态推导、换房 |
| 住宿事实 | `stays` | 入住服务 | 全部 |
| 住客 | `stay_guests` | 入住服务 | 授权判断 |
| 账务 | `folios` / `folio_items` | 账务服务 | 结算 |
| 分录 | `ledger_entries` | 账务服务 | 对账 |
| 结算结果 | `settlements` | 结算服务 | 退款、客诉 |
| 资金 | `payments` / `refunds` | 支付服务 | 结算、对账 |
| 政策 | `policy_versions` | 政策服务 | 结算、AI |
| 凭证 | `key_credentials` | 凭证服务 | 门锁、终端 |
| 房态流水 | `room_status_logs` | 房务服务 | 房态推导 |

**单向依赖**：结算读订单与账务，退款读结算；反向依赖一律禁止。
---

## 4. 状态机设计

### 4.1 订单商业状态（保留现有）

`ORDER_STATUS`（`lib/hotel-core.ts`）保持不变：

| from \ to | PENDING_PAYMENT | PAID | CANCELLED | REFUNDED | CLOSED |
| --- | --- | --- | --- | --- | --- |
| PENDING_PAYMENT | — | ✅ | ✅ | ❌ | ❌ |
| PAID | ❌ | — | ❌ | ✅ | ✅ |
| CANCELLED | ❌ | ❌ | — | ❌ | ❌ |
| REFUNDED | ❌ | ❌ | ❌ | — | ❌ |
| CLOSED | ❌ | ❌ | ❌ | ❌ | — |

**需要补充的约束**：`PAID → REFUNDED` 必须要求**累计退款金额已达 `orders.collected_amount`**，否则应停留在 `PAID`。当前转移表无法表达这一点，需在服务层加断言。

### 4.2 预订状态（保留现有）

`RESERVATION_STATUS` 保持不变。补一条：`CONFIRMED → NO_SHOW` 只能在营业日关闭后由夜审触发，不允许人工直接置位。

### 4.3 住宿状态（需调整）

现有 `STAY_STATUS = { IDENTITY_PENDING: 0, IDENTITY_VERIFIED: 1, IN_HOUSE: 2, CHECKED_OUT: 3 }` 把「身份核验」与「住宿生命周期」混在一条链上，会导致身份核验失败时住宿状态无法表达。

**建议拆为两条**：

```
住宿生命周期 STAY_STATUS
  PENDING(0) ──→ IN_HOUSE(1) ──→ ENDED(2)
      │                              ↑
      └──────────→ CANCELLED(3) ─────┘（不可逆）

身份核验 IDENTITY_STATUS（独立）
  NOT_STARTED(0) → PENDING(1) → VERIFIED(2)
                            └─→ FAILED(3) → 转人工
```

**理由**：身份核验失败时，住宿并未开始，但也不能说它「取消」——需要人工介入后决定。两条链解耦后，`STAY_STATUS = PENDING ∧ IDENTITY_STATUS = FAILED` 能准确表达「客人到了、证没过、等人处理」。

**转移表**：

| from \ to | PENDING | IN_HOUSE | ENDED | CANCELLED |
| --- | --- | --- | --- | --- |
| PENDING | — | ✅ | ❌ | ✅ |
| IN_HOUSE | ❌ | — | ✅ | ❌ |
| ENDED | ❌ | ❌ | — | ❌ |
| CANCELLED | ❌ | ❌ | ❌ | — |

**约束**：`PENDING → IN_HOUSE` 要求 `IDENTITY_STATUS = VERIFIED` **且**存在至少一条活跃 `room_assignments`。

### 4.4 房态五维

现有 `ROOM_STATUS` 单值混合了清洁、占用、维护三类语义。本方案拆为「两个落库维度 + 两个派生维度」：

**落库维度**

| 列 | 取值 | 写入方 | 说明 |
| --- | --- | --- | --- |
| `housekeeping_status` | `CLEAN` / `DIRTY` / `INSPECTING` | 客房服务 | 清洁事实 |
| `usability_status` | `SELLABLE` / `OUT_OF_ORDER` / `OUT_OF_SERVICE` | 工程 / 前台 | 维修与封房事实 |

**派生维度（不落库）**

| 维度 | 推导方式 |
| --- | --- |
| 是否被预订 | 存在 `reservation_rooms` 关联的 `reservations` 在今日区间内且状态为 `CONFIRMED` |
| 是否实际在住 | 存在 `room_assignments` 满足 `released_at IS NULL` 且对应 `stays.status = IN_HOUSE` |
| **是否可销售** | `usability_status = SELLABLE` ∧ `housekeeping_status = CLEAN` ∧ 不在住 ∧ 未被预订 |

**为什么派生而非落库**：被预订与在住是**随时间自动变化**的（比如过了离店日期就自动不占了）。如果落成字段，就必须有定时任务去同步，同步一失败房态就错，且无法回答「为什么这间房显示不可售」。派生则可随时重算。

**兼容**：过渡期保留 `rooms.status`（`ROOM_STATUS` 整数），由两个新列 + 派生结果反算，供旧代码读取。新代码只读写新列。

**关键规则**：退房后房态只能进入 `DIRTY`，**不得**直接变成可售。`CLEAN → SELLABLE` 需要客房服务显式操作。

### 4.5 支付状态

```
REQUESTED ──→ AUTHORIZED ──→ CAPTURED
    │             │              │
    │             └──→ RELEASED  └──→ PARTIALLY_REFUNDED ──→ REFUNDED
    │
    └──→ FAILED
    └──→ UNKNOWN  ← 超时/结果不明，必须由对账收敛
```

`AUTHORIZED`（预授权占用）与 `CAPTURED`（实际入账）**是两条不同的路径**，不得互相转换时丢失金额。

### 4.6 退款状态

```
REQUESTED ──→ ACCEPTED ──→ REFUNDED
    │             │
    │             └──→ FAILED
    └──→ UNKNOWN（渠道结果不明）
```

**`UNKNOWN` 是一等状态**，必须挂对账任务，不得当成失败重发。

### 4.7 结算状态

```
DRAFT ──→ CONFIRMED ──→ SETTLED
  │           │
  └──→ VOID   └──→ VOID
```

`DRAFT` 可重算；`CONFIRMED` 后金额冻结，修改必须走人工调整并留痕；`SETTLED` 表示退款已全部完成。

### 4.8 凭证状态

```
ACTIVE ──→ SUSPENDED ──→ ACTIVE（挂失后可恢复）
   │           │
   └───────────┴──→ REVOKED（不可逆）
   └──────────────→ EXPIRED（到期）
```

**规则**：退房时必须将本次住宿的**全部** `ACTIVE` 凭证置 `REVOKED`，含同行人卡。换房时必须先签发新凭证并确认可用，**再**撤销旧凭证。

### 4.9 非法转移与并发冲突的处理约定

统一沿用 `lib/orders-core.ts` 已建立的做法：

1. **条件更新是权威**：`UPDATE ... WHERE hotel_id = ? AND id = ? AND status = ? [AND version = ?]`。
2. **影响行数为 0 时做一次只读查询分类**，区分 `NOT_FOUND` / `VERSION_CONFLICT` / `STATUS_CONFLICT`，绝不返回「虚假成功」。
3. **错误码常量集中定义**（仿 `ORDER_ERRORS`），不散落字符串。
4. **非法转移在进入数据库前先断言**（仿 `assertOrderTransition`），避免产生部分写入。

---

## 5. 金额与结算

### 5.1 金额分类

| 概念 | 字段来源 | 大白话 |
| --- | --- | --- |
| 订单应付金额 | `orders.total_amount` | 客人原本应该付多少 |
| 实际收款 | `orders.collected_amount`（由 `payments.captured_amount` 汇总） | 渠道真正收到了多少 |
| 已发生费用 | `sum(folio_items.amount)`（不含押金行） | 已住房晚 + 额外消费 + 适用收费 |
| 应退金额 | `settlements.refundable_amount` | 按条款和实际结算后应该返还多少 |
| 实际退款 | `sum(refunds.amount WHERE status = REFUNDED)` | 渠道已经成功退回多少 |

**`collected_amount` 必须由 `payments` 汇总，不得人工填写。** 现有 `orders.paid_amount` 改为只读派生值，由支付服务在收款事实成立后维护。

### 5.2 结算单与账务的关系

```
folio_items（费用事实，只追加）
        ↓ 汇总
folios.balance（当前余额）
        ↓ 加政策 + 订单 + 支付 输入
settlements（结算结果快照）
        ↓
refunds（退款执行）
```

`ledger_entries` 记录**资金流**（收款、退款、押金收退），与 `folio_items` 的**费用流**分开。两者相加应恒等于零：

```
sum(folio_items.amount) + sum(ledger_entries.amount) = folios.balance
```

此式作为对账任务的核心断言。

### 5.3 结算纯函数

**位置**：`lib/settlement-core.ts`，与 `lib/orders-core.ts` 同级，遵守「不接触数据库」约束。

```ts
type SettlementInput = {
  nights: number;
  orderNightlyRates: { businessDate: string; unitAmount: number }[];
  orderTotalAmount: number;
  collectedAmount: number;
  consumedItems: { itemType: string; amount: number; businessDate: string }[];
  depositCollectedAmount: number;
  depositAuthorizedOnly: boolean;   // 押金仅为预授权
  policyRules: PolicyRules;         // 已解析的规则，非版本 ID
  actualStay: { checkInAt: string; checkOutAt: string; businessDate: string };
  adjustments: { amount: number; reason: string; approvedBy: string }[];
};

type SettlementResult = {
  orderAmount: number;
  collectedAmount: number;
  consumedAmount: number;
  roomFeeCharged: number;
  depositRefundAmount: number;
  depositForfeitAmount: number;
  refundableAmount: number;
  requiresApproval: boolean;
  trace: SettlementTrace[];   // 每一步命的规则与计算过程
};

function computeSettlement(input: SettlementInput): SettlementResult;
```

**要求**：

1. **纯函数**，输入完全决定输出，无时间、无随机、无 IO。
2. 输出必须带 `trace`，逐步记录命中了哪条政策、算出了什么中间值。这份 trace 就是客人争议时的解释依据。
3. **禁止「总金额 ÷ 晚数」**。房费按 `orderNightlyRates` 逐晚累加。
4. `requiresApproval` 由阈值规则决定，为 `true` 时结算单不得进入 `CONFIRMED`。

**复用点**：同一个函数被三处调用——单元测试、后台「退款模拟」、AI 的「现在退房能退多少」。这是 AI 能安全接入资金环节的前提：AI 调的是同一个确定性函数，不自己算钱。

### 5.4 押金与预授权

| 情形 | 记录方式 | 退房时动作 |
| --- | --- | --- |
| 押金实际扣款 | `payments.purpose = DEPOSIT`, `status = CAPTURED` | 生成 `refunds` 行 |
| 押金仅预授权 | `payments.purpose = DEPOSIT`, `status = AUTHORIZED` | 置 `RELEASED`，**不生成退款行** |

**预授权必须有 `expires_at`**，并有超时释放任务。否则会永久占用客人额度，引发客诉。

**对账口径**：预授权不计入「实际收款」，解除预授权不计入「实际退款」。两类报表必须分开，否则收入会被虚增或虚减。

### 5.5 多通道支付

一个订单可由多笔 `payments` 构成（例如微信付房费 + 现金付押金）。规则：

1. 退款按**原路退回**，即退回到原 `payment_id` 对应的渠道。
2. 若某渠道已不可用，必须有明确的人工流程，**不得**默认改退到其他渠道。
3. 结算单按 `payment_id` 拆分退款明细，每笔独立记录 `channel_refund_id`。

### 5.6 舍入与币种

- 全链路整数分，**不存在舍入**。任何除法必须在结算函数内用明确的分配规则（余数分给首晚）实现，并记入 trace。
- 币种存在 `orders.currency` / `payments` 隐含默认为 CNY。跨币种暂不支持，若出现必须在结算前拒绝并转人工。

---

## 6. 政策中心

### 6.1 五层解析

| 层 | 内容 | 来源 |
| --- | --- | --- |
| 1 强制要求与合法约束 | 法规、安全、身份登记 | 系统硬编码 + 地区配置 |
| 2 订单已成立的约定 | 订房时适用的取消/退款/价格条款 | **订单保存的条款快照** |
| 3 订单特殊条件 | 房价计划、OTA、协议客户、优惠券 | 订单属性 |
| 4 酒店通用政策 | 入住/退房时间、押金、服务 | 当前生效政策版本 |
| 5 已授权的例外 | 补偿、减免、特殊退款 | 人工审批记录 |

**这不是可覆盖法律或合同的绝对排序。** 发生冲突时按适用法律与合同处理；无法自动判定的转授权人员。

### 6.2 版本与快照

**两条硬规则**：

1. **`policy_versions` 不可变**。禁止 `UPDATE rules_json`。修改 = 发布新版本。
2. **订单保存条款快照**。下单时把当时适用的规则写入订单侧，退房结算时以快照为准，**不读当前政策**。

> 客人 9 月 1 日订房，当时允许提前退房退还未住房费；酒店 9 月 10 日改了政策。结算必须用 9 月 1 日的规则。

**快照实现**：新增 `reservations.policy_snapshot_json` 与 `reservations.policy_version_id`，在下单事务内一并写入。相对地，`settlements.policy_version_id` 指向结算时实际使用的版本，两者不一致时以订单快照为准并告警。

### 6.3 规则的结构化表达

规则必须是**可校验、可模拟、可版本比对**的结构化数据，不是自然语言。建议形态：

```json
{
  "cancellation": {
    "freeUntil": { "hoursBeforeCheckIn": 24 },
    "afterDeadline": { "type": "FIRST_NIGHT" }
  },
  "earlyCheckout": {
    "unusedNightsRefund": "FULL",
    "noticeHoursRequired": 0
  },
  "deposit": {
    "mode": "AUTHORIZATION",
    "amountPerRoom": 30000,
    "releaseOnCheckout": true
  },
  "lateCheckout": {
    "freeUntil": "12:00",
    "tiers": [{ "until": "18:00", "charge": { "type": "HALF_NIGHT" } }]
  },
  "approval": { "refundThreshold": 100000 }
}
```

**为什么必须结构化**：只有结构化才能做「结构化规则校验 → 模拟典型订单 → 展示受影响范围与退款差异」。自然语言规则无法模拟，也就无法预知改政策会让多少订单的退款金额变化。

### 6.4 发布流程

```
管理员提出需求
      ↓
AI 生成政策草稿（结构化）
      ↓
结构化规则校验（字段完备、取值合法、区间不冲突）
      ↓
模拟典型订单（调用 computeSettlement 纯函数）
      ↓
展示受影响订单范围与退款差异
      ↓
有权限管理员确认（涉及资金的政策必须人工确认）
      ↓
发布新 policy_version
      ↓
同步到：新订单快照 / 前台政策页 / 自助终端 / AI 知识来源
```

**AI 权限边界**：AI 可以起草、校验、模拟、解释；**不得**绕过审批发布涉及资金的政策、改写历史条款、或修改支付记录。
---

## 7. 时间与营业日

### 7.1 双时间字段

所有业务表**同时**记录：

| 字段 | 语义 | 用途 |
| --- | --- | --- |
| `created_at` / `*_at` | UTC 时间戳 | 审计、排序、对账 |
| `business_date` | 归属营业日 `YYYY-MM-DD` | 收入归属、夜审、跨日价格 |

**为什么必须双记**：凌晨 1 点退房属于前一个营业日还是当天，直接影响跨日价格、延迟退房费、夜审锁定与历史结算。只存时间戳就无法回答这个问题，且事后无法补算。

### 7.2 营业日规则

- `hotels.business_date` 表示**当前打开**的营业日。
- 夜审时点默认 `06:00` 当地时间（可配置）。在某营业日 06:00 之前发生的事件，归属**前一个**营业日。
- 夜审关闭当日：写入 `hotel_business_days` 记录，`status = CLOSED`，生成 `stats_json` 快照（间夜数、收入、在住数、退房数）。
- **关闭后的营业日禁止再写入账务行**。补录只能通过当日的冲销/调整行完成。

### 7.3 跨日价格与延迟退房

- 房费按 `order_items.business_date` 逐晚归属，不做平均。
- 延迟退房费按 `policy_rules.lateCheckout.tiers` 判定，归属**退房当日**的营业日。
- 跨营业日的延迟退房（如次日凌晨）归属规则由 `business_date` 决定，不由时间戳决定。

### 7.4 时间注入

领域内核中的结算函数需要「当前营业日」时，必须**由调用方作为参数传入**，不得内部调用 `new Date()`。这是保证纯函数与可测试性的前提。

---

## 8. 幂等与并发

### 8.1 幂等键规范

| 操作 | 幂等键构成 | 唯一约束位置 |
| --- | --- | --- |
| 创建订单 | 调用方提供，或 `order:<hotel>:<external_id>` | `orders(hotel_id, idempotency_key)` |
| 支付请求 | `pay:<order_id>:<purpose>:<attempt>` | `payments(hotel_id, idempotency_key)` |
| 支付回调 | 渠道交易号 | `payments(hotel_id, channel_txn_id)` |
| 生成结算单 | `settle:<stay_id>:<policy_version_id>` | `settlements(hotel_id, idempotency_key)` |
| 发起退款 | `refund:<settlement_id>:<seq>` | `refunds(hotel_id, idempotency_key)` |
| 入账费用行 | `folioitem:<stay_id>:<source_type>:<source_id>` | `folio_items(hotel_id, idempotency_key)` |
| 签发凭证 | `key:<stay_id>:<room_id>:<seq>` | `key_credentials(hotel_id, credential_ref)` |
| 分房 | `assign:<stay_id>:<room_id>:<seq>` | 部分唯一索引（4.4 与 3.3.4） |
| 房态变更 | `roomlog:<request_id>:<seq>` | `room_status_logs` 无唯一约束，靠 `request_id` 去重 |

**规则**：
- 幂等键由**调用方**提供或由**服务层按确定性规则派生**，不得使用随机值。
- 幂等重放时**必须校验参数一致性**（仿 `matchesCreateRequest`）。参数不一致要抛错，不能静默返回旧结果。
- 幂等键长度上限 160。

### 8.2 并发控制

三种模式，按场景选用：

| 模式 | 适用 | 实现 |
| --- | --- | --- |
| **CAS + 版本号** | 更新已有实体（订单金额、房态、结算单） | `UPDATE ... WHERE version = ?`；0 行则分类冲突 |
| **唯一索引兜底** | 创建唯一关系（分房、幂等） | `INSERT OR IGNORE` + 冲突后查询解释原因 |
| **条件状态转移** | 状态机推进 | `UPDATE ... WHERE status = ?` |

**原则**：先靠数据库约束保证不变量，再用版本号解决并发覆盖，最后用只读查询解释失败原因。**禁止**「先查后写」这种有竞态的模式。

### 8.3 冲突分类与错误码

统一错误码（仿 `ORDER_ERRORS`，各领域各建一份）：

```ts
STAY_ERRORS = { NOT_FOUND, VERSION_CONFLICT, STATUS_CONFLICT,
                ROOM_NOT_ASSIGNABLE, IDENTITY_NOT_VERIFIED, ALREADY_IN_HOUSE }
FOLIO_ERRORS = { NOT_FOUND, VERSION_CONFLICT, BUSINESS_DAY_CLOSED, ITEM_DUPLICATE }
SETTLE_ERRORS = { NOT_FOUND, ALREADY_CONFIRMED, APPROVAL_REQUIRED, POLICY_MISSING }
PAYMENT_ERRORS = { NOT_FOUND, AMOUNT_EXCEEDED, CHANNEL_UNKNOWN, ALREADY_CAPTURED }
REFUND_ERRORS = { NOT_FOUND, EXCEEDS_REFUNDABLE, CHANNEL_UNKNOWN, SETTLEMENT_NOT_CONFIRMED }
CREDENTIAL_ERRORS = { NOT_FOUND, ALREADY_REVOKED, DEVICE_FAILED, UNKNOWN_RESULT }
```

**HTTP 映射**：`NOT_FOUND → 404`、`*_CONFLICT → 409`、`APPROVAL_REQUIRED → 403`、`CHANNEL_UNKNOWN / UNKNOWN_RESULT → 202`（已受理、结果未知）、其余 `400`。

`UNKNOWN` 返回 **202 而非 4xx/5xx**，因为操作确实已受理，只是结果未定。这避免了调用方看到 5xx 就重试，从而产生重复副作用。

---

## 9. 接口契约

### 9.1 通用约定

- 所有写接口要求 `X-Request-Id`（沿用 `lib/ops.ts` 的 `requestId` 校验：`^[a-zA-Z0-9_-]{8,80}$`）。
- 所有写接口要求幂等键，位置为请求体 `idempotency_key`。
- 所有响应携带 `hotel_id` 作用域校验结果。
- 错误响应统一为 `{ ok: false, error: <错误码>, detail?: string }`。
- 成功且结果确定：`200`；成功创建：`201`；受理但结果未知：`202`；幂等重放：`200` + `reused: true`。

### 9.2 入口 A（身份证）

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/terminal/identity/read` | POST | 上报告已读取（设备侧事件），返回解析结果 |
| `/api/terminal/identity/lookup` | POST | 按身份令牌查询有效业务记录 |
| `/api/checkin/prepare` | POST | 生成入住准备（房型、房价、适用政策快照） |
| `/api/checkin/confirm` | POST | 确认入住，成立 F5 事实 |

`/api/terminal/identity/lookup` 返回结构：

```json
{
  "ok": true,
  "options": [
    { "kind": "CHECKIN_PENDING", "reservation_no": "...", "nights": 2, "room_type": "高级大床房" },
    { "kind": "ALREADY_IN_HOUSE", "stay_id": "...", "room_number": "1208", "can_reissue_key": true },
    { "kind": "MULTIPLE_RESERVATIONS", "count": 2 },
    { "kind": "NO_RESERVATION", "walk_in_allowed": true },
    { "kind": "HISTORICAL", "last_checkout_date": "2026-08-01" }
  ]
}
```

**关键**：`options` 是**数组**。同一身份可能同时命中多种情况（已入住 + 还有未来预订），必须让上层选择，不能只返回一个。

### 9.3 入口 B（房卡）

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/terminal/credential/verify` | POST | 验证凭证，返回三种「不成功」的细分 |
| `/api/stay/services` | GET | 查询该住宿可用服务 |
| `/api/stay/checkout/quote` | POST | 生成结算单（`DRAFT`），**不退款** |
| `/api/stay/checkout/confirm` | POST | 确认退房，成立 F7，房态转 DIRTY |
| `/api/stay/settle` | POST | 执行结算与退款（`CONFIRMED → SETTLED`） |
| `/api/stay/change/prepare` | POST | 换房准备阶段 |
| `/api/stay/change/commit` | POST | 换房交接 + 完成 |
| `/api/credential/reissue` | POST | 补卡 |

`/api/terminal/credential/verify` 的三种失败必须分开：

```json
{ "ok": false, "error": "credential_invalid" }        // 卡无效 / 不存在
{ "ok": false, "error": "credential_revoked" }        // 卡已注销
{ "ok": false, "error": "stay_already_ended",         // 卡有效但住宿已结束
  "stay": { "room_number": "1208", "checked_out_at": "..." } }
```

**退房与结算必须分成两个接口**（`checkout/confirm` 与 `settle`）。这是「退房不是退款」在接口层的落地：`checkout/confirm` 成功后客人即可离店、房间即可进清洁，退款可以晚些完成甚至失败重试。

### 9.4 入口 C（前台与后台）

沿用现有 `/api/admin/tools/execute` 的契约（工具名 + 参数 + 权限校验），新增工具见 9.5。补充：

- 所有金额类操作（调整、退款、减免）必须携带 `reason`，并写入 `admin_audit_events`。
- 超阈值退款返回 `APPROVAL_REQUIRED`，生成待审批记录，由更高权限角色确认。

### 9.5 AI 工具层

**原则**：AI 的工具集 = 应用服务的子集，且每个工具都对应一个已有的应用服务方法。**禁止**为 AI 单独开一条绕过服务的路径。

**新增工具清单**（在现有 10 个基础上）：

| 工具 | 对应接口 | 风险 | 需确认 |
| --- | --- | --- | --- |
| `stay.get_current` | `/api/stay/services` | low | 否 |
| `folio.get_balance` | 账务查询 | low | 否 |
| `stay.quote_checkout` | `/api/stay/checkout/quote` | medium | 是（展示金额） |
| `stay.confirm_checkout` | `/api/stay/checkout/confirm` | high | 是 |
| `folio.settle` | `/api/stay/settle` | high | 是 |
| `invoice.issue` | 发票服务 | medium | 是 |
| `stay.extend` | 续住服务 | high | 是 |
| `stay.change_room` | 换房服务 | high | 是 |
| `housekeeping.request` | 客房服务 | low | 否 |
| `maintenance.report` | 报修服务 | low | 否 |
| `folio.add_charge` | 账务服务 | high | 是 |
| `room.get_status` | 房态查询 | low | 否 |
| `pricing.quote_upgrade` | 报价服务 | medium | 是（展示金额） |
| `order.cancel` | 取消服务 | high | 是 |

**每个工具必须同时具备**：zod schema、JSON Schema（供模型）、`writeTools` 风险登记、`ai_tool_calls` 持久化、幂等键语义。

**金额类工具的特殊约束**：`stay.quote_checkout` 与 `pricing.quote_upgrade` 必须调用 `computeSettlement` / 报价纯函数，并把 trace 一并返回。**AI 不得自行计算或口算金额**，只能转述函数结果。

### 9.6 AI 与三个入口的关系

AI **不是入口 C 的专属能力**，而是贯穿三个入口的一层：

| 入口 | AI 的角色 |
| --- | --- |
| A 身份证 | 解释可选路径、收集现场办理所需信息 |
| B 房卡 | 解释账单、确认退房意图、引导换房 |
| C 前台/后台 | 起草政策、查询、执行获授权操作 |

因此 `/api/agent/turn` 需要携带 `entry_point`（`IDENTITY` / `CREDENTIAL` / `STAFF`）与 `terminal_id`，用于限定该入口允许的工具子集。**入口 B 不得调用建单类工具，入口 A 不得调用退款类工具。**
---

## 10. 失败与未知结果

### 10.1 `UNKNOWN` 的处理机制

`UNKNOWN` 只表示「结果未定」，不是失败。处理链：

```
操作返回 UNKNOWN
      ↓
写入 UNKNOWN 事实（不推进业务状态）
      ↓
登记对账任务（带重试时间表）
      ↓
向调用方返回 202 + 明确的「处理中」文案
      ↓
对账任务查询渠道真实结果
      ↓
收敛为 SUCCESS 或 FAILED
      ↓
若收敛为 SUCCESS → 补记事实、推进状态
若收敛为 FAILED  → 允许重试，且重试使用同一幂等键
```

**禁止**：把 `UNKNOWN` 当失败直接重发；把 `UNKNOWN` 当成功推进状态。

### 10.2 对账任务

| 任务 | 频率 | 断言 |
| --- | --- | --- |
| 支付对账 | 5 分钟 | 本地 `CAPTURED` 与渠道流水一致 |
| 退款对账 | 5 分钟 | 本地 `REFUNDED` 与渠道流水一致 |
| 账务平衡 | 每小时 | `sum(folio_items) + sum(ledger_entries) = folios.balance` |
| 房态一致性 | 每小时 | 无「在住但无活跃分房」「分房但无在住」的记录 |
| 凭证一致性 | 每小时 | 无「住宿已结束但凭证仍 ACTIVE」 |
| 预授权超时 | 每日 | 超 `expires_at` 的预授权已释放 |
| 投影一致性 | 每小时 | `orders` 与 `demo_orders` 金额一致 |

### 10.3 人工接管矩阵

| 情形 | 自动动作 | 人工动作 |
| --- | --- | --- |
| 身份核验失败 | 停止办理，释放已锁资源 | 前台核验后放行或拒绝 |
| 无房可换 | 保留原房，列出可选 | 前台协调或补偿 |
| 退款超过阈值 | 生成待审批结算单 | 授权角色审批 |
| 退款渠道结果未知 | 挂对账任务，返回 202 | 确认后手工收敛 |
| 卡片无法注销 | 门锁侧挂失，告警 | 工程处理并复核 |
| 支付成功但发卡失败 | 不得显示成功，订单保持在住 | 前台补发卡 |
| 换房写卡中途失败 | 保留原房路径 | 前台协助 |
| 营业日已关闭需补录 | 拒绝写入 | 走当日调整行 |
| 停电 / 火警 | 门锁离线能力接管 | 现场处置 |

---

## 11. 关键时序

### 11.1 入住（入口 A）

```
客人放置身份证
  → 终端 POST /api/terminal/identity/read
  → 服务端生成 identity_token（不可逆），**不存证件号**
  → 终端 POST /api/terminal/identity/lookup
  → 返回 options[]（可能多项）
  → 若 CHECKIN_PENDING：
       POST /api/checkin/prepare
         · 校验预订状态、房型库存
         · 冻结适用政策快照
         · 返回房价、押金、总额
  → 客人确认
  → 支付（走 payments，幂等）
  → POST /api/checkin/confirm
         · 校验 IDENTITY_STATUS = VERIFIED
         · 建立 stay（STAY_STATUS: PENDING → IN_HOUSE）
         · 建立 room_assignments（受活跃唯一索引保护）
         · 房态 → OCCUPIED（写 room_status_logs）
         · 签发 key_credentials（ACTIVE）
         · 房费与押金生成 folio_items
  → 返回成功
```

**每一步都可中断并可恢复**：中断在支付前 → 无副作用；中断在支付后发卡前 → 订单在住、无凭证，转前台补发。

### 11.2 退房（入口 B）

```
客人插入房卡
  → POST /api/terminal/credential/verify
  → 定位 stay
  → GET /api/stay/services
  → 客人选择「退房」
  → POST /api/stay/checkout/quote
         · 调用 computeSettlement（纯函数）
         · 生成 settlements（DRAFT）+ trace
         · 返回明细
  → 客人确认
  → POST /api/stay/checkout/confirm
         · 成立 F7：stays.status → ENDED
         · room_assignments.released_at = now
         · 全部凭证 → REVOKED
         · 房态 → DIRTY（写 room_status_logs）
         · settlements → CONFIRMED
  ← 此刻客人可离店、房间可进清洁
  → POST /api/stay/settle
         · 生成 refunds（REQUESTED）
         · 或释放预授权（不生成退款行）
         · settlements → SETTLED
```

**关键**：`checkout/confirm` 与 `settle` 分离。退款失败或被审批挂起，不影响客人离店与房间清洁。

### 11.3 换房（入口 B，三阶段）

```
阶段1 准备
  POST /api/stay/change/prepare
    · 核验 PRIMARY 身份
    · 校验新房可售（五维派生）
    · 计算房价差额（computeSettlement 复用）
    · 锁定新房（临时 room_assignments，released_at 为未来）
    · 返回差额与是否需补款

阶段2 交接
  POST /api/stay/change/commit
    · 签发新房凭证并确认可用 ← 失败则中止，原房不变
    · 若需补款：走 payments
    · 更新 room_assignments（新房 assigned_at = now）
    · 保留旧房进入时间（按政策，默认 30 分钟）

阶段3 完成
    · 旧 room_assignment.released_at = now, reason = ROOM_CHANGE
    · 旧凭证 → REVOKED
    · 旧房态 → DIRTY（写 room_status_logs）
    · 记账差额到 folio_items
```

**不可逆约束**：阶段 2 失败时必须保留原房完整可用路径。**禁止**先退旧房再写新房。

### 11.4 补卡

```
插入房卡（或身份证）
  → 凭证无效 / 客人报失
  → 核验 PRIMARY 身份
  → 原凭证 → SUSPENDED 或 REVOKED（reason = LOST）
  → 签发新凭证（同一 stay、同一 room）
  → 写 key_credentials + 审计
```

**安全要求**：补卡必须核验 `PRIMARY` 身份，不能仅凭房卡本身补卡（否则捡到卡即可无限补卡）。

---

## 12. 迁移路径

### 12.1 总体策略

**渐进式，不推倒。** 沿用 `docs/single-source-of-truth.md` 已确立的做法：新表并行建立 → 双写 → 切换读取 → 停止旧写 → 清理。

### 12.2 分步迁移

| 步骤 | 动作 | 验证 |
| --- | --- | --- |
| M1 | 建立新表与索引（纯新增，不影响现有） | 迁移可重复执行，`test:orders-d1` 仍绿 |
| M2 | 启用 `stays`：把 `checkin_cases` 的入住事实回填为 `stays` 行 | 数量与状态可比对 |
| M3 | 启用 `room_assignments`：把 `reservation_rooms` + `demo_orders.room_number` 回填 | 活跃分配唯一索引不冲突 |
| M4 | 客人入住主流程改为写正式表，`demo_orders` 降级为只读投影 | 无 `demo_orders` 写入 |
| M5 | 启用 `folios` / `folio_items`，把历史金额回填为费用行 | 账务平衡断言通过 |
| M6 | 启用 `payments` / `refunds`，接管 `walk_in_payments` | 幂等与对账通过 |
| M7 | 启用 `room_status_logs` 统一入口，房态拆双维度 | 房态一致性断言通过 |
| M8 | 移除 `reservations` 的金额字段与 `demo_orders` 兼容写 | 无读取方 |

**每步都必须有独立的回滚方案**，且回滚不依赖「反向迁移」——靠的是旧路径在切换前不被删除。

### 12.3 需要下线的字段

| 字段 | 原因 | 前置条件 |
| --- | --- | --- |
| `reservations.total_amount` / `deposit_amount` | 金额权威已归 `orders` | 确认无读取方（现 `admin-service` 仍有 `LEFT JOIN` 回落） |
| `orders.paid_amount` | 应由 `payments` 汇总 | `payments` 上线并回填 |
| `demo_orders` 全部金额字段 | 降为纯投影 | M4 完成 |
| `checkin_cases.status` | 由 `stays` 取代 | M2 + M4 完成 |

### 12.4 数据校验

迁移后必须能回答：

- 每笔 `orders` 的 `collected_amount` 是否等于其 `payments` 合计？
- 每个 `stays` 是否有且仅有一条活跃 `room_assignments`？
- 每间 `rooms` 是否最多有一条活跃分配？
- 每个已结束 `stays` 的凭证是否全部非 `ACTIVE`？
- 账务平衡式是否处处成立？

---

## 13. 现有设计的调整建议

| 现有设计 | 问题 | 建议 |
| --- | --- | --- |
| `STAY_STATUS` 混入身份核验 | 证不过时住宿状态无法表达 | 拆为住宿生命周期 + 身份核验两条（4.3） |
| `ROOM_STATUS` 单值 | 无法表达「已退房未清洁」 | 拆为清洁 + 可用性两列，其余派生（4.4） |
| `rooms.status` 承载占用语义 | 占用随时间自动变化，落库必然不同步 | 占用与预订改为派生（4.4） |
| `reservation_rooms` 无时间区间 | 无法追溯历史分房与换房 | 升级为 `room_assignments`（3.3.4） |
| `orders.paid_amount` 可人工写 | 与实际收款脱节 | 改为由 `payments` 汇总 |
| `checkin_cases` 与 `workflow_runs` 双轨 | 每加一个动作要写两遍 | 收敛到 workflow 引擎（沿用 v1 白皮书的 A1 决策） |
| `lib/tools.ts` 扁平工具清单 | 未按入口限定可用子集 | 按 `entry_point` 分层（9.6） |
| 无 `business_date` 写入 | 跨日结算无法归属 | 全表补 `business_date`（7.1） |

---

## 14. 决策项的方案选型

### 14.1 `stays` 是否独立建表

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| A 独立建表 | 语义清晰，支持多次到店、多房间 | 需迁移与回填 | ✅ **推荐** |
| B 复用现有入住记录 | 无需迁移 | 「预订」与「实际住宿」继续混淆，换房/多次到店无法表达 | 仅作过渡 |

**理由**：`reservations` 表示「订了什么」，`stays` 表示「实际住了哪次」。一笔预订可能从未到店、提前结束、或分多次到店。合并会在换房与部分入住场景立刻出问题。表已存在，成本主要在回填而非建表。

### 14.2 房态五维的落地形态

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| A 拆五列 | 查询直观 | 占用/预订列会过期，必须定时同步 | ❌ |
| B 两列 + 三派生 | 无同步问题，可随时重算 | 查询需 JOIN | ✅ **推荐** |
| C 五张状态表 | 最规范 | 过度设计 | ❌ |

**理由**：清洁与维修是**人工写入的事实**，适合落库；被预订与在住是**时间的函数**，落库必错。这个分界是选型依据。

### 14.3 押金默认模式

| 模式 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- |
| 实际扣款 | 流程简单，渠道支持广 | 占用客人资金，退款耗时 | 现金、小额 |
| 预授权 | 不实际扣款，体验好 | 需渠道支持，有有效期，可能被拒 | 信用卡、大额 |

**建议**：默认**预授权**，不支持预授权的渠道回落为实际扣款。两者在 `payments` 中以 `authorized_amount` / `captured_amount` 区分，报表口径分开。

### 14.4 结算审批阈值

**建议**：默认 `100000`（¥1000）。理由：低于此金额的争议多为计算口径问题（可由 trace 解释），高于此金额的需人工复核以防内部风险。阈值为政策项，可按酒店配置。

### 14.5 夜审时点

**建议**：默认 `06:00` 当地时间，按酒店配置。**理由**：凌晨到店的客人通常仍属于前一个营业日，`06:00` 是行业常见分界，且早于大多数退房。

### 14.6 同行人授权模型

| 方案 | 说明 | 建议 |
| --- | --- | --- |
| 仅 PRIMARY 有全部权限 | 简单，安全 | ✅ 本期采用 |
| PRIMARY 可逐项授权 | 灵活 | 下期 |
| 所有住客平权 | 实现最简 | ❌ 无法保护支付信息 |

**本期规则**：仅 `stay_guests.role = PRIMARY` 可查看支付信息、申请退款、补卡、授权他人。同行人只能查询自己的房间号与开门。退房时注销**全部**凭证（含同行人）。

---

## 15. 分期实施

| 阶段 | 内容 | 交付 |
| --- | --- | --- |
| P1 数据可信（本次方案落地） | M1–M4：新表、`stays` 启用、`room_assignments` 启用、入住主流程切换 | 「无 `demo_orders` 写入」通过；分房唯一索引生效 |
| P2 业务可信 | M5–M7 + 退房/换房/结算服务 + `computeSettlement` | C3/C4/C6/C14/C15 用例通过 |
| P3 规则可信 | 政策中心最小版（版本不可变 + 快照 + 按版本结算） | 政策变更不影响历史订单 |
| P4 设备可信 | 入口 A/B 真机接入、凭证服务、终端注册 | 每次设备操作可关联业务请求 |
| P5 运营可信 | 对账任务、告警、人工接管、PMS 接入 | 运营人员能发现、解释、恢复、处理客诉 |

**P2 与 P3 的顺序修正**：政策中心的最小版本必须**提前到 P2**，否则 P2 的结算会写死规则、P3 全部重写。AI 起草、模拟、影响面分析留在 P3。

---

## 16. 开放问题

1. 多币种是否需要支持？若需要，结算函数的币种处理需重新设计。
2. 一间房是否可能同时属于两笔住宿（如钟点房与过夜房重叠）？影响活跃分配唯一索引。
3. 团体预订（一个订单多间房多人）的 PRIMARY 如何定义？是每人一个 PRIMARY 还是一个团体一个？
4. 押金是否可能与房费合并为一次扣款？若合并，结算时的拆分规则需定义。
5. 发票是否需对接税务系统？影响 `folio_items` 的税额字段设计。
6. 历史演示数据是否需要迁移到新模型，还是允许 `demo_orders` 继续作为只读兼容层保留？

---

## 17. 结论

本方案的核心是把「一条状态」拆成「多条事实 + 派生状态」：订单、住宿、支付、凭证、房态各自拥有权威来源，彼此通过明确的事实关联，而不是共享一个可变的 `status` 字段。

三个最主要的技术判断：

1. **`stays` 必须独立**，否则换房与多次到店无法表达。
2. **房态的清洁/维修落库、占用/预订派生**，否则必然出现同步错误。
3. **结算必须是纯函数并带 trace**，否则金额无法解释，AI 也无法安全接入资金环节。

建议执行顺序：**先评审第 13 章（现有设计调整）与第 14 章（选型决策），确认后再按第 15 章分期落地。** 第 1、2 章的基线盘点可作为改造范围的核对清单。
