import { getD1 } from "@/db";
import { adminToolArgumentSchemas, adminToolPermissions, type AdminPermission, type AdminToolName } from "@/lib/admin-tools";
import { auditAdmin, hasPermission, type AdminUser } from "@/lib/admin-auth";

type AdminAuth = { user: AdminUser; sessionId: string };

async function ensureActionSchema() {
  await getD1().prepare("CREATE TABLE IF NOT EXISTS admin_actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool_name TEXT NOT NULL, status TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await getD1().prepare("CREATE INDEX IF NOT EXISTS admin_actions_user_status_idx ON admin_actions(user_id, status, created_at)").run();
  try { await getD1().prepare("ALTER TABLE demo_orders ADD COLUMN room_amount INTEGER DEFAULT 380").run(); } catch { /* 已存在 */ }
  try { await getD1().prepare("ALTER TABLE demo_orders ADD COLUMN deposit_amount INTEGER DEFAULT 300").run(); } catch { /* 已存在 */ }
  try { await getD1().prepare("ALTER TABLE demo_orders ADD COLUMN total_amount INTEGER DEFAULT 680").run(); } catch { /* 已存在 */ }
}

function maskedPhone(phoneLast4: string) { return `***${phoneLast4}`; }
function money(value: unknown) { return `${Number(value ?? 0)} 元`; }

type AdminOrder = {
  id: unknown; order_code: unknown; source: unknown; guest_label: unknown; phone_last4: unknown; phone: unknown;
  stay_date: unknown; nights: unknown; room_count: unknown; room_type: unknown; status: unknown; room_number: unknown;
  room_amount?: unknown; deposit_amount?: unknown; total_amount?: unknown;
};
type PreparedAction = {
  action_id: string;
  action_type: "room_change" | "amount_adjustment" | "keycard_issue" | "police_submission";
  title: string;
  risk_level: "medium" | "high";
  required_permission: AdminPermission;
  order_id: string;
  order_code: string;
  guest: { label: unknown; phone: unknown };
  fields: Array<{ label: string; value: string }>;
  impacts: string[];
  confirm_label: string;
  cancel_label: string;
  reason: string;
  expires_at: string;
  status: "AWAITING_CONFIRMATION" | "EXECUTED";
  [key: string]: unknown;
};

async function searchOrders(args: { phone_last4?: string; order_code?: string }) {
  const conditions = args.phone_last4 ? "phone_last4 = ?" : "order_code = ?";
  const value = args.phone_last4 ?? args.order_code;
  const rows = await getD1().prepare(`SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount FROM demo_orders WHERE ${conditions} ORDER BY updated_at DESC LIMIT 20`).bind(value).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ id: row.id, order_code: row.order_code, source: row.source, guest_label: row.guest_label, phone: maskedPhone(String(row.phone_last4)), stay_date: row.stay_date, nights: row.nights, room_count: row.room_count, room_type: row.room_type, status: row.status, room_number: row.room_number, room_amount: row.room_amount, deposit_amount: row.deposit_amount, total_amount: row.total_amount }));
}

async function roomStatus(roomNumber: string) {
  const row = await getD1().prepare("SELECT order_code, phone_last4, guest_label, status FROM demo_orders WHERE room_number = ? AND status IN ('in_house', 'checkin_confirmed') LIMIT 1").bind(roomNumber).first<Record<string, unknown>>();
  return { room_number: roomNumber, status: row ? "occupied" : "vacant-clean", guest: row ? { order_code: row.order_code, phone: maskedPhone(String(row.phone_last4)), guest_label: row.guest_label } : null };
}

