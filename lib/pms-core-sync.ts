import { getD1 } from "@/db";
import { canonicalRoomType, formalRoomId, formalRoomTypeId } from "@/lib/hotel-core";
import { getPmsAdapter } from "@/services/pms/factory";

/**
 * Syncs the PMS room catalog into the formal rooms projection.
 *
 * The catalog owns metadata only: room identity and occupancy belong to the
 * formal rooms table. Existing rooms are matched by (hotel_id, room_number)
 * and updated in place; status and version are never overwritten here, because
 * occupancy changes must go through the compare-and-swap room workflow.
 */
export async function syncPmsRoomCatalog(input: { tenantId: string; hotelId: string; hotelCode: string }) {
  const rooms = await getPmsAdapter().getRooms({}, {
    hotelId: input.hotelId,
    hotelCode: input.hotelCode,
    requestId: `pms-room-sync-${crypto.randomUUID()}`,
  });
  const stamp = new Date().toISOString();
  const db = getD1();

  const existing = await db.prepare("SELECT id, room_number FROM rooms WHERE hotel_id = ?").bind(input.hotelId).all<{ id: string; room_number: string }>();
  const nonCanonical = existing.results.filter((row) => row.id !== formalRoomId(input.hotelId, row.room_number));
  if (nonCanonical.length) {
    // The upsert below conflicts on room_number, so it can never repair an id.
    console.warn(`[pms][rooms] ${nonCanonical.length} room row(s) still use a non-canonical id; apply migration 0014_data_governance.sql (e.g. ${nonCanonical.slice(0, 3).map((row) => row.id).join(", ")})`);
  }

  const uniqueTypes = new Map(rooms.map((room) => {
    const type = canonicalRoomType(room.roomTypeCode);
    return [type.code, type];
  }));
  const statements = [
    ...Array.from(uniqueTypes.values()).map((type) => db.prepare(
      "INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 2, 1, ?, ?)"
    ).bind(formalRoomTypeId(input.hotelId, type.code), input.tenantId, input.hotelId, type.code, type.name, type.pmsCode, stamp, stamp)),
    ...rooms.map((room) => db.prepare(
      `INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(hotel_id, room_number) DO UPDATE SET room_type_id = excluded.room_type_id, floor = excluded.floor, pms_room_id = excluded.pms_room_id, updated_at = excluded.updated_at`
    ).bind(
      formalRoomId(input.hotelId, room.roomNumber),
      input.tenantId,
      input.hotelId,
      formalRoomTypeId(input.hotelId, canonicalRoomType(room.roomTypeCode).code),
      room.roomNumber,
      Number(room.roomNumber.slice(0, -2)) || null,
      room.status,
      room.pmsRoomId ?? null,
      stamp,
      stamp,
    )),
  ];
  if (statements.length) await db.batch(statements);
  return rooms.length;
}
