import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOLIOS_DDL,
  openFolioWith,
  postChargeWith,
  quoteCheckoutWith,
  settleFolioWith,
  verifyFolioLedger,
} from "../lib/settlement-core.ts";
import { checkoutStayWith } from "../lib/checkout-core.ts";
import { FOLIO_STATUS, LEDGER_ENTRY_TYPES, ROOM_STATUS, STAY_STATUS } from "../lib/hotel-core.ts";

/**
 * Two connections onto one SQLite file: the same engine family as D1. This is
 * where "retry safety" is actually proven - a single connection can never show
 * whether an idempotency key or a compare-and-set really holds.
 */
const RETRY_ENV = "SETTLEMENT_SQLITE_RETRY";
let sqlite;
try {
  sqlite = await import("node:sqlite");
} catch {
  if (process.env[RETRY_ENV]) {
    console.error("node:sqlite 不可用，即使带 --experimental-sqlite");
    process.exit(1);
  }
  const { spawnSync } = await import("node:child_process");
  const retry = spawnSync(process.execPath, ["--experimental-sqlite", "--experimental-strip-types", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, [RETRY_ENV]: "1" } });
  process.exit(retry.status ?? 1);
}
const { DatabaseSync } = sqlite;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
const STAMP = "2026-09-19T00:00:00.000Z";
const dir = mkdtempSync(join(tmpdir(), "settlement-it-"));
const file = join(dir, "settlement.sqlite");

const migration = readFileSync("drizzle/0008_hotel_core_domain.sql", "utf8")
  .split(/;\s*\n/)
  .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const setup = new DatabaseSync(file);
for (const statement of [...FOLIOS_DDL, ...migration]) setup.exec(statement);
setup.exec(`INSERT INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES ('rt-${HOTEL}-DLX-KING', '${TENANT}', '${HOTEL}', 'DLX-KING', '高级大床房', NULL, 2, 1, '${STAMP}', '${STAMP}')`);
setup.exec(`INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, created_at, updated_at) VALUES ('room-${HOTEL}-1306', '${TENANT}', '${HOTEL}', 'rt-${HOTEL}-DLX-KING', '1306', 13, ${ROOM_STATUS.OCCUPIED}, 1, '${STAMP}', '${STAMP}')`);
setup.exec(`INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES ('res-c1', '${TENANT}', '${HOTEL}', 'NO-C1', '美团', 'NO-C1', '演示住客甲', '4821', 2, '2026-09-19', 1, 1, 680, 300, 'CNY', 1, 'key-c1', '${STAMP}', '${STAMP}')`);
setup.exec(`INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) VALUES ('rr-c1', '${TENANT}', '${HOTEL}', 'res-c1', 'rt-${HOTEL}-DLX-KING', 'room-${HOTEL}-1306', 380, 1, '${STAMP}', '${STAMP}')`);
setup.exec(`INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) VALUES ('stay-c1', '${TENANT}', '${HOTEL}', 'res-c1', '演示住客甲', '4821', NULL, ${STAY_STATUS.IN_HOUSE}, '${STAMP}', NULL, 1, '${STAMP}', '${STAMP}')`);
setup.close();

const dbA = new DatabaseSync(file);
const dbB = new DatabaseSync(file);
const makeRunner = (db) => ({
  run: async (sql, params) => ({ changes: Number(db.prepare(sql).run(...params).changes ?? 0) }),
  first: async (sql, params) => db.prepare(sql).get(...params) ?? null,
});
const runnerA = makeRunner(dbA);
const runnerB = makeRunner(dbB);
const scalar = (sql, params) => Number(dbA.prepare(sql).get(...params).c);

