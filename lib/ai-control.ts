import { getD1 } from "@/db";
import type { AdminAuth } from "@/lib/admin-service";
import type { AdminAssistantResult } from "@/lib/admin-tools";
import type { IntentSource } from "@/lib/intent-envelope";
import { DEFAULT_HOTEL_ID, DEFAULT_TENANT_ID } from "@/lib/tenant";
import type { AssistantMessage, Clarification, ToolCall } from "@/lib/tools";

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

type GuestAgentResult = ToolCall | Clarification | AssistantMessage;

export type GuestAiTurnInput = {
  sessionId: string;
  conversationId?: string;
  caseId?: string;
  requestId: string;
  utterance: string;
  result: GuestAgentResult;
  source: IntentSource;
};

export type GuestAiChain = {
  workflow: Record<string, unknown> | null;
  intents: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  policyDecisions: Array<Record<string, unknown>>;
};

/** Guest-side workflow id: one durable chain per session + conversation. */
export function guestWorkflowId(hotelId: string, sessionId: string, conversationId?: string) {
  const suffix = `${sessionId}-${conversationId ?? "default"}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return `guest-wf-${hotelId}-${suffix}`;
}

async function guestScope(sessionId: string) {
  const row = await getD1().prepare("SELECT tenant_id, hotel_id FROM demo_sessions WHERE id = ?").bind(sessionId).first<{ tenant_id: string | null; hotel_id: string | null }>();
  return { tenantId: row?.tenant_id ?? DEFAULT_TENANT_ID, hotelId: row?.hotel_id ?? DEFAULT_HOTEL_ID };
}

/**
 * Records one guest turn on the same AI control plane the admin console uses,
 * so every customer understanding is replayable: 表达 → 意图 → 计划 → 策略 → 工具.
 */
export async function recordGuestAiTurn(input: GuestAiTurnInput) {
  await ensureAiControlSchema();
  const { tenantId, hotelId } = await guestScope(input.sessionId);
  const now = new Date().toISOString();
  const id = guestWorkflowId(hotelId, input.sessionId, input.conversationId);
  const intent = input.result.type === "tool_call" ? input.result.tool_name : input.result.type === "clarification" ? input.result.intent : "assistant_message";
  const step = input.result.type === "tool_call" ? `tool:${input.result.tool_name}` : input.result.type;
  const args = input.result.type === "tool_call" ? input.result.arguments : {};
  const risk = input.result.type === "tool_call" ? "high" : input.result.type === "clarification" ? "medium" : "none";
  const decision = input.result.type === "tool_call" ? "route_to_tool_gateway" : input.result.type === "clarification" ? "ask_for_information" : "answer_only";
  await getD1().batch([
    getD1().prepare("INSERT OR IGNORE INTO ai_workflows (id, tenant_id, hotel_id, terminal_id, session_id, conversation_id, actor_type, actor_id, intent, status, current_step, context_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, 'guest', NULL, ?, 'active', ?, ?, ?, ?)").bind(id, tenantId, hotelId, input.sessionId, input.conversationId ?? null, intent, step, JSON.stringify({ case_id: input.caseId ?? null, source: input.source }), now, now),
    getD1().prepare("UPDATE ai_workflows SET intent = ?, current_step = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND hotel_id = ?").bind(intent, step, now, id, tenantId, hotelId),
    getD1().prepare("INSERT INTO ai_intents (id, workflow_id, tenant_id, hotel_id, request_id, source, raw_text_redacted, intent, confidence, arguments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, tenantId, hotelId, input.requestId, input.source, redact(input.utterance), intent, input.result.type === "clarification" ? Math.round(input.result.confidence * 100) : 100, JSON.stringify(args, (_key, value) => typeof value === "string" ? redact(value) : value), now),
    getD1().prepare("INSERT INTO ai_plans (id, workflow_id, tenant_id, hotel_id, plan_json, policy_version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, tenantId, hotelId, JSON.stringify({ step, tool: input.result.type === "tool_call" ? input.result.tool_name : null, arguments: args }, (_key, value) => typeof value === "string" ? redact(value) : value), AI_POLICY_VERSION, input.result.type === "tool_call" ? "proposed" : "needs_clarification", now, now),
    ...(input.result.type === "tool_call" ? [getD1().prepare("INSERT OR IGNORE INTO ai_tool_calls (id, workflow_id, tenant_id, hotel_id, request_id, tool_call_id, tool_name, arguments_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?)").bind(crypto.randomUUID(), id, tenantId, hotelId, input.requestId, input.result.tool_call_id, input.result.tool_name, JSON.stringify(input.result.arguments, (_key, value) => typeof value === "string" ? redact(value) : value), now)] : []),
    getD1().prepare("INSERT INTO policy_decisions (id, workflow_id, tenant_id, hotel_id, actor_id, action, risk_level, decision, reason, policy_version, created_at) VALUES (?, ?, ?, ?, 'guest', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, tenantId, hotelId, intent, risk, decision, input.result.type === "tool_call" ? "工具契约仍需在执行端再次校验" : "无需写操作", AI_POLICY_VERSION, now),
  ]);
  return id;
}

/**
 * Binds the execution receipt back onto the proposed tool call. Called by the
 * guest flow when a business step really runs, which is what makes
 * ai_tool_calls a receipt instead of an intention.
 */
export async function completeGuestToolCall(input: { sessionId: string; toolNames: string[]; status: "SUCCEEDED" | "FAILED"; result?: unknown; errorCode?: string | null }) {
  if (!input.toolNames.length) return false;
  await ensureAiControlSchema();
  const { hotelId } = await guestScope(input.sessionId);
  const placeholders = input.toolNames.map(() => "?").join(", ");
  const pending = await getD1().prepare(
    `SELECT c.id FROM ai_tool_calls c JOIN ai_workflows w ON w.id = c.workflow_id WHERE w.hotel_id = ? AND w.session_id = ? AND w.actor_type = 'guest' AND c.status = 'PROPOSED' AND c.tool_name IN (${placeholders}) ORDER BY c.created_at DESC LIMIT 1`
  ).bind(hotelId, input.sessionId, ...input.toolNames).first<{ id: string }>();
  if (!pending) return false;
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE ai_tool_calls SET status = ?, result_json = ?, completed_at = ? WHERE id = ?")
    .bind(input.status, JSON.stringify({ result: input.result ?? null, error_code: input.errorCode ?? null }, (_key, value) => typeof value === "string" ? redact(value) : value), now, pending.id)
    .run();
  return true;
}

/** Read-only replay of one guest conversation, used by the admin console. */
export async function getGuestAiChain(input: { hotelId: string; sessionId: string; limit?: number }): Promise<GuestAiChain> {
  await ensureAiControlSchema();
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const workflow = await getD1().prepare("SELECT id, tenant_id, hotel_id, session_id, conversation_id, actor_type, intent, status, current_step, context_json, created_at, updated_at FROM ai_workflows WHERE hotel_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT 1").bind(input.hotelId, input.sessionId).first<Record<string, unknown>>();
  if (!workflow) return { workflow: null, intents: [], plans: [], toolCalls: [], policyDecisions: [] };
  const workflowId = String(workflow.id);
  const [intents, plans, toolCalls, policyDecisions] = await Promise.all([
    getD1().prepare("SELECT request_id, source, raw_text_redacted, intent, confidence, arguments_json, created_at FROM ai_intents WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?").bind(workflowId, limit).all<Record<string, unknown>>(),
    getD1().prepare("SELECT plan_json, policy_version, status, created_at FROM ai_plans WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?").bind(workflowId, limit).all<Record<string, unknown>>(),
    getD1().prepare("SELECT tool_call_id, tool_name, arguments_json, result_json, status, created_at, completed_at FROM ai_tool_calls WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?").bind(workflowId, limit).all<Record<string, unknown>>(),
    getD1().prepare("SELECT action, risk_level, decision, reason, policy_version, created_at FROM policy_decisions WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?").bind(workflowId, limit).all<Record<string, unknown>>(),
  ]);
  return { workflow, intents: intents.results, plans: plans.results, toolCalls: toolCalls.results, policyDecisions: policyDecisions.results };
}
