import type { ListRunner } from "./checkout-core.ts";
import {
  KNOWLEDGE_VISIBILITIES,
  replaceKnowledgeChunksWith,
  upsertKnowledgeDocumentWith,
  type KnowledgeVisibility,
} from "./knowledge-core.ts";

export type { KnowledgeVisibility };

/**
 * 门店政策的后台录入面。店长改一条政策，不该需要写 SQL、也不该由我们代劳；
 * 但「客人会拿到的答案」是花钱的答案，所以这里只管**校验和落库**，
 * 真正的写入仍然要走 prepare → 人工确认（见 lib/admin-service.ts）。
 *
 * 与 knowledge-core 的分工：那边只管检索，这边只管录入，两侧共用同一份
 * 切片写入逻辑（replaceKnowledgeChunksWith），所以录进去的政策和评测里的语料
 * 是同一种形状。
 */
export const KNOWLEDGE_ADMIN_ERRORS = {
  REQUEST_INVALID: "knowledge_admin_request_invalid",
  TITLE_INVALID: "knowledge_admin_title_invalid",
  SOURCE_INVALID: "knowledge_admin_source_invalid",
  AUTHORITY_INVALID: "knowledge_admin_authority_invalid",
  VISIBILITY_INVALID: "knowledge_admin_visibility_invalid",
  CHUNKS_INVALID: "knowledge_admin_chunks_invalid",
  EFFECTIVE_RANGE_INVALID: "knowledge_admin_effective_range_invalid",
  DOCUMENT_NOT_FOUND: "knowledge_admin_document_not_found",
  STATUS_INVALID: "knowledge_admin_status_invalid",
  KEYWORDS_INVALID: "knowledge_admin_keywords_invalid",
} as const;

export const KNOWLEDGE_AUTHORITIES = ["authoritative", "reference", "hint"] as const;
export type KnowledgeAuthority = (typeof KNOWLEDGE_AUTHORITIES)[number];
export const KNOWLEDGE_SOURCES = ["policy", "faq", "sop", "ticket", "manual"] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];
export const KNOWLEDGE_STATUSES = ["active", "draft", "retired"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_AUTHORITY_LABELS: Record<KnowledgeAuthority, string> = { authoritative: "正式政策", reference: "参考资料", hint: "提示" };
export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSource, string> = { policy: "门店政策", faq: "常见问答", sop: "内部流程", ticket: "工单沉淀", manual: "手工录入" };
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = { active: "生效中", draft: "草稿", retired: "已停用" };
export const KNOWLEDGE_VISIBILITY_LABELS: Record<KnowledgeVisibility, string> = { guest: "客人可见", staff: "仅员工可见" };

export const MAX_TITLE_CHARS = 80;
export const MAX_CHUNKS = 20;
export const MAX_CHUNK_CHARS = 500;
export const MAX_TOTAL_CHARS = 4000;
export const MAX_KEYWORDS = 30;
export const MAX_KEYWORD_CHARS = 20;
export const MAX_KEYWORDS_CHARS = 200;

export type KnowledgeDraft = {
  documentId: string | null;
  title: string;
  source: KnowledgeSource;
  authority: KnowledgeAuthority;
  visibility: KnowledgeVisibility;
  version: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: KnowledgeStatus;
  chunks: string[];
  /** 客人可能用到的其他说法。检索按字匹配，同义词不写进来就答不出来。 */
  keywords: string[];
};

export type KnowledgeDocumentSummary = {
  documentId: string;
  title: string;
  source: string;
  authority: string;
  visibility: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  chunks: number;
  updatedAt: string | null;
};

export type KnowledgeDocumentDetail = KnowledgeDocumentSummary & {
  chunksDetail: Array<{ chunkId: string; seq: number; content: string; keywords: string | null }>;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** 生效日按当地零点，失效日按当天最后一毫秒：写「生效至 9 月 20 日」就该管满 9 月 20 日。 */
function toDayStart(value: string) {
  return `${value}T00:00:00.000Z`;
}

function toDayEnd(value: string) {
  return `${value}T23:59:59.999Z`;
}

function normalizeDay(value: unknown, field: string) {
  const raw = text(value).slice(0, 10);
  if (!DAY.test(raw)) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.EFFECTIVE_RANGE_INVALID}:${field}`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.EFFECTIVE_RANGE_INVALID}:${field}`);
  return raw;
}

/** 切片：一行一条，空行丢掉。行就是切片，所以不在行内放换行。 */
export function splitKnowledgeChunks(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split("\n");
  return raw.map((item) => text(item)).filter(Boolean);
}

/** 关键词：空格/逗号/顿号分隔，去重、去空。它和正文一样进索引，所以也进校验。 */
export function splitKnowledgeKeywords(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,，、;；]+/);
  const out: string[] = [];
  for (const item of raw) {
    const keyword = text(item);
    if (!keyword || out.includes(keyword)) continue;
    out.push(keyword);
  }
  return out;
}

