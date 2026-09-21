import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const demoSessions = sqliteTable("demo_sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  hotelId: text("hotel_id"),
  hotelCode: text("hotel_code").notNull().default("GZ-DEMO-001"),
  city: text("city").notNull().default("广州"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoOrders = sqliteTable(
  "demo_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    roomAmount: integer("room_amount").notNull().default(380),
    depositAmount: integer("deposit_amount").notNull().default(300),
    totalAmount: integer("total_amount").notNull().default(680),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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
    tenantId: text("tenant_id"),
    hotelId: text("hotel_id"),
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

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  stayId: text("stay_id").notNull(),
  paymentType: text("payment_type").notNull(),
  method: text("method").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("CNY"),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("payments_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("payments_hotel_stay_idx").on(table.hotelId, table.stayId, table.createdAt)]);

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  paymentId: text("payment_id").notNull(),
  stayId: text("stay_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("CNY"),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("refunds_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("refunds_hotel_stay_idx").on(table.hotelId, table.stayId, table.createdAt)]);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  hotelId: text("hotel_id"),
  hotelCode: text("hotel_code").notNull(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt"),
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
  tenantId: text("tenant_id"),
  hotelId: text("hotel_id"),
  requestId: text("request_id"),
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
  tenantId: text("tenant_id"),
  hotelId: text("hotel_id"),
  workflowId: text("workflow_id"),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  requestJson: text("request_json").notNull(),
  resultJson: text("result_json"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("admin_actions_user_status_idx").on(table.userId, table.status, table.createdAt)]);

export const aiRequestMetrics = sqliteTable("ai_request_metrics", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  sessionId: text("session_id"),
  tenantId: text("tenant_id"),
  hotelId: text("hotel_id"),
  route: text("route").notNull(),
  model: text("model").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  outcome: text("outcome").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("ai_request_metrics_created_idx").on(table.createdAt)]);

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("brands_tenant_code_uq").on(table.tenantId, table.code)]);

