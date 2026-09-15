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
console.log("Simulator contract surface check passed.");
