import { ensureAdminSchema, getAdminFromRequest } from "@/lib/admin-auth";
import { getWorkflowProjection } from "@/lib/workflow-engine";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  const { workflowId } = await context.params;
  try {
    const projection = await getWorkflowProjection(workflowId, auth.user.hotel_id);
    return Response.json({ ok: true, ...projection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "workflow_not_found";
    return Response.json({ ok: false, error: message }, { status: message === "workflow_not_found" ? 404 : 400 });
  }
}
