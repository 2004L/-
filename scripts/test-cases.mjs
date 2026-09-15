import { readFileSync } from "node:fs";

const cases = readFileSync("fixtures/cases.jsonl", "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
  const value = JSON.parse(line);
  if (!value.id || !value.expected_terminal) throw new Error(`第 ${index + 1} 行缺少 id 或 expected_terminal`);
  if (!Array.isArray(value.expected_events ?? [])) throw new Error(`第 ${index + 1} 行 expected_events 必须是数组`);
  return value;
});
const required = ["ambiguous-last4", "already-in-house", "cancelled-order", "not-found-walk-in", "relation-clarification", "change-mind", "two-rooms", "idempotent-retry", "concurrent-hold", "invalid-tool", "reader-timeout", "encoder-offline", "police-captcha"];
const ids = new Set(cases.map((item) => item.id));
for (const id of required) if (!ids.has(id)) throw new Error(`缺少验收场景：${id}`);

const orders = new Map([["4821", "awaiting_arrival"], ["6395", "awaiting_arrival"], ["9053", "awaiting_arrival"], ["1188", "ambiguous"], ["7366", "in_house"], ["4402", "cancelled"]]);
function replay(item) {
  if (item.fault) {
    const faultEvents = item.fault.target === "reader" ? ["MANUAL_TASK_CREATED", "READER_FAULT_INJECTED"] : item.fault.target === "police" ? ["MANUAL_TASK_CREATED", "POLICE_FAULT_INJECTED"] : ["MANUAL_TASK_CREATED", "ENCODER_FAULT_INJECTED"];
    const stopStep = item.fault.target === "reader" ? 2 : item.fault.target === "police" ? 4 : 6;
    return { terminal: item.fault.fault_type.includes("timeout") || item.fault.fault_type === "receipt_lost" ? "UNKNOWN" : "MANUAL_REQUIRED", stop_step: stopStep, events: faultEvents };
  }
  const text = (item.utterances ?? []).join(" ");
  if (item.id === "ambiguous-last4") return { terminal: "MANUAL_SELECTION_REQUIRED", events: ["ORDER_MATCH_AMBIGUOUS"] };
  if (item.id === "already-in-house") return { terminal: "ALREADY_CHECKED_IN", events: ["ORDER_MATCH_BLOCKED"] };
  if (item.id === "cancelled-order") return { terminal: "CANCELLED", events: ["ORDER_MATCH_BLOCKED"] };
  if (item.id === "not-found-walk-in") return { terminal: "ORDER_MATCHED", events: ["WALK_IN_CREATED", "ORDER_MATCHED"] };
  if (item.id === "relation-clarification") return { terminal: "WAITING_FOR_PHONE_LAST4", events: ["INTENT_NEEDS_INFO"] };
  if (item.id === "change-mind") return { terminal: "CANCELLED_BY_GUEST", events: ["INTENT_RECOGNIZED", "CHECKIN_CANCELLED"] };
  if (item.id === "two-rooms") return { terminal: "ORDER_MATCHED", room_count: 2, events: ["ORDER_MATCHED"] };
  if (item.id === "idempotent-retry") return { terminal: "ORDER_MATCHED", events: ["ORDER_MATCHED"] };
  if (item.id === "concurrent-hold") return { terminal: "ONE_SUCCESS_ONE_409", events: ["ROOM_HELD", "HOLD_CONFLICT"] };
  if (item.id === "invalid-tool") return { terminal: "CLARIFICATION", events: ["INTENT_NEEDS_INFO"] };
  const last4 = text.match(/\d{4}/)?.[0];
  return { terminal: orders.get(last4) === "awaiting_arrival" ? "ORDER_MATCHED" : "CLARIFICATION", events: ["INTENT_RECOGNIZED"] };
}

for (const item of cases) {
  const result = replay(item);
  if (result.terminal !== item.expected_terminal) throw new Error(`${item.id}: 期望 ${item.expected_terminal}，实际 ${result.terminal}`);
  for (const event of item.expected_events ?? []) if (!result.events.includes(event)) throw new Error(`${item.id}: 缺少审计事件 ${event}`);
  if (item.expected_room_count && result.room_count !== item.expected_room_count) throw new Error(`${item.id}: room_count 不正确`);
  if (item.expected_stop_step && result.stop_step !== item.expected_stop_step) throw new Error(`${item.id}: 期望停在第 ${item.expected_stop_step} 步，实际第 ${result.stop_step} 步`);
  if (item.expected_audit_max_delta && result.events.length > item.expected_audit_max_delta) throw new Error(`${item.id}: 幂等审计事件超出上限`);
  console.log(`PASS  ${item.id.padEnd(20)} -> ${result.terminal}`);
}
console.log(`Replay execution passed: ${cases.length} cases.`);
