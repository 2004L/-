import { readFileSync } from "node:fs";

const files = ["lib/contracts.ts", "lib/tools.ts", "lib/admin-tools.ts", "lib/admin-auth.ts", "app/api/agent/turn/route.ts", "app/api/device/reader/route.ts", "app/api/device/encoder/route.ts", "app/api/police/submit/route.ts"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("idempotency") && file.includes("route.ts") && !file.includes("app/api/agent/turn")) throw new Error(`${file} 未声明幂等键`);
}
const tools = readFileSync("lib/tools.ts", "utf8");
for (const name of ["pms.search_order", "hotel.policy_answer", "device.reader.read_identity", "device.encoder.issue_keycard", "police.submit_registration"]) {
  if (!tools.includes(name)) throw new Error(`缺少工具契约：${name}`);
}
const adminTools = readFileSync("lib/admin-tools.ts", "utf8");
for (const name of ["admin.search_guest", "admin.get_room_status", "admin.prepare_room_change", "admin.confirm_room_change", "admin.cancel_room_change", "admin.get_audit_records"]) {
  if (!adminTools.includes(name)) throw new Error(`缺少管理员工具契约：${name}`);
}
const auth = readFileSync("lib/admin-auth.ts", "utf8");
for (const guard of ["admin_users", "admin_sessions", "admin_audit_events", "HttpOnly", "admin_permission_denied"]) {
  if (!auth.includes(guard)) throw new Error(`缺少管理员安全边界：${guard}`);
}
for (const route of ["app/api/admin/auth/login/route.ts", "app/api/admin/auth/me/route.ts", "app/api/admin/auth/logout/route.ts"]) {
  if (!readFileSync(route, "utf8").includes("ensureAdminSchema")) throw new Error(`管理员认证接口未初始化数据库：${route}`);
}
const demo = readFileSync("app/api/demo/[action]/route.ts", "utf8");
for (const action of ["walk-in-draft", "walk-in-quote", "walk-in-payment", "walk-in-payment-complete"]) {
  if (!demo.includes(`action === "${action}"`)) throw new Error(`缺少现场办理阶段接口：${action}`);
}
for (const guard of ["payment_requires_quote", "PAYMENT_CONFIRMED", "WALK_IN_ORDER_CREATED", "draft.status !== \"AWAITING_PAYMENT\""]) {
  if (!demo.includes(guard)) throw new Error(`缺少支付建单安全门禁：${guard}`);
}
console.log("Simulator contract surface check passed.");
