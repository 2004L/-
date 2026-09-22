import {
  PmsAdapter,
  type PmsAdapterContext,
  type PmsOrder,
  type PmsRoom,
  ROOM_STATUS,
  RESERVATION_STATUS,
} from "@/lib/hotel-core";

const orders: PmsOrder[] = [
  { reservationNo: "SIM-MEITUAN-4821", source: "美团", status: RESERVATION_STATUS.CONFIRMED, phoneLast4: "4821", stayDate: "2026-09-17", nights: 1, roomCount: 1, roomTypeCode: "DLX-KING", totalAmount: 68000, depositAmount: 30000 },
  { reservationNo: "SIM-DY-22881", source: "抖音团购", status: RESERVATION_STATUS.CONFIRMED, phoneLast4: "2288", stayDate: "2026-09-17", nights: 1, roomCount: 1, roomTypeCode: "DLX-TWIN", totalAmount: 72000, depositAmount: 30000 },
];

const rooms: PmsRoom[] = [
  { roomNumber: "1208", roomTypeCode: "DLX-KING", status: ROOM_STATUS.OCCUPIED, pmsRoomId: "sim-1208" },
  { roomNumber: "1306", roomTypeCode: "DLX-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1306" },
  { roomNumber: "1307", roomTypeCode: "DLX-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1307" },
  { roomNumber: "1308", roomTypeCode: "DLX-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1308" },
  { roomNumber: "1210", roomTypeCode: "DLX-TWIN", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1210" },
  { roomNumber: "1211", roomTypeCode: "DLX-TWIN", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1211" },
  // 演示订单里卖的是三种房型，模拟酒店就必须有这三种房；少一种，那一类订单
  // 在自助终端只会一路走到 no_sellable_room 转人工。
  { roomNumber: "1108", roomTypeCode: "STD-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1108" },
  { roomNumber: "1109", roomTypeCode: "STD-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1109" },
  { roomNumber: "1110", roomTypeCode: "STD-KING", status: ROOM_STATUS.VACANT_CLEAN, pmsRoomId: "sim-1110" },
];

function ensureContext(context: PmsAdapterContext) {
  if (!context.hotelId || !context.hotelCode || !context.requestId) throw new Error("pms_context_required");
}

export class SimulatorPmsAdapter implements PmsAdapter {
  async searchOrders(input: { phoneLast4?: string; reservationNo?: string }, context: PmsAdapterContext) {
    ensureContext(context);
    return orders.filter((order) => (!input.phoneLast4 || order.phoneLast4 === input.phoneLast4) && (!input.reservationNo || order.reservationNo === input.reservationNo));
  }

  async getRooms(input: { roomTypeCode?: string; status?: (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS] }, context: PmsAdapterContext) {
    ensureContext(context);
    return rooms.filter((room) => (!input.roomTypeCode || room.roomTypeCode === input.roomTypeCode) && (input.status === undefined || room.status === input.status));
  }

  async holdRoom(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext) {
    ensureContext(context);
    if (!input.idempotencyKey) throw new Error("pms_idempotency_required");
    const room = rooms.find((item) => item.roomNumber === input.roomNumber);
    const order = orders.find((item) => item.reservationNo === input.reservationNo);
    if (!room || !order || room.status !== ROOM_STATUS.VACANT_CLEAN) return { status: "conflict" as const };
    room.status = ROOM_STATUS.HELD;
    return { status: "held" as const, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  }

  async confirmCheckin(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext) {
    ensureContext(context);
    const room = rooms.find((item) => item.roomNumber === input.roomNumber);
    const order = orders.find((item) => item.reservationNo === input.reservationNo);
    if (!room || !order || (room.status !== ROOM_STATUS.HELD && room.status !== ROOM_STATUS.VACANT_CLEAN)) return { status: "conflict" as const };
    room.status = ROOM_STATUS.OCCUPIED;
    order.status = RESERVATION_STATUS.CHECKED_IN;
    return { status: "checked-in" as const, receipt: `SIM-CHECKIN-${input.reservationNo}` };
  }

  async checkout(input: { reservationNo: string; idempotencyKey: string }, context: PmsAdapterContext) {
    ensureContext(context);
    const order = orders.find((item) => item.reservationNo === input.reservationNo);
    if (!order) return { status: "conflict" as const };
    order.status = RESERVATION_STATUS.CHECKED_OUT;
    const room = rooms.find((item) => item.roomTypeCode === order.roomTypeCode && item.status === ROOM_STATUS.OCCUPIED);
    if (room) room.status = ROOM_STATUS.VACANT_DIRTY;
    return { status: "checked-out" as const, receipt: `SIM-CHECKOUT-${input.reservationNo}` };
  }
}

export const simulatorPms = new SimulatorPmsAdapter();
