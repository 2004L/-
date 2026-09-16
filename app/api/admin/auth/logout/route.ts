import { auditAdmin, ensureAdminSchema, getAdminFromRequest, revokeAdminSession, sessionCookie } from "@/lib/admin-auth";

export const runtime = "edge";

export async function POST(request: Request) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  await revokeAdminSession(request);
  if (auth) await auditAdmin(auth.user, "ADMIN_LOGOUT", "管理员会话已退出");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}
