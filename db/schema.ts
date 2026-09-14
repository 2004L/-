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
