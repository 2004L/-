import { readFileSync } from "node:fs";

const files = ["lib/contracts.ts", "app/api/device/reader/route.ts", "app/api/device/encoder/route.ts", "app/api/police/submit/route.ts"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("idempotency") && file.includes("route.ts")) throw new Error(`${file} 未声明幂等键`);
}
console.log("Simulator contract surface check passed.");
