import { getD1 } from "@/db";
import { adminToolArgumentSchemas, adminToolPermissions, type AdminPermission, type AdminToolName } from "@/lib/admin-tools";
import { auditAdmin, hasPermission, type AdminUser } from "@/lib/admin-auth";
import { syncLegacyCore } from "@/lib/legacy-core-sync";
import { ORDER_ERRORS, updateOrderAmount, type OrderAmountType } from "@/lib/orders";
import { syncPmsRoomCatalog } from "@/lib/pms-core-sync";

export type AdminAuth = { user: AdminUser; sessionId: string };

let formalCoreAvailable: boolean | null = null;

function confirmationTtlMs() {
  const configured = Number(typeof process !== "undefined" ? process.env?.ADMIN_CONFIRMATION_TTL_MS : undefined);
  return Number.isFinite(configured) && configured >= 1000 && configured <= 60 * 60 * 1000 ? configured : 5 * 60 * 1000;
}

async function ensureFormalCore(auth: AdminAuth) {
  if (formalCoreAvailable === false) return false;
  try {
    await syncLegacyCore({ tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id });
    formalCoreAvailable = true;
    return true;
  } catch {
    // A pre-0008 local database can still use the compatibility projection.
    console.warn("[formal-core] sync unavailable; using compatibility projection");
    formalCoreAvailable = false;
    return false;
  }
}

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
  room_amount?: unknown; deposit_amount?: unknown; total_amount?: unknown; order_version?: unknown; amount_source?: unknown;
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
  status: "AWAITING_CONFIRMATION" | "EXECUTED" | "CANCELLED" | "EXPIRED" | "CONFLICTED";
  [key: string]: unknown;
};

async function searchOrders(args: { order_id?: string; phone_last4?: string; order_code?: string }, hotelId: string, tenantId = "tenant-demo") {
  try {
    await syncLegacyCore({ tenantId, hotelId });
    const clauses: string[] = ["r.hotel_id = ?"];
    const binds: unknown[] = [hotelId];
    if (args.order_id) { clauses.push("(r.id = ? OR r.reservation_no = ?)"); binds.push(args.order_id, args.order_id); }
    else if (args.phone_last4) { clauses.push("r.phone_last4 = ?"); binds.push(args.phone_last4); }
    else if (args.order_code) { clauses.push("r.reservation_no = ?"); binds.push(args.order_code); }
    const rows = await getD1().prepare(`SELECT r.id, r.reservation_no, r.source, r.guest_name_masked, r.phone_last4, r.stay_date, r.nights, r.room_count, r.status, o.id AS order_id, o.version AS order_version, COALESCE(o.total_amount, r.total_amount) AS total_amount, COALESCE(o.deposit_amount, r.deposit_amount) AS deposit_amount, COALESCE(o.room_amount, 0) AS room_amount, rt.name AS room_type, rm.room_number FROM reservations r LEFT JOIN orders o ON o.hotel_id = r.hotel_id AND o.order_no = r.reservation_no LEFT JOIN reservation_rooms rr ON rr.reservation_id = r.id AND rr.hotel_id = r.hotel_id LEFT JOIN room_types rt ON rt.id = rr.room_type_id LEFT JOIN rooms rm ON rm.id = rr.room_id WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC LIMIT 20`).bind(...binds).all<Record<string, unknown>>();
    const missingFormalOrders = rows.results.filter((row) => !row.order_id).length;
    if (missingFormalOrders) console.warn(`[orders][compat] ${missingFormalOrders} reservation(s) missing a formal order; using reservation fallback amounts`);
    const statusLabels: Record<number, string> = { 0: "pending_confirmation", 1: "awaiting_arrival", 2: "in_house", 3: "checked_out", 4: "cancelled", 5: "no_show" };
    return rows.results.map((row) => ({ id: row.id, order_code: row.reservation_no, source: row.source, guest_label: row.guest_name_masked, phone: maskedPhone(String(row.phone_last4)), phone_last4: row.phone_last4, stay_date: row.stay_date, nights: row.nights, room_count: row.room_count, room_type: row.room_type ?? "未指定房型", status: statusLabels[Number(row.status)] ?? "unknown", room_number: row.room_number ?? null, room_amount: row.room_amount, deposit_amount: row.deposit_amount, total_amount: row.total_amount, order_version: row.order_version ?? null, amount_source: row.order_id ? "orders" : "reservation_fallback" }));
  } catch (error) {
    // A pre-0008 local database keeps the legacy projection available.
    console.warn("[formal-core] order query fallback", error instanceof Error ? error.message : "unknown_error");
  }
  const select = "SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount FROM demo_orders";
  const rows = args.order_id
    ? await getD1().prepare(`${select} WHERE hotel_id = ? AND (id = ? OR order_code = ?) ORDER BY updated_at DESC LIMIT 20`).bind(hotelId, args.order_id, args.order_id).all<Record<string, unknown>>()
    : await getD1().prepare(`${select} WHERE hotel_id = ? AND ${args.phone_last4 ? "phone_last4 = ?" : "order_code = ?"} ORDER BY updated_at DESC LIMIT 20`).bind(hotelId, args.phone_last4 ?? args.order_code).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ id: row.id, order_code: row.order_code, source: row.source, guest_label: row.guest_label, phone: maskedPhone(String(row.phone_last4)), stay_date: row.stay_date, nights: row.nights, room_count: row.room_count, room_type: row.room_type, status: row.status, room_number: row.room_number, room_amount: row.room_amount, deposit_amount: row.deposit_amount, total_amount: row.total_amount }));
}

