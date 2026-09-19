import { readFileSync } from "node:fs";
import { createMiniflareD1 } from "./miniflare-d1.mjs";

const read = (file) => readFileSync(file, "utf8");
const agentRoute = read("app/api/agent/turn/route.ts");
const demoRoute = read("app/api/demo/[action]/route.ts");
const control = read("lib/ai-control.ts");
const chainRoute = read("app/api/admin/ai-chain/route.ts");
const page = read("app/page.tsx");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

console.log("== 顾客侧接入 AI 控制面");
check("顾客对话写入控制面", agentRoute.includes("recordGuestAiTurn"));
check("两类兜底路径都会记录", (agentRoute.match(/recordTurn\(/g) ?? []).length >= 3, `count=${(agentRoute.match(/recordTurn\(/g) ?? []).length}`);
check("控制面记录顾客工作流", control.includes("guest-wf-") && control.includes("actor_type") && control.includes("'guest'"));
check("工具回执绑定到业务步骤", demoRoute.includes("completeGuestToolCall") && demoRoute.includes("TOOL_RECEIPTS"));
check("读卡/公安/发卡都有回执映射", ["device.reader.read_identity", "police.submit_registration", "device.encoder.issue_keycard"].every((name) => demoRoute.includes(name)));
check("失败会标记为 FAILED", demoRoute.includes("HANDOFF_REQUIRED: [") && demoRoute.includes('"FAILED"'));

console.log("\n== 管理后台回放");
check("新增管理员决策链接口", chainRoute.includes("getGuestAiChain") && chainRoute.includes("admin_auth_required"));
check("后台有决策链面板", page.includes("AI 决策链回放") && page.includes("/api/admin/ai-chain"));
check("决策链包含五段信息", ["aiChain.intents", "aiChain.plans", "aiChain.toolCalls", "aiChain.policyDecisions", "aiChain.workflow"].every((token) => page.includes(token)));

console.log("\n== 回执绑定 SQL（真实 D1）");
const environment = await createMiniflareD1();
if (!environment) {
  console.error("SKIP  未找到 miniflare，跳过绑定验证");
} else {
  const { mf, db } = environment;
  try {
    const ddl = [
      "CREATE TABLE IF NOT EXISTS ai_workflows (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, terminal_id TEXT, session_id TEXT, conversation_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT, intent TEXT, status TEXT NOT NULL DEFAULT 'active', current_step TEXT, context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS ai_tool_calls (id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, request_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(request_id, tool_call_id))",
    ];
    for (const statement of ddl) await db.prepare(statement).run();
    const stamp = "2026-09-19T10:00:00.000Z";
    await db.prepare("INSERT INTO ai_workflows (id, tenant_id, hotel_id, session_id, actor_type, intent, status, current_step, context_json, created_at, updated_at) VALUES ('guest-wf-1','tenant-demo','hotel-gz-demo','session_demo_1','guest','pms.search_order','active','tool:pms.search_order','{}',?,?)").bind(stamp, stamp).run();
    await db.prepare("INSERT INTO ai_tool_calls (id, workflow_id, tenant_id, hotel_id, request_id, tool_call_id, tool_name, arguments_json, status, created_at) VALUES ('tc-1','guest-wf-1','tenant-demo','hotel-gz-demo','req-1','call-1','pms.search_order','{}','PROPOSED',?)").bind(stamp).run();
    const pending = await db.prepare("SELECT c.id FROM ai_tool_calls c JOIN ai_workflows w ON w.id = c.workflow_id WHERE w.hotel_id = ? AND w.session_id = ? AND w.actor_type = 'guest' AND c.status = 'PROPOSED' AND c.tool_name IN (?) ORDER BY c.created_at DESC LIMIT 1").bind("hotel-gz-demo", "session_demo_1", "pms.search_order").first();
    check("能按会话找到待回执的工具调用", pending?.id === "tc-1", JSON.stringify(pending));
    await db.prepare("UPDATE ai_tool_calls SET status = ?, result_json = ?, completed_at = ? WHERE id = ?").bind("SUCCEEDED", JSON.stringify({ result: { event: "ORDER_MATCHED" } }), stamp, pending.id).run();
    const done = await db.prepare("SELECT status, result_json, completed_at FROM ai_tool_calls WHERE id = 'tc-1'").first();
    check("回执写入状态与结果", done.status === "SUCCEEDED" && Boolean(done.result_json) && Boolean(done.completed_at), JSON.stringify(done));
    const stillPending = await db.prepare("SELECT COUNT(*) AS c FROM ai_tool_calls WHERE status = 'PROPOSED'").first();
    check("绑定后不再有待回执记录", Number(stillPending.c) === 0);
  } finally {
    await mf.dispose();
  }
}

if (failures) {
  console.error(`\nAI chain checks FAILED: ${failures}.`);
  process.exit(1);
}
console.log("\nAI chain checks passed.");