try {
  console.log("== 1. 并发开账：只允许一条账本与一笔押金");
  const opens = await Promise.allSettled([
    openFolioWith(runnerA, { tenantId: TENANT, hotelId: HOTEL, stayId: "stay-c1", depositAmount: 300, stayStatus: STAY_STATUS.IN_HOUSE, requestId: "req-open-a" }),
    openFolioWith(runnerB, { tenantId: TENANT, hotelId: HOTEL, stayId: "stay-c1", depositAmount: 300, stayStatus: STAY_STATUS.IN_HOUSE, requestId: "req-open-b" }),
  ]);
  check("两次并发开账都成功返回", opens.every((r) => r.status === "fulfilled"), JSON.stringify(opens.map((r) => r.status)));
  check("账本唯一", scalar("SELECT COUNT(*) AS c FROM folios WHERE hotel_id = ? AND stay_id = ?", [HOTEL, "stay-c1"]) === 1);
  check("押金只记一次", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, "folio-stay-c1"]) === 1);

  console.log("\n== 2. 并发挂账：同一幂等键只入账一次");
  const charges = await Promise.allSettled([
    postChargeWith(runnerA, { tenantId: TENANT, hotelId: HOTEL, stayId: "stay-c1", amount: 50, idempotencyKey: "charge-c1" }),
    postChargeWith(runnerB, { tenantId: TENANT, hotelId: HOTEL, stayId: "stay-c1", amount: 50, idempotencyKey: "charge-c1" }),
  ]);
  check("两次并发挂账都成功返回", charges.every((r) => r.status === "fulfilled"), JSON.stringify(charges.map((r) => r.status)));
  check("消费只入账一次", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, "folio-stay-c1", LEDGER_ENTRY_TYPES.CONSUMPTION]) === 1);
  check("余额为 -250", Number(dbA.prepare("SELECT balance FROM folios WHERE id = 'folio-stay-c1'").get().balance) === -250);

  console.log("\n== 3. 并发退房：房态与流水只写一次");
  const outs = await Promise.allSettled([
    checkoutStayWith(runnerA, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-out-a" }),
    checkoutStayWith(runnerB, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-out-b" }),
  ]);
  check("两次并发退房都成功返回", outs.every((r) => r.status === "fulfilled"), JSON.stringify(outs.map((r) => r.status)));
  check("房态转为脏房", Number(dbA.prepare("SELECT status FROM rooms WHERE id = 'room-hotel-gz-demo-1306'").get().status) === ROOM_STATUS.VACANT_DIRTY);
  check("房态流水只有一条", scalar("SELECT COUNT(*) AS c FROM room_status_logs WHERE hotel_id = ? AND room_id = ?", [HOTEL, "room-hotel-gz-demo-1306"]) === 1);
  check("预订流水只有一条", scalar("SELECT COUNT(*) AS c FROM reservation_status_logs WHERE hotel_id = ? AND reservation_id = ?", [HOTEL, "res-c1"]) === 1);

  console.log("\n== 4. 并发结算：不重复收钱，且只有一个关账方");
  const before = await quoteCheckoutWith(runnerA, { hotelId: HOTEL, stayId: "stay-c1" });
  check("待结算差额 130", before.due === 130, String(before.due));
  const settles = await Promise.allSettled([
    settleFolioWith(runnerA, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-settle-a" }),
    settleFolioWith(runnerB, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-settle-b" }),
  ]);
  check("两次并发结算都成功返回", settles.every((r) => r.status === "fulfilled"), JSON.stringify(settles.map((r) => (r.status === "rejected" ? r.reason.message : r.status))));
  check("房费只入账一次", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, "folio-stay-c1", LEDGER_ENTRY_TYPES.ROOM_CHARGE]) === 1);
  check("补收只入账一次", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ? AND entry_type = ?", [HOTEL, "folio-stay-c1", LEDGER_ENTRY_TYPES.SETTLEMENT]) === 1);
  check("总分录数为 4（押金/消费/房费/补收）", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, "folio-stay-c1"]) === 4);
  check("余额归零", Number(dbA.prepare("SELECT balance FROM folios WHERE id = 'folio-stay-c1'").get().balance) === 0);
  check("账本状态为 closed", dbA.prepare("SELECT status FROM folios WHERE id = 'folio-stay-c1'").get().status === FOLIO_STATUS.CLOSED);
  const closers = settles.filter((r) => r.status === "fulfilled" && r.value.idempotent === false).length;
  check("恰好一个调用方完成关账，另一个识别为幂等", closers === 1, `closers=${closers}`);
  const integrity = await verifyFolioLedger(runnerA, HOTEL, "folio-stay-c1");
  check("并发之后账实仍然相符", integrity.balanced === true, JSON.stringify(integrity));

  console.log("\n== 5. 关账后并发重放不再产生任何分录");
  const replays = await Promise.allSettled([
    settleFolioWith(runnerA, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-settle-c" }),
    settleFolioWith(runnerB, { hotelId: HOTEL, stayId: "stay-c1", requestId: "req-settle-d" }),
  ]);
  check("重放全部幂等返回", replays.every((r) => r.status === "fulfilled" && r.value.idempotent === true), JSON.stringify(replays.map((r) => (r.status === "fulfilled" ? r.value.idempotent : r.reason.message))));
  check("重放后分录数不变", scalar("SELECT COUNT(*) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, "folio-stay-c1"]) === 4);

  console.log("\n== 6. 全程恒等式：balance === SUM(entries)");
  const balance = Number(dbA.prepare("SELECT balance FROM folios WHERE id = 'folio-stay-c1'").get().balance);
  const total = scalar("SELECT COALESCE(SUM(amount), 0) AS c FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [HOTEL, "folio-stay-c1"]);
  check("余额等于分录合计", balance === total, `${balance} vs ${total}`);
} finally {
  dbA.close();
  dbB.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\nSettlement concurrency integration FAILED on SQLite: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nSettlement concurrency integration passed on SQLite (two connections, D1 engine family).");
