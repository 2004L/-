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
  "admin.prepare_room_change": z.object({ order_id: z.string().min(8).max(100), from_room: z.string().regex(/^\d{3,5}$/), to_room: z.string().regex(/^\d{3,5}$/), reason: z.string().min(1).max(200) }).strict(),
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
