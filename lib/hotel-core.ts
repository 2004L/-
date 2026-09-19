/**
 * Formal hotel-domain contracts used by the next workflow phase.
 * This module is deliberately side-effect free: database writes belong to
 * repositories/services, never to the model or intent router.
 */

export const ROOM_STATUS = {
  VACANT_CLEAN: 0,
  VACANT_DIRTY: 1,
  HELD: 2,
  OCCUPIED: 3,
  OUT_OF_ORDER: 4,
  OUT_OF_SERVICE: 5,
} as const;

export const RESERVATION_STATUS = {
  PENDING_CONFIRMATION: 0,
  CONFIRMED: 1,
  CHECKED_IN: 2,
  CHECKED_OUT: 3,
  CANCELLED: 4,
  NO_SHOW: 5,
} as const;

export const STAY_STATUS = {
  IDENTITY_PENDING: 0,
  IDENTITY_VERIFIED: 1,
  IN_HOUSE: 2,
  CHECKED_OUT: 3,
} as const;

/**
 * Commercial order state. An order owns money and the commercial lifecycle;
 * it is deliberately independent from the reservation (stay) state machine.
 */
export const ORDER_STATUS = {
  PENDING_PAYMENT: 0,
  PAID: 1,
  CANCELLED: 2,
  REFUNDED: 3,
  CLOSED: 4,
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];
export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  [ORDER_STATUS.PENDING_PAYMENT]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.REFUNDED, ORDER_STATUS.CLOSED],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
  [ORDER_STATUS.CLOSED]: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return from === to || orderTransitions[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransitionOrder(from, to)) throw new Error(`invalid_order_transition:${from}->${to}`);
}

/** Legacy demo order status projected onto the commercial order lifecycle. */
export const LEGACY_STATUS_TO_ORDER_STATUS: Record<string, OrderStatus> = {
  awaiting_arrival: ORDER_STATUS.PAID,
  checkin_confirmed: ORDER_STATUS.PAID,
  in_house: ORDER_STATUS.PAID,
  checked_out: ORDER_STATUS.PAID,
  cancelled: ORDER_STATUS.CANCELLED,
};

export function legacyStatusToOrderStatus(status: string): OrderStatus {
  return LEGACY_STATUS_TO_ORDER_STATUS[status] ?? ORDER_STATUS.PENDING_PAYMENT;
}

/**
 * Single mapping from the legacy demo order statuses to the formal reservation
 * state machine. Any code projecting demo_orders into the formal tables must go
 * through this map so the two vocabularies cannot drift again.
 */
export const LEGACY_ORDER_STATUS_TO_RESERVATION: Record<string, ReservationStatus> = {
  awaiting_arrival: RESERVATION_STATUS.CONFIRMED,
  checkin_confirmed: RESERVATION_STATUS.CHECKED_IN,
  in_house: RESERVATION_STATUS.CHECKED_IN,
  checked_out: RESERVATION_STATUS.CHECKED_OUT,
  cancelled: RESERVATION_STATUS.CANCELLED,
};

/** Legacy statuses that mean the guest physically occupies a room. */
export const LEGACY_OCCUPIED_STATUSES = ["in_house", "checkin_confirmed"] as const;

export function legacyOrderStatusToReservation(status: string): ReservationStatus {
  return LEGACY_ORDER_STATUS_TO_RESERVATION[status] ?? RESERVATION_STATUS.PENDING_CONFIRMATION;
}

export function legacyOccupiedStatusList(): string {
  return LEGACY_OCCUPIED_STATUSES.map((status) => `'${status}'`).join(", ");
}

/** The formal room primary key is derived from the hotel and room number only. */
export function formalRoomId(hotelId: string, roomNumber: string) {
  return `room-${hotelId}-${roomNumber}`;
}

