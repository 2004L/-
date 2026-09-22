import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "@/db";
import { ensureAdminSchema, getAdminFromRequest } from "@/lib/admin-auth";
import { ROOM_STATUS } from "@/lib/hotel-core";
import { getPmsAdapter } from "@/services/pms/factory";

export const runtime = "edge";

type Operation = "ping" | "orders" | "rooms" | "create" | "amend" | "move" | "hold" | "checkin" | "checkout" | "housekeeping";

const OPERATIONS: readonly Operation[] = ["ping", "orders", "rooms", "create", "amend", "move", "hold", "checkin", "checkout", "housekeeping"];
const WRITE_OPERATIONS: readonly Operation[] = ["create", "amend", "move", "hold", "checkin", "checkout", "housekeeping"];
const TEMPORARY_API_KEY = "TEMP_PMS_API_KEY_REPLACE_ME";

function config() {
  const apiKey = process.env.PMS_API_KEY ?? TEMPORARY_API_KEY;
  return {
    provider: process.env.PMS_PROVIDER ?? "simulator",
    version: process.env.PMS_VERSION ?? "1.6.1",
    baseUrl: process.env.PMS_BASE_URL ?? "https://pms.example.local/api",
    apiKey,
    temporaryKey: apiKey === TEMPORARY_API_KEY,
    writesEnabled: process.env.PMS_WRITES_ENABLED === "true",
  };
}

async function readExternalOrders(input: { phoneLast4?: string; reservationNo?: string }, hotelId: string, hotelCode: string, requestId: string) {
  return getPmsAdapter().searchOrders(input, { hotelId, hotelCode, requestId });
}

async function readExternalRooms(input: { roomTypeCode?: string; status?: number }, hotelId: string, hotelCode: string, requestId: string) {
  return getPmsAdapter().getRooms(input as never, { hotelId, hotelCode, requestId });
}

async function readOrders(hotelId: string, phoneLast4?: string, reservationNo?: string) {
  const clauses = ["r.hotel_id = ?"];
  const binds: unknown[] = [hotelId];
  if (phoneLast4) { clauses.push("r.phone_last4 = ?"); binds.push(phoneLast4); }
  if (reservationNo) { clauses.push("r.reservation_no = ?"); binds.push(reservationNo); }
  const rows = await getD1().prepare(`SELECT r.reservation_no, r.source, r.status, r.stay_date, r.nights, r.room_count, COALESCE(o.total_amount, r.total_amount) AS total_amount, COALESCE(o.deposit_amount, r.deposit_amount) AS deposit_amount FROM reservations r LEFT JOIN orders o ON o.hotel_id = r.hotel_id AND o.order_no = r.reservation_no WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC LIMIT 50`).bind(...binds).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    orderId: row.reservation_no,
    source: row.source,
    status: Number(row.status),
    guestPhone: "masked",
    stay: { stayDate: row.stay_date, nights: Number(row.nights) },
    totalAmountFen: Number(row.total_amount),
    depositAmountFen: Number(row.deposit_amount),
  }));
}

async function readRooms(hotelId: string, roomTypeCode?: string, status?: number) {
  const clauses = ["r.hotel_id = ?"];
  const binds: unknown[] = [hotelId];
  if (roomTypeCode) { clauses.push("rt.code = ?"); binds.push(roomTypeCode); }
  if (status !== undefined) { clauses.push("r.status = ?"); binds.push(status); }
  const rows = await getD1().prepare(`SELECT r.room_number, r.status, r.version, r.pms_room_id, rt.code AS room_type_code FROM rooms r LEFT JOIN room_types rt ON rt.id = r.room_type_id WHERE ${clauses.join(" AND ")} ORDER BY r.room_number LIMIT 200`).bind(...binds).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    number: row.room_number,
    roomTypeCode: row.room_type_code,
    pmsCode: row.pms_room_id,
    status: Number(row.status),
    version: Number(row.version),
    holdable: Number(row.status) === ROOM_STATUS.VACANT_CLEAN,
  }));
}

