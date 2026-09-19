-- AI Native multi-tenant and durable workflow foundation.
-- Existing demo rows are backfilled into the default Guangzhou hotel.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE TABLE IF NOT EXISTS hotels (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  brand_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  currency TEXT NOT NULL DEFAULT 'CNY',
  business_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (brand_id) REFERENCES brands(id)
);
CREATE TABLE IF NOT EXISTS hotel_terminals (
  id TEXT PRIMARY KEY NOT NULL,
  hotel_id TEXT NOT NULL,
  terminal_code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, terminal_code),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);
CREATE TABLE IF NOT EXISTS user_hotel_scopes (
  user_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  scope_role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, hotel_id),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

INSERT OR IGNORE INTO tenants (id, code, name, status, created_at, updated_at)
VALUES ('tenant-demo', 'DEMO', 'Hotel Agent OS 演示集团', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO brands (id, tenant_id, code, name, created_at, updated_at)
VALUES ('brand-demo', 'tenant-demo', 'DEMO', 'Hotel Agent OS 演示品牌', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO hotels (id, tenant_id, brand_id, code, name, timezone, currency, business_date, status, created_at, updated_at)
VALUES ('hotel-gz-demo', 'tenant-demo', 'brand-demo', 'GZ-HAOS-001', '广州示范店', 'Asia/Shanghai', 'CNY', date('now', 'localtime'), 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE demo_sessions ADD COLUMN tenant_id TEXT;
ALTER TABLE demo_sessions ADD COLUMN hotel_id TEXT;
ALTER TABLE demo_orders ADD COLUMN tenant_id TEXT;
ALTER TABLE demo_orders ADD COLUMN hotel_id TEXT;
ALTER TABLE checkin_cases ADD COLUMN tenant_id TEXT;
ALTER TABLE checkin_cases ADD COLUMN hotel_id TEXT;
ALTER TABLE browser_jobs ADD COLUMN tenant_id TEXT;
ALTER TABLE browser_jobs ADD COLUMN hotel_id TEXT;
ALTER TABLE audit_events ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_events ADD COLUMN hotel_id TEXT;
ALTER TABLE external_commands ADD COLUMN tenant_id TEXT;
ALTER TABLE external_commands ADD COLUMN hotel_id TEXT;
ALTER TABLE simulator_faults ADD COLUMN tenant_id TEXT;
ALTER TABLE simulator_faults ADD COLUMN hotel_id TEXT;
ALTER TABLE manual_tasks ADD COLUMN tenant_id TEXT;
ALTER TABLE manual_tasks ADD COLUMN hotel_id TEXT;
ALTER TABLE walk_in_drafts ADD COLUMN tenant_id TEXT;
ALTER TABLE walk_in_drafts ADD COLUMN hotel_id TEXT;
ALTER TABLE walk_in_payments ADD COLUMN tenant_id TEXT;
ALTER TABLE walk_in_payments ADD COLUMN hotel_id TEXT;
ALTER TABLE admin_users ADD COLUMN tenant_id TEXT;
ALTER TABLE admin_users ADD COLUMN hotel_id TEXT;
ALTER TABLE admin_audit_events ADD COLUMN tenant_id TEXT;
ALTER TABLE admin_audit_events ADD COLUMN hotel_id TEXT;
ALTER TABLE admin_audit_events ADD COLUMN request_id TEXT;
ALTER TABLE admin_actions ADD COLUMN tenant_id TEXT;
ALTER TABLE admin_actions ADD COLUMN hotel_id TEXT;
ALTER TABLE admin_actions ADD COLUMN workflow_id TEXT;
ALTER TABLE ai_request_metrics ADD COLUMN tenant_id TEXT;
ALTER TABLE ai_request_metrics ADD COLUMN hotel_id TEXT;

UPDATE demo_sessions SET tenant_id = 'tenant-demo', hotel_id = 'hotel-gz-demo' WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE demo_orders SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = demo_orders.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE checkin_cases SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = checkin_cases.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE browser_jobs SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = browser_jobs.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE audit_events SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = audit_events.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE external_commands SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = external_commands.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE simulator_faults SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = simulator_faults.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE manual_tasks SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = manual_tasks.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE walk_in_drafts SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = walk_in_drafts.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE walk_in_payments SET tenant_id = 'tenant-demo', hotel_id = (SELECT hotel_id FROM demo_sessions WHERE demo_sessions.id = walk_in_payments.session_id) WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE admin_users SET tenant_id = 'tenant-demo', hotel_id = 'hotel-gz-demo' WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE admin_actions SET tenant_id = 'tenant-demo', hotel_id = 'hotel-gz-demo' WHERE tenant_id IS NULL OR hotel_id IS NULL;
UPDATE ai_request_metrics SET tenant_id = 'tenant-demo' WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS demo_sessions_hotel_idx ON demo_sessions(hotel_id, updated_at);
CREATE INDEX IF NOT EXISTS demo_orders_hotel_phone_status_idx ON demo_orders(hotel_id, phone_last4, status, updated_at);
CREATE INDEX IF NOT EXISTS demo_orders_hotel_room_status_idx ON demo_orders(hotel_id, room_number, status);
CREATE INDEX IF NOT EXISTS checkin_cases_hotel_status_idx ON checkin_cases(hotel_id, status, updated_at);
CREATE INDEX IF NOT EXISTS external_commands_hotel_status_idx ON external_commands(hotel_id, status, updated_at);
CREATE INDEX IF NOT EXISTS admin_users_hotel_idx ON admin_users(hotel_id, enabled);
CREATE INDEX IF NOT EXISTS admin_actions_hotel_status_idx ON admin_actions(hotel_id, status, created_at);
CREATE INDEX IF NOT EXISTS admin_audit_hotel_created_idx ON admin_audit_events(hotel_id, created_at, id);
CREATE INDEX IF NOT EXISTS ai_request_metrics_hotel_created_idx ON ai_request_metrics(hotel_id, created_at);

CREATE TABLE IF NOT EXISTS ai_workflows (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  terminal_id TEXT,
  session_id TEXT,
  conversation_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  intent TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_step TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_intents (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_text_redacted TEXT NOT NULL,
  intent TEXT NOT NULL,
  confidence INTEGER,
  arguments_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_plans (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (request_id, tool_call_id)
);
CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_workflows_hotel_status_idx ON ai_workflows(hotel_id, status, updated_at);
CREATE INDEX IF NOT EXISTS ai_intents_workflow_idx ON ai_intents(workflow_id, created_at);
CREATE INDEX IF NOT EXISTS ai_intents_hotel_idx ON ai_intents(hotel_id, created_at);
CREATE INDEX IF NOT EXISTS ai_plans_workflow_idx ON ai_plans(workflow_id, updated_at);
CREATE INDEX IF NOT EXISTS ai_tool_calls_workflow_idx ON ai_tool_calls(workflow_id, created_at);
CREATE INDEX IF NOT EXISTS policy_decisions_workflow_idx ON policy_decisions(workflow_id, created_at);
