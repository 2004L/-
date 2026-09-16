import { getD1 } from "@/db";
import { ensureOpsSchema, publicModelConfig, requestId } from "@/lib/ops";

export const runtime = "edge";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const id = requestId(request);
  let database: "ok" | "failed" = "ok";
  try {
    await getD1().prepare("SELECT 1 AS ok").first();
    await ensureOpsSchema();
  } catch { database = "failed"; }
  const status = database === "ok" ? "ok" : "degraded";
  return Response.json({ ok: status === "ok", status, request_id: id, checks: { database, llm: publicModelConfig() }, latency_ms: Date.now() - startedAt, checked_at: new Date().toISOString() }, { status: status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Request-ID": id } });
}
