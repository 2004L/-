import { z } from "zod";

export const adminRoles = ["owner", "manager", "frontdesk", "housekeeping"] as const;
export type AdminRole = (typeof adminRoles)[number];

export const adminPermissions = [
  "admin:read_orders",
  "admin:read_rooms",
  "admin:room_change",
  "admin:checkin",
  "admin:checkout",
  "admin:payment_adjust",
  "admin:refund",
  "admin:device_control",
  "admin:manage_users",
  "admin:manage_config",
  "admin:manage_faults",
  "admin:housekeeping",
  "admin:purge_data",
  "admin:read_database",
  "admin:service",
  "admin:manage_knowledge",
] as const;
export type AdminPermission = (typeof adminPermissions)[number];

export const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  owner: adminPermissions,
  manager: ["admin:read_orders", "admin:read_rooms", "admin:room_change", "admin:checkin", "admin:checkout", "admin:payment_adjust", "admin:refund", "admin:device_control", "admin:manage_faults", "admin:housekeeping", "admin:purge_data", "admin:read_database", "admin:service", "admin:manage_knowledge"],
  // Front desk deliberately cannot mark a room clean: declaring a room sellable is
  // the cleaner's confirmation, and selling a dirty room is the expensive mistake.
  frontdesk: ["admin:read_orders", "admin:read_rooms", "admin:room_change", "admin:checkin", "admin:checkout", "admin:service"],
  housekeeping: ["admin:read_rooms", "admin:housekeeping", "admin:service"],
};

export const adminToolNames = [
  "admin.search_guest",
  "admin.get_room_status",
  "admin.mark_room_clean",
  "admin.prepare_purge_closed_loops",
  "admin.get_database_schema",
  "admin.get_table_rows",
  "admin.list_in_house_guests",
  "admin.set_room_service_need",
  "admin.reconcile_demo_orders",
  "admin.prepare_room_change",
  "admin.prepare_amount_adjustment",
  "admin.prepare_keycard_issue",
  "admin.prepare_police_submission",
  "admin.confirm_pending_action",
  "admin.confirm_room_change",
  "admin.cancel_pending_action",
  "admin.cancel_room_change",
  "admin.get_audit_records",
  "admin.list_knowledge_documents",
  "admin.get_knowledge_document",
  "admin.preview_knowledge_answer",
  "admin.prepare_knowledge_document",
  "admin.prepare_knowledge_status",
] as const;
export type AdminToolName = (typeof adminToolNames)[number];

