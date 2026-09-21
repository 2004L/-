import { getD1 } from "@/db";
import { checkoutAndSettle, ensureFolioSchema } from "@/lib/folio";
import { DEFAULT_HOTEL_ID, DEFAULT_TENANT_ID, ensureTenantFoundation } from "@/lib/tenant";

export type CheckoutTaskResult = {
  task_id: string;
  status: "SUCCEEDED" | "FAILED";
  checkout?: Awaited<ReturnType<typeof checkoutAndSettle>>;
  error?: string;
};

async function scope(sessionId: string) {
  await ensureTenantFoundation();
  const row = await getD1().prepare("SELECT tenant_id, hotel_id FROM demo_sessions WHERE id = ?").bind(sessionId).first<{ tenant_id: string | null; hotel_id: string | null }>();
  return { tenantId: row?.tenant_id ?? DEFAULT_TENANT_ID, hotelId: row?.hotel_id ?? DEFAULT_HOTEL_ID };
}

/** Creates and executes the durable post-card checkout task. Retries are idempotent. */
export async function createAndProcessCheckoutTask(input: { sessionId: string; stayId: string; requestId: string }): Promise<CheckoutTaskResult> {
  await ensureFolioSchema();
  const { tenantId, hotelId } = await scope(input.sessionId);
  const taskId = `checkout-task-${hotelId}-${input.stayId}`;
  const stamp = new Date().toISOString();
  await getD1().prepare("INSERT OR IGNORE INTO checkout_tasks (id, tenant_id, hotel_id, session_id, stay_id, request_id, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)")
    .bind(taskId, tenantId, hotelId, input.sessionId, input.stayId, input.requestId, stamp, stamp).run();
  const existing = await getD1().prepare("SELECT status, result_json, last_error FROM checkout_tasks WHERE id = ?").bind(taskId).first<{ status: string; result_json: string | null; last_error: string | null }>();
  if (existing?.status === "SUCCEEDED" && existing.result_json) return { task_id: taskId, status: "SUCCEEDED", checkout: JSON.parse(existing.result_json) as Awaited<ReturnType<typeof checkoutAndSettle>> };
  await getD1().prepare("UPDATE checkout_tasks SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ? WHERE id = ?").bind(stamp, taskId).run();
  try {
    const result = await checkoutAndSettle({ hotelId, stayId: input.stayId, requestId: input.requestId });
    await getD1().prepare("UPDATE checkout_tasks SET status = 'SUCCEEDED', result_json = ?, last_error = NULL, updated_at = ? WHERE id = ?").bind(JSON.stringify(result), new Date().toISOString(), taskId).run();
    return { task_id: taskId, status: "SUCCEEDED", checkout: result };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    await getD1().prepare("UPDATE checkout_tasks SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?").bind(reason, new Date().toISOString(), taskId).run();
    return { task_id: taskId, status: "FAILED", error: reason };
  }
}
