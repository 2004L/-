import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "@/db";

export const runtime = "edge";

const TOKEN = process.env.MCP_SERVICE_TOKEN ?? "";

function sameToken(actual: string) {
  if (!TOKEN || !actual || actual.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i += 1) diff |= actual.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return diff === 0;
}

async function audit(hotelId: string, tenantId: string, operation: string, requestId: string, ok: boolean) {
  try {
    await getD1().prepare("INSERT INTO mcp_audit_events (id, tenant_id, hotel_id, operation, request_id, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), tenantId, hotelId, operation, requestId, ok ? 1 : 0, new Date().toISOString()).run();
  } catch { /* audit failure never exposes data or changes the read result */ }
}

export async function GET(request: NextRequest) {
  const requestId = `mcp-${crypto.randomUUID()}`;
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const tenantId = request.headers.get("x-tenant-id") ?? "";
  const hotelId = request.headers.get("x-hotel-id") ?? "";
  const operation = request.nextUrl.searchParams.get("operation") ?? "";
  if (!sameToken(auth) || !tenantId || !hotelId) return NextResponse.json({ ok: false, error: "mcp_service_auth_required", request_id: requestId }, { status: 401 });
  const allowed = new Set(["rooms", "orders", "workflow", "tasks"]);
  if (!allowed.has(operation)) return NextResponse.json({ ok: false, error: "unsupported_read_model", request_id: requestId }, { status: 400 });
  try {
    let data: unknown;
    if (operation === "rooms") {
      const rows = await getD1().prepare("SELECT r.room_number, r.status, r.version, r.pms_room_id, rt.code AS room_type_code FROM rooms r LEFT JOIN room_types rt ON rt.id = r.room_type_id WHERE r.tenant_id = ? AND r.hotel_id = ? ORDER BY r.room_number LIMIT 500").bind(tenantId, hotelId).all<Record<string, unknown>>();
      data = rows.results.map((r) => ({ number: r.room_number, status: Number(r.status), version: Number(r.version), pmsCode: r.pms_room_id, roomTypeCode: r.room_type_code }));
    } else if (operation === "orders") {
      const phone = request.nextUrl.searchParams.get("phone_last4")?.replace(/\D/g, "").slice(-4) ?? "";
      const reservation = request.nextUrl.searchParams.get("reservation_no") ?? "";
      const clauses = ["r.tenant_id = ?", "r.hotel_id = ?"]; const binds: unknown[] = [tenantId, hotelId];
      if (phone) { clauses.push("r.phone_last4 = ?"); binds.push(phone); }
      if (reservation) { clauses.push("r.reservation_no = ?"); binds.push(reservation); }
      const rows = await getD1().prepare(`SELECT r.reservation_no, r.source, r.status, r.stay_date, r.nights, r.room_count, r.phone_last4, COALESCE(o.total_amount, r.total_amount) AS total_amount FROM reservations r LEFT JOIN orders o ON o.hotel_id = r.hotel_id AND o.order_no = r.reservation_no WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC LIMIT 50`).bind(...binds).all<Record<string, unknown>>();
      data = rows.results.map((r) => ({ orderId: r.reservation_no, source: r.source, status: Number(r.status), phoneLast4: r.phone_last4, stayDate: r.stay_date, nights: Number(r.nights), roomCount: Number(r.room_count), totalAmountFen: Number(r.total_amount) }));
    } else if (operation === "workflow") {
      const id = request.nextUrl.searchParams.get("workflow_id") ?? "";
      const row = await getD1().prepare("SELECT id, workflow_type, status, current_step, idempotency_key, created_at, updated_at FROM workflow_runs WHERE tenant_id = ? AND hotel_id = ? AND id = ? LIMIT 1").bind(tenantId, hotelId, id).first<Record<string, unknown>>();
      data = row ? { ...row, steps: (await getD1().prepare("SELECT step_key, status, attempt, last_error, updated_at FROM workflow_steps WHERE tenant_id = ? AND hotel_id = ? AND workflow_run_id = ? ORDER BY updated_at").bind(tenantId, hotelId, id).all()).results } : null;
    } else {
      const rows = await getD1().prepare("SELECT id, department, reason, status, created_at, updated_at FROM manual_tasks WHERE session_id IN (SELECT id FROM demo_sessions WHERE hotel_id = ?) ORDER BY created_at DESC LIMIT 200").bind(hotelId).all<Record<string, unknown>>();
      data = rows.results.map((r) => ({ id: r.id, department: r.department, reason: r.reason, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }));
    }
    await audit(hotelId, tenantId, operation, requestId, true);
    return NextResponse.json({ ok: true, request_id: requestId, tenant_id: tenantId, hotel_id: hotelId, operation, data });
  } catch {
    await audit(hotelId, tenantId, operation, requestId, false);
    return NextResponse.json({ ok: false, error: "mcp_read_model_failed", request_id: requestId }, { status: 502 });
  }
}
