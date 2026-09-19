import { getD1 } from "@/db";
import { rolePermissions, type AdminPermission, type AdminRole } from "@/lib/admin-tools";
import { DEFAULT_HOTEL_CODE, DEFAULT_HOTEL_ID, DEFAULT_TENANT_ID, ensureTenantFoundation } from "@/lib/tenant";

export const ADMIN_COOKIE = "hotel_admin_session";
const SESSION_HOURS = 8;
const SESSION_IDLE_MINUTES = 30;
// Cloudflare/Edge Web Crypto 的 PBKDF2 上限为 100000。
const PBKDF2_ITERATIONS = 100000;
const DEMO_SEED = "hotel-demo-2026";

export type AdminUser = { id: string; tenant_id: string; hotel_id: string; hotel_code: string; username: string; display_name: string; role: AdminRole; permissions: readonly AdminPermission[] };

function escapeCookie(value: string) { return value.replace(/[\\\"\r\n]/g, ""); }

export async function hashSecret(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function envBoolean(name: string, fallback: boolean) {
  try {
    const value = (typeof process !== "undefined" ? process.env?.[name] : undefined)?.trim().toLowerCase();
    return value ? value === "true" : fallback;
  } catch { return fallback; }
}

function hex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function hashPassword(value: string, salt = crypto.randomUUID().replaceAll("-", "")) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return { hash: `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hex(new Uint8Array(derived))}`, salt };
}

async function verifyPassword(value: string, stored: string, salt: string | null) {
  if (stored.startsWith("pbkdf2$") && salt) {
    const [scheme, iterationsText, encodedSalt, encodedHash] = stored.split("$");
    const iterations = Number(iterationsText);
    if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 100000 || iterations > PBKDF2_ITERATIONS || !encodedSalt || !encodedHash) return false;
    try {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
      const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(encodedSalt), iterations, hash: "SHA-256" }, key, 256);
      return hex(new Uint8Array(derived)) === encodedHash;
    } catch {
      return false;
    }
  }
  return (await hashSecret(value)) === stored;
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
  try { await db.prepare("ALTER TABLE admin_users ADD COLUMN password_salt TEXT").run(); } catch { /* 已存在 */ }
  try { await db.prepare("ALTER TABLE admin_audit_events ADD COLUMN action_id TEXT").run(); } catch { /* 已存在 */ }
  await ensureTenantFoundation();
  await db.prepare("CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_events(hotel_id, action_id, created_at, id)").run();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<{ count: number }>();
  if (!envBoolean("ADMIN_DEMO_ENABLED", true)) {
    await db.prepare("UPDATE admin_users SET enabled = 0, updated_at = ? WHERE id LIKE 'admin-%-demo'").bind(new Date().toISOString()).run();
  }
  if (!Number(count?.count ?? 0)) {
    const stamp = new Date().toISOString();
    const password = (typeof process !== "undefined" ? process.env?.ADMIN_DEMO_PASSWORD : undefined)?.trim() || DEMO_SEED;
    const passwordData = await hashPassword(password);
    const users = [
      ["admin-owner-demo", DEFAULT_HOTEL_CODE, "owner", "老板/所有者", "owner"],
      ["admin-manager-demo", DEFAULT_HOTEL_CODE, "manager", "店长", "manager"],
      ["admin-frontdesk-demo", DEFAULT_HOTEL_CODE, "frontdesk", "前台", "frontdesk"],
      ["admin-housekeeping-demo", DEFAULT_HOTEL_CODE, "housekeeping", "客房", "housekeeping"],
    ];
    await db.batch(users.map(([id, hotel, username, display, role]) => db.prepare("INSERT INTO admin_users (id, tenant_id, hotel_id, hotel_code, username, display_name, role, password_hash, password_salt, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, DEFAULT_TENANT_ID, DEFAULT_HOTEL_ID, hotel, username, display, role, passwordData.hash, passwordData.salt, envBoolean("ADMIN_DEMO_ENABLED", true) ? 1 : 0, stamp, stamp)));
  }
  await db.prepare("INSERT OR IGNORE INTO user_hotel_scopes (user_id, hotel_id, scope_role) SELECT id, hotel_id, role FROM admin_users WHERE hotel_id IS NOT NULL").run();
}

function toUser(row: { id: string; tenant_id?: string | null; hotel_id?: string | null; hotel_code: string; username: string; display_name: string; role: string }): AdminUser | null {
  if (!(row.role in rolePermissions)) return null;
  const role = row.role as AdminRole;
  return { id: row.id, tenant_id: row.tenant_id ?? DEFAULT_TENANT_ID, hotel_id: row.hotel_id ?? DEFAULT_HOTEL_ID, hotel_code: row.hotel_code, username: row.username, display_name: row.display_name, role, permissions: rolePermissions[role] };
}

export async function authenticateAdmin(username: string, password: string) {
  const row = await getD1().prepare("SELECT id, tenant_id, hotel_id, hotel_code, username, display_name, role, password_hash, password_salt FROM admin_users WHERE username = ? AND enabled = 1 LIMIT 1").bind(username.trim()).first<{ id: string; tenant_id: string | null; hotel_id: string | null; hotel_code: string; username: string; display_name: string; role: string; password_hash: string; password_salt: string | null }>();
  if (!row || !(await verifyPassword(password, row.password_hash, row.password_salt))) return null;
  if (!row.password_hash.startsWith("pbkdf2$") || !row.password_salt) {
    const upgraded = await hashPassword(password);
    await getD1().prepare("UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?").bind(upgraded.hash, upgraded.salt, new Date().toISOString(), row.id).run();
  }
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
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
  const row = await getD1().prepare("SELECT u.id, u.tenant_id, u.hotel_id, u.hotel_code, u.username, u.display_name, u.role, s.id AS session_id FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND u.enabled = 1 AND s.expires_at > ? AND s.last_seen_at > ? LIMIT 1").bind(await hashSecret(token), now.toISOString(), idleCutoff).first<{ id: string; tenant_id: string | null; hotel_id: string | null; hotel_code: string; username: string; display_name: string; role: string; session_id: string }>();
  if (!row) return null;
  await getD1().prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), row.session_id).run();
  const user = toUser(row);
  return user ? { user, sessionId: row.session_id } : null;
}

export function hasPermission(user: AdminUser, permission: AdminPermission) { return user.permissions.includes(permission); }

export async function auditAdmin(user: AdminUser | null, eventType: string, detail: string, options: { actionId?: string } = {}) {
  await getD1().prepare("INSERT INTO admin_audit_events (user_id, tenant_id, hotel_id, action_id, username, role, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(user?.id ?? null, user?.tenant_id ?? DEFAULT_TENANT_ID, user?.hotel_id ?? DEFAULT_HOTEL_ID, options.actionId ?? null, user?.username ?? null, user?.role ?? null, eventType, detail.slice(0, 500), new Date().toISOString()).run();
}

export async function adminLoginThrottled() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const row = await getD1().prepare("SELECT COUNT(*) AS count FROM admin_audit_events WHERE event_type = 'ADMIN_LOGIN_FAILED' AND created_at > ?").bind(cutoff).first<{ count: number }>();
  return Number(row?.count ?? 0) >= 20;
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
