import { z } from "zod";

export const toolNames = [
  "pms.search_order",
  "pms.create_walk_in_draft",
  "pms.quote_walk_in",
  "pms.create_walk_in",
  "pms.start_checkout",
  "payment.create",
  "hotel.policy_answer",
  "hotel.knowledge_search",
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
  walk_in_draft_id: z.string().min(8).max(100).optional(),
  walk_in_draft_status: z.enum(["DRAFT", "QUOTED", "AWAITING_PAYMENT", "ORDER_CREATED"]).optional(),
}).strict();

export type ToolName = (typeof toolNames)[number];
export type ToolCall = { type: "tool_call"; tool_call_id: string; tool_name: ToolName; arguments: Record<string, unknown>; implementation: "business_api" | "simulator"; response_hint?: string };
export type Clarification = { type: "clarification"; message: string; intent: string; confidence: number; requires_confirmation?: boolean };
export type AssistantMessage = { type: "assistant_message"; message: string };

export const toolArgumentSchemas: Record<ToolName, z.ZodTypeAny> = {
  "pms.search_order": z.object({ phone_last4: z.string().regex(/^\d{4}$/) }).strict(),
  "pms.create_walk_in_draft": z.object({ phone_number: z.string().regex(/^1[3-9]\d{9}$/) }).strict(),
  "pms.quote_walk_in": z.object({ draft_id: z.string().min(8), room_type_code: z.enum(["STD-KING", "DLX-KING", "DLX-TWIN"]), nights: z.number().int().min(1).max(30), room_count: z.number().int().min(1).max(4) }).strict(),
  "pms.create_walk_in": z.object({ phone_last4: z.string().regex(/^\d{4}$/) }).strict(),
  "pms.start_checkout": z.object({}).strict(),
  "payment.create": z.object({ draft_id: z.string().min(8), method: z.enum(["wechat", "alipay"]) }).strict(),
  "hotel.policy_answer": z.object({ topic: z.enum(["breakfast", "parking", "payment", "checkout"]), query: z.string().min(2).max(120).optional() }).strict(),
  "hotel.knowledge_search": z.object({ query: z.string().min(2).max(120) }).strict(),
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
    parameters: { type: "object", additionalProperties: false, properties: toolName === "pms.start_checkout" ? {} : toolName === "pms.search_order" || toolName === "pms.create_walk_in" ? { phone_last4: { type: "string", pattern: "^[0-9]{4}$" } } : toolName === "pms.create_walk_in_draft" ? { phone_number: { type: "string", pattern: "^1[3-9][0-9]{9}$" } } : toolName === "pms.quote_walk_in" ? { draft_id: { type: "string", minLength: 8 }, room_type_code: { type: "string", enum: ["STD-KING", "DLX-KING", "DLX-TWIN"] }, nights: { type: "integer", minimum: 1, maximum: 30 }, room_count: { type: "integer", minimum: 1, maximum: 4 } } : toolName === "payment.create" ? { draft_id: { type: "string", minLength: 8 }, method: { type: "string", enum: ["wechat", "alipay"] } } : toolName === "hotel.knowledge_search" ? { query: { type: "string", minLength: 2, maxLength: 120 } } : toolName === "hotel.policy_answer" ? { topic: { type: "string", enum: ["breakfast", "parking", "payment", "checkout"] }, query: { type: "string", minLength: 2, maxLength: 120 } } : { case_id: { type: ["string", "null"] }, expected_state: { type: "string" }, room_number: { type: "string", pattern: "^[0-9]{3,5}$" } } },
  },
}));

const normalizeDigits = (text: string) => {
  const digitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  return [...text].map((character) => digitMap[character] ?? character).join("").replace(/\D/g, "");
};

function parseSpokenNumber(value: string) {
  const token = value.replace(/\s+/g, "");
  if (!token) return "";
  if (!/[十百千万]/.test(token)) return normalizeDigits(token);
  const digitMap: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 幺: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let section = 0;
  let current = 0;
  for (const character of token) {
    if (/^\d$/.test(character)) { current = current * 10 + Number(character); continue; }
    if (digitMap[character] !== undefined) { current = current * 10 + digitMap[character]; continue; }
    const unit = character === "十" ? 10 : character === "百" ? 100 : character === "千" ? 1000 : character === "万" ? 10000 : 0;
    if (!unit) continue;
    if (unit === 10000) { section = (section + current) * unit; total += section; section = 0; }
    else section += (current || 1) * unit;
    current = 0;
  }
  return String(total + section + current);
}

