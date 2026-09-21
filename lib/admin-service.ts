import { getD1 } from "@/db";
import { adminToolArgumentSchemas, adminToolPermissions, type AdminPermission, type AdminToolName } from "@/lib/admin-tools";
import { auditAdmin, hasPermission, type AdminUser } from "@/lib/admin-auth";
import { syncLegacyCore } from "@/lib/legacy-core-sync";
import { ORDER_ERRORS, updateOrderAmount, type OrderAmountType } from "@/lib/orders";
import { syncPmsRoomCatalog } from "@/lib/pms-core-sync";
import { markRoomCleanWith } from "@/lib/checkout-core";
import { d1SqlRunner } from "@/lib/orders";
import { RETENTION_RANGE_LABELS, isRetentionRange, previewClosedLoopPurge, purgeClosedLoopsWith, type RetentionRange } from "@/lib/retention-core";
import { listTablesWith, previewTableWith } from "@/lib/database-view-core";
import { demoOrderReconcileAllStatement, demoOrderReconcileCountStatement } from "@/lib/legacy-projection-core";
import { INHOUSE_DDL, SERVICE_NEED_LABELS, listInHouseWith, setServiceNeedWith, type ServiceNeed } from "@/lib/inhouse-core";
import { d1ListRunner } from "@/lib/folio";
import { getKnowledgeDocument, listKnowledgeDocuments, saveKnowledgeDraft, setKnowledgeStatus, askKnowledge } from "@/lib/knowledge";
import {
  KNOWLEDGE_ADMIN_ERRORS,
  KNOWLEDGE_AUTHORITY_LABELS,
  KNOWLEDGE_SOURCE_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_VISIBILITY_LABELS,
  normalizeKnowledgeDraft,
  type KnowledgeAuthority,
  type KnowledgeDraft,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeVisibility,
} from "@/lib/knowledge-admin-core";

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
  // Same lazy-bootstrap style as the rest of this file: the table is also in
  // drizzle/0017, this only covers a database that never ran the migration.
  await getD1().batch(INHOUSE_DDL.map((sql) => getD1().prepare(sql)));
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
  action_type: "room_change" | "amount_adjustment" | "keycard_issue" | "police_submission" | "purge_closed_loops" | "knowledge_document_save" | "knowledge_document_status";
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

/**
 * Housekeeping confirms the room is clean. This is the only writer that can make
 * a dirty room sellable again, and the room state machine allows nothing but
 * VACANT_DIRTY -> VACANT_CLEAN, so an occupied or held room cannot be declared
 * clean by mistake. No confirmation dialog: the action is reversible
 * (VACANT_CLEAN -> VACANT_DIRTY) and its whole risk is already fenced by the
 * state machine, while the audit trail records who said the room was ready.
 */
async function markRoomClean(auth: AdminAuth, args: { room_number: string; reason?: string }) {
  const formal = await ensureFormalCore(auth);
  if (!formal) throw new Error("formal_core_unavailable");
  // A room that only exists in the legacy projection has no row to transition.
  try { await syncPmsRoomCatalog({ tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id, hotelCode: auth.user.hotel_code }); } catch { /* PMS catalog is best effort; the transition below stays authoritative */ }
  const cleaned = await markRoomCleanWith(d1SqlRunner(), {
    hotelId: auth.user.hotel_id,
    roomNumber: args.room_number,
    requestId: `${auth.sessionId}:clean:${args.room_number}`,
  });
  const fromLabel = cleaned.fromStatus === 1 ? "待清洁" : cleaned.fromStatus === 2 ? "已锁房（这间房的锁房没有被消耗，一并释放）" : cleaned.fromStatus === 0 ? "已是可售" : `状态 ${cleaned.fromStatus}`;
  await auditAdmin(auth.user, "ADMIN_ROOM_MARKED_CLEAN", `客房 ${args.room_number} 回到可售（${fromLabel} → 可售）${cleaned.idempotent ? "，重复确认，未重复写房态流水" : ""}。理由：${args.reason ?? "客房打扫完成"}`);
  return { room_number: args.room_number, room_status: cleaned.roomStatus, idempotent: cleaned.idempotent };
}

/**
 * Retention cleanup. This one deletes history, so it is the strictest case of the
 * prepare/confirm rule: the window and the row counts are frozen into the pending
 * action, and the executor deletes exactly that window instead of recomputing
 * "now" — what the operator read is what gets removed. Stays that are still in
 * house are never in the set (see lib/retention-core.ts).
 */
