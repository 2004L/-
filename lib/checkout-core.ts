import {
  RESERVATION_STATUS,
  ROOM_STATUS,
  STAY_STATUS,
  assertRoomTransition,
  type RoomStatus,
} from "./hotel-core.ts";
import type { SqlRunner, SqlValue } from "./orders-core.ts";

/**
 * Leaving the room. This is the "room closed" half of the loop: the stay ends,
 * the reservation ends and the room becomes dirty so housekeeping can be asked
 * to turn it around. Money is a separate concern and lives in
 * lib/settlement-core.ts, which is why checkout never claims the folio is paid.
 */

export const CHECKOUT_ERRORS = {
  STAY_NOT_FOUND: "stay_not_found",
  STAY_STATUS_CONFLICT: "stay_status_conflict",
  STAY_VERSION_CONFLICT: "stay_version_conflict",
  RESERVATION_STATUS_CONFLICT: "reservation_status_conflict",
  ROOM_NOT_ASSIGNED: "checkout_room_not_assigned",
  ROOM_STATUS_CONFLICT: "room_status_conflict",
  ROOM_NOT_FOUND: "checkout_room_not_found",
  REQUEST_INVALID: "checkout_request_invalid",
} as const;

type StayRow = {
  id: string;
  tenant_id: string;
  hotel_id: string;
  reservation_id: string | null;
  status: number;
  version: number;
  checked_out_at: string | null;
};

const STAY_SQL = "SELECT id, tenant_id, hotel_id, reservation_id, status, version, checked_out_at FROM stays WHERE hotel_id = ? AND id = ? LIMIT 1";
const ASSIGNED_ROOM_SQL = "SELECT room_id AS room_id FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = ? AND room_id IS NOT NULL LIMIT 1";
const ROOM_BY_ID_SQL = "SELECT id, status, version FROM rooms WHERE hotel_id = ? AND id = ? LIMIT 1";
const ROOM_BY_NUMBER_SQL = "SELECT id, status, version FROM rooms WHERE hotel_id = ? AND room_number = ? LIMIT 1";

export type CheckoutResult = {
  stayId: string;
  reservationId: string | null;
  roomId: string | null;
  roomStatus: number | null;
  idempotent: boolean;
};

/** Ends the stay, ends the reservation and returns the room as dirty. */
export async function checkoutStayWith(db: SqlRunner, input: { hotelId: string; stayId: string; requestId: string }): Promise<CheckoutResult> {
  if (!input.hotelId || !input.stayId || !input.requestId) throw new Error(CHECKOUT_ERRORS.REQUEST_INVALID);
  const stay = await db.first<StayRow>(STAY_SQL, [input.hotelId, input.stayId]);
  if (!stay) throw new Error(CHECKOUT_ERRORS.STAY_NOT_FOUND);
  const alreadyOut = Number(stay.status) === STAY_STATUS.CHECKED_OUT;
  if (!alreadyOut) {
    if (Number(stay.status) !== STAY_STATUS.IN_HOUSE) throw new Error(CHECKOUT_ERRORS.STAY_STATUS_CONFLICT);
    const stamp = new Date().toISOString();
    const moved = await db.run(
      "UPDATE stays SET status = ?, checked_out_at = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?",
      [STAY_STATUS.CHECKED_OUT, stamp, stamp, input.hotelId, input.stayId, STAY_STATUS.IN_HOUSE],
    );
    if (!moved.changes) {
      const current = await db.first<StayRow>(STAY_SQL, [input.hotelId, input.stayId]);
      if (!current || Number(current.status) !== STAY_STATUS.CHECKED_OUT) throw new Error(CHECKOUT_ERRORS.STAY_VERSION_CONFLICT);
    }
  }
  const reservationId = stay.reservation_id;
  if (reservationId && !alreadyOut) await closeReservation(db, input, reservationId);
  const room = reservationId ? await releaseRoom(db, input, reservationId) : null;
  return { stayId: input.stayId, reservationId, roomId: room?.roomId ?? null, roomStatus: room?.roomStatus ?? null, idempotent: alreadyOut };
}

