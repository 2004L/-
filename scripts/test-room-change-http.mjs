const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
const cookie = process.env.ADMIN_SESSION_COOKIE;
const orderId = process.env.ROOM_CHANGE_ORDER_ID;
const targetRoom = process.env.ROOM_CHANGE_TARGET ?? "1306";

if (!base || !cookie || !orderId) {
  console.log("SKIP  设置 TARGET_BASE_URL、ADMIN_SESSION_COOKIE、ROOM_CHANGE_ORDER_ID 后才会执行真实管理员换房并发测试。");
  process.exit(0);
}

const headers = { "Content-Type": "application/json", Cookie: cookie };
async function call(toolName, args) {
  const response = await fetch(`${base}/api/admin/tools/execute`, { method: "POST", headers, body: JSON.stringify({ tool_name: toolName, arguments: args }) });
  const body = await response.json();
  return { status: response.status, body };
}

const prepared = await Promise.all([1, 2].map(() => call("admin.prepare_room_change", { order_id: orderId, to_room: targetRoom, reason: "自动并发验收" })));
if (prepared.some((item) => !item.body?.ok || !item.body?.result?.action_id)) throw new Error(`准备换房失败：${JSON.stringify(prepared)}`);
const actionIds = prepared.map((item) => item.body.result.action_id);
const results = await Promise.all(actionIds.map((actionId) => call("admin.confirm_pending_action", { action_id: actionId, confirmation: "CONFIRM" })));
const success = results.filter((item) => item.status === 200 && item.body?.ok).length;
const conflicts = results.filter((item) => item.status === 409 && item.body?.error === "room_change_conflict").length;
if (success !== 1 || conflicts !== 1) throw new Error(`并发换房不变量失败：${JSON.stringify(results)}`);
console.log("PASS  真实 HTTP 管理员换房并发：一次成功、一次 409，正式 rooms 版本校验生效");
