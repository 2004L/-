ALTER TABLE admin_audit_events ADD COLUMN action_id TEXT;

CREATE INDEX IF NOT EXISTS admin_audit_action_idx
  ON admin_audit_events(hotel_id, action_id, created_at, id);
