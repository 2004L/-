import { readFileSync } from "node:fs";
import { demoOrderReconcileAllStatement, demoOrderReconcileStatement, legacyCoreStatements } from "../lib/legacy-projection-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * The demo projection used to key its child rows on an id the current session
 * invented: "stay-" + demo_orders.id. Reservations are unique on
 * (hotel_id, reservation_no), so only the first session's booking survived and
 * every later session wrote a stay pointing at a booking that was never created —
 * or, worse, collided with the one that did exist. This suite runs the real SQL
 * from lib/legacy-core-sync.ts against a real D1 binding and asserts the two
 * writers now meet on the same rows.
 */
const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
const STAMP = "2026-09-19T10:00:00.000Z";
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
const runProjection = async (roomTypes) => {
  for (const statement of legacyCoreStatements({ tenantId: TENANT, hotelId: HOTEL, stamp: STAMP, roomTypes })) {
    await db.prepare(statement.sql).bind(...statement.params).run();
  }
};

// One in-house order (with a room) and one still awaiting arrival, seeded twice:
// the second copy stands for a second browser session seeing the same order numbers.
const seedSession = async (sessionId) => {
  for (const [suffix, orderCode, status, roomNumber] of [["1", "MT-20260913-7366", "in_house", "1206"], ["2", "WEB-20260915-2178", "awaiting_arrival", null]]) {
    await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, '美团', ?, '7366', '2026-09-18', 2, 1, '高级大床房', ?, ?, 760, 300, 760, ?, ?)")
      .bind(`${sessionId}-order-${suffix}`, sessionId, HOTEL, orderCode, `演示住客${suffix}`, status, roomNumber, STAMP, STAMP).run();
  }
};