async function ensureAdminCommandSession() {
  const stamp = new Date().toISOString();
  await getD1().prepare("INSERT OR IGNORE INTO demo_sessions (id, hotel_code, city, created_at, updated_at) VALUES ('admin-session', 'GZ-HAOS-001', '广州', ?, ?)").bind(stamp, stamp).run();
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
  const result: PreparedAction = { action_id: id, action_type: "room_change", title: "确认修改房间吗？", risk_level: "medium", required_permission: "admin:room_change", order_id: String(order.id), order_code: String(order.order_code), guest: { label: order.guest_label, phone: order.phone }, from_room: fromRoom, to_room: args.to_room, fields: [{ label: "当前房间", value: fromRoom }, { label: "目标房间", value: args.to_room }, { label: "订单状态", value: String(order.status) }], impacts: [`${fromRoom} 释放为待清洁`, `${args.to_room} 改为已入住`, "原房卡将失效，需重新制作房卡"], confirm_label: "确认修改", cancel_label: "取消", reason: args.reason, expires_at: expires.toISOString(), status: "AWAITING_CONFIRMATION" };
  await getD1().prepare("INSERT INTO admin_actions (id, user_id, tool_name, status, request_json, result_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.user.id, "admin.prepare_room_change", "AWAITING_CONFIRMATION", JSON.stringify(args), JSON.stringify(result), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  await auditAdmin(auth.user, "ADMIN_ROOM_CHANGE_PREPARED", `已生成换房确认单：${order.order_code} ${fromRoom}→${args.to_room}`);
  return result;
}

async function loadSingleOrder(args: { order_id?: string; phone_last4?: string; order_code?: string }) {
  if (args.order_id) {
    const row = await getD1().prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount FROM demo_orders WHERE id = ? OR order_code = ? LIMIT 2").bind(args.order_id, args.order_id).all<Record<string, unknown>>();
    const candidates = row.results.map((order) => ({ id: order.id, order_code: order.order_code, source: order.source, guest_label: order.guest_label, phone: maskedPhone(String(order.phone_last4)), stay_date: order.stay_date, nights: order.nights, room_count: order.room_count, room_type: order.room_type, status: order.status, room_number: order.room_number, room_amount: order.room_amount, deposit_amount: order.deposit_amount, total_amount: order.total_amount }));
    if (candidates.length === 0) throw new Error("guest_not_found");
    if (candidates.length > 1) throw new Error("guest_match_ambiguous");
    return candidates[0] as AdminOrder;
  }
  const candidates = await searchOrders({ order_code: args.order_code, phone_last4: args.phone_last4 });
  if (candidates.length === 0) throw new Error("guest_not_found");
  if (candidates.length > 1) throw new Error("guest_match_ambiguous");
  return candidates[0] as AdminOrder;
}

async function createPreparedAction(auth: AdminAuth, toolName: AdminToolName, args: Record<string, unknown>, result: PreparedAction, eventType: string, detail: string) {
  const stamp = new Date();
  const expires = new Date(stamp.getTime() + 5 * 60 * 1000);
  const action = { ...result, expires_at: expires.toISOString(), status: "AWAITING_CONFIRMATION" as const };
  await getD1().prepare("INSERT INTO admin_actions (id, user_id, tool_name, status, request_json, result_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(action.action_id, auth.user.id, toolName, "AWAITING_CONFIRMATION", JSON.stringify(args), JSON.stringify(action), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  await auditAdmin(auth.user, eventType, detail);
  return action;
}

async function prepareAmountAdjustment(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; order_code?: string; amount_type: "room_amount" | "deposit_amount" | "total_amount"; new_amount: number; reason: string }) {
  const order = await loadSingleOrder(args);
  if (!["awaiting_arrival", "checkin_confirmed", "in_house"].includes(String(order.status))) throw new Error("order_amount_not_editable");
  const oldAmount = Number(order[args.amount_type] ?? (args.amount_type === "deposit_amount" ? 300 : args.amount_type === "room_amount" ? 380 : 680));
  const label = args.amount_type === "deposit_amount" ? "押金" : args.amount_type === "room_amount" ? "房费" : "总金额";
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_amount_adjustment", args, {
    action_id: id,
    action_type: "amount_adjustment",
    title: `确认修改${label}吗？`,
    risk_level: "high",
    required_permission: "admin:payment_adjust",
    order_id: String(order.id),
    order_code: String(order.order_code),
    guest: { label: order.guest_label, phone: order.phone },
    amount_type: args.amount_type,
    old_amount: oldAmount,
    new_amount: args.new_amount,
    fields: [{ label: "订单号", value: String(order.order_code) }, { label, value: `${money(oldAmount)} → ${money(args.new_amount)}` }, { label: "订单状态", value: String(order.status) }],
    impacts: ["将修改订单金额字段", "可能影响补款、退款或账务对账", "执行后会写入管理员审计"],
    confirm_label: "确认修改金额",
    cancel_label: "取消",
    reason: args.reason,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_AMOUNT_ADJUSTMENT_PREPARED", `已生成金额调整确认单：${order.order_code} ${label} ${oldAmount}→${args.new_amount}`);
}

async function prepareKeycardIssue(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; order_code?: string; room_number?: string; reason: string }) {
  const order = await loadSingleOrder(args);
  const roomNumber = args.room_number ?? String(order.room_number ?? "");
  if (!/^\d{3,5}$/.test(roomNumber)) throw new Error("room_number_missing");
  if (!["in_house", "checkin_confirmed"].includes(String(order.status))) throw new Error("keycard_requires_checked_in_guest");
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_keycard_issue", args, {
    action_id: id,
    action_type: "keycard_issue",
    title: "确认制作房卡吗？",
    risk_level: "high",
    required_permission: "admin:device_control",
    order_id: String(order.id),
    order_code: String(order.order_code),
    guest: { label: order.guest_label, phone: order.phone },
    room_number: roomNumber,
    fields: [{ label: "房间", value: roomNumber }, { label: "订单号", value: String(order.order_code) }, { label: "订单状态", value: String(order.status) }],
    impacts: ["将调用发卡机工具", "旧卡可能需要同时挂失或回收", "执行结果会写入设备命令和审计"],
    confirm_label: "确认发卡",
    cancel_label: "取消",
    reason: args.reason,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_KEYCARD_ISSUE_PREPARED", `已生成发卡确认单：${order.order_code} 房间 ${roomNumber}`);
}