const roomTransitions: Record<RoomStatus, readonly RoomStatus[]> = {
  [ROOM_STATUS.VACANT_CLEAN]: [ROOM_STATUS.HELD, ROOM_STATUS.OCCUPIED, ROOM_STATUS.VACANT_DIRTY, ROOM_STATUS.OUT_OF_ORDER, ROOM_STATUS.OUT_OF_SERVICE],
  [ROOM_STATUS.VACANT_DIRTY]: [ROOM_STATUS.VACANT_CLEAN, ROOM_STATUS.OUT_OF_ORDER, ROOM_STATUS.OUT_OF_SERVICE],
  [ROOM_STATUS.HELD]: [ROOM_STATUS.VACANT_CLEAN, ROOM_STATUS.OCCUPIED, ROOM_STATUS.VACANT_DIRTY],
  [ROOM_STATUS.OCCUPIED]: [ROOM_STATUS.VACANT_DIRTY, ROOM_STATUS.OUT_OF_ORDER],
  [ROOM_STATUS.OUT_OF_ORDER]: [ROOM_STATUS.VACANT_CLEAN, ROOM_STATUS.OUT_OF_SERVICE],
  [ROOM_STATUS.OUT_OF_SERVICE]: [ROOM_STATUS.VACANT_CLEAN],
};

export function canTransitionRoom(from: RoomStatus, to: RoomStatus) {
  return from === to || roomTransitions[from].includes(to);
}

export function assertRoomTransition(from: RoomStatus, to: RoomStatus) {
  if (!canTransitionRoom(from, to)) throw new Error(`invalid_room_transition:${from}->${to}`);
}

const reservationTransitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  [RESERVATION_STATUS.PENDING_CONFIRMATION]: [RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.CANCELLED],
  [RESERVATION_STATUS.CONFIRMED]: [RESERVATION_STATUS.CHECKED_IN, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.NO_SHOW],
  [RESERVATION_STATUS.CHECKED_IN]: [RESERVATION_STATUS.CHECKED_OUT],
  [RESERVATION_STATUS.CHECKED_OUT]: [],
  [RESERVATION_STATUS.CANCELLED]: [],
  [RESERVATION_STATUS.NO_SHOW]: [],
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus) {
  return from === to || reservationTransitions[from].includes(to);
}

export function assertReservationTransition(from: ReservationStatus, to: ReservationStatus) {
  if (!canTransitionReservation(from, to)) throw new Error(`invalid_reservation_transition:${from}->${to}`);
}

export type PmsOrder = {
  reservationNo: string;
  source: string;
  status: ReservationStatus;
  phoneLast4: string;
  stayDate: string;
  nights: number;
  roomCount: number;
  roomTypeCode: string;
  totalAmount: number;
  depositAmount: number;
};

export type PmsRoom = {
  roomNumber: string;
  roomTypeCode: string;
  status: RoomStatus;
  pmsRoomId?: string;
};

export type PmsAdapterContext = { hotelId: string; hotelCode: string; requestId: string };

/** Adapter contract. The simulator and a future QloApps adapter implement the same interface. */
export interface PmsAdapter {
  searchOrders(input: { phoneLast4?: string; reservationNo?: string }, context: PmsAdapterContext): Promise<PmsOrder[]>;
  getRooms(input: { roomTypeCode?: string; status?: RoomStatus }, context: PmsAdapterContext): Promise<PmsRoom[]>;
  holdRoom(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext): Promise<{ status: "held" | "conflict"; expiresAt?: string }>;
  createReservation?(input: { phoneLast4: string; roomTypeCode: string; roomCount: number; totalAmount: number; idempotencyKey: string }, context: PmsAdapterContext): Promise<{ reservationNo: string; status: ReservationStatus }>;
  confirmCheckin(input: { reservationNo: string; roomNumber: string; idempotencyKey: string }, context: PmsAdapterContext): Promise<{ status: "checked-in" | "conflict"; receipt?: string }>;
  checkout(input: { reservationNo: string; idempotencyKey: string }, context: PmsAdapterContext): Promise<{ status: "checked-out" | "conflict"; receipt?: string }>;
}

export function redactCoreContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCoreContext);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/phone|identity|id_card|token|secret/i.test(key)) output[key] = "[REDACTED]";
    else output[key] = redactCoreContext(item);
  }
  return output;
}
