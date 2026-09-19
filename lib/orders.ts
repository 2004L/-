import { getD1 } from "@/db";
import type { OrderStatus } from "@/lib/hotel-core";
import {
  ORDERS_DDL,
  createOrderWith,
  projectOrderToLegacyWith,
  readOrder,
  transitionOrderStatusWith,
  updateOrderAmountWith,
  type CreateOrderInput,
  type OrderAmountType,
  type OrderRecord,
  type ProjectionOutcome,
  type SqlRunner,
  type SqlValue,
} from "@/lib/orders-core";

export { ORDER_ERRORS } from "@/lib/orders-core";
export type { CreateOrderInput, OrderAmountType, OrderRecord, ProjectionOutcome } from "@/lib/orders-core";

export type OrderWriteResult = OrderRecord & { projection: ProjectionOutcome };

/**
 * D1 adapter over the shared order core. All state rules (atomic conditional
 * update, version check, idempotency classification) live in lib/orders-core.ts
 * so the integration tests can run the exact same logic on a real SQLite engine.
 */
function d1Runner(): SqlRunner {
  return {
    run: async (sql: string, params: SqlValue[]) => {
      const result = await getD1().prepare(sql).bind(...params).run();
      return { changes: Number(result.meta?.changes ?? 0) };
    },
    first: <T = Record<string, unknown>>(sql: string, params: SqlValue[]) => getD1().prepare(sql).bind(...params).first<T>(),
  };
}

export function d1SqlRunner(): SqlRunner {
  return d1Runner();
}

export async function ensureOrdersSchema() {
  const db = getD1();
  await db.batch(ORDERS_DDL.map((sql) => db.prepare(sql)));
}

export async function getOrderByNo(hotelId: string, orderNo: string) {
  return readOrder(d1Runner(), hotelId, orderNo);
}

async function projectSafely(order: OrderRecord): Promise<ProjectionOutcome> {
  try {
    const outcome = await projectOrderToLegacyWith(d1Runner(), order);
    if (outcome === "no_legacy_row") console.warn(`[orders][projection] no demo_orders row for ${order.order_no}`);
    return outcome;
  } catch (error) {
    // The compatibility mirror must never turn a committed formal write into a
    // reported failure; record the divergence so operators can backfill it.
    console.warn(`[orders][projection] failed for ${order.order_no}: ${error instanceof Error ? error.message : "unknown_error"}`);
    return "failed";
  }
}

export async function projectOrderToLegacy(order: OrderRecord) {
  return projectSafely(order);
}

export async function updateOrderAmount(input: { tenantId: string; hotelId: string; orderNo: string; amountType: OrderAmountType; amount: number; expectedVersion?: number }) {
  await ensureOrdersSchema();
  const order = await updateOrderAmountWith(d1Runner(), input);
  const projection = await projectSafely(order);
  return { ...order, projection };
}

export async function transitionOrderStatus(input: { hotelId: string; orderNo: string; from: OrderStatus; to: OrderStatus; expectedVersion?: number }) {
  await ensureOrdersSchema();
  return transitionOrderStatusWith(d1Runner(), input);
}

export async function createOrder(input: CreateOrderInput) {
  await ensureOrdersSchema();
  return createOrderWith(d1Runner(), input);
}
