import { readFileSync } from "node:fs";

const files = ["lib/contracts.ts", "lib/tools.ts", "lib/admin-tools.ts", "lib/admin-auth.ts", "app/api/agent/turn/route.ts", "app/api/device/reader/route.ts", "app/api/device/encoder/route.ts", "app/api/police/submit/route.ts", "app/api/health/route.ts", "app/api/admin/metrics/route.ts"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("idempotency") && file.includes("route.ts") && !file.includes("app/api/agent/turn") && !file.includes("app/api/health") && !file.includes("app/api/admin/metrics")) throw new Error(`${file} 未声明幂等键`);
}
const tools = readFileSync("lib/tools.ts", "utf8");
for (const name of ["pms.search_order", "hotel.policy_answer", "hotel.knowledge_search", "device.reader.read_identity", "device.encoder.issue_keycard", "police.submit_registration"]) {
  if (!tools.includes(name)) throw new Error(`缺少工具契约：${name}`);
}
const adminTools = readFileSync("lib/admin-tools.ts", "utf8");
for (const name of ["admin.search_guest", "admin.get_room_status", "admin.mark_room_clean", "admin.prepare_purge_closed_loops", "admin.get_database_schema", "admin.get_table_rows", "admin.list_in_house_guests", "admin.set_room_service_need", "admin.reconcile_demo_orders", "admin.prepare_room_change", "admin.prepare_amount_adjustment", "admin.prepare_keycard_issue", "admin.prepare_police_submission", "admin.confirm_pending_action", "admin.confirm_room_change", "admin.cancel_pending_action", "admin.cancel_room_change", "admin.get_audit_records"]) {
  if (!adminTools.includes(name)) throw new Error(`缺少管理员工具契约：${name}`);
}
const auth = readFileSync("lib/admin-auth.ts", "utf8");
for (const guard of ["admin_users", "admin_sessions", "admin_audit_events", "HttpOnly", "admin_permission_denied", "password_salt", "pbkdf2", "PBKDF2_ITERATIONS", "100000", "SESSION_IDLE_MINUTES", "adminLoginThrottled"]) {
  if (!auth.includes(guard)) throw new Error(`缺少管理员安全边界：${guard}`);
}
if (!readFileSync("app/api/admin/auth/login/route.ts", "utf8").includes("Retry-After")) throw new Error("管理员登录限流未声明 Retry-After");
const ops = readFileSync("lib/ops.ts", "utf8");
for (const guard of ["ai_request_metrics", "requestId", "keyConfigured"]) if (!ops.includes(guard)) throw new Error(`缺少生产可观测能力：${guard}`);
for (const route of ["app/api/admin/auth/login/route.ts", "app/api/admin/auth/me/route.ts", "app/api/admin/auth/logout/route.ts"]) {
  if (!readFileSync(route, "utf8").includes("ensureAdminSchema")) throw new Error(`管理员认证接口未初始化数据库：${route}`);
}
const adminService = readFileSync("lib/admin-service.ts", "utf8");
for (const guard of ["AWAITING_CONFIRMATION", "room_change_conflict", "amount_adjustment_conflict", "ADMIN_AMOUNT_ADJUSTMENT_EXECUTED", "ADMIN_KEYCARD_ISSUE_EXECUTED", "ADMIN_POLICE_SUBMISSION_EXECUTED", "idempotent", "ADMIN_ROOM_CHANGE_EXECUTED", "NOT EXISTS"]) {
  if (!adminService.includes(guard)) throw new Error(`管理员换房安全门禁缺失：${guard}`);
}
for (const route of ["app/api/admin/agent/turn/route.ts", "app/api/admin/tools/execute/route.ts"]) {
  if (!readFileSync(route, "utf8").includes("admin_auth_required")) throw new Error(`管理员工具接口未校验会话：${route}`);
}
const demo = readFileSync("app/api/demo/[action]/route.ts", "utf8");
for (const action of ["walk-in-draft", "walk-in-quote", "walk-in-payment", "walk-in-payment-complete"]) {
  if (!demo.includes(`action === "${action}"`)) throw new Error(`缺少现场办理阶段接口：${action}`);
}
for (const guard of ["payment_requires_quote", "PAYMENT_CONFIRMED", "WALK_IN_ORDER_CREATED", "draft.status !== \"AWAITING_PAYMENT\""]) {
  if (!demo.includes(guard)) throw new Error(`缺少支付建单安全门禁：${guard}`);
}
console.log("Simulator contract surface check passed.");