async function closeReservation(db: SqlRunner, input: { hotelId: string; requestId: string }, reservationId: string) {
  const stamp = new Date().toISOString();
  const moved = await db.run(
    "UPDATE reservations SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?",
    [RESERVATION_STATUS.CHECKED_OUT, stamp, input.hotelId, reservationId, RESERVATION_STATUS.CHECKED_IN],
  );
  if (moved.changes) {
    await db.run(
      "INSERT INTO reservation_status_logs (id, tenant_id, hotel_id, reservation_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'guest checked out', 'guest_flow', NULL, ?, ?)",
      [`rslog-${input.requestId}-checkout`, await tenantOf(db, input.hotelId, reservationId), input.hotelId, reservationId, RESERVATION_STATUS.CHECKED_IN, RESERVATION_STATUS.CHECKED_OUT, input.requestId, stamp],
    );
  }
}

/**
 * The room goes to VACANT_DIRTY, never straight to VACANT_CLEAN: nobody has
 * cleaned it yet, and pretending otherwise is how a hotel sells a dirty room.
 */
async function releaseRoom(db: SqlRunner, input: { hotelId: string; requestId: string }, reservationId: string) {
  const assigned = await db.first<{ room_id: string }>(ASSIGNED_ROOM_SQL, [input.hotelId, reservationId]);
  if (!assigned?.room_id) return null;
  const room = await db.first<{ id: string; status: number; version: number }>(ROOM_BY_ID_SQL, [input.hotelId, assigned.room_id]);
  if (!room) throw new Error(CHECKOUT_ERRORS.ROOM_NOT_FOUND);
  if (Number(room.status) === ROOM_STATUS.VACANT_DIRTY || Number(room.status) === ROOM_STATUS.VACANT_CLEAN) {
    return { roomId: room.id, roomStatus: Number(room.status) };
  }
  assertRoomTransition(Number(room.status) as RoomStatus, ROOM_STATUS.VACANT_DIRTY);
  const stamp = new Date().toISOString();
  const moved = await db.run(
    "UPDATE rooms SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?",
    [ROOM_STATUS.VACANT_DIRTY, stamp, input.hotelId, room.id, room.status],
  );
  if (!moved.changes) throw new Error(CHECKOUT_ERRORS.ROOM_STATUS_CONFLICT);
  await db.run(
    "INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'guest checked out', 'guest_flow', NULL, ?, ?)",
    [`rlog-${input.requestId}-dirty`, await tenantOf(db, input.hotelId, room.id), input.hotelId, room.id, room.status, ROOM_STATUS.VACANT_DIRTY, input.requestId, stamp],
  );
  return { roomId: room.id, roomStatus: Number(ROOM_STATUS.VACANT_DIRTY) };
}

/** Housekeeping finished: dirty room becomes sellable again. */
export async function markRoomCleanWith(db: SqlRunner, input: { hotelId: string; roomNumber: string; requestId: string }) {
  if (!input.hotelId || !input.roomNumber || !input.requestId) throw new Error(CHECKOUT_ERRORS.REQUEST_INVALID);
  const room = await db.first<{ id: string; status: number; version: number }>(ROOM_BY_NUMBER_SQL, [input.hotelId, input.roomNumber]);
  if (!room) throw new Error(CHECKOUT_ERRORS.ROOM_NOT_FOUND);
  if (Number(room.status) === ROOM_STATUS.VACANT_CLEAN) return { roomId: room.id, roomStatus: Number(room.status), fromStatus: Number(room.status), idempotent: true };
  assertRoomTransition(Number(room.status) as RoomStatus, ROOM_STATUS.VACANT_CLEAN);
  const stamp = new Date().toISOString();
  const moved = await db.run(
    "UPDATE rooms SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?",
    [ROOM_STATUS.VACANT_CLEAN, stamp, input.hotelId, room.id, room.status],
  );
  if (!moved.changes) throw new Error(CHECKOUT_ERRORS.ROOM_STATUS_CONFLICT);
  await db.run(
    "INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'housekeeping cleaned', 'housekeeping', NULL, ?, ?)",
    [`rlog-${input.requestId}-clean`, await tenantOf(db, input.hotelId, room.id), input.hotelId, room.id, room.status, ROOM_STATUS.VACANT_CLEAN, input.requestId, stamp],
  );
  return { roomId: room.id, roomStatus: Number(ROOM_STATUS.VACANT_CLEAN), fromStatus: Number(room.status), idempotent: false };
}

