import { readFileSync } from "node:fs";
import { createMiniflareD1 } from "./miniflare-d1.mjs";

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
const HOTEL = "hotel-gz-demo";

const migrationStatements = (path) => readFileSync(path, "utf8")
  .split(/;\s*\n/)
  .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

try {
  for (const statement of migrationStatements("drizzle/0008_hotel_core_domain.sql")) await db.prepare(statement).run();

  console.log("== 构造缺陷现场（房型两套、房间 id 两套）");
  await db.prepare("INSERT INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES ('rt-hotel-gz-demo-E9AB98E7BAA7E5A4', 'tenant-demo', ?, 'LEGACY-E9AB98E7BAA7E5A4', '高级大床房', NULL, 2, 1, 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at) VALUES ('pms-rt-hotel-gz-demo-DLX-KING', 'tenant-demo', ?, 'DLX-KING', 'DLX-KING', 'DLX-KING', 2, 1, 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES ('room-hotel-gz-demo-1206', 'tenant-demo', ?, 'rt-hotel-gz-demo-E9AB98E7BAA7E5A4', '1206', 12, 3, 1, NULL, 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at) VALUES ('pms-room-hotel-gz-demo-1306', 'tenant-demo', ?, 'pms-rt-hotel-gz-demo-DLX-KING', '1306', 13, 3, 1, 'sim-1306', 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at) VALUES ('res-1', 'tenant-demo', ?, 'R-1', '美团', 'R-1', '演示住客', '4821', NULL, 2, '2026-09-17', 1, 1, 680, 300, 'CNY', 1, 'k-1', 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at) VALUES ('rr-1', 'tenant-demo', ?, 'res-1', 'rt-hotel-gz-demo-E9AB98E7BAA7E5A4', 'pms-room-hotel-gz-demo-1306', 380, 1, 't0', 't0')").bind(HOTEL).run();
  await db.prepare("INSERT INTO room_status_logs (id, tenant_id, hotel_id, room_id, from_status, to_status, reason, actor_type, actor_id, request_id, created_at) VALUES ('rl-1', 'tenant-demo', ?, 'pms-room-hotel-gz-demo-1306', 0, 3, 'check-in', 'guest_flow', NULL, 'req-1', 't0')").bind(HOTEL).run();

  const before = {
    types: (await db.prepare("SELECT COUNT(*) AS c FROM room_types").first()).c,
    badIds: (await db.prepare("SELECT COUNT(*) AS c FROM rooms WHERE id <> 'room-' || hotel_id || '-' || room_number").first()).c,
  };
  check("构造出两套房型与两套房间 id", Number(before.types) === 2 && Number(before.badIds) === 1, JSON.stringify(before));

  console.log("\n== 执行 0014 数据治理迁移");
  const statements = migrationStatements("drizzle/0014_data_governance.sql");
  for (const statement of statements) await db.prepare(statement).run();

  const summary = async () => ({
    types: Number((await db.prepare("SELECT COUNT(*) AS c FROM room_types").first()).c),
    badRoomIds: Number((await db.prepare("SELECT COUNT(*) AS c FROM rooms WHERE id <> 'room-' || hotel_id || '-' || room_number").first()).c),
    orphanRoomType: Number((await db.prepare("SELECT COUNT(*) AS c FROM rooms WHERE room_type_id NOT IN (SELECT id FROM room_types)").first()).c),
    orphanResRoomType: Number((await db.prepare("SELECT COUNT(*) AS c FROM reservation_rooms WHERE room_type_id IS NOT NULL AND room_type_id NOT IN (SELECT id FROM room_types)").first()).c),
    orphanResRoom: Number((await db.prepare("SELECT COUNT(*) AS c FROM reservation_rooms WHERE room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM rooms)").first()).c),
    orphanLogRoom: Number((await db.prepare("SELECT COUNT(*) AS c FROM room_status_logs WHERE room_id NOT IN (SELECT id FROM rooms)").first()).c),
  });
  const after = await summary();
  check("房型归并为 1 个逻辑房型", after.types === 1, JSON.stringify(after));
  check("房间 id 全部规范", after.badRoomIds === 0);
  check("无房型悬空引用", after.orphanRoomType === 0 && after.orphanResRoomType === 0);
  check("无房间悬空引用", after.orphanResRoom === 0 && after.orphanLogRoom === 0);

  const types = await db.prepare("SELECT id, code, name, pms_code FROM room_types").all();
  check("房型使用权威 id 与中文名", types.results[0].id === "rt-hotel-gz-demo-DLX-KING" && types.results[0].name === "高级大床房" && types.results[0].pms_code === "GZ-HAOS-001-DLX-KING", JSON.stringify(types.results[0]));
  const room = await db.prepare("SELECT id, room_type_id FROM rooms WHERE room_number = '1306'").first();
  check("房间改挂权威房型", room.id === "room-hotel-gz-demo-1306" && room.room_type_id === "rt-hotel-gz-demo-DLX-KING", JSON.stringify(room));

  console.log("\n== 迁移可重复执行");
  for (const statement of statements) await db.prepare(statement).run();
  const again = await summary();
  check("重复执行结果一致", JSON.stringify(again) === JSON.stringify(after), `${JSON.stringify(after)} vs ${JSON.stringify(again)}`);
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nData governance integration FAILED: ${failures}.`);
  process.exit(1);
}
console.log("\nData governance integration passed on a real D1 binding (miniflare/workerd).");
