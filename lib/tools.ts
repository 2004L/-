import { z } from "zod";

export const toolNames = [
  "pms.search_order",
  "pms.create_walk_in",
  "hotel.policy_answer",
  "device.reader.read_identity",
  "device.encoder.issue_keycard",
  "device.encoder.read_status",
  "police.submit_registration",
] as const;
export const toolNameSchema = z.enum(toolNames);

export const agentMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().min(1).max(2000),
});

export const agentTurnSchema = z.object({
  session_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  conversation_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).optional(),
  messages: z.array(agentMessageSchema).min(1).max(30),
  case_id: z.string().min(8).max(80).optional(),
}).strict();

export type ToolName = (typeof toolNames)[number];
export type ToolCall = { type: "tool_call"; tool_call_id: string; tool_name: ToolName; arguments: Record<string, unknown>; implementation: "business_api" | "simulator"; response_hint?: string };
export type Clarification = { type: "clarification"; message: string; intent: string; confidence: number };
export type AssistantMessage = { type: "assistant_message"; message: string };

export const toolArgumentSchemas: Record<ToolName, z.ZodTypeAny> = {
  "pms.search_order": z.object({ phone_last4: z.string().regex(/^\d{4}$/) }).strict(),
  "pms.create_walk_in": z.object({ phone_last4: z.string().regex(/^\d{4}$/) }).strict(),
  "hotel.policy_answer": z.object({ topic: z.enum(["breakfast", "parking", "payment", "checkout"]) }).strict(),
  "device.reader.read_identity": z.object({ case_id: z.string().min(8), expected_state: z.string() }).strict(),
  "device.encoder.issue_keycard": z.object({ case_id: z.string().min(8), room_number: z.string().regex(/^\d{3,5}$/) }).strict(),
  "device.encoder.read_status": z.object({ case_id: z.string().min(8).nullable() }).strict(),
  "police.submit_registration": z.object({ case_id: z.string().min(8), expected_state: z.string() }).strict(),
};

export const modelToolDefinitions = toolNames.map((toolName) => ({
  type: "function" as const,
  function: {
    name: toolName.replaceAll(".", "_"),
    description: `受控工具 ${toolName}。不得猜测身份、金额、房号或公安字段。`,
    parameters: { type: "object", additionalProperties: false, properties: toolName === "pms.search_order" || toolName === "pms.create_walk_in" ? { phone_last4: { type: "string", pattern: "^[0-9]{4}$" } } : toolName === "hotel.policy_answer" ? { topic: { type: "string", enum: ["breakfast", "parking", "payment", "checkout"] } } : { case_id: { type: ["string", "null"] }, expected_state: { type: "string" }, room_number: { type: "string", pattern: "^[0-9]{3,5}$" } } },
  },
}));

const normalizeDigits = (text: string) => {
  const digitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  return [...text].map((character) => digitMap[character] ?? character).join("").replace(/\D/g, "");
};

const fullPhone = (text: string) => normalizeDigits(text).match(/1[3-9]\d{9}/)?.[0] ?? null;
const last4 = (text: string) => {
  const digits = normalizeDigits(text);
  return digits.length >= 4 ? digits.slice(-4) : null;
};

export function routeIntent(text: string, context?: { case_id?: string; pending_walk_in?: boolean }): ToolCall | Clarification | AssistantMessage {
  const normalized = text.trim().replace(/\s+/g, " ");
  const phoneNumber = fullPhone(normalized);
  const phoneLast4 = last4(normalized);
  if (/(C语言|C 语言|C程序|Hello World|hello world|编程|代码)/i.test(normalized)) {
    return { type: "assistant_message", message: "可以。C 语言的 Hello World 是：\n\n#include <stdio.h>\n\nint main(void) {\n    printf(\"Hello, World!\\n\");\n    return 0;\n}\n\n当前 Demo 主要负责酒店入住；这段代码只是用来测试 AI 对话是否正常。" };
  }
  if (/(我老婆|我老公|朋友|同事).*手机号/.test(normalized)) return { type: "clarification", message: "我需要确认具体是哪位客人的预订，请说预订手机号后四位。", intent: "query_reservation", confidence: 0.96 };
  if (/(早餐|早饭|停车|停车场|押金|微信|支付宝|退房|入住时间)/.test(normalized)) {
    const topic = /早餐|早饭/.test(normalized) ? "breakfast" : /停车/.test(normalized) ? "parking" : /押金|微信|支付宝/.test(normalized) ? "payment" : "checkout";
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "hotel.policy_answer", arguments: { topic }, implementation: "business_api", response_hint: "将读取当前门店政策后回答，不会修改订单或金额。" };
  }
  if (/(房卡|门卡).*(状态|进度|没出|没拿到)/.test(normalized)) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "device.encoder.read_status", arguments: { case_id: context?.case_id ?? null }, implementation: "simulator", response_hint: "将查询发卡机仿真状态，不会重复发卡。" };
  if (/(读身份证|读取身份证|身份证放|证件放)/.test(normalized)) {
    if (!context?.case_id) return { type: "clarification", message: "请先告诉我预订手机号后四位，我确认订单后再读取身份证。", intent: "identity_read", confidence: 0.94 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "device.reader.read_identity", arguments: { case_id: context.case_id, expected_state: "IDENTITY_READING" }, implementation: "simulator", response_hint: "已切换到读卡器仿真接口，读到的是演示身份 Token。" };
  }
  const walkIn = /(没有?预订|无预订|现场(?:预订|办理|入住)|直接(?:入住|住)|到店(?:办理|入住)|walk[- ]?in)/i.test(normalized);
  if (walkIn || context?.pending_walk_in) {
    if (!phoneNumber) return { type: "clarification", message: "好的，现场办理需要登记完整手机号。请说 11 位手机号，系统会先让您核对，再进入选房和支付。", intent: "walk_in", confidence: 0.98 };
    return { type: "clarification", message: "已收到完整手机号。请先确认手机号无误，下一步将查询可用房型和现场支付金额。", intent: "walk_in", confidence: 0.99 };
  }
  if (phoneLast4 || /(预订|订了|订单|入住|住店|美团|抖音|携程|官网)/.test(normalized)) {
    if (!phoneLast4) return { type: "clarification", message: "可以，请告诉我预订手机号后四位，直接说四个数字就行。", intent: "query_reservation", confidence: 0.91 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.search_order", arguments: { phone_last4: phoneLast4 }, implementation: "business_api", response_hint: "将按手机号后四位查询订单；命中多笔时会转人工。" };
  }
  return { type: "clarification", message: "我听到了您的话，但当前系统主要负责酒店订单和入住办理，暂时不能执行 C 语言编程。您可以说查订单、办理入住，或者询问早餐、停车、押金和退房。", intent: "general_assistance", confidence: 0.72 };
}
