import type { AdminAssistantResult } from "./admin-tools";
import type { AssistantMessage, Clarification, ToolCall } from "./tools";

export type IntentSource = "model" | "rule_fallback" | "safety_guard";
export type IntentClass = "hotel" | "general";
export type IntentRisk = "none" | "low" | "medium" | "high";

export type IntentEnvelope = {
  intent: string;
  intent_class: IntentClass;
  entities: Record<string, string | number | null>;
  missing_fields: string[];
  next_action: string;
  risk: IntentRisk;
  requires_confirmation: boolean;
  confidence: number;
  source: IntentSource;
};

export type IntentBearing<T> = T & { intent_envelope: IntentEnvelope };

const writeTools = new Set([
  "pms.create_walk_in_draft",
  "pms.create_walk_in",
  "payment.create",
  "device.reader.read_identity",
  "device.encoder.issue_keycard",
  "police.submit_registration",
  "admin.prepare_room_change",
  "admin.prepare_amount_adjustment",
  "admin.prepare_keycard_issue",
  "admin.prepare_police_submission",
  "admin.confirm_pending_action",
  "admin.confirm_room_change",
]);

function intentFromTool(toolName: string) {
  if (toolName.includes("search_order") || toolName.includes("search_guest")) return "query_reservation";
  if (toolName.includes("room_change")) return "room_change";
  if (toolName.includes("amount") || toolName.includes("payment")) return "payment_or_amount";
  if (toolName.includes("keycard")) return "keycard";
  if (toolName.includes("police")) return "police_registration";
  if (toolName.includes("identity")) return "identity_verification";
  if (toolName.includes("room_status")) return "room_status";
  if (toolName.includes("walk_in")) return "walk_in";
  if (toolName.includes("policy")) return "hotel_policy";
  return toolName;
}

function envelopeForTool(result: ToolCall | AdminAssistantResult & { type: "tool_call" }, source: IntentSource): IntentEnvelope {
  const toolName = result.tool_name;
  const entities = Object.fromEntries(Object.entries(result.arguments).map(([key, value]) => [key, typeof value === "string" || typeof value === "number" ? value : null]));
  const highRisk = writeTools.has(toolName) || toolName.includes("prepare_");
  return {
    intent: intentFromTool(toolName),
    intent_class: "hotel",
    entities,
    missing_fields: [],
    next_action: toolName,
    risk: highRisk ? "high" : "low",
    requires_confirmation: highRisk,
    confidence: 1,
    source,
  };
}

export function buildIntentEnvelope(result: ToolCall | Clarification | AssistantMessage | AdminAssistantResult, source: IntentSource): IntentEnvelope {
  if (result.type === "tool_call") return envelopeForTool(result, source);
  if (result.type === "clarification") {
    const hotel = result.intent !== "general_assistance" && result.intent !== "invalid_input";
    return {
      intent: result.intent,
      intent_class: hotel ? "hotel" : "general",
      entities: {},
      missing_fields: [],
      next_action: "clarify",
      risk: hotel ? "medium" : "none",
      requires_confirmation: result.requires_confirmation === true,
      confidence: result.confidence,
      source,
    };
  }
  return {
    intent: "general_assistance",
    intent_class: "general",
    entities: {},
    missing_fields: [],
    next_action: "respond",
    risk: "none",
    requires_confirmation: false,
    confidence: 1,
    source,
  };
}

export function withIntentEnvelope<T extends ToolCall | Clarification | AssistantMessage | AdminAssistantResult>(result: T, source: IntentSource): IntentBearing<T> {
  return { ...result, intent_envelope: buildIntentEnvelope(result, source) };
}
