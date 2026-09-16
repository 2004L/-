import { getD1 } from "@/db";

export const runtime = "edge";

type RouteContext = { params: Promise<{ action: string }> };
type CaseRow = {
  id: string;
  session_id: string;
  order_id: string;
  mode: string;
  status: string;
  phone_last4: string;
  identity_result: string | null;
  room_number: string | null;
  police_receipt: string | null;
  hardware_status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type CommandRow = {
  id: string;
  target: string;
  operation: string;
  status: string;
  error_code: string | null;
  retryable: number;
  result_json: string | null;
  updated_at: string;
};

const SESSION_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const LAST4_PATTERN = /^\d{4}$/;

const ROOM_TYPE_OPTIONS = [
  { code: "STD-KING", name: "标准大床房", nightlyRate: 260, deposit: 200, available: 3 },
  { code: "DLX-KING", name: "高级大床房", nightlyRate: 380, deposit: 300, available: 2 },
  { code: "DLX-TWIN", name: "豪华双床房", nightlyRate: 420, deposit: 300, available: 1 },
] as const;

const STATE_LABELS: Record<string, string> = {
  ORDER_MATCHED: "订单已匹配",
  IDENTITY_READING: "正在读取身份证",
  IDENTITY_VERIFIED: "身份已核验",
  ROOM_HELD: "房间已锁定",
  POLICE_RUNNING: "公安登记中",
  POLICE_COMPLETED: "公安登记完成",
  PMS_CHECKIN_CONFIRMED: "PMS 已确认入住",
  KEYCARD_WRITING: "正在制作房卡",
  KEYCARD_DISPENSED: "房卡已送达取卡口",
  CHECKIN_COMPLETE: "入住完成",
};

const SEED_ORDERS = [
  ["MT-20260914-4821", "美团", "演示住客甲", "4821", "138****4821", "2026-09-14", 1, "高级大床房", "awaiting_arrival", null],
  ["DY-20260914-6395", "抖音团购", "演示住客乙", "6395", "186****6395", "2026-09-14", 2, "豪华双床房", "awaiting_arrival", null],
  ["WEB-20260915-2178", "酒店官网", "演示住客丙", "2178", "159****2178", "2026-09-15", 1, "高级大床房", "awaiting_arrival", null],
  ["MT-20260913-7366", "美团", "演示住客丁", "7366", "137****7366", "2026-09-13", 2, "高级大床房", "in_house", "1206"],
  ["WALKIN-20260914-9053", "现场办理", "演示住客戊", "9053", "135****9053", "2026-09-14", 1, "标准大床房", "awaiting_arrival", null],
  ["MT-20260914-1188-A", "美团", "演示住客己", "1188", "188****1188", "2026-09-14", 1, "高级大床房", "awaiting_arrival", null],
  ["CTRIP-20260914-1188-B", "携程", "演示住客庚", "1188", "177****1188", "2026-09-14", 1, "豪华双床房", "awaiting_arrival", null],
  ["CTRIP-20260912-4402", "携程", "演示住客辛", "4402", "136****4402", "2026-09-12", 1, "标准大床房", "cancelled", null],
] as const;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function now() {
  return new Date().toISOString();
}

function requireSession(value: unknown) {
  if (typeof value !== "string" || !SESSION_PATTERN.test(value)) {
    throw new Error("invalid_session_id");
  }
  return value;
}

function requireLast4(value: unknown) {
  if (typeof value !== "string" || !LAST4_PATTERN.test(value)) {
    throw new Error("invalid_phone_last4");
  }
  return value;
}

function requireFullPhone(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_phone_number");
  const digitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  const digits = [...value].map((character) => digitMap[character] ?? character).join("").replace(/\D/g, "");
  const phone = digits.match(/1[3-9]\d{9}/)?.[0];
  if (!phone) throw new Error("invalid_phone_number");
  return phone;
}

async function phoneToken(phone: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureWalkInSchema() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS walk_in_drafts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, phone_token TEXT NOT NULL, phone_last4 TEXT NOT NULL, phone_masked TEXT NOT NULL, stay_date TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 1, room_count INTEGER NOT NULL DEFAULT 1, room_type_code TEXT, room_type_name TEXT, nightly_rate INTEGER, room_amount INTEGER, deposit_amount INTEGER, total_amount INTEGER, status TEXT NOT NULL, payment_id TEXT, order_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS walk_in_drafts_session_status_idx ON walk_in_drafts(session_id, status, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS walk_in_payments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, draft_id TEXT NOT NULL, method TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, receipt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS walk_in_payments_draft_uq ON walk_in_payments(draft_id)"),
  ]);
}

function requireUtterance(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_utterance");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 200) throw new Error("invalid_utterance");
  return normalized;
}

function extractLast4(value: string) {
  const digitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  const normalized = [...value].map((character) => digitMap[character] ?? character).join("");
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function redactUtterance(value: string) {
  return value
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证号已隐藏]")
    .replace(/\b1\d{10}\b/g, (phone) => `1** **** ${phone.slice(-4)}`)
    .slice(0, 80);
}

