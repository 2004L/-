import { readFileSync } from "node:fs";
import { answerKnowledgeQuestionWith } from "../lib/knowledge-core.ts";
import { createMiniflareD1, d1Runner } from "./miniflare-d1.mjs";

/**
 * 知识库召回评测。它回答的是「这套检索到底行不行」，而不是「代码有没有报错」——
 * 没有这份评测，改提示词、改切片、改阈值时，没人能判断是变好还是变坏。
 *
 * 语料直接用迁移 0019 里预置的门店政策，所以评测跑的就是上线的那份语料。
 * 两条底线：正例命中率 ≥ 90%；负例**一条都不许答**（宁可转人工，也不能编政策）。
 */
const HOTEL = "hotel-gz-demo";
const MIN_HIT_RATE = 0.9;
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

try {
  // 用迁移文件建库：评测的语料就是上线的那份，不是测试里另写一份。
  const statements = readFileSync("drizzle/0019_knowledge_base.sql", "utf8")
    .split(/;\s*\n/)
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
  const seeded = Number((await runner.first("SELECT COUNT(*) AS c FROM knowledge_documents", [])).c);
  check("迁移预置了语料", seeded >= 5, `documents=${seeded}`);

  const cases = readFileSync("fixtures/knowledge-eval.jsonl", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const positives = cases.filter((item) => item.expect);
  // 负例分两种：**硬负例**（完全无关，一条都不许答）与**边界**（同域但语料没覆盖，
  // 会给出最接近的政策并附出处）。边界必须显式计数打印，不能藏起来当没发生。
  const negatives = cases.filter((item) => !item.expect && !item.boundary);
  const boundaries = cases.filter((item) => !item.expect && item.boundary);
  const wrongAnswers = [];
  const misses = [];

  console.log(`\n== 正例 ${positives.length} 条：必须命中指定文档`);
  let hit = 0;
  for (const item of positives) {
    const answer = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: item.query });
    const top = answer.hits[0]?.documentId ?? null;
    if (answer.needsHandoff) misses.push(`${item.query} → 转人工（期望 ${item.expect}）`);
    else if (top === item.expect) hit += 1;
    else wrongAnswers.push(`${item.query} → ${top}（期望 ${item.expect}）`);
  }
  if (misses.length) console.error("      漏答：" + misses.join(" ｜ "));
  const hitRate = positives.length ? hit / positives.length : 0;
  check(`正例命中率 ≥ ${MIN_HIT_RATE * 100}%（实测 ${hit}/${positives.length} = ${(hitRate * 100).toFixed(1)}%）`, hitRate >= MIN_HIT_RATE, misses.slice(0, 6).join(" ｜ "));
  if (wrongAnswers.length) console.error("      命中错文档：" + wrongAnswers.slice(0, 6).join(" ｜ "));

  console.log(`\n== 负例 ${negatives.length} 条：一条都不许答，必须转人工`);
  let leaked = 0;
  for (const item of negatives) {
    const answer = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: item.query });
    if (!answer.needsHandoff) {
      leaked += 1;
      console.error(`      多答了：「${item.query}」→ ${answer.hits[0]?.documentId}（${answer.answer?.slice(0, 30)}…）`);
    }
  }
  check(`硬负例零误答（实测误答 ${leaked} 条）`, leaked === 0);

  console.log(`\n== 边界 ${boundaries.length} 条：同域但语料未覆盖（不判失败，但必须计数）`);
  let boundaryAnswered = 0;
  for (const item of boundaries) {
    const answer = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: item.query });
    if (!answer.needsHandoff) boundaryAnswered += 1;
    console.log(`      ${answer.needsHandoff ? "转人工" : "作答  "}｜${item.query}｜${item.boundary}`);
  }
  check(`边界条数未失控（${boundaryAnswered}/${boundaries.length} 会作答）`, boundaryAnswered === boundaries.length);

  console.log("\n== 员工文档不外泄");
  const guestStaff = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "延迟退房加收半天房费是多少" });
  check("客人身份永远命中不到员工文档", guestStaff.hits.every((h) => h.documentId !== "kb-gz-late-fee"), JSON.stringify(guestStaff.hits.map((h) => h.documentId)));
  const staff = await answerKnowledgeQuestionWith(lister, { hotelId: HOTEL, query: "延迟退房加收半天房费是多少", allow: ["guest", "staff"] });
  check("员工身份能命中员工文档", staff.hits.some((h) => h.documentId === "kb-gz-late-fee"), JSON.stringify(staff.hits.map((h) => h.documentId)));

  console.log(`\n召回汇总：正例 ${hit}/${positives.length}（${(hitRate * 100).toFixed(1)}%）· 命中错文档 ${wrongAnswers.length} · 漏答 ${misses.length} · 硬负例误答 ${leaked} · 边界 ${boundaries.length} 条（作答 ${boundaryAnswered}）`);
} finally {
  await mf.dispose();
}

if (failures) {
  console.error(`\nKnowledge eval FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nKnowledge eval passed on a real D1 binding (miniflare/workerd).");