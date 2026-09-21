import { getD1 } from "@/db";

export const DEFAULT_TENANT_ID = "tenant-demo";
export const DEFAULT_HOTEL_ID = "hotel-gz-demo";
export const DEFAULT_HOTEL_CODE = "GZ-HAOS-001";

export type TenantContext = {
  tenantId: string;
  hotelId: string;
  hotelCode: string;
};

const additiveColumns: Array<[string, string]> = [
  ["demo_sessions", "tenant_id TEXT"], ["demo_sessions", "hotel_id TEXT"],
  ["demo_orders", "tenant_id TEXT"], ["demo_orders", "hotel_id TEXT"],
  ["checkin_cases", "tenant_id TEXT"], ["checkin_cases", "hotel_id TEXT"],
  ["browser_jobs", "tenant_id TEXT"], ["browser_jobs", "hotel_id TEXT"],
  ["audit_events", "tenant_id TEXT"], ["audit_events", "hotel_id TEXT"],
  ["external_commands", "tenant_id TEXT"], ["external_commands", "hotel_id TEXT"],
  ["simulator_faults", "tenant_id TEXT"], ["simulator_faults", "hotel_id TEXT"],
  ["manual_tasks", "tenant_id TEXT"], ["manual_tasks", "hotel_id TEXT"],
  ["walk_in_drafts", "tenant_id TEXT"], ["walk_in_drafts", "hotel_id TEXT"],
  ["walk_in_payments", "tenant_id TEXT"], ["walk_in_payments", "hotel_id TEXT"],
  ["admin_users", "tenant_id TEXT"], ["admin_users", "hotel_id TEXT"],
  ["admin_audit_events", "tenant_id TEXT"], ["admin_audit_events", "hotel_id TEXT"], ["admin_audit_events", "request_id TEXT"], ["admin_audit_events", "action_id TEXT"],
  ["admin_actions", "tenant_id TEXT"], ["admin_actions", "hotel_id TEXT"], ["admin_actions", "workflow_id TEXT"],
  ["ai_request_metrics", "tenant_id TEXT"], ["ai_request_metrics", "hotel_id TEXT"],
  ["demo_sessions", "note TEXT"],
];

export async function ensureTenantFoundation() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, code))"),
    db.prepare("CREATE TABLE IF NOT EXISTS hotels (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, brand_id TEXT, code TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', currency TEXT NOT NULL DEFAULT 'CNY', business_date TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, code))"),
    db.prepare("CREATE TABLE IF NOT EXISTS hotel_terminals (id TEXT PRIMARY KEY NOT NULL, hotel_id TEXT NOT NULL, terminal_code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(hotel_id, terminal_code))"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_hotel_scopes (user_id TEXT NOT NULL, hotel_id TEXT NOT NULL, scope_role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL, PRIMARY KEY(user_id, hotel_id))"),
  ]);
  for (const [table, column] of additiveColumns) {
    try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column}`).run(); } catch { /* migration already applied */ }
  }
  const stamp = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenants (id, code, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(DEFAULT_TENANT_ID, "DEMO", "Hotel Agent OS 演示集团", stamp, stamp),
    db.prepare("INSERT OR IGNORE INTO brands (id, tenant_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("brand-demo", DEFAULT_TENANT_ID, "DEMO", "Hotel Agent OS 演示品牌", stamp, stamp),
    db.prepare("INSERT OR IGNORE INTO hotels (id, tenant_id, brand_id, code, name, timezone, currency, business_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Asia/Shanghai', 'CNY', ?, 'active', ?, ?)").bind(DEFAULT_HOTEL_ID, DEFAULT_TENANT_ID, "brand-demo", DEFAULT_HOTEL_CODE, "广州示范店", stamp.slice(0, 10), stamp, stamp),
    db.prepare("UPDATE demo_sessions SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, ?) WHERE hotel_code = ? OR hotel_id IS NULL").bind(DEFAULT_TENANT_ID, DEFAULT_HOTEL_ID, DEFAULT_HOTEL_CODE),
    db.prepare("UPDATE demo_orders SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = demo_orders.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE checkin_cases SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = checkin_cases.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE browser_jobs SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = browser_jobs.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE audit_events SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = audit_events.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE external_commands SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = external_commands.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE simulator_faults SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = simulator_faults.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE manual_tasks SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = manual_tasks.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE walk_in_drafts SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = walk_in_drafts.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE walk_in_payments SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = walk_in_payments.session_id)) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID),
    db.prepare("UPDATE admin_users SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, ?) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID, DEFAULT_HOTEL_ID),
    db.prepare("UPDATE admin_actions SET tenant_id = COALESCE(tenant_id, ?), hotel_id = COALESCE(hotel_id, ?) WHERE hotel_id IS NULL").bind(DEFAULT_TENANT_ID, DEFAULT_HOTEL_ID),
    db.prepare("UPDATE ai_request_metrics SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL").bind(DEFAULT_TENANT_ID),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS demo_orders_hotel_phone_status_idx ON demo_orders(hotel_id, phone_last4, status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS demo_orders_hotel_room_status_idx ON demo_orders(hotel_id, room_number, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_users_hotel_idx ON admin_users(hotel_id, enabled)"),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_actions_hotel_status_idx ON admin_actions(hotel_id, status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_audit_hotel_created_idx ON admin_audit_events(hotel_id, created_at, id)"),
  ]);
}

export function defaultTenantContext(): TenantContext {
  return { tenantId: DEFAULT_TENANT_ID, hotelId: DEFAULT_HOTEL_ID, hotelCode: DEFAULT_HOTEL_CODE };
}