async function preparePurge(auth: AdminAuth, args: { range: RetentionRange; reason: string }) {
  if (!isRetentionRange(args.range)) throw new Error("retention_range_invalid");
  const preview = await previewClosedLoopPurge(d1SqlRunner(), { hotelId: auth.user.hotel_id, range: args.range });
  const label = RETENTION_RANGE_LABELS[args.range];
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_purge_closed_loops", args, {
    action_id: id,
    action_type: "purge_closed_loops",
    title: `确认清理${label}的已退房记录吗？`,
    risk_level: "high",
    required_permission: "admin:purge_data",
    order_id: "",
    order_code: "（批量操作，涉及多笔订单）",
    guest: { label: "已退房的历史记录", phone: "不适用" },
    fields: [
      { label: "时间范围", value: `${label}（${preview.windowStart.slice(0, 10)} 至 ${preview.windowEnd.slice(0, 10)}）` },
      { label: "将删除入住记录", value: `${preview.stays} 笔已退房` },
      { label: "连带删除", value: `${preview.folios} 个账本、${preview.ledgerEntries} 条分录、${preview.reservations} 笔预订、${preview.orders} 笔订单` },
      { label: "涉及房间", value: preview.rooms.length ? preview.rooms.join("、") : "无" },
      { label: "同时复位演示订单", value: `${preview.demoOrdersReleased} 笔（回到待入住）` },
    ],
    impacts: [
      "这是不可撤销的删除，删掉的记录无法在系统内找回",
      "只删已退房的闭环；在住客人的入住记录与账本不受影响",
      "房态和房间档案不会被修改，房间当前状态保持不变",
    ],
    confirm_label: "确认清理",
    cancel_label: "取消",
    reason: args.reason,
    range: args.range,
    window_start: preview.windowStart,
    window_end: preview.windowEnd,
    preview,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_RETENTION_PREPARED", `已生成数据清理确认单：${label}，将删除 ${preview.stays} 笔已退房记录`);
}

async function executePurge(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const range = String(prepared.range ?? "");
  if (!isRetentionRange(range)) throw new Error("retention_range_invalid");
  const result = await purgeClosedLoopsWith(d1SqlRunner(), {
    hotelId: auth.user.hotel_id,
    range,
    windowStart: String(prepared.window_start ?? ""),
    windowEnd: String(prepared.window_end ?? ""),
    requestId: actionId,
  });
  const stamp = new Date().toISOString();
  const executed = { ...prepared, status: "EXECUTED" as const, executed_at: stamp, idempotent: false, result };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(executed), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_RETENTION_EXECUTED", `已清理${RETENTION_RANGE_LABELS[range]}的已退房记录：入住记录 ${result.stays} 笔、账本 ${result.folios} 个、分录 ${result.ledgerEntries} 条、预订 ${result.reservations} 笔、订单 ${result.orders} 笔`, stamp),
  ]);
  return executed;
}

/**
 * Bring every session's demo copy back in line with the bookings. The console reads
 * the demo copy, so a session nobody opens again would otherwise keep showing guests
 * who already checked out. Only bookings the guest cannot return from are mirrored,
 * so nothing that is midway through a check-in gets rolled back.
 */
async function reconcileDemoOrders(auth: AdminAuth) {
  const countStatement = demoOrderReconcileCountStatement({ hotelId: auth.user.hotel_id });
  const before = await getD1().prepare(countStatement.sql).bind(...countStatement.params).first<{ c: number }>();
  const statement = demoOrderReconcileAllStatement({ hotelId: auth.user.hotel_id, stamp: new Date().toISOString() });
  const result = await getD1().prepare(statement.sql).bind(...statement.params).run();
  const changed = Number(result.meta?.changes ?? 0);
  await auditAdmin(auth.user, "ADMIN_DEMO_ORDERS_RECONCILED", `已把演示界面拉回真账：修正 ${changed} 笔假订单的状态与房号（修正前不一致 ${Number(before?.c ?? 0)} 笔）`);
  return { updated: changed, drifted_before: Number(before?.c ?? 0), consistent_now: Number(before?.c ?? 0) - changed };
}

/** Read-only: what the database actually holds, table by table. */
async function getDatabaseSchema() {
  return { tables: await listTablesWith(d1ListRunner()) };
}

/** Read-only preview of one table. Table names are validated against sqlite_master. */
async function getTableRows(args: { table: string; limit?: number }) {
  return previewTableWith(d1ListRunner(), { table: args.table, limit: args.limit });
}

