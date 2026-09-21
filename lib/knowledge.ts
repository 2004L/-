import { getD1 } from "@/db";
import {
  KNOWLEDGE_DDL,
  answerKnowledgeQuestionWith,
  replaceKnowledgeChunksWith,
  searchKnowledgeWith,
  upsertKnowledgeDocumentWith,
  type KnowledgeAnswer,
  type KnowledgeHit,
  type KnowledgeVisibility,
} from "@/lib/knowledge-core";
import { d1ListRunner } from "@/lib/folio";
import {
  applyKnowledgeDraftWith,
  getKnowledgeDocumentWith,
  listKnowledgeDocumentsWith,
  setKnowledgeStatusWith,
  type KnowledgeDraft,
  type KnowledgeStatus,
} from "@/lib/knowledge-admin-core";

export { KNOWLEDGE_ERRORS, KNOWLEDGE_MIN_COVERAGE } from "@/lib/knowledge-core";
export type { KnowledgeAnswer, KnowledgeHit };

/** D1 适配层：业务规则都在 lib/knowledge-core.ts，集成测试跑的是同一份逻辑。 */
export async function ensureKnowledgeSchema() {
  const db = getD1();
  await db.batch(KNOWLEDGE_DDL.map((sql) => db.prepare(sql)));
}

export async function searchKnowledge(input: { hotelId: string; query: string; allow?: KnowledgeVisibility[]; limit?: number }): Promise<KnowledgeHit[]> {
  await ensureKnowledgeSchema();
  return searchKnowledgeWith(d1ListRunner(), input);
}

/** 门店政策问答：命中带出处，命中不到由调用方转人工。 */
export async function askKnowledge(input: { hotelId: string; query: string; allow?: KnowledgeVisibility[] }): Promise<KnowledgeAnswer> {
  await ensureKnowledgeSchema();
  return answerKnowledgeQuestionWith(d1ListRunner(), input);
}

export async function upsertKnowledgeDocument(input: Parameters<typeof upsertKnowledgeDocumentWith>[1]) {
  await ensureKnowledgeSchema();
  const db = getD1();
  const result = await upsertKnowledgeDocumentWith({
    run: async (sql, params) => ({ changes: Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0) }),
    first: (sql, params) => db.prepare(sql).bind(...params).first(),
  }, input);
  return result;
}

export async function replaceKnowledgeChunks(input: Parameters<typeof replaceKnowledgeChunksWith>[1]) {
  await ensureKnowledgeSchema();
  const db = getD1();
  return replaceKnowledgeChunksWith({
    run: async (sql, params) => ({ changes: Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0) }),
    first: (sql, params) => db.prepare(sql).bind(...params).first(),
  }, input);
}

/** 后台录入面：列表 / 详情 / 落库 / 停用，全部先过 knowledge-admin-core 的校验。 */
export async function listKnowledgeDocuments(hotelId: string) {
  await ensureKnowledgeSchema();
  return listKnowledgeDocumentsWith(d1ListRunner(), { hotelId });
}

export async function getKnowledgeDocument(hotelId: string, documentId: string) {
  await ensureKnowledgeSchema();
  return getKnowledgeDocumentWith(d1ListRunner(), { hotelId, documentId });
}

export async function saveKnowledgeDraft(input: { tenantId: string; hotelId: string; hotelCode?: string; draft: KnowledgeDraft }) {
  await ensureKnowledgeSchema();
  return applyKnowledgeDraftWith(d1ListRunner(), input);
}

export async function setKnowledgeStatus(input: { hotelId: string; documentId: string; status: KnowledgeStatus }) {
  await ensureKnowledgeSchema();
  return setKnowledgeStatusWith(d1ListRunner(), input);
}

/** 四个既有话题到检索词的映射：保持老入口可用，同时把答案交给知识库。 */
export const POLICY_TOPIC_QUERIES: Record<string, string> = {
  breakfast: "早餐时间",
  parking: "停车服务",
  payment: "押金 支付方式",
  checkout: "退房时间",
};

export function policyQuery(topic: unknown, fallback?: unknown): string {
  const mapped = POLICY_TOPIC_QUERIES[String(topic ?? "")];
  if (mapped) return mapped;
  const text = String(fallback ?? "").trim();
  return text || "门店政策";
}