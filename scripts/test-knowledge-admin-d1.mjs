import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_ADMIN_ERRORS,
  applyKnowledgeDraftWith,
  getKnowledgeDocumentWith,
  listKnowledgeDocumentsWith,
  newKnowledgeDocumentId,
  normalizeKnowledgeDraft,
  setKnowledgeStatusWith,
  splitKnowledgeChunks,
} from "../lib/knowledge-admin-core.ts";
import { KNOWLEDGE_MIN_COVERAGE, answerKnowledgeQuestionWith, searchKnowledgeWith } from "../lib/knowledge-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * 政策录入面的验收：店长在后台能改的东西，必须真的能改变客人拿到的答案。
 *
 * 这个用例刻意从**迁移文件**建库（而不是自己造语料），因为它要证明的是
 * 「后台录进去的政策，和预置的那份语料，走的是同一条路」。
 * 同时压两条底线：校验必须挡住写坏的文档；停用必须真的让客人查不到。
 */
const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

function rejects(name, input, expectedCode) {
  try {
    normalizeKnowledgeDraft(input);
    check(name, false, "没有抛出异常");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.startsWith(expectedCode), `${message}（期望 ${expectedCode}）`);
  }
}

const environment = await createMiniflareD1();
if (!environment) {
  console.error("SKIP  未找到 miniflare，无法验证真实 D1 绑定");
  process.exit(0);
}
const { mf, db } = environment;
const runner = d1Runner(db);
const lister = { ...runner, all: async (sql, params) => (await db.prepare(sql).bind(...params).all()).results ?? [] };
const count = async (sql, params = []) => Number((await runner.first(sql, params)).c);

const baseDraft = {
  title: "加床与婴儿床",
  source: "policy",
  authority: "authoritative",
  visibility: "staff",
  effectiveFrom: "2026-09-20",
  status: "active",
  chunks: ["加床服务需在前台提前一天预约，每间房最多加一张床。", "婴儿床免费提供，数量有限，先到先得。"],
};

