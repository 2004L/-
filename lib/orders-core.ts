import {
  LEGACY_STATUS_TO_ORDER_STATUS,
  ORDER_STATUS,
  assertOrderTransition,
  type OrderStatus,
} from "./hotel-core.ts";

export type OrderAmountType = "room_amount" | "deposit_amount" | "total_amount";
export type SqlValue = string | number | null;
export type ProjectionOutcome = "projected" | "no_legacy_row" | "failed";

/** Minimal database port so the same order logic runs on D1 and in tests. */
export interface SqlRunner {
  run(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  first<T = Record<string, unknown>>(sql: string, params: SqlValue[]): Promise<T | null>;
}

export const ORDER_ERRORS = {
  NOT_FOUND: "order_not_found",
  VERSION_CONFLICT: "order_version_conflict",
  STATUS_CONFLICT: "order_status_conflict",
  IDEMPOTENCY_REUSED: "idempotency_key_reused",
  ORDER_NO_CONFLICT: "order_no_conflict",
  INVALID_AMOUNT: "invalid_order_amount",
  INVALID_AMOUNT_TYPE: "invalid_order_amount_type",
  REQUEST_INVALID: "order_request_invalid",
  CREATE_FAILED: "order_create_failed",
} as const;

export const AMOUNT_COLUMNS: Record<OrderAmountType, string> = {
  room_amount: "room_amount",
  deposit_amount: "deposit_amount",
  total_amount: "total_amount",
};

export const ORDERS_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, order_no TEXT NOT NULL, source TEXT NOT NULL, external_id TEXT, status INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY', room_amount INTEGER NOT NULL DEFAULT 0, deposit_amount INTEGER NOT NULL DEFAULT 0, total_amount INTEGER NOT NULL DEFAULT 0, paid_amount INTEGER NOT NULL DEFAULT 0, guest_name_masked TEXT, phone_last4 TEXT, reservation_no TEXT, version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS orders_hotel_no_uq ON orders(hotel_id, order_no)",
  "CREATE UNIQUE INDEX IF NOT EXISTS orders_hotel_idempotency_uq ON orders(hotel_id, idempotency_key)",
  "CREATE INDEX IF NOT EXISTS orders_hotel_status_idx ON orders(hotel_id, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS orders_hotel_phone_idx ON orders(hotel_id, phone_last4)",
];

const ORDER_FIELDS = "id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at";
const ORDER_BY_NO_SQL = `SELECT ${ORDER_FIELDS} FROM orders WHERE hotel_id = ? AND order_no = ? LIMIT 1`;
const ORDER_BY_KEY_SQL = `SELECT ${ORDER_FIELDS} FROM orders WHERE hotel_id = ? AND idempotency_key = ? LIMIT 1`;
const ORDER_VERSION_SQL = "SELECT version, status FROM orders WHERE hotel_id = ? AND order_no = ? LIMIT 1";

export type OrderRecord = {
  id: string;
  tenant_id: string;
  hotel_id: string;
  order_no: string;
  source: string;
  external_id: string | null;
  status: number;
  currency: string;
  room_amount: number;
  deposit_amount: number;
  total_amount: number;
  paid_amount: number;
  guest_name_masked: string | null;
  phone_last4: string | null;
  reservation_no: string | null;
  version: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type CreateOrderInput = {
  tenantId: string;
  hotelId: string;
  orderNo: string;
  source: string;
  idempotencyKey: string;
  externalId?: string | null;
  reservationNo?: string | null;
  roomAmount: number;
  depositAmount: number;
  totalAmount: number;
  paidAmount?: number;
  guestNameMasked?: string | null;
  phoneLast4?: string | null;
  status?: OrderStatus;
};

function assertAmount(amountType: string, amount: number) {
  if (!(amountType in AMOUNT_COLUMNS)) throw new Error(ORDER_ERRORS.INVALID_AMOUNT_TYPE);
  if (!Number.isInteger(amount) || amount < 0 || amount > 99_999_999) throw new Error(ORDER_ERRORS.INVALID_AMOUNT);
}

export async function readOrder(db: SqlRunner, hotelId: string, orderNo: string) {
  return db.first<OrderRecord>(ORDER_BY_NO_SQL, [hotelId, orderNo]);
}

/**
 * Classifies a zero-row conditional update. The conditional update is the
 * authority; this lookup only explains *why* it touched no rows, so a missing
 * order is never reported as a retryable conflict and vice versa.
 */
async function classifyOrderWriteMiss(db: SqlRunner, hotelId: string, orderNo: string, expected?: { version?: number; status?: number }) {
  const row = await db.first<{ version: number; status: number }>(ORDER_VERSION_SQL, [hotelId, orderNo]);
  if (!row) return ORDER_ERRORS.NOT_FOUND;
  if (expected?.version !== undefined && Number(row.version) !== expected.version) return ORDER_ERRORS.VERSION_CONFLICT;
  if (expected?.status !== undefined && Number(row.status) !== expected.status) return ORDER_ERRORS.STATUS_CONFLICT;
  return expected?.version !== undefined ? ORDER_ERRORS.VERSION_CONFLICT : ORDER_ERRORS.NOT_FOUND;
}

export async function updateOrderAmountWith(db: SqlRunner, input: { hotelId: string; orderNo: string; amountType: OrderAmountType; amount: number; expectedVersion?: number }) {
  assertAmount(input.amountType, input.amount);
  const column = AMOUNT_COLUMNS[input.amountType];
  const params: SqlValue[] = [input.amount, new Date().toISOString(), input.hotelId, input.orderNo];
  let sql = `UPDATE orders SET ${column} = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND order_no = ?`;
  if (input.expectedVersion !== undefined) { sql += " AND version = ?"; params.push(input.expectedVersion); }
  const result = await db.run(sql, params);
  if (!result.changes) throw new Error(await classifyOrderWriteMiss(db, input.hotelId, input.orderNo, { version: input.expectedVersion }));
  const order = await readOrder(db, input.hotelId, input.orderNo);
  if (!order) throw new Error(ORDER_ERRORS.NOT_FOUND);
  return order;
}

export async function transitionOrderStatusWith(db: SqlRunner, input: { hotelId: string; orderNo: string; from: OrderStatus; to: OrderStatus; expectedVersion?: number }) {
  assertOrderTransition(input.from, input.to);
  const params: SqlValue[] = [input.to, new Date().toISOString(), input.hotelId, input.orderNo, input.from];
  let sql = "UPDATE orders SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND order_no = ? AND status = ?";
  if (input.expectedVersion !== undefined) { sql += " AND version = ?"; params.push(input.expectedVersion); }
  const result = await db.run(sql, params);
  if (!result.changes) throw new Error(await classifyOrderWriteMiss(db, input.hotelId, input.orderNo, { version: input.expectedVersion, status: input.from }));
  const order = await readOrder(db, input.hotelId, input.orderNo);
  if (!order) throw new Error(ORDER_ERRORS.NOT_FOUND);
  return order;
}

/** Parameter consistency for an idempotent replay of the same create request. */
export function matchesCreateRequest(stored: OrderRecord, input: CreateOrderInput) {
  const same = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);
  return stored.order_no === input.orderNo
    && stored.source === input.source
    && same(stored.external_id, input.externalId ?? input.orderNo)
    && same(stored.reservation_no, input.reservationNo ?? input.orderNo)
    && Number(stored.room_amount) === input.roomAmount
    && Number(stored.deposit_amount) === input.depositAmount
    && Number(stored.total_amount) === input.totalAmount;
}

