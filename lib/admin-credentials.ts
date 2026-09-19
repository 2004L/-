import type { AdminRole } from "./admin-tools.ts";

// Cloudflare/Edge Web Crypto 的 PBKDF2 上限为 100000。
export const PBKDF2_ITERATIONS = 100000;

export type AdminSeedAccount = { id: string; username: string; displayName: string; role: AdminRole };

export const ADMIN_DEMO_ACCOUNTS: readonly AdminSeedAccount[] = [
  { id: "admin-owner-demo", username: "owner", displayName: "老板/所有者", role: "owner" },
  { id: "admin-manager-demo", username: "manager", displayName: "店长", role: "manager" },
  { id: "admin-frontdesk-demo", username: "frontdesk", displayName: "前台", role: "frontdesk" },
  { id: "admin-housekeeping-demo", username: "housekeeping", displayName: "客房", role: "housekeeping" },
];

export type EnvReader = (name: string) => string | undefined;

export function isProductionLike(env: EnvReader) {
  const marker = (env("ENVIRONMENT") ?? env("NODE_ENV") ?? "").trim().toLowerCase();
  return marker === "production" || marker === "prod";
}

export function envFlag(env: EnvReader, name: string, fallback: boolean) {
  const value = env(name)?.trim().toLowerCase();
  return value ? value === "true" : fallback;
}

/** Per-role password wins over the shared demo password; no hardcoded fallback. */
export function demoPasswordFor(account: AdminSeedAccount, env: EnvReader) {
  const scoped = env(`ADMIN_DEMO_PASSWORD_${account.username.toUpperCase()}`)?.trim();
  const shared = env("ADMIN_DEMO_PASSWORD")?.trim();
  return scoped || shared || null;
}

export type DemoSeedPlan = { enabled: boolean; reason: string | null; accounts: Array<AdminSeedAccount & { password: string }> };

/**
 * Decides whether demo admin accounts may be seeded. A missing password now
 * disables seeding instead of falling back to a hardcoded default.
 */
export function demoSeedPlan(env: EnvReader): DemoSeedPlan {
  if (!envFlag(env, "ADMIN_DEMO_ENABLED", !isProductionLike(env))) return { enabled: false, reason: "demo_accounts_disabled", accounts: [] };
  const accounts = ADMIN_DEMO_ACCOUNTS.map((account) => ({ ...account, password: demoPasswordFor(account, env) })).filter((account): account is AdminSeedAccount & { password: string } => Boolean(account.password));
  if (!accounts.length) return { enabled: false, reason: "demo_password_missing", accounts: [] };
  return { enabled: true, reason: accounts.length < ADMIN_DEMO_ACCOUNTS.length ? "partial_demo_password" : null, accounts };
}

export async function hashPasswordWithSalt(value: string, salt = crypto.randomUUID().replaceAll("-", "")) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  const hash = [...new Uint8Array(derived)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { hash: `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`, salt };
}

/** Detects the historical defect where every demo account shared one salt. */
export function needsSaltRotation(rows: Array<{ id: string; password_salt: string | null }>) {
  const demoRows = rows.filter((row) => row.id.endsWith("-demo") || row.id.startsWith("admin-"));
  if (demoRows.length < 2) return false;
  const salts = new Set(demoRows.map((row) => row.password_salt ?? ""));
  return salts.size < demoRows.length;
}
