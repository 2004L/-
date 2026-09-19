import { readFileSync } from "node:fs";
import { CHECKIN_ERRORS, confirmFormalCheckin, ensureCheckinOrder, holdFormalRoom } from "../lib/checkin-core.ts";
import { checkoutStayWith, findInHouseStaysWith, markRoomCleanWith } from "../lib/checkout-core.ts";
import { FOLIO_STATUS, RESERVATION_STATUS, ROOM_STATUS, STAY_STATUS, formalRoomId, formalRoomTypeId } from "../lib/hotel-core.ts";
import { FOLIO_ERRORS, ensureFolioForStayWith, quoteCheckoutWith, settleFolioWith, verifyFolioLedger } from "../lib/settlement-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * The seam the terminal depends on: a guest who checks in at the kiosk must be
 * findable and settleable at the same kiosk minutes later. The check-in half and
 * the checkout half are covered separately elsewhere; what is proven here is
 * that the two halves hand the same stay to each other instead of each holding
 * half of a loop.
 */

const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
const ROOM_NUMBER = "1306";
const PHONE_LAST4 = "4821";
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
const lister = {
  ...runner,
  all: async (sql, params) => {
    const result = await db.prepare(sql).bind(...params).all();
    return result.results ?? [];
  },
};
const count = async (sql, params) => Number((await runner.first(sql, params)).c);
const execSql = async (path) => {
  const statements = readFileSync(path, "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
};

const ORDER = {
  tenantId: TENANT,
  hotelId: HOTEL,
  orderNo: "O-LOOP",
  source: "美团",
  guestLabel: "演示住客甲",
  phoneLast4: PHONE_LAST4,
  stayDate: "2026-09-19",
  nights: 2,
  roomCount: 1,
  roomTypeName: "高级大床房",
  roomAmount: 760,
  depositAmount: 300,
  totalAmount: 1060,
};

try {
  await execSql("drizzle/0008_hotel_core_domain.sql");
  await db.prepare("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, phone_masked TEXT, stay_date TEXT, nights INTEGER, room_count INTEGER, room_type TEXT, status TEXT, room_number TEXT, room_amount INTEGER DEFAULT 380, deposit_amount INTEGER DEFAULT 300, total_amount INTEGER DEFAULT 680, created_at TEXT, updated_at TEXT)").run();
  await execSql("drizzle/0013_orders.sql");

  console.log("== 1. 终端入住：正式订单、预订、入住记录与房态");
  await ensureCheckinOrder(runner, ORDER);
  await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: ORDER.orderNo, roomNumber: ROOM_NUMBER, roomTypeName: ORDER.roomTypeName, requestId: "req-loop-hold" });
  await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: ORDER.orderNo, requestId: "req-loop-checkin" });
  const stayRow = await runner.first("SELECT s.id, s.status, s.reservation_id, rr.room_id FROM stays s JOIN reservation_rooms rr ON rr.reservation_id = s.reservation_id WHERE s.hotel_id = ? AND s.reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?)", [HOTEL, HOTEL, ORDER.orderNo]);
  const roomAfterCheckin = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = ?", [HOTEL, ROOM_NUMBER]);
  check("入住产生在住记录", Number(stayRow?.status) === STAY_STATUS.IN_HOUSE, JSON.stringify(stayRow));
  check("入住记录挂在预订房间上", Boolean(stayRow?.room_id), JSON.stringify(stayRow));
  check("房间被占用", Number(roomAfterCheckin?.status) === ROOM_STATUS.OCCUPIED, String(roomAfterCheckin?.status));
  const stayId = stayRow.id;

  console.log("\n== 2. 终端退房第一步：用房间号 + 手机号后四位找到这位客人");
  const candidates = await findInHouseStaysWith(lister, { hotelId: HOTEL, phoneLast4: PHONE_LAST4, roomNumber: ROOM_NUMBER });
  check("正好匹配一笔在住记录", candidates.length === 1, `count=${candidates.length}`);
  check("匹配到的就是刚入住的那笔", candidates[0]?.stayId === stayId, `${candidates[0]?.stayId} vs ${stayId}`);
  check("终端只能看到脱敏姓名与房号", candidates[0]?.guestNameMasked === "演示住客甲" && candidates[0]?.roomNumber === ROOM_NUMBER, JSON.stringify(candidates[0]));
  const wrongRoom = await findInHouseStaysWith(lister, { hotelId: HOTEL, phoneLast4: PHONE_LAST4, roomNumber: "9999" });
  check("换个房间号就查不到（两要素缺一不可）", wrongRoom.length === 0, `count=${wrongRoom.length}`);

  console.log("\n== 3. 终端退房第二步：开账、报价、结算、放房");
  const ensured = await ensureFolioForStayWith(runner, { hotelId: HOTEL, stayId, requestId: "req-loop-precheckout" });
  check("开账时把预订押金记成真分录", ensured.opened && ensured.depositAmount === ORDER.depositAmount, JSON.stringify(ensured.depositAmount));
  const quote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId });
  check("房费按每晚房价 × 晚数计算", quote.roomTotal === 760 && quote.nights === 2, JSON.stringify({ roomTotal: quote.roomTotal, nights: quote.nights }));
  check("应补收金额 = 房费 - 押金", quote.due === 460, String(quote.due));

  const checkout = await checkoutStayWith(runner, { hotelId: HOTEL, stayId, requestId: "req-loop-checkout" });
  const settlement = await settleFolioWith(runner, { hotelId: HOTEL, stayId, requestId: "req-loop-settle" });
  const afterCheckout = await runner.first("SELECT s.status AS stay_status, r.status AS reservation_status FROM stays s JOIN reservations r ON r.id = s.reservation_id WHERE s.hotel_id = ? AND s.id = ?", [HOTEL, stayId]);
  const roomAfterCheckout = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = ?", [HOTEL, ROOM_NUMBER]);
  const folioAfter = await runner.first("SELECT status, balance FROM folios WHERE hotel_id = ? AND stay_id = ?", [HOTEL, stayId]);
  check("入住记录结束", Number(afterCheckout.stay_status) === STAY_STATUS.CHECKED_OUT, String(afterCheckout.stay_status));
  check("预订结束", Number(afterCheckout.reservation_status) === RESERVATION_STATUS.CHECKED_OUT, String(afterCheckout.reservation_status));
  check("房间释放为待清洁而不是直接可售", Number(roomAfterCheckout.status) === ROOM_STATUS.VACANT_DIRTY, String(roomAfterCheckout.status));
  check("退房带回了房间号", checkout.roomId === stayRow.room_id, `${checkout.roomId} vs ${stayRow.room_id}`);
  check("账本关闭", folioAfter.status === FOLIO_STATUS.CLOSED, String(folioAfter.status));
  check("结清后余额归零", Number(folioAfter.balance) === 0, String(folioAfter.balance));
  check("结算金额与服务端报价一致", settlement.settled === quote.due, `${settlement.settled} vs ${quote.due}`);

  console.log("\n== 4. 退房后客人查不到了，重复点退房也不会重复扣账");
  const afterCandidates = await findInHouseStaysWith(lister, { hotelId: HOTEL, phoneLast4: PHONE_LAST4, roomNumber: ROOM_NUMBER });
  check("退房后不再出现在在住列表", afterCandidates.length === 0, `count=${afterCandidates.length}`);
  const entriesAfterFirst = await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, settlement.folio.id]);
  await checkoutStayWith(runner, { hotelId: HOTEL, stayId, requestId: "req-loop-checkout-again" });
  const replay = await settleFolioWith(runner, { hotelId: HOTEL, stayId, requestId: "req-loop-settle-again" });
  const entriesAfterReplay = await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, settlement.folio.id]);
  check("重复退房幂等返回", replay.idempotent === true, String(replay.idempotent));
  check("重复退房不新增分录", entriesAfterFirst === entriesAfterReplay, `${entriesAfterFirst} -> ${entriesAfterReplay}`);
  check("重复退房后仍然平账", Number((await runner.first("SELECT balance FROM folios WHERE hotel_id = ? AND id = ?", [HOTEL, settlement.folio.id])).balance) === 0);

  console.log("\n== 5. 客房打扫后房间重新可售，账实始终相符");
  const cleaned = await markRoomCleanWith(runner, { hotelId: HOTEL, roomNumber: ROOM_NUMBER, requestId: "req-loop-clean" });
  const roomAfterClean = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = ?", [HOTEL, ROOM_NUMBER]);
  check("打扫后房间回到可售", Number(roomAfterClean.status) === ROOM_STATUS.VACANT_CLEAN && cleaned.roomStatus === ROOM_STATUS.VACANT_CLEAN, String(roomAfterClean.status));
  const ledgerCheck = await verifyFolioLedger(runner, HOTEL, settlement.folio.id);
  check("账本余额等于分录合计", ledgerCheck.matches === true || ledgerCheck.balanced === true, JSON.stringify(ledgerCheck));
  check("全套房态流水齐备（锁房、占用、放房、打扫）", (await count("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND room_id = ?", [HOTEL, stayRow.room_id])) === 4, "expected 4 logs");
  console.log("\n== 6. 终端不报房号时，服务端自己挑一间真正可售的房");
  const autoOrder = { ...ORDER, orderNo: "O-AUTO", phoneLast4: "6033", guestLabel: "演示住客乙" };
  await ensureCheckinOrder(runner, autoOrder);
  await ensureCheckinOrder(runner, autoOrder);
  const autoRows = await count("SELECT COUNT(*) AS c FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?)", [HOTEL, HOTEL, autoOrder.orderNo]);
  check("一个预订只写一行房间行", autoRows === 1, `rows=${autoRows}`);
  const autoHold = await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: autoOrder.orderNo, roomTypeName: autoOrder.roomTypeName, requestId: "req-loop-auto-hold" });
  check("服务端挑出了一间可售房", autoHold.roomNumber === ROOM_NUMBER && autoHold.held === true, JSON.stringify(autoHold));
  const autoLinked = await runner.first("SELECT rr.room_id AS room_id FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id WHERE r.hotel_id = ? AND r.reservation_no = ?", [HOTEL, autoOrder.orderNo]);
  check("挑中的房间写回预订房间行", autoLinked?.room_id === autoHold.roomId, `${autoLinked?.room_id} vs ${autoHold.roomId}`);
  await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: autoOrder.orderNo, requestId: "req-loop-auto-checkin" });
  const autoRoom = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = ?", [HOTEL, autoHold.roomNumber]);
  check("自动挑房后房间被占用", Number(autoRoom.status) === ROOM_STATUS.OCCUPIED, String(autoRoom.status));

  console.log("\n== 7. 只剩脏房时拒绝入住，绝不把脏房卖出去");
  const dirtyOrder = { ...ORDER, orderNo: "O-DIRTY", phoneLast4: "7755", guestLabel: "演示住客丙", roomTypeName: "豪华双床房" };
  await ensureCheckinOrder(runner, dirtyOrder);
  const dirtyStamp = new Date().toISOString();
  await runner.run(
    "INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, '1401', 14, ?, 1, NULL, ?, ?)",
    [formalRoomId(HOTEL, "1401"), TENANT, HOTEL, formalRoomTypeId(HOTEL, "DLX-TWIN"), ROOM_STATUS.VACANT_DIRTY, dirtyStamp, dirtyStamp],
  );
  let dirtyError = "";
  try { await holdFormalRoom(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: dirtyOrder.orderNo, roomTypeName: dirtyOrder.roomTypeName, requestId: "req-loop-dirty-hold" }); }
  catch (error) { dirtyError = error.message; }
  const dirtyRoom = await runner.first("SELECT status FROM rooms WHERE hotel_id = ? AND room_number = '1401'", [HOTEL]);
  check("脏房不算可售，挑不到房就拒绝", dirtyError === CHECKIN_ERRORS.NO_SELLABLE_ROOM, dirtyError);
  check("被拒绝时脏房状态没有被改动", Number(dirtyRoom.status) === ROOM_STATUS.VACANT_DIRTY, String(dirtyRoom?.status));

  console.log("\n== 8. 没锁房就确认入住会被拒绝，且不留下幽灵在住记录");
  const ghostOrder = { ...ORDER, orderNo: "O-GHOST", phoneLast4: "9911", guestLabel: "演示住客丁" };
  await ensureCheckinOrder(runner, ghostOrder);
  let ghostError = "";
  try { await confirmFormalCheckin(runner, { tenantId: TENANT, hotelId: HOTEL, orderNo: ghostOrder.orderNo, requestId: "req-loop-ghost" }); }
  catch (error) { ghostError = error.message; }
  const ghostReservation = await runner.first("SELECT status FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, ghostOrder.orderNo]);
  const ghostStays = await count("SELECT COUNT(*) AS c FROM stays WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?)", [HOTEL, HOTEL, ghostOrder.orderNo]);
  check("没锁房不能确认入住", ghostError === CHECKIN_ERRORS.ROOM_NOT_HELD, ghostError);
  check("失败时不推进预订状态", Number(ghostReservation.status) === RESERVATION_STATUS.CONFIRMED, String(ghostReservation?.status));
  check("失败时不留下幽灵在住记录", ghostStays === 0, `stays=${ghostStays}`);

  console.log("\n== 9. 重复的房间行会拦住报价与结算，不许多收客人钱");
  const autoStayRow = await runner.first("SELECT id FROM stays WHERE hotel_id = ? AND reservation_id = (SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?)", [HOTEL, HOTEL, autoOrder.orderNo]);
  const autoStayId = autoStayRow.id;
  await ensureFolioForStayWith(runner, { hotelId: HOTEL, stayId: autoStayId, requestId: "req-loop-auto-precheckout" });
  const cleanQuote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: autoStayId });
  check("单行房价时报价正常", cleanQuote.rateRowMismatch === false && cleanQuote.rateRows === 1 && cleanQuote.roomTotal === 760, JSON.stringify({ rows: cleanQuote.rateRows, roomTotal: cleanQuote.roomTotal }));
  const autoReservation = await runner.first("SELECT id FROM reservations WHERE hotel_id = ? AND reservation_no = ?", [HOTEL, autoOrder.orderNo]);
  const duplicateRoomId = `res-room-${autoOrder.orderNo}-dup`;
  await runner.run(
    "INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) SELECT ?, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = ? LIMIT 1",
    [duplicateRoomId, HOTEL, autoReservation.id],
  );
  const dupQuote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: autoStayId });
  check("重复房间行被标记出来", dupQuote.rateRowMismatch === true && dupQuote.rateRows === 2, JSON.stringify({ rows: dupQuote.rateRows, mismatch: dupQuote.rateRowMismatch }));
  check("重复房间行确实会把房费算成双倍", dupQuote.roomTotal === 1520, String(dupQuote.roomTotal));
  let dupError = "";
  try { await settleFolioWith(runner, { hotelId: HOTEL, stayId: autoStayId, requestId: "req-loop-dup-settle" }); }
  catch (error) { dupError = error.message; }
  check("异常报价下拒绝结算", dupError === FOLIO_ERRORS.RATE_ROWS_MISMATCH, dupError);
  check("拒绝结算时没有往这张账写房费", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, cleanQuote.folioId, "room_charge"])) === 0, "room_charge rows should be 0");
  await runner.run("DELETE FROM reservation_rooms WHERE hotel_id = ? AND id = ?", [HOTEL, duplicateRoomId]);
  const restoredQuote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: autoStayId });
  check("删掉重复行后恢复可结算", restoredQuote.rateRowMismatch === false, JSON.stringify({ rows: restoredQuote.rateRows }));
  await checkoutStayWith(runner, { hotelId: HOTEL, stayId: autoStayId, requestId: "req-loop-auto-checkout" });
  const autoSettlement = await settleFolioWith(runner, { hotelId: HOTEL, stayId: autoStayId, requestId: "req-loop-auto-settle" });
  const autoFolio = await runner.first("SELECT status, balance FROM folios WHERE hotel_id = ? AND id = ?", [HOTEL, autoSettlement.folio.id]);
  check("自动挑房的客人也能正常结清", autoFolio.status === FOLIO_STATUS.CLOSED && Number(autoFolio.balance) === 0, JSON.stringify(autoFolio));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nCheck-in to check-out loop FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nCheck-in to check-out loop passed on a real D1 binding (miniflare/workerd).");
