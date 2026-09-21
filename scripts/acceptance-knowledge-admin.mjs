/**
 * End-to-end acceptance for the policy-authoring half of the loop: a store manager
 * writes a policy in the console — without SQL — and the guest terminal starts
 * answering with it, then stops when it is retired.
 *
 *   TARGET_BASE_URL=http://127.0.0.1:8787 ADMIN_ACCEPT_PASSWORD=<demo password> \
 *     node scripts/acceptance-knowledge-admin.mjs
 *
 * The run is repeatable: it always ends with the test document retired, so guests
 * never see test content, and a second run edits the same document instead of
 * creating another one.
 */
const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
const password = process.env.ADMIN_ACCEPT_PASSWORD;
if (!base || !password) {
  console.log("SKIP  设置 TARGET_BASE_URL 与 ADMIN_ACCEPT_PASSWORD 后才会执行政策录入验收。");
  process.exit(0);
}

const TEST_TITLE = "洗衣服务（后台录入验收）";
const TEST_QUESTION = "有洗衣服务吗";
const TEST_KEYWORD_QUESTION = "有熨烫服务吗";
const SESSION_ID = process.env.KNOWLEDGE_ACCEPT_SESSION ?? "accept-knowledge-admin";
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

/** wrangler dev 热重载会把在途请求打成 503，并提示重发；这不是业务结果。 */
async function send(url, init) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 503) return response;
    const hint = await response.clone().text();
    if (!hint.includes("restarted mid-request")) return response;
    console.log(`RETRY  本地 dev server 刚重载过（503），按提示重发一次：${url.replace(base, "")}`);
  }
  return fetch(url, init);
}

