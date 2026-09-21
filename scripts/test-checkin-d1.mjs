import { readFileSync } from "node:fs";
import {
  confirmFormalCheckin,
  ensureCheckinOrder,
  holdFormalRoom,
  projectCheckinToLegacy,
} from "../lib/checkin-core.ts";
import { ORDER_STATUS, RESERVATION_STATUS, ROOM_STATUS, STAY_STATUS } from "../lib/hotel-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
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
const count = async (sql, params) => Number((await runner.first(sql, params)).c);

const baseOrder = (overrides) => ({
  tenantId: TENANT,
  hotelId: HOTEL,
  orderNo: "O-CHECKIN",
  source: "美团",
  guestLabel: "演示住客甲",
  phoneLast4: "4821",
  stayDate: "2026-09-17",
  nights: 1,
  roomCount: 1,
  roomTypeName: "高级大床房",
  roomAmount: 380,
  depositAmount: 300,
  totalAmount: 680,
  ...overrides,
});

try {
  await db.prepare("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, session_id TEXT, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, phone_masked TEXT, stay_date TEXT, nights INTEGER, room_count INTEGER, room_type TEXT, status TEXT, room_number TEXT, room_amount INTEGER DEFAULT 380, deposit_amount INTEGER DEFAULT 300, total_amount INTEGER DEFAULT 680, created_at TEXT, updated_at TEXT)").run();
  const execSql = async (path) => {
    const statements = readFileSync(path, "utf8")
      .split(/;\s*\n/)
      .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  };
  await execSql("drizzle/0008_hotel_core_domain.sql");
  await execSql("drizzle/0013_orders.sql");
  await db.prepare("INSERT INTO demo_orders (id, session_id, tenant_id, hotel_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('demo-1', 'session-1', ?, ?, 'O-CHECKIN', '美团', '演示住客甲', '4821', '1** **** 4821', '2026-09-17', 1, 1, '高级大床房', 'awaiting_arrival', NULL, 380, 300, 680, 't0', 't0')").bind(TENANT, HOTEL).run();
  await db.prepare("INSERT INTO demo_orders (id, session_id, tenant_id, hotel_id, order_code, source, guest_label, phone_last4, phone_masked, stay_date, nights, room_count, room_type, status, room_number, room_amount, deposit_amount, total_amount, created_at, updated_at) VALUES ('demo-2', 'session-2', ?, ?, 'O-CHECKIN', '美团', '演示住客甲', '4821', '1** **** 4821', '2026-09-17', 1, 1, '高级大床房', 'awaiting_arrival', NULL, 380, 300, 680, 't0', 't0')").bind(TENANT, HOTEL).run();

  console.log("== 1. 正式订单与预订落库");
  await ensureCheckinOrder(runner, baseOrder({}));
  await ensureCheckinOrder(runner, baseOrder({}));
  const order = await runner.first("SELECT status, total_amount, paid_amount FROM orders WHERE hotel_id = ? AND order_no = ?", [HOTEL, "O-CHECKIN"]);
  const reservation = await runner.first("SELECT status FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, "O-CHECKIN"]);
  check("正式订单唯一且已支付", (await count("SELECT COUNT(*) AS c FROM orders WHERE hotel_id = ? AND order_no = ?", [HOTEL, "O-CHECKIN"])) === 1 && Number(order.status) === ORDER_STATUS.PAID);
  check("正式预订唯一且已确认", (await count("SELECT COUNT(*) AS c FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, "O-CHECKIN"])) === 1 && Number(reservation.status) === RESERVATION_STATUS.CONFIRMED);
  check("预订房间关联唯一", (await count("SELECT COUNT(*) AS c FROM reservation_rooms WHERE hotel_id = ?", [HOTEL])) === 1);

  console.log("\n== 2. 正式金额不被演示投影覆盖");
  await runner.run("UPDATE demo_orders SET total_amount = 999 WHERE hotel_id = ? AND id = 'demo-1'", [HOTEL]);
  await ensureCheckinOrder(runner, baseOrder({ totalAmount: 680 }));
  const formalAfterProjection = await runner.first("SELECT total_amount FROM orders WHERE hotel_id = ? AND order_no = ?", [HOTEL, "O-CHECKIN"]);
  check("重复投影不覆盖正式订单金额", Number(formalAfterProjection.total_amount) === 680, String(formalAfterProjection.total_amount));

  console.log("\n== 3. 锁房写入正式房态");
  const hold = await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-CHECKIN", roomNumber: "1306", roomTypeName: "高级大床房", requestId: "req-hold-1" });
  await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-CHECKIN", roomNumber: "1306", roomTypeName: "高级大床房", requestId: "req-hold-2" });
  const room = await runner.first("SELECT status, version FROM rooms WHERE hotel_id = ? AND room_number = '1306'", [HOTEL]);
  check("房间状态为已锁房", Number(room.status) === ROOM_STATUS.HELD, `status=${room.status}`);
  check("锁房仅写一条房态流水", (await count("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND request_id LIKE 'req-hold-%'", [HOTEL])) === 1);
  check("预订房间关联已指向该房间", (await runner.first("SELECT rr.room_id AS room_id FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id WHERE r.hotel_id = ? AND r.reservation_no = 'O-CHECKIN'", [HOTEL])).room_id === hold.roomId);

  console.log("\n== 4. 房间被占用时阻止锁房");
  await ensureCheckinOrder(runner, baseOrder({ orderNo: "O-OTHER", phoneLast4: "2288" }));
  let conflict = "";
  try { await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-OTHER", roomNumber: "1306", roomTypeName: "高级大床房", requestId: "req-hold-other" }); }
  catch (error) { conflict = error.message; }
  check("他人房间锁房被拒绝", conflict === "room_conflict", conflict);

  console.log("\n== 5. 入住确认写正式预订、入住与房态");
  await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-CHECKIN", requestId: "req-checkin-1" });
  await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-CHECKIN", requestId: "req-checkin-2" });
  const checkedIn = await runner.first("SELECT status FROM reservations WHERE hotel_id = ? AND reservation_no = 'O-CHECKIN'", [HOTEL]);
  const stay = await runner.first("SELECT status FROM stays WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = 'O-CHECKIN')", [HOTEL, HOTEL]);
  const occupied = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = '1306'", [HOTEL]);
  check("预订状态变为已入住", Number(checkedIn.status) === RESERVATION_STATUS.CHECKED_IN, `status=${checkedIn.status}`);
  check("入住记录唯一且在住", (await count("SELECT COUNT(*) AS c FROM stays WHERE hotel_id = ?", [HOTEL])) === 1 && Number(stay.status) === STAY_STATUS.IN_HOUSE);
  check("房间状态变为已入住", Number(occupied.status) === ROOM_STATUS.OCCUPIED, `status=${occupied.status}`);
  check("入住确认仅写一条预订流水", (await count("SELECT COUNT(*) AS c FROM reservation_status_logs WHERE hotel_id = ? AND request_id LIKE 'req-checkin-%'", [HOTEL])) === 1);

  console.log("\n== 6. 已取消预订不能确认入住");
  await ensureCheckinOrder(runner, baseOrder({ orderNo: "O-CANCELLED", phoneLast4: "4402", orderStatus: ORDER_STATUS.CANCELLED, reservationStatus: RESERVATION_STATUS.CANCELLED }));
  let statusError = "";
  try { await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: "O-CANCELLED", requestId: "req-cancelled" }); }
  catch (error) { statusError = error.message; }
  check("取消订单无法确认入住", statusError === "reservation_status_conflict", statusError);
  const cancelledOrder = await runner.first("SELECT status FROM orders WHERE hotel_id = ? AND order_no = 'O-CANCELLED'", [HOTEL]);
  const cancelledReservation = await runner.first("SELECT status FROM reservations WHERE hotel_id = ? AND reservation_no = 'O-CANCELLED'", [HOTEL]);
  check("取消状态写入正式订单与预订", Number(cancelledOrder.status) === ORDER_STATUS.CANCELLED && Number(cancelledReservation.status) === RESERVATION_STATUS.CANCELLED);

  console.log("\n== 7. 演示表只接收投影");
  await projectCheckinToLegacy(runner, { hotelId: HOTEL, sessionId: "session-1", orderNo: "O-CHECKIN", status: "in_house", roomNumber: "1306" });
  const demo = await runner.first("SELECT status, room_number FROM demo_orders WHERE hotel_id = ? AND session_id = 'session-1'", [HOTEL]);
  check("演示表状态与房间号为投影值", demo.status === "in_house" && demo.room_number === "1306", JSON.stringify(demo));
  const otherSession = await runner.first("SELECT status, room_number FROM demo_orders WHERE hotel_id = ? AND session_id = 'session-2'", [HOTEL]);
  check("另一个会话的同一笔订单没有被改写", otherSession.status === "awaiting_arrival" && otherSession.room_number === null, JSON.stringify(otherSession));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nFormal check-in integration FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nFormal check-in integration passed on a real D1 binding (miniflare/workerd).");
