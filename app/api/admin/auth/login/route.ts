import { z } from "zod";
import { authenticateAdmin, auditAdmin, createAdminSession, ensureAdminSchema, sessionCookie } from "@/lib/admin-auth";

export const runtime = "edge";
const loginSchema = z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  await ensureAdminSchema();
  try {
    const input = loginSchema.parse(await request.json());
    const user = await authenticateAdmin(input.username, input.password);
    if (!user) {
      await auditAdmin(null, "ADMIN_LOGIN_FAILED", "管理员登录失败");
      return Response.json({ ok: false, error: "invalid_admin_credentials" }, { status: 401 });
    }
    const session = await createAdminSession(user);
    await auditAdmin(user, "ADMIN_LOGIN_SUCCEEDED", "管理员会话已建立");
    return Response.json({ ok: true, user }, { headers: { "Set-Cookie": sessionCookie(session.rawToken) } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
