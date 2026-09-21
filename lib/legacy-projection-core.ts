import {
  LEGACY_ORDER_STATUS_TO_RESERVATION,
  ROOM_TYPE_CATALOG,
  canonicalRoomType,
  formalRoomTypeId,
  legacyOccupiedStatusList,
} from "./hotel-core.ts";
import type { SqlValue } from "./orders-core.ts";

/**
 * The demo->formal projection, as plain statements rather than executed SQL, so the
 * exact statements that ship are the ones the integration test runs on a real D1
 * binding. It is idempotent and contains no DDL; schema creation belongs to the
 * migrations. Room types and room ids resolve through lib/hotel-core.ts so the
 * legacy and formal vocabularies cannot drift apart again.
 */
export type LegacyStatement = { sql: string; params: SqlValue[] };

function reservationStatusCase() {
  const cases = Object.entries(LEGACY_ORDER_STATUS_TO_RESERVATION)
    .map(([legacy, formal]) => `WHEN '${legacy}' THEN ${formal}`)
    .join(" ");
  return `CASE status ${cases} ELSE 0 END`;
}

function roomTypeIdCase(hotelId: string) {
  const cases = ROOM_TYPE_CATALOG
    .flatMap((type) => [`WHEN '${type.name}' THEN '${formalRoomTypeId(hotelId, type.code)}'`, `WHEN '${type.code}' THEN '${formalRoomTypeId(hotelId, type.code)}'`])
    .join(" ");
  return `CASE room_type ${cases} ELSE 'rt-' || hotel_id || '-' || room_type END`;
}

/** The status words the terminal's demo copy understands. */
export const DEMO_STATUS = {
  AVAILABLE: "awaiting_arrival",
  IN_HOUSE: "in_house",
  CHECKED_OUT: "checked_out",
  CANCELLED: "cancelled",
} as const;


/**
 * Pull one session's demo copies back in line with the bookings.
 *
 * The demo copy used to drift in both directions: checking in stamped every
 * session's copy of that order ("in house" for a guest who left days ago), and
 * checking out never wrote back at all. Only bookings in a state the guest cannot
 * return from are mirrored, so a session that is midway through a check-in is never
 * knocked back to "awaiting arrival".
 */
/** Status words the terminal writes on its demo copy. */
const CHECKIN_CONFIRMED = "checkin_confirmed";
const KNOWN_DEMO_STATUSES = [DEMO_STATUS.AVAILABLE, CHECKIN_CONFIRMED, DEMO_STATUS.IN_HOUSE, DEMO_STATUS.CHECKED_OUT, DEMO_STATUS.CANCELLED];

/**
 * The demo copy is stale exactly when the pair (demo status, booking status) cannot
 * describe the same guest. Enumerating the impossible pairs instead of mirroring
 * everything is what keeps a session that is midway through a check-in intact:
 * "awaiting arrival + confirmed booking" and "check-in confirmed + confirmed
 * booking" are both legitimate, because the hold and the payment happen before the
 * booking flips to checked in.
 */
function mirrorFragments() {
  const booking = "r.hotel_id = demo_orders.hotel_id AND r.reservation_no = demo_orders.order_code";
  const roomLookup = "(SELECT rm.room_number FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id AND rm.hotel_id = rr.hotel_id WHERE rr.hotel_id = r.hotel_id AND rr.reservation_id = r.id AND rr.room_id IS NOT NULL LIMIT 1)";
  const impossiblePair = [
    `(demo_orders.status = '${DEMO_STATUS.IN_HOUSE}' AND r.status <> 2)`,
    `(demo_orders.status = '${DEMO_STATUS.CHECKED_OUT}' AND r.status <> 3)`,
    `(demo_orders.status = '${DEMO_STATUS.AVAILABLE}' AND r.status NOT IN (0, 1))`,
    `(demo_orders.status = '${CHECKIN_CONFIRMED}' AND r.status NOT IN (1, 2))`,
    `(demo_orders.status = '${DEMO_STATUS.CANCELLED}' AND r.status <> 4)`,
  ].join(" OR ");
  return {
    guard: `demo_orders.status IN (${KNOWN_DEMO_STATUSES.map((status) => `'${status}'`).join(", ")}) AND EXISTS (SELECT 1 FROM reservations r WHERE ${booking} AND (${impossiblePair}))`,
    set: `status = (SELECT CASE r.status WHEN 2 THEN '${DEMO_STATUS.IN_HOUSE}' WHEN 3 THEN '${DEMO_STATUS.CHECKED_OUT}' WHEN 4 THEN '${DEMO_STATUS.CANCELLED}' ELSE '${DEMO_STATUS.AVAILABLE}' END FROM reservations r WHERE ${booking}), room_number = (SELECT CASE WHEN r.status = 2 THEN ${roomLookup} ELSE NULL END FROM reservations r WHERE ${booking})`,
  };
}

