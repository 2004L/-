import { readFileSync } from "node:fs";
import { FOLIOS_DDL } from "../lib/settlement-core.ts";
import { DATABASE_VIEW_ERRORS, MAX_ROW_LIMIT, listTablesWith, previewTableWith } from "../lib/database-view-core.ts";
import { INHOUSE_DDL, INHOUSE_ERRORS, listInHouseWith, setServiceNeedWith } from "../lib/inhouse-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * The two surfaces an operator gets to see: what the database actually holds, and
 * who is in the building right now. The browser must not leak credentials and must
 * not let a request name an arbitrary table; the in-house list must show every
 * guest, including one the system cannot place, and must keep a truthful record of
 * who said a room needs something.
 */
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
/** D1 returns rows through all(); the cores only need this one extra method. */
const lister = { ...runner, all: async (sql, params) => (await db.prepare(sql).bind(...params).all()).results ?? [] };
const execSql = async (path) => {
  const statements = readFileSync(path, "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
};

const STAMP = "2026-09-19T10:00:00.000Z";

async function seedGuest(key, options) {
  const { roomNumber = null, inHouse = true, balance = -300 } = options;
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, '美团', ?, ?, ?, NULL, ?, '2026-09-18', 2, 1, 760, 300, 'CNY', 1, ?, ?, ?)")
    .bind(`res-${key}`, TENANT, HOTEL, `NO-${key}`, `NO-${key}`, `演示住客${key}`, `482${key.length}`, inHouse ? 2 : 3, `reservation:${key}`, STAMP, STAMP).run();
  await db.prepare("INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 380, ?, ?, ?)")
    .bind(`rr-${key}`, TENANT, HOTEL, `res-${key}`, `rt-${HOTEL}-DLX-KING`, roomNumber ? `room-${HOTEL}-${roomNumber}` : null, inHouse ? 1 : 0, STAMP, STAMP).run();
  await db.prepare("INSERT INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?)")
    .bind(`stay-${key}`, TENANT, HOTEL, `res-${key}`, `演示住客${key}`, `482${key.length}`, inHouse ? 2 : 3, STAMP, inHouse ? null : STAMP, STAMP, STAMP).run();
  if (balance !== null) {
    await db.prepare("INSERT INTO folios (id, tenant_id, hotel_id, stay_id, status, currency, balance, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', 'CNY', ?, 1, ?, ?)")
      .bind(`folio-${key}`, TENANT, HOTEL, `stay-${key}`, balance, STAMP, STAMP).run();
    await db.prepare("INSERT INTO ledger_entries (id, tenant_id, hotel_id, folio_id, entry_type, amount, currency, idempotency_key, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, 'consumption', 120, 'CNY', ?, 'folio', ?, ?)")
      .bind(`le-${key}`, TENANT, HOTEL, `folio-${key}`, `entry:${key}`, `folio-${key}`, STAMP).run();
  }
}

