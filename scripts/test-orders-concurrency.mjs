import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORDERS_DDL } from "../lib/orders-core.ts";
import { runOrderScenarios } from "./orders-integration-scenarios.mjs";

// node:sqlite is the same SQLite engine family as D1. Node 22 needs
// --experimental-sqlite, so re-exec once with the flag instead of skipping.
const RETRY_ENV = "ORDERS_SQLITE_RETRY";
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

const dir = mkdtempSync(join(tmpdir(), "orders-it-"));
const file = join(dir, "orders.sqlite");
const setup = new DatabaseSync(file);
for (const statement of ORDERS_DDL) setup.exec(statement);
setup.exec("CREATE TABLE demo_orders (id TEXT PRIMARY KEY, tenant_id TEXT, hotel_id TEXT, order_code TEXT, source TEXT, guest_label TEXT, phone_last4 TEXT, status TEXT, room_number TEXT, room_amount INTEGER, deposit_amount INTEGER, total_amount INTEGER, created_at TEXT, updated_at TEXT)");
setup.close();

const dbA = new DatabaseSync(file);
const dbB = new DatabaseSync(file);
const makeRunner = (db) => ({
  run: async (sql, params) => ({ changes: Number(db.prepare(sql).run(...params).changes ?? 0) }),
  first: async (sql, params) => db.prepare(sql).get(...params) ?? null,
});

try {
  await runOrderScenarios({ runnerA: makeRunner(dbA), runnerB: makeRunner(dbB), check });
} finally {
  dbA.close();
  dbB.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\nOrders concurrency integration FAILED on SQLite: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nOrders concurrency integration passed on SQLite (two connections, D1 engine family).");