export function demoOrderReconcileStatement(input: { hotelId: string; sessionId: string; stamp: string }): LegacyStatement {
  const mirror = mirrorFragments();
  return {
    sql: `UPDATE demo_orders SET ${mirror.set}, updated_at = ? WHERE demo_orders.hotel_id = ? AND demo_orders.session_id = ? AND ${mirror.guard}`,
    params: [input.stamp, input.hotelId, input.sessionId],
  };
}

/**
 * The same mirroring for every session of the hotel. Used by the "bring the console
 * back in line" action: sessions nobody opens again would otherwise keep their stale
 * copies forever, and the console would keep disagreeing with the bookings.
 */
export function demoOrderReconcileAllStatement(input: { hotelId: string; stamp: string }): LegacyStatement {
  const mirror = mirrorFragments();
  return {
    sql: `UPDATE demo_orders SET ${mirror.set}, updated_at = ? WHERE demo_orders.hotel_id = ? AND ${mirror.guard}`,
    params: [input.stamp, input.hotelId],
  };
}

/** How many demo copies are stale right now, so the action can report a real number. */
export function demoOrderReconcileCountStatement(input: { hotelId: string }): LegacyStatement {
  const mirror = mirrorFragments();
  return { sql: `SELECT COUNT(*) AS c FROM demo_orders WHERE demo_orders.hotel_id = ? AND ${mirror.guard}`, params: [input.hotelId] };
}
/** Orders whose booking was checked out inside the window, as the demo side sees them. */
export type ReleaseWindow = { hotelId: string; windowStart: string; windowEnd: string; checkedOutStayStatus: number };

function releasePredicate(input: ReleaseWindow) {
  return {
    where: `demo_orders.hotel_id = ? AND demo_orders.status IN ('${DEMO_STATUS.IN_HOUSE}', '${CHECKIN_CONFIRMED}', '${DEMO_STATUS.CHECKED_OUT}') AND EXISTS (SELECT 1 FROM reservations r JOIN stays st ON st.reservation_id = r.id AND st.hotel_id = r.hotel_id WHERE r.hotel_id = demo_orders.hotel_id AND r.reservation_no = demo_orders.order_code AND st.hotel_id = ? AND st.status = ? AND st.checked_out_at IS NOT NULL AND st.checked_out_at >= ? AND st.checked_out_at <= ?)`,
    params: [input.hotelId, input.hotelId, input.checkedOutStayStatus, input.windowStart, input.windowEnd],
  };
}

/**
 * Hand a purged order back to the demo side. Retention deletes the booking, so the
 * demo copies can no longer mirror anything — they would otherwise keep claiming the
 * guest is still in the room. Runs before the deletes, while the stays are readable.
 */
export function demoOrderReleaseStatement(input: ReleaseWindow & { stamp: string }): LegacyStatement {
  const predicate = releasePredicate(input);
  return {
    sql: `UPDATE demo_orders SET status = '${DEMO_STATUS.AVAILABLE}', room_number = NULL, updated_at = ? WHERE ${predicate.where}`,
    params: [input.stamp, ...predicate.params],
  };
}

/** How many demo copies the same release would touch, for the confirmation card. */
export function demoOrderReleaseCount(input: ReleaseWindow): LegacyStatement {
  const predicate = releasePredicate(input);
  return { sql: `SELECT COUNT(*) AS c FROM demo_orders WHERE ${predicate.where}`, params: predicate.params };
}