export const adminToolArgumentSchemas: Record<AdminToolName, z.ZodTypeAny> = {
  "admin.search_guest": z.object({ phone_last4: z.string().regex(/^\d{4}$/).optional(), order_code: z.string().min(4).max(80).optional() }).strict().refine((value) => Boolean(value.phone_last4 || value.order_code)),
  "admin.get_room_status": z.object({ room_number: z.string().regex(/^\d{3,5}$/) }).strict(),
  "admin.mark_room_clean": z.object({ room_number: z.string().regex(/^\d{3,5}$/), reason: z.string().min(1).max(200).default("客房打扫完成") }).strict(),
  "admin.prepare_purge_closed_loops": z.object({ range: z.enum(["3d", "7d", "30d", "180d", "365d"]), reason: z.string().min(1).max(200).default("按时间范围清理已退房的历史记录") }).strict(),
  "admin.get_database_schema": z.object({}).strict(),
  "admin.get_table_rows": z.object({ table: z.string().min(1).max(80), limit: z.number().int().min(1).max(50).optional() }).strict(),
  "admin.list_in_house_guests": z.object({}).strict(),
  "admin.set_room_service_need": z.object({ room_number: z.string().regex(/^\d{3,5}$/), need: z.enum(["none", "cleaning", "maintenance", "supplies"]), note: z.string().max(200).optional() }).strict(),
  "admin.reconcile_demo_orders": z.object({}).strict(),
  "admin.prepare_room_change": z.object({ order_id: z.string().min(8).max(100).optional(), phone_last4: z.string().regex(/^\d{4}$/).optional(), from_room: z.string().regex(/^\d{3,5}$/).optional(), to_room: z.string().regex(/^\d{3,5}$/), reason: z.string().min(1).max(200) }).strict().refine((value) => Boolean(value.order_id || value.phone_last4)),
  "admin.prepare_amount_adjustment": z.object({ order_id: z.string().min(8).max(100).optional(), phone_last4: z.string().regex(/^\d{4}$/).optional(), order_code: z.string().min(4).max(80).optional(), amount_type: z.enum(["room_amount", "deposit_amount", "total_amount"]).default("total_amount"), new_amount: z.number().int().min(0).max(99999), reason: z.string().min(1).max(200) }).strict().refine((value) => Boolean(value.order_id || value.phone_last4 || value.order_code)),
  "admin.prepare_keycard_issue": z.object({ order_id: z.string().min(8).max(100).optional(), phone_last4: z.string().regex(/^\d{4}$/).optional(), order_code: z.string().min(4).max(80).optional(), room_number: z.string().regex(/^\d{3,5}$/).optional(), reason: z.string().min(1).max(200) }).strict().refine((value) => Boolean(value.order_id || value.phone_last4 || value.order_code)),
  "admin.prepare_police_submission": z.object({ order_id: z.string().min(8).max(100).optional(), phone_last4: z.string().regex(/^\d{4}$/).optional(), order_code: z.string().min(4).max(80).optional(), region: z.enum(["广州", "珠海"]).default("广州"), reason: z.string().min(1).max(200) }).strict().refine((value) => Boolean(value.order_id || value.phone_last4 || value.order_code)),
  "admin.confirm_pending_action": z.object({ action_id: z.string().min(8).max(100), confirmation: z.literal("CONFIRM") }).strict(),
  "admin.confirm_room_change": z.object({ action_id: z.string().min(8).max(100), confirmation: z.literal("CONFIRM") }).strict(),
  "admin.cancel_pending_action": z.object({ action_id: z.string().min(8).max(100), reason: z.string().min(1).max(200) }).strict(),
  "admin.cancel_room_change": z.object({ action_id: z.string().min(8).max(100), reason: z.string().min(1).max(200) }).strict(),
  "admin.get_audit_records": z.object({ limit: z.number().int().min(1).max(100).default(50), action_id: z.string().min(8).max(100).optional(), event_type: z.string().min(3).max(100).optional() }).strict(),

  "admin.list_knowledge_documents": z.object({}).strict(),
  "admin.get_knowledge_document": z.object({ document_id: z.string().min(4).max(80) }).strict(),
  "admin.preview_knowledge_answer": z.object({ query: z.string().min(1).max(200), visibility: z.enum(["guest", "staff"]).default("guest") }).strict(),
  // 一行一条切片：店长在后台看到的一行，就是客人被答到的那一句。
  "admin.prepare_knowledge_document": z.object({
    document_id: z.string().min(4).max(80).optional(),
    title: z.string().min(1).max(80),
    source: z.enum(["policy", "faq", "sop", "ticket", "manual"]).default("policy"),
    authority: z.enum(["authoritative", "reference", "hint"]).default("authoritative"),
    visibility: z.enum(["guest", "staff"]).default("guest"),
    version: z.number().int().min(1).max(9999).optional(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["active", "draft", "retired"]).default("active"),
    chunks: z.array(z.string().min(1).max(500)).min(1).max(20),
    keywords: z.string().max(200).optional(),
    reason: z.string().min(1).max(200).default("门店政策维护"),
  }).strict(),
  "admin.prepare_knowledge_status": z.object({ document_id: z.string().min(4).max(80), status: z.enum(["active", "draft", "retired"]), reason: z.string().min(1).max(200) }).strict(),
};

export const adminToolPermissions: Record<AdminToolName, AdminPermission> = {
  "admin.search_guest": "admin:read_orders",
  "admin.get_room_status": "admin:read_rooms",
  "admin.mark_room_clean": "admin:housekeeping",
  "admin.prepare_purge_closed_loops": "admin:purge_data",
  "admin.get_database_schema": "admin:read_database",
  "admin.get_table_rows": "admin:read_database",
  "admin.list_in_house_guests": "admin:read_orders",
  "admin.set_room_service_need": "admin:service",
  "admin.reconcile_demo_orders": "admin:purge_data",
  "admin.prepare_room_change": "admin:room_change",
  "admin.prepare_amount_adjustment": "admin:payment_adjust",
  "admin.prepare_keycard_issue": "admin:device_control",
  "admin.prepare_police_submission": "admin:checkin",
  "admin.confirm_pending_action": "admin:read_orders",
  "admin.confirm_room_change": "admin:room_change",
  "admin.cancel_pending_action": "admin:read_orders",
  "admin.cancel_room_change": "admin:room_change",
  "admin.get_audit_records": "admin:read_orders",
  // 政策的读与写是同一件事的两半：能改政策的角色才需要看到原文和试问结果。
  "admin.list_knowledge_documents": "admin:manage_knowledge",
  "admin.get_knowledge_document": "admin:manage_knowledge",
  "admin.preview_knowledge_answer": "admin:manage_knowledge",
  "admin.prepare_knowledge_document": "admin:manage_knowledge",
  "admin.prepare_knowledge_status": "admin:manage_knowledge",
};

