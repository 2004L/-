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
] as const;
export type AdminPermission = (typeof adminPermissions)[number];

export const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  owner: adminPermissions,
  manager: ["admin:read_orders", "admin:read_rooms", "admin:room_change", "admin:checkin", "admin:checkout", "admin:device_control", "admin:manage_faults"],
  frontdesk: ["admin:read_orders", "admin:read_rooms", "admin:room_change", "admin:checkin", "admin:checkout"],
  housekeeping: ["admin:read_rooms"],
};

export const adminToolNames = [
  "admin.search_guest",
  "admin.get_room_status",
  "admin.prepare_room_change",
  "admin.confirm_room_change",
  "admin.cancel_room_change",
  "admin.get_audit_records",
] as const;
export type AdminToolName = (typeof adminToolNames)[number];

export const adminToolArgumentSchemas: Record<AdminToolName, z.ZodTypeAny> = {
  "admin.search_guest": z.object({ phone_last4: z.string().regex(/^\d{4}$/).optional(), order_code: z.string().min(4).max(80).optional() }).strict().refine((value) => Boolean(value.phone_last4 || value.order_code)),
  "admin.get_room_status": z.object({ room_number: z.string().regex(/^\d{3,5}$/) }).strict(),
  "admin.prepare_room_change": z.object({ order_id: z.string().min(8).max(100).optional(), phone_last4: z.string().regex(/^\d{4}$/).optional(), from_room: z.string().regex(/^\d{3,5}$/).optional(), to_room: z.string().regex(/^\d{3,5}$/), reason: z.string().min(1).max(200) }).strict().refine((value) => Boolean(value.order_id || value.phone_last4)),
  "admin.confirm_room_change": z.object({ action_id: z.string().min(8).max(100), confirmation: z.literal("CONFIRM") }).strict(),
  "admin.cancel_room_change": z.object({ action_id: z.string().min(8).max(100), reason: z.string().min(1).max(200) }).strict(),
  "admin.get_audit_records": z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict(),
};

export const adminToolPermissions: Record<AdminToolName, AdminPermission> = {
  "admin.search_guest": "admin:read_orders",
  "admin.get_room_status": "admin:read_rooms",
  "admin.prepare_room_change": "admin:room_change",
  "admin.confirm_room_change": "admin:room_change",
  "admin.cancel_room_change": "admin:room_change",
  "admin.get_audit_records": "admin:read_orders",
};

export const adminTurnSchema = z.object({
  conversation_id: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) }).strict()).min(1).max(20),
  pending_action_id: z.string().min(8).max(100).optional(),
}).strict();

export type AdminToolCall = { type: "tool_call"; tool_call_id: string; tool_name: AdminToolName; arguments: Record<string, unknown>; response_hint?: string };
export type AdminAssistantResult = AdminToolCall | { type: "clarification"; message: string; intent: string; confidence: number } | { type: "assistant_message"; message: string };

const spokenDigitMap: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
const normalizeSpokenDigits = (value: string) => [...value].map((character) => spokenDigitMap[character] ?? character).join("");
const digits = (value: string) => normalizeSpokenDigits(value).replace(/[^0-9]/g, "");
const findLast4 = (value: string) => { const normalized = normalizeSpokenDigits(value); return normalized.match(/(?:尾号|后四位|后四个数字|手机号)[^0-9]{0,4}([0-9]{4})/)?.[1] ?? (digits(normalized).length === 4 ? digits(normalized) : null); };
const findRoom = (value: string) => normalizeSpokenDigits(value).match(/(?:房间|房号|换到|改到|搬到|调到)\s*([0-9]{3,5})/)?.[1] ?? null;

export function routeAdminIntent(text: string, context?: { pending_action_id?: string }): AdminAssistantResult {
  const normalized = normalizeSpokenDigits(text.trim().replace(/\s+/g, " "));
  const phoneLast4 = findLast4(normalized);
  if (/(确认|确定|执行|没问题|可以)/.test(normalized) && context?.pending_action_id) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.confirm_room_change", arguments: { action_id: context.pending_action_id, confirmation: "CONFIRM" }, response_hint: "将重新核对房态后执行换房，并写入管理员审计。" };
  }
  if (/(取消|不要|算了|不换)/.test(normalized) && context?.pending_action_id) {
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.cancel_room_change", arguments: { action_id: context.pending_action_id, reason: "管理员取消" }, response_hint: "将取消待确认换房，不修改 PMS。" };
  }
  if (/(换房|换到|改到|搬到|调到)/.test(normalized)) {
    const targetRoom = findRoom(normalized);
    if (!phoneLast4 && !/(订单|客人|住客)/.test(normalized)) return { type: "clarification", message: "请说客人手机号后四位和目标房号，例如：把尾号4821换到1306。", intent: "room_change", confidence: 0.92 };
    if (!phoneLast4) return { type: "clarification", message: "请先说客人手机号后四位，我不能猜是哪位客人。", intent: "room_change", confidence: 0.96 };
    if (!targetRoom) return { type: "clarification", message: "请告诉我目标房号，例如 1306。", intent: "room_change", confidence: 0.96 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.prepare_room_change", arguments: { phone_last4: phoneLast4, to_room: targetRoom, reason: "管理员语音换房请求" }, response_hint: "只生成换房确认单，不会立即修改 PMS。" } as AdminToolCall;
  }
  if (/(房态|房间状态|房号)[^。！？!?]*[0-9]{3,5}/.test(normalized)) {
    const roomNumber = normalized.match(/[0-9]{3,5}/)?.[0];
    if (roomNumber) return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.get_room_status", arguments: { room_number: roomNumber }, response_hint: "只查询房态，不修改数据。" };
  }
  if (phoneLast4 || /(查一下|查询|客人信息|住客信息|订单|谁在)/.test(normalized)) {
    if (!phoneLast4) return { type: "clarification", message: "请说客人手机号后四位或订单号，我不会根据姓名猜测客人。", intent: "search_guest", confidence: 0.95 };
    return { type: "tool_call", tool_call_id: crypto.randomUUID(), tool_name: "admin.search_guest", arguments: { phone_last4: phoneLast4 }, response_hint: "只返回脱敏客人和订单信息。" };
  }
  return { type: "clarification", message: "我可以帮您查询客人、查询房态，或准备换房。换房需要先核对信息，再明确说“确认执行”。", intent: "admin_assistance", confidence: 0.78 };
}
