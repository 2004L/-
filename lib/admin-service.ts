import { getD1 } from "@/db";
import { adminToolArgumentSchemas, adminToolPermissions, type AdminToolName } from "@/lib/admin-tools";
import { auditAdmin, hasPermission, type AdminUser } from "@/lib/admin-auth";

type AdminAuth = { user: AdminUser; sessionId: string };

async function ensureActionSchema() {
  await getD1().prepare("CREATE TABLE IF NOT EXISTS admin_actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool_name TEXT NOT NULL, status TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await getD1().prepare("CREATE INDEX IF NOT EXISTS admin_actions_user_status_idx ON admin_actions(user_id, status, created_at)").run();
}

function maskedPhone(phoneLast4: string) { return `***${phoneLast4}`; }

async function searchOrders(args: { phone_last4?: string; order_code?: string }) {
  const conditions = args.phone_last4 ? "phone_last4 = ?" : "order_code = ?";
  const value = args.phone_last4 ?? args.order_code;
  const rows = await getD1().prepare(`SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE ${conditions} ORDER BY updated_at DESC LIMIT 20`).bind(value).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ id: row.id, order_code: row.order_code, source: row.source, guest_label: row.guest_label, phone: maskedPhone(String(row.phone_last4)), stay_date: row.stay_date, nights: row.nights, room_count: row.room_count, room_type: row.room_type, status: row.status, room_number: row.room_number }));
}

async function roomStatus(roomNumber: string) {
  const row = await getD1().prepare("SELECT order_code, phone_last4, guest_label, status FROM demo_orders WHERE room_number = ? AND status IN ('in_house', 'checkin_confirmed') LIMIT 1").bind(roomNumber).first<Record<string, unknown>>();
  return { room_number: roomNumber, status: row ? "occupied" : "vacant-clean", guest: row ? { order_code: row.order_code, phone: maskedPhone(String(row.phone_last4)), guest_label: row.guest_label } : null };
}

async function prepareRoomChange(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; from_room?: string; to_room: string; reason: string }) {
  const candidates = await searchOrders({ order_code: args.order_id, phone_last4: args.phone_last4 });
  if (candidates.length === 0) throw new Error("guest_not_found");
  if (candidates.length > 1) throw new Error("guest_match_ambiguous");
  const order = candidates[0];
  if (!["in_house", "checkin_confirmed"].includes(String(order.status))) throw new Error("guest_not_in_house");
  const fromRoom = args.from_room ?? String(order.room_number ?? "");
  if (!/^\d{3,5}$/.test(fromRoom)) throw new Error("current_room_missing");
  if (String(order.room_number) !== fromRoom) throw new Error("current_room_changed");
  const target = await roomStatus(args.to_room);
  if (target.status !== "vacant-clean") throw new Error("target_room_occupied");
  const id = crypto.randomUUID();
  const stamp = new Date();
  const expires = new Date(stamp.getTime() + 5 * 60 * 1000);
  const result = { action_id: id, order_id: order.id, order_code: order.order_code, guest: { label: order.guest_label, phone: order.phone }, from_room: fromRoom, to_room: args.to_room, reason: args.reason, expires_at: expires.toISOString(), status: "AWAITING_CONFIRMATION" };
  await getD1().prepare("INSERT INTO admin_actions (id, user_id, tool_name, status, request_json, result_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.user.id, "admin.prepare_room_change", "AWAITING_CONFIRMATION", JSON.stringify(args), JSON.stringify(result), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  await auditAdmin(auth.user, "ADMIN_ROOM_CHANGE_PREPARED", `已生成换房确认单：${order.order_code} ${fromRoom}→${args.to_room}`);
  return result;
}

async function confirmRoomChange(auth: AdminAuth, actionId: string, confirmation: "CONFIRM") {
  if (confirmation !== "CONFIRM") throw new Error("confirmation_required");
  await ensureActionSchema();
  const action = await getD1().prepare("SELECT id, status, request_json, result_json, expires_at FROM admin_actions WHERE id = ? AND user_id = ? LIMIT 1").bind(actionId, auth.user.id).first<{ id: string; status: string; request_json: string; result_json: string; expires_at: string }>();
  if (!action) throw new Error("admin_action_not_found");
  if (action.status === "EXECUTED") return { ...(JSON.parse(action.result_json) as Record<string, unknown>), status: "EXECUTED", idempotent: true };
  if (action.status !== "AWAITING_CONFIRMATION") throw new Error("admin_action_not_confirmable");
  if (new Date(action.expires_at).getTime() <= Date.now()) throw new Error("admin_action_expired");
  const prepared = JSON.parse(action.result_json) as { order_id: string; order_code: string; from_room: string; to_room: string; guest: { phone: string } };
  const stamp = new Date().toISOString();
  const update = await getD1().prepare("UPDATE demo_orders SET room_number = ?, updated_at = ? WHERE id = ? AND room_number = ? AND status IN ('in_house', 'checkin_confirmed') AND NOT EXISTS (SELECT 1 FROM demo_orders AS occupied WHERE occupied.room_number = ? AND occupied.status IN ('in_house', 'checkin_confirmed'))").bind(prepared.to_room, stamp, prepared.order_id, prepared.from_room, prepared.to_room).run();
  if (!update.meta.changes) throw new Error("room_change_conflict");
  const result = { ...prepared, status: "EXECUTED", executed_at: stamp, idempotent: false };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, action.id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.username, auth.user.role, "ADMIN_ROOM_CHANGE_EXECUTED", `已执行换房：${prepared.order_code} ${prepared.from_room}→${prepared.to_room}`, stamp),
  ]);
  return result;
}

export async function executeAdminTool(auth: AdminAuth, toolName: AdminToolName, rawArgs: unknown) {
  const permission = adminToolPermissions[toolName];
  if (!hasPermission(auth.user, permission)) {
    await auditAdmin(auth.user, "ADMIN_PERMISSION_DENIED", `工具 ${toolName} 缺少权限 ${permission}`);
    throw new Error("admin_permission_denied");
  }
  const parsed = adminToolArgumentSchemas[toolName].safeParse(rawArgs);
  if (!parsed.success) throw new Error("invalid_tool_arguments");
  if (toolName === "admin.search_guest") return { tool_name: toolName, result: { orders: await searchOrders(parsed.data) } };
  if (toolName === "admin.get_room_status") return { tool_name: toolName, result: await roomStatus(parsed.data.room_number) };
  if (toolName === "admin.prepare_room_change") { await ensureActionSchema(); return { tool_name: toolName, result: await prepareRoomChange(auth, parsed.data) }; }
  if (toolName === "admin.confirm_room_change") return { tool_name: toolName, result: await confirmRoomChange(auth, parsed.data.action_id, parsed.data.confirmation) };
  if (toolName === "admin.cancel_room_change") { await ensureActionSchema(); const stamp = new Date().toISOString(); const result = await getD1().prepare("UPDATE admin_actions SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(stamp, parsed.data.action_id, auth.user.id).run(); if (!result.meta.changes) throw new Error("admin_action_not_found"); await auditAdmin(auth.user, "ADMIN_ROOM_CHANGE_CANCELLED", "已取消待确认换房"); return { tool_name: toolName, result: { action_id: parsed.data.action_id, status: "CANCELLED" } }; }
  const rows = await getD1().prepare("SELECT id, event_type, detail, created_at FROM admin_audit_events ORDER BY id DESC LIMIT ?").bind(parsed.data.limit).all<Record<string, unknown>>();
  return { tool_name: toolName, result: { events: rows.results } };
}