export function normalizeKnowledgeDraft(input: unknown): KnowledgeDraft {
  const source = (input ?? {}) as Record<string, unknown>;
  const title = text(source.title);
  if (!title || title.length > MAX_TITLE_CHARS) throw new Error(KNOWLEDGE_ADMIN_ERRORS.TITLE_INVALID);
  if (!isOneOf(source.source, KNOWLEDGE_SOURCES)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.SOURCE_INVALID);
  if (!isOneOf(source.authority, KNOWLEDGE_AUTHORITIES)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.AUTHORITY_INVALID);
  if (!isOneOf(source.visibility, KNOWLEDGE_VISIBILITIES)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.VISIBILITY_INVALID);
  if (source.status !== undefined && source.status !== "" && !isOneOf(source.status, KNOWLEDGE_STATUSES)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.STATUS_INVALID);

  const chunks = splitKnowledgeChunks(source.chunks);
  if (!chunks.length || chunks.length > MAX_CHUNKS) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID}:count`);
  if (chunks.some((chunk) => chunk.length > MAX_CHUNK_CHARS)) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID}:length`);
  if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > MAX_TOTAL_CHARS) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID}:total`);

  const effectiveFromDay = normalizeDay(source.effectiveFrom, "effective_from");
  const effectiveToRaw = text(source.effectiveTo).slice(0, 10);
  let effectiveTo: string | null = null;
  if (effectiveToRaw) {
    const effectiveToDay = normalizeDay(effectiveToRaw, "effective_to");
    if (effectiveToDay < effectiveFromDay) throw new Error(`${KNOWLEDGE_ADMIN_ERRORS.EFFECTIVE_RANGE_INVALID}:order`);
    effectiveTo = toDayEnd(effectiveToDay);
  }

  const keywords = splitKnowledgeKeywords(source.keywords);
  if (keywords.length > MAX_KEYWORDS || keywords.some((keyword) => keyword.length > MAX_KEYWORD_CHARS)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.KEYWORDS_INVALID);
  if (keywords.join(" ").length > MAX_KEYWORDS_CHARS) throw new Error(KNOWLEDGE_ADMIN_ERRORS.KEYWORDS_INVALID);

  const versionRaw = source.version;
  const version = versionRaw === undefined || versionRaw === null || versionRaw === "" ? null : Number(versionRaw);
  if (version !== null && (!Number.isInteger(version) || version < 1 || version > 9999)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);

  const documentId = text(source.documentId) || null;
  if (documentId && !/^[a-zA-Z0-9_-]{4,80}$/.test(documentId)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);

  return {
    documentId,
    title,
    source: source.source,
    authority: source.authority,
    visibility: source.visibility,
    version,
    effectiveFrom: toDayStart(effectiveFromDay),
    effectiveTo,
    status: isOneOf(source.status, KNOWLEDGE_STATUSES) ? source.status : "active",
    chunks,
    keywords,
  };
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** 文档 id：`kb-<门店简码>-<随机>`,和迁移里预置的 `kb-gz-breakfast` 同一形状。 */
export function newKnowledgeDocumentId(hotelCode: unknown) {
  const prefix = String(hotelCode ?? "").split(/[^a-zA-Z0-9]+/).filter(Boolean)[0]?.toLowerCase() ?? "hotel";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
  return `kb-${prefix || "hotel"}-${suffix}`;
}

/** 列表：草稿和已停用的也要看得见，否则店长没法把停错的那条放回去。 */
export async function listKnowledgeDocumentsWith(db: ListRunner, input: { hotelId: string }): Promise<KnowledgeDocumentSummary[]> {
  if (!input?.hotelId) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT d.id, d.title, d.source, d.authority, d.visibility, d.version, d.effective_from, d.effective_to, d.status, d.updated_at,
            (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.hotel_id = d.hotel_id AND c.document_id = d.id) AS chunks
     FROM knowledge_documents d
     WHERE d.hotel_id = ?
     ORDER BY CASE d.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, d.updated_at DESC, d.id`,
    [input.hotelId],
  );
  return rows.map((row) => ({
    documentId: String(row.id),
    title: String(row.title ?? ""),
    source: String(row.source ?? ""),
    authority: String(row.authority ?? ""),
    visibility: String(row.visibility ?? ""),
    version: Number(row.version ?? 1),
    effectiveFrom: String(row.effective_from ?? ""),
    effectiveTo: row.effective_to === null || row.effective_to === undefined ? null : String(row.effective_to),
    status: String(row.status ?? "active"),
    chunks: Number(row.chunks ?? 0),
    updatedAt: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
  }));
}

