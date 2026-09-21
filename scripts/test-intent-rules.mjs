import { routeIntent } from "../lib/tools.ts";

const cases = [
  {
    id: "reservation-tail-arabic",
    result: routeIntent("帮我查一下有没有订单，手机号尾号 3452"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "pms.search_order" && result.arguments.phone_last4 === "3452",
  },
  {
    id: "reservation-tail-spoken",
    result: routeIntent("我在平台订了房，手机尾号三四五二"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "pms.search_order" && result.arguments.phone_last4 === "3452",
  },
  {
    id: "reservation-tail-compound-spoken",
    result: routeIntent("我在平台订了房，手机号尾号三千四百五十二"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "pms.search_order" && result.arguments.phone_last4 === "3452",
  },
  {
    id: "walk-in-requires-full-phone",
    result: routeIntent("我没有预订，想现场入住"),
    assert: (result) => result.type === "clarification" && result.intent === "walk_in" && result.message.includes("完整手机号"),
  },
  {
    id: "walk-in-full-phone-confirmation",
    result: routeIntent("我要现场办理，手机号是一三八零零一三八零零零"),
    assert: (result) => result.type === "clarification" && result.intent === "walk_in" && result.message.includes("现场支付"),
  },
  {
    id: "walk-in-follow-up-full-phone",
    result: routeIntent("一三八零零一三八零零零", { pending_walk_in: true }),
    assert: (result) => result.type === "clarification" && result.intent === "walk_in" && result.message.includes("确认手机号"),
  },
  {
    id: "policy-does-not-search-order",
    result: routeIntent("早餐几点开始？"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "hotel.policy_answer" && result.arguments.topic === "breakfast",
  },
  {
    id: "checkout-starts-card-return",
    result: routeIntent("退房"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "pms.start_checkout",
  },
  {
    id: "checkout-time-remains-policy",
    result: routeIntent("几点退房？"),
    assert: (result) => result.type === "tool_call" && result.tool_name === "hotel.policy_answer" && result.arguments.topic === "checkout",
  },
  {
    id: "non-hotel-question-remains-natural",
    result: routeIntent("帮我写一段 C 语言 Hello World"),
    assert: (result) => result.type === "assistant_message" && result.message.includes("#include"),
  },
];

for (const item of cases) {
  if (!item.assert(item.result)) throw new Error(`意图规则失败：${item.id}`);
  console.log(`PASS  ${item.id}`);
}
console.log(`Intent rule checks passed: ${cases.length} cases.`);
