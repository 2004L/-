# 数据缺陷清单（含复现步骤与修复建议）

编制日期：2026-09-19　数据来源：本地 D1 实例（`.wrangler/state/v3/d1/`）
基线：36 张表 / 171 行 / 20 张表为空

## 复现环境准备

所有复现步骤基于本地 D1 的只读快照。先把库路径存进变量：

```powershell
$DB = Get-ChildItem -Recurse -Filter *.sqlite .wrangler\state\v3\d1 | Select-Object -First 1 -ExpandProperty FullName
```

查询统一用 Node 内置 sqlite（Node 22+ 自带，无需安装）：

```powershell
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DB,{readOnly:true});console.table(db.prepare(process.argv[1]).all())" "SELECT 1"
```

下文用 `q "<SQL>"` 代指上述查询。

---

## 缺陷 1：客人流程与设备/人工派单机制完全不相通，且存在孤儿状态

**严重级别：高（架构级）**

### 现象

1. `checkin_cases` 中有 2 条记录状态为 `READY_FOR_ONSITE_HANDOFF`，`hardware_status = onsite_team_required`，字面含义是「需要现场人员接手」。
2. 但 `manual_tasks` 表 **0 行**——没有任何人被派单。
3. `external_commands` 表 **0 行**——幂等命令层从未被写入。
4. 更关键：`READY_FOR_ONSITE_HANDOFF` 与 `onsite_team_required` 这两个字符串**在当前全部代码中不存在**。

### 复现步骤

```powershell
# 1. 看到「需要现场人工」的记录
q "SELECT id, session_id, status, hardware_status FROM checkin_cases WHERE status='READY_FOR_ONSITE_HANDOFF'"
# 预期：2 行，status=READY_FOR_ONSITE_HANDOFF，hardware_status=onsite_team_required

# 2. 但没有任何人工任务
q "SELECT COUNT(*) AS manual_tasks FROM manual_tasks"
# 预期：0

# 3. 也没有任何外部命令记录
q "SELECT COUNT(*) AS external_commands FROM external_commands"
# 预期：0

# 4. 当前代码里根本不存在这两个状态值（预期无输出）
rg -n "READY_FOR_ONSITE_HANDOFF|onsite_team_required" --glob "!node_modules" .
# 预期：无匹配

# 5. 当前代码能产生的状态词表里没有「人工接管」这一态
rg -o 'next: "[A-Z_]+"' "app/api/demo/[action]/route.ts" | Sort-Object -Unique
# 预期：ORDER_MATCHED/IDENTITY_READING/IDENTITY_VERIFIED/ROOM_HELD/POLICE_RUNNING/
#       POLICE_COMPLETED/PMS_CHECKIN_CONFIRMED/KEYCARD_WRITING/KEYCARD_DISPENSED/CHECKIN_COMPLETE
```

### 根因

三层，逐层递进：

1. **孤儿数据**：`READY_FOR_ONSITE_HANDOFF` / `onsite_team_required` 是旧版本代码产生的终态，当前状态机已无此分支。数据没有随代码迁移，形成漂移。
2. **派单机制长在没被走的路上**：`createManualTask`（`lib/simulator.ts:53`）只被以下三处调用——
   - `app/api/device/reader/route.ts:26`
   - `app/api/device/encoder/route.ts:28`
   - `app/api/police/submit/route.ts:28`

   而客人真正走的 `app/api/demo/[action]/route.ts` **从不调用它**。幂等命令层 `createCommand` 同理。
3. **对账读的是空表**：`app/api/demo/[action]/route.ts:444` 的 `reconcile` 会查询 `external_commands`，但这条流程从不写入该表，所以对账永远返回「无外部命令」。

结论：**设备处理有两套互不相通的实现**。幂等、故障注入、人工派单这一整套机制，全部建在客人实际不走的那条路径上。

### 影响

- 真实场景下设备失败将**无人接手**：系统不会生成工单，值班人员无从感知。
- 当前状态机里**没有「转人工」这个终态**，意味着任何异常只能停在中间态，无法显式升级。
- 对账能力形同虚设。
- 这条缺陷直接阻断「业务闭环」——闭环要求异常可暂停、可升级、可恢复。

### 修复建议

