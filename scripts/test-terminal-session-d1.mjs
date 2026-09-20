import {
  SESSION_ERRORS,
  TERMINAL_SESSION_DDL,
  createTerminalSession,
  endTerminalSession,
  purgeTerminalSessions,
  requireIdentityLevel,
  requireSessionSubject,
  resolveTerminalSession,
  upgradeSessionIdentity,
} from "../lib/terminal-session-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const environment = await createMiniflareD1();
if (!environment) {
  console.error("SKIP  未找到 miniflare，无法验证真实 D1");
  process.exit(0);
}
const { mf, db } = environment;
const runner = d1Runner(db);
const base = { tenantId: "tenant-demo", hotelId: "hotel-gz-demo", terminalId: "terminal-1" };

try {
  for (const statement of TERMINAL_SESSION_DDL) await db.prepare(statement).run();

  console.log("== 1. 服务端签发门票");
  const first = await createTerminalSession(runner, base);
  const stored = await db.prepare("SELECT token_hash, identity_level, status FROM terminal_sessions WHERE id = ?").bind(first.sessionId).first();
  check("门票已签发且初始为未核验", stored.identity_level === "unverified" && stored.status === "active");
  check("库里不存明文令牌", stored.token_hash !== first.token && stored.token_hash.length === 64);
  const resolved = await resolveTerminalSession(runner, { token: first.token });
  check("凭令牌可解析出会话", resolved.id === first.sessionId);
  check("伪造令牌被拒绝", await reject(() => resolveTerminalSession(runner, { token: "forged-token" })) === SESSION_ERRORS.NOT_FOUND);

  console.log("\n== 2. 身份等级只升不降");
  check("未核验不得查私人资料", await reject(() => requireIdentityLevel(resolved, "identity_verified")) === SESSION_ERRORS.LEVEL);
  const cardRead = await upgradeSessionIdentity(runner, { token: first.token, level: "card_read", subjectType: "reservation", subjectRef: "MT-20260914-4821" });
  check("读卡后等级提升", cardRead.identity_level === "card_read");
  const verified = await upgradeSessionIdentity(runner, { token: first.token, level: "identity_verified" });
  check("核验后可查私人资料", requireIdentityLevel(verified, "identity_verified").identity_level === "identity_verified");
  const downgraded = await upgradeSessionIdentity(runner, { token: first.token, level: "card_read" });
  check("等级不会被降级", downgraded.identity_level === "identity_verified");

  console.log("\n== 3. 会话只能碰自己绑定的业务对象");
  check("访问他人订单被拒绝", await reject(() => requireSessionSubject(verified, "MT-9999")) === SESSION_ERRORS.SUBJECT);
  check("访问自己订单通过", requireSessionSubject(verified, "MT-20260914-4821").subject_ref === "MT-20260914-4821");

  console.log("\n== 4. 另一位客人是全新会话");
  const second = await createTerminalSession(runner, base);
  const secondSession = await resolveTerminalSession(runner, { token: second.token });
  check("新客人等级重新回到未核验", secondSession.identity_level === "unverified");
  check("新客人没有上一客人的业务对象", secondSession.subject_ref === null);
  check("新客人拿不到上一客人的资料", await reject(() => requireSessionSubject(secondSession, "MT-20260914-4821")) === SESSION_ERRORS.SUBJECT);

  console.log("\n== 5. 结束即失效");
  const ended = await endTerminalSession(runner, { token: first.token, reason: "guest_finished" });
  check("结束操作生效", ended === true);
  check("旧门票的新请求被拒绝", await reject(() => resolveTerminalSession(runner, { token: first.token })) === SESSION_ERRORS.ENDED);

  console.log("\n== 6. 空闲超时");
  const idle = await createTerminalSession(runner, { ...base, ttlMinutes: 60 });
  await db.prepare("UPDATE terminal_sessions SET last_seen_at = ? WHERE id = ?").bind(new Date(Date.now() - 20 * 60_000).toISOString(), idle.sessionId).run();
  check("超时会话被判定过期", await reject(() => resolveTerminalSession(runner, { token: idle.token, idleMinutes: 15 })) === SESSION_ERRORS.EXPIRED);
  const expiredRow = await db.prepare("SELECT status, end_reason FROM terminal_sessions WHERE id = ?").bind(idle.sessionId).first();
  check("过期原因写入会话", expiredRow.status === "expired" && expiredRow.end_reason === "idle_timeout", JSON.stringify(expiredRow));

  console.log("\n== 7. 历史会话可清理");
  await db.prepare("UPDATE terminal_sessions SET ended_at = ? WHERE status <> 'active'").bind(new Date(Date.now() - 120 * 60_000).toISOString()).run();
  const purged = await purgeTerminalSessions(runner, { olderThanMinutes: 60 });
  check("已结束会话被清理", purged >= 2, `purged=${purged}`);
  const remaining = await db.prepare("SELECT COUNT(*) AS c FROM terminal_sessions WHERE status = 'active'").first();
  check("在办的会话不会被清掉", Number(remaining.c) === 1, JSON.stringify(remaining));
} finally {
  await mf.dispose();
}

async function reject(run) {
  try { await run(); return null; } catch (error) { return error instanceof Error ? error.message : "unknown"; }
}

if (failures) {
  console.error(`\nTerminal session checks FAILED: ${failures}.`);
  process.exit(1);
}
console.log("\nTerminal session checks passed on a real D1 binding (miniflare/workerd).");
