import type { SqlRunner } from "./orders-core.ts";

/**
 * 终端会话（“门票”）内核：服务端签发、可核验、可升级、可失效。
 * 只依赖 SqlRunner 端口，不接触数据库实现，便于在真实 D1 上做集成验证。
 */
export const TERMINAL_SESSION_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS terminal_sessions (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, terminal_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', identity_level TEXT NOT NULL DEFAULT 'unverified', subject_type TEXT, subject_ref TEXT, case_id TEXT, generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT)",
  "CREATE INDEX IF NOT EXISTS terminal_sessions_hotel_status_idx ON terminal_sessions(hotel_id, status, last_seen_at)",
  "CREATE INDEX IF NOT EXISTS terminal_sessions_terminal_idx ON terminal_sessions(terminal_id, status)",
];

export type SessionStatus = "active" | "ended" | "revoked" | "expired";
export type IdentityLevel = "unverified" | "card_read" | "identity_verified";

export type TerminalSession = {
  id: string; tenant_id: string; hotel_id: string; terminal_id: string; token_hash: string;
  status: SessionStatus; identity_level: IdentityLevel;
  subject_type: string | null; subject_ref: string | null; case_id: string | null;
  generation: number; created_at: string; last_seen_at: string; expires_at: string;
  ended_at: string | null; end_reason: string | null;
};

export const SESSION_ERRORS = {
  NOT_FOUND: "session_not_found",
  EXPIRED: "session_expired",
  ENDED: "session_ended",
  REVOKED: "session_revoked",
  LEVEL: "session_level_insufficient",
  SUBJECT: "session_subject_mismatch",
} as const;

const LEVEL_ORDER: IdentityLevel[] = ["unverified", "card_read", "identity_verified"];

export function levelRank(level: string) {
  const index = LEVEL_ORDER.indexOf(level as IdentityLevel);
  return index < 0 ? -1 : index;
}

export function meetsLevel(actual: string, required: IdentityLevel) {
  return levelRank(actual) >= levelRank(required);
}

/** 令牌只存哈希，库里不留明文。 */
export async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const FIELDS = "id, tenant_id, hotel_id, terminal_id, token_hash, status, identity_level, subject_type, subject_ref, case_id, generation, created_at, last_seen_at, expires_at, ended_at, end_reason";

function clampMinutes(value: number | undefined, fallback: number) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 240 ? Math.floor(minutes) : fallback;
}

export async function createTerminalSession(db: SqlRunner, input: { tenantId: string; hotelId: string; terminalId: string; ttlMinutes?: number; token?: string }) {
  const token = input.token ?? `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await hashSessionToken(token);
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const expiresAt = new Date(now + clampMinutes(input.ttlMinutes, 30) * 60_000).toISOString();
  const id = `ts-${crypto.randomUUID()}`;
  await db.run(
    "INSERT INTO terminal_sessions (id, tenant_id, hotel_id, terminal_id, token_hash, status, identity_level, generation, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, 'active', 'unverified', 1, ?, ?, ?)",
    [id, input.tenantId, input.hotelId, input.terminalId, tokenHash, stamp, stamp, expiresAt],
  );
  return { sessionId: id, token, expiresAt };
}

async function retire(db: SqlRunner, sessionId: string, status: SessionStatus, reason: string) {
  await db.run("UPDATE terminal_sessions SET status = ?, ended_at = ?, end_reason = ? WHERE id = ? AND status = 'active'", [status, new Date().toISOString(), reason, sessionId]);
}

export async function resolveTerminalSession(db: SqlRunner, input: { token: string; idleMinutes?: number }) {
  const tokenHash = await hashSessionToken(input.token);
  const row = await db.first<TerminalSession>(`SELECT ${FIELDS} FROM terminal_sessions WHERE token_hash = ? LIMIT 1`, [tokenHash]);
  if (!row) throw new Error(SESSION_ERRORS.NOT_FOUND);
  if (row.status === "ended") throw new Error(SESSION_ERRORS.ENDED);
  if (row.status === "revoked") throw new Error(SESSION_ERRORS.REVOKED);
  if (row.status === "expired") throw new Error(SESSION_ERRORS.EXPIRED);
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    await retire(db, row.id, "expired", "expired_at");
    throw new Error(SESSION_ERRORS.EXPIRED);
  }
  if (now - new Date(row.last_seen_at).getTime() > clampMinutes(input.idleMinutes, 15) * 60_000) {
    await retire(db, row.id, "expired", "idle_timeout");
    throw new Error(SESSION_ERRORS.EXPIRED);
  }
  const seenAt = new Date(now).toISOString();
  await db.run("UPDATE terminal_sessions SET last_seen_at = ? WHERE id = ?", [seenAt, row.id]);
  return { ...row, last_seen_at: seenAt };
}

/** 身份等级只升不降：读卡只是线索，核验通过才算数。 */
export async function upgradeSessionIdentity(db: SqlRunner, input: { token: string; level: IdentityLevel; subjectType?: string; subjectRef?: string; caseId?: string }) {
  const session = await resolveTerminalSession(db, { token: input.token });
  if (levelRank(input.level) <= levelRank(session.identity_level)) return session;
  await db.run(
    "UPDATE terminal_sessions SET identity_level = ?, subject_type = COALESCE(?, subject_type), subject_ref = COALESCE(?, subject_ref), case_id = COALESCE(?, case_id) WHERE id = ? AND status = 'active'",
    [input.level, input.subjectType ?? null, input.subjectRef ?? null, input.caseId ?? null, session.id],
  );
  return { ...session, identity_level: input.level, subject_type: input.subjectType ?? session.subject_type, subject_ref: input.subjectRef ?? session.subject_ref, case_id: input.caseId ?? session.case_id };
}

export function requireIdentityLevel(session: TerminalSession, required: IdentityLevel) {
  if (!meetsLevel(session.identity_level, required)) throw new Error(SESSION_ERRORS.LEVEL);
  return session;
}

/**
 * 隔离闸门：会话只能访问自己绑定的业务对象。
 * 即使前端误传别人的订单号，也会在这里被拒绝。
 */
export function requireSessionSubject(session: TerminalSession, subjectRef: string) {
  if (!session.subject_ref || session.subject_ref !== subjectRef) throw new Error(SESSION_ERRORS.SUBJECT);
  return session;
}

export async function endTerminalSession(db: SqlRunner, input: { token: string; reason?: string }) {
  const tokenHash = await hashSessionToken(input.token);
  const result = await db.run("UPDATE terminal_sessions SET status = 'ended', ended_at = ?, end_reason = ? WHERE token_hash = ? AND status = 'active'", [new Date().toISOString(), input.reason ?? "guest_finished", tokenHash]);
  return result.changes > 0;
}

/** 清理任务用：删除已结束/过期的历史会话（保留期内不动）。 */
export async function purgeTerminalSessions(db: SqlRunner, input: { olderThanMinutes?: number } = {}) {
  const cutoff = new Date(Date.now() - clampMinutes(input.olderThanMinutes, 60) * 60_000).toISOString();
  const result = await db.run("DELETE FROM terminal_sessions WHERE status <> 'active' AND ended_at IS NOT NULL AND ended_at < ?", [cutoff]);
  return result.changes;
}