**立即（本周）**
1. 清理孤儿数据：把 `checkin_cases` 中 `READY_FOR_ONSITE_HANDOFF` 的记录显式标注为历史遗留（加 `legacy_status` 字段或迁移为当前词表中最接近的状态），避免后续统计误读。
2. 在 `checkin_cases` 状态词表中**显式增加 `HANDOFF_REQUIRED` 终态**，并纳入状态机。

**短期（P2 阶段）**
3. 把设备处理收敛为**唯一一条路径**：客人流程与 `/api/device/*` 共用同一套 `createCommand` / `consumeFault` / `createManualTask`，即缺陷 1 的根因 2。
4. `reconcile` 改为读取真实写入的命令表，或在其为空时返回明确的「无命令记录」而非静默通过。

**长期**
5. 按方案稿 4.9 与 10.1 的约定，把「人工接管」做成所有状态的统一逃生出口，并纳入第 10.3 章的人工接管矩阵。

### 验证方式

修复后应满足：注入一次读卡器故障 → 客人流程返回明确的转人工状态 → `manual_tasks` 新增 1 行且带正确 `department` → 对账接口能查到该命令。

---

## 缺陷 2：四个管理员账号共用同一个口令与同一个盐

**严重级别：高（安全）**

### 现象

`admin_users` 4 个账号的 `password_salt` **完全相同**：`571cd1ef29384c9b971783b19cb4b65f`。

### 复现步骤

```powershell
q "SELECT username, password_salt FROM admin_users"
# 预期：4 行，salt 全部相同

q "SELECT COUNT(DISTINCT password_salt) AS distinct_salt FROM admin_users"
# 预期：1
```

### 根因

`lib/admin-auth.ts`：

- 第 10 行：`const DEMO_SEED = "hotel-demo-2026";` —— 硬编码默认口令
- 第 72 行：`const password = process.env?.ADMIN_DEMO_PASSWORD?.trim() || DEMO_SEED;`
- 第 73 行：`const passwordData = await hashPassword(password);` —— **在循环外只算一次**
- 第 80 行：`users.map(...)` 把**同一个** `passwordData.hash` 与 `passwordData.salt` 写入全部 4 个账号

`salt` 参数默认值是 `crypto.randomUUID()`，但只在 `hashPassword` 被调用时生成一次，因此 4 个账号共享同一份口令哈希与盐。

### 影响

- 老板 / 店长 / 前台 / 客房四个角色**共用同一个口令**。任一人知道口令即等同拥有全部角色权限。
- 默认口令是代码里的固定字符串 `hotel-demo-2026`，只要 `ADMIN_DEMO_ENABLED` 未被显式设为 `false` 就生效。
- 共享盐还会削弱 PBKDF2 的抗彩虹表能力（同一口令的哈希可跨账号比对）。

### 修复建议

**立即**
1. 每个账号独立生成盐与哈希：把 `hashPassword` 移入 `users.map()` 内部逐账号调用。
2. 生产环境强制 `ADMIN_DEMO_ENABLED=false`，并在启动时断言「若为 true 且检测到生产域名则拒绝启动」。
3. 移除 `DEMO_SEED` 回退：`ADMIN_DEMO_PASSWORD` 缺失时应跳过种子创建并打印显式警告，而不是回退到硬编码口令。
4. 已部署环境**轮换全部管理员口令**。

**短期**
5. 增加口令强度校验与强制首次登录改密。
6. 管理员口令变更走独立的审计事件。

### 验证方式

```powershell
q "SELECT COUNT(DISTINCT password_salt) AS distinct_salt FROM admin_users"
# 修复后预期：4（等于账号数）
```

并确认：不设置 `ADMIN_DEMO_PASSWORD` 时，`admin_users` 不会被写入任何账号。

---

## 缺陷 3：同一房型存在两套重复记录（legacy 与 PMS 各一套）

**严重级别：中（数据质量，会污染房型统计与库存）**

### 现象

`room_types` 共 5 行，但逻辑上只有 3 种房型：

| id | code | name |
| --- | --- | --- |
| `rt-hotel-gz-demo-E6A087E58786E5A4…` | `LEGACY-E6A087E58786E5A4…` | 标准大床房 |
| `rt-hotel-gz-demo-E8B1AAE58D8EE58F…` | `LEGACY-E8B1AAE58D8EE58F…` | 豪华双床房 |
| `rt-hotel-gz-demo-E9AB98E7BAA7E5A4…` | `LEGACY-E9AB98E7BAA7E5A4…` | 高级大床房 |
| `pms-rt-hotel-gz-demo-DLX-KING` | `DLX-KING` | DLX-KING |
| `pms-rt-hotel-gz-demo-DLX-TWIN` | `DLX-TWIN` | DLX-TWIN |

