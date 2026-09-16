import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const demoSessions = sqliteTable("demo_sessions", {
  id: text("id").primaryKey(),
  hotelCode: text("hotel_code").notNull().default("GZ-DEMO-001"),
  city: text("city").notNull().default("广州"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoOrders = sqliteTable(
  "demo_orders",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => demoSessions.id, { onDelete: "cascade" }),
    orderCode: text("order_code").notNull(),
    source: text("source").notNull(),
    guestLabel: text("guest_label").notNull(),
    phoneLast4: text("phone_last4").notNull(),
    phoneMasked: text("phone_masked").notNull(),
    stayDate: text("stay_date").notNull(),
    nights: integer("nights").notNull().default(1),
    roomCount: integer("room_count").notNull().default(1),
    roomType: text("room_type").notNull(),
    status: text("status").notNull(),
    roomNumber: text("room_number"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("demo_orders_session_order_uq").on(table.sessionId, table.orderCode),
    index("demo_orders_session_phone_status_idx").on(
      table.sessionId,
      table.phoneLast4,
      table.status
    ),
  ]
);

export const checkinCases = sqliteTable(
  "checkin_cases",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => demoSessions.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => demoOrders.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    phoneLast4: text("phone_last4").notNull(),
    identityResult: text("identity_result"),
    roomNumber: text("room_number"),
    policeReceipt: text("police_receipt"),
    hardwareStatus: text("hardware_status").notNull().default("not_started"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("checkin_cases_session_order_status_idx").on(
      table.sessionId,
      table.orderId,
      table.status
    ),
  ]
);

export const browserJobs = sqliteTable(
  "browser_jobs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => demoSessions.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .unique()
      .references(() => checkinCases.id, { onDelete: "cascade" }),
    region: text("region").notNull().default("广州-演示隔离环境"),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    receipt: text("receipt"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("browser_jobs_session_status_idx").on(table.sessionId, table.status)]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => demoSessions.id, { onDelete: "cascade" }),
    caseId: text("case_id"),
    eventType: text("event_type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_events_session_id_idx").on(table.sessionId, table.id),
    index("audit_events_case_id_idx").on(table.caseId, table.id),
  ]
);

export const externalCommands = sqliteTable(
  "external_commands",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => demoSessions.id, { onDelete: "cascade" }),
    caseId: text("case_id"),
    target: text("target").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull(),
    requestJson: text("request_json").notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    retryable: integer("retryable").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("external_commands_session_idx").on(table.sessionId, table.createdAt),
    index("external_commands_case_idx").on(table.caseId, table.createdAt),
  ]
);

export const simulatorFaults = sqliteTable(
  "simulator_faults",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => demoSessions.id, { onDelete: "cascade" }),
    caseId: text("case_id"),
    target: text("target").notNull(),
    faultType: text("fault_type").notNull(),
    triggerOnCall: integer("trigger_on_call").notNull().default(1),
    repeatCount: integer("repeat_count").notNull().default(1),
    callCount: integer("call_count").notNull().default(0),
    enabled: integer("enabled").notNull().default(1),
    autoReset: integer("auto_reset").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("simulator_faults_lookup_idx").on(table.sessionId, table.target, table.enabled)]
);

export const manualTasks = sqliteTable(
  "manual_tasks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => demoSessions.id, { onDelete: "cascade" }),
    caseId: text("case_id"),
    commandId: text("command_id"),
    department: text("department").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("manual_tasks_session_status_idx").on(table.sessionId, table.status, table.createdAt)]
);

export const walkInDrafts = sqliteTable(
  "walk_in_drafts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => demoSessions.id, { onDelete: "cascade" }),
    phoneToken: text("phone_token").notNull(),
    phoneLast4: text("phone_last4").notNull(),
    phoneMasked: text("phone_masked").notNull(),
    stayDate: text("stay_date").notNull(),
    nights: integer("nights").notNull().default(1),
    roomCount: integer("room_count").notNull().default(1),
    roomTypeCode: text("room_type_code"),
    roomTypeName: text("room_type_name"),
    nightlyRate: integer("nightly_rate"),
    roomAmount: integer("room_amount"),
    depositAmount: integer("deposit_amount"),
    totalAmount: integer("total_amount"),
    status: text("status").notNull(),
    paymentId: text("payment_id"),
    orderId: text("order_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("walk_in_drafts_session_status_idx").on(table.sessionId, table.status, table.createdAt)]
);

export const walkInPayments = sqliteTable(
  "walk_in_payments",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => demoSessions.id, { onDelete: "cascade" }),
    draftId: text("draft_id").notNull().references(() => walkInDrafts.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    receipt: text("receipt"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("walk_in_payments_draft_uq").on(table.draftId)]
);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  hotelCode: text("hotel_code").notNull(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionTokenHash: text("session_token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const adminAuditEvents = sqliteTable("admin_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  username: text("username"),
  role: text("role"),
  eventType: text("event_type").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("admin_audit_created_idx").on(table.createdAt, table.id)]);

export const adminActions = sqliteTable("admin_actions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  requestJson: text("request_json").notNull(),
  resultJson: text("result_json"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("admin_actions_user_status_idx").on(table.userId, table.status, table.createdAt)]);