export const adminTurnSchema = z.object({
  conversation_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) }).strict()).min(1).max(20),
  pending_action_id: z.string().min(8).max(100).optional(),
}).strict();

export type AdminWorkflowHint = {
  kind: "room_change";
  target_room: string;
  stage: "guest_search";
};
export type AdminToolCall = { type: "tool_call"; tool_call_id: string; tool_name: AdminToolName; arguments: Record<string, unknown>; response_hint?: string; workflow?: AdminWorkflowHint };
export type AdminAssistantResult = AdminToolCall | { type: "clarification"; message: string; intent: string; confidence: number } | { type: "assistant_message"; message: string };

const spokenDigitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
const spokenNumberCharacters = "零〇一幺二两三四五六七八九十百千万0123456789";
const spokenNumberToken = `[${spokenNumberCharacters}\\s]+`;
const normalizeSpokenDigits = (value: string) => [...value].map((character) => spokenDigitMap[character] ?? character).join("");
const digits = (value: string) => normalizeSpokenDigits(value).replace(/[^0-9]/g, "");

/**
 * Convert both digit-by-digit speech (四八二一) and Chinese units
 * (四千八百二十一) without treating unrelated numbers in the sentence as one value.
 */
function spokenNumberToDigits(value: string) {
  const token = value.replace(/\s+/g, "");
  if (!token) return "";
  if (/^[0-9]+$/.test(token)) return token;
  if (![...token].some((character) => "十百千万".includes(character))) return digits(token);
  let total = 0;
  let section = 0;
  let current = 0;
  let hasNumber = false;
  for (const character of token) {
    if (/^[0-9]$/.test(character)) {
      current = current * 10 + Number(character);
      hasNumber = true;
      continue;
    }
    const mapped = spokenDigitMap[character];
    if (mapped !== undefined) {
      current = current * 10 + Number(mapped);
      hasNumber = true;
      continue;
    }
    const unit = character === "十" ? 10 : character === "百" ? 100 : character === "千" ? 1000 : character === "万" ? 10000 : 0;
    if (!unit) continue;
    hasNumber = true;
    if (unit === 10000) {
      section = (section + (current || 0)) * unit;
      total += section;
      section = 0;
    } else {
      section += (current || 1) * unit;
    }
    current = 0;
  }
  return hasNumber ? String(total + section + current) : "";
}

function captureNumber(value: string, labels: string[]) {
  const label = labels.join("|");
  const match = value.match(new RegExp(`(?:${label})\\s*(?:是|为|叫|改成|改到|调整为)?\\s*(${spokenNumberToken})`, "u"));
  return match?.[1] ? spokenNumberToDigits(match[1]) : "";
}

const findLast4 = (value: string) => {
  const captured = captureNumber(value, ["尾号", "后四位", "后四个数字", "手机号"]);
  if (captured && captured.length <= 4) return captured.padStart(4, "0");
  const onlyDigits = digits(value);
  return onlyDigits.length === 4 ? onlyDigits : null;
};

const findRoom = (value: string) => {
  const captured = captureNumber(value, ["房间", "房号", "换到", "改到", "搬到", "调到", "发到", "制作到"]);
  return captured && /^\d{3,5}$/.test(captured) ? captured : null;
};

/**
 * A cleaned room is reported by number, but the phrase rarely carries a label
 * ("1208 打扫好了"), so fall back to the first 3-5 digit token in the sentence.
 */
const findRoomForCleaning = (value: string) => findRoom(value) ?? value.match(/[0-9]{3,5}/)?.[0] ?? null;

/**
 * Which retention window the operator means. No default on purpose: guessing here
 * would delete a different slice of history than the one they asked for.
 */