try {
  // 用迁移文件建库：后台录进去的政策，必须和预置语料是同一种形状。
  const statements = readFileSync("drizzle/0019_knowledge_base.sql", "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();

  console.log("== 1. 列表与详情");
  const listed = await listKnowledgeDocumentsWith(lister, { hotelId: HOTEL });
  check("迁移预置的政策都在列表里", listed.length === 5, JSON.stringify(listed.map((item) => item.documentId)));
  check("列表带切片数", listed.every((item) => item.chunks >= 1), JSON.stringify(listed.map((item) => [item.documentId, item.chunks])));
  check("员工文档也在列表里（店长要能维护它）", listed.some((item) => item.documentId === "kb-gz-late-fee" && item.visibility === "staff"));
  const breakfast = await getKnowledgeDocumentWith(lister, { hotelId: HOTEL, documentId: "kb-gz-breakfast" });
  check("详情返回切片正文", breakfast.chunksDetail.length === 1 && breakfast.chunksDetail[0].content.includes("七点到十点"), JSON.stringify(breakfast.chunksDetail));
  check("详情带版本与生效期", breakfast.version === 1 && breakfast.effectiveFrom.startsWith("2026-01-01"), `${breakfast.version}/${breakfast.effectiveFrom}`);

  console.log("\n== 2. 校验：写不坏的文档，也写不进坏文档");
  rejects("空标题被拒绝", { ...baseDraft, title: "  " }, KNOWLEDGE_ADMIN_ERRORS.TITLE_INVALID);
  rejects("超长标题被拒绝", { ...baseDraft, title: "政".repeat(81) }, KNOWLEDGE_ADMIN_ERRORS.TITLE_INVALID);
  rejects("非法来源被拒绝", { ...baseDraft, source: "微博" }, KNOWLEDGE_ADMIN_ERRORS.SOURCE_INVALID);
  rejects("非法权威度被拒绝", { ...baseDraft, authority: "official" }, KNOWLEDGE_ADMIN_ERRORS.AUTHORITY_INVALID);
  rejects("非法可见范围被拒绝", { ...baseDraft, visibility: "everyone" }, KNOWLEDGE_ADMIN_ERRORS.VISIBILITY_INVALID);
  rejects("非法状态被拒绝", { ...baseDraft, status: "deleted" }, KNOWLEDGE_ADMIN_ERRORS.STATUS_INVALID);
  rejects("没有切片被拒绝", { ...baseDraft, chunks: [] }, KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID);
  rejects("切片超过 20 条被拒绝", { ...baseDraft, chunks: Array.from({ length: 21 }, (_, index) => `第${index}条政策要点`) }, KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID);
  rejects("单条切片超长被拒绝", { ...baseDraft, chunks: ["长".repeat(501)] }, KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID);
  rejects("切片总量超限被拒绝", { ...baseDraft, chunks: Array.from({ length: 10 }, () => "长".repeat(450)) }, KNOWLEDGE_ADMIN_ERRORS.CHUNKS_INVALID);
  rejects("非法日期被拒绝", { ...baseDraft, effectiveFrom: "2026-13-40" }, KNOWLEDGE_ADMIN_ERRORS.EFFECTIVE_RANGE_INVALID);
  rejects("失效日早于生效日被拒绝", { ...baseDraft, effectiveFrom: "2026-09-20", effectiveTo: "2026-09-19" }, KNOWLEDGE_ADMIN_ERRORS.EFFECTIVE_RANGE_INVALID);
  rejects("非法版本号被拒绝", { ...baseDraft, version: 0 }, KNOWLEDGE_ADMIN_ERRORS.REQUEST_INVALID);
  rejects("关键词超过 30 个被拒绝", { ...baseDraft, keywords: Array.from({ length: 31 }, (_, index) => `说法${index}`).join(" ") }, KNOWLEDGE_ADMIN_ERRORS.KEYWORDS_INVALID);
  rejects("单个关键词过长被拒绝", { ...baseDraft, keywords: "很长很长的同义说法".repeat(3) }, KNOWLEDGE_ADMIN_ERRORS.KEYWORDS_INVALID);
  rejects("关键词总量超限被拒绝", { ...baseDraft, keywords: Array.from({ length: 20 }, (_, index) => `同义说法${index}${"补".repeat(10)}`).join(" ") }, KNOWLEDGE_ADMIN_ERRORS.KEYWORDS_INVALID);
  check("关键词去重（空格/逗号/顿号都算分隔）", JSON.stringify(normalizeKnowledgeDraft({ ...baseDraft, keywords: "车库, 车库、停车费 地库" }).keywords) === JSON.stringify(["车库", "停车费", "地库"]), JSON.stringify(normalizeKnowledgeDraft({ ...baseDraft, keywords: "车库, 车库、停车费 地库" }).keywords));

  const normalized = normalizeKnowledgeDraft({ ...baseDraft, effectiveFrom: "2026-09-20", effectiveTo: "2026-09-30" });
  check("生效日归一到当天零点", normalized.effectiveFrom === "2026-09-20T00:00:00.000Z", normalized.effectiveFrom);
  check("失效日归一到当天最后一毫秒（生效至 9-30 就该管满 9-30）", normalized.effectiveTo === "2026-09-30T23:59:59.999Z", String(normalized.effectiveTo));
  check("空行不算切片", splitKnowledgeChunks("第一条\n\n  \n第二条").length === 2, JSON.stringify(splitKnowledgeChunks("第一条\n\n  \n第二条")));
  check("切片也接受数组", normalizeKnowledgeDraft({ ...baseDraft, chunks: ["甲", "乙"] }).chunks.length === 2);

  console.log("\n== 3. 新建：录进去就立刻可检索（按可见范围）");
  const created = await applyKnowledgeDraftWith(lister, { tenantId: TENANT, hotelId: HOTEL, hotelCode: "GZ-HAOS-001", draft: normalized });
  check("新建返回 created 与版本 1", created.created === true && created.version === 1 && created.previous === null, JSON.stringify(created));
  check("新文档 id 走 kb-<门店>-<随机> 形状（与迁移里的 kb-gz-* 一致）", /^kb-gz-[a-z0-9]{6}$/.test(created.documentId), created.documentId);
  const afterCreate = await listKnowledgeDocumentsWith(lister, { hotelId: HOTEL });
  check("列表里能看到新建的文档", afterCreate.some((item) => item.documentId === created.documentId && item.chunks === 2), JSON.stringify(afterCreate.map((item) => item.documentId)));
  const guestSearch = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "加床要预约吗" });
  check("员工文档对客人不可见（录进去也不泄露）", guestSearch.needsHandoff === true, JSON.stringify(guestSearch.hits.map((hit) => hit.documentId)));
  const staffSearch = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "加床要预约吗", allow: ["guest", "staff"] });
  check("员工身份能检索到新建文档", staffSearch.needsHandoff === false && staffSearch.hits[0]?.documentId === created.documentId, JSON.stringify(staffSearch.hits.map((hit) => hit.documentId)));

  console.log("\n== 4. 改版：版本自动 +1，客人立刻拿到新答案，旧切片不留残渣");
  const edited = await applyKnowledgeDraftWith(lister, {
    tenantId: TENANT,
    hotelId: HOTEL,
    hotelCode: "GZ-HAOS-001",
    draft: normalizeKnowledgeDraft({ ...baseDraft, documentId: created.documentId, visibility: "guest", chunks: ["加床服务需在前台提前半天预约，每间房最多加一张床。"] }),
  });
  check("改版自动升到 v2 且带上旧版本信息", edited.version === 2 && edited.created === false && edited.previous?.version === 1, JSON.stringify(edited));
  check("改版后切片数变成 1", edited.chunks === 1 && Number(await count("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE document_id = ?", [created.documentId])) === 1);
  check("FTS 索引没有残留旧切片", Number(await count("SELECT COUNT(*) AS c FROM knowledge_chunks_fts WHERE chunk_id LIKE ?", [`${created.documentId}%`])) === 1);
  const answered = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "加床要预约吗" });
  check("客人现在能命中，且答案是新版本正文", answered.needsHandoff === false && answered.answer?.includes("半天") === true, String(answered.answer));
  const stale = await db.prepare("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE document_id = ? AND content LIKE ?").bind(created.documentId, "%一天预约%").first();
  check("旧正文已从切片里消失", Number(stale.c) === 0, JSON.stringify(stale));

  console.log("\n== 5. 停用 / 重新生效");
  const retired = await setKnowledgeStatusWith(lister, { hotelId: HOTEL, documentId: created.documentId, status: "retired" });
  check("停用返回原状态", retired.previousStatus === "active" && retired.status === "retired", JSON.stringify(retired));
  const afterRetire = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "加床要预约吗" });
  check("停用后客人问不到（转人工）", afterRetire.needsHandoff === true, JSON.stringify(afterRetire.hits.map((hit) => hit.documentId)));
  check("停用后切片仍在（改回来还能用）", Number(await count("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE document_id = ?", [created.documentId])) === 1);
  await setKnowledgeStatusWith(lister, { hotelId: HOTEL, documentId: created.documentId, status: "active" });
  const afterRevive = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "加床要预约吗" });
  check("重新生效后客人又能查到", afterRevive.needsHandoff === false && afterRevive.answer?.includes("半天") === true, String(afterRevive.answer));

  console.log("\n== 6. 只改自己这家店");
  const otherHotel = await listKnowledgeDocumentsWith(lister, { hotelId: "hotel-other-demo" });
  check("别的门店看不到这家店的政策", otherHotel.length === 0, JSON.stringify(otherHotel));
  let notFound = "";
  try { await getKnowledgeDocumentWith(lister, { hotelId: "hotel-other-demo", documentId: "kb-gz-breakfast" }); } catch (error) { notFound = error instanceof Error ? error.message : ""; }
  check("跨门店读文档被拒绝", notFound === KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND, notFound);
  let unknownEdit = "";
  try { await applyKnowledgeDraftWith(lister, { tenantId: TENANT, hotelId: HOTEL, draft: normalizeKnowledgeDraft({ ...baseDraft, documentId: "kb-not-exists" }) }); } catch (error) { unknownEdit = error instanceof Error ? error.message : ""; }
  check("改一篇不存在的文档被拒绝（不会悄悄新建）", unknownEdit === KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND, unknownEdit);
  let unknownStatus = "";
  try { await setKnowledgeStatusWith(lister, { hotelId: HOTEL, documentId: "kb-not-exists", status: "retired" }); } catch (error) { unknownStatus = error instanceof Error ? error.message : ""; }
  check("改不存在的文档状态被拒绝", unknownStatus === KNOWLEDGE_ADMIN_ERRORS.DOCUMENT_NOT_FOUND, unknownStatus);

  console.log("\n== 7. 预置政策仍然答得出来（改完之后没把老语料改坏）");
  const breakfastAgain = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "早餐几点开始" });
  check("预置早餐政策照常命中", breakfastAgain.needsHandoff === false && breakfastAgain.answer?.includes("七点到十点") === true, String(breakfastAgain.answer));
  const parkingAgain = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "地库怎么走" });
  check("预置停车政策照常命中（含地库问法）", parkingAgain[0]?.documentId === "kb-gz-parking", JSON.stringify(parkingAgain.map((hit) => hit.documentId)));

  console.log("\n== 8. 关键词（同义说法）：正文里没有的说法，靠它召回");
  const keywordChunks = ["酒店提供停车服务，地下一层为住客专用车位，凭房卡免费停放。"];
  const keyworded = await applyKnowledgeDraftWith(lister, { tenantId: TENANT, hotelId: HOTEL, hotelCode: "GZ-HAOS-001", draft: normalizeKnowledgeDraft({ ...baseDraft, title: "停车服务（关键词验收）", visibility: "guest", chunks: keywordChunks, keywords: "车位 停车费 车库 地库" }) });
  const bare = await applyKnowledgeDraftWith(lister, { tenantId: TENANT, hotelId: HOTEL, hotelCode: "GZ-HAOS-001", draft: normalizeKnowledgeDraft({ ...baseDraft, title: "停车服务（无关键词对照）", visibility: "guest", chunks: keywordChunks }) });
  const keywordQuery = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "车库在哪里" });
  check("只写在关键词里的说法也能命中", keywordQuery.needsHandoff === false && keywordQuery.hits[0]?.documentId === keyworded.documentId, JSON.stringify(keywordQuery.hits.map((hit) => [hit.documentId, hit.coverage, hit.pairMatched])));
  const bareHit = keywordQuery.hits.find((hit) => hit.documentId === bare.documentId);
  check("同一段正文不给关键词就答不出来（证明上一条靠的是关键词）", Boolean(bareHit) && bareHit.pairMatched === false && bareHit.coverage < KNOWLEDGE_MIN_COVERAGE, JSON.stringify(bareHit));
  const keywordedDetail = await getKnowledgeDocumentWith(lister, { hotelId: HOTEL, documentId: keyworded.documentId });
  check("关键词能读回来（后台编辑时回填）", keywordedDetail.chunksDetail[0].keywords === "车位 停车费 车库 地库", String(keywordedDetail.chunksDetail[0].keywords));
  const reSaved = await applyKnowledgeDraftWith(lister, { tenantId: TENANT, hotelId: HOTEL, hotelCode: "GZ-HAOS-001", draft: normalizeKnowledgeDraft({ ...baseDraft, documentId: keyworded.documentId, title: "停车服务（关键词验收）", visibility: "guest", chunks: keywordChunks, keywords: "车库" }) });
  const afterShrink = await getKnowledgeDocumentWith(lister, { hotelId: HOTEL, documentId: reSaved.documentId });
  check("关键词是整篇替换，不是累加", afterShrink.chunksDetail[0].keywords === "车库", String(afterShrink.chunksDetail[0].keywords));
  check("关键词不写就是空（不回退成旧值）", (await getKnowledgeDocumentWith(lister, { hotelId: HOTEL, documentId: bare.documentId })).chunksDetail[0].keywords === null);

  console.log("\n== 9. id 生成器");
  const ids = new Set(Array.from({ length: 50 }, () => newKnowledgeDocumentId("GZ-HAOS-001")));
  check("id 不重复", ids.size === 50, String(ids.size));
  check("id 全是合法字符", [...ids].every((id) => /^kb-[a-z0-9]+-[a-z0-9]{6}$/.test(id)), JSON.stringify([...ids].slice(0, 3)));
  check("缺门店编码时回落到 kb-hotel-", newKnowledgeDocumentId("").startsWith("kb-hotel-"), newKnowledgeDocumentId(""));
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nKnowledge admin FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nKnowledge admin passed on a real D1 binding (miniflare/workerd).");