async function roomStatus(auth: AdminAuth, roomNumber: string) {
  const formal = await ensureFormalCore(auth);
  if (formal) {
    // The legacy backfill only contains rooms that appeared on old orders.
    // Sync the PMS catalog first so a currently vacant target room (for
    // example 1306) participates in the same formal room-state machine.
    try { await syncPmsRoomCatalog({ tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id, hotelCode: auth.user.hotel_code }); } catch { /* PMS catalog is best effort; status checks remain authoritative */ }
    const row = await getD1().prepare("SELECT r.status, r.version, res.reservation_no AS order_code, res.phone_last4, res.guest_name_masked AS guest_label FROM rooms r LEFT JOIN reservation_rooms rr ON rr.hotel_id = r.hotel_id AND rr.room_id = r.id AND rr.status = 1 LEFT JOIN reservations res ON res.id = rr.reservation_id AND res.hotel_id = r.hotel_id AND res.status = 2 WHERE r.hotel_id = ? AND r.room_number = ? LIMIT 1").bind(auth.user.hotel_id, roomNumber).first<Record<string, unknown>>();
    if (row) {
      const status = Number(row.status) === 3 ? "occupied" : Number(row.status) === 2 ? "held" : Number(row.status) === 1 ? "vacant-dirty" : Number(row.status) === 4 ? "out-of-order" : "vacant-clean";
      return { room_number: roomNumber, status, version: Number(row.version ?? 1), guest: row.order_code ? { order_code: row.order_code, phone: maskedPhone(String(row.phone_last4)), guest_label: row.guest_label } : null };
    }
    return { room_number: roomNumber, status: "unknown", version: null, guest: null };
  }
  const row = await getD1().prepare("SELECT order_code, phone_last4, guest_label, status FROM demo_orders WHERE hotel_id = ? AND room_number = ? AND status IN ('in_house', 'checkin_confirmed') LIMIT 1").bind(auth.user.hotel_id, roomNumber).first<Record<string, unknown>>();
  return { room_number: roomNumber, status: row ? "occupied" : "vacant-clean", version: null, guest: row ? { order_code: row.order_code, phone: maskedPhone(String(row.phone_last4)), guest_label: row.guest_label } : null };
}

