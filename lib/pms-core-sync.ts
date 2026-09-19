import { getD1 } from "@/db";
import { formalRoomId } from "@/lib/hotel-core";
import { simulatorPms } from "@/services/pms/simulator-adapter";

/**
 * Syncs the PMS room catalog into the formal rooms projection.
 *
 * The catalog owns metadata only: room identity and occupancy belong to the
 * formal rooms table. Existing rooms are matched by (hotel_id, room_number)
 * and updated in place; status and version are never overwritten here, because
 * occupancy changes must go through the compare-and-swap room workflow.
 */
export async function syncPmsRoomCatalog(input: { tenantId: string; hotelId: string; hotelCode: string }) {
  const rooms = await simulatorPms.getRooms({}, {
    hotelId: input.hotelId,
    hotelCode: input.hotelCode,
    requestId: `pms-room-sync-${crypto.randomUUID()}`,
  });
  const stamp = new Date().toISOString();
  const db = getD1();
  const uniqueTypes = new Map(rooms.map((room) => [room.roomTypeCode, room.roomTypeCode]));
  const statements = [
    ...Array.from(uniqueTypes.values()).map((roomTypeCode) => db.prepare(
      "INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 2, 1, ?, ?)"
    ).bind(`pms-rt-${input.hotelId}-${roomTypeCode}`, input.tenantId, input.hotelId, roomTypeCode, roomTypeCode, roomTypeCode, stamp, stamp)),
    ...rooms.map((room) => db.prepare(
      `INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(hotel_id, room_number) DO UPDATE SET room_type_id = excluded.room_type_id, floor = excluded.floor, pms_room_id = excluded.pms_room_id, updated_at = excluded.updated_at`
    ).bind(
      formalRoomId(input.hotelId, room.roomNumber),
      input.tenantId,
      input.hotelId,
      `pms-rt-${input.hotelId}-${room.roomTypeCode}`,
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
