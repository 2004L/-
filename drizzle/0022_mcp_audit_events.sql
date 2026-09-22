CREATE TABLE IF NOT EXISTS mcp_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_audit_events_hotel_created_idx ON mcp_audit_events(hotel_id, created_at);