/** Read-only: who is in the building, with their room, their money and their needs. */
async function listInHouseGuests(auth: AdminAuth) {
  const guests = await listInHouseWith(d1ListRunner(), { hotelId: auth.user.hotel_id });
  return { guests, pending_service: guests.filter((guest) => guest.serviceNeed !== "none").length };
}

/**
 * "This room needs something." Deliberately a direct write with no confirmation
 * dialog, for the same reason as room cleaning: it is a reversible note, it never
 * touches money or room state, and the audit line records who said it. Refusing to
 * let the front desk record "the guest asked for towels" would push that knowledge
 * out of the system entirely.
 */
async function setRoomServiceNeed(auth: AdminAuth, args: { room_number: string; need: ServiceNeed; note?: string }) {
  const stay = await getD1().prepare("SELECT s.id AS stay_id FROM stays s JOIN reservation_rooms rr ON rr.hotel_id = s.hotel_id AND rr.reservation_id = s.reservation_id JOIN rooms rm ON rm.id = rr.room_id AND rm.hotel_id = rr.hotel_id WHERE s.hotel_id = ? AND s.status = 2 AND rm.room_number = ? LIMIT 1").bind(auth.user.hotel_id, args.room_number).first<{ stay_id: string }>();
  const result = await setServiceNeedWith(d1SqlRunner(), {
    tenantId: auth.user.tenant_id,
    hotelId: auth.user.hotel_id,
    roomNumber: args.room_number,
    need: args.need,
    note: args.note ?? null,
    actor: auth.user.username,
    stayId: stay?.stay_id ?? null,
  });
  await auditAdmin(auth.user, "ADMIN_ROOM_SERVICE_NEED", `客房 ${args.room_number} 服务需求更新为「${SERVICE_NEED_LABELS[args.need]}」${args.note ? `，备注：${args.note}` : ""}`);
  return result;
}

/** 政策录入：店长自己维护门店政策，但「客人会拿到的答案」必须过一次人工确认。 */
type KnowledgeDocumentArgs = {
  document_id?: string; title: string; source: KnowledgeSource; authority: KnowledgeAuthority; visibility: KnowledgeVisibility;
  version?: number; effective_from: string; effective_to?: string; status: KnowledgeStatus; chunks: string[]; keywords?: string; reason: string;
};

/** 只读：这家店有哪些政策、各自什么状态、有几条切片。 */
async function listKnowledgeDocumentsForAdmin(auth: AdminAuth) {
  const documents = await listKnowledgeDocuments(auth.user.hotel_id);
  return {
    documents,
    active: documents.filter((item) => item.status === "active").length,
    guest_visible: documents.filter((item) => item.visibility === "guest" && item.status === "active").length,
  };
}

async function getKnowledgeDocumentForAdmin(auth: AdminAuth, documentId: string) {
  try {
    return await getKnowledgeDocument(auth.user.hotel_id, documentId);
  } catch (error) {
    if (error instanceof Error && error.message === KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND) throw new Error("knowledge_document_not_found");
    throw error;
  }
}

/**
 * 试问：店长写完一条政策，最该问的是「客人这么问，系统会答什么」。
 * 它和终端走同一条检索路径（同一个 askKnowledge），所以看到的答案就是客人会看到的答案。
 */
async function previewKnowledgeAnswer(auth: AdminAuth, args: { query: string; visibility: KnowledgeVisibility }) {
  const allow: KnowledgeVisibility[] = args.visibility === "staff" ? ["guest", "staff"] : ["guest"];
  const answer = await askKnowledge({ hotelId: auth.user.hotel_id, query: args.query, allow });
  return {
    query: answer.query,
    answer: answer.answer,
    needs_handoff: answer.needsHandoff,
    confidence: Number(answer.confidence.toFixed(3)),
    citations: answer.citations,
    hits: answer.hits.slice(0, 5).map((hit) => ({ document_id: hit.documentId, title: hit.title, version: hit.version, coverage: Number(hit.coverage.toFixed(3)), pair_matched: hit.pairMatched })),
  };
}

function knowledgeDraftFromArgs(args: KnowledgeDocumentArgs): KnowledgeDraft {
  return normalizeKnowledgeDraft({
    documentId: args.document_id,
    title: args.title,
    source: args.source,
    authority: args.authority,
    visibility: args.visibility,
    version: args.version,
    effectiveFrom: args.effective_from,
    effectiveTo: args.effective_to,
    status: args.status,
    chunks: args.chunks,
    keywords: args.keywords,
  });
}