async function prepareRoomChange(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; from_room?: string; to_room: string; reason: string }) {
  const candidates = await searchOrders({ order_id: args.order_id, phone_last4: args.phone_last4 }, auth.user.hotel_id, auth.user.tenant_id);
  if (candidates.length === 0) throw new Error("guest_not_found");
  if (candidates.length > 1) throw new Error("guest_match_ambiguous");
  const order = candidates[0];
  if (!["in_house", "checkin_confirmed"].includes(String(order.status))) throw new Error("guest_not_in_house");
  const fromRoom = args.from_room ?? String(order.room_number ?? "");
  if (!/^\d{3,5}$/.test(fromRoom)) throw new Error("current_room_missing");
  if (String(order.room_number) !== fromRoom) throw new Error("current_room_changed");
  const target = await roomStatus(auth, args.to_room);
  if (target.status !== "vacant-clean") throw new Error("target_room_occupied");
  const source = await roomStatus(auth, fromRoom);
  const id = crypto.randomUUID();
  const stamp = new Date();
  const expires = new Date(stamp.getTime() + confirmationTtlMs());
  const result: PreparedAction = { action_id: id, action_type: "room_change", title: "确认修改房间吗？", risk_level: "medium", required_permission: "admin:room_change", order_id: String(order.id), order_code: String(order.order_code), guest: { label: order.guest_label, phone: order.phone }, from_room: fromRoom, to_room: args.to_room, from_room_version: source.version, target_room_version: target.version, fields: [{ label: "当前房间", value: fromRoom }, { label: "目标房间", value: args.to_room }, { label: "订单状态", value: String(order.status) }], impacts: [`${fromRoom} 释放为待清洁`, `${args.to_room} 改为已入住`, "原房卡将失效，需重新制作房卡"], confirm_label: "确认修改", cancel_label: "取消", reason: args.reason, expires_at: expires.toISOString(), status: "AWAITING_CONFIRMATION" };
  await getD1().prepare("INSERT INTO admin_actions (id, user_id, tenant_id, hotel_id, tool_name, status, request_json, result_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.user.id, auth.user.tenant_id, auth.user.hotel_id, "admin.prepare_room_change", "AWAITING_CONFIRMATION", JSON.stringify(args), JSON.stringify(result), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  await auditAdmin(auth.user, "ADMIN_ROOM_CHANGE_PREPARED", `已生成换房确认单：${order.order_code} ${fromRoom}→${args.to_room}`, { actionId: id });
  return result;
}

async function loadSingleOrder(args: { order_id?: string; phone_last4?: string; order_code?: string }, hotelId: string, tenantId = "tenant-demo") {
  const candidates = await searchOrders({ order_id: args.order_id, order_code: args.order_code, phone_last4: args.phone_last4 }, hotelId, tenantId);
  if (candidates.length === 0) throw new Error("guest_not_found");
  if (candidates.length > 1) throw new Error("guest_match_ambiguous");
  return candidates[0] as AdminOrder;
}

async function createPreparedAction(auth: AdminAuth, toolName: AdminToolName, args: Record<string, unknown>, result: PreparedAction, eventType: string, detail: string) {
  const stamp = new Date();
  const expires = new Date(stamp.getTime() + confirmationTtlMs());
  const action = { ...result, expires_at: expires.toISOString(), status: "AWAITING_CONFIRMATION" as const };
  await getD1().prepare("INSERT INTO admin_actions (id, user_id, tenant_id, hotel_id, tool_name, status, request_json, result_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(action.action_id, auth.user.id, auth.user.tenant_id, auth.user.hotel_id, toolName, "AWAITING_CONFIRMATION", JSON.stringify(args), JSON.stringify(action), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  await auditAdmin(auth.user, eventType, detail, { actionId: action.action_id });
  return action;
}

async function prepareAmountAdjustment(auth: AdminAuth, args: { order_id?: string; phone_last4?: string; order_code?: string; amount_type: "room_amount" | "deposit_amount" | "total_amount"; new_amount: number; reason: string }) {
  const order = await loadSingleOrder(args, auth.user.hotel_id, auth.user.tenant_id);
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
    order_version: Number(order.order_version ?? 0),
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
  const order = await loadSingleOrder(args, auth.user.hotel_id, auth.user.tenant_id);
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
  const order = await loadSingleOrder(args, auth.user.hotel_id, auth.user.tenant_id);
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
  const action = await getD1().prepare("SELECT id, status, request_json, result_json, expires_at FROM admin_actions WHERE id = ? AND user_id = ? AND hotel_id = ? LIMIT 1").bind(actionId, auth.user.id, auth.user.hotel_id).first<{ id: string; status: string; request_json: string; result_json: string; expires_at: string }>();
  if (!action) throw new Error("admin_action_not_found");
  if (action.status === "EXECUTED") return { ...(JSON.parse(action.result_json) as Record<string, unknown>), status: "EXECUTED", idempotent: true };
  if (action.status !== "AWAITING_CONFIRMATION") throw new Error("admin_action_not_confirmable");
  if (new Date(action.expires_at).getTime() <= Date.now()) {
    const prepared = JSON.parse(action.result_json) as PreparedAction;
    const stamp = new Date().toISOString();
    const expired = { ...prepared, status: "EXPIRED" as const, expired_at: stamp, failure_code: "admin_action_expired" };
    const update = await getD1().prepare("UPDATE admin_actions SET status = 'EXPIRED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(expired), stamp, actionId, auth.user.id, auth.user.hotel_id).run();
    if (update.meta.changes) await auditAdmin(auth.user, "ADMIN_ACTION_EXPIRED", `确认单已过期：${actionId}`, { actionId });
    throw new Error("admin_action_expired");
  }
  return { action, prepared: JSON.parse(action.result_json) as PreparedAction };
}

async function markActionConflict(auth: AdminAuth, action: { id: string }, prepared: PreparedAction, failureCode: string) {
  const stamp = new Date().toISOString();
  const result = { ...prepared, status: "CONFLICTED" as const, conflicted_at: stamp, failure_code: failureCode };
  const update = await getD1().prepare("UPDATE admin_actions SET status = 'CONFLICTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, action.id, auth.user.id, auth.user.hotel_id).run();
  if (update.meta.changes) await auditAdmin(auth.user, "ADMIN_ACTION_CONFLICTED", `确认单执行冲突：${failureCode}`, { actionId: action.id });
}

async function executeRoomChange(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const fromRoom = String(prepared.from_room);
  const toRoom = String(prepared.to_room);
  if (fromRoom === toRoom) throw new Error("room_change_same_room");
  const formal = await ensureFormalCore(auth);
  let update: { meta: { changes: number } };
  if (formal) {
    const expectedVersion = Number(prepared.from_room_version ?? 1);
    update = await getD1().prepare("UPDATE rooms SET status = CASE WHEN room_number = ? THEN 1 WHEN room_number = ? THEN 3 ELSE status END, version = version + 1, updated_at = ? WHERE hotel_id = ? AND ((room_number = ? AND status = 3 AND version = ?) OR (room_number = ? AND status = 0))").bind(fromRoom, toRoom, stamp, auth.user.hotel_id, fromRoom, expectedVersion, toRoom).run();
    if (update.meta.changes !== 2) throw new Error("room_change_conflict");
    await getD1().batch([
      getD1().prepare("INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) SELECT ?, ?, hotel_id, id, 3, 1, ?, 'admin', ?, ?, ? FROM rooms WHERE hotel_id = ? AND room_number = ?").bind(`rlog-${actionId}-from`, auth.user.tenant_id, prepared.reason, auth.user.id, actionId, stamp, auth.user.hotel_id, fromRoom),
      getD1().prepare("INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) SELECT ?, ?, hotel_id, id, 0, 3, ?, 'admin', ?, ?, ? FROM rooms WHERE hotel_id = ? AND room_number = ?").bind(`rlog-${actionId}-to`, auth.user.tenant_id, prepared.reason, auth.user.id, actionId, stamp, auth.user.hotel_id, toRoom),
      getD1().prepare("UPDATE reservation_rooms SET room_id = (SELECT id FROM rooms WHERE hotel_id = ? AND room_number = ? LIMIT 1), updated_at = ? WHERE hotel_id = ? AND reservation_id = ? AND status = 1").bind(auth.user.hotel_id, toRoom, stamp, auth.user.hotel_id, prepared.order_id),
      getD1().prepare("UPDATE demo_orders SET room_number = ?, updated_at = ? WHERE hotel_id = ? AND id = ? AND room_number = ? AND status IN ('in_house', 'checkin_confirmed')").bind(toRoom, stamp, auth.user.hotel_id, prepared.order_id, fromRoom),
    ]);
  } else {
    update = await getD1().prepare("UPDATE demo_orders SET room_number = ?, updated_at = ? WHERE hotel_id = ? AND id = ? AND room_number = ? AND status IN ('in_house', 'checkin_confirmed') AND NOT EXISTS (SELECT 1 FROM demo_orders AS occupied WHERE occupied.hotel_id = ? AND occupied.room_number = ? AND occupied.status IN ('in_house', 'checkin_confirmed'))").bind(prepared.to_room, stamp, auth.user.hotel_id, prepared.order_id, prepared.from_room, auth.user.hotel_id, prepared.to_room).run();
  }
  if (!update.meta.changes) throw new Error("room_change_conflict");
  const result = { ...prepared, status: "EXECUTED", executed_at: stamp, idempotent: false };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_ROOM_CHANGE_EXECUTED", `已执行换房：${prepared.order_code} ${fromRoom}→${toRoom}`, stamp),
  ]);
  return result;
}

async function executeAmountAdjustment(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const amountType: OrderAmountType = prepared.amount_type === "deposit_amount" ? "deposit_amount" : prepared.amount_type === "room_amount" ? "room_amount" : "total_amount";
  const preparedVersion = Number(prepared.order_version);
  const expectedVersion = Number.isInteger(preparedVersion) && preparedVersion > 0 ? preparedVersion : undefined;
  let updated: Awaited<ReturnType<typeof updateOrderAmount>>;
  try {
    updated = await updateOrderAmount({ tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id, orderNo: prepared.order_code, amountType, amount: Number(prepared.new_amount), expectedVersion });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === ORDER_ERRORS.NOT_FOUND) throw new Error("amount_adjustment_not_found");
    if (code === ORDER_ERRORS.VERSION_CONFLICT || code === ORDER_ERRORS.STATUS_CONFLICT) throw new Error("amount_adjustment_conflict");
    throw error;
  }
  if (!updated) throw new Error("amount_adjustment_conflict");
  const projectionNote = updated.projection === "projected" ? "" : updated.projection === "no_legacy_row" ? "（演示投影行缺失，已记录告警）" : "（演示投影失败，已记录告警）";
  const result = { ...prepared, status: "EXECUTED", executed_at: stamp, idempotent: false, projection: updated.projection };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_AMOUNT_ADJUSTMENT_EXECUTED", `已修改金额：${prepared.order_code} ${prepared.old_amount}→${prepared.new_amount}${projectionNote}`, stamp),
  ]);
  return result;
}

