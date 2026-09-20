import { getD1 } from "@/db";
import { d1SqlRunner } from "@/lib/orders";
import {
  TERMINAL_SESSION_DDL,
  createTerminalSession,
  endTerminalSession as endCore,
  purgeTerminalSessions as purgeCore,
  resolveTerminalSession,
  upgradeSessionIdentity as upgradeCore,
  type IdentityLevel,
} from "@/lib/terminal-session-core";

export { SESSION_ERRORS, meetsLevel, requireIdentityLevel, requireSessionSubject, type IdentityLevel, type TerminalSession } from "@/lib/terminal-session-core";

/** D1 适配层：路由只调这里，内核逻辑与数据库解耦。 */
export async function ensureTerminalSessionSchema() {
  const db = getD1();
  await db.batch(TERMINAL_SESSION_DDL.map((sql) => db.prepare(sql)));
}

export async function startTerminalSession(input: { tenantId: string; hotelId: string; terminalId: string; ttlMinutes?: number }) {
  await ensureTerminalSessionSchema();
  return createTerminalSession(d1SqlRunner(), input);
}

export async function verifyTerminalSession(input: { token: string; idleMinutes?: number }) {
  return resolveTerminalSession(d1SqlRunner(), input);
}

export async function upgradeTerminalIdentity(input: { token: string; level: IdentityLevel; subjectType?: string; subjectRef?: string; caseId?: string }) {
  await ensureTerminalSessionSchema();
  return upgradeCore(d1SqlRunner(), input);
}

export async function finishTerminalSession(input: { token: string; reason?: string }) {
  await ensureTerminalSessionSchema();
  return endCore(d1SqlRunner(), input);
}

export async function purgeFinishedTerminalSessions(input: { olderThanMinutes?: number } = {}) {
  await ensureTerminalSessionSchema();
  return purgeCore(d1SqlRunner(), input);
}
