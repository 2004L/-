import { adminTurnSchema, routeAdminIntent } from "@/lib/admin-tools";
import { ensureAdminSchema, getAdminFromRequest, auditAdmin } from "@/lib/admin-auth";

export const runtime = "edge";

export async function POST(request: Request) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  try {
    const input = adminTurnSchema.parse(await request.json());
    const latest = [...input.messages].reverse().find((item) => item.role === "user");
    if (!latest) return Response.json({ type: "clarification", message: "请说出要查询或办理的管理员事项。", intent: "admin_assistance", confidence: 0.5 });
    const result = routeAdminIntent(latest.content, { pending_action_id: input.pending_action_id });
    await auditAdmin(auth.user, "ADMIN_INTENT_ROUTED", `管理员意图已对齐：${result.type === "tool_call" ? result.tool_name : result.type}`);
    return Response.json({ ok: true, actor: { username: auth.user.username, role: auth.user.role }, response: result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