async function executeKeycardIssue(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const commandId = `admin-card-${actionId}`;
  const command = await getD1().prepare("INSERT OR IGNORE INTO external_commands (id, session_id, tenant_id, hotel_id, case_id, target, operation, idempotency_key, status, request_json, result_json, error_code, retryable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'encoder', 'issue_keycard', ?, 'PENDING', ?, NULL, NULL, 1, ?, ?)").bind(commandId, auth.sessionId, auth.user.tenant_id, auth.user.hotel_id, null, `admin:keycard:${actionId}`, JSON.stringify({ order_id: prepared.order_id, room_number: prepared.room_number }), stamp, stamp).run();
  const result = { ...prepared, status: "EXECUTED", command_id: commandId, executed_at: stamp, idempotent: !command.meta.changes };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_KEYCARD_ISSUE_EXECUTED", `已确认发卡：${prepared.order_code} 房间 ${prepared.room_number}`, stamp),
  ]);
  return result;
}

async function executePoliceSubmission(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const stamp = new Date().toISOString();
  const receipt = `ADMIN-${prepared.region}-${Date.now().toString().slice(-8)}`;
  const commandId = `admin-police-${actionId}`;
  const command = await getD1().prepare("INSERT OR IGNORE INTO external_commands (id, session_id, tenant_id, hotel_id, case_id, target, operation, idempotency_key, status, request_json, result_json, error_code, retryable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'police', 'submit_registration', ?, 'PENDING', ?, NULL, NULL, 1, ?, ?)").bind(commandId, auth.sessionId, auth.user.tenant_id, auth.user.hotel_id, null, `admin:police:${actionId}`, JSON.stringify({ order_id: prepared.order_id, region: prepared.region, room_number: prepared.room_number }), stamp, stamp).run();
  const result = { ...prepared, status: "EXECUTED", command_id: commandId, receipt, executed_at: stamp, idempotent: !command.meta.changes };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(result), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_POLICE_SUBMISSION_EXECUTED", `已确认提交公安登记：${prepared.order_code} 回执 ${receipt}`, stamp),
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
  try {
    if (prepared.action_type === "room_change") return executeRoomChange(auth, action.id, prepared);
    if (prepared.action_type === "amount_adjustment") return executeAmountAdjustment(auth, action.id, prepared);
    if (prepared.action_type === "keycard_issue") return executeKeycardIssue(auth, action.id, prepared);
    if (prepared.action_type === "police_submission") return executePoliceSubmission(auth, action.id, prepared);
    throw new Error("unknown_admin_action_type");
  } catch (error) {
    const message = error instanceof Error ? error.message : "admin_action_failed";
    if (message.endsWith("_conflict")) await markActionConflict(auth, action, prepared, message);
    throw error;
  }
}

