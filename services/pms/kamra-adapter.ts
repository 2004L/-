import { PmsAdapter, ROOM_STATUS, RESERVATION_STATUS, type PmsAdapterContext, type PmsOrder, type PmsRoom } from "@/lib/hotel-core";

type KamraConfig = { baseUrl: string; apiKey: string; apiSecret: string; property?: string; siteHost?: string; timeoutMs: number };

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`kamra_config_missing:${name}`);
  return value;
}

function config(): KamraConfig {
  return {
    baseUrl: required("KAMRA_BASE_URL", process.env.KAMRA_BASE_URL).replace(/\/$/, ""),
    apiKey: required("KAMRA_API_KEY", process.env.KAMRA_API_KEY),
    apiSecret: required("KAMRA_API_SECRET", process.env.KAMRA_API_SECRET),
    property: process.env.KAMRA_PROPERTY || undefined,
    siteHost: process.env.KAMRA_SITE_HOST || undefined,
    timeoutMs: Math.max(500, Number(process.env.KAMRA_TIMEOUT_MS || 5000)),
  };
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "message" in value) return (value as { message: unknown }).message;
  return value;
}

function list(value: unknown): Record<string, unknown>[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) return unwrapped.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (unwrapped && typeof unwrapped === "object") {
    for (const key of ["data", "results", "reservations", "rooms", "items"]) {
      const candidate = (unwrapped as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }
  return [];
}

function text(row: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  return fallback;
}

function number(row: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) { const value = Number(row[key]); if (Number.isFinite(value)) return value; }
  return fallback;
}

function reservationStatus(value: unknown): (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS] {
  const status = String(value ?? "").toLowerCase();
  if (status.includes("cancel")) return RESERVATION_STATUS.CANCELLED;
  if (status.includes("check") && status.includes("out")) return RESERVATION_STATUS.CHECKED_OUT;
  if (status.includes("check") || status.includes("in house") || status.includes("occupied")) return RESERVATION_STATUS.CHECKED_IN;
  if (status.includes("no") && status.includes("show")) return RESERVATION_STATUS.NO_SHOW;
  return RESERVATION_STATUS.CONFIRMED;
}

function roomStatus(value: unknown): (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS] {
  const status = String(value ?? "").toLowerCase();
  if (status.includes("occupied") || status.includes("in_house") || status.includes("in house")) return ROOM_STATUS.OCCUPIED;
  if (status.includes("dirty") || status.includes("checkout")) return ROOM_STATUS.VACANT_DIRTY;
  if (status.includes("out") || status.includes("maintenance")) return ROOM_STATUS.OUT_OF_ORDER;
  return ROOM_STATUS.VACANT_CLEAN;
}