export async function createOrderWith(db: SqlRunner, input: CreateOrderInput) {
  if (!input.orderNo || !input.source || !input.idempotencyKey) throw new Error(ORDER_ERRORS.REQUEST_INVALID);
  assertAmount("room_amount", input.roomAmount);
  assertAmount("deposit_amount", input.depositAmount);
  assertAmount("total_amount", input.totalAmount);
  const stamp = new Date().toISOString();
  const status = input.status ?? ORDER_STATUS.PENDING_PAYMENT;
  const insert = await db.run(
    "INSERT OR IGNORE INTO orders (id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    [`ord-${crypto.randomUUID()}`, input.tenantId, input.hotelId, input.orderNo, input.source, input.externalId ?? input.orderNo, status, input.roomAmount, input.depositAmount, input.totalAmount, input.paidAmount ?? 0, input.guestNameMasked ?? null, input.phoneLast4 ?? null, input.reservationNo ?? input.orderNo, input.idempotencyKey, stamp, stamp],
  );
  if (insert.changes) {
    const order = await readOrder(db, input.hotelId, input.orderNo);
    if (!order) throw new Error(ORDER_ERRORS.CREATE_FAILED);
    return { order, idempotent: false };
  }
  const byKey = await db.first<OrderRecord>(ORDER_BY_KEY_SQL, [input.hotelId, input.idempotencyKey]);
  if (byKey) {
    if (!matchesCreateRequest(byKey, input)) throw new Error(ORDER_ERRORS.IDEMPOTENCY_REUSED);
    return { order: byKey, idempotent: true };
  }
  if (await readOrder(db, input.hotelId, input.orderNo)) throw new Error(ORDER_ERRORS.ORDER_NO_CONFLICT);
  throw new Error(ORDER_ERRORS.CREATE_FAILED);
}

/**
 * One-way projection of the fields the formal order owns. Returns "no_legacy_row"
 * when the demo_orders row is gone, so callers can surface the divergence
 * instead of silently pretending the projection happened.
 */
export async function projectOrderToLegacyWith(db: SqlRunner, order: OrderRecord): Promise<ProjectionOutcome> {
  const legacyId = order.id.startsWith("ord-") ? order.id.slice(4) : null;
  if (!legacyId) return "no_legacy_row" as const;
  const result = await db.run(
    "UPDATE demo_orders SET room_amount = ?, deposit_amount = ?, total_amount = ?, updated_at = ? WHERE hotel_id = ? AND id = ?",
    [order.room_amount, order.deposit_amount, order.total_amount, new Date().toISOString(), order.hotel_id, legacyId],
  );
  return result.changes ? "projected" as const : "no_legacy_row" as const;
}

/** Legacy backfill SQL shared with lib/legacy-core-sync.ts and the integration tests. */
export function ordersLegacyBackfillSql() {
  const cases = Object.entries(LEGACY_STATUS_TO_ORDER_STATUS)
    .map(([legacy, status]) => `WHEN '${legacy}' THEN ${status}`)
    .join(" ");
  return `INSERT OR IGNORE INTO orders (id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at) SELECT 'ord-' || id, ?, hotel_id, order_code, source, order_code, CASE status ${cases} ELSE 0 END, 'CNY', room_amount, deposit_amount, total_amount, CASE WHEN status = 'cancelled' THEN 0 ELSE total_amount END, guest_label, phone_last4, order_code, 1, 'legacy:' || id, created_at, updated_at FROM demo_orders WHERE hotel_id = ?`;
}
