import { routeAdminIntent } from "../lib/admin-tools.ts";

const pending = { pending_action_id: "action-demo-123" };
const cases = [
  ["cancel-takes-precedence", "取消确认", (result) => result.type === "tool_call" && result.tool_name === "admin.cancel_pending_action"],
  ["confirm-is-explicit", "确认执行", (result) => result.type === "tool_call" && result.tool_name === "admin.confirm_pending_action"],
  ["compound-phone-and-room", "把尾号四千八百二十一的客人换到一千三百零六", (result) => result.type === "tool_call" && result.tool_name === "admin.search_guest" && result.arguments.phone_last4 === "4821" && result.workflow?.target_room === "1306"],
  ["compound-amount", "把尾号4821的总金额改成六百八十", (result) => result.type === "tool_call" && result.tool_name === "admin.prepare_amount_adjustment" && result.arguments.phone_last4 === "4821" && result.arguments.new_amount === 680],
];

for (const [id, text, assert] of cases) {
  const result = routeAdminIntent(text, pending);
  if (!assert(result)) throw new Error(`管理员意图规则失败：${id} -> ${JSON.stringify(result)}`);
  console.log(`PASS  ${id}`);
}
console.log(`Admin intent rule checks passed: ${cases.length} cases.`);