async function prepareKnowledgeDocument(auth: AdminAuth, args: KnowledgeDocumentArgs) {
  const draft = knowledgeDraftFromArgs(args);
  const before = draft.documentId ? await getKnowledgeDocumentForAdmin(auth, draft.documentId) : null;
  const nextVersion = draft.version ?? (before ? before.version + 1 : 1);
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_knowledge_document", args as unknown as Record<string, unknown>, {
    action_id: id,
    action_type: "knowledge_document_save",
    title: before ? `确认把「${draft.title}」改到 v${nextVersion} 吗？` : `确认新建政策「${draft.title}」吗？`,
    risk_level: "high",
    required_permission: "admin:manage_knowledge",
    order_id: "",
    order_code: "（门店政策，不涉及订单）",
    guest: { label: draft.visibility === "guest" ? "所有客人都会看到" : "仅员工可见", phone: "不适用" },
    fields: [
      { label: "文档", value: `${draft.title}（${before ? `v${before.version} → v${nextVersion}` : `新建 v${nextVersion}`}）` },
      { label: "来源 / 权威度", value: `${KNOWLEDGE_SOURCE_LABELS[draft.source]} · ${KNOWLEDGE_AUTHORITY_LABELS[draft.authority]}` },
      { label: "可见范围", value: KNOWLEDGE_VISIBILITY_LABELS[draft.visibility] },
      { label: "生效期", value: `${draft.effectiveFrom.slice(0, 10)} 至 ${draft.effectiveTo ? draft.effectiveTo.slice(0, 10) : "长期有效"}` },
      { label: "切片", value: before ? `${before.chunks} 条 → ${draft.chunks.length} 条` : `${draft.chunks.length} 条` },
      { label: "其他说法（进索引）", value: draft.keywords.length ? draft.keywords.join(" ") : "未填" },
    ],
    impacts: [
      "确认后客人问到时立刻按新版本回答，旧版本切片会被整篇替换（不留半新半旧）",
      draft.visibility === "guest" ? "这条政策会直接作为客人可见答案与出处出现在终端" : "这条政策只有员工身份能检索到，客人问不到",
      draft.status === "active" ? "文档状态为生效中，时间与可见范围都满足时立即可检索" : `文档状态为${KNOWLEDGE_STATUS_LABELS[draft.status]}，客人暂时检索不到`,
      "写入管理员审计：谁、什么时候、改了哪份文档的哪一版",
    ],
    confirm_label: before ? "确认发布新版本" : "确认新建",
    cancel_label: "取消",
    reason: args.reason,
    knowledge: draft,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_KNOWLEDGE_DOCUMENT_PREPARED", before
    ? `已生成政策改版确认单：${draft.title} v${before.version} → v${nextVersion}（${draft.chunks.length} 条切片）`
    : `已生成政策新建确认单：${draft.title}（${draft.chunks.length} 条切片，${KNOWLEDGE_VISIBILITY_LABELS[draft.visibility]}）`);
}

async function prepareKnowledgeStatus(auth: AdminAuth, args: { document_id: string; status: KnowledgeStatus; reason: string }) {
  const before = await getKnowledgeDocumentForAdmin(auth, args.document_id);
  if (before.status === args.status) throw new Error("knowledge_status_unchanged");
  const id = crypto.randomUUID();
  return createPreparedAction(auth, "admin.prepare_knowledge_status", args as unknown as Record<string, unknown>, {
    action_id: id,
    action_type: "knowledge_document_status",
    title: `确认把「${before.title}」改为${KNOWLEDGE_STATUS_LABELS[args.status]}吗？`,
    risk_level: "high",
    required_permission: "admin:manage_knowledge",
    order_id: "",
    order_code: "（门店政策，不涉及订单）",
    guest: { label: before.visibility === "guest" ? "客人可见文档" : "仅员工可见", phone: "不适用" },
    fields: [
      { label: "文档", value: `${before.title}（v${before.version}，${before.chunks} 条切片）` },
      { label: "状态", value: `${KNOWLEDGE_STATUS_LABELS[before.status as KnowledgeStatus] ?? before.status} → ${KNOWLEDGE_STATUS_LABELS[args.status]}` },
    ],
    impacts: args.status === "active"
      ? ["重新生效：客人问到时可以再次命中这条政策", "切片没有删除，恢复的就是原来那一版内容"]
      : ["客人问到时不再命中这条政策，检索不到就转人工", "切片保留：改回来还能用，不会丢内容"],
    confirm_label: "确认修改状态",
    cancel_label: "取消",
    reason: args.reason,
    document_id: args.document_id,
    document_status: args.status,
    expires_at: "",
    status: "AWAITING_CONFIRMATION",
  }, "ADMIN_KNOWLEDGE_STATUS_PREPARED", `已生成政策状态确认单：${before.title} ${before.status} → ${args.status}`);
}

