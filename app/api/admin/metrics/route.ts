import { ensureAdminSchema, requireAdmin } from "@/lib/admin-auth";
import { ensureOpsSchema } from "@/lib/ops";
import { getD1 } from "@/db";

export const runtime = "edge";

type MetricRow = { request_id: string; route: string; model: string; latency_ms: number; outcome: string; created_at: string };

export async function GET(request: Request) {
  await ensureAdminSchema();
  const auth = await requireAdmin(request, "admin:read_orders");
  if ("response" in auth) return auth.response;
  await ensureOpsSchema();
  const rows = await getD1().prepare("SELECT request_id, route, model, latency_ms, outcome, created_at FROM ai_request_metrics ORDER BY created_at DESC LIMIT 100").all<MetricRow>();
  const metrics = rows.results ?? [];
  const latencies = metrics.map((row) => Number(row.latency_ms)).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const percentile = (ratio: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * ratio))] : null;
  const counts = metrics.reduce<Record<string, number>>((acc, row) => { acc[row.outcome] = (acc[row.outcome] ?? 0) + 1; return acc; }, {});
  return Response.json({
    ok: true,
    sample_size: metrics.length,
    outcomes: { success: counts.success ?? 0, fallback: counts.fallback ?? 0, error: counts.error ?? 0 },
    latency_ms: { average: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null, p50: percentile(0.5), p95: percentile(0.95) },
    recent: metrics.map((row) => ({ request_id: row.request_id, route: row.route, model: row.model, latency_ms: row.latency_ms, outcome: row.outcome, created_at: row.created_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}
