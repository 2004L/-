# 第二阶段：酒店核心数据与可恢复工作流

## 目标

将演示环境从“订单推算房态”升级为正式酒店领域模型。所有订单、房间、入住、账务和 AI 工作流都按 `tenant_id + hotel_id` 隔离；金额使用分，状态变更使用整数状态机和版本号。

## 数据边界

- `rooms` 是房态唯一来源，`room_status_logs` 保存每一次变更。
- `reservations` 保存订单主表，`reservation_rooms` 保存一单多房关系。
- `stays` 表示实际入住，`folios`、`ledger_entries` 表示可对账账务。
- `workflow_runs` / `workflow_steps` 保存可暂停、恢复、重试的业务流程。
- `demo_orders` 只作为旧演示用例的兼容投影，不能作为生产写入目标。

旧数据迁移由 `0009_legacy_core_backfill.sql` 完成；运行中的兼容环境由
`lib/legacy-core-sync.ts` 幂等补齐，避免老演示会话在迁移窗口内丢失房态。

## 状态和安全规则

- 房态：空闲干净、空闲待清洁、已锁房、已入住、维修中、停用。
- 订单：待确认、已确认、已入住、已退房、已取消、未入住。
- 所有写操作必须带酒店作用域、幂等键和版本条件。
- 金额修改先生成待确认动作，确认后才进入账务流水；禁止浮点金额。
- AI 只负责意图、计划和表达；数据库写入只能由受权限控制的服务和工具完成。
- 管理员查房和换房优先读取、更新 `rooms`；换房必须携带房态版本号，成功后写入两条 `room_status_logs`，并同步更新旧演示投影。

## PMS 适配器

`lib/hotel-core.ts` 定义 `PmsAdapter` 契约，当前由 `SimulatorPmsAdapter` 实现。订单查询、房态查询、锁房、入住确认、退房均经过同一契约，未来接 QloApps 只替换适配器，不修改状态机和 AI 安全层。

## 工作流投影

管理员页面应读取 `/api/admin/workflows/:workflowId` 的投影，展示当前步骤、待确认动作、失败原因和重试状态。页面刷新或网络中断后，服务端仍以 `workflow_runs` 为准恢复流程。

## 验收命令

```bash
pnpm test:core-domain
pnpm test:foundation
pnpm test:contracts
pnpm test:concurrency
pnpm test:room-change-http # 设置真实环境变量后执行；未设置时安全跳过
pnpm test:invariants
pnpm security:check
```

下一阶段再接真实 PMS 和硬件；本阶段不允许绕过模拟器直接触碰生产设备。
