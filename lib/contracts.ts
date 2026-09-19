import { z } from "zod";

export const commandStatuses = ["PENDING", "ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN", "MANUAL_REQUIRED"] as const;
export const commandStatusSchema = z.enum(commandStatuses);
export const targetSchema = z.enum(["reader", "encoder", "police"]);

export const commonCommandSchema = z.object({
  session_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  case_id: z.string().min(8).max(80),
  idempotency_key: z.string().min(1).max(120),
  expected_state: z.string().min(1).max(80),
  device_id: z.string().min(1).max(80).default("demo-simulator"),
}).strict();

export const readerCommandSchema = commonCommandSchema.extend({
  operation: z.literal("read_identity"),
});

export const encoderCommandSchema = commonCommandSchema.extend({
  operation: z.literal("issue_keycard"),
  room_number: z.string().regex(/^\d{3,5}$/),
  valid_until: z.string().datetime().optional(),
});

export const policeCommandSchema = commonCommandSchema.extend({
  operation: z.literal("submit_registration"),
  actual_identity_verified: z.literal(true),
  identity_token: z.string().min(8).max(120),
});

export const faultSchema = z.object({
  session_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  case_id: z.string().min(8).max(80).nullable().optional(),
  target: targetSchema,
  fault_type: z.string().min(2).max(80),
  trigger_on_call: z.number().int().min(1).max(1000).default(1),
  repeat_count: z.number().int().min(1).max(1000).default(1),
  auto_reset: z.boolean().default(true),
}).strict();

export type CommandStatus = z.infer<typeof commandStatusSchema>;
export type CommandTarget = z.infer<typeof targetSchema>;

export const faultCatalog = {
  reader: ["reader_timeout", "reader_offline", "duplicate_read", "identity_mismatch"],
  encoder: ["encoder_offline", "write_failed", "readback_mismatch", "output_jammed", "card_not_collected", "encoder_timeout"],
  police: ["captcha_required", "system_maintenance", "certificate_error", "submission_rejected", "receipt_lost", "police_timeout"],
} as const;
