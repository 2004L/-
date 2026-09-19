-- Phase 2: formal hotel core domain and durable workflow state.
-- Money is stored in minor units (fen); statuses are integer state machines.
CREATE TABLE IF NOT EXISTS room_types (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  pms_code TEXT,
  max_occupancy INTEGER NOT NULL DEFAULT 2,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, code)
);
CREATE INDEX IF NOT EXISTS room_types_hotel_active_idx ON room_types(hotel_id, active);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  room_number TEXT NOT NULL,
  floor INTEGER,
  status INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  pms_room_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, room_number)
);
CREATE INDEX IF NOT EXISTS rooms_hotel_status_idx ON rooms(hotel_id, status);
CREATE INDEX IF NOT EXISTS rooms_hotel_type_status_idx ON rooms(hotel_id, room_type_id, status);

CREATE TABLE IF NOT EXISTS room_status_logs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  from_status INTEGER,
  to_status INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS room_status_logs_hotel_room_idx ON room_status_logs(hotel_id, room_id, created_at);
CREATE INDEX IF NOT EXISTS room_status_logs_request_idx ON room_status_logs(request_id);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  reservation_no TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  guest_name_masked TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  phone_hash TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  stay_date TEXT NOT NULL,
  nights INTEGER NOT NULL DEFAULT 1,
  room_count INTEGER NOT NULL DEFAULT 1,
  total_amount INTEGER NOT NULL DEFAULT 0,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, reservation_no),
  UNIQUE (hotel_id, source, external_id),
  UNIQUE (hotel_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS reservations_hotel_phone_status_idx ON reservations(hotel_id, phone_last4, status);
CREATE INDEX IF NOT EXISTS reservations_hotel_stay_idx ON reservations(hotel_id, stay_date, status);

CREATE TABLE IF NOT EXISTS reservation_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  room_id TEXT,
  nightly_rate INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reservation_rooms_hotel_reservation_idx ON reservation_rooms(hotel_id, reservation_id);
CREATE INDEX IF NOT EXISTS reservation_rooms_hotel_room_idx ON reservation_rooms(hotel_id, room_id);

CREATE TABLE IF NOT EXISTS reservation_status_logs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  from_status INTEGER,
  to_status INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reservation_status_logs_hotel_reservation_idx ON reservation_status_logs(hotel_id, reservation_id, created_at);

CREATE TABLE IF NOT EXISTS stays (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  reservation_id TEXT,
  guest_name_masked TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  identity_token TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  checked_out_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stays_hotel_status_idx ON stays(hotel_id, status);
CREATE INDEX IF NOT EXISTS stays_hotel_reservation_idx ON stays(hotel_id, reservation_id);

CREATE TABLE IF NOT EXISTS folios (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  stay_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  currency TEXT NOT NULL DEFAULT 'CNY',
  balance INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, stay_id)
);
CREATE INDEX IF NOT EXISTS folios_hotel_status_idx ON folios(hotel_id, status);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  folio_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  idempotency_key TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (hotel_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ledger_entries_hotel_folio_idx ON ledger_entries(hotel_id, folio_id, created_at);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS workflow_runs_hotel_status_idx ON workflow_runs(hotel_id, status, updated_at);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_code TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workflow_run_id, step_key)
);
CREATE INDEX IF NOT EXISTS workflow_steps_hotel_status_idx ON workflow_steps(hotel_id, status, updated_at);
