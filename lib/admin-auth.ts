import { getD1 } from "@/db";
import { rolePermissions, type AdminPermission, type AdminRole } from "@/lib/admin-tools";

export const ADMIN_COOKIE = "hotel_admin_session";
const SESSION_HOURS = 8;
const DEMO_SEED = "hotel-demo-2026";

export type AdminUser = { id: string; hotel_code: string; username: string; display_name: string; role: AdminRole; permissions: readonly AdminPermission[] };

function escapeCookie(value: string) { return value.replace(/[\\\"\r\n]/g, ""); }

export async function hashSecret(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ensureAdminSchema() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY, hotel_code TEXT NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, username TEXT, role TEXT, event_type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_sessions_token_idx ON admin_sessions(session_token_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_events(created_at, id)"),
  ]);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<{ count: number }>();
  if (!Number(count?.count ?? 0)) {
    const stamp = new Date().toISOString();
    const passwordHash = await hashSecret(DEMO_SEED);
    const users = [
      ["admin-owner-demo", "GZ-HAOS-001", "owner", "老板/所有者", "owner"],
      ["admin-manager-demo", "GZ-HAOS-001", "manager", "店长", "manager"],
      ["admin-frontdesk-demo", "GZ-HAOS-001", "frontdesk", "前台", "frontdesk"],
      ["admin-housekeeping-demo", "GZ-HAOS-001", "housekeeping", "客房", "housekeeping"],
    ];
    await db.batch(users.map(([id, hotel, username, display, role]) => db.prepare("INSERT INTO admin_users (id, hotel_code, username, display_name, role, password_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(id, hotel, username, display, role, passwordHash, stamp, stamp)));
  }
}

function toUser(row: { id: string; hotel_code: string; username: string; display_name: string; role: string }): AdminUser | null {
  if (!(row.role in rolePermissions)) return null;
  const role = row.role as AdminRole;
  return { id: row.id, hotel_code: row.hotel_code, username: row.username, display_name: row.display_name, role, permissions: rolePermissions[role] };
}

export async function authenticateAdmin(username: string, password: string) {
  const row = await getD1().prepare("SELECT id, hotel_code, username, display_name, role, password_hash FROM admin_users WHERE username = ? AND enabled = 1 LIMIT 1").bind(username.trim()).first<{ id: string; hotel_code: string; username: string; display_name: string; role: string; password_hash: string }>();
  if (!row || (await hashSecret(password)) !== row.password_hash) return null;
  return toUser(row);
}

export async function createAdminSession(user: AdminUser) {
  const rawToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const stamp = new Date();
  const expires = new Date(stamp.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  await getD1().prepare("INSERT INTO admin_sessions (id, user_id, session_token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, await hashSecret(rawToken), expires.toISOString(), stamp.toISOString(), stamp.toISOString()).run();
  return { rawToken, expires };
}

function readCookie(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const match = header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(ADMIN_COOKIE.length + 1)) : null;
}

export async function getAdminFromRequest(request: Request) {
  const token = readCookie(request);
  if (!token) return null;
  const row = await getD1().prepare("SELECT u.id, u.hotel_code, u.username, u.display_name, u.role, s.id AS session_id FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND u.enabled = 1 AND s.expires_at > ? LIMIT 1").bind(await hashSecret(token), new Date().toISOString()).first<{ id: string; hotel_code: string; username: string; display_name: string; role: string; session_id: string }>();
  if (!row) return null;
  await getD1().prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), row.session_id).run();
  const user = toUser(row);
  return user ? { user, sessionId: row.session_id } : null;
}

export function hasPermission(user: AdminUser, permission: AdminPermission) { return user.permissions.includes(permission); }

export async function auditAdmin(user: AdminUser | null, eventType: string, detail: string) {
  await getD1().prepare("INSERT INTO admin_audit_events (user_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(user?.id ?? null, user?.username ?? null, user?.role ?? null, eventType, detail.slice(0, 500), new Date().toISOString()).run();
}

export async function revokeAdminSession(request: Request) {
  const token = readCookie(request);
  if (!token) return null;
  const session = await getD1().prepare("SELECT id, user_id FROM admin_sessions WHERE session_token_hash = ? AND revoked_at IS NULL LIMIT 1").bind(await hashSecret(token)).first<{ id: string; user_id: string }>();
  if (!session) return null;
  await getD1().prepare("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), session.id).run();
  return session;
}

export async function requireAdmin(request: Request, permission?: AdminPermission) {
  const auth = await getAdminFromRequest(request);
  if (!auth) return { response: Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 }) } as const;
  if (permission && !hasPermission(auth.user, permission)) {
    await auditAdmin(auth.user, "ADMIN_PERMISSION_DENIED", `缺少权限 ${permission}`);
    return { response: Response.json({ ok: false, error: "admin_permission_denied", permission }, { status: 403 }) } as const;
  }
  return auth;
}

export function sessionCookie(token: string, maxAge = SESSION_HOURS * 60 * 60) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(escapeCookie(token))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
