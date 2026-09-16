CREATE TABLE IF NOT EXISTS walk_in_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  phone_token TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  phone_masked TEXT NOT NULL,
  stay_date TEXT NOT NULL,
  nights INTEGER NOT NULL DEFAULT 1,
  room_count INTEGER NOT NULL DEFAULT 1,
  room_type_code TEXT,
  room_type_name TEXT,
  nightly_rate INTEGER,
  room_amount INTEGER,
  deposit_amount INTEGER,
  total_amount INTEGER,
  status TEXT NOT NULL,
  payment_id TEXT,
  order_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS walk_in_drafts_session_status_idx ON walk_in_drafts(session_id, status, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS walk_in_payments (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES walk_in_drafts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  receipt TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS walk_in_payments_draft_uq ON walk_in_payments(draft_id);
