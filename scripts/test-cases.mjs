import { readFileSync } from "node:fs";

const lines = readFileSync("fixtures/cases.jsonl", "utf8").split(/\r?\n/).filter(Boolean);
const required = ["ambiguous-last4", "already-in-house", "cancelled-order", "not-found-walk-in", "relation-clarification", "change-mind", "two-rooms", "idempotent-retry", "concurrent-hold", "invalid-tool", "reader-timeout", "encoder-offline", "police-captcha"];
const cases = lines.map((line, index) => {
  const value = JSON.parse(line);
  if (!value.id || !value.expected_terminal) throw new Error(`fixtures/cases.jsonl 第 ${index + 1} 行缺少 id 或 expected_terminal`);
  if (!Array.isArray(value.expected_events ?? [])) throw new Error(`第 ${index + 1} 行 expected_events 必须是数组`);
  return value;
});
const ids = new Set(cases.map((item) => item.id));
for (const id of required) if (!ids.has(id)) throw new Error(`缺少验收场景：${id}`);
console.log(`Replay fixture contract passed: ${cases.length} cases.`);
