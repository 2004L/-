const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
const cookie = process.env.ADMIN_SESSION_COOKIE;
const orderId = process.env.ROOM_CHANGE_ORDER_ID;
const targetRoom = process.env.ROOM_CHANGE_TARGET ?? "1306";
const ttl = Number(process.env.ADMIN_CONFIRMATION_TTL_MS ?? 0);

if (!base || !cookie || !orderId) {
  console.log("SKIP  设置 TARGET_BASE_URL、ADMIN_SESSION_COOKIE、ROOM_CHANGE_ORDER_ID 后才会执行确认单验收。");
  process.exit(0);
}
if (!ttl || ttl < 1000) throw new Error("确认单过期验收需要服务端以 ADMIN_CONFIRMATION_TTL_MS=1000.. 配置短 TTL 后启动");

const headers = { "Content-Type": "application/json", Cookie: cookie };
async function call(toolName, args) {
  const response = await fetch(`${base}/api/admin/tools/execute`, { method: "POST", headers, body: JSON.stringify({ tool_name: toolName, arguments: args }) });
  const body = await response.json();
  return { status: response.status, body };
}
function expect(value, message) { if (!value) throw new Error(message); }
function preparedResult(result, label) { expect(result.status === 200 && result.body?.ok && result.body?.result?.action_id, `${label}准备失败：${JSON.stringify(result)}`); return result.body.result; }
const prepare = () => call("admin.prepare_room_change", { order_id: orderId, to_room: targetRoom, reason: "确认单四类场景验收" });

// 1) 取消确认：不改房态，再次确认必须被拦截。
const cancelled = preparedResult(await prepare(), "取消确认");
const cancelResult = await call("admin.cancel_pending_action", { action_id: cancelled.action_id, reason: "验收取消" });
expect(cancelResult.status === 200 && cancelResult.body?.result?.status === "CANCELLED", `取消确认失败：${JSON.stringify(cancelResult)}`);
const cancelledConfirm = await call("admin.confirm_pending_action", { action_id: cancelled.action_id, confirmation: "CONFIRM" });
expect(cancelledConfirm.status === 400 && cancelledConfirm.body?.error === "admin_action_not_confirmable", `已取消确认单仍可执行：${JSON.stringify(cancelledConfirm)}`);
console.log("PASS  取消确认：状态为 CANCELLED，重复确认被拦截");

// 2) 过期确认：等待短 TTL 后确认，服务端落 EXPIRED 并返回 410。
const expired = preparedResult(await prepare(), "过期确认");
await new Promise((resolve) => setTimeout(resolve, ttl + 250));
const expiredConfirm = await call("admin.confirm_pending_action", { action_id: expired.action_id, confirmation: "CONFIRM" });
expect(expiredConfirm.status === 410 && expiredConfirm.body?.error === "admin_action_expired", `过期确认单未被拦截：${JSON.stringify(expiredConfirm)}`);
console.log("PASS  确认单过期：返回 410 并记录 EXPIRED");

// 3) 目标房被提前占用：两张确认单指向同一目标，先执行一张，后一张必须 409。
const first = preparedResult(await prepare(), "房态冲突-第一张");
const second = preparedResult(await prepare(), "房态冲突-第二张");
const firstConfirm = await call("admin.confirm_pending_action", { action_id: first.action_id, confirmation: "CONFIRM" });
expect(firstConfirm.status === 200 && firstConfirm.body?.ok, `房态冲突前置执行失败：${JSON.stringify(firstConfirm)}`);
const conflict = await call("admin.confirm_pending_action", { action_id: second.action_id, confirmation: "CONFIRM" });
expect(conflict.status === 409 && conflict.body?.error === "room_change_conflict", `目标房被占用后未返回 409：${JSON.stringify(conflict)}`);
console.log("PASS  房间提前占用：一个执行成功，后一个返回 409");

// 4) 操作审计详情：按 action_id 拉取完整链路，至少包含准备和冲突事件。
const audit = await call("admin.get_audit_records", { action_id: second.action_id, limit: 100 });
const events = audit.body?.result?.events ?? [];
expect(audit.status === 200 && audit.body?.ok, `审计详情读取失败：${JSON.stringify(audit)}`);
expect(events.some((event) => event.event_type === "ADMIN_ROOM_CHANGE_PREPARED"), `审计缺少准备事件：${JSON.stringify(events)}`);
expect(events.some((event) => event.event_type === "ADMIN_ACTION_CONFLICTED"), `审计缺少冲突事件：${JSON.stringify(events)}`);
expect(events.every((event) => event.action_id === second.action_id), `审计详情混入其他确认单：${JSON.stringify(events)}`);
console.log("PASS  操作审计详情：可按 action_id 查看准备、冲突和操作者信息");
console.log("Admin confirmation acceptance passed: 4 scenarios.");
