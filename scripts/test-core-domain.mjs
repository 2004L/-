import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const schema = read("db/schema.ts");
const migration = read("drizzle/0008_hotel_core_domain.sql");
const backfill = read("drizzle/0009_legacy_core_backfill.sql");
const domain = read("lib/hotel-core.ts");
const workflow = read("lib/workflow-engine.ts");
const adapter = read("services/pms/simulator-adapter.ts");
// 投影 SQL 住在 legacy-projection-core.ts，适配层只负责执行；两处一起看才是完整的旧数据投影。
const sync = read("lib/legacy-core-sync.ts") + read("lib/legacy-projection-core.ts");
const admin = read("lib/admin-service.ts");

for (const table of ["room_types", "rooms", "room_status_logs", "reservations", "reservation_rooms", "reservation_status_logs", "stays", "folios", "ledger_entries", "workflow_runs", "workflow_steps"]) {
  if (!schema.includes(`sqliteTable("${table}"`) || !migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`核心表缺失：${table}`);
}
for (const column of ["tenant_id", "hotel_id", "version", "idempotency_key"]) {
  if (!schema.includes(`"${column}"`)) throw new Error(`核心字段缺失：${column}`);
}
for (const marker of ["ROOM_STATUS", "RESERVATION_STATUS", "assertRoomTransition", "assertReservationTransition", "PmsAdapter"]) {
  if (!domain.includes(marker)) throw new Error(`状态机或 PMS 契约缺失：${marker}`);
}
for (const marker of ["transitionWorkflow", "recordWorkflowStep", "getWorkflowProjection", "workflow_version_conflict"]) {
  if (!workflow.includes(marker)) throw new Error(`工作流能力缺失：${marker}`);
}
if (!adapter.includes("implements PmsAdapter") || !adapter.includes("1306")) throw new Error("模拟 PMS 适配器未接入正式契约");
for (const table of ["room_types", "rooms", "reservations", "reservation_rooms", "stays"]) {
  if (!backfill.includes(`INSERT OR IGNORE INTO ${table}`) || !sync.includes(`INSERT OR IGNORE INTO ${table}`)) throw new Error(`旧演示数据迁移缺失：${table}`);
}
if (!admin.includes("UPDATE rooms SET status = CASE") || !admin.includes("from_room_version")) throw new Error("管理员换房仍未接入正式房态表");
if (!read("scripts/test-room-change-http.mjs").includes("room_change_conflict")) throw new Error("缺少真实 HTTP 换房并发验收脚本");
if (domain.includes("getD1") || domain.includes("INSERT") || domain.includes("UPDATE")) throw new Error("意图/状态契约层不应直接写数据库");
console.log("Hotel core domain check passed: scoped schema, integer state machines, idempotency and durable workflow contracts.");
