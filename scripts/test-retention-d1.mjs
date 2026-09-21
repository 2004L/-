import { readFileSync } from "node:fs";
import { FOLIOS_DDL, FOLIO_ERRORS } from "../lib/settlement-core.ts";
import { RETENTION_ERRORS, previewClosedLoopPurge, purgeClosedLoopsWith } from "../lib/retention-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * Retention deletes business records, so the interesting half is what it must NOT
 * touch: a guest still in house, an account still open, a room that is still
 * occupied. Every assertion below is either "this closed loop is gone" or "this
 * live one is still there".
 */

const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
const NOW = new Date("2026-09-19T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const environment = await createMiniflareD1();
if (!environment) {
  console.error("SKIP  未找到 miniflare，无法验证真实 D1 绑定");
  process.exit(0);
}
const { mf, db } = environment;
const runner = d1Runner(db);
const count = async (sql, params = []) => Number((await runner.first(sql, params)).c);

const execSql = async (path) => {
  const statements = readFileSync(path, "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
};

const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

/** One complete loop: booking, room link, status log, stay, account and entries. */
async function seedLoop(key, options) {
  const { checkedOutDaysAgo, inHouse = false } = options;
  const checkedOutAt = inHouse ? null : iso(checkedOutDaysAgo);
  const stamp = iso(checkedOutDaysAgo ?? 0);
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, '美团', ?, ?, ?, NULL, ?, '2026-09-01', 1, 1, 680, 300, 'CNY', 1, ?, ?, ?)")
    .bind(`res-${key}`, TENANT, HOTEL, `NO-${key}`, `NO-${key}`, `演示住客${key}`, "4821", inHouse ? 2 : 3, `reservation:${key}`, stamp, stamp).run();
  await db.prepare("INSERT INTO orders (id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, '美团', ?, 1, 'CNY', 380, 300, 680, 680, ?, '4821', ?, 1, ?, ?, ?)")
    .bind(`ord-${key}`, TENANT, HOTEL, `NO-${key}`, `NO-${key}`, `演示住客${key}`, `NO-${key}`, `order:${key}`, stamp, stamp).run();
  await db.prepare("INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 380, 1, ?, ?)")
    .bind(`rr-${key}`, TENANT, HOTEL, `res-${key}`, `rt-${HOTEL}-DLX-KING`, `room-${HOTEL}-1206`, stamp, stamp).run();
  await db.prepare("INSERT INTO reservation_status_logs (id, tenant_id, hotel_id, reservation_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES (?, ?, ?, ?, 2, ?, 'checkout', 'guest_flow', NULL, ?, ?)")
    .bind(`rsl-${key}`, TENANT, HOTEL, `res-${key}`, inHouse ? 2 : 3, `req-${key}`, stamp).run();
  await db.prepare("INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '4821', NULL, ?, ?, ?, 1, ?, ?)")
    .bind(`stay-${key}`, TENANT, HOTEL, `res-${key}`, `演示住客${key}`, inHouse ? 2 : 3, iso(checkedOutDaysAgo ?? 1), checkedOutAt, stamp, stamp).run();
  await db.prepare("INSERT INTO folios (id, tenant_id, hotel_id, stay_id, status, currency, balance, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CNY', 0, 1, ?, ?)")
    .bind(`folio-${key}`, TENANT, HOTEL, `stay-${key}`, inHouse ? "open" : "closed", stamp, stamp).run();
  for (const [suffix, type, amount] of [["dep", "deposit", -300], ["room", "room_charge", 380]]) {
    await db.prepare("INSERT INTO ledger_entries (id, tenant_id, hotel_id, folio_id, entry_type, amount, currency, idempotency_key, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, 'stay', ?, ?)")
      .bind(`le-${key}-${suffix}`, TENANT, HOTEL, `folio-${key}`, type, amount, `entry:${key}:${suffix}`, `stay-${key}`, stamp).run();
  }
}

try {
  await execSql("drizzle/0008_hotel_core_domain.sql");
  // 0013 backfills the legacy projection, so the demo table has to exist first.
  await db.prepare("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, phone_masked TEXT, stay_date TEXT, nights INTEGER, room_count INTEGER, room_type TEXT, status TEXT, room_number TEXT, room_amount INTEGER DEFAULT 380, deposit_amount INTEGER DEFAULT 300, total_amount INTEGER DEFAULT 680, created_at TEXT, updated_at TEXT)").run();
  await execSql("drizzle/0013_orders.sql");
  for (const statement of FOLIOS_DDL) await db.prepare(statement).run();
  await db.prepare("INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, '1206', 12, 3, 1, NULL, ?, ?)")
    .bind(`room-${HOTEL}-1206`, TENANT, HOTEL, `rt-${HOTEL}-DLX-KING`, iso(0), iso(0)).run();
  // 演示订单表在本用例前面已为 0013 建好；清理必须把被清掉的订单交还给演示界面。

  // A = 昨天退房，B = 20 天前，C = 202 天前，D = 还在住
  await seedLoop("A", { checkedOutDaysAgo: 1 });
  await db.prepare("INSERT INTO demo_orders (id, hotel_id, order_code, status, room_number, created_at, updated_at) VALUES ('demo-A', ?, 'NO-A', 'in_house', '1206', ?, ?)").bind(HOTEL, iso(1), iso(1)).run();
  await db.prepare("INSERT INTO demo_orders (id, hotel_id, order_code, status, room_number, created_at, updated_at) VALUES ('demo-D', ?, 'NO-D', 'in_house', '1206', ?, ?)").bind(HOTEL, iso(0), iso(0)).run();
  await seedLoop("B", { checkedOutDaysAgo: 20 });
  await seedLoop("C", { checkedOutDaysAgo: 202 });
  await seedLoop("D", { inHouse: true });

  console.log("== 1. 预览只统计窗口内的已退房闭环");
  const p3 = await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "3d", now: NOW });
  const p7 = await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "7d", now: NOW });
  const p30 = await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "30d", now: NOW });
  const p180 = await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "180d", now: NOW });
  const p365 = await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "365d", now: NOW });
  check("近三天只看到昨天那笔", p3.stays === 1 && p3.reservations === 1 && p3.orders === 1, JSON.stringify(p3));
  check("近七天同样只有那笔", p7.stays === 1, String(p7.stays));
  check("近一个月看到两笔", p30.stays === 2, String(p30.stays));
  check("近半年仍是两笔（202 天前那笔不在窗口内）", p180.stays === 2, String(p180.stays));
  check("近一年看到三笔", p365.stays === 3, String(p365.stays));
  check("在住房永远不进统计", p365.stays === 3 && p365.ledgerEntries === 6, JSON.stringify({ stays: p365.stays, entries: p365.ledgerEntries }));
  check("预览给出会被清理的房号", p3.rooms.join(",") === "1206", JSON.stringify(p3.rooms));
  check("预览算出要复位的演示订单", p3.demoOrdersReleased === 1, String(p3.demoOrdersReleased));
  check("预览不改动任何数据", (await count("SELECT COUNT(*) AS c FROM stays")) === 4);

  console.log("\n== 2. 清理只删窗口内的闭环，连子公司一起删干净");
  const purged = await purgeClosedLoopsWith(runner, { hotelId: HOTEL, range: "3d", windowStart: p3.windowStart, windowEnd: p3.windowEnd, requestId: "req-purge-3d" });
  check("清理回执与预览一致", purged.stays === 1 && purged.requestId === "req-purge-3d", JSON.stringify({ stays: purged.stays }));
  for (const [table, key] of [["stays", "stay-A"], ["reservations", "res-A"], ["orders", "ord-A"], ["folios", "folio-A"], ["reservation_rooms", "rr-A"], ["reservation_status_logs", "rsl-A"]]) {
    const left = await count(`SELECT COUNT(*) AS c FROM ${table} WHERE id = ?`, [key]);
    check(`A 的 ${table} 已删除`, left === 0, `left=${left}`);
  }
  check("A 的账本分录已删除", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE folio_id = ?", ["folio-A"])) === 0);
  check("B、C 的闭环完好", (await count("SELECT COUNT(*) AS c FROM stays WHERE id IN ('stay-B', 'stay-C')")) === 2);
  check("在住的 D 没有被碰", (await count("SELECT COUNT(*) AS c FROM stays WHERE id = 'stay-D' AND status = 2")) === 1);
  check("D 的账本仍然开着", (await count("SELECT COUNT(*) AS c FROM folios WHERE id = 'folio-D' AND status = 'open'")) === 1);
  check("D 的分录仍在", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE folio_id = 'folio-D'")) === 2);
  check("房态没有被清理改写", (await count("SELECT COUNT(*) AS c FROM rooms WHERE status = 3")) === 1);
  const released = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'demo-A'", []);
  check("被清理订单的演示侧回到待入住", released?.status === "awaiting_arrival" && released?.room_number === null, JSON.stringify(released));
  const untouched = await runner.first("SELECT status FROM demo_orders WHERE id = 'demo-D'", []);
  check("在住订单的演示侧没有被误放", untouched?.status === "in_house", JSON.stringify(untouched));

  console.log("\n== 3. 再清理一次是幂等的，不会误伤");
  const again = await purgeClosedLoopsWith(runner, { hotelId: HOTEL, range: "3d", windowStart: p3.windowStart, windowEnd: p3.windowEnd, requestId: "req-purge-3d-again" });
  check("第二次没有可删的闭环", again.stays === 0 && again.ledgerEntries === 0, JSON.stringify(again));
  check("总数仍是一共删掉一笔", (await count("SELECT COUNT(*) AS c FROM stays")) === 3);

  console.log("\n== 4. 参数与窗口校验");
  let rangeError = "";
  try { await previewClosedLoopPurge(runner, { hotelId: HOTEL, range: "1d" }); } catch (error) { rangeError = error.message; }
  check("非法区间被拒绝", rangeError === RETENTION_ERRORS.RANGE_INVALID, rangeError);
  let windowError = "";
  try { await purgeClosedLoopsWith(runner, { hotelId: HOTEL, range: "3d", windowStart: p3.windowEnd, windowEnd: p3.windowStart, requestId: "req-bad" }); } catch (error) { windowError = error.message; }
  check("倒置的窗口被拒绝", windowError === RETENTION_ERRORS.WINDOW_INVALID, windowError);
  let requestError = "";
  try { await purgeClosedLoopsWith(runner, { hotelId: HOTEL, range: "3d", windowStart: p3.windowStart, windowEnd: p3.windowEnd, requestId: "" }); } catch (error) { requestError = error.message; }
  check("缺少请求号被拒绝", requestError === RETENTION_ERRORS.REQUEST_INVALID, requestError);
  check("失败的清理没有删掉任何东西", (await count("SELECT COUNT(*) AS c FROM stays")) === 3);
  check("账本错误码仍可引用", Boolean(FOLIO_ERRORS.NOT_FOUND));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nRetention integration FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nRetention integration passed on a real D1 binding (miniflare/workerd).");