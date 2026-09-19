import { getD1 } from "@/db";
import { redactCoreContext } from "@/lib/hotel-core";

export const CHECKIN_WORKFLOW_STEPS = [
  "ORDER_MATCHED",
  "IDENTITY_VERIFIED",
  "ROOM_SELECTED",
  "AMOUNT_CONFIRMED",
  "PAYMENT_CONFIRMED",
  "ROOM_HELD",
  "CHECKIN_CONFIRMED",
  "HARDWARE_PENDING",
  "COMPLETED",
] as const;

export type WorkflowStatus = "pending" | "running" | "awaiting_confirmation" | "paused" | "completed" | "failed" | "cancelled";

export function isValidWorkflowStep(stepKey: string) {
  return stepKey === "ADMIN_ACTION" || (CHECKIN_WORKFLOW_STEPS as readonly string[]).includes(stepKey);
}

export type WorkflowContext = {
  tenantId: string;
  hotelId: string;
  workflowType: string;
  idempotencyKey: string;
  subjectType?: string;
  subjectId?: string;
  context?: Record<string, unknown>;
};

export async function createWorkflowRun(input: WorkflowContext) {
  const stamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const context = JSON.stringify(redactCoreContext(input.context ?? {}));
  await getD1().prepare(
    "INSERT OR IGNORE INTO workflow_runs (id, tenant_id, hotel_id, workflow_type, subject_type, subject_id, status, current_step, version, idempotency_key, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, 1, ?, ?, ?, ?)"
  ).bind(id, input.tenantId, input.hotelId, input.workflowType, input.subjectType ?? null, input.subjectId ?? null, input.idempotencyKey, context, stamp, stamp).run();
  return getD1().prepare("SELECT * FROM workflow_runs WHERE hotel_id = ? AND idempotency_key = ? LIMIT 1").bind(input.hotelId, input.idempotencyKey).first<Record<string, unknown>>();
}

export async function transitionWorkflow(input: { workflowId: string; hotelId: string; expectedVersion: number; status: WorkflowStatus; currentStep?: string | null; lastError?: string | null }) {
  const stamp = new Date().toISOString();
  const result = await getD1().prepare(
    "UPDATE workflow_runs SET status = ?, current_step = ?, last_error = ?, version = version + 1, updated_at = ? WHERE id = ? AND hotel_id = ? AND version = ?"
  ).bind(input.status, input.currentStep ?? null, input.lastError ?? null, stamp, input.workflowId, input.hotelId, input.expectedVersion).run();
  if (!result.meta.changes) throw new Error("workflow_version_conflict");
  return getD1().prepare("SELECT * FROM workflow_runs WHERE id = ? AND hotel_id = ? LIMIT 1").bind(input.workflowId, input.hotelId).first<Record<string, unknown>>();
}

export async function recordWorkflowStep(input: { workflowId: string; tenantId: string; hotelId: string; stepKey: string; status: string; input?: unknown; output?: unknown; errorCode?: string | null; attempt?: number }) {
  if (!isValidWorkflowStep(input.stepKey)) throw new Error("unknown_workflow_step");
  const stamp = new Date().toISOString();
  const id = crypto.randomUUID();
  await getD1().prepare(
    "INSERT INTO workflow_steps (id, tenant_id, hotel_id, workflow_run_id, step_key, status, attempt, input_json, output_json, error_code, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workflow_run_id, step_key) DO UPDATE SET status = excluded.status, attempt = excluded.attempt, output_json = excluded.output_json, error_code = excluded.error_code, completed_at = excluded.completed_at, updated_at = excluded.updated_at"
  ).bind(id, input.tenantId, input.hotelId, input.workflowId, input.stepKey, input.status, input.attempt ?? 1, JSON.stringify(redactCoreContext(input.input ?? {})), input.output === undefined ? null : JSON.stringify(redactCoreContext(input.output)), input.errorCode ?? null, input.status === "running" ? stamp : null, ["succeeded", "failed", "cancelled"].includes(input.status) ? stamp : null, stamp, stamp).run();
  return getD1().prepare("SELECT * FROM workflow_steps WHERE workflow_run_id = ? AND step_key = ? LIMIT 1").bind(input.workflowId, input.stepKey).first<Record<string, unknown>>();
}

export async function getWorkflowProjection(workflowId: string, hotelId: string) {
  const [run, steps] = await Promise.all([
    getD1().prepare("SELECT id, workflow_type, subject_type, subject_id, status, current_step, version, context_json, last_error, created_at, updated_at FROM workflow_runs WHERE id = ? AND hotel_id = ? LIMIT 1").bind(workflowId, hotelId).first<Record<string, unknown>>(),
    getD1().prepare("SELECT step_key, status, attempt, output_json, error_code, started_at, completed_at FROM workflow_steps WHERE workflow_run_id = ? AND hotel_id = ? ORDER BY created_at ASC").bind(workflowId, hotelId).all<Record<string, unknown>>(),
  ]);
  if (!run) throw new Error("workflow_not_found");
  return { run, steps: steps.results };
}
