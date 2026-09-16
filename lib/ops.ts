import { getD1 } from "@/db";

type MetricInput = {
  requestId: string;
  sessionId?: string | null;
  route: string;
  model: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  outcome: "success" | "fallback" | "error";
};

export async function ensureOpsSchema() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ai_request_metrics (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, session_id TEXT, route TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, outcome TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_request_metrics_created_idx ON ai_request_metrics(created_at DESC)"),
  ]);
}

export async function recordAiMetric(input: MetricInput) {
  try {
    await ensureOpsSchema();
    await getD1().prepare("INSERT OR IGNORE INTO ai_request_metrics (id, request_id, session_id, route, model, latency_ms, prompt_tokens, completion_tokens, total_tokens, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.requestId, input.sessionId ?? null, input.route, input.model.slice(0, 80), Math.max(0, Math.round(input.latencyMs)), input.promptTokens ?? null, input.completionTokens ?? null, input.totalTokens ?? null, input.outcome, new Date().toISOString())
      .run();
  } catch {
    // 指标写入失败不能影响顾客办理主流程。
  }
}

export function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[a-zA-Z0-9_-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function publicModelConfig() {
  const enabled = ((typeof process !== "undefined" ? process.env?.LLM_ENABLED : undefined) ?? "false").trim().toLowerCase() === "true";
  const model = ((typeof process !== "undefined" ? process.env?.LLM_MODEL : undefined) ?? "hy3").trim() || "hy3";
  const key = (typeof process !== "undefined" ? process.env?.LLM_API_KEY : undefined)?.trim() ?? "";
  return { enabled, model, provider: "openai-compatible", keyConfigured: Boolean(key && key !== "TEMP_LLM_API_KEY_REPLACE_ME") };
}
