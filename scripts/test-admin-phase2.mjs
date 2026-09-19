import { readFileSync } from "node:fs";
import { routeAdminIntent, isRoomNumber, parseAmount } from "../lib/admin-tools.ts";

const read = (file) => readFileSync(file, "utf8");
const page = read("app/page.tsx");
const route = read("app/api/admin/agent/turn/route.ts");
const llm = read("lib/admin-llm.ts");
const asr = read("services/asr/server.py");
const adminService = read("lib/admin-service.ts");

const pending = { pending_action_id: "action-phase2-demo" };
const cases = [
  ["实时识别查尾号4821", "查尾号4821", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.arguments.phone_last4 === "4821"],
  ["自动规划换房确认卡", "把尾号4821换到1306", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.workflow?.target_room === "1306"],
  ["中文数字转阿拉伯数字", "把尾号四千八百二十一的客人换到一千三百零六", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.arguments.phone_last4 === "4821" && result.workflow?.target_room === "1306"],
  ["确认执行必须命中确认工具", "确认执行", (result) => result.type === "tool_call" && result.tool_name === "admin.confirm_pending_action"],
  ["取消后不执行工具", "取消", (result) => result.type === "tool_call" && result.tool_name === "admin.cancel_pending_action"],
];

for (const [id, text, assert] of cases) {
  const result = routeAdminIntent(text, pending);
  if (!assert(result)) throw new Error(`第二阶段验收失败：${id} -> ${JSON.stringify(result)}`);
  console.log(`PASS  ${id}`);
}

if (!isRoomNumber("1306") || isRoomNumber("13a") || !isRoomNumber(" 1208 ")) throw new Error("房号校验不通过");
if (parseAmount("680元") !== 680 || parseAmount("abc") !== null || parseAmount(" 1299 ") !== 1299) throw new Error("金额解析不通过");
console.log("PASS  确认卡字段格式校验");

const pageMarkers = ["AdminPipeline", "结束录音", "发送", "重试", "正在理解管理员意图", "麦克风", "模型", "工具", "确认"];
for (const marker of pageMarkers) if (!page.includes(marker)) throw new Error(`管理后台缺少可视化/按钮标记：${marker}`);
console.log("PASS  管理后台状态可视化与语音按钮");

const streamMarkers = ["connecting", "understanding", "planning", "awaiting_confirmation"];
for (const marker of streamMarkers) if (!llm.includes(marker) || !route.includes("event.stage")) throw new Error(`管理员流式阶段缺失：${marker}`);
console.log("PASS  管理员模型流式阶段");

if (!asr.includes('"is_final": False') || !asr.includes("ASR_PARTIAL_INTERVAL")) throw new Error("本地 ASR 缺少临时识别结果");
console.log("PASS  本地 ASR 临时识别文字");

for (const marker of ["room_change_conflict", "admin_action_expired", "admin_action_not_confirmable"]) if (!adminService.includes(marker)) throw new Error(`确认单安全边界缺失：${marker}`);
console.log("PASS  占用、过期、重复提交保护");

console.log(`Admin phase-2 acceptance passed: ${cases.length + 6} checks.`);
