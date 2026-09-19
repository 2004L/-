import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createMiniflareD1 } from "./miniflare-d1.mjs";
import { ORDERS_DDL } from "../lib/orders-core.ts";
import { FOLIOS_DDL } from "../lib/settlement-core.ts";

/**
 * Schema drift guard. The repository builds its schema twice: once in
 * drizzle/*.sql and once as in-process bootstrap DDL. That duplication already
 * shipped one bug - `orders` existed as runtime DDL only, so a database created
 * purely from migrations had no orders table at all. This suite fails if the two
 * definitions ever disagree again.
 */
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

const statementsOf = (sql) => sql
  .split(/;\s*\n/)
  .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const migrations = journal.entries.map((entry) => ({
  tag: entry.tag,
  sql: readFileSync(`drizzle/${entry.tag}.sql`, "utf8"),
}));

const tables = async () => {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  return rows.results.map((row) => String(row.name)).sort();
};
const columns = async (table) => {
  const rows = await db.prepare(`PRAGMA table_info("${table}")`).all();
  return rows.results.map((row) => String(row.name)).sort();
};

const runtimeDdl = [...ORDERS_DDL, ...FOLIOS_DDL];

try {
  for (const statement of runtimeDdl) await db.prepare(statement).run();
  const runtimeOnlyTables = await tables();
  const runtimeOnlyColumns = {};
  for (const table of runtimeOnlyTables) runtimeOnlyColumns[table] = await columns(table);

  let migrationFailures = [];
  for (const migration of migrations) {
    for (const statement of statementsOf(migration.sql)) {
      try { await db.prepare(statement).run(); }
      catch (error) { migrationFailures.push(`${migration.tag}: ${error.message}`); }
    }
  }
  check("全部迁移可在空库上顺序执行", migrationFailures.length === 0, migrationFailures.slice(0, 3).join(" | "));

  const migratedTables = await tables();
  const migrated = new Set(migratedTables);

  console.log("\n== 1. 运行时 DDL 建出的表，迁移里也必须存在");
  for (const table of runtimeOnlyTables) {
    check(`迁移包含表 ${table}`, migrated.has(table));
  }

  console.log("\n== 2. 运行时 DDL 与迁移的列必须一致");
  for (const table of runtimeOnlyTables) {
    if (!migrated.has(table)) continue;
    const migratedColumns = await columns(table);
    const runtimeColumns = runtimeOnlyColumns[table];
    const missing = runtimeColumns.filter((column) => !migratedColumns.includes(column));
    const extra = migratedColumns.filter((column) => !runtimeColumns.includes(column));
    check(`表 ${table} 列一致`, missing.length === 0 && extra.length === 0, `迁移缺少 ${JSON.stringify(missing)}，迁移多出 ${JSON.stringify(extra)}`);
  }

  console.log("\n== 3. 源码中的每一条运行时 DDL 都必须在迁移里有对应产物");
  const sourceFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!["node_modules", "dist", ".next"].includes(name)) walk(full); }
      else if (/\.(ts|tsx)$/.test(name)) sourceFiles.push(full);
    }
  };
  for (const root of ["lib", "app", "worker"]) {
    try { walk(root); } catch { /* directory may not exist */ }
  }
  const declaredTables = new Set();
  const declaredColumns = new Set();
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/g)) declaredTables.add(match[1]);
    for (const match of source.matchAll(/ALTER TABLE\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+ADD COLUMN\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/g)) declaredColumns.add(`${match[1]}.${match[2]}`);
  }
  const missingTables = [...declaredTables].filter((table) => !migrated.has(table)).sort();
  check(`源码声明的 ${declaredTables.size} 张表全部由迁移覆盖`, missingTables.length === 0, JSON.stringify(missingTables));
  const missingColumns = [];
  for (const entry of declaredColumns) {
    const [table, column] = entry.split(".");
    if (!migrated.has(table)) continue;
    const migratedColumns = await columns(table);
    if (!migratedColumns.includes(column)) missingColumns.push(entry);
  }
  check(`源码声明的 ${declaredColumns.size} 个补列全部由迁移覆盖`, missingColumns.length === 0, JSON.stringify(missingColumns.sort()));

  console.log("\n== 4. 已修复的回归点");
  check("orders 已由迁移创建（不再只是运行时 DDL）", migrated.has("orders"));
  const caseColumns = await columns("checkin_cases");
  check("checkin_cases.legacy_status 由迁移补上", caseColumns.includes("legacy_status"));
  const ledgerColumns = await columns("ledger_entries");
  check("ledger_entries 具备结算所需字段", ["folio_id", "entry_type", "amount", "idempotency_key"].every((column) => ledgerColumns.includes(column)));
  const folioColumns = await columns("folios");
  check("folios 具备账实相符所需字段", ["stay_id", "status", "balance", "version"].every((column) => folioColumns.includes(column)));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nSchema drift FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nSchema drift check passed (runtime DDL and migrations agree).");
