import { getD1 } from "@/db";
import { ensureAdminSchema, requireAdmin } from "@/lib/admin-auth";

export const runtime = "edge";

export async function DELETE(_request: Request, context: { params: Promise<{ faultId: string }> }) {
  await ensureAdminSchema();
  const auth = await requireAdmin(_request, "admin:manage_faults");
  if ("response" in auth) return auth.response;
  const { faultId } = await context.params;
  await getD1().prepare("UPDATE simulator_faults SET enabled = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), faultId).run();
  return Response.json({ ok: true });
}