async function handle(request: NextRequest, params: Promise<{ operation: string }>) {
  const { operation: rawOperation } = await params;
  const operation = rawOperation as Operation;
  if (!OPERATIONS.includes(operation)) return NextResponse.json({ ok: false, error: "unsupported_operation" }, { status: 404 });
  const c = config();
  const requestId = `pms-${crypto.randomUUID()}`;
  const base = {
    ok: true,
    adapter: c.provider,
    pmsVersion: c.version,
    mode: c.temporaryKey ? "temporary-placeholder" : "live-ready",
    temporaryNotice: c.temporaryKey ? "临时占位：替换 PMS_API_KEY 后再启用真实 PMS 请求" : null,
    operation,
    traceId: requestId,
  };
  if (operation === "ping") return NextResponse.json({ ...base, status: "reachable", businessOperations: "admin_auth_required" });
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return NextResponse.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  const url = new URL(request.url);
  const input = request.method === "POST" ? await request.json().catch(() => ({})) as Record<string, unknown> : {};
  if (WRITE_OPERATIONS.includes(operation)) {
    if (!c.writesEnabled) return NextResponse.json({ ...base, ok: false, error: "pms_write_disabled", message: "PMS 写操作尚未启用。" }, { status: 501 });
    if (input.confirmation !== "CONFIRM") return NextResponse.json({ ...base, ok: false, error: "confirmation_required", message: "写操作必须显式确认。" }, { status: 409 });
    if (typeof input.idempotency_key !== "string" || input.idempotency_key.length < 8 || input.idempotency_key.length > 160) return NextResponse.json({ ...base, ok: false, error: "pms_idempotency_required" }, { status: 400 });
  }
  const adapter = getPmsAdapter();
  const context = { hotelId: auth.user.hotel_id, hotelCode: auth.user.hotel_code, requestId };
  try {
    if (operation === "create") {
      if (!adapter.createReservation) throw new Error("pms_create_not_supported");
      const result = await adapter.createReservation({ guestName: String(input.guest_name ?? ""), phone: input.phone ? String(input.phone) : undefined, roomTypeCode: String(input.room_type_code ?? ""), checkInDate: String(input.check_in_date ?? ""), checkOutDate: String(input.check_out_date ?? ""), adults: Number(input.adults ?? 2), children: Number(input.children ?? 0), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
    if (operation === "amend") {
      if (!adapter.amendStay) throw new Error("pms_amend_not_supported");
      const result = await adapter.amendStay({ reservationNo: String(input.reservation_no ?? ""), checkInDate: String(input.check_in_date ?? ""), checkOutDate: String(input.check_out_date ?? ""), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
    if (operation === "move") {
      if (!adapter.moveReservation) throw new Error("pms_move_not_supported");
      const result = await adapter.moveReservation({ reservationNo: String(input.reservation_no ?? ""), roomNumber: String(input.room_number ?? ""), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
    if (operation === "checkin") {
      const result = await adapter.confirmCheckin({ reservationNo: String(input.reservation_no ?? ""), roomNumber: String(input.room_number ?? ""), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
    if (operation === "checkout") {
      const result = await adapter.checkout({ reservationNo: String(input.reservation_no ?? ""), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
    if (operation === "housekeeping") {
      if (!adapter.setHousekeepingStatus) throw new Error("pms_housekeeping_not_supported");
      const result = await adapter.setHousekeepingStatus({ roomNumber: String(input.room_number ?? ""), status: String(input.status ?? ""), idempotencyKey: String(input.idempotency_key) }, context);
      return NextResponse.json({ ...base, operation, result });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "pms_write_failed";
    return NextResponse.json({ ...base, ok: false, error: message.startsWith("kamra_") || message.startsWith("pms_") ? message : "pms_write_failed", message: "PMS 写操作失败，未修改本地投影数据。" }, { status: 502 });
  }
  if (operation === "orders") {
    const phoneLast4 = String(input.phone_last4 ?? url.searchParams.get("phone_last4") ?? "").replace(/\D/g, "").slice(-4) || undefined;
    const reservationNo = String(input.reservation_no ?? url.searchParams.get("reservation_no") ?? "") || undefined;
    let orders;
    try {
      orders = c.provider === "kamra"
        ? await readExternalOrders({ phoneLast4, reservationNo }, auth.user.hotel_id, auth.user.hotel_code, requestId)
        : await readOrders(auth.user.hotel_id, phoneLast4, reservationNo);
    } catch (error) {
      const code = error instanceof Error ? error.message : "kamra_unavailable";
      return NextResponse.json({ ...base, ok: false, error: code.startsWith("kamra_") ? code : "pms_read_failed", message: "PMS 查询失败，未修改本地数据，请检查 PMS 服务和配置。" }, { status: 502 });
    }
    return NextResponse.json({ ...base, source: c.provider === "kamra" ? "kamra" : "formal-reservations", property: { code: auth.user.hotel_code }, orders });
  }
  const status = input.status === undefined || input.status === null ? undefined : Number(input.status);
  let rooms;
  try {
    rooms = c.provider === "kamra"
      ? await readExternalRooms({ roomTypeCode: input.room_type_code ? String(input.room_type_code) : undefined, status: status !== undefined && Number.isFinite(status) ? status : undefined }, auth.user.hotel_id, auth.user.hotel_code, requestId)
      : await readRooms(auth.user.hotel_id, input.room_type_code ? String(input.room_type_code) : undefined, status !== undefined && Number.isFinite(status) ? status : undefined);
  } catch (error) {
    const code = error instanceof Error ? error.message : "kamra_unavailable";
    return NextResponse.json({ ...base, ok: false, error: code.startsWith("kamra_") ? code : "pms_read_failed", message: "PMS 房态查询失败，未修改本地数据，请检查 PMS 服务和配置。" }, { status: 502 });
  }
  return NextResponse.json({ ...base, source: c.provider === "kamra" ? "kamra" : "formal-rooms", property: { code: auth.user.hotel_code }, rooms });
}

export async function GET(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  return handle(request, context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  return handle(request, context.params);
}
