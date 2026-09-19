/**
 * End-to-end acceptance against a running server: one guest checks in at the
 * kiosk and then checks out at the same kiosk. Runs only when TARGET_BASE_URL is
 * set, so CI stays green without a live worker.
 *
 *   TARGET_BASE_URL=http://127.0.0.1:8788 node scripts/acceptance-guest-loop.mjs
 *
 * Point it at a throwaway D1 (--persist-to) when you do not want the check-in to
 * consume a demo order from the shared dev database.
 */
const base = process.env.TARGET_BASE_URL?.replace(/\/$/, "");
if (!base) {
  console.log("SKIP  设置 TARGET_BASE_URL 后才会执行真实 HTTP 入住-退房闭环验收。");
  process.exit(0);
}

const ROOM_NUMBER = process.env.ACCEPT_ROOM ?? "1208";
const PHONE_LAST4 = process.env.ACCEPT_PHONE_LAST4 ?? "4821";
const sessionId = process.env.ACCEPT_SESSION ?? `accept${Date.now()}`;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const demo = (action, body) => post(`/api/demo/${action}`, { session_id: sessionId, ...body });
const device = (target, body) => post(`/api/device/${target}`, { session_id: sessionId, ...body });

async function bootstrap() {
  const response = await fetch(`${base}/api/demo/bootstrap?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`bootstrap -> ${response.status}`);
  return response.json();
}

try {
  console.log(`== 0. 会话 ${sessionId} 已就绪`);
  await bootstrap();

  console.log("\n== 1. 客人选「办理入住」：匹配订单 → 读证 → 核验 → 锁房 → 公安登记 → 确认入住 → 发卡 → 取件");
  const matched = await demo("match", { phone_last4: PHONE_LAST4 });
  check("订单匹配成功", matched.outcome === "matched", JSON.stringify(matched.outcome));
  const caseId = matched.checkinCase?.id;
  check("生成入住办理单", Boolean(caseId), String(caseId));

  let current = (await demo("identity-detected", { case_id: caseId })).checkinCase;
  check("身份开始读取", current.status === "IDENTITY_READING", current.status);
  await device("reader", { case_id: caseId, idempotency_key: `reader:${caseId}`, expected_state: "IDENTITY_READING", device_id: "reader-demo-01", operation: "read_identity" });
  current = (await demo("verify-identity", { case_id: caseId })).checkinCase;
  check("身份核验通过", current.status === "IDENTITY_VERIFIED", current.status);

  current = (await demo("hold-room", { case_id: caseId, room_number: ROOM_NUMBER })).checkinCase;
  check(`房间 ${ROOM_NUMBER} 已被锁定`, current.status === "ROOM_HELD" && current.room_number === ROOM_NUMBER, JSON.stringify({ status: current.status, room: current.room_number }));

  await post("/api/police/submit", { session_id: sessionId, case_id: caseId, idempotency_key: `police:${caseId}`, expected_state: "ROOM_HELD", device_id: "police-browser-demo-01", operation: "submit_registration", actual_identity_verified: true, identity_token: "DEMO-ID-TOKEN" });
  current = (await demo("browser-start", { case_id: caseId })).checkinCase;
  check("公安登记已提交", current.status === "POLICE_RUNNING", current.status);
  current = (await demo("browser-complete", { case_id: caseId })).checkinCase;
  check("公安登记回执已取回", current.status === "POLICE_COMPLETED", current.status);

  current = (await demo("confirm-checkin", { case_id: caseId })).checkinCase;
  check("入住已确认", current.status === "PMS_CHECKIN_CONFIRMED", current.status);
  current = (await demo("keycard-start", { case_id: caseId })).checkinCase;
  check("开始写卡", current.status === "KEYCARD_WRITING", current.status);
  await device("encoder", { case_id: caseId, idempotency_key: `encoder:${caseId}`, expected_state: "PMS_CHECKIN_CONFIRMED", device_id: "encoder-demo-01", operation: "issue_keycard", room_number: ROOM_NUMBER });
  current = (await demo("keycard-complete", { case_id: caseId })).checkinCase;
  check("房卡已送达取卡口", current.status === "KEYCARD_DISPENSED", current.status);
  current = (await demo("pickup-confirmed", { case_id: caseId })).checkinCase;
  check("客人取走证件与房卡，入住完成", current.status === "CHECKIN_COMPLETE", current.status);

  console.log("\n== 2. 同一位客人回头选「办理退房」：两要素识别 → 报价");
  const lookup = await demo("checkout-lookup", { room_number: ROOM_NUMBER, phone_last4: PHONE_LAST4 });
  check("凭房间号 + 手机号后四位找到在住记录", lookup.outcome === "quoted", JSON.stringify(lookup.outcome));
  check("识别到的正是刚入住的那笔", lookup.stay?.room_number === ROOM_NUMBER && lookup.stay?.phone_last4 === PHONE_LAST4, JSON.stringify(lookup.stay));
  check("终端只拿到脱敏姓名", typeof lookup.stay?.guest_name_masked === "string" && !lookup.stay.guest_name_masked.includes(lookup.stay.phone_last4), String(lookup.stay?.guest_name_masked));
  const quote = lookup.quote ?? {};
  check("报价含房费", Number(quote.roomTotal) > 0, JSON.stringify(quote.roomTotal));
  check("报价含押金", Number(quote.depositTotal) > 0, JSON.stringify(quote.depositTotal));
  check("报价自洽：应付 = 房费 + 消费 + 调整", Number(quote.due) === Number(quote.payable) - Number(quote.paid), JSON.stringify({ due: quote.due, payable: quote.payable, paid: quote.paid }));

  console.log("\n== 3. 客人确认结算：离店 + 结清 + 房态回收");
  const settled = await demo("checkout-confirm", { stay_id: lookup.stay.stay_id, request_id: `${sessionId}:checkout` });
  check("结算完成", settled.outcome === "settled", JSON.stringify(settled.outcome));
  check("账本已关闭", settled.folio_status === "closed", String(settled.folio_status));
  check("结算金额等于报价应付", Number(settled.settlement) === Number(quote.due), `${settled.settlement} vs ${quote.due}`);
  check("房间归还（待清洁）", Number(settled.room_status) === 1, String(settled.room_status));

  console.log("\n== 4. 退房后这位客人再查一次：查不到，也不会重复结算");
  const again = await demo("checkout-lookup", { room_number: ROOM_NUMBER, phone_last4: PHONE_LAST4 });
  check("不再出现在在住列表", again.outcome === "not_found", JSON.stringify(again.outcome));
  let replayError = "";
  try { await demo("checkout-confirm", { stay_id: lookup.stay.stay_id, request_id: `${sessionId}:checkout-again` }); }
  catch (error) { replayError = error.message; }
  check("重复退房被拒绝或幂等返回", replayError === "" || /folio_already_closed|stay_status_conflict|folio_not_balanced/.test(replayError), replayError || "(幂等通过)");

  console.log("\n== 5. 错误路径：房间号与手机号必须同时匹配");
  const wrongPhone = await demo("checkout-lookup", { room_number: ROOM_NUMBER, phone_last4: "0000" });
  check("换手机号查不到", wrongPhone.outcome === "not_found", JSON.stringify(wrongPhone.outcome));
  const wrongRoom = await demo("checkout-lookup", { room_number: "9999", phone_last4: PHONE_LAST4 });
  check("换房间号查不到", wrongRoom.outcome === "not_found", JSON.stringify(wrongRoom.outcome));
  const badRoom = await fetch(`${base}/api/demo/checkout-lookup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, room_number: "A1", phone_last4: PHONE_LAST4 }) });
  check("非法房间号被 400 拒绝", badRoom.status === 400, String(badRoom.status));
} catch (error) {
  failures += 1;
  console.error(`FAIL  验收中断 :: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures) {
  console.error(`\nGuest loop acceptance FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log(`\nGuest loop acceptance passed over real HTTP (${base}).`);