/** Room status logs require a tenant id; the room row is the cheapest source. */
async function tenantOf(db: SqlRunner, hotelId: string, roomId: string) {
  const row = await db.first<{ tenant_id: string | null }>("SELECT tenant_id FROM rooms WHERE hotel_id = ? AND id = ? LIMIT 1", [hotelId, roomId]);
  return row?.tenant_id ?? "tenant-demo";
}

/** Runners that can return more than one row; D1 and node:sqlite both can. */
export interface ListRunner extends SqlRunner {
  all<T = Record<string, unknown>>(sql: string, params: SqlValue[]): Promise<T[]>;
}

export type StayCandidate = {
  stayId: string;
  reservationId: string | null;
  reservationNo: string | null;
  roomId: string | null;
  roomNumber: string | null;
  guestNameMasked: string;
  phoneLast4: string;
  stayDate: string | null;
  nights: number;
  roomCount: number;
  checkedInAt: string | null;
};

const CANDIDATE_COLUMNS = "s.id AS stay_id, s.reservation_id AS reservation_id, r.reservation_no AS reservation_no, rr.room_id AS room_id, rooms.room_number AS room_number, s.guest_name_masked AS guest_name_masked, s.phone_last4 AS phone_last4, r.stay_date AS stay_date, r.nights AS nights, r.room_count AS room_count, s.checked_in_at AS checked_in_at";

function candidateSql(withRoom: boolean) {
  return `SELECT ${CANDIDATE_COLUMNS} FROM stays s LEFT JOIN reservations r ON r.id = s.reservation_id AND r.hotel_id = s.hotel_id LEFT JOIN reservation_rooms rr ON rr.reservation_id = s.reservation_id AND rr.hotel_id = s.hotel_id AND rr.room_id IS NOT NULL LEFT JOIN rooms ON rooms.id = rr.room_id AND rooms.hotel_id = s.hotel_id WHERE s.hotel_id = ? AND s.status = ? AND s.phone_last4 = ?${withRoom ? " AND rooms.room_number = ?" : ""} ORDER BY s.checked_in_at DESC, s.id ASC LIMIT 20`;
}

/** D1 hands back column names, not the camelCase shape the caller is promised. */
type StayCandidateRow = {
  stay_id: string;
  reservation_id: string | null;
  reservation_no: string | null;
  room_id: string | null;
  room_number: string | null;
  guest_name_masked: string;
  phone_last4: string;
  stay_date: string | null;
  nights: number | null;
  room_count: number | null;
  checked_in_at: string | null;
};

function candidateView(row: StayCandidateRow): StayCandidate {
  return {
    stayId: row.stay_id,
    reservationId: row.reservation_id,
    reservationNo: row.reservation_no,
    roomId: row.room_id,
    roomNumber: row.room_number,
    guestNameMasked: row.guest_name_masked,
    phoneLast4: row.phone_last4,
    stayDate: row.stay_date,
    nights: Number(row.nights ?? 0),
    roomCount: Number(row.room_count ?? 0),
    checkedInAt: row.checked_in_at,
  };
}

/**
 * Self-service checkout has no keycard reader yet, so the guest identifies with
 * the room they are standing in plus the phone number the booking was made with.
 * Two factors on purpose: either one alone is guessable from a room number.
 */
export async function findInHouseStaysWith(db: ListRunner, input: { hotelId: string; phoneLast4: string; roomNumber?: string | null }): Promise<StayCandidate[]> {
  const withRoom = Boolean(input.roomNumber);
  const params: SqlValue[] = [input.hotelId, STAY_STATUS.IN_HOUSE, input.phoneLast4];
  if (withRoom) params.push(String(input.roomNumber));
  const rows = await db.all<StayCandidateRow>(candidateSql(withRoom), params);
  return rows.map(candidateView);
}