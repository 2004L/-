import { faultSchema } from "@/lib/contracts";
import { auditSimulator, ensureSession, now } from "@/lib/simulator";
import { getD1 } from "@/db";

export const runtime = "edge";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return Response.json({ ok: false, error: "session_id_required" }, { status: 400 });
  const rows = await getD1().prepare("SELECT id, session_id, case_id, target, fault_type, trigger_on_call, repeat_count, call_count, enabled, auto_reset, created_at, updated_at FROM simulator_faults WHERE session_id = ? ORDER BY created_at DESC").bind(sessionId).all();
  return Response.json({ ok: true, faults: rows.results });
}

export async function POST(request: Request) {
  try {
    const input = faultSchema.parse(await request.json());
    await ensureSession(input.session_id);
    const id = crypto.randomUUID(); const stamp = now();
    await getD1().prepare("INSERT INTO simulator_faults (id, session_id, case_id, target, fault_type, trigger_on_call, repeat_count, call_count, enabled, auto_reset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)")
      .bind(id, input.session_id, input.case_id ?? null, input.target, input.fault_type, input.trigger_on_call, input.repeat_count, input.auto_reset ? 1 : 0, stamp, stamp).run();
    await auditSimulator(input.session_id, input.case_id ?? "simulator", "SIMULATOR_FAULT_CONFIGURED", `${input.target}/${input.fault_type}，第 ${input.trigger_on_call} 次调用触发，重复 ${input.repeat_count} 次`);
    return Response.json({ ok: true, fault_id: id });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
