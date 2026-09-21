/**
 * End-to-end acceptance for the housekeeping half of the loop: a guest checks out
 * and the room becomes VACANT_DIRTY, and only the cleaning side can put it back
 * on sale. Runs against a live server, so CI stays green without one.
 *
 *   TARGET_BASE_URL=http://127.0.0.1:8787 ADMIN_ACCEPT_PASSWORD=<demo password> \
 *     node scripts/acceptance-housekeeping.mjs
 *
 * ADMIN_ACCEPT_ROOM picks the room to exercise; it must be a dirty room for the
 * transition half to run (walk a checkout first, or point it at a room that is
 * already dirty). The permission and authentication checks always run.
 */
const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
const password = process.env.ADMIN_ACCEPT_PASSWORD;
const room = (process.env.ADMIN_ACCEPT_ROOM ?? "1208").trim();
if (!base || !password) {
  console.log("SKIP  设置 TARGET_BASE_URL 与 ADMIN_ACCEPT_PASSWORD 后才会执行客房清洁验收。");
  process.exit(0);
}

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

/**
 * wrangler dev 在热重载时会把正在处理的请求打成 503，并明确要求重发一次
 * （"Your worker restarted mid-request. Please try sending the request again."）。
 * 这不是业务结果，所以按它的提示重试一次；持续 503 仍然会失败并报出来。
 */
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
  const response = await send(`${base}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) throw new Error(`登录 ${username} 失败：口令不对，或这个库还没有演示管理员账号（启动服务时要带上 ADMIN_DEMO_PASSWORD，账号只在首次启动时创建）。`);
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

try {
  console.log(`== 0. 目标房间 ${room}`);
  const anonymous = await call(null, "admin.get_room_status", { room_number: room });
  check("未登录调用被 401 拒绝", anonymous.status === 401 && anonymous.payload?.error === "admin_auth_required", JSON.stringify(anonymous.payload));

  const housekeeping = await login("housekeeping");
  const frontdesk = await login("frontdesk");

  console.log("\n== 1. 前台不能把脏房改成可售");
  const denied = await call(frontdesk, "admin.mark_room_clean", { room_number: room });
  check("前台被拒绝", denied.status === 403 && denied.payload?.error === "admin_permission_denied", JSON.stringify(denied.payload));

  console.log("\n== 2. 客房标记打扫完成");
  const before = await call(housekeeping, "admin.get_room_status", { room_number: room });
  const beforeStatus = before.payload?.result?.status;
  check("客房可以查询房态", before.status === 200 && Boolean(beforeStatus), JSON.stringify(before.payload));
  if (beforeStatus === "vacant-dirty") {
    const cleaned = await call(housekeeping, "admin.mark_room_clean", { room_number: room });
    check("待清洁房被改为可售", cleaned.status === 200 && cleaned.payload?.result?.room_status === 0 && cleaned.payload?.result?.idempotent === false, JSON.stringify(cleaned.payload));
    const after = await call(housekeeping, "admin.get_room_status", { room_number: room });
    check("房态确实变成可售", after.payload?.result?.status === "vacant-clean", JSON.stringify(after.payload?.result));
    const replay = await call(housekeeping, "admin.mark_room_clean", { room_number: room });
    check("重复确认幂等", replay.status === 200 && replay.payload?.result?.idempotent === true, JSON.stringify(replay.payload));
    const audit = await call(frontdesk, "admin.get_audit_records", { limit: 50, event_type: "ADMIN_ROOM_MARKED_CLEAN" });
    check("留下管理员审计", audit.status === 200 && (audit.payload?.result?.events ?? []).some((event) => String(event.detail ?? "").includes(room)), JSON.stringify(audit.payload?.result?.events?.length));
  } else {
    console.log(`SKIP  房间 ${room} 当前是 ${beforeStatus ?? "未知"}，不是待清洁房；走一遍退房流程后重跑可覆盖房态转移。`);
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL  验收中断 :: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures) {
  console.error(`\nHousekeeping acceptance FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log(`\nHousekeeping acceptance passed over real HTTP (${base}).`);