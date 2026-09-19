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
  await db.run(
    "INSERT OR IGNORE INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) SELECT ?, ?, ?, id, ?, NULL, ?, 0, ?, ? FROM reservations WHERE hotel_id = ? AND reservation_no = ?",
    [`res-room-${input.orderNo}`, input.tenantId, input.hotelId, roomTypeId, Math.round(input.roomAmount / Math.max(1, input.nights * input.roomCount)), stamp, stamp, input.hotelId, input.orderNo],
  );
  const order = await db.first<{ id: string; order_no: string; total_amount: number }>("SELECT id, order_no, total_amount FROM orders WHERE hotel_id = ? AND order_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  const reservation = await db.first<{ id: string; status: number }>("SELECT id, status FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  return { orderNo: input.orderNo, orderId: order?.id ?? null, reservationId: reservation?.id ?? null, reservationStatus: reservation ? Number(reservation.status) : null };
}

export async function holdFormalRoom(db: SqlRunner, input: { tenantId: string; hotelId: string; orderNo: string; roomNumber: string; roomTypeName: string; requestId: string }) {
  const stamp = new Date().toISOString();
  const roomId = formalRoomId(input.hotelId, input.roomNumber);
  const roomTypeId = formalRoomTypeId(input.hotelId, canonicalRoomType(input.roomTypeName).code);
  const floor = Number(input.roomNumber.slice(0, -2)) || null;
  await db.run(
    "INSERT OR IGNORE INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)",
    [roomId, input.tenantId, input.hotelId, roomTypeId, input.roomNumber, floor, ROOM_STATUS.VACANT_CLEAN, stamp, stamp],
  );
  const held = await db.run(
    "UPDATE rooms SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND room_number = ? AND status = ?",
    [ROOM_STATUS.HELD, stamp, input.hotelId, input.roomNumber, ROOM_STATUS.VACANT_CLEAN],
  );
  if (held.changes) {
    await db.run(
      "INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'guest_flow', NULL, ?, ?)",
      [`rlog-${input.requestId}-hold`, input.tenantId, input.hotelId, roomId, ROOM_STATUS.VACANT_CLEAN, ROOM_STATUS.HELD, "check-in room hold", input.requestId, stamp],
    );
  } else {
    const assigned = await db.first<{ room_id: string | null }>(
      "SELECT rr.room_id AS room_id FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id WHERE r.hotel_id = ? AND r.reservation_no = ? LIMIT 1",
      [input.hotelId, input.orderNo],
    );
    if (assigned?.room_id !== roomId) throw new Error("room_conflict");
  }
  await db.run(
    "UPDATE reservation_rooms SET room_id = (SELECT id FROM rooms WHERE hotel_id = ? AND room_number = ? LIMIT 1), updated_at = ? WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1)",
    [input.hotelId, input.roomNumber, stamp, input.hotelId, input.hotelId, input.orderNo],
  );
  return { roomId, roomNumber: input.roomNumber, held: Boolean(held.changes) };
}

export async function confirmFormalCheckin(db: SqlRunner, input: { tenantId: string; hotelId: string; orderNo: string; requestId: string }) {
  const stamp = new Date().toISOString();
  const reservation = await db.first<{ id: string; status: number }>("SELECT id, status FROM reservations WHERE hotel_id = ? AND reservation_no = ? LIMIT 1", [input.hotelId, input.orderNo]);
  if (!reservation) throw new Error("reservation_not_found");
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
