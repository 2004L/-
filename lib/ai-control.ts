import { getD1 } from "@/db";
import type { AdminAuth } from "@/lib/admin-service";
import type { AdminAssistantResult } from "@/lib/admin-tools";

export const AI_POLICY_VERSION = "2026-09-17.1";

function redact(value: string) {
  return value
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证号已隐藏]")
    .replace(/\b1\d{10}\b/g, (phone) => `1** **** ${phone.slice(-4)}`)
    .slice(0, 2000);
}

export async function ensureAiControlSchema() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ai_workflows (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, terminal_id TEXT, session_id TEXT, conversation_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT, intent TEXT, status TEXT NOT NULL DEFAULT 'active', current_step TEXT, context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ai_intents (id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, request_id TEXT NOT NULL, source TEXT NOT NULL, raw_text_redacted TEXT NOT NULL, intent TEXT NOT NULL, confidence INTEGER, arguments_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ai_plans (id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, plan_json TEXT NOT NULL, policy_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ai_tool_calls (id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, request_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(request_id, tool_call_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS policy_decisions (id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, risk_level TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, policy_version TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_workflows_hotel_status_idx ON ai_workflows(hotel_id, status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_intents_workflow_idx ON ai_intents(workflow_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_tool_calls_workflow_idx ON ai_tool_calls(workflow_id, created_at)"),
  ]);
}

function workflowId(auth: AdminAuth, conversationId: string | undefined) {
  const suffix = (conversationId || auth.sessionId).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return `admin-wf-${auth.user.hotel_id}-${suffix}`;
}

export async function recordAdminAiTurn(input: {
  auth: AdminAuth;
  requestId: string;
  conversationId?: string;
  utterance: string;
  result: AdminAssistantResult;
}) {
  await ensureAiControlSchema();
  const now = new Date().toISOString();
  const id = workflowId(input.auth, input.conversationId);
  const intent = input.result.type === "tool_call" ? input.result.tool_name : input.result.type === "clarification" ? input.result.intent : "assistant_message";
  const step = input.result.type === "tool_call" ? `tool:${input.result.tool_name}` : input.result.type;
  const args = input.result.type === "tool_call" ? input.result.arguments : {};
  await getD1().batch([
    getD1().prepare("INSERT OR IGNORE INTO ai_workflows (id, tenant_id, hotel_id, session_id, conversation_id, actor_type, actor_id, intent, status, current_step, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, 'active', ?, '{}', ?, ?)").bind(id, input.auth.user.tenant_id, input.auth.user.hotel_id, input.auth.sessionId, input.conversationId ?? null, input.auth.user.id, intent, step, now, now),
    getD1().prepare("UPDATE ai_workflows SET intent = ?, current_step = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND hotel_id = ?").bind(intent, step, now, id, input.auth.user.tenant_id, input.auth.user.hotel_id),
    getD1().prepare("INSERT INTO ai_intents (id, workflow_id, tenant_id, hotel_id, request_id, source, raw_text_redacted, intent, confidence, arguments_json, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, input.auth.user.tenant_id, input.auth.user.hotel_id, input.requestId, redact(input.utterance), intent, input.result.type === "clarification" ? Math.round(input.result.confidence * 100) : 100, JSON.stringify(args, (_key, value) => typeof value === "string" ? redact(value) : value), now),
    getD1().prepare("INSERT INTO ai_plans (id, workflow_id, tenant_id, hotel_id, plan_json, policy_version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, input.auth.user.tenant_id, input.auth.user.hotel_id, JSON.stringify({ step, tool: input.result.type === "tool_call" ? input.result.tool_name : null, arguments: args }, (_key, value) => typeof value === "string" ? redact(value) : value), AI_POLICY_VERSION, input.result.type === "tool_call" ? "proposed" : "needs_clarification", now, now),
    ...(input.result.type === "tool_call" ? [getD1().prepare("INSERT OR IGNORE INTO ai_tool_calls (id, workflow_id, tenant_id, hotel_id, request_id, tool_call_id, tool_name, arguments_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?)").bind(crypto.randomUUID(), id, input.auth.user.tenant_id, input.auth.user.hotel_id, input.requestId, input.result.tool_call_id, input.result.tool_name, JSON.stringify(input.result.arguments, (_key, value) => typeof value === "string" ? redact(value) : value), now)] : []),
    getD1().prepare("INSERT INTO policy_decisions (id, workflow_id, tenant_id, hotel_id, actor_id, action, risk_level, decision, reason, policy_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, input.auth.user.tenant_id, input.auth.user.hotel_id, input.auth.user.id, intent, input.result.type === "tool_call" ? "pending" : "none", input.result.type === "tool_call" ? "route_to_tool_gateway" : "ask_for_information", input.result.type === "tool_call" ? "工具契约仍需在执行端再次校验" : "参数不足或需要澄清", AI_POLICY_VERSION, now),
  ]);
  return id;
}
