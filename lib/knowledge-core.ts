import type { SqlRunner, SqlValue } from "./orders-core.ts";
import type { ListRunner } from "./checkout-core.ts";

/**
 * 门店知识库。检索用的是「写入时切好的二元词 + FTS5 索引」，不是模型自由发挥：
 *
 * - 中文两字查询（「早餐」「停车」「押金」）在 FTS5 的 trigram 分词器下命中不了，
 *   所以切片时就把正文切成二元词存进 bigrams 列，检索时也把查询切成二元词去匹配；
 * - 命中必须带出处（文档标题 + 版本 + 生效期），因为门店政策说错是要赔钱的；
 * - 命中不到就转人工，绝不让模型自己编一条政策。
 *
 * 与业务表的关系：知识库只读地服务问答，不改任何业务数据。
 */
export const KNOWLEDGE_ERRORS = {
  REQUEST_INVALID: "knowledge_request_invalid",
  DOCUMENT_INVALID: "knowledge_document_invalid",
  VISIBILITY_INVALID: "knowledge_visibility_invalid",
} as const;

export const KNOWLEDGE_AUTHORITY_ORDER: Record<string, number> = { authoritative: 0, reference: 1, hint: 2 };
export const KNOWLEDGE_VISIBILITIES = ["guest", "staff"] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

/** 与 drizzle/0019_knowledge_base.sql 保持逐字一致。 */
export const KNOWLEDGE_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS knowledge_documents (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, authority TEXT NOT NULL, visibility TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, effective_from TEXT NOT NULL, effective_to TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS knowledge_documents_hotel_idx ON knowledge_documents(hotel_id, status, visibility)",
  "CREATE TABLE IF NOT EXISTS knowledge_chunks (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, document_id TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL, keywords TEXT, bigrams TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS knowledge_chunks_doc_idx ON knowledge_chunks(hotel_id, document_id, seq)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(chunk_id UNINDEXED, bigrams)",
];

