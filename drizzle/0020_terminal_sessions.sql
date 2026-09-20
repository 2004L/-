-- 终端会话（服务端签发的“门票”）：绑定终端/租户/酒店/身份等级/业务对象，
-- 令牌只存哈希，可失效、可清理。会话隔离的载体。
CREATE TABLE IF NOT EXISTS terminal_sessions (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, terminal_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', identity_level TEXT NOT NULL DEFAULT 'unverified', subject_type TEXT, subject_ref TEXT, case_id TEXT, generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT);
CREATE INDEX IF NOT EXISTS terminal_sessions_hotel_status_idx ON terminal_sessions(hotel_id, status, last_seen_at);
CREATE INDEX IF NOT EXISTS terminal_sessions_terminal_idx ON terminal_sessions(terminal_id, status);
