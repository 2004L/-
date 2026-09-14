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

const SESSION_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const LAST4_PATTERN = /^\d{4}$/;

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

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

async function seedSession(sessionId: string) {
  const db = getD1();
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

async function matchOrder(sessionId: string, phoneLast4: string) {
  const db = getD1();
  const pending = await db
    .prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? AND status = 'awaiting_arrival' ORDER BY stay_date, order_code")
    .bind(sessionId, phoneLast4)
    .all<Record<string, unknown>>();
  if (pending.results.length > 1) {
    await audit(sessionId, null, "ORDER_MATCH_AMBIGUOUS", null, "MANUAL_SELECTION_REQUIRED", `末四位 ${phoneLast4} 命中 ${pending.results.length} 笔待入住订单`);
    return { outcome: "ambiguous", orders: pending.results };
  }
  if (pending.results.length === 0) {
    const historical = await db
      .prepare("SELECT id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number FROM demo_orders WHERE session_id = ? AND phone_last4 = ? ORDER BY updated_at DESC")
      .bind(sessionId, phoneLast4)
      .all<Record<string, unknown>>();
    const ready = historical.results.find((item) => item.status === "ready_for_hardware");
    if (ready) {
      const existing = await db
        .prepare("SELECT * FROM checkin_cases WHERE session_id = ? AND order_id = ? AND status = 'READY_FOR_ONSITE_HANDOFF' ORDER BY created_at DESC LIMIT 1")
        .bind(sessionId, ready.id)
        .first<CaseRow>();
      if (existing) return { outcome: "matched", order: ready, checkinCase: existing, reused: true };
    }
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
      await getD1().prepare("DELETE FROM demo_sessions WHERE id = ?").bind(sessionId).run();
      await seedSession(sessionId);
      return json({ ok: true, ...(await snapshot(sessionId)) });
    }
    if (action === "match") {
      return json(await matchOrder(sessionId, requireLast4(body.phone_last4)));
    }
    if (action === "walk-in") {
      const phoneLast4 = requireLast4(body.phone_last4);
      const orderId = crypto.randomUUID();
      const timestamp = now();
      await getD1()
        .prepare("INSERT INTO demo_orders (id, session_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, created_at, updated_at) VALUES (?, ?, ?, '现场办理', '现场演示住客', ?, ?, ?, 1, 1, '标准大床房', 'awaiting_arrival', NULL, ?, ?)")
        .bind(orderId, sessionId, `WALKIN-${Date.now()}`, phoneLast4, `1** **** ${phoneLast4}`, timestamp.slice(0, 10), timestamp, timestamp)
        .run();
      await audit(sessionId, null, "WALK_IN_CREATED", null, "AWAITING_ARRIVAL", `已创建末四位 ${phoneLast4} 的现场演示订单`);
      return json(await matchOrder(sessionId, phoneLast4), 201);
    }
    if (action === "verify-identity") {
      const updated = await transition({ sessionId, caseId: body.case_id, expected: "ORDER_MATCHED", next: "IDENTITY_VERIFIED", eventType: "IDENTITY_VERIFIED", detail: "模拟身份证读卡与实名核验通过；未存储真实证件字段", fields: { identityResult: "verified_demo_token" } });
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
      const updated = await transition({ sessionId, caseId: current.id, expected: "POLICE_RUNNING", next: "READY_FOR_ONSITE_HANDOFF", eventType: "POLICE_DEMO_COMPLETED", detail: "模拟登记回执完成，流程停在现场人员发卡前", fields: { policeReceipt: receipt, hardwareStatus: "onsite_team_required" } });
      await getD1().prepare("UPDATE browser_jobs SET status = 'completed', receipt = ?, updated_at = ? WHERE case_id = ? AND session_id = ?").bind(receipt, now(), updated.id, sessionId).run();
      await getD1().prepare("UPDATE demo_orders SET status = 'ready_for_hardware', updated_at = ? WHERE id = ? AND session_id = ?").bind(now(), updated.order_id, sessionId).run();
      return json({ checkinCase: updated, receipt });
    }
    return json({ error: "unknown_action" }, 404);
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : "internal_error";
  if (message === "invalid_json" || message.startsWith("invalid_")) return json({ error: message }, 400);
  if (message === "case_not_found") return json({ error: message }, 404);
  if (message === "concurrent_update" || message.startsWith("invalid_transition")) return json({ error: message }, 409);
  console.error("demo_api_error", message);
  return json({ error: "internal_error" }, 500);
}
