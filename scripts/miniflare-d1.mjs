import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolve the miniflare copy wrangler depends on (version-agnostic). */
export function resolveMiniflareEntry() {
  const root = join(process.cwd(), "node_modules", ".pnpm");
  let entries = [];
  try { entries = readdirSync(root).filter((name) => name.startsWith("miniflare@")).sort(); } catch { return null; }
  if (!entries.length) return null;
  return join(root, entries[entries.length - 1], "node_modules", "miniflare", "dist", "src", "index.js");
}

/** Real D1 binding (miniflare/workerd) so integration tests use the production API. */
export async function createMiniflareD1() {
  const entry = resolveMiniflareEntry();
  if (!entry) return null;
  const { Miniflare } = await import(pathToFileURL(entry).href);
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "00000000-0000-4000-8000-000000000000" },
  });
  const db = await mf.getD1Database("DB");
  return { mf, db };
}

export function d1Runner(db) {
  return {
    run: async (sql, params) => {
      const result = await db.prepare(sql).bind(...params).run();
      return { changes: Number(result.meta?.changes ?? 0) };
    },
    first: (sql, params) => db.prepare(sql).bind(...params).first(),
  };
}
