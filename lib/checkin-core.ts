import {
  ORDER_STATUS,
  RESERVATION_STATUS,
  ROOM_STATUS,
  STAY_STATUS,
  canonicalRoomType,
  formalRoomId,
  formalRoomTypeId,
} from "./hotel-core.ts";
import type { SqlRunner, SqlValue } from "./orders-core.ts";

export const CHECKIN_ERRORS = {
  ORDER_TYPE_MISSING: "checkin_room_type_missing",
  NO_SELLABLE_ROOM: "no_sellable_room",
  ROOM_NOT_HELD: "room_not_held",
  ROOM_CONFLICT: "room_conflict",
} as const;

/**
 * Formal check-in writes. orders/reservations/rooms/stays are authoritative;
 * demo_orders only receives a projection (status label and room number) so the
 * existing demo UI keeps working while the formal tables own the facts.
 */
export type CheckinOrderInput = {
  tenantId: string;
  hotelId: string;
  orderNo: string;
  source: string;
  guestLabel: string;
  phoneLast4: string;
  stayDate: string;
  nights: number;
  roomCount: number;
  roomTypeName: string;
  roomAmount: number;
  depositAmount: number;
  totalAmount: number;
  orderStatus?: number;
  reservationStatus?: number;
};

export async function ensureCheckinOrder(db: SqlRunner, input: CheckinOrderInput) {
  const stamp = new Date().toISOString();
  const roomType = canonicalRoomType(input.roomTypeName);
  const roomTypeId = formalRoomTypeId(input.hotelId, roomType.code);
  await db.run(
    "INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 2, 1, ?, ?)",
    [roomTypeId, input.tenantId, input.hotelId, roomType.code, roomType.name, stamp, stamp],
  );
  await db.run(
    "INSERT OR IGNORE INTO orders (id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    [`ord-${input.orderNo}`, input.tenantId, input.hotelId, input.orderNo, input.source, input.orderNo, input.orderStatus ?? ORDER_STATUS.PAID, input.roomAmount, input.depositAmount, input.totalAmount, input.totalAmount, input.guestLabel, input.phoneLast4, input.orderNo, `checkin:${input.hotelId}:${input.orderNo}`, stamp, stamp],
  );
  await db.run(
    "INSERT OR IGNORE INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'CNY', 1, ?, ?, ?)",
    [`res-${input.orderNo}`, input.tenantId, input.hotelId, input.orderNo, input.source, input.orderNo, input.guestLabel, input.phoneLast4, input.reservationStatus ?? RESERVATION_STATUS.CONFIRMED, input.stayDate, input.nights, input.roomCount, input.totalAmount, input.depositAmount, `checkin:${input.hotelId}:${input.orderNo}`, stamp, stamp],
  );
  // One row per reservation unless the booking really has several rooms. A second
  // writer inserting its own row would double SUM(nightly_rate) at checkout.
  await db.run(
    "INSERT OR IGNORE INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) SELECT ?, ?, ?, id, ?, NULL, ?, 0, ?, ? FROM reservations WHERE hotel_id = ? AND reservation_no = ? AND NOT EXISTS (SELECT 1 FROM reservation_rooms existing WHERE existing.hotel_id = reservations.hotel_id AND existing.reservation_id = reservations.id)",
    [`res-room-${input.orderNo}`, input.tenantId, input.hotelId, roomTypeId, Math.round(input.roomAmount / Math.max(1, input.nights * input.roomCount)), stamp, stamp, input.hotelId, input.orderNo],
  );
  const order = await db.first<{ id: string; order_no: string; total_amount: number }>("SELECT id, order_no, total_amount FROM orders WHERE hotel_id = ? AND order_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  const reservation = await db.first<{ id: string; status: number }>("SELECT id, status FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  return { orderNo: input.orderNo, orderId: order?.id ?? null, reservationId: reservation?.id ?? null, reservationStatus: reservation ? Number(reservation.status) : null };
}

const SELLABLE_ROOM_SQL = "SELECT r.room_number AS room_number FROM rooms r WHERE r.hotel_id = ? AND r.room_type_id = ? AND r.status = ? AND NOT EXISTS (SELECT 1 FROM reservation_rooms rr JOIN reservations res ON res.id = rr.reservation_id AND res.hotel_id = rr.hotel_id WHERE rr.hotel_id = r.hotel_id AND rr.room_id = r.id AND res.status = ?) ORDER BY r.room_number LIMIT 1";
const RESERVATION_ROOM_TYPE_SQL = "SELECT r.id AS id, (SELECT rr.room_type_id FROM reservation_rooms rr WHERE rr.hotel_id = r.hotel_id AND rr.reservation_id = r.id AND rr.room_type_id IS NOT NULL LIMIT 1) AS room_type_id FROM reservations r WHERE r.hotel_id = ? AND r.reservation_no = ? LIMIT 1";

/**
 * Nobody standing at the kiosk knows which rooms are clean, so the terminal must
 * not name one. Sellable means VACANT_CLEAN and not already promised to a guest
 * who is currently in house; a dirty room is never handed to a new arrival.
 */
export async function pickSellableRoomWith(db: SqlRunner, input: { hotelId: string; roomTypeId: string }) {
  const row = await db.first<{ room_number: string }>(SELLABLE_ROOM_SQL, [input.hotelId, input.roomTypeId, ROOM_STATUS.VACANT_CLEAN, RESERVATION_STATUS.CHECKED_IN]);
  return row?.room_number ?? null;
}

/**
 * Holds the room the guest is about to walk into. When the caller names a room
 * the hold must succeed on that room or fail loudly; when it does not, the
 * service picks a sellable room of the booked type and returns which one.
 */
export async function holdFormalRoom(db: SqlRunner, input: { tenantId: string; hotelId: string; orderNo: string; roomNumber?: string | null; roomTypeName: string; requestId: string }) {
  const stamp = new Date().toISOString();
  const reservation = await db.first<{ id: string; room_type_id: string | null }>(RESERVATION_ROOM_TYPE_SQL, [input.hotelId, input.orderNo]);
  if (!reservation) throw new Error("reservation_not_found");
  const bookedTypeId = reservation.room_type_id ?? formalRoomTypeId(input.hotelId, canonicalRoomType(input.roomTypeName).code);
  const requested = (input.roomNumber ?? "").trim();
  const roomNumber = requested || (await pickSellableRoomWith(db, { hotelId: input.hotelId, roomTypeId: bookedTypeId }));
  if (!roomNumber) throw new Error(CHECKIN_ERRORS.NO_SELLABLE_ROOM);
  const roomId = formalRoomId(input.hotelId, roomNumber);
  const floor = Number(roomNumber.slice(0, -2)) || null;
  if (requested) {
    // A named room may be one the catalog has never seen; a picked room always exists.
    await db.run(
      "INSERT OR IGNORE INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)",
      [roomId, input.tenantId, input.hotelId, bookedTypeId, roomNumber, floor, ROOM_STATUS.VACANT_CLEAN, stamp, stamp],
    );
  }
  const held = await db.run(
    "UPDATE rooms SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND room_number = ? AND status = ?",
    [ROOM_STATUS.HELD, stamp, input.hotelId, roomNumber, ROOM_STATUS.VACANT_CLEAN],
  );
  if (held.changes) {
    await db.run(
      "INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'guest_flow', NULL, ?, ?)",
      [`rlog-${input.requestId}-hold`, input.tenantId, input.hotelId, roomId, ROOM_STATUS.VACANT_CLEAN, ROOM_STATUS.HELD, "check-in room hold", input.requestId, stamp],
    );
  } else {
    const assigned = await db.first<{ room_id: string | null; status: number | null }>(
      "SELECT rr.room_id AS room_id, room.status AS status FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id LEFT JOIN rooms room ON room.id = rr.room_id AND room.hotel_id = rr.hotel_id WHERE rr.hotel_id = ? AND r.reservation_no = ? LIMIT 1",
      [input.hotelId, input.orderNo],
    );
    // Replaying our own hold is fine; anyone else's room is a conflict.
    const ours = assigned?.room_id === roomId && (Number(assigned?.status) === ROOM_STATUS.HELD || Number(assigned?.status) === ROOM_STATUS.OCCUPIED);
    if (!ours) throw new Error(CHECKIN_ERRORS.ROOM_CONFLICT);
  }
  await db.run(
    "UPDATE reservation_rooms SET room_id = (SELECT id FROM rooms WHERE hotel_id = ? AND room_number = ? LIMIT 1), updated_at = ? WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1)",
    [input.hotelId, roomNumber, stamp, input.hotelId, input.hotelId, input.orderNo],
  );
  return { roomId, roomNumber, roomTypeId: bookedTypeId, held: Boolean(held.changes) };
}

export async function confirmFormalCheckin(db: SqlRunner, input: { tenantId: string; hotelId: string; orderNo: string; requestId: string }) {
  const stamp = new Date().toISOString();
  const reservation = await db.first<{ id: string; status: number }>("SELECT id, status FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  if (!reservation) throw new Error("reservation_not_found");
  const reservable = Number(reservation.status) === RESERVATION_STATUS.CONFIRMED || Number(reservation.status) === RESERVATION_STATUS.CHECKED_IN;
  if (reservable) {
    // Checked before anything is written: a stay created without a held room
    // would hand the guest a keycard to a room the hotel still believes is empty.
    const heldRoom = await db.first<{ status: number }>(
      "SELECT room.status AS status FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id JOIN rooms room ON room.id = rr.room_id AND room.hotel_id = rr.hotel_id WHERE rr.hotel_id = ? AND r.reservation_no = ? LIMIT 1",
      [input.hotelId, input.orderNo],
    );
    if (!heldRoom || (Number(heldRoom.status) !== ROOM_STATUS.HELD && Number(heldRoom.status) !== ROOM_STATUS.OCCUPIED)) {
      throw new Error(CHECKIN_ERRORS.ROOM_NOT_HELD);
    }
  }
  const moved = await db.run(
    "UPDATE reservations SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND reservation_no = ? AND status = ?",
    [RESERVATION_STATUS.CHECKED_IN, stamp, input.hotelId, input.orderNo, RESERVATION_STATUS.CONFIRMED],
  );
  if (moved.changes) {
    await db.run(
      "INSERT INTO reservation_status_logs (id, tenant_id, hotel_id, reservation_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'guest_flow', NULL, ?, ?)",
      [`rslog-${input.requestId}-checkin`, input.tenantId, input.hotelId, reservation.id, RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.CHECKED_IN, "check-in confirmed", input.requestId, stamp],
    );
  } else if (Number(reservation.status) !== RESERVATION_STATUS.CHECKED_IN) {
    throw new Error("reservation_status_conflict");
  }
  await db.run(
    "INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) SELECT 'stay-' || id, tenant_id, hotel_id, id, guest_name_masked, phone_last4, NULL, ?, ?, NULL, 1, ?, ? FROM reservations WHERE hotel_id = ? AND reservation_no = ? ON CONFLICT(id) DO UPDATE SET status = excluded.status, checked_in_at = excluded.checked_in_at, version = stays.version + 1, updated_at = excluded.updated_at",
    [STAY_STATUS.IN_HOUSE, stamp, stamp, stamp, input.hotelId, input.orderNo],
  );
  const occupied = await db.run(
    "UPDATE rooms SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND status = ? AND id = (SELECT room_id FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = ? LIMIT 1)",
    [ROOM_STATUS.OCCUPIED, stamp, input.hotelId, ROOM_STATUS.HELD, input.hotelId, reservation.id],
  );
  if (!occupied.changes) {
    // A stay whose room never became occupied is not a check-in: the hold was
    // lost or never happened, and the guest would be holding a keycard to a room
    // the hotel still believes is empty.
    const assignedRoom = await db.first<{ status: number }>(
      "SELECT room.status AS status FROM rooms room JOIN reservation_rooms rr ON rr.room_id = room.id AND rr.hotel_id = room.hotel_id WHERE rr.hotel_id = ? AND rr.reservation_id = ? LIMIT 1",
      [input.hotelId, reservation.id],
    );
    if (!assignedRoom || Number(assignedRoom.status) !== ROOM_STATUS.OCCUPIED) throw new Error(CHECKIN_ERRORS.ROOM_NOT_HELD);
  }
  await db.run(
    "UPDATE reservation_rooms SET status = 1, updated_at = ? WHERE hotel_id = ? AND reservation_id = ?",
    [stamp, input.hotelId, reservation.id],
  );
  if (occupied.changes) {
    await db.run(
      "INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) SELECT ?, ?, ?, room_id, ?, ?, 'check-in confirmed', 'guest_flow', NULL, ?, ? FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = ? AND room_id IS NOT NULL LIMIT 1",
      [`rlog-${input.requestId}-occupied`, input.tenantId, input.hotelId, ROOM_STATUS.HELD, ROOM_STATUS.OCCUPIED, input.requestId, stamp, input.hotelId, reservation.id],
    );
  }
  return { reservationId: reservation.id, checkedIn: true };
}

/** Only the demo compatibility columns are written; formal tables stay authoritative. */
export async function projectCheckinToLegacy(db: SqlRunner, input: { hotelId: string; orderNo: string; status?: string; roomNumber?: string | null }) {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (input.status) { clauses.push("status = ?"); params.push(input.status); }
  if (input.roomNumber !== undefined) { clauses.push("room_number = ?"); params.push(input.roomNumber); }
  if (!clauses.length) return 0;
  clauses.push("updated_at = ?");
  params.push(new Date().toISOString(), input.hotelId, input.orderNo);
  const result = await db.run(`UPDATE demo_orders SET ${clauses.join(", ")} WHERE hotel_id = ? AND order_code = ?`, params);
  return result.changes;
}
