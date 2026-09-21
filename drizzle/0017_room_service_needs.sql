CREATE TABLE IF NOT EXISTS room_service_needs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  room_number TEXT NOT NULL,
  stay_id TEXT,
  need TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reported_by TEXT,
  reported_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, room_number)
);
CREATE INDEX IF NOT EXISTS room_service_needs_hotel_status_idx ON room_service_needs(hotel_id, status, reported_at);