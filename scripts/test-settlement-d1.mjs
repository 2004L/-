import { readFileSync } from "node:fs";
import { checkoutStayWith, markRoomCleanWith } from "../lib/checkout-core.ts";
import { ROOM_STATUS, RESERVATION_STATUS, STAY_STATUS, FOLIO_STATUS, LEDGER_ENTRY_TYPES } from "../lib/hotel-core.ts";
import {
  FOLIO_ERRORS,
  openFolioWith,
  postChargeWith,
  quoteCheckoutWith,
  settleFolioWith,
  verifyFolioLedger,
  verifyFolioMatchesStay,
} from "../lib/settlement-core.ts";
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
const one = (sql, params) => runner.first(sql, params);

const execSql = async (path) => {
  const statements = readFileSync(path, "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
};

const STAMP = "2026-09-19T00:00:00.000Z";

async function seedStay({ suffix, rate, reservationAmount, roomNumber }) {
  const reservationId = `res-${suffix}`;
  const stayId = `stay-${suffix}`;
  const roomId = `room-${HOTEL}-${roomNumber}`;
  await db.prepare("INSERT INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES (?, ?, ?, 'DLX-KING', '高级大床房', 'GZ-HAOS-001-DLX-KING', 2, 1, ?, ?) ON CONFLICT(id) DO NOTHING").bind(`rt-${HOTEL}-DLX-KING`, TENANT, HOTEL, STAMP, STAMP).run();
  await db.prepare("INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 12, ?, 1, NULL, ?, ?)").bind(roomId, TENANT, HOTEL, `rt-${HOTEL}-DLX-KING`, roomNumber, ROOM_STATUS.OCCUPIED, STAMP, STAMP).run();
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, '美团', ?, '演示住客甲', '4821', ?, '2026-09-19', 1, 1, ?, 300, 'CNY', 1, ?, ?, ?)").bind(reservationId, TENANT, HOTEL, `NO-${suffix}`, `NO-${suffix}`, RESERVATION_STATUS.CHECKED_IN, reservationAmount, `key-${suffix}`, STAMP, STAMP).run();
  await db.prepare("INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(`rr-${suffix}`, TENANT, HOTEL, reservationId, `rt-${HOTEL}-DLX-KING`, roomId, rate, STAMP, STAMP).run();
  await db.prepare("INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, '演示住客甲', '4821', NULL, ?, ?, NULL, 1, ?, ?)").bind(stayId, TENANT, HOTEL, reservationId, STAY_STATUS.IN_HOUSE, STAMP, STAMP, STAMP).run();
  return { reservationId, stayId, roomId, roomNumber };
}

try {
  await execSql("drizzle/0008_hotel_core_domain.sql");
  await execSql("drizzle/0021_payments_refunds.sql");
  const paid = await seedStay({ suffix: "paid", rate: 380, reservationAmount: 680, roomNumber: "1206" });
  const refund = await seedStay({ suffix: "refund", rate: 190, reservationAmount: 190, roomNumber: "1208" });

  console.log("== 1. 开账与押金分录");
  const opened = await openFolioWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, depositAmount: 300, stayStatus: STAY_STATUS.IN_HOUSE, requestId: "req-open-1" });
  check("开账落库且状态为 open", opened.folio.status === FOLIO_STATUS.OPEN, opened.folio.status);
  check("押金记为负数（酒店欠客人）", Number(opened.folio.balance) === -300, String(opened.folio.balance));
  check("押金分录唯一", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, opened.folio.id])) === 1);
  check("押金支付记录为已收", (await one("SELECT status, payment_type FROM payments WHERE hotel_id = ? AND stay_id = ?", [HOTEL, paid.stayId]))?.status === "captured" && (await one("SELECT status, payment_type FROM payments WHERE hotel_id = ? AND stay_id = ?", [HOTEL, paid.stayId]))?.payment_type === "deposit");
  await openFolioWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, depositAmount: 300, stayStatus: STAY_STATUS.IN_HOUSE, requestId: "req-open-1" });
  check("重复开账幂等：仍只有一条 folio", (await count("SELECT COUNT(*) AS c FROM folios WHERE hotel_id = ? AND stay_id = ?", [HOTEL, paid.stayId])) === 1);
  check("重复开账幂等：押金不重复记账", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, opened.folio.id])) === 1);

  console.log("\n== 2. 在住消费挂账");
  await postChargeWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, amount: 50, idempotencyKey: "charge-minibar-1", referenceType: "minibar" });
  await postChargeWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, amount: 50, idempotencyKey: "charge-minibar-1", referenceType: "minibar" });
  const afterCharge = await one("SELECT balance FROM folios WHERE hotel_id = ? AND id = ?", [HOTEL, opened.folio.id]);
  check("消费挂账后余额为 -250", Number(afterCharge.balance) === -250, String(afterCharge.balance));
  check("消费分录不因重放重复记账", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, opened.folio.id])) === 2);
  let reused = "";
  try { await postChargeWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, amount: 80, idempotencyKey: "charge-minibar-1", referenceType: "minibar" }); }
  catch (error) { reused = error.message; }
  check("同一幂等键换金额被拒绝", reused === FOLIO_ERRORS.IDEMPOTENCY_REUSED, reused);
  let badAmount = "";
  try { await postChargeWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, amount: 1.5, idempotencyKey: "charge-bad" }); }
  catch (error) { badAmount = error.message; }
  check("非整数金额被拒绝", badAmount === FOLIO_ERRORS.INVALID_AMOUNT, badAmount);

  console.log("\n== 3. 退房报价（房费来自 nightly_rate，不用占位金额）");
  const quote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: paid.stayId });
  check("房费 = 房价 380 × 1 晚", quote.roomTotal === 380, String(quote.roomTotal));
  check("应付 = 房费 + 消费 = 430", quote.payable === 430, String(quote.payable));
  check("已付 = 押金 300", quote.paid === 300, String(quote.paid));
  check("应收差额 130", quote.due === 130, String(quote.due));
  check("房价取自正式表而非占位金额", quote.missingRate === false, String(quote.missingRate));
  check("占位金额 680 与真实应付 430 被标记不一致", quote.amountMismatch === true, String(quote.amountMismatch));
  check("在住 + open 账本的组合是合规的", quote.stayFolioCompliant === true, String(quote.stayFolioCompliant));

  console.log("\n== 4. 住宿结束 ≠ 结算完成");
  const stayed = await checkoutStayWith(runner, { hotelId: HOTEL, stayId: paid.stayId, requestId: "req-out-1" });
  const stayRow = await one("SELECT status FROM stays WHERE hotel_id = ? AND id = ?", [HOTEL, paid.stayId]);
  const resRow = await one("SELECT status FROM reservations WHERE hotel_id = ? AND id = ?", [HOTEL, paid.reservationId]);
  const roomRow = await one("SELECT status FROM rooms WHERE hotel_id = ? AND id = ?", [HOTEL, paid.roomId]);
  check("入住单已结束", Number(stayRow.status) === STAY_STATUS.CHECKED_OUT, String(stayRow.status));
  check("预订已结束", Number(resRow.status) === RESERVATION_STATUS.CHECKED_OUT, String(resRow.status));
  check("房间转为脏房（不是直接可售）", Number(roomRow.status) === ROOM_STATUS.VACANT_DIRTY, String(roomRow.status));
  check("房态流水已记录", (await count("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND request_id = ?", [HOTEL, "req-out-1"])) === 1);
  check("预订流水已记录（该表首个写入方）", (await count("SELECT COUNT(*) AS c FROM reservation_status_logs WHERE hotel_id = ? AND request_id = ?", [HOTEL, "req-out-1"])) === 1);
  check("离店后账本仍开着，被判定为待结算", stayed.roomStatus === ROOM_STATUS.VACANT_DIRTY);
  const afterCheckout = await verifyFolioMatchesStay(runner, { hotelId: HOTEL, stayId: paid.stayId });
  check("离店但账未结，校验报出 folio_status_not_allowed_for_stay:open", afterCheckout.issues.includes(`folio_status_not_allowed_for_stay:${FOLIO_STATUS.OPEN}`), JSON.stringify(afterCheckout.issues));
  check("离店但账未结，整体判定为不合规", afterCheckout.ok === false);

  console.log("\n== 5. 结算与关账");
  const settled = await settleFolioWith(runner, { hotelId: HOTEL, stayId: paid.stayId, requestId: "req-settle-1" });
  check("补收 130 已记账", settled.settled === 130, String(settled.settled));
  check("结算后余额归零", Number(settled.folio.balance) === 0, String(settled.folio.balance));
  check("账本状态为 closed", settled.folio.status === FOLIO_STATUS.CLOSED, settled.folio.status);
  check("房费分录已入账", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, opened.folio.id, LEDGER_ENTRY_TYPES.ROOM_CHARGE])) === 1);
  check("补收分录已入账", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, opened.folio.id, LEDGER_ENTRY_TYPES.SETTLEMENT])) === 1);
  const integrity = await verifyFolioLedger(runner, HOTEL, opened.folio.id);
  check("账实相符：balance === SUM(entries)", integrity.balanced === true, JSON.stringify(integrity));
  const afterSettle = await verifyFolioMatchesStay(runner, { hotelId: HOTEL, stayId: paid.stayId });
  check("结账后无阻断问题", afterSettle.ok === true && afterSettle.issues.length === 0, JSON.stringify(afterSettle.issues));
  check("占位金额偏差降级为告警", afterSettle.warnings.includes("legacy_amount_mismatch"), JSON.stringify(afterSettle.warnings));

  console.log("\n== 6. 重复结算与关账保护");
  const replay = await settleFolioWith(runner, { hotelId: HOTEL, stayId: paid.stayId, requestId: "req-settle-1" });
  check("重复结算返回幂等结果", replay.idempotent === true);
  check("重复结算不新增分录", (await count("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, opened.folio.id])) === 4);
  let closedCharge = "";
  try { await postChargeWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: paid.stayId, amount: 10, idempotencyKey: "charge-after-close" }); }
  catch (error) { closedCharge = error.message; }
  check("已关账的账本拒绝新消费", closedCharge === FOLIO_ERRORS.CLOSED, closedCharge);

  console.log("\n== 7. 押金退还（反向分录）");
  await openFolioWith(runner, { tenantId: TENANT, hotelId: HOTEL, stayId: refund.stayId, depositAmount: 300, stayStatus: STAY_STATUS.IN_HOUSE, requestId: "req-open-2" });
  const refundQuote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: refund.stayId });
  check("应退 110（房费 190 低于押金 300）", refundQuote.due === -110, String(refundQuote.due));
  check("金额一致时不报占位偏差", refundQuote.amountMismatch === false, String(refundQuote.amountMismatch));
  await checkoutStayWith(runner, { hotelId: HOTEL, stayId: refund.stayId, requestId: "req-out-2" });
  const refunded = await settleFolioWith(runner, { hotelId: HOTEL, stayId: refund.stayId, requestId: "req-settle-2" });
  check("退款按反向分录记账", refunded.settled === -110, String(refunded.settled));
  check("退款回执状态为已退", refunded.refund?.status === "refunded", String(refunded.refund?.status));
  check("退款保存支付渠道回执", Boolean(refunded.refund?.provider_ref), String(refunded.refund?.provider_ref));
  check("退款后余额归零", Number(refunded.folio.balance) === 0, String(refunded.folio.balance));
  check("退款分录为正数（抵扣客人欠款）", (await one("SELECT amount FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, refunded.folio.id, LEDGER_ENTRY_TYPES.REFUND])).amount === 110);
  check("退款后账实相符", (await verifyFolioLedger(runner, HOTEL, refunded.folio.id)).balanced === true);

  console.log("\n== 8. 清洁闭环：脏房回到可售");
  const cleaned = await markRoomCleanWith(runner, { hotelId: HOTEL, roomNumber: paid.roomNumber, requestId: "req-clean-1" });
  check("清洁后房态为可售", cleaned.roomStatus === ROOM_STATUS.VACANT_CLEAN, String(cleaned.roomStatus));
  check("清洁流水已记录", (await count("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND request_id = ?", [HOTEL, "req-clean-1"])) === 1);
  const cleanedAgain = await markRoomCleanWith(runner, { hotelId: HOTEL, roomNumber: paid.roomNumber, requestId: "req-clean-2" });
  check("重复清洁幂等且不重复写流水", cleanedAgain.idempotent === true && (await count("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND request_id = ?", [HOTEL, "req-clean-2"])) === 0);

  console.log("\n== 9. 恒等式交叉校验");
  const finalQuote = await quoteCheckoutWith(runner, { hotelId: HOTEL, stayId: paid.stayId });
  const identity = finalQuote.due - finalQuote.roomTotal + finalQuote.postedRoomCharge;
  check("balance === due - roomTotal + postedRoomCharge", finalQuote.folioBalance === identity, `${finalQuote.folioBalance} vs ${identity}`);
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nSettlement integration FAILED on a real D1 binding: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nSettlement integration passed on a real D1 binding (miniflare/workerd).");
