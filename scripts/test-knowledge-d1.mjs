import {
  KNOWLEDGE_DDL,
  KNOWLEDGE_ERRORS,
  answerKnowledgeQuestionWith,
  knowledgeIndex,
  knowledgeTokens,
  replaceKnowledgeChunksWith,
  searchKnowledgeWith,
  upsertKnowledgeDocumentWith,
} from "../lib/knowledge-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * 知识库的核心承诺有三条，这个用例逐条压：
 * ① 中文两字查询（「早餐」「停车」）必须命中 —— 这是 FTS5 trigram 做不到、必须靠二元词的地方；
 * ② 命中必须带出处（标题 + 版本 + 生效期）；
 * ③ 命中不到就说不知道（转人工），不许拿一句沾边的政策糊弄客人。
 */
const TENANT = "tenant-demo";
const HOTEL = "hotel-gz-demo";
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
const runner = d1Runner(db);
const lister = { ...runner, all: async (sql, params) => (await db.prepare(sql).bind(...params).all()).results ?? [] };
const count = async (sql, params = []) => Number((await runner.first(sql, params)).c);

async function seedDocument({ id, title, content, keywords = "", visibility = "guest", authority = "authoritative", version = 1, effectiveFrom = "2026-01-01", effectiveTo = null, status = "active" }) {
  await upsertKnowledgeDocumentWith(runner, { id, tenantId: TENANT, hotelId: HOTEL, title, source: "policy", authority, visibility, version, effectiveFrom, effectiveTo, status });
  await replaceKnowledgeChunksWith(runner, { tenantId: TENANT, hotelId: HOTEL, documentId: id, chunks: [{ content, keywords }] });
}

