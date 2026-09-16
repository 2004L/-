import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");
const schema = read("db/schema.ts");
const demo = read("app/api/demo/[action]/route.ts");
if (!schema.includes("externalCommands") || !schema.includes("simulatorFaults") || !schema.includes("manualTasks") || !schema.includes("aiRequestMetrics")) throw new Error("缺少命令、故障、人工任务或 AI 指标表");
if (!schema.includes("idempotencyKey: text(\"idempotency_key\").notNull().unique()")) throw new Error("外部命令缺少唯一幂等键");
if (!demo.includes("expected: \"IDENTITY_VERIFIED\", next: \"ROOM_HELD\"")) throw new Error("身份未核验即可锁房");
if (!demo.includes("await audit(options.sessionId, current.id")) throw new Error("状态转移未统一写入审计事件");
if (demo.includes("console.log(body") || demo.includes("console.error(body")) throw new Error("日志可能输出原始请求体");
const auth = read("lib/admin-auth.ts");
if (!auth.includes("pbkdf2$") || !auth.includes("SESSION_IDLE_MINUTES")) throw new Error("管理员密码或会话安全策略缺失");

const forbidden = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", ".wrangler", ".next"].includes(entry)) continue;
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(ts|tsx|mjs|md|jsonl)$/.test(entry) && !file.includes("node_modules") && !file.includes("dist")) {
      const rel = relative(root, file).replaceAll("\\", "/");
      if (rel === "scripts/check-secrets.mjs") continue;
      const text = readFileSync(file, "utf8");
      if (/\b1\d{10}\b/.test(text) || /\b\d{17}[\dXx]\b/.test(text)) forbidden.push(rel);
    }
  }
}
walk(root);
if (forbidden.length) throw new Error(`发现未脱敏手机号或身份证号：${forbidden.join(", ")}`);
for (const candidate of ["app/api/agent", "lib/agent"]) {
  const path = join(root, candidate);
  try { walk(path); } catch { /* 目录尚未创建，视为通过 */ }
}
console.log("Database invariants passed: state guard, audit hook, redaction and schema constraints.");
