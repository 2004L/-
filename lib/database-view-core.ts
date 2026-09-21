import type { SqlValue } from "./orders-core.ts";
import type { ListRunner } from "./checkout-core.ts";

/**
 * Read-only database browser. It exists so an operator can look at the facts the
 * system is actually holding instead of only the derived charts. Two rules keep
 * it from becoming a liability: table names are only ever taken from
 * sqlite_master (never from the request, so no name can be injected), and
 * credential/identity columns are masked on the way out.
 */
export const DATABASE_VIEW_ERRORS = {
  REQUEST_INVALID: "database_view_request_invalid",
  TABLE_NOT_ALLOWED: "database_view_table_not_allowed",
  LIMIT_INVALID: "database_view_limit_invalid",
} as const;

export const DEFAULT_ROW_LIMIT = 20;
export const MAX_ROW_LIMIT = 50;
const MASK = "***";
/** Never shown raw, even to an owner: a browser is not a reason to leak secrets. */
const SECRET_COLUMNS = new Set(["password_hash", "password_salt", "session_token_hash", "token_hash", "identity_token", "phone_hash", "api_key"]);
const INTERNAL_TABLE_PREFIXES = ["sqlite_", "_cf_", "d1_"];

export type TableSummary = { name: string; rows: number };
export type TablePreview = {
  table: string;
  total: number;
  columns: string[];
  maskedColumns: string[];
  rows: Array<Record<string, SqlValue>>;
  limit: number;
  truncated: boolean;
};

function isInternalTable(name: string) {
  const lower = name.toLowerCase();
  return INTERNAL_TABLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Table names as the database itself reports them. */
async function knownTables(db: ListRunner) {
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", []);
  return rows.map((row) => String(row.name)).filter((name) => !isInternalTable(name));
}

export async function listTablesWith(db: ListRunner): Promise<TableSummary[]> {
  const tables = await knownTables(db);
  const summaries: TableSummary[] = [];
  for (const name of tables) {
    const row = await db.first<{ c: number }>(`SELECT COUNT(*) AS c FROM "${name}"`, []);
    summaries.push({ name, rows: Number(row?.c ?? 0) });
  }
  return summaries;
}

export async function previewTableWith(db: ListRunner, input: { table: string; limit?: number }): Promise<TablePreview> {
  if (!input?.table) throw new Error(DATABASE_VIEW_ERRORS.REQUEST_INVALID);
  const limit = input.limit === undefined ? DEFAULT_ROW_LIMIT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT) throw new Error(DATABASE_VIEW_ERRORS.LIMIT_INVALID);
  const tables = await knownTables(db);
  if (!tables.includes(input.table)) throw new Error(DATABASE_VIEW_ERRORS.TABLE_NOT_ALLOWED);

  const table = `"${input.table}"`;
  const columns = (await db.all<{ name: string }>(`PRAGMA table_info(${table})`, [])).map((row) => String(row.name));
  const maskedColumns = columns.filter((column) => SECRET_COLUMNS.has(column.toLowerCase()));
  const total = Number((await db.first<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`, []))?.c ?? 0);
  const raw = await db.all<Record<string, SqlValue>>(`SELECT * FROM ${table} LIMIT ?`, [limit]);
  const rows = raw.map((row) => {
    const masked: Record<string, SqlValue> = {};
    for (const [key, value] of Object.entries(row)) masked[key] = maskedColumns.includes(key) && value !== null ? MASK : value;
    return masked;
  });
  return { table: input.table, total, columns, maskedColumns, rows, limit, truncated: total > rows.length };
}