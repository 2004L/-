import { getD1 } from "@/db";
import type { CommandStatus } from "./contracts";

export type CommandRecord = {
  id: string; session_id: string; case_id: string | null; target: string; operation: string;
  idempotency_key: string; status: CommandStatus; request_json: string; result_json: string | null;
  error_code: string | null; retryable: number; created_at: string; updated_at: string;
};

export function now() { return new Date().toISOString(); }

export async function ensureSession(sessionId: string) {
  const stamp = now();
  await getD1().prepare("INSERT OR IGNORE INTO demo_sessions (id, hotel_code, city, created_at, updated_at) VALUES (?, 'GZ-DEMO-001', '广州', ?, ?)").bind(sessionId, stamp, stamp).run();
}

export async function findCommand(idempotencyKey: string) {
  return getD1().prepare("SELECT * FROM external_commands WHERE idempotency_key = ?").bind(idempotencyKey).first<CommandRecord>();
}

export async function createCommand(input: { sessionId: string; caseId: string; target: string; operation: string; idempotencyKey: string; request: unknown }) {
  const existing = await findCommand(input.idempotencyKey);
  if (existing) return { record: existing, created: false };
  const id = crypto.randomUUID(); const stamp = now();
  await getD1().prepare("INSERT INTO external_commands (id, session_id, case_id, target, operation, idempotency_key, status, request_json, result_json, error_code, retryable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)")
    .bind(id, input.sessionId, input.caseId, input.target, input.operation, input.idempotencyKey, "RUNNING", JSON.stringify(input.request), stamp, stamp).run();
  return { record: await getD1().prepare("SELECT * FROM external_commands WHERE id = ?").bind(id).first<CommandRecord>(), created: true };
}

export async function completeCommand(commandId: string, status: CommandStatus, result: unknown, errorCode: string | null, retryable: boolean) {
  const stamp = now();
  await getD1().prepare("UPDATE external_commands SET status = ?, result_json = ?, error_code = ?, retryable = ?, updated_at = ? WHERE id = ?")
    .bind(status, result == null ? null : JSON.stringify(result), errorCode, retryable ? 1 : 0, stamp, commandId).run();
  return getD1().prepare("SELECT * FROM external_commands WHERE id = ?").bind(commandId).first<CommandRecord>();
}

export async function consumeFault(sessionId: string, caseId: string, target: string) {
  const rows = await getD1().prepare("SELECT * FROM simulator_faults WHERE session_id = ? AND target = ? AND enabled = 1 AND (case_id IS NULL OR case_id = ?) ORDER BY created_at DESC LIMIT 20").bind(sessionId, target, caseId).all<{ id: string; trigger_on_call: number; repeat_count: number; call_count: number; auto_reset: number; fault_type: string }>();
  for (const row of rows.results) {
    const nextCount = row.call_count + 1;
    const active = nextCount >= row.trigger_on_call && nextCount < row.trigger_on_call + row.repeat_count;
    await getD1().prepare("UPDATE simulator_faults SET call_count = ?, enabled = CASE WHEN auto_reset = 1 AND ? >= trigger_on_call + repeat_count THEN 0 ELSE enabled END, updated_at = ? WHERE id = ? AND call_count = ?")
      .bind(nextCount, nextCount, now(), row.id, row.call_count).run();
    if (active) return row.fault_type;
  }
  return null;
}

export async function auditSimulator(sessionId: string, caseId: string, eventType: string, detail: string) {
  await getD1().prepare("INSERT INTO audit_events (session_id, case_id, event_type, from_state, to_state, detail, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)").bind(sessionId, caseId, eventType, detail, now()).run();
}

export async function createManualTask(sessionId: string, caseId: string, commandId: string, department: string, reason: string) {
  const id = crypto.randomUUID(); const stamp = now();
  await getD1().prepare("INSERT INTO manual_tasks (id, session_id, case_id, command_id, department, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)").bind(id, sessionId, caseId, commandId, department, reason, stamp, stamp).run();
  await auditSimulator(sessionId, caseId, "MANUAL_TASK_CREATED", `${department}：${reason}`);
  return id;
}

export function toResponse(record: CommandRecord | undefined) {
  if (!record) return { ok: false, error: "command_not_found" };
  return { ok: record.status === "SUCCEEDED", command_id: record.id, status: record.status, result: record.result_json ? JSON.parse(record.result_json) : null, error_code: record.error_code, retryable: Boolean(record.retryable), idempotency_key: record.idempotency_key };
}
