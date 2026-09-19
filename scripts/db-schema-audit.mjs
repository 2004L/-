import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Read-only schema audit of a real database file against drizzle/*.sql.
 *
 * The app bootstraps its schema in-process as well as through migrations, so a
 * database can look healthy while quietly missing a table that only migrations
 * create - that is exactly how `orders` went missing. This script never writes:
 * it applies the migrations to an in-memory database and then reports the
 * difference.
 *
 * Usage: node --experimental-strip-types scripts/db-schema-audit.mjs [--file <sqlite>]
 */
const args = process.argv.slice(2);
const fileFlag = args.indexOf("--file");
const target = fileFlag >= 0
  ? args[fileFlag + 1]
  : (() => {
      const dir = join(".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
      const files = readdirSync(dir)
        .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
        .map((name) => join(dir, name))
        .sort((a, b) => statSync(b).size - statSync(a).size);
      return files[0];
    })();

const statementsOf = (sql) => sql
  .split(/;\s*\n/)
  .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const expected = new DatabaseSync(":memory:");
const unapplied = [];
for (const entry of journal.entries) {
  for (const statement of statementsOf(readFileSync(`drizzle/${entry.tag}.sql`, "utf8"))) {
    try { expected.exec(statement); }
    catch (error) { unapplied.push(`${entry.tag}: ${error.message}`); }
  }
}

const readSchema = (db) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  const schema = new Map();
  for (const row of tables) {
    const columns = db.prepare(`PRAGMA table_info("${row.name}")`).all().map((column) => String(column.name));
    schema.set(String(row.name), new Set(columns));
  }
  return schema;
};

const expectedSchema = readSchema(expected);
const actual = new DatabaseSync(target, { readOnly: true });
const actualSchema = readSchema(actual);

const missingTables = [];
const missingColumns = [];
const extraTables = [];
for (const [table, columns] of expectedSchema) {
  const found = actualSchema.get(table);
  if (!found) { missingTables.push(table); continue; }
  const missing = [...columns].filter((column) => !found.has(column));
  if (missing.length) missingColumns.push(`${table}.${missing.join(`,${table}.`)}`);
}
for (const table of actualSchema.keys()) if (!expectedSchema.has(table)) extraTables.push(table);

console.log(`数据库文件: ${target}`);
console.log(`迁移期望: ${expectedSchema.size} 张表    实际: ${actualSchema.size} 张表`);
if (unapplied.length) console.log(`迁移在空库上失败的语句: ${unapplied.length}（第一条：${unapplied[0]}）`);
console.log(`\n缺失的表 (${missingTables.length}): ${missingTables.length ? missingTables.join(", ") : "无"}`);
console.log(`缺失的列 (${missingColumns.length}): ${missingColumns.length ? missingColumns.join(", ") : "无"}`);
console.log(`迁移未声明的表 (${extraTables.length}): ${extraTables.length ? extraTables.join(", ") : "无"}`);

expected.close();
actual.close();

if (missingTables.length || missingColumns.length) {
  console.error("\n存在漂移：该数据库不是由迁移完整建出的，缺少的对象不会被任何运行时路径补齐。");
  process.exit(1);
}
console.log("\n无漂移：该数据库与 drizzle 迁移完全一致。");