function classifyIntent(utterance: string): { intent: string; label: string; confidence: number; action: string; last4: string | null; answer?: string } {
  const last4 = extractLast4(utterance);
  if (/(房卡|门卡|卡.*(没|未).*出|取卡)/.test(utterance)) {
    return { intent: "query_keycard_status", label: "查询房卡进度", confidence: 0.97, action: "read_hardware_status", last4 };
  }
  if (/(不住了|取消办理|停止办理|算了)/.test(utterance)) {
    return { intent: "cancel_checkin", label: "取消办理", confidence: 0.95, action: "request_confirmation", last4 };
  }
  if (/(早餐|早饭)/.test(utterance)) {
    return { intent: "hotel_policy", label: "咨询早餐", confidence: 0.98, action: "rag_answer", last4, answer: "早餐时间是早上七点到十点。正式接入后，这里会读取当前酒店的知识库配置。" };
  }
  if (/(停车|停车场|车位)/.test(utterance)) {
    return { intent: "hotel_policy", label: "咨询停车", confidence: 0.98, action: "rag_answer", last4, answer: "酒店提供停车服务。正式接入后，我会根据门店政策说明位置、费用和入场方式。" };
  }
  if (/(押金|微信|支付宝|怎么付|支付)/.test(utterance)) {
    return { intent: "payment_policy", label: "咨询支付与押金", confidence: 0.96, action: "rag_answer", last4, answer: "押金和支付方式以当前酒店政策为准。系统会在身份与房态核验后展示微信或支付宝付款页面，不会由AI自行修改金额。" };
  }
  if (/(退房|几点退)/.test(utterance)) {
    return { intent: "hotel_policy", label: "咨询退房", confidence: 0.97, action: "rag_answer", last4, answer: "正式系统会读取订单对应的退房时间；如需延迟退房，我会先查询当天房态和酒店政策。" };
  }
  if (/(没预订|没有预订|现场办理|直接住|到店住)/.test(utterance)) {
    return { intent: "walk_in", label: "现场入住", confidence: 0.96, action: last4 ? "prepare_walk_in" : "collect_phone_last4", last4 };
  }
  if (last4 || /(预订|订了|订房|入住|住店|美团|抖音|携程|官网)/.test(utterance)) {
    return { intent: "query_reservation", label: "查询预订", confidence: last4 ? 0.98 : 0.92, action: last4 ? "search_order" : "collect_phone_last4", last4 };
  }
  return { intent: "general_assistance", label: "一般咨询", confidence: 0.72, action: "clarify_intent", last4 };
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

async function seedSession(sessionId: string) {
  const db = getD1();
  await ensureWalkInSchema();
  const timestamp = now();
  await db
    .prepare("INSERT OR IGNORE INTO demo_sessions (id, hotel_code, city, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(sessionId, "GZ-DEMO-001", "广州", timestamp, timestamp)
    .run();

  await db.batch(
    SEED_ORDERS.map((order, index) =>
      db
        .prepare("INSERT OR IGNORE INTO demo_orders (id, session_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)")
        .bind(
          `${sessionId}-order-${index + 1}`,
          sessionId,
          order[0],
          order[1],
          order[2],
          order[3],
          order[4],
          order[5],
          order[6],
          order[7],
          order[8],
          order[9],
          timestamp,
          timestamp
        )
    )
  );
}

async function snapshot(sessionId: string) {
  const db = getD1();
  const [orders, cases, jobs, audit] = await Promise.all([
    db.prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, updated_at FROM demo_orders WHERE session_id = ? ORDER BY created_at, order_code").bind(sessionId).all(),
    db.prepare("SELECT id, order_id, mode, status, phone_last4, identity_result, room_number, police_receipt, hardware_status, version, updated_at FROM checkin_cases WHERE session_id = ? ORDER BY created_at DESC").bind(sessionId).all(),
    db.prepare("SELECT id, case_id, region, status, attempt, receipt, last_error, updated_at FROM browser_jobs WHERE session_id = ? ORDER BY created_at DESC").bind(sessionId).all(),
    db.prepare("SELECT id, case_id, event_type, from_state, to_state, detail, created_at FROM audit_events WHERE session_id = ? ORDER BY id DESC LIMIT 80").bind(sessionId).all(),
  ]);
  return { orders: orders.results, cases: cases.results, browserJobs: jobs.results, auditEvents: audit.results };
}

type WalkInDraftRow = {
  id: string; session_id: string; phone_token: string; phone_last4: string; phone_masked: string; stay_date: string;
  nights: number; room_count: number; room_type_code: string | null; room_type_name: string | null; nightly_rate: number | null;
  room_amount: number | null; deposit_amount: number | null; total_amount: number | null; status: string; payment_id: string | null;
  order_id: string | null; idempotency_key: string; created_at: string; updated_at: string;
};

type WalkInPaymentRow = {
  id: string; session_id: string; draft_id: string; method: string; amount: number; status: string; idempotency_key: string;
  receipt: string | null; created_at: string; updated_at: string;
};

function serializeDraft(row: WalkInDraftRow) {
  return {
    id: row.id, phone_masked: row.phone_masked, stay_date: row.stay_date, nights: row.nights, room_count: row.room_count,
    room_type_code: row.room_type_code, room_type_name: row.room_type_name, nightly_rate: row.nightly_rate,
    room_amount: row.room_amount, deposit_amount: row.deposit_amount, total_amount: row.total_amount,
    status: row.status, payment_id: row.payment_id, order_id: row.order_id, updated_at: row.updated_at,
  };
}

function roomOption(code: unknown) {
  if (typeof code !== "string") throw new Error("invalid_room_type");
  const option = ROOM_TYPE_OPTIONS.find((item) => item.code === code);
  if (!option) throw new Error("invalid_room_type");
  return option;
}

function positiveInteger(value: unknown, name: string, min: number, max: number) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`invalid_${name}`);
  return number;
}