async function preparePoliceSubmission(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; order_code?: string; region: "广州" | "珠海"; reason: string }) {
  const order = await loadSingleOrder(args);
  if (!String(order.room_number ?? "").match(/^\d{3,5}$/)) throw new Error("room_number_missing");
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_police_submission", args, {
    action_id: id,
    action_type: "police_submission",
    title: "确认提交公安登记吗？",
    risk_level: "high",
    required_permission: "admin:checkin",
    order_id: String(order.id),
    order_code: String(order.order_code),
    guest: { label: order.guest_label, phone: order.phone },
    region: args.region,
    room_number: String(order.room_number),
    fields: [{ label: "提交地区", value: args.region }, { label: "房间", value: String(order.room_number) }, { label: "订单号", value: String(order.order_code) }],
    impacts: ["将调用公安登记工具", "提交后必须保留回执", "验证码、维护、证书异常需转人工"],
    confirm_label: "确认提交公安",
    cancel_label: "取消",
    reason: args.reason,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_POLICE_SUBMISSION_PREPARED", `已生成公安提交确认单：${order.order_code} ${args.region}`);
}

async function getPendingAction(auth: AdminAuth, actionId: string) {
  const action = await getD1().prepare("SELECT id, status, request_json, result_json, expires_at FROM admin_actions WHERE id = ? AND user_id = ? LIMIT 1").bind(actionId, auth.user.id).first<{ id: string; status: string; request_json: string; result_json: string; expires_at: string }>();
  if (!action) throw new Error("admin_action_not_found");
  if (action.status === "EXECUTED") return { ...(JSON.parse(action.result_json) as Record<string, unknown>), status: "EXECUTED", idempotent: true };
  if (action.status !== "AWAITING_CONFIRMATION") throw new Error("admin_action_not_confirmable");
  if (new Date(action.expires_at).getTime() <= Date.now()) throw new Error("admin_action_expired");
  return { action, prepared: JSON.parse(action.result_json) as PreparedAction };
}