const fullPhone = (text: string) => normalizeDigits(text).match(/1[3-9]\d{9}/)?.[0] ?? null;
export function extractPhoneNumber(text: string) {
  const digits = normalizeDigits(text);
  return digits.match(/1[3-9]\d{9}/)?.[0] ?? null;
}

const last4 = (text: string) => {
  const digits = normalizeDigits(text);
  return digits.length >= 4 ? digits.slice(-4) : null;
};
const spokenCount = (text: string, pattern: RegExp, fallback: number) => {
  const match = text.match(pattern);
  if (!match) return fallback;
  const value = Number(parseSpokenNumber(match[1] ?? ""));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function routeIntent(text: string, context?: { case_id?: string; pending_walk_in?: boolean; pending_walk_in_phone?: string; walk_in_draft_id?: string; walk_in_draft_status?: string }): ToolCall | Clarification | AssistantMessage {
  const normalized = text.trim().replace(/\s+/g, " ");
  const phoneNumber = fullPhone(normalized);
  const phoneLast4 = last4(normalized);
  if (/(C语言|C 语言|C程序|Hello World|hello world|编程|代码)/i.test(normalized)) {
    return { type: "assistant_message", message: "可以。C 语言的 Hello World 是：\n\n#include <stdio.h>\n\nint main(void) {\n    printf(\"Hello, World!\\n\");\n    return 0;\n}\n\n当前 Demo 主要负责酒店入住；这段代码只是用来测试 AI 对话是否正常。" };
  }
  if (/(我老婆|我老公|朋友|同事).*手机号/.test(normalized)) return { type: "clarification", message: "我需要确认具体是哪位客人的预订，请说预订手机号后四位。", intent: "query_reservation", confidence: 0.96 };
  if (/(退房时间|几点退房|延迟退房|晚点退)/.test(normalized)) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "hotel.policy_answer", arguments: { topic: "checkout", query: normalized }, implementation: "business_api", response_hint: "将读取当前门店退房政策。" };
  }
  if (/(退房|离店|我要走了|准备走了|退卡|归还房卡)/.test(normalized)) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.start_checkout", arguments: {}, implementation: "business_api", response_hint: "直接进入退房收卡流程，先检查收卡器，不查询退房政策。" };
  }
  if (/(早餐|早饭|停车|停车场|押金|微信|支付宝|退房|入住时间)/.test(normalized)) {
    const topic = /早餐|早饭/.test(normalized) ? "breakfast" : /停车/.test(normalized) ? "parking" : /押金|微信|支付宝/.test(normalized) ? "payment" : "checkout";
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "hotel.policy_answer", arguments: { topic, query: normalized }, implementation: "business_api", response_hint: "将读取当前门店政策后回答，不会修改订单或金额。" };
  }
  if (/(房卡|门卡).*(状态|进度|没出|没拿到)/.test(normalized)) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "device.encoder.read_status", arguments: { case_id: context?.case_id ?? null }, implementation: "simulator", response_hint: "将查询发卡机仿真状态，不会重复发卡。" };
  if (/(读身份证|读取身份证|身份证放|证件放)/.test(normalized)) {
    if (!context?.case_id) return { type: "clarification", message: "请先告诉我预订手机号后四位，我确认订单后再读取身份证。", intent: "identity_read", confidence: 0.94 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "device.reader.read_identity", arguments: { case_id: context.case_id, expected_state: "IDENTITY_READING" }, implementation: "simulator", response_hint: "已切换到读卡器仿真接口，读到的是演示身份 Token。" };
  }
  const walkIn = /(没有?预订|无预订|现场(?:预订|办理|入住)|直接(?:入住|住)|到店(?:办理|入住)|walk[- ]?in)/i.test(normalized);
  if (walkIn || context?.pending_walk_in) {
    const candidatePhone = phoneNumber ?? context?.pending_walk_in_phone ?? null;
    if (!candidatePhone) return { type: "clarification", message: "好的，现场办理需要登记完整手机号。请说 11 位手机号，系统会先让您核对，再进入选房和支付。", intent: "walk_in", confidence: 0.98 };
    if (phoneNumber && /(确认|没错|正确|是的|可以)/.test(normalized)) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.create_walk_in_draft", arguments: { phone_number: candidatePhone }, implementation: "business_api", response_hint: "已确认完整手机号，将创建现场办理草稿，不会在支付前创建正式订单。" };
    if (context?.pending_walk_in_phone && /^(确认|确定|没错|正确|是的|可以)[。！!？?\s]*$/u.test(normalized)) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.create_walk_in_draft", arguments: { phone_number: candidatePhone }, implementation: "business_api", response_hint: "已确认完整手机号，将创建现场办理草稿，不会在支付前创建正式订单。" };
    return { type: "clarification", message: `已收到手机号 ${candidatePhone.slice(0, 3)}****${candidatePhone.slice(-4)}。请确认手机号无误，确认后我会查询可用房型和现场支付金额。`, intent: "walk_in", confidence: 0.99, requires_confirmation: true };
  }
  if (context?.walk_in_draft_id) {
    const draftStatus = context.walk_in_draft_status ?? "DRAFT";
    if (draftStatus === "QUOTED" && /(确认|确定|没问题|付款|支付)/.test(normalized)) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "payment.create", arguments: { draft_id: context.walk_in_draft_id, method: /支付宝|alipay/i.test(normalized) ? "alipay" : "wechat" }, implementation: "business_api", response_hint: "金额以后端报价为准，将创建待支付单，不会直接标记为已支付。" };
    if (draftStatus === "DRAFT" || draftStatus === "QUOTED") {
      const roomTypeCode = /双床|两张床|twin/i.test(normalized) ? "DLX-TWIN" : /高级|豪华|大床|king/i.test(normalized) ? "DLX-KING" : /标准/.test(normalized) ? "STD-KING" : null;
      const nights = spokenCount(normalized, /([零〇一二两三四五六七八九\d]+)\s*晚/, 1);
      const roomCount = spokenCount(normalized, /([零〇一二两三四五六七八九\d]+)\s*(?:间|套)/, 1);
      if (roomTypeCode) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.quote_walk_in", arguments: { draft_id: context.walk_in_draft_id, room_type_code: roomTypeCode, nights: Math.min(nights, 30), room_count: Math.min(roomCount, 4) }, implementation: "business_api", response_hint: "将查询房态并计算房费、押金和总额，需您确认金额后才能支付。" };
      if (/(房型|大床|双床|标准|豪华|高级|几晚|几间)/.test(normalized)) return { type: "clarification", message: "请告诉我想要的房型，例如标准大床房、高级大床房或豪华双床房。", intent: "walk_in_room_selection", confidence: 0.9 };
    }
    if (draftStatus === "AWAITING_PAYMENT") return { type: "clarification", message: "当前报价正在等待支付。请完成页面上的模拟支付，支付成功后才会创建现场订单。", intent: "walk_in_payment", confidence: 0.98 };
  }
  if (phoneLast4 || /(预订|订了|订单|入住|住店|美团|抖音|携程|官网)/.test(normalized)) {
    if (!phoneLast4) return { type: "clarification", message: "可以，请告诉我预订手机号后四位，直接说四个数字就行。", intent: "query_reservation", confidence: 0.91 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "pms.search_order", arguments: { phone_last4: phoneLast4 }, implementation: "business_api", response_hint: "将按手机号后四位查询订单；命中多笔时会转人工。" };
  }
  // 兜底：任何像"提问"的话都先交给知识库 —— 由它决定能不能答（命中带出处，命中不到转人工），
  // 而不是让关键词表决定"哪些问题我们才认"。
  if (/(吗|呢|怎么|多少|几点|能不能|可以|有没有|是否|什么样|哪些|哪里)/.test(normalized)) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "hotel.knowledge_search", arguments: { query: normalized.slice(0, 120) }, implementation: "business_api", response_hint: "先查当前门店知识库：命中就带出处回答，命中不到就说不知道并转人工。" };
  }  return { type: "clarification", message: "我听到了您的话，但当前系统主要负责酒店订单和入住办理，暂时不能执行 C 语言编程。您可以说查订单、办理入住，或者询问早餐、停车、押金和退房。", intent: "general_assistance", confidence: 0.72 };
}