try {
  await execSql("drizzle/0008_hotel_core_domain.sql");
  await db.prepare("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, session_id TEXT, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, phone_masked TEXT, stay_date TEXT, nights INTEGER, room_count INTEGER, room_type TEXT, status TEXT, room_number TEXT, room_amount INTEGER, deposit_amount INTEGER, total_amount INTEGER, created_at TEXT, updated_at TEXT)").run();
  await seedSession("sessionA");
  await seedSession("sessionB");

  console.log("== 1. 第一个会话投影");
  await runProjection(["高级大床房"]);
  const reservation = await runner.first("SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, "MT-20260913-7366"]);
  check("每个订单号一条预订，两个订单号两条", (await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ?", [HOTEL])) === 2, String(await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ?", [HOTEL])));
  check("7366 只有一条预订", (await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, "MT-20260913-7366"])) === 1);
  check("预订房间行挂在真实预订上", (await count("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id = ?", [reservation.id])) === 1);
  check("入住记录只有一条", (await count("SELECT COUNT(*) AS c FROM stays")) === 1);
  const stay = await runner.first("SELECT id, reservation_id, status FROM stays", []);
  check("入住记录的 id 用预订 id", stay.id === `stay-${reservation.id}`, `${stay.id} vs stay-${reservation.id}`);
  check("入住记录指向真实预订", stay.reservation_id === reservation.id, String(stay.reservation_id));
  check("房态被标成已入住", (await count("SELECT COUNT(*) AS c FROM rooms WHERE room_number = '1206' AND status = 3")) === 1);
  check("待入住订单不产生入住记录", (await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = (SELECT id FROM reservations WHERE reservation_no = 'WEB-20260915-2178')")) === 0);

  console.log("\n== 2. 第二个会话投影同一个订单号");
  await runProjection(["高级大床房"]);
  check("预订仍然只有一条", (await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ?", [HOTEL])) === 2, String(await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ?", [HOTEL])));
  check("同一个预订没有多出入住记录", (await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = ?", [reservation.id])) === 1, String(await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = ?", [reservation.id])));
  check("同一个预订没有多出房间行", (await count("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id = ?", [reservation.id])) === 1);
  check("没有孤儿入住记录", (await count("SELECT COUNT(*) AS c FROM stays s WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = s.reservation_id)")) === 0);
  check("每个预订最多一条入住记录", (await count("SELECT COUNT(*) AS c FROM (SELECT reservation_id FROM stays WHERE reservation_id IS NOT NULL GROUP BY reservation_id HAVING COUNT(*) > 1)")) === 0);

  console.log("\n== 3. 重复投影是幂等的");
  await runProjection(["高级大床房"]);
  await runProjection(["高级大床房"]);
  check("入住记录总数稳定", (await count("SELECT COUNT(*) AS c FROM stays")) === 1, String(await count("SELECT COUNT(*) AS c FROM stays")));
  check("预订总数稳定", (await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ?", [HOTEL])) === 2);
  check("房间行总数稳定", (await count("SELECT COUNT(*) AS c FROM reservation_rooms")) === 2, String(await count("SELECT COUNT(*) AS c FROM reservation_rooms")));

  console.log("\n== 4. 过期的会话状态不许覆盖预订事实");
  // A session whose demo order still says in_house, for a booking that was re-seeded
  // as "awaiting arrival": the booking wins, no stay may appear.
  await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('stale-order-9', 'sessionC', ?, 'DY-20260914-6395', '抖音团购', '演示住客乙', '6395', '2026-09-18', 2, 1, '高级大床房', 'in_house', '1210', 760, 300, 760, ?, ?)").bind(HOTEL, STAMP, STAMP).run();
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES ('res-DY-20260914-6395', ?, ?, 'DY-20260914-6395', '抖音团购', 'DY-20260914-6395', '演示住客乙', '6395', NULL, 1, '2026-09-18', 2, 1, 760, 300, 'CNY', 1, 'reservation:DY', ?, ?)").bind(TENANT, HOTEL, STAMP, STAMP).run();
  await runProjection(["高级大床房"]);
  check("预订说待入住时，不补写入住记录", (await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = 'res-DY-20260914-6395'")) === 0, String(await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = 'res-DY-20260914-6395'")));
  check("该预订的房间行仍然照常补写", (await count("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id = 'res-DY-20260914-6395'")) === 1);
  // The booking flips to checked in: now the projection may mirror it.
  await db.prepare("UPDATE reservations SET status = 2 WHERE id = 'res-DY-20260914-6395'").run();
  await runProjection(["高级大床房"]);
  const mirrored = await runner.first("SELECT id, status FROM stays WHERE reservation_id = 'res-DY-20260914-6395'", []);
  check("预订转为已入住后才补写，且状态一致", mirrored?.status === 2 && mirrored?.id === "stay-res-DY-20260914-6395", JSON.stringify(mirrored));

  console.log("\n== 5. 终端流程随后接管同一笔订单");
  // What lib/checkin-core.ts writes for a confirmed check-in, using the booking id.
  await db.prepare("UPDATE stays SET status = 2, checked_in_at = ? WHERE reservation_id = ?").bind(STAMP, reservation.id).run();
  await db.prepare("UPDATE reservations SET status = 2 WHERE id = ?").bind(reservation.id).run();
  await db.prepare("INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) SELECT 'stay-' || id, tenant_id, hotel_id, id, guest_name_masked, phone_last4, NULL, 2, ?, NULL, 1, ?, ? FROM reservations WHERE hotel_id = ? AND reservation_no = ? ON CONFLICT(id) DO UPDATE SET status = excluded.status, checked_in_at = excluded.checked_in_at, version = stays.version + 1, updated_at = excluded.updated_at")
    .bind(STAMP, STAMP, STAMP, HOTEL, "MT-20260913-7366").run();
  check("终端入住复用了同一条记录", (await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = ?", [reservation.id])) === 1, String(await count("SELECT COUNT(*) AS c FROM stays WHERE reservation_id = ?", [reservation.id])));
  check("仍然是那条以预订 id 命名的记录", (await count("SELECT COUNT(*) AS c FROM stays WHERE id = ?", [`stay-${reservation.id}`])) === 1);
  check("全库没有孤儿入住记录", (await count("SELECT COUNT(*) AS c FROM stays s WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = s.reservation_id)")) === 0);
  console.log("\n== 6. 演示侧跟真账对齐");
  // A booking that already checked out, while one session's demo copy still says in_house.
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES ('res-9053', ?, ?, 'WALKIN-20260914-9053', '现场办理', 'WALKIN-20260914-9053', '演示住客戊', '9053', NULL, 3, '2026-09-18', 1, 1, 380, 300, 'CNY', 1, 'reservation:9053', ?, ?)").bind(TENANT, HOTEL, STAMP, STAMP).run();
  await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('sessionA-order-3', 'sessionA', ?, 'WALKIN-20260914-9053', '现场办理', '演示住客戊', '9053', '2026-09-18', 1, 1, '高级大床房', 'in_house', '1108', 380, 300, 380, ?, ?)").bind(HOTEL, STAMP, STAMP).run();
  const reconcile = demoOrderReconcileStatement({ hotelId: HOTEL, sessionId: "sessionA", stamp: STAMP });
  await db.prepare(reconcile.sql).bind(...reconcile.params).run();
  const checkedOutCopy = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'sessionA-order-3'", []);
  check("已离店的订单，演示侧被拉回已离店", checkedOutCopy?.status === "checked_out" && checkedOutCopy?.room_number === null, JSON.stringify(checkedOutCopy));
  const inHouseCopy = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'sessionA-order-1'", []);
  check("在住订单的演示侧保持已入住并带上房号", inHouseCopy?.status === "in_house" && inHouseCopy?.room_number === "1206", JSON.stringify(inHouseCopy));
  const midFlight = await runner.first("SELECT status FROM demo_orders WHERE id = 'sessionA-order-2'", []);
  check("正在办理中的订单不会被回退", midFlight?.status === "awaiting_arrival", JSON.stringify(midFlight));
  const otherSessionCopy = await runner.first("SELECT status FROM demo_orders WHERE id = 'sessionB-order-2'", []);
  check("对齐只作用于指定的那个会话", otherSessionCopy?.status === "awaiting_arrival", JSON.stringify(otherSessionCopy));

  // 界面说"在住"、订单却是"待入住"：这是过期的旧副本（订单被清理后又被重新播种）
  await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('sessionA-order-4', 'sessionA', ?, 'DY-20260914-6395', '抖音团购', '演示住客乙', '6395', '2026-09-18', 2, 1, '高级大床房', 'in_house', '1210', 760, 300, 760, ?, ?)").bind(HOTEL, STAMP, STAMP).run();
  // 这一笔的订单已在第 4 节建好（状态被翻成已入住），这里翻回"待入住"模拟过期副本。
  await db.prepare("UPDATE reservations SET status = 1 WHERE id = 'res-DY-20260914-6395'").run();
  // 正在办理中（已确认入住单，订单还没翻到已入住）必须原样保留
  await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('sessionA-order-5', 'sessionA', ?, 'CTRIP-20260914-1188-B', '携程', '演示住客庚', '1188', '2026-09-18', 1, 1, '高级大床房', 'checkin_confirmed', '1210', 380, 300, 380, ?, ?)").bind(HOTEL, STAMP, STAMP).run();
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES ('res-1188b', ?, ?, 'CTRIP-20260914-1188-B', '携程', 'CTRIP-20260914-1188-B', '演示住客庚', '1188', NULL, 1, '2026-09-18', 1, 1, 380, 300, 'CNY', 1, 'reservation:1188b', ?, ?)").bind(TENANT, HOTEL, STAMP, STAMP).run();
  const afterStale = demoOrderReconcileStatement({ hotelId: HOTEL, sessionId: "sessionA", stamp: STAMP });
  await db.prepare(afterStale.sql).bind(...afterStale.params).run();
  const staleCopy = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'sessionA-order-4'", []);
  check("界面说在住但订单待入住，按订单纠正", staleCopy?.status === "awaiting_arrival" && staleCopy?.room_number === null, JSON.stringify(staleCopy));
  const inFlight = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'sessionA-order-5'", []);
  check("办理中的已确认入住单不会被清掉", inFlight?.status === "checkin_confirmed" && inFlight?.room_number === "1210", JSON.stringify(inFlight));

  // 一键对齐：连没人再打开的旧会话一起拉回真账
  await db.prepare("INSERT INTO demo_orders (id, session_id, hotel_id, order_code, source, guest_label, phone_last4, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('sessionB-order-3', 'sessionB', ?, 'WALKIN-20260914-9053', '现场办理', '演示住客戊', '9053', '2026-09-18', 1, 1, '高级大床房', 'in_house', '1108', 380, 300, 380, ?, ?)").bind(HOTEL, STAMP, STAMP).run();
  const all = demoOrderReconcileAllStatement({ hotelId: HOTEL, stamp: STAMP });
  await db.prepare(all.sql).bind(...all.params).run();
  const sweptCopy = await runner.first("SELECT status, room_number FROM demo_orders WHERE id = 'sessionB-order-3'", []);
  check("一键对齐覆盖没人再打开的旧会话", sweptCopy?.status === "checked_out" && sweptCopy?.room_number === null, JSON.stringify(sweptCopy));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nLegacy projection FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nLegacy projection passed on a real D1 binding (miniflare/workerd).");