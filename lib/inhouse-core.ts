import type { SqlRunner } from "./orders-core.ts";
import type { ListRunner } from "./checkout-core.ts";

/**
 * What the front desk needs to see about the guests who are actually in the
 * building, and what the hotel told them it would do next. The service need is
 * deliberately one open row per room: a room either needs something right now or
 * it does not, and the audit trail keeps the history of who asked for what.
 */
export const SERVICE_NEEDS = ["none", "cleaning", "maintenance", "supplies"] as const;
export type ServiceNeed = (typeof SERVICE_NEEDS)[number];
export const SERVICE_NEED_LABELS: Record<ServiceNeed, string> = {
  none: "无需服务",
  cleaning: "需要打扫",
  maintenance: "需要维修",
  supplies: "需要补物品",
};

export const INHOUSE_ERRORS = {
  REQUEST_INVALID: "inhouse_request_invalid",
  NEED_INVALID: "inhouse_need_invalid",
  ROOM_NOT_FOUND: "inhouse_room_not_found",
} as const;

/** Kept byte-identical to drizzle/0017_room_service_needs.sql. */
export const INHOUSE_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS room_service_needs (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, room_number TEXT NOT NULL, stay_id TEXT, need TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', reported_by TEXT, reported_at TEXT, resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (hotel_id, room_number))",
  "CREATE INDEX IF NOT EXISTS room_service_needs_hotel_status_idx ON room_service_needs(hotel_id, status, reported_at)",
];

export function isServiceNeed(value: unknown): value is ServiceNeed {
  return typeof value === "string" && (SERVICE_NEEDS as readonly string[]).includes(value);
}

export type InHouseGuest = {
  stayId: string;
  roomNumber: string | null;
  guestNameMasked: string;
  phoneLast4: string;
  reservationNo: string;
  stayDate: string;
  nights: number;
  checkedInAt: string | null;
  folioStatus: string | null;
  folioBalance: number;
  consumption: number;
  serviceNeed: ServiceNeed;
  serviceNote: string | null;
  serviceReportedAt: string | null;
  serviceReportedBy: string | null;
};

const IN_HOUSE_STAY = 2;

/**
 * Guests currently in house with their room, their money and anything they are
 * waiting on. A stay whose room link is missing stays in the list with a null
 * room instead of being dropped: a guest the system cannot place is exactly the
 * one the front desk needs to see.
 */
export async function listInHouseWith(db: ListRunner, input: { hotelId: string }): Promise<InHouseGuest[]> {
  if (!input?.hotelId) throw new Error(INHOUSE_ERRORS.REQUEST_INVALID);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT s.id AS stay_id, s.checked_in_at, r.reservation_no, r.guest_name_masked, r.phone_last4, r.stay_date, r.nights,
            rm.room_number, f.status AS folio_status, f.balance AS folio_balance,
            (SELECT COALESCE(SUM(e.amount), 0) FROM ledger_entries e WHERE e.hotel_id = s.hotel_id AND e.folio_id = f.id AND e.entry_type = 'consumption') AS consumption,
            n.need AS service_need, n.note AS service_note, n.reported_at AS service_reported_at, n.reported_by AS service_reported_by
     FROM stays s
     JOIN reservations r ON r.id = s.reservation_id AND r.hotel_id = s.hotel_id
     LEFT JOIN reservation_rooms rr ON rr.hotel_id = s.hotel_id AND rr.reservation_id = s.reservation_id
     LEFT JOIN rooms rm ON rm.id = rr.room_id AND rm.hotel_id = rr.hotel_id
     LEFT JOIN folios f ON f.hotel_id = s.hotel_id AND f.stay_id = s.id
     LEFT JOIN room_service_needs n ON n.hotel_id = s.hotel_id AND n.room_number = rm.room_number AND n.status = 'open'
     WHERE s.hotel_id = ? AND s.status = ?
     ORDER BY rm.room_number IS NULL, rm.room_number, s.checked_in_at`,
    [input.hotelId, IN_HOUSE_STAY],
  );
  return rows.map((row) => {
    const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
    return {
      stayId: String(row.stay_id),
      roomNumber: text(row.room_number),
      guestNameMasked: String(row.guest_name_masked ?? ""),
      phoneLast4: String(row.phone_last4 ?? ""),
      reservationNo: String(row.reservation_no ?? ""),
      stayDate: String(row.stay_date ?? ""),
      nights: Number(row.nights ?? 0),
      checkedInAt: text(row.checked_in_at),
      folioStatus: text(row.folio_status),
      folioBalance: Number(row.folio_balance ?? 0),
      consumption: Number(row.consumption ?? 0),
      serviceNeed: isServiceNeed(row.service_need) ? row.service_need : "none",
      serviceNote: text(row.service_note),
      serviceReportedAt: text(row.service_reported_at),
      serviceReportedBy: text(row.service_reported_by),
    };
  });
}

export type ServiceNeedResult = {
  roomNumber: string;
  need: ServiceNeed;
  status: "open" | "done";
  reportedBy: string | null;
  reportedAt: string | null;
};

/**
 * Record — or clear — what a room is waiting for. Clearing keeps the row and
 * flips it to done instead of deleting it, so "who said this room was fine"
 * stays answerable afterwards.
 */
export async function setServiceNeedWith(db: SqlRunner, input: { tenantId: string; hotelId: string; roomNumber: string; need: ServiceNeed; note?: string | null; actor: string; stayId?: string | null }): Promise<ServiceNeedResult> {
  if (!input?.hotelId || !input?.roomNumber || !input?.actor) throw new Error(INHOUSE_ERRORS.REQUEST_INVALID);
  if (!isServiceNeed(input.need)) throw new Error(INHOUSE_ERRORS.NEED_INVALID);
  const room = await db.first<{ id: string }>("SELECT id FROM rooms WHERE hotel_id = ? AND room_number = ? LIMIT 1", [input.hotelId, input.roomNumber]);
  if (!room) throw new Error(INHOUSE_ERRORS.ROOM_NOT_FOUND);
  const stamp = new Date().toISOString();
  const open = input.need !== "none";
  const note = input.note && input.note.trim() ? input.note.trim().slice(0, 200) : null;
  await db.run(
    `INSERT INTO room_service_needs (id, tenant_id, hotel_id, room_number, stay_id, need, note, status, reported_by, reported_at, resolved_by, resolved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hotel_id, room_number) DO UPDATE SET
       stay_id = excluded.stay_id, need = excluded.need, note = excluded.note, status = excluded.status,
       reported_by = excluded.reported_by, reported_at = excluded.reported_at,
       resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at, updated_at = excluded.updated_at`,
    [
      `svc-${input.hotelId}-${input.roomNumber}`,
      input.tenantId,
      input.hotelId,
      input.roomNumber,
      input.stayId ?? null,
      input.need,
      note,
      open ? "open" : "done",
      open ? input.actor : null,
      open ? stamp : null,
      open ? null : input.actor,
      open ? null : stamp,
      stamp,
      stamp,
    ],
  );
  return { roomNumber: input.roomNumber, need: input.need, status: open ? "open" : "done", reportedBy: open ? input.actor : null, reportedAt: open ? stamp : null };
}