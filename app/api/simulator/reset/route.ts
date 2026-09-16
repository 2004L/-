import { getD1 } from "@/db";
import { ensureAdminSchema, requireAdmin } from "@/lib/admin-auth";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    await ensureAdminSchema();
    const auth = await requireAdmin(request, "admin:manage_faults");
    if ("response" in auth) return auth.response;
    const body = await request.json() as { session_id?: string };
    if (!body.session_id) return Response.json({ ok: false, error: "session_id_required" }, { status: 400 });
    await getD1().prepare("UPDATE simulator_faults SET enabled = 0, call_count = 0, updated_at = ? WHERE session_id = ?").bind(new Date().toISOString(), body.session_id).run();
    return Response.json({ ok: true });
  } catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
}
