import { getD1 } from "@/db";
import { legacyCoreStatements } from "@/lib/legacy-projection-core";
import { ensureOrdersSchema } from "@/lib/orders";
import { ordersLegacyBackfillSql } from "@/lib/orders-core";

/**
 * D1 adapter over the demo->formal projection. The statements themselves live in
 * lib/legacy-projection-core.ts so the integration test can run the same SQL.
 */
export async function syncLegacyCore(input: { tenantId: string; hotelId: string }) {
  const db = getD1();
  const stamp = new Date().toISOString();
  const distinctTypes = await db.prepare("SELECT DISTINCT room_type FROM demo_orders WHERE hotel_id = ? AND room_type IS NOT NULL").bind(input.hotelId).all<{ room_type: string }>();
  const statements = legacyCoreStatements({ tenantId: input.tenantId, hotelId: input.hotelId, stamp, roomTypes: distinctTypes.results.map((row) => row.room_type) });
  await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.params)));
  try {
    await ensureOrdersSchema();
    await db.prepare(ordersLegacyBackfillSql()).bind(input.tenantId, input.hotelId).run();
  } catch (error) {
    console.warn("[orders] legacy order projection skipped", error instanceof Error ? error.message : "unknown_error");
  }
}