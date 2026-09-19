# AI Native 第一阶段：数据与控制底座

本阶段把 Hotel Agent OS 从“会返回工具调用的聊天界面”推进到“可持久化、可审计、可按酒店隔离的 AI 控制面”。本阶段不接真实 PMS，不接真实读卡器、发卡机或公安接口。

## 已完成

- 增加集团、品牌、酒店、终端和管理员酒店范围模型。
- 现有订单、入住、设备、仿真、人工任务、管理员动作和 AI 指标表增加 `tenant_id`、`hotel_id` 作用域字段。
- 为广州演示店回填 `tenant-demo / hotel-gz-demo`，旧数据按 `demo_sessions.hotel_code` 归属。
- 管理员订单、房态、待确认动作和审计查询按当前登录管理员的酒店范围过滤。
- 移除管理员工具对固定 `admin-session` 的依赖，外部命令使用真实管理员会话和酒店作用域。
- 增加 `ai_workflows`、`ai_intents`、`ai_plans`、`ai_tool_calls`、`policy_decisions`，持久化 AI 的理解、计划、策略判断和工具调用。
- 增加 `pnpm test:foundation`，检查迁移、租户隔离和 AI 控制表是否完整。

## 迁移

正式迁移文件是 `drizzle/0007_ai_native_foundation.sql`。部署前执行迁移，不依赖请求到达时临时建表。`lib/tenant.ts` 只保留兼容演示环境的幂等补齐逻辑，生产部署应把 migration 纳入发布流水线。

## 当前边界

- 当前业务仍使用 D1/SQLite 和演示订单模型，尚未建立正式 `rooms`、`reservations`、`stays`、`payments`、`ledger_entries` 等生产表。
- AI 工作流已记录“理解和计划”，但多步骤 Agent 编排、后台任务队列和外部命令回执仍在下一阶段。
- 现有并发脚本仍是模型级验收，下一阶段必须增加真实 D1/API 端到端并发测试。

## 下一阶段

1. 建立正式房间、房态流水、订单、入住和账务模型。
2. 将策略判断从静态角色映射升级为可配置的酒店级策略。
3. 让工作流在服务端持久化，支持刷新、断网、重试和人工接管。
4. 让读卡器、发卡机、公安和 PMS 共用同一外部命令状态机。