export function legacyCoreStatements(input: { tenantId: string; hotelId: string; stamp: string; roomTypes: string[] }): LegacyStatement[] {
  const { tenantId, hotelId, stamp } = input;
  const occupied = legacyOccupiedStatusList();
  const reservationStatus = reservationStatusCase();
  const occupiedExists = (alias: string) => `EXISTS (SELECT 1 FROM demo_orders ${alias} WHERE ${alias}.hotel_id = demo_orders.hotel_id AND ${alias}.room_number = demo_orders.room_number AND ${alias}.status IN (${occupied}))`;

  /**
   * Children hang off the booking that actually exists for this order number, never
   * off an id this session invented. `reservations` is unique on
   * (hotel_id, reservation_no), so only the first writer's id survives; every other
   * session used to insert a stay pointing at a booking that was silently dropped,
   * and the one session whose invented id happened to match wrote a second stay for
   * the same booking. Resolving through the order number makes both writers meet on
   * the same row.
   */
  const realReservationId = "(SELECT r.id FROM reservations r WHERE r.hotel_id = demo_orders.hotel_id AND r.reservation_no = demo_orders.order_code)";
  const hasReservation = "EXISTS (SELECT 1 FROM reservations r WHERE r.hotel_id = demo_orders.hotel_id AND r.reservation_no = demo_orders.order_code)";
  /**
   * The stay mirrors the booking, never the other way round. demo_orders is a
   * per-session projection, so one session can still hold a stale "in house" long
   * after the booking was re-seeded; copying that in would create a guest the
   * booking says is not here. Reservation status 2/3 are exactly the stay statuses
   * IN_HOUSE/CHECKED_OUT, so the booking's own status becomes the stay's status.
   */
  const realReservationStatus = "(SELECT r.status FROM reservations r WHERE r.hotel_id = demo_orders.hotel_id AND r.reservation_no = demo_orders.order_code)";
  const bookingSaysStayed = `(${realReservationStatus}) IN (2, 3)`;
  const noRoomRowYet = `NOT EXISTS (SELECT 1 FROM reservation_rooms existing WHERE existing.hotel_id = demo_orders.hotel_id AND existing.reservation_id = ${realReservationId})`;
  const noStayYet = `NOT EXISTS (SELECT 1 FROM stays existing WHERE existing.hotel_id = demo_orders.hotel_id AND existing.reservation_id = ${realReservationId})`;

  const statements: LegacyStatement[] = input.roomTypes.map((name) => {
    const type = canonicalRoomType(name);
    return {
      sql: "INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 2, 1, ?, ?)",
      params: [formalRoomTypeId(hotelId, type.code), tenantId, hotelId, type.code, type.name, type.pmsCode, stamp, stamp],
    };
  });

  statements.push(
    {
      // The booking itself: still INSERT OR IGNORE, because the unique key on
      // (hotel_id, reservation_no) is what keeps the whole projection idempotent.
      sql: `INSERT OR IGNORE INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) SELECT 'res-' || id, ?, hotel_id, order_code, source, order_code, guest_label, phone_last4, NULL, ${reservationStatus}, stay_date, nights, room_count, total_amount, deposit_amount, 'CNY', 1, 'legacy:' || id, created_at, updated_at FROM demo_orders WHERE hotel_id = ?`,
      params: [tenantId, hotelId],
    },
    {
      sql: `INSERT OR IGNORE INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) SELECT 'room-' || hotel_id || '-' || room_number, ?, hotel_id, ${roomTypeIdCase(hotelId)}, room_number, CAST(substr(room_number, 1, length(room_number) - 2) AS INTEGER), CASE WHEN ${occupiedExists("occupied")} THEN 3 ELSE 0 END, 1, NULL, ?, ? FROM demo_orders WHERE hotel_id = ? AND room_number IS NOT NULL GROUP BY hotel_id, room_number`,
      params: [tenantId, stamp, stamp, hotelId],
    },
    {
      sql: `INSERT OR IGNORE INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) SELECT 'res-room-' || (${realReservationId}), ?, demo_orders.hotel_id, ${realReservationId}, ${roomTypeIdCase(hotelId)}, CASE WHEN room_number IS NULL THEN NULL ELSE 'room-' || hotel_id || '-' || room_number END, room_amount / CASE WHEN nights = 0 THEN 1 ELSE nights END, CASE WHEN room_number IS NULL THEN 0 ELSE 1 END, created_at, updated_at FROM demo_orders WHERE hotel_id = ? AND ${hasReservation} AND ${noRoomRowYet}`,
      params: [tenantId, hotelId],
    },
    {
      sql: `INSERT OR IGNORE INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) SELECT 'stay-' || (${realReservationId}), ?, demo_orders.hotel_id, ${realReservationId}, guest_label, phone_last4, NULL, ${realReservationStatus}, CASE WHEN ${bookingSaysStayed} THEN updated_at ELSE NULL END, CASE WHEN (${realReservationStatus}) = 3 THEN updated_at ELSE NULL END, 1, created_at, updated_at FROM demo_orders WHERE hotel_id = ? AND ${bookingSaysStayed} AND ${noStayYet}`,
      params: [tenantId, hotelId],
    },
  );
  return statements;
}