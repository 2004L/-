import { readFileSync } from "node:fs";
import { createMiniflareD1 } from "./miniflare-d1.mjs";

const read = (file) => readFileSync(file, "utf8");
const demoRoute = read("app/api/demo/[action]/route.ts");
const readerRoute = read("app/api/device/reader/route.ts");
const encoderRoute = read("app/api/device/encoder/route.ts");
const policeRoute = read("app/api/police/submit/route.ts");
const deviceCommands = read("lib/device-commands.ts");
const migration = read("drizzle/0015_checkin_handoff.sql");
const journal = read("drizzle/meta/_journal.json");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

console.log("== 设备路径收敛（同一套命令层）");
check("客人流程调用共用命令层", demoRoute.includes("runDeviceCommand") && demoRoute.includes("checkinCommandKey"));
check("三条设备路由都走共用命令层", [readerRoute, encoderRoute, policeRoute].every((route) => route.includes("from \"@/lib/device-commands\"") && route.includes("runDeviceCommand")));
check("故障映射只保留一处", deviceCommands.includes("FAILURE_TABLE") && ![readerRoute, encoderRoute, policeRoute].some((route) => route.includes("reader_timeout") || route.includes("encoder_offline") || route.includes("captcha_required")));
check("客人流程的读卡/公安/发卡都接命令层", ["reader", "police", "encoder"].every((target) => demoRoute.includes(`target: "${target}"`)));

console.log("\n== 人工终态");
check("状态机新增 HANDOFF_REQUIRED", demoRoute.includes("HANDOFF_REQUIRED") && demoRoute.includes("requireHandoff"));
check("转人工时写入现场接手标记", demoRoute.includes("onsite_team_required") && deviceCommands.includes("createManualTask"));
check("对账在无命令时给出明确说明", demoRoute.includes("external_command_note") && demoRoute.includes("没有任何外部命令记录"));
check("快照带出人工任务", demoRoute.includes("manual_tasks") && demoRoute.includes("manualTasks"));
check("迁移已登记", migration.includes("HANDOFF_REQUIRED") && journal.includes("0015_checkin_handoff"));

console.log("\n== 孤儿数据处理（真实 D1）");
const environment = await createMiniflareD1();
if (!environment) {
  console.error("SKIP  未找到 miniflare，跳过迁移验证");
} else {
  const { mf, db } = environment;
  try {
    await db.prepare("CREATE TABLE checkin_cases (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, order_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL, phone_last4 TEXT NOT NULL, identity_result TEXT, room_number TEXT, police_receipt TEXT, hardware_status TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await db.prepare("INSERT INTO checkin_cases VALUES ('case-1','s-1','o-1','reservation','READY_FOR_ONSITE_HANDOFF','k-1','4821','verified_demo_token','1208',NULL,'onsite_team_required',3,'t0','t0')").run();
    for (const statement of migration.split(/;\s*\n/).map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    const row = await db.prepare("SELECT status, legacy_status, hardware_status, version FROM checkin_cases WHERE id = 'case-1'").first();
    check("孤儿状态迁移到 HANDOFF_REQUIRED", row.status === "HANDOFF_REQUIRED", JSON.stringify(row));
    check("原始状态保留在 legacy_status", row.legacy_status === "READY_FOR_ONSITE_HANDOFF");
    check("版本号递增一次", Number(row.version) === 4);
    check("现场接手标记保留", row.hardware_status === "onsite_team_required");
  } finally {
    await mf.dispose();
  }
}

if (failures) {
  console.error(`\nHandoff checks FAILED: ${failures}.`);
  process.exit(1);
}
console.log("\nHandoff checks passed.");