try {
  for (const statement of KNOWLEDGE_DDL) await db.prepare(statement).run();

  await seedDocument({ id: "kb-breakfast", title: "早餐时间与服务", content: "早餐时间是早上七点到十点，地点在二楼餐厅。", keywords: "早饭 早点 餐厅" });
  await seedDocument({ id: "kb-parking", title: "停车服务", content: "酒店提供停车服务，地下一层为住客专用车位，凭房卡免费停放。", keywords: "车位 停车费" });
  await seedDocument({ id: "kb-payment", title: "支付与押金政策", content: "押金与支付方式以门店当前政策为准，系统核验后展示微信或支付宝付款页面。", keywords: "押金 微信 支付宝 付款" });
  await seedDocument({ id: "kb-checkout", title: "退房与延迟退房", content: "退房时间为次日中午十二点前，如需延迟退房请先联系前台。", keywords: "退房 延迟退房 续住" });
  await seedDocument({ id: "kb-late-fee", title: "延迟退房加收标准（内部）", content: "延迟退房至十四点加收半天房费，十四点之后按全价计算。", keywords: "加收 半天房费", visibility: "staff", authority: "reference" });

  console.log("== 1. 分词：中文切二元词，西文按词");
  check("中文切成二元词", knowledgeTokens("早餐时间").includes("早餐") && knowledgeTokens("早餐时间").includes("餐时"), JSON.stringify(knowledgeTokens("早餐时间")));
  check("单字也保留", knowledgeTokens("停车").every((t) => t.length === 2), JSON.stringify(knowledgeTokens("停车")));
  check("西文与数字按词", knowledgeTokens("iPhone 15 押金").includes("iphone") && knowledgeTokens("iPhone 15 押金").includes("15"));
  check("索引串以空格分隔", knowledgeIndex("早餐时间", "早饭").split(" ").length >= 4);

  console.log("\n== 2. 中文两字查询必须命中（FTS5 trigram 做不到的那一类）");
  for (const [query, expect] of [["早餐", "kb-breakfast"], ["停车", "kb-parking"], ["押金", "kb-payment"], ["退房", "kb-checkout"]]) {
    const hits = await searchKnowledgeWith(lister, { hotelId: HOTEL, query });
    check(`「${query}」命中 ${expect}`, hits[0]?.documentId === expect, JSON.stringify(hits.map((h) => h.documentId)));
  }
  const longQuery = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "早餐几点开始" });
  check("长句查询同样命中", longQuery[0]?.documentId === "kb-breakfast", JSON.stringify(longQuery.map((h) => h.documentId)));
  const keywordQuery = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "停车费多少钱" });
  check("关键词（停车费）也能召回", keywordQuery[0]?.documentId === "kb-parking", JSON.stringify(keywordQuery.map((h) => h.documentId)));

  console.log("\n== 3. 命中必须带出处");
  const answer = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "早餐几点" });
  check("回答取自知识库正文", answer.answer?.includes("七点到十点") === true, String(answer.answer));
  check("带引用：标题 + 版本 + 生效期", answer.citations[0]?.title === "早餐时间与服务" && answer.citations[0]?.version === 1 && answer.citations[0]?.effectiveFrom === "2026-01-01", JSON.stringify(answer.citations));
  check("不转人工（覆盖度足够）", answer.needsHandoff === false && answer.confidence >= 0.34, JSON.stringify({ needs: answer.needsHandoff, confidence: answer.confidence }));

  console.log("\n== 4. 权限：客人看不到内部文档");
  const guestAsk = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "延迟退房加收" });
  check("客人检索不到员工文档", guestAsk.every((hit) => hit.documentId !== "kb-late-fee"), JSON.stringify(guestAsk.map((h) => h.documentId)));
  const staffAsk = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "延迟退房加收", allow: ["guest", "staff"] });
  check("员工检索得到员工文档", staffAsk.some((hit) => hit.documentId === "kb-late-fee"), JSON.stringify(staffAsk.map((h) => h.documentId)));

  console.log("\n== 5. 生效期与状态");
  await seedDocument({ id: "kb-future", title: "未来生效的政策", content: "这是一条尚未生效的政策，用来验证生效期过滤。", effectiveFrom: "2027-01-01" });
  const future = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "尚未生效的政策" });
  check("未生效的文档检索不到", future.every((hit) => hit.documentId !== "kb-future"), JSON.stringify(future.map((h) => h.documentId)));
  await seedDocument({ id: "kb-expired", title: "已过期政策", content: "这是一条已经过期的政策，用来验证失效期过滤。", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
  const expired = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "已经过期的政策" });
  check("已过期的文档检索不到", expired.every((hit) => hit.documentId !== "kb-expired"), JSON.stringify(expired.map((h) => h.documentId)));

  console.log("\n== 6. 改版：旧版归档后不再命中");
  await seedDocument({ id: "kb-parking", title: "停车服务", content: "酒店不提供免费停车，地库按每小时十元收费。", keywords: "车位 停车费", version: 2 });
  const upgraded = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "停车" });
  check("改版后命中新版本", upgraded[0]?.version === 2 && upgraded[0]?.content.includes("每小时十元"), JSON.stringify({ version: upgraded[0]?.version }));
  check("旧切片不残留", (await count("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE hotel_id = ? AND document_id = ?", [HOTEL, "kb-parking"])) === 1);
  check("旧索引行不残留", (await count("SELECT COUNT(*) AS c FROM knowledge_chunks_fts WHERE chunk_id LIKE 'kb-parking-%'")) === 1);

  console.log("\n== 7. 命中不到就说不知道");
  const miss = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "你们有游泳池吗" });
  check("无命中时转人工", miss.needsHandoff === true && miss.answer === null, JSON.stringify({ needs: miss.needsHandoff, answer: miss.answer }));
  const offTopic = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "退房的加收标准是多少钱" });
  check("只沾一点边也不硬答（覆盖度阈值）", offTopic.needsHandoff === true || offTopic.citations.every((c) => c.title !== "延迟退房加收标准（内部）"), JSON.stringify({ needs: offTopic.needsHandoff, citations: offTopic.citations.map((c) => c.title) }));

  console.log("\n== 8. 只读与参数校验");
  const before = await count("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE hotel_id = ?", [HOTEL]);
  await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "早餐" });
  await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "早餐" });
  check("检索不改数据", (await count("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE hotel_id = ?", [HOTEL])) === before);
  let requestError = "";
  try { await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "" }); } catch (error) { requestError = error.message; }
  check("空查询被拒绝", requestError === KNOWLEDGE_ERRORS.REQUEST_INVALID, requestError);
  let visibilityError = "";
  try { await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "早餐", allow: ["manager"] }); } catch (error) { visibilityError = error.message; }
  check("非法可见范围被拒绝", visibilityError === KNOWLEDGE_ERRORS.VISIBILITY_INVALID, visibilityError);
  const empty = await searchKnowledgeWith(lister, { hotelId: HOTEL, query: "！？。" });
  check("纯标点查询返回空而不是报错", Array.isArray(empty) && empty.length === 0);
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nKnowledge base FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nKnowledge base passed on a real D1 binding (miniflare/workerd).");