async function executeKnowledgeDocumentSave(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const draft = prepared.knowledge as KnowledgeDraft;
  const result = await saveKnowledgeDraft({ tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id, hotelCode: auth.user.hotel_code, draft });
  const stamp = new Date().toISOString();
  const executed = { ...prepared, status: "EXECUTED" as const, executed_at: stamp, idempotent: false, result };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(executed), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_KNOWLEDGE_DOCUMENT_SAVED", `${result.created ? "新建" : "改版"}门店政策「${draft.title}」v${result.version}，${result.chunks} 条切片，${KNOWLEDGE_VISIBILITY_LABELS[draft.visibility]}${result.previous ? `（原 v${result.previous.version}）` : ""}`, stamp),
  ]);
  return executed;
}

async function executeKnowledgeDocumentStatus(auth: AdminAuth, actionId: string, prepared: PreparedAction) {
  const status = String(prepared.document_status ?? "");
  if (status !== "active" && status !== "draft" && status !== "retired") throw new Error(KNOWLEDGE_ADMIN_ERRORS.STATUS_INVALID);
  const documentId = String(prepared.document_id ?? "");
  const result = await setKnowledgeStatus({ hotelId: auth.user.hotel_id, documentId, status });
  const stamp = new Date().toISOString();
  const executed = { ...prepared, status: "EXECUTED" as const, executed_at: stamp, idempotent: false, result };
  await getD1().batch([
    getD1().prepare("UPDATE admin_actions SET status = 'EXECUTED', result_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND hotel_id = ? AND status = 'AWAITING_CONFIRMATION'").bind(JSON.stringify(executed), stamp, actionId, auth.user.id, auth.user.hotel_id),
    getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(auth.user.id, auth.user.tenant_id, auth.user.hotel_id, actionId, auth.user.username, auth.user.role, "ADMIN_KNOWLEDGE_STATUS_CHANGED", `门店政策「${result.documentId}」状态改为 ${KNOWLEDGE_STATUS_LABELS[status]}（原 ${result.previousStatus}）`, stamp),
  ]);
  return executed;
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
    if (prepared.action_type === "purge_closed_loops") return executePurge(auth, action.id, prepared);
    if (prepared.action_type === "knowledge_document_save") return executeKnowledgeDocumentSave(auth, action.id, prepared);
    if (prepared.action_type === "knowledge_document_status") return executeKnowledgeDocumentStatus(auth, action.id, prepared);
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
  if (toolName === "admin.mark_room_clean") return { tool_name: toolName, result: await markRoomClean(auth, parsed.data) };
  if (toolName === "admin.prepare_purge_closed_loops") return { tool_name: toolName, result: await preparePurge(auth, parsed.data) };
  if (toolName === "admin.reconcile_demo_orders") return { tool_name: toolName, result: await reconcileDemoOrders(auth) };
  if (toolName === "admin.get_database_schema") return { tool_name: toolName, result: await getDatabaseSchema() };
  if (toolName === "admin.get_table_rows") return { tool_name: toolName, result: await getTableRows(parsed.data) };
  if (toolName === "admin.list_in_house_guests") return { tool_name: toolName, result: await listInHouseGuests(auth) };
  if (toolName === "admin.set_room_service_need") return { tool_name: toolName, result: await setRoomServiceNeed(auth, parsed.data) };
  if (toolName === "admin.list_knowledge_documents") return { tool_name: toolName, result: await listKnowledgeDocumentsForAdmin(auth) };
  if (toolName === "admin.get_knowledge_document") return { tool_name: toolName, result: await getKnowledgeDocumentForAdmin(auth, parsed.data.document_id) };
  if (toolName === "admin.preview_knowledge_answer") return { tool_name: toolName, result: await previewKnowledgeAnswer(auth, parsed.data) };
  if (toolName === "admin.prepare_knowledge_document") return { tool_name: toolName, result: await prepareKnowledgeDocument(auth, parsed.data) };
  if (toolName === "admin.prepare_knowledge_status") return { tool_name: toolName, result: await prepareKnowledgeStatus(auth, parsed.data) };
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
