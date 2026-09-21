import { agentTurnSchema, extractPhoneNumber, routeIntent, toolArgumentSchemas, toolNames, type AssistantMessage, type Clarification, type ToolCall } from "@/lib/tools";
import { llmConfig, streamModel } from "@/lib/llm";
import { recordAiMetric, requestId } from "@/lib/ops";
import { recordGuestAiTurn } from "@/lib/ai-control";
import { withIntentEnvelope, type IntentSource } from "@/lib/intent-envelope";

export const runtime = "edge";

type AgentResult = ToolCall | Clarification | AssistantMessage;

const criticalFields = ["phone_last4", "phone_number", "from_room", "to_room", "room_number", "new_amount", "amount_type", "region"];

function reconcileAgentResult(modelResult: AgentResult | null, fallbackResult: AgentResult): { result: AgentResult; source: IntentSource } {
  // The model is the primary interpreter. Rules only provide a safe, schema-checked
  // fallback when the model is unavailable or fails to produce a usable plan.
  if (!modelResult) return { result: fallbackResult, source: "rule_fallback" };
  if (modelResult.type === "tool_call" && fallbackResult.type === "tool_call") {
    const conflicts = criticalFields.filter((field) => {
      const modelValue = modelResult.arguments[field];
      const fallbackValue = fallbackResult.arguments[field];
      return modelValue !== undefined && fallbackValue !== undefined && String(modelValue) !== String(fallbackValue);
    });
    if (conflicts.length > 0) {
      return {
        result: { type: "clarification", message: `我识别到${conflicts.join("、")}存在差异，请核对数字后再继续。`, intent: "critical_field_conflict", confidence: 0.4 },
        source: "safety_guard",
      };
    }
  }
  // A model refusal or empty natural-language answer must not hide a hotel action.
  // In that case the validated rule result is a controlled fallback, never a direct DB write.
  if (modelResult.type === "assistant_message" && fallbackResult.type === "tool_call") return { result: fallbackResult, source: "rule_fallback" };
  if (modelResult.type === "clarification" && fallbackResult.type === "clarification" && fallbackResult.requires_confirmation) {
    return { result: { ...modelResult, requires_confirmation: true }, source: "model" };
  }
  return { result: modelResult, source: "model" };
}

export async function POST(request: Request) {
  const rid = requestId(request);
  const startedAt = Date.now();
  let metricSessionId: string | null = null;
  const model = llmConfig().model;
  try {
    const input = agentTurnSchema.parse(await request.json());
    metricSessionId = input.session_id;
    const latest = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latest) {
      await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "fallback" });
      return Response.json({ type: "clarification", message: "请告诉我您想办理什么。", intent: "general_assistance", confidence: 0.5 }, { headers: { "X-Request-ID": rid } });
    }
    const recentHistory = input.messages.slice(-6).map((message) => message.content).join(" ");
    const pendingWalkIn = !input.walk_in_draft_id && /(现场(?:办理|入住|预订)|没有?预订|直接(?:入住|住)|walk[- ]?in)/i.test(recentHistory);
    // The browser owns the currently confirmed candidate. Never reconstruct it
    // from conversation history: an old number must not survive a correction.
    const pendingWalkInPhone = input.pending_walk_in_phone;
    const ruleResult = routeIntent(latest.content, { case_id: input.case_id, pending_walk_in: pendingWalkIn, pending_walk_in_phone: pendingWalkInPhone, walk_in_draft_id: input.walk_in_draft_id, walk_in_draft_status: input.walk_in_draft_status });
    const recordTurn = async (result: AgentResult, source: IntentSource) => {
      try {
        await recordGuestAiTurn({ sessionId: input.session_id, conversationId: input.conversation_id, caseId: input.case_id, requestId: rid, utterance: latest.content, result, source });
      } catch (error) {
        console.warn("ai_control_record_failed", error instanceof Error ? error.message : "unknown");
      }
    };
    try {
      const modelResult = await streamModel(input.messages, { case_id: input.case_id });
      if (!modelResult) {
        await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "fallback" });
        const fallback = withIntentEnvelope(ruleResult, "rule_fallback");
        await recordTurn(ruleResult, "rule_fallback");
        return Response.json(fallback, { headers: { "X-Request-ID": rid } });
      }
      const encoder = new TextEncoder();
      const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let text = "";
          let toolResponse: Record<string, unknown> | null = null;
          let outcome: "success" | "fallback" | "error" = "success";
          // 先发一个事件并定时心跳，避免模型首 token 较慢时被浏览器或代理判定为断开。
          send(controller, { type: "start" });
          const heartbeat = setInterval(() => send(controller, { type: "ping" }), 5000);
          try {
            for await (const part of modelResult.fullStream) {
              if (part.type === "text-delta") {
                text += part.text;
                send(controller, { type: "text_delta", delta: part.text });
              } else if (part.type === "tool-call") {
                const toolName = toolNames.find((candidate) => candidate.replaceAll(".", "_") === part.toolName);
                const parsed = toolName ? toolArgumentSchemas[toolName].safeParse(part.input) : null;
                if (toolName && parsed?.success) toolResponse = { type: "tool_call", tool_call_id: part.toolCallId, tool_name: toolName, arguments: parsed.data, implementation: toolName.startsWith("device.") || toolName.startsWith("police.") ? "simulator" : "business_api" };
              } else if (part.type === "error") {
                send(controller, { type: "error", message: "模型暂时不可用" });
              }
            }
            const modelResponse = toolResponse as AgentResult | null ?? (text.trim() ? { type: "assistant_message" as const, message: text.trim() } : null);
            const reconciled = reconcileAgentResult(modelResponse, ruleResult);
            const response = withIntentEnvelope(reconciled.result, reconciled.source);
            await recordTurn(reconciled.result, reconciled.source);
            send(controller, { type: "done", response });
          } catch (error) {
            outcome = "fallback";
            await recordTurn(ruleResult, "rule_fallback");
            send(controller, { type: "fallback", response: withIntentEnvelope(ruleResult, "rule_fallback"), message: error instanceof Error ? error.message : "stream_failed" });
          } finally {
            clearInterval(heartbeat);
            await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome });
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Request-ID": rid } });
    } catch (error) {
      console.warn("llm_unavailable_fallback_to_rules", error instanceof Error ? error.message : "unknown");
    }
    await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "fallback" });
    await recordTurn(ruleResult, "rule_fallback");
    return Response.json(withIntentEnvelope(ruleResult, "rule_fallback"), { headers: { "X-Request-ID": rid } });
  } catch {
    await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "error" });
    return Response.json({ type: "clarification", message: "我没有安全解析这句话，请换一种说法。", intent: "invalid_input", confidence: 0 }, { status: 400, headers: { "X-Request-ID": rid } });
  }
}
