import { readFileSync } from "node:fs";

const files = ["lib/contracts.ts", "lib/tools.ts", "app/api/agent/turn/route.ts", "app/api/device/reader/route.ts", "app/api/device/encoder/route.ts", "app/api/police/submit/route.ts"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("idempotency") && file.includes("route.ts") && !file.includes("app/api/agent/turn")) throw new Error(`${file} 未声明幂等键`);
}
const tools = readFileSync("lib/tools.ts", "utf8");
for (const name of ["pms.search_order", "hotel.policy_answer", "device.reader.read_identity", "device.encoder.issue_keycard", "police.submit_registration"]) {
  if (!tools.includes(name)) throw new Error(`缺少工具契约：${name}`);
}
const demo = readFileSync("app/api/demo/[action]/route.ts", "utf8");
for (const action of ["walk-in-draft", "walk-in-quote", "walk-in-payment", "walk-in-payment-complete"]) {
  if (!demo.includes(`action === "${action}"`)) throw new Error(`缺少现场办理阶段接口：${action}`);
}
for (const guard of ["payment_requires_quote", "PAYMENT_CONFIRMED", "WALK_IN_ORDER_CREATED", "draft.status !== \"AWAITING_PAYMENT\""]) {
  if (!demo.includes(guard)) throw new Error(`缺少支付建单安全门禁：${guard}`);
}
console.log("Simulator contract surface check passed.");