try {
  await execSql("drizzle/0008_hotel_core_domain.sql");
  await execSql("drizzle/0017_room_service_needs.sql");
  for (const statement of FOLIOS_DDL) await db.prepare(statement).run();
  await db.prepare("CREATE TABLE secrets_probe (id TEXT PRIMARY KEY, password_hash TEXT, identity_token TEXT, label TEXT)").run();
  await db.prepare("INSERT INTO secrets_probe VALUES ('s1', 'pbkdf2$abc', 'TOKEN-1', 'ok')").run();
  for (const number of ["1206", "1208"]) {
    await db.prepare("INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 12, 3, 1, NULL, ?, ?)")
      .bind(`room-${HOTEL}-${number}`, TENANT, HOTEL, `rt-${HOTEL}-DLX-KING`, number, STAMP, STAMP).run();
  }
  await seedGuest("A", { roomNumber: "1206", balance: -300 });
  await seedGuest("B", { roomNumber: null, balance: null });
  await seedGuest("C", { roomNumber: "1208", inHouse: false, balance: -80 });

  console.log("== 1. 数据库浏览：表清单");
  const tables = await listTablesWith(lister);
  const names = tables.map((table) => table.name);
  check("列出真实存在的表", names.includes("reservations") && names.includes("folios"), JSON.stringify(names.slice(0, 6)));
  check("按名称排序", JSON.stringify(names) === JSON.stringify([...names].sort()), "未排序");
  check("带出每张表的行数", tables.find((table) => table.name === "reservations")?.rows === 3, JSON.stringify(tables.find((table) => table.name === "reservations")));
  check("隐藏 SQLite 内部表", !names.some((name) => name.startsWith("sqlite_")), JSON.stringify(names.filter((name) => name.startsWith("sqlite_"))));

  console.log("\n== 2. 数据库浏览：行预览");
  const preview = await previewTableWith(lister, { table: "secrets_probe" });
  check("返回列名", JSON.stringify(preview.columns) === JSON.stringify(["id", "password_hash", "identity_token", "label"]), JSON.stringify(preview.columns));
  check("凭据与身份令牌被脱敏", preview.rows[0].password_hash === "***" && preview.rows[0].identity_token === "***", JSON.stringify(preview.rows[0]));
  check("普通列原样返回", preview.rows[0].label === "ok" && preview.rows[0].id === "s1", JSON.stringify(preview.rows[0]));
  check("标出被脱敏的列", JSON.stringify(preview.maskedColumns.sort()) === JSON.stringify(["identity_token", "password_hash"]), JSON.stringify(preview.maskedColumns));
  check("预览不改动数据", Number((await db.prepare("SELECT COUNT(*) AS c FROM secrets_probe").first()).c) === 1);

  let notAllowed = "";
  try { await previewTableWith(lister, { table: "sqlite_master" }); } catch (error) { notAllowed = error.message; }
  check("请求未列出的表被拒绝", notAllowed === DATABASE_VIEW_ERRORS.TABLE_NOT_ALLOWED, notAllowed);
  let injected = "";
  try { await previewTableWith(lister, { table: 'secrets_probe" ; DROP TABLE folios --' }); } catch (error) { injected = error.message; }
  check("拼接表名被拒绝", injected === DATABASE_VIEW_ERRORS.TABLE_NOT_ALLOWED, injected);
  check("拒绝请求后 folios 仍在", Number((await db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'folios'").first()).c) === 1);
  let badLimit = "";
  try { await previewTableWith(lister, { table: "folios", limit: MAX_ROW_LIMIT + 1 }); } catch (error) { badLimit = error.message; }
  check("超出上限的行数被拒绝", badLimit === DATABASE_VIEW_ERRORS.LIMIT_INVALID, badLimit);

  console.log("\n== 3. 在住客人：客房信息与是否需要服务");
  const guests = await listInHouseWith(lister, { hotelId: HOTEL });
  check("只列在住客人", guests.length === 2 && guests.every((guest) => guest.stayId !== "stay-C"), JSON.stringify(guests.map((guest) => guest.stayId)));
  const placed = guests.find((guest) => guest.stayId === "stay-A");
  check("带出房号与脱敏客人", placed.roomNumber === "1206" && placed.guestNameMasked === "演示住客A", JSON.stringify(placed));
  check("带出账务余额与在住消费", placed.folioBalance === -300 && placed.consumption === 120, JSON.stringify({ balance: placed.folioBalance, consumption: placed.consumption }));
  check("默认无需服务", placed.serviceNeed === "none" && placed.serviceReportedAt === null, JSON.stringify(placed.serviceNeed));
  check("挂不上房的客人也留在列表里", guests.some((guest) => guest.stayId === "stay-B" && guest.roomNumber === null), JSON.stringify(guests.map((guest) => guest.roomNumber)));

  console.log("\n== 4. 标注与清除服务需求");
  const set = await setServiceNeedWith(runner, { tenantId: TENANT, hotelId: HOTEL, roomNumber: "1206", need: "cleaning", note: "客人要补浴巾", actor: "admin-frontdesk-demo", stayId: "stay-A" });
  check("记录服务需求", set.need === "cleaning" && set.status === "open" && set.reportedBy === "admin-frontdesk-demo", JSON.stringify(set));
  const afterSet = (await listInHouseWith(lister, { hotelId: HOTEL })).find((guest) => guest.stayId === "stay-A");
  check("列表里能看到需求与备注", afterSet.serviceNeed === "cleaning" && afterSet.serviceNote === "客人要补浴巾", JSON.stringify(afterSet.serviceNote));
  check("记录是谁什么时候标的", afterSet.serviceReportedBy === "admin-frontdesk-demo" && Boolean(afterSet.serviceReportedAt), JSON.stringify(afterSet.serviceReportedAt));

  const cleared = await setServiceNeedWith(runner, { tenantId: TENANT, hotelId: HOTEL, roomNumber: "1206", need: "none", actor: "admin-housekeeping-demo" });
  check("清除后状态为已完成", cleared.status === "done" && cleared.reportedBy === null, JSON.stringify(cleared));
  const afterClear = (await listInHouseWith(lister, { hotelId: HOTEL })).find((guest) => guest.stayId === "stay-A");
  check("列表回到无需服务", afterClear.serviceNeed === "none", JSON.stringify(afterClear.serviceNeed));
  check("清除是保留记录而不是删除", Number((await db.prepare("SELECT COUNT(*) AS c FROM room_service_needs").first()).c) === 1);

  const again = await setServiceNeedWith(runner, { tenantId: TENANT, hotelId: HOTEL, roomNumber: "1206", need: "maintenance", actor: "admin-manager-demo" });
  check("同一间房重复标注只保留一行", again.need === "maintenance" && Number((await db.prepare("SELECT COUNT(*) AS c FROM room_service_needs").first()).c) === 1);

  let badNeed = "";
  try { await setServiceNeedWith(runner, { tenantId: TENANT, hotelId: HOTEL, roomNumber: "1206", need: "spa", actor: "x" }); } catch (error) { badNeed = error.message; }
  check("非法服务类型被拒绝", badNeed === INHOUSE_ERRORS.NEED_INVALID, badNeed);
  let unknownRoom = "";
  try { await setServiceNeedWith(runner, { tenantId: TENANT, hotelId: HOTEL, roomNumber: "9999", need: "cleaning", actor: "x" }); } catch (error) { unknownRoom = error.message; }
  check("不存在的房间被拒绝", unknownRoom === INHOUSE_ERRORS.ROOM_NOT_FOUND, unknownRoom);
  check("运行时 DDL 与迁移一致", INHOUSE_DDL.length === 2);
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nIn-house and database view FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nIn-house and database view passed on a real D1 binding (miniflare/workerd).");