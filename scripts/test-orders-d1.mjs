import { ORDERS_DDL } from "../lib/orders-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";
import { runOrderScenarios } from "./orders-integration-scenarios.mjs";

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

try {
  for (const statement of ORDERS_DDL) await db.prepare(statement).run();
  await db.prepare("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, status TEXT, room_number TEXT, room_amount INTEGER, deposit_amount INTEGER, total_amount INTEGER, created_at TEXT, updated_at TEXT)").run();
  await runOrderScenarios({ runnerA: d1Runner(db), runnerB: d1Runner(db), check });
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nOrders concurrency integration FAILED on D1: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nOrders concurrency integration passed on a real D1 binding (miniflare/workerd).");
