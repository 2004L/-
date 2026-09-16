CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_actions_user_status_idx ON admin_actions(user_id, status, created_at);