export const hotels = sqliteTable("hotels", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  brandId: text("brand_id").references(() => brands.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  currency: text("currency").notNull().default("CNY"),
  businessDate: text("business_date"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("hotels_tenant_code_uq").on(table.tenantId, table.code), index("hotels_tenant_idx").on(table.tenantId)]);

export const hotelTerminals = sqliteTable("hotel_terminals", {
  id: text("id").primaryKey(),
  hotelId: text("hotel_id").notNull().references(() => hotels.id),
  terminalCode: text("terminal_code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("active"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("hotel_terminals_code_uq").on(table.hotelId, table.terminalCode)]);

export const userHotelScopes = sqliteTable("user_hotel_scopes", {
  userId: text("user_id").notNull(),
  hotelId: text("hotel_id").notNull().references(() => hotels.id),
  scopeRole: text("scope_role").notNull().default("member"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("user_hotel_scopes_uq").on(table.userId, table.hotelId), index("user_hotel_scopes_hotel_idx").on(table.hotelId)]);

export const aiWorkflows = sqliteTable("ai_workflows", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  terminalId: text("terminal_id"),
  sessionId: text("session_id"),
  conversationId: text("conversation_id"),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  intent: text("intent"),
  status: text("status").notNull().default("active"),
  currentStep: text("current_step"),
  contextJson: text("context_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("ai_workflows_hotel_status_idx").on(table.hotelId, table.status, table.updatedAt)]);

export const aiIntents = sqliteTable("ai_intents", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => aiWorkflows.id),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  requestId: text("request_id").notNull(),
  source: text("source").notNull(),
  rawTextRedacted: text("raw_text_redacted").notNull(),
  intent: text("intent").notNull(),
  confidence: integer("confidence"),
  argumentsJson: text("arguments_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("ai_intents_workflow_idx").on(table.workflowId, table.createdAt), index("ai_intents_hotel_idx").on(table.hotelId, table.createdAt)]);

export const aiPlans = sqliteTable("ai_plans", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => aiWorkflows.id),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  planJson: text("plan_json").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("ai_plans_workflow_idx").on(table.workflowId, table.updatedAt)]);

export const aiToolCalls = sqliteTable("ai_tool_calls", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => aiWorkflows.id),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  requestId: text("request_id").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  argumentsJson: text("arguments_json").notNull(),
  resultJson: text("result_json"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [uniqueIndex("ai_tool_calls_request_call_uq").on(table.requestId, table.toolCallId), index("ai_tool_calls_workflow_idx").on(table.workflowId, table.createdAt)]);

export const policyDecisions = sqliteTable("policy_decisions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  riskLevel: text("risk_level").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("policy_decisions_workflow_idx").on(table.workflowId, table.createdAt), index("policy_decisions_hotel_idx").on(table.hotelId, table.createdAt)]);

// Phase 2: formal hotel core domain. These tables are the source of truth for
// production data; demo_orders remains a compatibility projection for fixtures.
export const roomTypes = sqliteTable("room_types", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  pmsCode: text("pms_code"),
  maxOccupancy: integer("max_occupancy").notNull().default(2),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("room_types_hotel_code_uq").on(table.hotelId, table.code), index("room_types_hotel_active_idx").on(table.hotelId, table.active)]);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  roomTypeId: text("room_type_id").notNull(),
  roomNumber: text("room_number").notNull(),
  floor: integer("floor"),
  status: integer("status").notNull().default(0),
  version: integer("version").notNull().default(1),
  pmsRoomId: text("pms_room_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("rooms_hotel_number_uq").on(table.hotelId, table.roomNumber), index("rooms_hotel_status_idx").on(table.hotelId, table.status), index("rooms_hotel_type_status_idx").on(table.hotelId, table.roomTypeId, table.status)]);

export const roomStatusLogs = sqliteTable("room_status_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  roomId: text("room_id").notNull(),
  fromStatus: integer("from_status"),
  toStatus: integer("to_status").notNull(),
  reason: text("reason").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("room_status_logs_hotel_room_idx").on(table.hotelId, table.roomId, table.createdAt), index("room_status_logs_request_idx").on(table.requestId)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  orderNo: text("order_no").notNull(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  status: integer("status").notNull().default(0),
  currency: text("currency").notNull().default("CNY"),
  roomAmount: integer("room_amount").notNull().default(0),
  depositAmount: integer("deposit_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  paidAmount: integer("paid_amount").notNull().default(0),
  guestNameMasked: text("guest_name_masked"),
  phoneLast4: text("phone_last4"),
  reservationNo: text("reservation_no"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("orders_hotel_no_uq").on(table.hotelId, table.orderNo), uniqueIndex("orders_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("orders_hotel_status_idx").on(table.hotelId, table.status, table.updatedAt), index("orders_hotel_phone_idx").on(table.hotelId, table.phoneLast4)]);

export const reservations = sqliteTable("reservations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  reservationNo: text("reservation_no").notNull(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  guestNameMasked: text("guest_name_masked").notNull(),
  phoneLast4: text("phone_last4").notNull(),
  phoneHash: text("phone_hash"),
  status: integer("status").notNull().default(0),
  stayDate: text("stay_date").notNull(),
  nights: integer("nights").notNull().default(1),
  roomCount: integer("room_count").notNull().default(1),
  totalAmount: integer("total_amount").notNull().default(0),
  depositAmount: integer("deposit_amount").notNull().default(0),
  currency: text("currency").notNull().default("CNY"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("reservations_hotel_no_uq").on(table.hotelId, table.reservationNo), uniqueIndex("reservations_hotel_source_external_uq").on(table.hotelId, table.source, table.externalId), uniqueIndex("reservations_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("reservations_hotel_phone_status_idx").on(table.hotelId, table.phoneLast4, table.status), index("reservations_hotel_stay_idx").on(table.hotelId, table.stayDate, table.status)]);

export const reservationRooms = sqliteTable("reservation_rooms", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  reservationId: text("reservation_id").notNull(),
  roomTypeId: text("room_type_id").notNull(),
  roomId: text("room_id"),
  nightlyRate: integer("nightly_rate").notNull().default(0),
  status: integer("status").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("reservation_rooms_hotel_reservation_idx").on(table.hotelId, table.reservationId), index("reservation_rooms_hotel_room_idx").on(table.hotelId, table.roomId)]);

export const reservationStatusLogs = sqliteTable("reservation_status_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  reservationId: text("reservation_id").notNull(),
  fromStatus: integer("from_status"),
  toStatus: integer("to_status").notNull(),
  reason: text("reason").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("reservation_status_logs_hotel_reservation_idx").on(table.hotelId, table.reservationId, table.createdAt)]);

export const stays = sqliteTable("stays", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  reservationId: text("reservation_id"),
  guestNameMasked: text("guest_name_masked").notNull(),
  phoneLast4: text("phone_last4").notNull(),
  identityToken: text("identity_token"),
  status: integer("status").notNull().default(0),
  checkedInAt: text("checked_in_at"),
  checkedOutAt: text("checked_out_at"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("stays_hotel_status_idx").on(table.hotelId, table.status), index("stays_hotel_reservation_idx").on(table.hotelId, table.reservationId)]);

export const folios = sqliteTable("folios", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  stayId: text("stay_id").notNull(),
  status: text("status").notNull().default("open"),
  currency: text("currency").notNull().default("CNY"),
  balance: integer("balance").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("folios_hotel_stay_uq").on(table.hotelId, table.stayId), index("folios_hotel_status_idx").on(table.hotelId, table.status)]);

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  folioId: text("folio_id").notNull(),
  entryType: text("entry_type").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("CNY"),
  idempotencyKey: text("idempotency_key").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("ledger_entries_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("ledger_entries_hotel_folio_idx").on(table.hotelId, table.folioId, table.createdAt)]);

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  workflowType: text("workflow_type").notNull(),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  status: text("status").notNull().default("pending"),
  currentStep: text("current_step"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("workflow_runs_hotel_idempotency_uq").on(table.hotelId, table.idempotencyKey), index("workflow_runs_hotel_status_idx").on(table.hotelId, table.status, table.updatedAt)]);

export const workflowSteps = sqliteTable("workflow_steps", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  hotelId: text("hotel_id").notNull(),
  workflowRunId: text("workflow_run_id").notNull(),
  stepKey: text("step_key").notNull(),
  status: text("status").notNull().default("pending"),
  attempt: integer("attempt").notNull().default(0),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json"),
  errorCode: text("error_code"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("workflow_steps_run_key_uq").on(table.workflowRunId, table.stepKey), index("workflow_steps_hotel_status_idx").on(table.hotelId, table.status, table.updatedAt)]);