async function login(username) {
  const response = await send(`${base}/api/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!response.ok) throw new Error(`登录 ${username} 失败：${response.status}`);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`登录 ${username} 未返回会话 Cookie`);
  return cookie;
}

async function call(cookie, toolName, args) {
  const response = await send(`${base}/api/admin/tools/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ tool_name: toolName, arguments: args }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

/** 客人侧：终端查政策走的就是这个入口。 */
async function askGuest(query) {
  const response = await send(`${base}/api/demo/knowledge-search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: SESSION_ID, query }) });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function prepare(session, args, label) {
  const result = await call(session.manager, "admin.prepare_knowledge_document", args);
  if (result.status !== 200) throw new Error(`${label} 生成确认单失败：${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload.result;
}

async function confirm(session, action, label) {
  const result = await call(session.manager, "admin.confirm_pending_action", { action_id: action.action_id, confirmation: "CONFIRM" });
  if (result.status !== 200) throw new Error(`${label} 确认执行失败：${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload.result;
}

try {
  const session = { manager: await login("manager"), frontdesk: await login("frontdesk"), housekeeping: await login("housekeeping") };
  const listed = await call(session.manager, "admin.list_knowledge_documents", {});
  const documents = listed.payload?.result?.documents ?? [];
  check("店长能读到门店政策清单", listed.status === 200 && documents.length >= 5, JSON.stringify(listed.payload).slice(0, 200));
  const existing = documents.find((doc) => doc.title === TEST_TITLE) ?? null;

  console.log("\n== 0. 客人现在问不到这条政策（跑之前必须查不到）");
  const before = await askGuest(TEST_QUESTION);
  check("客人侧入口可达", before.status === 200, `${before.status} ${JSON.stringify(before.payload).slice(0, 160)}`);
  check("录入前客人问「洗衣服务」转人工", before.payload?.needs_handoff === true, JSON.stringify(before.payload?.answer));
  if (existing && existing.status === "active") throw new Error("测试文档处于生效状态，先把它停用再跑这条验收。");

  console.log("\n== 1. 店长在后台录入政策（不写 SQL），先生成确认单");
  const draft = {
    ...(existing ? { document_id: existing.documentId } : {}),
    title: TEST_TITLE,
    source: "faq",
    authority: "authoritative",
    visibility: "guest",
    effective_from: "2026-01-01",
    status: "active",
    chunks: [
      "酒店设有自助洗衣房，位于地下一层，住客凭房卡免费使用。",
      "如需干洗或熨烫服务，请在早上十点前送到前台，当日晚间可取。",
    ],
    keywords: "洗衣 干洗 熨烫 烘衣服",
    reason: "后台政策录入验收",
  };
  const prepared = await prepare(session, draft, "新建政策");
  check("确认单包含版本与切片数", typeof prepared.action_id === "string" && prepared.fields?.some((field) => String(field.label) === "切片"), JSON.stringify(prepared.fields));
  check("确认单标为高风险并要求政策权限", prepared.risk_level === "high" && prepared.required_permission === "admin:manage_knowledge", `${prepared.risk_level}/${prepared.required_permission}`);

  const stillHandoff = await askGuest(TEST_QUESTION);
  check("确认前客人仍然问不到（确认单不会提前生效）", stillHandoff.payload?.needs_handoff === true, JSON.stringify(stillHandoff.payload?.answer));

  console.log("\n== 2. 确认后客人立刻拿到新政策");
  const executed = await confirm(session, prepared, "新建政策");
  const documentId = executed.result?.documentId;
  const version = Number(executed.result?.version ?? 0);
  check("确认执行落库成功", Boolean(documentId) && version >= 1, JSON.stringify(executed.result));
  const afterCreate = await askGuest(TEST_QUESTION);
  check("客人问「有洗衣服务吗」命中新政策", afterCreate.payload?.needs_handoff === false && String(afterCreate.payload?.answer ?? "").includes("洗衣房"), JSON.stringify(afterCreate.payload?.answer));
  check("答案带回出处（标题 + 版本）", (afterCreate.payload?.citations ?? []).some((citation) => citation.title === TEST_TITLE && Number(citation.version) === version), JSON.stringify(afterCreate.payload?.citations));

  console.log("\n== 3. 改版：版本 +1，客人拿到的是新正文");
  const edited = await prepare(session, { ...draft, document_id: documentId, chunks: ["酒店设有自助洗衣房，位于地下一层，住客凭房卡免费使用，开放时间为早上七点到晚上十一点。"] }, "政策改版");
  const executedEdit = await confirm(session, edited, "政策改版");
  check("改版后版本号 +1", Number(executedEdit.result?.version) === version + 1, JSON.stringify(executedEdit.result));
  check("改版报告了旧版本", Number(executedEdit.result?.previous?.version) === version, JSON.stringify(executedEdit.result?.previous));
  const afterEdit = await askGuest(TEST_QUESTION);
  check("客人拿到的是新正文", String(afterEdit.payload?.answer ?? "").includes("晚上十一点"), JSON.stringify(afterEdit.payload?.answer));
  check("旧正文不再出现", !String(afterEdit.payload?.answer ?? "").includes("干洗"), JSON.stringify(afterEdit.payload?.answer));

  const keywordAsk = await askGuest(TEST_KEYWORD_QUESTION);
  check("只写在关键词里的问法也能答（同义说法进索引）", keywordAsk.payload?.needs_handoff === false, JSON.stringify(keywordAsk.payload?.answer));
  const detailWithKeywords = await call(session.manager, "admin.get_knowledge_document", { document_id: documentId });
  check("关键词能读回来（后台编辑时回填）", String(detailWithKeywords.payload?.result?.chunksDetail?.[0]?.keywords ?? "").includes("熨烫"), JSON.stringify(detailWithKeywords.payload?.result?.chunksDetail?.[0]?.keywords));

  console.log("\n== 4. 试问：店长自己先试一次");
  const probe = await call(session.manager, "admin.preview_knowledge_answer", { query: "早餐几点开始", visibility: "guest" });
  check("试问走终端同一条检索路径", probe.status === 200 && String(probe.payload?.result?.answer ?? "").includes("七点到十点"), JSON.stringify(probe.payload?.result).slice(0, 200));
  const probeMiss = await call(session.manager, "admin.preview_knowledge_answer", { query: "你们有游泳池吗", visibility: "guest" });
  check("试问也会如实报告「查不到」", probeMiss.payload?.result?.needs_handoff === true, JSON.stringify(probeMiss.payload?.result?.answer));

  console.log("\n== 5. 停用之后客人问不到（而不是拿旧政策糊弄）");
  const retire = await call(session.manager, "admin.prepare_knowledge_status", { document_id: documentId, status: "retired", reason: "后台政策录入验收收尾" });
  check("停用先生成确认单", retire.status === 200 && retire.payload?.result?.action_type === "knowledge_document_status", JSON.stringify(retire.payload).slice(0, 200));
  await confirm(session, retire.payload.result, "停用政策");
  const afterRetire = await askGuest(TEST_QUESTION);
  check("停用后客人转人工", afterRetire.payload?.needs_handoff === true, JSON.stringify(afterRetire.payload?.answer));
  const detail = await call(session.manager, "admin.get_knowledge_document", { document_id: documentId });
  check("停用不删切片（改回来还能用）", (detail.payload?.result?.chunksDetail ?? []).length === 1, JSON.stringify(detail.payload?.result?.chunks));

  console.log("\n== 6. 权限：改政策是店长/老板的事");
  for (const [role, cookie] of [["前台", session.frontdesk], ["客房", session.housekeeping]]) {
    const denied = await call(cookie, "admin.list_knowledge_documents", {});
    check(`${role}不能读政策录入面`, denied.status === 403 && denied.payload?.error === "admin_permission_denied", `${denied.status} ${JSON.stringify(denied.payload)}`);
    const deniedWrite = await call(cookie, "admin.prepare_knowledge_status", { document_id: documentId, status: "active", reason: "越权尝试" });
    check(`${role}不能改政策状态`, deniedWrite.status === 403, `${deniedWrite.status} ${JSON.stringify(deniedWrite.payload)}`);
  }
  const anonymous = await call(null, "admin.list_knowledge_documents", {});
  check("未登录被 401 拒绝", anonymous.status === 401 && anonymous.payload?.error === "admin_auth_required", JSON.stringify(anonymous.payload));

  console.log("\n== 7. 审计：谁改了哪份文档的哪一版");
  const audit = await call(session.manager, "admin.get_audit_records", { limit: 50, event_type: "ADMIN_KNOWLEDGE_DOCUMENT_SAVED" });
  const savedEvents = (audit.payload?.result?.events ?? []).filter((event) => String(event.detail ?? "").includes(TEST_TITLE));
  check("新建与改版各留一条审计", savedEvents.length >= 2, JSON.stringify(savedEvents.map((event) => event.detail)));
  const statusAudit = await call(session.manager, "admin.get_audit_records", { limit: 50, event_type: "ADMIN_KNOWLEDGE_STATUS_CHANGED" });
  check("停用也留审计", (statusAudit.payload?.result?.events ?? []).some((event) => String(event.detail ?? "").includes(documentId)), JSON.stringify(statusAudit.payload?.result?.events?.slice(0, 2)));

  console.log(`\n测试文档：${documentId}（已停用，客人问不到）。要彻底清掉它，删 knowledge_documents / knowledge_chunks / knowledge_chunks_fts 里这个 id 即可。`);
} catch (error) {
  failures += 1;
  console.error(`FAIL  验收中断 :: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures) {
  console.error(`\nKnowledge admin acceptance FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log(`\nKnowledge admin acceptance passed over real HTTP (${base}).`);
