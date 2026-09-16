import { ensureAdminSchema, getAdminFromRequest } from "@/lib/admin-auth";

export const runtime = "edge";

export async function GET(request: Request) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  return Response.json({ ok: true, user: auth.user, expires_in_hours: 8 });
}
