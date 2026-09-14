import { getD1 } from "@/db";

export const runtime = "edge";

export async function DELETE(_request: Request, context: { params: Promise<{ faultId: string }> }) {
  const { faultId } = await context.params;
  await getD1().prepare("UPDATE simulator_faults SET enabled = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), faultId).run();
  return Response.json({ ok: true });
}