其中「高级大床房」与「DLX-KING」、「豪华双床房」与「DLX-TWIN」是同一房型的两套身份。

### 复现步骤

```powershell
q "SELECT id, code, name FROM room_types ORDER BY id"
# 预期：5 行，含 3 个 LEGACY-* 与 2 个 pms-rt-*

# 房间引用的房型不一致
q "SELECT room_number, room_type_id FROM rooms ORDER BY room_number"
# 预期：1206 → legacy 类型；1306 → pms 类型；同一酒店内两套命名并存

# 同房型的单价也出现分叉
q "SELECT room_type_id, nightly_rate, COUNT(*) FROM reservation_rooms GROUP BY room_type_id, nightly_rate"
```

### 根因

两条独立写入路径都向 `room_types` 做 `INSERT OR IGNORE`，但使用不同的主键与编码方案：

1. **legacy 路径**（客人与旧数据）
   - `lib/legacy-core-sync.ts:30`：`'rt-' || hotel_id || '-' || substr(hex(room_type), 1, 16)`
   - `lib/checkin-core.ts:38-44`：`rt-${hotelId}-${utf8Hex(name).slice(0,16)}`，code 为 `LEGACY-${...}`
2. **PMS 路径**
   - `lib/pms-core-sync.ts:25`：`pms-rt-${hotelId}-${roomTypeCode}`，code 直接用 PMS 编码

两套 id 永不相同，因此 `INSERT OR IGNORE` 不会去重，同一房型被写入两次。

**附带风险**：`utf8Hex(name).slice(0, 16)` 把 UTF-8 十六进制**截断到 16 个字符（8 字节）**。不同房型名若前 8 字节相同即产生 id 碰撞。当前 3 个名字未碰撞，但这是隐患。

### 影响

- 房型统计、库存计算、报价取价都会出现重复项或取错记录。
- 结算按房型取价时可能拿到另一套记录的价格。
- 未来接入真实 PMS 后，两套映射的合并成本会更高。

### 修复建议

**立即**
1. 建立**房型主数据映射表**，为每个逻辑房型指定唯一权威 id 与外部编码：
   - 结构建议：`room_type_map(logical_id, hotel_id, legacy_code, pms_code, name, is_authoritative)`
   - 迁移时把 5 行归并为 3 行。

**短期**
2. `room_types` 增加唯一约束 `UNIQUE(hotel_id, name)` 或统一以 PMS 编码为准，禁止双写。
3. `legacyRoomTypeId` 的截断改为**完整哈希**（如 `sha256(name)` 前 16 字节）或改用显式映射，消除碰撞风险。
4. 数据迁移脚本需同步修正 `rooms.room_type_id` 与 `reservation_rooms.room_type_id` 的引用。

**长期**
5. 按方案稿 3.4 权威归属矩阵，明确「房型目录的权威来源」为 PMS 或本地主数据二选一，另一侧只做只读投影。

### 验证方式

```powershell
q "SELECT COUNT(*) AS types FROM room_types"
# 修复后预期：3（广州示范店逻辑房型数）

q "SELECT COUNT(*) AS orphan FROM rooms WHERE room_type_id NOT IN (SELECT id FROM room_types)"
# 预期：0
```

---

## 缺陷 4：房间主键两套命名并存，且已污染关联表

**严重级别：中（数据一致性，阻碍后续分房与房态改造）**

### 现象

`rooms` 4 行的主键分属两套命名：

| room_number | id |
| --- | --- |
| 1206 | `room-hotel-gz-demo-1206` |
| 1208 | `room-hotel-gz-demo-1208` |
| 1306 | `pms-room-hotel-gz-demo-1306` |
| 1210 | `pms-room-hotel-gz-demo-1210` |

`docs/single-source-of-truth.md` 声称「`rooms` id 统一为 `room-<hotel>-<room_number>`」，但实际未完成。

### 复现步骤