async function cancelPendingAction(auth: AdminAuth, actionId: string, reason: string) {
  await ensureActionSchema();
  const existing = await getD1().prepare("SELECT status, expires_at FROM admin_actions WHERE id = ? AND user_id = ? AND hotel_id = ? LIMIT 1").bind(actionId, auth.user.id, auth.user.hotel_id).first<{ status: string; expires_at: string }>();
  if (!existing) throw new Error("admin_action_not_found");
  if (existing.status !== "AWAITING_CONFIRMATION") throw new Error("admin_action_not_confirmable");
  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    const stamp = new Date().toISOString();
    const expired = await getD1().prepare("UPDATE admin_actions SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(stamp, actionId, auth.user.id, auth.user.hotel_id).run();
    if (expired.meta.changes) await auditAdmin(auth.user, "ADMIN_ACTION_EXPIRED", `确认单已过期：${actionId}`, { actionId });
    throw new Error("admin_action_expired");
  }
  const stamp = new Date().toISOString();
  const result = await getD1().prepare("UPDATE admin_actions SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(stamp, actionId, auth.user.id, auth.user.hotel_id).run();
  if (!result.meta.changes) throw new Error("admin_action_not_confirmable");
  await auditAdmin(auth.user, "ADMIN_ACTION_CANCELLED", `已取消待确认动作：${reason}`, { actionId });
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
  if (toolName === "admin.search_guest") return { tool_name: toolName, result: { orders: await searchOrders(parsed.data, auth.user.hotel_id, auth.user.tenant_id) } };
  if (toolName === "admin.get_room_status") return { tool_name: toolName, result: await roomStatus(auth, parsed.data.room_number) };
  if (toolName === "admin.prepare_room_change") return { tool_name: toolName, result: await prepareRoomChange(auth, parsed.data) };
  if (toolName === "admin.prepare_amount_adjustment") return { tool_name: toolName, result: await prepareAmountAdjustment(auth, parsed.data) };
  if (toolName === "admin.prepare_keycard_issue") return { tool_name: toolName, result: await prepareKeycardIssue(auth, parsed.data) };
  if (toolName === "admin.prepare_police_submission") return { tool_name: toolName, result: await preparePoliceSubmission(auth, parsed.data) };
  if (toolName === "admin.confirm_pending_action" || toolName === "admin.confirm_room_change") return { tool_name: toolName, result: await confirmPendingAction(auth, parsed.data.action_id, parsed.data.confirmation) };
  if (toolName === "admin.cancel_pending_action" || toolName === "admin.cancel_room_change") return { tool_name: toolName, result: await cancelPendingAction(auth, parsed.data.action_id, parsed.data.reason) };
  const auditArgs = parsed.data as { limit: number; action_id?: string; event_type?: string };
  const clauses = ["hotel_id = ?"];
  const binds: unknown[] = [auth.user.hotel_id];
  if (auditArgs.action_id) { clauses.push("action_id = ?"); binds.push(auditArgs.action_id); }
  if (auditArgs.event_type) { clauses.push("event_type = ?"); binds.push(auditArgs.event_type); }
  binds.push(auditArgs.limit);
  const rows = await getD1().prepare(`SELECT id, action_id, event_type, detail, username, role, created_at FROM admin_audit_events WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`).bind(...binds).all<Record<string, unknown>>();
  return { tool_name: toolName, result: { events: rows.results } };
}
