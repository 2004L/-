import { getGuestAiChain } from "@/lib/ai-control";
import { ensureAdminSchema, getAdminFromRequest } from "@/lib/admin-auth";

export const runtime = "edge";

/** Admin-only replay of a guest conversation: 表达 → 意图 → 计划 → 策略 → 工具 → 回执. */
export async function GET(request: Request) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sessionId)) return Response.json({ ok: false, error: "invalid_session_id" }, { status: 400 });
  try {
    const chain = await getGuestAiChain({ hotelId: auth.user.hotel_id, sessionId });
    return Response.json({ ok: true, session_id: sessionId, ...chain }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "ai_chain_failed" }, { status: 400 });
  }
}
