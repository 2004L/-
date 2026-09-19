import { getD1 } from "@/db";
import {
  LEGACY_ORDER_STATUS_TO_RESERVATION,
  ROOM_TYPE_CATALOG,
  canonicalRoomType,
  formalRoomTypeId,
  legacyOccupiedStatusList,
} from "@/lib/hotel-core";
import { ensureOrdersSchema } from "@/lib/orders";
import { ordersLegacyBackfillSql } from "@/lib/orders-core";

/**
 * Bridges the existing demo_orders projection into the formal phase-2 tables.
 * It is idempotent and contains no DDL; schema creation belongs to migration
 * 0008/0009/0014. Room types and room ids resolve through lib/hotel-core.ts so
 * the legacy and formal vocabularies cannot drift apart again.
 */
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

export async function syncLegacyCore(input: { tenantId: string; hotelId: string }) {
  const db = getD1();
  const stamp = new Date().toISOString();
  const occupied = legacyOccupiedStatusList();
  const reservationStatus = reservationStatusCase();
  const stayStatus = `CASE WHEN status = 'checked_out' THEN 3 WHEN status IN (${occupied}) THEN 2 ELSE 0 END`;
  const occupiedExists = (alias: string) => `EXISTS (SELECT 1 FROM demo_orders ${alias} WHERE ${alias}.hotel_id = demo_orders.hotel_id AND ${alias}.room_number = demo_orders.room_number AND ${alias}.status IN (${occupied}))`;

  const distinctTypes = await db.prepare("SELECT DISTINCT room_type FROM demo_orders WHERE hotel_id = ? AND room_type IS NOT NULL").bind(input.hotelId).all<{ room_type: string }>();
  const typeStatements = distinctTypes.results.map((row) => {
    const type = canonicalRoomType(row.room_type);
    return db.prepare("INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 2, 1, ?, ?)")
      .bind(formalRoomTypeId(input.hotelId, type.code), input.tenantId, input.hotelId, type.code, type.name, type.pmsCode, stamp, stamp);
  });

  await db.batch([
    ...typeStatements,
    db.prepare(`INSERT OR IGNORE INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) SELECT 'room-' || hotel_id || '-' || room_number, ?, hotel_id, ${roomTypeIdCase(input.hotelId)}, room_number, CAST(substr(room_number, 1, length(room_number) - 2) AS INTEGER), CASE WHEN ${occupiedExists("occupied")} THEN 3 ELSE 0 END, 1, NULL, ?, ? FROM demo_orders WHERE hotel_id = ? AND room_number IS NOT NULL GROUP BY hotel_id, room_number`).bind(input.tenantId, stamp, stamp, input.hotelId),
    db.prepare(`INSERT OR IGNORE INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) SELECT 'res-' || id, ?, hotel_id, order_code, source, order_code, guest_label, phone_last4, NULL, ${reservationStatus}, stay_date, nights, room_count, total_amount, deposit_amount, 'CNY', 1, 'legacy:' || id, created_at, updated_at FROM demo_orders WHERE hotel_id = ?`).bind(input.tenantId, input.hotelId),
    db.prepare(`INSERT OR IGNORE INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) SELECT 'res-room-' || id, ?, hotel_id, 'res-' || id, ${roomTypeIdCase(input.hotelId)}, CASE WHEN room_number IS NULL THEN NULL ELSE 'room-' || hotel_id || '-' || room_number END, room_amount / CASE WHEN nights = 0 THEN 1 ELSE nights END, CASE WHEN room_number IS NULL THEN 0 ELSE 1 END, created_at, updated_at FROM demo_orders WHERE hotel_id = ? AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = 'res-' || demo_orders.id) AND NOT EXISTS (SELECT 1 FROM reservation_rooms existing WHERE existing.hotel_id = demo_orders.hotel_id AND existing.reservation_id = 'res-' || demo_orders.id)`).bind(input.tenantId, input.hotelId),
    db.prepare(`INSERT OR IGNORE INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) SELECT 'stay-' || id, ?, hotel_id, 'res-' || id, guest_label, phone_last4, NULL, ${stayStatus}, CASE WHEN status IN (${occupied}) THEN updated_at ELSE NULL END, CASE WHEN status = 'checked_out' THEN updated_at ELSE NULL END, 1, created_at, updated_at FROM demo_orders WHERE hotel_id = ? AND status IN (${occupied}, 'checked_out')`).bind(input.tenantId, input.hotelId),
  ]);
  try {
    await ensureOrdersSchema();
    await db.prepare(ordersLegacyBackfillSql()).bind(input.tenantId, input.hotelId).run();
  } catch (error) {
    console.warn("[orders] legacy order projection skipped", error instanceof Error ? error.message : "unknown_error");
  }
}