async function loadDraft(sessionId: string, draftId: unknown) {
  if (typeof draftId !== "string" || draftId.length < 8) throw new Error("invalid_draft_id");
  const row = await getD1().prepare("SELECT * FROM walk_in_drafts WHERE id = ? AND session_id = ?").bind(draftId, sessionId).first<WalkInDraftRow>();
  if (!row) throw new Error("draft_not_found");
  return row;
}

function roomTypes() {
  return ROOM_TYPE_OPTIONS.map((item) => ({ code: item.code, name: item.name, nightly_rate: item.nightlyRate, deposit: item.deposit, available: item.available }));
}

async function audit(sessionId: string, caseId: string | null, eventType: string, fromState: string | null, toState: string | null, detail: string) {
  await getD1()
    .prepare("INSERT INTO audit_events (session_id, case_id, event_type, from_state, to_state, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(sessionId, caseId, eventType, fromState, toState, detail, now())
    .run();
}

async function loadCase(sessionId: string, caseId: unknown) {
  if (typeof caseId !== "string") throw new Error("invalid_case_id");
  const row = await getD1()
    .prepare("SELECT * FROM checkin_cases WHERE id = ? AND session_id = ?")
    .bind(caseId, sessionId)
    .first<CaseRow>();
  if (!row) throw new Error("case_not_found");
  return row;
}

async function transition(options: {
  sessionId: string;
  caseId: unknown;
  expected: string;
  next: string;
  eventType: string;
  detail: string;
  fields?: { identityResult?: string; roomNumber?: string; policeReceipt?: string; hardwareStatus?: string };
}) {
  const current = await loadCase(options.sessionId, options.caseId);
  if (current.status === options.next) return current;
  if (current.status !== options.expected) throw new Error(`invalid_transition:${current.status}:${options.next}`);

  const clauses = ["status = ?", "version = version + 1", "updated_at = ?"];
  const values: unknown[] = [options.next, now()];
  if (options.fields?.identityResult) {
    clauses.push("identity_result = ?");
    values.push(options.fields.identityResult);
  }
  if (options.fields?.roomNumber) {
    clauses.push("room_number = ?");
    values.push(options.fields.roomNumber);
  }
  if (options.fields?.policeReceipt) {
    clauses.push("police_receipt = ?");
    values.push(options.fields.policeReceipt);
  }
  if (options.fields?.hardwareStatus) {
    clauses.push("hardware_status = ?");
    values.push(options.fields.hardwareStatus);
  }
  values.push(current.id, current.version);
  const result = await getD1()
    .prepare(`UPDATE checkin_cases SET ${clauses.join(", ")} WHERE id = ? AND version = ?`)
    .bind(...values)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("concurrent_update");
  await audit(options.sessionId, current.id, options.eventType, current.status, options.next, options.detail);
  return loadCase(options.sessionId, current.id);
}

async function matchOrder(sessionId: string, phoneLast4: string, source?: string) {
  const db = getD1();
  const pending = source
    ? await db.prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? AND source = ? AND status = 'awaiting_arrival' ORDER BY stay_date, order_code").bind(sessionId, phoneLast4, source).all<Record<string, unknown>>()
    : await db.prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? AND status = 'awaiting_arrival' ORDER BY stay_date, order_code").bind(sessionId, phoneLast4).all<Record<string, unknown>>();
  if (pending.results.length > 1) {
    await audit(sessionId, null, "ORDER_MATCH_AMBIGUOUS", null, "MANUAL_SELECTION_REQUIRED", `末四位 ${phoneLast4} 命中 ${pending.results.length} 笔待入住订单`);
    return { outcome: "ambiguous", orders: pending.results };
  }
  if (pending.results.length === 0) {
    const historical = source
      ? await db.prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? AND source = ? ORDER BY updated_at DESC").bind(sessionId, phoneLast4, source).all<Record<string, unknown>>()
      : await db.prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? ORDER BY updated_at DESC").bind(sessionId, phoneLast4).all<Record<string, unknown>>();
    const outcome = historical.results.some((item) => item.status === "in_house")
      ? "already_checked_in"
      : historical.results.some((item) => item.status === "cancelled")
        ? "cancelled"
        : "not_found";
    await audit(sessionId, null, "ORDER_MATCH_BLOCKED", null, outcome.toUpperCase(), `末四位 ${phoneLast4} 未找到可办理订单`);
    return { outcome, orders: historical.results };
  }

  const order = pending.results[0];
  const existing = await db
    .prepare("SELECT * FROM checkin_cases WHERE session_id = ? AND order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(sessionId, order.id)
    .first<CaseRow>();
  if (existing) return { outcome: "matched", order, checkinCase: existing, reused: true };

  const caseId = crypto.randomUUID();
  const timestamp = now();
  await db
    .prepare("INSERT INTO checkin_cases (id, session_id, order_id, mode, status, idempotency_key, phone_last4, identity_result, room_number, police_receipt, hardware_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 1, ?, ?)")
    .bind(caseId, sessionId, order.id, order.source === "现场办理" ? "walk_in" : "reservation", "ORDER_MATCHED", `match:${sessionId}:${order.id}`, phoneLast4, "not_started", timestamp, timestamp)
    .run();
  await audit(sessionId, caseId, "ORDER_MATCHED", null, "ORDER_MATCHED", `精确匹配 ${order.source} 订单 ${order.order_code}`);
  return { outcome: "matched", order, checkinCase: await loadCase(sessionId, caseId), reused: false };
}

async function reconcileCase(sessionId: string, caseId: unknown) {
  const current = await loadCase(sessionId, caseId);
  const db = getD1();
  const [commands, job, lastAudit, order] = await Promise.all([
    db.prepare("SELECT id, target, operation, status, error_code, retryable, result_json, updated_at FROM external_commands WHERE session_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT 20").bind(sessionId, current.id).all<CommandRow>(),
    db.prepare("SELECT id, status, attempt, receipt, last_error, updated_at FROM browser_jobs WHERE session_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT 1").bind(sessionId, current.id).first<{ id: string; status: string; attempt: number; receipt: string | null; last_error: string | null; updated_at: string }>(),
    db.prepare("SELECT id, event_type, from_state, to_state, detail, created_at FROM audit_events WHERE session_id = ? AND case_id = ? ORDER BY id DESC LIMIT 1").bind(sessionId, current.id).first<{ id: number; event_type: string; from_state: string | null; to_state: string | null; detail: string; created_at: string }>(),
    db.prepare("SELECT status, room_number FROM demo_orders WHERE id = ? AND session_id = ?").bind(current.order_id, sessionId).first<{ status: string; room_number: string | null }>(),
  ]);
  const commandList = commands.results;
  const unknownExternal = commandList.find((item) => item.status === "UNKNOWN" || item.status === "RUNNING");
  const lastCommand = commandList[0] ?? null;
  const invariantFailures: string[] = [];
  if (["ROOM_HELD", "POLICE_RUNNING", "POLICE_COMPLETED", "PMS_CHECKIN_CONFIRMED", "KEYCARD_WRITING", "KEYCARD_DISPENSED", "CHECKIN_COMPLETE"].includes(current.status) && current.identity_result !== "verified_demo_token") invariantFailures.push("身份未核验却已进入后续阶段");
  if (["PMS_CHECKIN_CONFIRMED", "KEYCARD_WRITING", "KEYCARD_DISPENSED", "CHECKIN_COMPLETE"].includes(current.status) && !current.police_receipt) invariantFailures.push("没有公安登记回执却已确认入住");
  if (["KEYCARD_WRITING", "KEYCARD_DISPENSED", "CHECKIN_COMPLETE"].includes(current.status) && (!current.room_number || order?.status !== "checkin_confirmed")) invariantFailures.push("房卡阶段缺少已确认的房间或订单状态");
  const consistency = invariantFailures.length === 0;
  const recommendedAction = !consistency || unknownExternal
    ? "manual_verify_external"
    : current.status === "CHECKIN_COMPLETE"
      ? "no_action"
      : lastCommand?.status === "FAILED" && Boolean(lastCommand.retryable)
        ? "retry_current_step"
        : "resume_from_confirmed_state";
  await audit(sessionId, current.id, "FLOW_RECONCILED", current.status, current.status, `自查完成：${consistency ? "状态一致" : invariantFailures.join("；")}；建议 ${recommendedAction}`);
  return {
    ok: consistency && !unknownExternal,
    case_id: current.id,
    current_case: {
      id: current.id,
      order_id: current.order_id,
      mode: current.mode,
      status: current.status,
      identity_result: current.identity_result,
      room_number: current.room_number,
      police_receipt: current.police_receipt,
      hardware_status: current.hardware_status,
      version: current.version,
      updated_at: current.updated_at,
    },
    current_state: current.status,
    current_state_label: STATE_LABELS[current.status] ?? current.status,
    last_command: lastCommand ? { id: lastCommand.id, target: lastCommand.target, operation: lastCommand.operation, status: lastCommand.status, error_code: lastCommand.error_code, retryable: Boolean(lastCommand.retryable), updated_at: lastCommand.updated_at } : null,
    browser_job: job,
    last_audit: lastAudit,
    invariant_failures: invariantFailures,
    unresolved_external_call: unknownExternal ? { id: unknownExternal.id, target: unknownExternal.target, operation: unknownExternal.operation, status: unknownExternal.status, error_code: unknownExternal.error_code } : null,
    recommended_action: recommendedAction,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const { action } = await context.params;
  try {
    if (action !== "bootstrap") return json({ error: "unknown_action" }, 404);
    const sessionId = requireSession(new URL(request.url).searchParams.get("session_id"));
    await seedSession(sessionId);
    return json({ sessionId, ...(await snapshot(sessionId)) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { action } = await context.params;
  try {
    const body = await readBody(request);
    const sessionId = requireSession(body.session_id);
    await seedSession(sessionId);

    if (action === "reset") {
      await getD1().prepare("DELETE FROM walk_in_payments WHERE session_id = ?").bind(sessionId).run();
      await getD1().prepare("DELETE FROM walk_in_drafts WHERE session_id = ?").bind(sessionId).run();
      await getD1().prepare("DELETE FROM demo_sessions WHERE id = ?").bind(sessionId).run();
      await seedSession(sessionId);
      return json({ ok: true, ...(await snapshot(sessionId)) });
    }
    if (action === "reconcile") {
      return json(await reconcileCase(sessionId, body.case_id));
    }
    if (action === "match") {
      return json(await matchOrder(sessionId, requireLast4(body.phone_last4)));
    }
    if (action === "interpret") {
      const utterance = requireUtterance(body.utterance);
      const classified = classifyIntent(utterance);
      const safeExpression = redactUtterance(utterance);
      await audit(sessionId, null, "INTENT_RECOGNIZED", null, classified.intent.toUpperCase(), `表达：“${safeExpression}” → 意图：${classified.label} → 置信度：${Math.round(classified.confidence * 100)}% → 动作：${classified.action}`);

      if (classified.intent === "query_reservation" && classified.last4) {
        const match = await matchOrder(sessionId, classified.last4);
        return json({ ...classified, phone_last4: classified.last4, assistantMessage: "我已经理解您的入住需求，正在查询订单。", ...match });
      }
      if (classified.intent === "walk_in" && classified.last4) {
        return json({ ...classified, phone_last4: classified.last4, outcome: "not_found", assistantMessage: "明白，您要现场办理入住。我已准备创建现场办理单，请确认后继续。" });
      }
      if (classified.action === "collect_phone_last4") {
        await audit(sessionId, null, "INTENT_NEEDS_INFO", classified.intent.toUpperCase(), "WAITING_FOR_PHONE_LAST4", "当前意图缺少订单匹配所需的手机号后四位");
        return json({ ...classified, assistantMessage: "可以，请告诉我预订手机号的后四位，直接说数字就行。" });
      }
      if (classified.intent === "query_keycard_status") {
        const latest = await getD1().prepare("SELECT status, hardware_status FROM checkin_cases WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").bind(sessionId).first<{ status: string; hardware_status: string }>();
        return json({ ...classified, assistantMessage: latest ? `我查到当前办理状态是 ${latest.status}，设备状态是 ${latest.hardware_status}。系统只查询原发卡命令，不会因此重复发卡。` : "目前没有正在办理的入住任务。" });
      }
      if (classified.intent === "cancel_checkin") {
        return json({ ...classified, assistantMessage: "我理解您想停止办理。取消可能涉及退款或解除锁房，需要您再次确认，演示系统不会直接执行。" });
      }
      return json({ ...classified, assistantMessage: classified.answer ?? "可以直接告诉我您想入住、查询订单，或者询问早餐、停车、押金和退房。" });
    }
    if (action === "walk-in-draft") {
      const phone = requireFullPhone(body.phone_number);
      const token = await phoneToken(phone);
      const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.length <= 160 ? body.idempotency_key : `walk-in-draft:${sessionId}:${token}`;
      const existing = await getD1().prepare("SELECT * FROM walk_in_drafts WHERE session_id = ? AND idempotency_key = ?").bind(sessionId, idempotencyKey).first<WalkInDraftRow>();
      if (existing) return json({ ok: true, reused: true, draft: serializeDraft(existing), room_types: roomTypes() });
      const draftId = crypto.randomUUID();
      const timestamp = now();
      await getD1().prepare("INSERT INTO walk_in_drafts (id, session_id, phone_token, phone_last4, phone_masked, stay_date, nights, room_count, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'DRAFT', ?, ?, ?)")
        .bind(draftId, sessionId, token, phone.slice(-4), `1** **** ${phone.slice(-4)}`, timestamp.slice(0, 10), idempotencyKey, timestamp, timestamp).run();
      await audit(sessionId, null, "WALK_IN_DRAFT_CREATED", null, "DRAFT", "已确认完整手机号并创建现场办理草稿；手机号仅保存为掩码和不可逆令牌");
      const draft = await loadDraft(sessionId, draftId);
      return json({ ok: true, reused: false, draft: serializeDraft(draft), room_types: roomTypes() }, 201);
    }
    if (action === "walk-in-quote") {
      const draft = await loadDraft(sessionId, body.draft_id);
      if (!["DRAFT", "QUOTED"].includes(draft.status)) throw new Error(`invalid_draft_status:${draft.status}`);
      const option = roomOption(body.room_type_code);
      const nights = positiveInteger(body.nights, "nights", 1, 30);
      const roomCount = positiveInteger(body.room_count, "room_count", 1, 4);
      if (roomCount > option.available) throw new Error("room_not_available");
      const roomAmount = option.nightlyRate * nights * roomCount;
      const depositAmount = option.deposit * roomCount;
      const totalAmount = roomAmount + depositAmount;
      if (draft.status === "QUOTED" && draft.room_type_code === option.code && draft.nights === nights && draft.room_count === roomCount && draft.total_amount === totalAmount) {
        return json({ ok: true, reused: true, draft: serializeDraft(draft), room_types: roomTypes() });
      }
      const timestamp = now();
      await getD1().prepare("UPDATE walk_in_drafts SET room_type_code = ?, room_type_name = ?, nightly_rate = ?, room_amount = ?, deposit_amount = ?, total_amount = ?, nights = ?, room_count = ?, status = 'QUOTED', updated_at = ? WHERE id = ? AND session_id = ? AND status IN ('DRAFT','QUOTED')")
        .bind(option.code, option.name, option.nightlyRate, roomAmount, depositAmount, totalAmount, nights, roomCount, timestamp, draft.id, sessionId).run();
      await audit(sessionId, null, "WALK_IN_QUOTED", "DRAFT", "QUOTED", `已生成${option.name}报价：${nights}晚、${roomCount}间；金额以后台计算为准，支付前不创建正式订单`);
      const updated = await loadDraft(sessionId, draft.id);
      return json({ ok: true, reused: false, draft: serializeDraft(updated), room_types: roomTypes() });
    }
    if (action === "walk-in-payment") {
      const draft = await loadDraft(sessionId, body.draft_id);
      if (draft.status !== "QUOTED" || !draft.total_amount) throw new Error(`payment_requires_quote:${draft.status}`);
      const method = body.method === "alipay" || body.method === "wechat" ? body.method : null;
      if (!method) throw new Error("invalid_payment_method");
      const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.length <= 160 ? body.idempotency_key : `payment:${draft.id}`;
      const db = getD1();
      const existing = await db.prepare("SELECT * FROM walk_in_payments WHERE draft_id = ?").bind(draft.id).first<WalkInPaymentRow>();
      if (existing) return json({ ok: true, reused: true, draft: serializeDraft(draft), payment: { id: existing.id, method: existing.method, amount: existing.amount, status: existing.status, receipt: existing.receipt, qr_token: `DEMO-${existing.id.slice(0, 8)}` } });
      const paymentId = crypto.randomUUID();
      const timestamp = now();
      await db.prepare("INSERT INTO walk_in_payments (id, session_id, draft_id, method, amount, status, idempotency_key, receipt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NULL, ?, ?)")
        .bind(paymentId, sessionId, draft.id, method, draft.total_amount, idempotencyKey, timestamp, timestamp).run();
      await db.prepare("UPDATE walk_in_drafts SET status = 'AWAITING_PAYMENT', payment_id = ?, updated_at = ? WHERE id = ? AND session_id = ? AND status = 'QUOTED'").bind(paymentId, timestamp, draft.id, sessionId).run();
      await audit(sessionId, null, "PAYMENT_STARTED", "QUOTED", "AWAITING_PAYMENT", `已生成${method === "wechat" ? "微信" : "支付宝"}模拟支付页面；应付金额由报价单锁定`);
      const updated = await loadDraft(sessionId, draft.id);
      return json({ ok: true, reused: false, draft: serializeDraft(updated), payment: { id: paymentId, method, amount: draft.total_amount, status: "PENDING", qr_token: `DEMO-${paymentId.slice(0, 8)}` } }, 201);
    }
    if (action === "walk-in-payment-complete") {
      if (typeof body.payment_id !== "string") throw new Error("invalid_payment_id");
      const db = getD1();
      const payment = await db.prepare("SELECT * FROM walk_in_payments WHERE id = ? AND session_id = ?").bind(body.payment_id, sessionId).first<WalkInPaymentRow>();
      if (!payment) throw new Error("payment_not_found");
      const draft = await loadDraft(sessionId, payment.draft_id);
      if (payment.status === "PAID" && draft.order_id) return json({ ok: true, reused: true, draft: serializeDraft(draft), payment: { id: payment.id, method: payment.method, amount: payment.amount, status: payment.status, receipt: payment.receipt }, ...(await matchOrder(sessionId, draft.phone_last4, "现场办理")) });
      if (payment.status !== "PENDING" || draft.status !== "AWAITING_PAYMENT") throw new Error(`invalid_payment_status:${payment.status}:${draft.status}`);
      const timestamp = now();
      const receipt = `DEMO-PAY-${Date.now().toString().slice(-8)}`;
      const paid = await db.prepare("UPDATE walk_in_payments SET status = 'PAID', receipt = ?, updated_at = ? WHERE id = ? AND session_id = ? AND status = 'PENDING'").bind(receipt, timestamp, payment.id, sessionId).run();
      if ((paid.meta.changes ?? 0) !== 1) throw new Error("concurrent_payment");
      const orderId = crypto.randomUUID();
      const orderCode = `WALKIN-${Date.now()}`;
      await db.prepare("INSERT INTO demo_orders (id, session_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, created_at, updated_at) VALUES (?, ?, ?, '现场办理', '现场演示住客', ?, ?, ?, ?, ?, ?, 'awaiting_arrival', NULL, ?, ?)")
        .bind(orderId, sessionId, orderCode, draft.phone_last4, draft.phone_masked, draft.stay_date, draft.nights, draft.room_count, draft.room_type_name ?? "标准大床房", timestamp, timestamp).run();
      await db.prepare("UPDATE walk_in_drafts SET status = 'ORDER_CREATED', order_id = ?, updated_at = ? WHERE id = ? AND session_id = ? AND status = 'AWAITING_PAYMENT'").bind(orderId, timestamp, draft.id, sessionId).run();
      await audit(sessionId, null, "PAYMENT_CONFIRMED", "AWAITING_PAYMENT", "PAID", `模拟支付成功，回执 ${receipt}`);
      await audit(sessionId, null, "WALK_IN_ORDER_CREATED", "PAID", "ORDER_CREATED", `支付成功后创建现场订单 ${orderCode}；未支付不会创建正式订单`);
      const matched = await matchOrder(sessionId, draft.phone_last4, "现场办理");
      const updated = await loadDraft(sessionId, draft.id);
      return json({ ok: true, reused: false, draft: serializeDraft(updated), payment: { id: payment.id, method: payment.method, amount: payment.amount, status: "PAID", receipt }, ...matched }, 201);
    }
    if (action === "walk-in") {
      const phoneLast4 = requireLast4(body.phone_last4);
      const existing = await getD1().prepare("SELECT id FROM demo_orders WHERE session_id = ? AND source = '现场办理' AND phone_last4 = ? AND status = 'awaiting_arrival' ORDER BY created_at DESC LIMIT 1").bind(sessionId, phoneLast4).first<{ id: string }>();
      if (existing) return json(await matchOrder(sessionId, phoneLast4, "现场办理"));
      const orderId = crypto.randomUUID();
      const timestamp = now();
      await getD1()
        .prepare("INSERT INTO demo_orders (id, session_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, created_at, updated_at) VALUES (?, ?, ?, '现场办理', '现场演示住客', ?, ?, ?, 1, 1, '标准大床房', 'awaiting_arrival', NULL, ?, ?)")
        .bind(orderId, sessionId, `WALKIN-${Date.now()}`, phoneLast4, `1** **** ${phoneLast4}`, timestamp.slice(0, 10), timestamp, timestamp)
        .run();
      await audit(sessionId, null, "WALK_IN_CREATED", null, "AWAITING_ARRIVAL", `已创建末四位 ${phoneLast4} 的现场演示订单`);
      return json(await matchOrder(sessionId, phoneLast4, "现场办理"), 201);
    }
    if (action === "verify-identity") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "IDENTITY_READING", next: "IDENTITY_VERIFIED", eventType: "IDENTITY_VERIFIED", detail: "读卡器自动读取与实名核验通过；仅保存演示身份 Token，不存储真实证件字段", fields: { identityResult: "verified_demo_token", hardwareStatus: "identity_read_verified" } });
      return json({ checkinCase: updated });
    }
    if (action === "identity-detected") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "ORDER_MATCHED", next: "IDENTITY_READING", eventType: "IDENTITY_CARD_DETECTED", detail: "读卡器检测到新放置的身份证；已通过遗留证件、重复读卡和会话归属模拟检查", fields: { hardwareStatus: "identity_card_detected" } });
      return json({ checkinCase: updated });
    }
    if (action === "hold-room") {
      const roomNumber = typeof body.room_number === "string" && /^\d{3,5}$/.test(body.room_number) ? body.room_number : "1208";
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "IDENTITY_VERIFIED", next: "ROOM_HELD", eventType: "ROOM_HELD", detail: `模拟 PMS 已临时锁定 ${roomNumber} 房`, fields: { roomNumber } });
      await getD1().prepare("UPDATE demo_orders SET room_number = ?, updated_at = ? WHERE id = ? AND session_id = ?").bind(roomNumber, now(), updated.order_id, sessionId).run();
      return json({ checkinCase: updated });
    }
    if (action === "browser-start") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "ROOM_HELD", next: "POLICE_RUNNING", eventType: "POLICE_BROWSER_STARTED", detail: "广州隔离演示浏览器已启动；未连接真实公安系统" });
      const jobId = crypto.randomUUID();
      const timestamp = now();
      await getD1().prepare("INSERT OR IGNORE INTO browser_jobs (id, session_id, case_id, region, status, attempt, receipt, last_error, created_at, updated_at) VALUES (?, ?, ?, '广州-演示隔离环境', 'running', 1, NULL, NULL, ?, ?)").bind(jobId, sessionId, updated.id, timestamp, timestamp).run();
      return json({ checkinCase: updated });
    }
    if (action === "browser-complete") {
      const current = await loadCase(sessionId, body.case_id);
      const receipt = current.police_receipt ?? `DEMO-GZ-${Date.now().toString().slice(-8)}`;
      const updated = await transition({ sessionId, caseId: current.id, expected: "POLICE_RUNNING", next: "POLICE_COMPLETED", eventType: "POLICE_DEMO_COMPLETED", detail: "模拟登记回执完成；满足 PMS 入住确认的前置条件", fields: { policeReceipt: receipt } });
      await getD1().prepare("UPDATE browser_jobs SET status = 'completed', receipt = ?, updated_at = ? WHERE case_id = ? AND session_id = ?").bind(receipt, now(), updated.id, sessionId).run();
      return json({ checkinCase: updated, receipt });
    }
    if (action === "confirm-checkin") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "POLICE_COMPLETED", next: "PMS_CHECKIN_CONFIRMED", eventType: "PMS_CHECKIN_CONFIRMED", detail: "模拟 PMS 入住确认成功；已核对订单、房间和登记回执" });
      await getD1().prepare("UPDATE demo_orders SET status = 'checkin_confirmed', updated_at = ? WHERE id = ? AND session_id = ?").bind(now(), updated.order_id, sessionId).run();
      return json({ checkinCase: updated });
    }
    if (action === "keycard-start") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "PMS_CHECKIN_CONFIRMED", next: "KEYCARD_WRITING", eventType: "KEYCARD_WRITE_STARTED", detail: "自动发卡机已锁定一个空白卡槽，并按房号和有效期开始写卡", fields: { hardwareStatus: "keycard_writing" } });
      return json({ checkinCase: updated });
    }
    if (action === "keycard-complete") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "KEYCARD_WRITING", next: "KEYCARD_DISPENSED", eventType: "KEYCARD_DISPENSED", detail: "房卡写入后已回读校验，发卡机出卡传感器确认卡片到达取卡口", fields: { hardwareStatus: "keycard_dispensed" } });
      await getD1().prepare("UPDATE demo_orders SET status = 'in_house', updated_at = ? WHERE id = ? AND session_id = ?").bind(now(), updated.order_id, sessionId).run();
      return json({ checkinCase: updated });
    }
    if (action === "pickup-confirmed") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "KEYCARD_DISPENSED", next: "CHECKIN_COMPLETE", eventType: "CARDS_COLLECTED", detail: "取卡口和身份证读卡器传感器均已清空，确认客人取走房卡与身份证", fields: { hardwareStatus: "identity_and_keycard_collected" } });
      return json({ checkinCase: updated });
    }
    return json({ error: "unknown_action" }, 404);
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : "internal_error";
  if (message === "invalid_json" || message.startsWith("invalid_") || message === "room_not_available" || message.startsWith("payment_requires_quote") || message.startsWith("invalid_draft_status")) return json({ error: message }, 400);
  if (message === "case_not_found" || message === "draft_not_found" || message === "payment_not_found") return json({ error: message }, 404);
  if (message === "concurrent_update" || message === "concurrent_payment") return json({ error: message, error_code: "CONCURRENT_UPDATE", retryable: true }, 409);
  if (message.startsWith("invalid_transition")) {
    const [, currentState, expectedNext] = message.split(":");
    return json({ error: "invalid_transition", error_code: "INVALID_TRANSITION", current_state: currentState, expected_next: expectedNext, retryable: false }, 409);
  }
  console.error("demo_api_error", message);
  return json({ error: "internal_error", error_code: "INTERNAL_ERROR", retryable: false }, 500);
}