async function executeRoomChange(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const fromRoom = String(prepared.from_room);
  const toRoom = String(prepared.to_room);
  const update = await getD1().prepare("UPDATE demo_orders SET room_number = ?, updated_at = ? WHERE id = ? AND room_number = ? AND status IN ('in_house', 'checkin_confirmed') AND NOT EXISTS (SELECT 1 FROM demo_orders AS occupied WHERE occupied.room_number = ? AND occupied.status IN ('in_house', 'checkin_confirmed'))").bind(prepared.to_room, stamp, prepared.order_id, prepared.from_room, prepared.to_room).run();
  if (!update.meta.changes) throw new Error("room_change_conflict");
  const result = { ...prepared, status: "EXECUTED", executed_at: stamp, idempotent: false };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.username, auth.user.role, "ADMIN_ROOM_CHANGE_EXECUTED", `已执行换房：${prepared.order_code} ${fromRoom}→${toRoom}`, stamp),
  ]);
  return result;
}

async function executeAmountAdjustment(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const column = prepared.amount_type === "deposit_amount" ? "deposit_amount" : prepared.amount_type === "room_amount" ? "room_amount" : "total_amount";
  const update = await getD1().prepare(`UPDATE demo_orders SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(prepared.new_amount, stamp, prepared.order_id).run();
  if (!update.meta.changes) throw new Error("amount_adjustment_conflict");
  const result = { ...prepared, status: "EXECUTED", executed_at: stamp, idempotent: false };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.username, auth.user.role, "ADMIN_AMOUNT_ADJUSTMENT_EXECUTED", `已修改金额：${prepared.order_code} ${prepared.old_amount}→${prepared.new_amount}`, stamp),
  ]);
  return result;
}

async function executeKeycardIssue(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const commandId = `admin-card-${actionId}`;
  await ensureAdminCommandSession();
  const command = await getD1().prepare("INSERT OR IGNORE INTO external_commands (id, session_id, case_id, target, operation, idempotency_key, status, request_json, result_json, error_code, retryable, created_at, updated_at) VALUES (?, 'admin-session', ?, 'encoder', 'issue_keycard', ?, 'SUCCEEDED', ?, ?, NULL, 0, ?, ?)").bind(commandId, null, `admin:keycard:${actionId}`, JSON.stringify({ order_id: prepared.order_id, room_number: prepared.room_number }), JSON.stringify({ room_number: prepared.room_number, admin_confirmed: true }), stamp, stamp).run();
  const result = { ...prepared, status: "EXECUTED", command_id: commandId, executed_at: stamp, idempotent: !command.meta.changes };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.username, auth.user.role, "ADMIN_KEYCARD_ISSUE_EXECUTED", `已确认发卡：${prepared.order_code} 房间 ${prepared.room_number}`, stamp),
  ]);
  return result;
}

async function executePoliceSubmission(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const receipt = `ADMIN-${prepared.region}-${Date.now().toString().slice(-8)}`;
  const commandId = `admin-police-${actionId}`;
  await ensureAdminCommandSession();
  const command = await getD1().prepare("INSERT OR IGNORE INTO external_commands (id, session_id, case_id, target, operation, idempotency_key, status, request_json, result_json, error_code, retryable, created_at, updated_at) VALUES (?, 'admin-session', ?, 'police', 'submit_registration', ?, 'SUCCEEDED', ?, ?, NULL, 0, ?, ?)").bind(commandId, null, `admin:police:${actionId}`, JSON.stringify({ order_id: prepared.order_id, region: prepared.region, room_number: prepared.room_number }), JSON.stringify({ receipt, admin_confirmed: true }), stamp, stamp).run();
  const result = { ...prepared, status: "EXECUTED", command_id: commandId, receipt, executed_at: stamp, idempotent: !command.meta.changes };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.username, auth.user.role, "ADMIN_POLICE_SUBMISSION_EXECUTED", `已确认提交公安登记：${prepared.order_code} 回执 ${receipt}`, stamp),
  ]);
  return result;
}

async function confirmPendingAction(auth: AdminAuth, actionId: string, confirmation: "CONFIRM") {
  if (confirmation !== "CONFIRM") throw new Error("confirmation_required");
  await ensureActionSchema();
  const loaded = await getPendingAction(auth, actionId);
  if ("idempotent" in loaded) return loaded;
  const { action, prepared } = loaded;
  if (!hasPermission(auth.user, prepared.required_permission)) throw new Error("admin_permission_denied");
  if (prepared.action_type === "room_change") return executeRoomChange(auth, action.id, prepared);
  if (prepared.action_type === "amount_adjustment") return executeAmountAdjustment(auth, action.id, prepared);
  if (prepared.action_type === "keycard_issue") return executeKeycardIssue(auth, action.id, prepared);
  if (prepared.action_type === "police_submission") return executePoliceSubmission(auth, action.id, prepared);
  throw new Error("unknown_admin_action_type");
}

async function cancelPendingAction(auth: AdminAuth, actionId: string, reason: string) {
  await ensureActionSchema();
  const stamp = new Date().toISOString();
  const result = await getD1().prepare("UPDATE admin_actions SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(stamp, actionId, auth.user.id).run();
  if (!result.meta.changes) throw new Error("admin_action_not_found");
  await auditAdmin(auth.user, "ADMIN_ACTION_CANCELLED", `已取消待确认动作：${reason}`);
  return { action_id: actionId, status: "CANCELLED" };
}

export async function executeAdminTool(auth: AdminAuth, toolName: AdminToolName, rawArgs: unknown) {
  await ensureActionSchema();
  const permission = adminToolPermissions[toolName];
  if (!hasPermission(auth.user, permission)) {
    await auditAdmin(auth.user, "ADMIN_PERMISSION_DENIED", `工具 ${toolName} 缺少权限 ${permission}`);
    throw new Error("admin_permission_denied");
  }
  const parsed = adminToolArgumentSchemas[toolName].safeParse(rawArgs);
  if (!parsed.success) throw new Error("invalid_tool_arguments");
  if (toolName === "admin.search_guest") return { tool_name: toolName, result: { orders: await searchOrders(parsed.data) } };
  if (toolName === "admin.get_room_status") return { tool_name: toolName, result: await roomStatus(parsed.data.room_number) };
  if (toolName === "admin.prepare_room_change") return { tool_name: toolName, result: await prepareRoomChange(auth, parsed.data) };
  if (toolName === "admin.prepare_amount_adjustment") return { tool_name: toolName, result: await prepareAmountAdjustment(auth, parsed.data) };
  if (toolName === "admin.prepare_keycard_issue") return { tool_name: toolName, result: await prepareKeycardIssue(auth, parsed.data) };
  if (toolName === "admin.prepare_police_submission") return { tool_name: toolName, result: await preparePoliceSubmission(auth, parsed.data) };
  if (toolName === "admin.confirm_pending_action" || toolName === "admin.confirm_room_change") return { tool_name: toolName, result: await confirmPendingAction(auth, parsed.data.action_id, parsed.data.confirmation) };
  if (toolName === "admin.cancel_pending_action" || toolName === "admin.cancel_room_change") return { tool_name: toolName, result: await cancelPendingAction(auth, parsed.data.action_id, parsed.data.reason) };
  const rows = await getD1().prepare("SELECT id, event_type, detail, created_at FROM admin_audit_events ORDER BY id DESC LIMIT ?").bind(parsed.data.limit).all<Record<string, unknown>>();
  return { tool_name: toolName, result: { events: rows.results } };
}