```powershell
q "SELECT room_number, id FROM rooms ORDER BY room_number"
# 预期：1206/1208 用 room-*，1306/1210 用 pms-room-*

# 旧 id 已传播到关联表
q "SELECT room_id, COUNT(*) FROM reservation_rooms WHERE room_id IS NOT NULL GROUP BY room_id"
q "SELECT room_id, COUNT(*) FROM room_status_logs GROUP BY room_id"
# 预期：两张表都出现 pms-room-hotel-gz-demo-1306 等旧 id
```

### 根因

代码**已经**统一（`lib/hotel-core.ts:102` 的 `formalRoomId()` 返回 `room-${hotelId}-${roomNumber}`，`lib/pms-core-sync.ts` 也调用它），但：

- 现存数据由**旧版本代码**写入（当时用 `pms-room-` 前缀）。
- `lib/pms-core-sync.ts` 的 upsert 使用 `ON CONFLICT(hotel_id, room_number) DO UPDATE`——冲突目标是**房间号**而非主键，因此重复同步只会更新其余字段，**永远不会修正 id**。

所以这是**代码已改、数据未迁移**的典型遗留，不是代码缺陷。

### 影响

- 任何按 `formalRoomId()` 推导主键的新代码（如 `lib/checkin-core.ts:72` 的 `holdFormalRoom`）都会**算出与库中不同的 id**，导致 `INSERT OR IGNORE` 静默新增一行重复房间，而不是更新原有行。
- 房态变更与分房若按不同 id 操作，会出现「同一间房两条记录、房态互相打架」。
- 这正是方案稿 3.3.4 中 `room_assignments` 活跃唯一索引要防的问题的前置障碍。

### 修复建议

**立即**
1. 写一次性数据迁移：把 `pms-room-<hotel>-<room>` 形式的 id 归一为 `room-<hotel>-<room>`，并**同步更新所有引用它的外键列**：
   - `reservation_rooms.room_id`
   - `room_status_logs.room_id`
   - 以及后续新增的 `room_assignments.room_id`、`key_credentials.room_id`
2. 迁移必须在事务内完成，并在迁移后校验引用完整性。

**短期**
3. 为 `rooms.id` 增加校验约束或触发器，拒绝不符合 `room-<hotel_id>-<room_number>` 规则的写入。
4. 在 `pms-core-sync.ts` 的 upsert 中增加显式 id 一致性检查：若现有行 id 与 `formalRoomId()` 不一致则告警。

**长期**
5. 落地方案稿 3.3.4 的部分唯一索引 `UNIQUE(hotel_id, room_id) WHERE released_at IS NULL`，从数据库层防止同房重复占用。

### 验证方式

```powershell
q "SELECT COUNT(*) AS bad FROM rooms WHERE id <> 'room-' || hotel_id || '-' || room_number"
# 修复后预期：0

q "SELECT COUNT(*) AS orphan FROM reservation_rooms WHERE room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM rooms)"
# 预期：0

q "SELECT COUNT(*) AS orphan FROM room_status_logs WHERE room_id NOT IN (SELECT id FROM rooms)"
# 预期：0
```

---

## 附：两个数据可信度问题（不单列为缺陷，但需登记）

### 附 1：`reservations` 金额与晚数、房型无关

8 条预订的 `total_amount` 全部为 `680`、`deposit_amount` 全部为 `300`，与 `nights`（1 晚或 2 晚）和房型均无关。`reservation_rooms.nightly_rate` 同为「高级大床房」却出现 `380` 与 `190` 两个值。

**复现**

```powershell
q "SELECT reservation_no, nights, total_amount, deposit_amount FROM reservations ORDER BY reservation_no"
q "SELECT room_type_id, nightly_rate FROM reservation_rooms ORDER BY room_type_id"
```

**结论**：这批金额是投影生成的占位数字，**不能作为报价、结算或对账的依据**。修复方向见方案稿 3.3.1 `order_items`（价格明细按营业日逐晚记录）。

### 附 2：营业日停滞

`hotels.business_date = 2026-09-17`，而当前日期为 2026-09-19，且**没有任何机制推进该字段**。

**复现**

```powershell
q "SELECT code, business_date FROM hotels"
q "SELECT COUNT(*) AS business_day_rows FROM hotel_business_days"
# 预期：business_date 落后于今天；hotel_business_days 表尚不存在
```