export async function getKnowledgeDocumentWith(db: ListRunner, input: { hotelId: string; documentId: string }): Promise<KnowledgeDocumentDetail> {
  if (!input?.hotelId || !input?.documentId) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);
  const row = await db.first<Record<string, unknown>>(
    "SELECT id, title, source, authority, visibility, version, effective_from, effective_to, status, updated_at FROM knowledge_documents WHERE hotel_id = ? AND id = ? LIMIT 1",
    [input.hotelId, input.documentId],
  );
  if (!row) throw new Error(KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND);
  const chunks = await db.all<Record<string, unknown>>(
    "SELECT id, seq, content, keywords FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ? ORDER BY seq",
    [input.hotelId, input.documentId],
  );
  return {
    documentId: String(row.id),
    title: String(row.title ?? ""),
    source: String(row.source ?? ""),
    authority: String(row.authority ?? ""),
    visibility: String(row.visibility ?? ""),
    version: Number(row.version ?? 1),
    effectiveFrom: String(row.effective_from ?? ""),
    effectiveTo: row.effective_to === null || row.effective_to === undefined ? null : String(row.effective_to),
    status: String(row.status ?? "active"),
    chunks: chunks.length,
    updatedAt: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    chunksDetail: chunks.map((chunk) => ({ chunkId: String(chunk.id), seq: Number(chunk.seq ?? 0), content: String(chunk.content ?? ""), keywords: chunk.keywords === null || chunk.keywords === undefined ? null : String(chunk.keywords) })),
  };
}

export type KnowledgeDraftResult = {
  documentId: string;
  created: boolean;
  version: number;
  chunks: number;
  previous: { version: number; chunks: number } | null;
};

/**
 * 写入一篇政策。改版时**版本号自动 +1**（店长不用记），切片整篇替换 ——
 * 半新半旧的切片比没有切片更危险：客人会拿到一半旧政策的答案。
 */
export async function applyKnowledgeDraftWith(db: ListRunner, input: { tenantId: string; hotelId: string; hotelCode?: string; draft: KnowledgeDraft }): Promise<KnowledgeDraftResult> {
  if (!input?.hotelId || !input?.tenantId || !input?.draft) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);
  const { draft } = input;
  const keywords = draft.keywords.length ? draft.keywords.join(" ") : null;
  const existingId = draft.documentId ?? null;
  const existing = existingId
    ? await db.first<{ id: string; version: number }>("SELECT id, version FROM knowledge_documents WHERE hotel_id = ? AND id = ? LIMIT 1", [input.hotelId, existingId])
    : null;
  if (existingId && !existing) throw new Error(KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND);
  const previousChunks = existing ? await db.first<{ c: number }>("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ?", [input.hotelId, existing.id]) : null;

  const documentId = existing?.id ?? newKnowledgeDocumentId(input.hotelCode);
  const version = draft.version ?? (existing ? Number(existing.version) + 1 : 1);

  await upsertKnowledgeDocumentWith(db, {
    id: documentId,
    tenantId: input.tenantId,
    hotelId: input.hotelId,
    title: draft.title,
    source: draft.source,
    authority: draft.authority,
    visibility: draft.visibility,
    version,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo,
    status: draft.status,
  });
  await replaceKnowledgeChunksWith(db, {
    tenantId: input.tenantId,
    hotelId: input.hotelId,
    documentId,
    chunks: draft.chunks.map((content, seq) => ({ content, seq, keywords: keywords || null })),
  });

  return {
    documentId,
    created: !existing,
    version,
    chunks: draft.chunks.length,
    previous: existing ? { version: Number(existing.version), chunks: Number(previousChunks?.c ?? 0) } : null,
  };
}

/** 停用 / 草稿 / 重新生效：只改状态，不删切片，删了就没法复活。 */
export async function setKnowledgeStatusWith(db: ListRunner, input: { hotelId: string; documentId: string; status: KnowledgeStatus }) {
  if (!input?.hotelId || !input?.documentId) throw new Error(KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);
  if (!isOneOf(input.status, KNOWLEDGE_STATUSES)) throw new Error(KNOWLEDGE_ADMIN_ERRORS.STATUS_INVALID);
  const existing = await db.first<{ id: string; status: string; version: number }>("SELECT id, status, version FROM knowledge_documents WHERE hotel_id = ? AND id = ? LIMIT 1", [input.hotelId, input.documentId]);
  if (!existing) throw new Error(KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND);
  const stamp = new Date().toISOString();
  await db.run("UPDATE knowledge_documents SET status = ?, updated_at = ? WHERE hotel_id = ? AND id = ?", [input.status, stamp, input.hotelId, input.documentId]);
  return { documentId: input.documentId, status: input.status, previousStatus: String(existing.status), version: Number(existing.version) };
}