const findRetentionRange = (value: string) => {
  // normalizeSpokenDigits has already turned 一/三/七 into 1/3/7, so both spellings
  // are matched instead of assuming which form reached this function.
  if (/(近三天|近3天|三天|3\s*天|最近三天|最近3天)/.test(value)) return "3d";
  if (/(近七天|近7天|七天|7\s*天|一周|1\s*周|最近一周|最近1周|上个星期|上周)/.test(value)) return "7d";
  if (/(近一个月|近1个月|一个月|1\s*个月|30\s*天|上月|最近一个月|最近1个月)/.test(value)) return "30d";
  if (/(近半年|半年|六个月|6\s*个月|180\s*天)/.test(value)) return "180d";
  if (/(近一年|近1年|一年|1\s*年|12\s*个月|365\s*天|最近一年|最近1年)/.test(value)) return "365d";
  return null;
};

const findAmount = (value: string) => {
  const captured = captureNumber(value, ["金额", "房费", "押金", "总价", "总金额", "改成", "改到", "调整为"]);
  if (!captured || !/^\d{1,5}$/.test(captured)) return null;
  return Number(captured);
};

export function routeAdminIntent(text: string, context?: { pending_action_id?: string }): AdminAssistantResult {
  const normalized = normalizeSpokenDigits(text.trim().replace(/\s+/g, " "));
  const phoneLast4 = findLast4(normalized);
  if (/(取消|不要|算了|不换)/.test(normalized) && context?.pending_action_id) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.cancel_pending_action", arguments: { action_id: context.pending_action_id, reason: "管理员取消" }, response_hint: "将取消待确认动作，不修改 PMS。" };
  }
  if (/(确认|确定|执行|没问题|可以)/.test(normalized) && context?.pending_action_id) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.confirm_pending_action", arguments: { action_id: context.pending_action_id, confirmation: "CONFIRM" }, response_hint: "将重新核对权限和业务状态后执行，并写入管理员审计。" };
  }
  if (/(清理|清除|清空|归档|删除|删掉|清掉|去掉)/.test(normalized) && /(已退房|退房|历史|闭环|记录|数据)/.test(normalized)) {
    const range = findRetentionRange(normalized);
    if (!range) return { type: "clarification", message: "请说明要清理哪个时间范围：近三天、近七天、近一个月、近半年还是近一年。", intent: "purge_closed_loops", confidence: 0.93 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.prepare_purge_closed_loops", arguments: { range }, response_hint: "先生成清理确认单，确认前不会删除任何记录；只会删除已退房的闭环，在住客人与其账本不受影响。" };
  }
  if (/(需要|要|麻烦|送|补)/.test(normalized) && /(打扫|清洁|维修|报修|物品|毛巾|浴巾|拖鞋)/.test(normalized)) {
    const roomNumber = findRoomForCleaning(normalized);
    if (!roomNumber) return { type: "clarification", message: "请说是哪间房需要服务，例如：1206 需要打扫。", intent: "room_service_need", confidence: 0.93 };
    const need = /(维修|报修|坏了)/.test(normalized) ? "maintenance" : /(物品|毛巾|浴巾|拖鞋|补)/.test(normalized) ? "supplies" : "cleaning";
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.set_room_service_need", arguments: { room_number: roomNumber, need }, response_hint: "只记录这间房当前需要什么服务并写入审计，不动房态也不动账务。" };
  }
  if (/(打扫|清洁|收拾好|清理)/.test(normalized)) {
    const roomNumber = findRoomForCleaning(normalized);
    if (!roomNumber) return { type: "clarification", message: "请说打扫好的房号，例如：1208 已经打扫完成。", intent: "mark_room_clean", confidence: 0.94 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.mark_room_clean", arguments: { room_number: roomNumber, reason: "客房打扫完成" }, response_hint: "只把待清洁的房间改为可售，并写入房态流水与管理员审计。" };
  }
  if (/(换房|换到|改到|搬到|调到)/.test(normalized)) {
    const targetRoom = findRoom(normalized);
    if (!phoneLast4 && !/(订单|客人|住客)/.test(normalized)) return { type: "clarification", message: "请说客人手机号后四位和目标房号，例如：把尾号4821换到1306。", intent: "room_change", confidence: 0.92 };
    if (!phoneLast4) return { type: "clarification", message: "请先说客人手机号后四位，我不能猜是哪位客人。", intent: "room_change", confidence: 0.96 };
    if (!targetRoom) return { type: "clarification", message: "请告诉我目标房号，例如 1306。", intent: "room_change", confidence: 0.96 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.search_guest", arguments: { phone_last4: phoneLast4 }, response_hint: "先展示候选订单并核对当前房间，再检查目标房态和生成换房确认单。", workflow: { kind: "room_change", target_room: targetRoom, stage: "guest_search" } } as AdminToolCall;
  }
  if (/(改金额|修改金额|调整金额|金额改|房费改|押金改|总价改|补收|减免)/.test(normalized)) {
    const amount = findAmount(normalized);
    if (!phoneLast4) return { type: "clarification", message: "请说订单手机号后四位或订单号，我不能猜要改哪笔金额。", intent: "amount_adjustment", confidence: 0.94 };
    if (amount === null) return { type: "clarification", message: "请说清楚要改成多少元，例如：把尾号4821的总金额改成298。", intent: "amount_adjustment", confidence: 0.94 };
    const amountType = /押金/.test(normalized) ? "deposit_amount" : /房费/.test(normalized) ? "room_amount" : "total_amount";
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.prepare_amount_adjustment", arguments: { phone_last4: phoneLast4, amount_type: amountType, new_amount: amount, reason: "管理员语音金额调整请求" }, response_hint: "只生成金额调整确认单，不会立即改库。" };
  }
  if (/(发房卡|制作房卡|重发房卡|补发房卡|重新发卡|发卡)/.test(normalized)) {
    if (!phoneLast4 && !findRoom(normalized)) return { type: "clarification", message: "请说客人手机号后四位或房号，我需要先确认是哪位客人。", intent: "keycard_issue", confidence: 0.92 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.prepare_keycard_issue", arguments: { ...(phoneLast4 ? { phone_last4: phoneLast4 } : {}), ...(findRoom(normalized) ? { room_number: findRoom(normalized) } : {}), reason: "管理员语音发卡请求" }, response_hint: "只生成发卡确认单，点击确认后才调用发卡机工具。" };
  }
  if (/(公安|旅业|住宿登记|实名登记|提交登记|补交登记)/.test(normalized)) {
    if (!phoneLast4) return { type: "clarification", message: "请说客人手机号后四位或订单号，我需要先定位登记对象。", intent: "police_submission", confidence: 0.94 };
    const region = /珠海/.test(normalized) ? "珠海" : "广州";
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.prepare_police_submission", arguments: { phone_last4: phoneLast4, region, reason: "管理员语音公安登记请求" }, response_hint: "只生成公安登记确认单，点击确认后才提交仿真公安工具。" };
  }
  if (/(房态|房间状态|房号)[^。！？!?]*[0-9]{3,5}/.test(normalized)) {
    const roomNumber = normalized.match(/[0-9]{3,5}/)?.[0];
    if (roomNumber) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.get_room_status", arguments: { room_number: roomNumber }, response_hint: "只查询房态，不修改数据。" };
  }
  if (/(在住|在店)/.test(normalized) && /(客人|住客|列表|情况|概览|看板|谁)/.test(normalized)) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.list_in_house_guests", arguments: {}, response_hint: "列出在住客人的房号、脱敏信息、账务和是否需要服务；只读。" };
  }
  if (/(知识库|政策库|门店政策|政策文档)/.test(normalized)) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.list_knowledge_documents", arguments: {}, response_hint: "列出这家店的知识文档与状态；只读。改动政策必须在政策录入界面填写表单并确认。" };
  }
  if (/(数据库|数据表|有哪些表|表结构|schema)/.test(normalized) || /[a-z_]{3,40}\s*表/.test(normalized)) {
    const table = normalized.match(/([a-z_]{3,40})\s*表/)?.[1];
    if (table) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.get_table_rows", arguments: { table, limit: 20 }, response_hint: "只读预览这张表的前若干行，凭据类字段会脱敏。" };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.get_database_schema", arguments: {}, response_hint: "列出数据库里有哪些表以及各自的行数；只读。" };
  }
  if (phoneLast4 || /(查一下|查询|客人信息|住客信息|订单|谁在)/.test(normalized)) {
    if (!phoneLast4) return { type: "clarification", message: "请说客人手机号后四位或订单号，我不会根据姓名猜测客人。", intent: "search_guest", confidence: 0.95 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.search_guest", arguments: { phone_last4: phoneLast4 }, response_hint: "只返回脱敏客人和订单信息。" };
  }
  return { type: "clarification", message: "我可以帮您查询客人、查询房态，或准备换房。换房需要先核对信息，再明确说“确认执行”。", intent: "admin_assistance", confidence: 0.78 };
}

export function isRoomNumber(value: string) {
  return /^\d{3,5}$/.test(String(value ?? "").trim());
}

export function parseAmount(value: string) {
  const matches = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  if (!matches) return null;
  return Number(matches[matches.length - 1]);
}