const CJK_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g;
const CJK_CHARACTER = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** 把一段文本切成检索用的词：西文按词、中文按二元词（单字则保留单字）。 */
export function knowledgeTokens(text: unknown): string[] {
  const out = new Set<string>();
  const value = String(text ?? "").toLowerCase();
  for (const match of value.matchAll(/[a-z0-9]+/g)) out.add(match[0]);
  for (const run of value.match(CJK_RUN) ?? []) {
    if (run.length === 1) { out.add(run); continue; }
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/** 存进 bigrams 列的形式：空格分隔，FTS5 默认分词器可直接索引。 */
export function knowledgeIndex(...parts: unknown[]): string {
  return knowledgeTokens(parts.filter(Boolean).join(" ")).join(" ");
}

/** FTS5 的 MATCH 表达式：任一二元词命中即可，排序交给 bm25 + 覆盖率。 */
function matchExpression(query: string): string {
  const tokens = knowledgeTokens(query);
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

export type KnowledgeHit = {
  chunkId: string;
  documentId: string;
  title: string;
  source: string;
  authority: string;
  version: number;
  effectiveFrom: string;
  content: string;
  score: number;
  /** 查询词被这段内容覆盖的比例（0–1），用于判断「命中得够不够」。 */
  coverage: number;
  /** 是否与文档共享相邻字对；不共享就不算命中（防止拆散的字凑出假相关）。 */
  pairMatched: boolean;
};

export type KnowledgeAnswer = {
  query: string;
  answer: string | null;
  citations: Array<{ documentId: string; title: string; version: number; effectiveFrom: string; authority: string }>;
  confidence: number;
  needsHandoff: boolean;
  hits: KnowledgeHit[];
};

export async function upsertKnowledgeDocumentWith(db: SqlRunner, input: {
  id: string; tenantId: string; hotelId: string; title: string; source: string; authority: string;
  visibility: KnowledgeVisibility; version?: number; effectiveFrom: string; effectiveTo?: string | null; status?: string;
}) {
  if (!input?.id || !input.hotelId || !input.title) throw new Error(KNOWLEDGE_ERRORS.DOCUMENT_INVALID);
  if (!KNOWLEDGE_VISIBILITIES.includes(input.visibility)) throw new Error(KNOWLEDGE_ERRORS.VISIBILITY_INVALID);
  const stamp = new Date().toISOString();
  await db.run(
    "INSERT INTO knowledge_documents (id, tenant_id, hotel_id, title, source, authority, visibility, version, effective_from, effective_to, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, source = excluded.source, authority = excluded.authority, visibility = excluded.visibility, version = excluded.version, effective_from = excluded.effective_from, effective_to = excluded.effective_to, status = excluded.status, updated_at = excluded.updated_at",
    [input.id, input.tenantId, input.hotelId, input.title, input.source, input.authority, input.visibility, input.version ?? 1, input.effectiveFrom, input.effectiveTo ?? null, input.status ?? "active", stamp, stamp],
  );
  return { documentId: input.id };
}

/** 整篇替换切片：文档改版时先清旧切片与索引行，再写新的，避免半新半旧。 */
export async function replaceKnowledgeChunksWith(db: SqlRunner, input: {
  tenantId: string; hotelId: string; documentId: string;
  chunks: Array<{ content: string; keywords?: string | null; seq?: number }>;
}) {
  if (!input?.documentId || !input.hotelId) throw new Error(KNOWLEDGE_ERRORS.DOCUMENT_INVALID);
  const stamp = new Date().toISOString();
  const existing = await db.first<{ id: string }>("SELECT id FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ? LIMIT 1", [input.hotelId, input.documentId]);
  if (existing) {
    await db.run("DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ?)", [input.hotelId, input.documentId]);
    await db.run("DELETE FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ?", [input.hotelId, input.documentId]);
  }
  const document = await db.first<{ title: string }>("SELECT title FROM knowledge_documents WHERE hotel_id = ? AND id = ? LIMIT 1", [input.hotelId, input.documentId]);
  const title = document?.title ?? "";
  let seq = 0;
  for (const chunk of input.chunks) {
    const id = `${input.documentId}-c${chunk.seq ?? seq}`;
    const bigrams = knowledgeIndex(title, chunk.content, chunk.keywords ?? "");
    await db.run(
      "INSERT INTO knowledge_chunks (id, tenant_id, hotel_id, document_id, seq, content, keywords, bigrams, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.tenantId, input.hotelId, input.documentId, chunk.seq ?? seq, chunk.content, chunk.keywords ?? null, bigrams, stamp, stamp],
    );
    await db.run("INSERT INTO knowledge_chunks_fts (chunk_id, bigrams) VALUES (?, ?)", [id, bigrams]);
    seq += 1;
  }
  return { documentId: input.documentId, chunks: input.chunks.length };
}

/**
 * 停用字：疑问词与虚词，它们在文档里本来就不该出现，算进覆盖率只会把分数压低。
 *
 * 只收虚词。「地」曾经因为「地点」被收进来，代价是把「地库」这个字对一起拆掉了 ——
 * 客人问「地库怎么走」时命中不到停车政策（评测集逮到的真缺陷）。
 * 收字的理由必须是「它在这个位置不携带信息」，不是「它在某个词里出现过」。
 */
const QUERY_STOP_CHARS = new Set([..."的是吗呢了我你您们有请在和与及这那都很就也要会不会可以什么怎么多少几啊吧呀哦嗯之其此它他她服务时点需用该本等于被把从向对为所能想知说问看找帮做给来去能嘛"]);

/**
 * 覆盖率用的词表：中文按「去停用词的单字」，西文按整词。
 *
 * 二元词适合建索引，不适合算覆盖率 —— 「早餐几点」的二元词是 早餐/餐几/几点，
 * 而文档里只有「早餐时间」，重叠度只有三分之一，会把一次正确的命中考成「查不到」。
 * 单字覆盖率对同义改写更宽容，同时仍然拦得住「只沾一个词」的乱问。
 */
function coverageTokens(text: unknown): string[] {
  const out = new Set<string>();
  const value = String(text ?? "").toLowerCase();
  for (const match of value.matchAll(/[a-z0-9]+/g)) out.add(match[0]);
  for (const character of value) {
    if (!CJK_CHARACTER.test(character)) continue;
    if (QUERY_STOP_CHARS.has(character)) continue;
    out.add(character);
  }
  return [...out];
}

function coverageOf(queryTokens: string[], hit: { text: string }): number {
  if (!queryTokens.length) return 0;
  const available = new Set(coverageTokens(hit.text));
  const matched = queryTokens.filter((token) => available.has(token)).length;
  return matched / queryTokens.length;
}

/** 原文里的连续中文字串（不过滤停用字）：相邻关系必须来自原文。 */
function rawRuns(text: unknown): string[] {
  return String(text ?? "").toLowerCase().match(CJK_RUN) ?? [];
}

/** 一段文本里的「相邻字对」，且两个字都不是停用字。 */
function pairsOf(text: unknown): Set<string> {
  const pairs = new Set<string>();
  for (const run of rawRuns(text)) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const left = run[i];
      const right = run[i + 1];
      if (QUERY_STOP_CHARS.has(left) || QUERY_STOP_CHARS.has(right)) continue;
      pairs.add(left + right);
    }
  }
  return pairs;
}

/**
 * 命中必须与文档共享一个「相邻字对」（正序或反序）。
 *
 * 单字覆盖率太粗：「有健身房吗」的 健/身/房 会被押金文档里的「身份」「房态」命中，
 * 而客人问的根本不是同一件事。相邻字对要求两个字符在原文里真的挨着 —— 同义换序能召回
 * （「车停」对「停车」），被拆散的巧合字则会被挡掉（「身房」对不上「身份」）。
 *
 * 取对时必须用**原文**相邻关系：先滤掉停用字再取对，会把「退房时间」拆成「房间」，
 * 于是「房间里可以抽烟吗」会被退房政策命中 —— 这是测试逮到的假相关。
 */
function sharesPair(queryText: string, docText: string): boolean {
  const queryPairs = pairsOf(queryText);
  if (!queryPairs.size) return false;
  for (const pair of pairsOf(docText)) {
    const reversed = pair[1] + pair[0];
    if (queryPairs.has(pair) || queryPairs.has(reversed)) return true;
  }
  return false;
}
/**
 * 只返回「此刻生效 + 调用方有权看」的切片。权限过滤是 WHERE 的第一条件，
 * 不是先检索再筛——否则员工文档有可能被检索出来再被前端漏掉。
 */
export async function searchKnowledgeWith(db: ListRunner, input: {
  hotelId: string; query: string; allow?: KnowledgeVisibility[]; limit?: number; now?: Date;
}): Promise<KnowledgeHit[]> {
  if (!input?.hotelId || !input.query) throw new Error(KNOWLEDGE_ERRORS.REQUEST_INVALID);
  const allow = input.allow?.length ? input.allow : (["guest"] as KnowledgeVisibility[]);
  for (const scope of allow) if (!KNOWLEDGE_VISIBILITIES.includes(scope)) throw new Error(KNOWLEDGE_ERRORS.VISIBILITY_INVALID);
  const expression = matchExpression(input.query);
  if (!expression) return [];
  const limit = Math.min(Math.max(Number(input.limit ?? 5), 1), 20);
  const stamp = (input.now ?? new Date()).toISOString();
  const placeholders = allow.map(() => "?").join(", ");
  const params: SqlValue[] = [
    expression, input.hotelId,
    "active", stamp, stamp, ...allow,
    limit,
  ];
  const rows = await db.all<{
    chunk_id: string; document_id: string; title: string; source: string; authority: string;
    version: number; effective_from: string; content: string; keywords: string | null; score: number;
  }>(
    `SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS title, d.source AS source, d.authority AS authority,
            d.version AS version, d.effective_from AS effective_from, c.content AS content, c.keywords AS keywords, bm25(knowledge_chunks_fts) AS score
     FROM knowledge_chunks_fts f
     JOIN knowledge_chunks c ON c.id = f.chunk_id
     JOIN knowledge_documents d ON d.id = c.document_id AND d.hotel_id = c.hotel_id
     WHERE knowledge_chunks_fts MATCH ?
       AND c.hotel_id = ?
       AND d.status = ?
       AND d.effective_from <= ?
       AND (d.effective_to IS NULL OR d.effective_to >= ?)
       AND d.visibility IN (${placeholders})
     ORDER BY score ASC, d.version DESC
     LIMIT ?`,
    params,
  );
  // FTS 用二元词召回，「车停在哪里」这类语序不同、或只差一个字的问法会漏。
  // 语料规模小（一个酒店几百条切片），命中不足时回退扫描本酒店的在效切片做补召回。
  const seen = new Set(rows.map((row) => String(row.chunk_id)));
  const fallback = await db.all<{
    chunk_id: string; document_id: string; title: string; source: string; authority: string;
    version: number; effective_from: string; content: string; keywords: string | null;
  }>(
    `SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS title, d.source AS source, d.authority AS authority,
            d.version AS version, d.effective_from AS effective_from, c.content AS content, c.keywords AS keywords
     FROM knowledge_chunks c
     JOIN knowledge_documents d ON d.id = c.document_id AND d.hotel_id = c.hotel_id
     WHERE c.hotel_id = ? AND d.status = ? AND d.effective_from <= ? AND (d.effective_to IS NULL OR d.effective_to >= ?)
       AND d.visibility IN (${placeholders})
     LIMIT 200`,
    [input.hotelId, "active", stamp, stamp, ...allow],
  );
  for (const row of fallback) {
    if (seen.has(String(row.chunk_id))) continue;
    seen.add(String(row.chunk_id));
    rows.push({ ...row, score: 0 });
  }
  const queryTokens = coverageTokens(input.query);
  const scored = rows.map((row) => ({
    chunkId: String(row.chunk_id),
    documentId: String(row.document_id),
    title: String(row.title),
    source: String(row.source),
    authority: String(row.authority),
    version: Number(row.version),
    effectiveFrom: String(row.effective_from),
    content: String(row.content),
    score: Number(row.score),
    coverage: coverageOf(queryTokens, { text: `${row.title} ${row.content} ${row.keywords ?? ""}` }),
    pairMatched: sharesPair(input.query, `${row.content} ${row.keywords ?? ""}`),
  }));
  // 先按「覆盖了查询多少内容」排，再按 bm25 破平 —— 只靠 bm25 会把「延迟退房怎么收费」排到停车文档上。
  return scored
    .sort((left, right) => (Number(right.pairMatched) - Number(left.pairMatched)) || (right.coverage - left.coverage) || (left.score - right.score))
    .slice(0, limit);
}

/** 最低覆盖阈值：低于它宁可说「查不到」，也不拿一句沾边的政策糊弄客人。 */
export const KNOWLEDGE_MIN_COVERAGE = 0.34;

export async function answerKnowledgeQuestionWith(db: ListRunner, input: {
  hotelId: string; query: string; allow?: KnowledgeVisibility[]; now?: Date;
}): Promise<KnowledgeAnswer> {
  const hits = await searchKnowledgeWith(db, input);
  // 取「第一条够格的」，不是「第一条」：排序里可能有一条只是沾边的切片排在最前，
  // 让它把后面真正答得出来的文档挡掉，就会把一次答得出来的问题判成转人工。
  const best = hits.find((hit) => hit.coverage >= KNOWLEDGE_MIN_COVERAGE && hit.pairMatched) ?? null;
  if (!best) {
    return { query: input.query, answer: null, citations: [], confidence: hits[0]?.coverage ?? 0, needsHandoff: true, hits };
  }
  const citations: KnowledgeAnswer["citations"] = [];
  for (const hit of hits) {
    if (hit.coverage < KNOWLEDGE_MIN_COVERAGE || !hit.pairMatched) continue;
    if (citations.some((item) => item.documentId === hit.documentId)) continue;
    citations.push({ documentId: hit.documentId, title: hit.title, version: hit.version, effectiveFrom: hit.effectiveFrom, authority: hit.authority });
  }
  return { query: input.query, answer: best.content, citations, confidence: best.coverage, needsHandoff: false, hits };
}