export class KamraPmsAdapter implements PmsAdapter {
  private async call(method: string, args: Record<string, unknown>, context: PmsAdapterContext) {
    const c = config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), c.timeoutMs);
    try {
      const response = await fetch(`${c.baseUrl}/api/method/${method}`, {
        method: "POST",
        headers: { "Authorization": `token ${c.apiKey}:${c.apiSecret}`, "Content-Type": "application/json", "X-Request-ID": context.requestId, ...(c.siteHost ? { "Host": c.siteHost } : {}) },
        body: JSON.stringify({ ...args, ...(c.property ? { property: c.property } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`kamra_http_${response.status}`);
      const payload = await response.json() as unknown;
      return unwrap(payload);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("kamra_timeout");
      throw error;
    } finally { clearTimeout(timer); }
  }

  async searchOrders(input: { phoneLast4?: string; reservationNo?: string }, context: PmsAdapterContext): Promise<PmsOrder[]> {
    let rows: Record<string, unknown>[];
    if (input.phoneLast4 && !input.reservationNo) {
      const guests = list(await this.call("kamra.api.guest_search", { q: input.phoneLast4 }, context));
      const batches = await Promise.all(guests.map((guest) => this.call("kamra.api.find_reservations", { query: text(guest, ["full_name", "name"]), status: "", limit: 50 }, context)));
      rows = batches.flatMap(list);
    } else {
      rows = list(await this.call("kamra.api.find_reservations", { query: input.reservationNo || "", status: "", limit: 50 }, context));
    }
    const seen = new Set<string>();
    return rows.filter((row) => {
      const no = text(row, ["reservation_no", "name", "reservation", "id"]);
      if (!no || seen.has(no)) return false;
      seen.add(no);
      return !input.reservationNo || no === input.reservationNo;
    }).map((row) => ({
      reservationNo: text(row, ["reservation_no", "name", "reservation", "id"]), source: text(row, ["source", "channel", "booking_source"], "Kamra"),
      status: reservationStatus(row.status), phoneLast4: input.phoneLast4 || text(row, ["phone_last4", "guest_phone_last4", "mobile_last4"]).slice(-4),
      stayDate: text(row, ["stay_date", "arrival", "check_in", "check_in_date", "checkin"]), nights: number(row, ["nights", "number_of_nights"], 1), roomCount: number(row, ["room_count", "rooms"], 1),
      roomTypeCode: text(row, ["room_type_code", "room_type", "room_type_name"]), totalAmount: number(row, ["total_amount", "grand_total"]), depositAmount: number(row, ["deposit_amount", "deposit"]),
    }));
  }

  async getRooms(input: { roomTypeCode?: string; status?: (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS] }, context: PmsAdapterContext): Promise<PmsRoom[]> {
    const rows = list(await this.call("kamra.api.front_desk_snapshot", {}, context));
    return rows.map((row) => ({ roomNumber: text(row, ["room_number", "room", "number"]), roomTypeCode: text(row, ["room_type_code", "room_type", "room_type_name"]), status: roomStatus(row.status || row.occupancy_status || row.housekeeping_status), pmsRoomId: text(row, ["room_id", "name", "id"]) }))
      .filter((room) => !!room.roomNumber && (!input.roomTypeCode || room.roomTypeCode === input.roomTypeCode) && (input.status === undefined || room.status === input.status));
  }

  async createReservation(input: { guestName: string; phone?: string; roomTypeCode: string; checkInDate: string; checkOutDate: string; adults?: number; children?: number; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.create_booking", {
      room_type: input.roomTypeCode,
      check_in_date: input.checkInDate,
      check_out_date: input.checkOutDate,
      guest_name: input.guestName,
      phone: input.phone,
      adults: input.adults ?? 2,
      children: input.children ?? 0,
      idempotency_key: input.idempotencyKey,
    }, context) as Record<string, unknown>;
    const reservationNo = text(result, ["name", "reservation", "reservation_no", "id"]);
    if (!reservationNo) throw new Error("kamra_invalid_create_booking_response");
    return { reservationNo, status: reservationStatus(result.status), receipt: `kamra-create-${reservationNo}` };
  }

  async amendStay(input: { reservationNo: string; checkInDate: string; checkOutDate: string; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.amend_stay", {
      reservation: input.reservationNo,
      check_in_date: input.checkInDate,
      check_out_date: input.checkOutDate,
      idempotency_key: input.idempotencyKey,
    }, context) as Record<string, unknown>;
    const reservationNo = text(result, ["name", "reservation", "reservation_no", "id"], input.reservationNo);
    return { reservationNo, status: reservationStatus(result.status), receipt: `kamra-amend-${reservationNo}` };
  }

  async moveReservation(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.move_reservation", {
      reservation: input.reservationNo,
      new_room: input.roomNumber,
      idempotency_key: input.idempotencyKey,
    }, context) as Record<string, unknown>;
    const reservationNo = text(result, ["name", "reservation", "reservation_no", "id"], input.reservationNo);
    return { reservationNo, status: reservationStatus(result.status), receipt: `kamra-move-${reservationNo}` };
  }

  async holdRoom(_input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, _context: PmsAdapterContext): Promise<{ status: "held" | "conflict"; expiresAt?: string }> {
    void _input;
    void _context;
    throw new Error("kamra_hold_requires_booking_quote");
  }

  async confirmCheckin(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.check_in", { reservation: input.reservationNo, room: input.roomNumber, idempotency_key: input.idempotencyKey }, context) as Record<string, unknown>;
    return { status: "checked-in" as const, receipt: text(result, ["receipt", "name"], `kamra-checkin-${input.reservationNo}`) };
  }

  async checkout(input: { reservationNo: string; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.check_out", { reservation: input.reservationNo, idempotency_key: input.idempotencyKey }, context) as Record<string, unknown>;
    return { status: "checked-out" as const, receipt: text(result, ["receipt", "name"], `kamra-checkout-${input.reservationNo}`) };
  }

  async setHousekeepingStatus(input: { roomNumber: string; status: string; idempotencyKey: string }, context: PmsAdapterContext) {
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const result = await this.call("kamra.api.set_housekeeping_status", { room: input.roomNumber, status: input.status, idempotency_key: input.idempotencyKey }, context) as Record<string, unknown>;
    return { status: text(result, ["status"], input.status), receipt: `kamra-housekeeping-${input.roomNumber}` };
  }
}

export const kamraPms = new KamraPmsAdapter();
