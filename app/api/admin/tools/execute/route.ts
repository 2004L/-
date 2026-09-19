import { adminToolNames, type AdminToolName } from "@/lib/admin-tools";
import { ensureAdminSchema, getAdminFromRequest, auditAdmin } from "@/lib/admin-auth";
import { executeAdminTool } from "@/lib/admin-service";

export const runtime = "edge";

export async function POST(request: Request) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  try {
    const body = await request.json() as { tool_name?: string; arguments?: unknown };
    if (!body.tool_name || !adminToolNames.includes(body.tool_name as AdminToolName)) return Response.json({ ok: false, error: "unknown_admin_tool" }, { status: 400 });
    const result = await executeAdminTool(auth, body.tool_name as AdminToolName, body.arguments);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "admin_tool_failed";
    await auditAdmin(auth.user, "ADMIN_TOOL_FAILED", message);
    const status = message === "admin_permission_denied" ? 403 : message === "admin_action_expired" ? 410 : message.includes("conflict") ? 409 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