**结论**：印证方案稿第 7 章「营业日不能依赖服务器日期」的必要性。在引入 `hotel_business_days` 与夜审之前，所有跨日结算都缺乏归属依据。

---

## 优先级建议

| 顺序 | 缺陷 | 理由 |
| --- | --- | --- |
| 1 | 缺陷 2（口令共享） | 改动量最小、安全影响最大，且已部署环境存在真实风险 |
| 2 | 缺陷 4（房间 id） | 纯数据迁移，不改架构；不修则后续分房与房态改造必然踩坑 |
| 3 | 缺陷 3（房型重复） | 影响报价与结算取价，需在结算函数落地前完成 |
| 4 | 缺陷 1（流程断层） | 架构级，工作量最大；但它是「业务闭环」的前置条件，需在 P2 一并解决 |
| 附 | 附 1、附 2 | 随 P2 的价格明细与营业日改造一并处理 |

**注意**：缺陷 2、3、4 都是**小而确定**的修复，建议合并为一次「数据治理」提交，先于任何新功能开发完成。缺陷 1 需要设计调整，应在 P2 阶段与设备处理收敛一起做。

---

## 实施状态（2026-09-19）

| 缺陷 | 状态 | 交付物 |
| --- | --- | --- |
| 缺陷 2（口令与盐） | 已修复 | `lib/admin-credentials.ts`（每账号独立盐、逐角色口令、无硬编码默认值、生产默认关闭）；`lib/admin-auth.ts` 逐账号哈希 + 历史共享盐自动轮换；`scripts/test-admin-credentials.mjs` |
| 缺陷 4（房间 id） | 已修复 | `drizzle/0014_data_governance.sql`（先重指引用再改主键）；`lib/pms-core-sync.ts` 增加非规范 id 告警；`scripts/test-data-governance-d1.mjs` |
| 缺陷 3（房型重复） | 已修复 | `lib/hotel-core.ts` 房型目录（`ROOM_TYPE_CATALOG` / `canonicalRoomType` / `formalRoomTypeId`）成为唯一权威；`lib/legacy-core-sync.ts`、`lib/checkin-core.ts`、`lib/pms-core-sync.ts` 统一走目录；0014 完成 5→3 归并并修正引用 |
| 缺陷 1（流程断层） | 待办（P2） | 需与设备处理收敛一起做；本阶段未改代码 |
| 附 1（reservations 金额占位） | 待办（P2） | 随价格明细/结算一并处理 |
| 附 2（营业日停滞） | 待办（P2） | 随 `hotel_business_days` 与夜审一并处理 |

### 缺陷 2 的关键行为变化

- 代码中移除硬编码默认口令；未配置 `ADMIN_DEMO_PASSWORD`（或逐角色变量）时**不再创建**演示账号，只打印告警。
- 生产环境（`NODE_ENV`/`ENVIRONMENT=production`）下 `ADMIN_DEMO_ENABLED` 默认为 `false`。
- 每个账号独立盐与哈希；检测到历史「共用同一盐」时，若配置了口令来源则自动轮换并告警。
- 本地开发环境仍需登录时，请在 `.env.local` 显式设置 `ADMIN_DEMO_PASSWORD`（该文件不入库）。

### 缺陷 4 / 3 的验证结果（真实 D1）

本地库应用 0014 后：

```text
room_types = 3         （原 5）
rooms 非规范 id = 0     （原 2）
rooms/admin 引用悬空 = 0
reservation_rooms 悬空 = 0
room_status_logs 悬空 = 0
重复执行结果一致
```

命令：`pnpm test:data-governance-d1`（真实 D1 绑定，含「构造缺陷现场 → 迁移 → 校验 → 再执行一次」）。

### 待办的具体动作（缺陷 1）

1. 在 `checkin_cases` 状态词表中显式增加 `HANDOFF_REQUIRED` 终态，并让客人流程在设备/对账失败时可进入该状态。
2. 把 `createCommand` / `consumeFault` / `createManualTask` 从 `/api/device/*`、`/api/police/*` 下沉为共用服务，客人流程与设备接口共用同一条路径。
3. `reconcile` 在 `external_commands` 为空时返回明确的「无命令记录」，不再静默通过。
4. 清理 `checkin_cases` 中的 `READY_FOR_ONSITE_HANDOFF` 孤儿记录（标注为历史遗留或迁移到新终态）。
