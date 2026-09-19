import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const migration = read("drizzle/0007_ai_native_foundation.sql");
const schema = read("db/schema.ts");
const service = read("lib/admin-service.ts");
const auth = read("lib/admin-auth.ts");
const control = read("lib/ai-control.ts");

for (const table of ["tenants", "brands", "hotels", "hotel_terminals", "user_hotel_scopes", "ai_workflows", "ai_intents", "ai_plans", "ai_tool_calls", "policy_decisions"]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`) || !schema.includes(`sqliteTable("${table}"`)) throw new Error(`基础表缺失：${table}`);
}
for (const column of ["tenant_id", "hotel_id"]) {
  if (!migration.includes(`ALTER TABLE demo_orders ADD COLUMN ${column}`) || !migration.includes(`ALTER TABLE admin_actions ADD COLUMN ${column}`)) throw new Error(`作用域字段缺失：${column}`);
}
if (service.includes("'admin-session'") || service.includes("GZ-HAOS-001")) throw new Error("管理员工具仍使用固定会话或酒店");
for (const query of ["hotel_id = ?", "WHERE hotel_id = ?"]) if (!service.includes(query)) throw new Error(`管理员服务缺少酒店隔离条件：${query}`);
if (!auth.includes("ensureTenantFoundation") || !auth.includes("user_hotel_scopes")) throw new Error("管理员认证未绑定酒店作用域");
for (const table of ["ai_workflows", "ai_intents", "ai_plans", "ai_tool_calls", "policy_decisions"]) if (!control.includes(table)) throw new Error(`AI控制面未持久化：${table}`);
console.log("AI Native foundation check passed: tenant scope, migration, admin isolation and durable AI control tables.");
