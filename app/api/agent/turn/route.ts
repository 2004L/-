import { agentTurnSchema, extractPhoneNumber, routeIntent, toolArgumentSchemas, toolNames } from "@/lib/tools";
import { llmConfig, streamModel } from "@/lib/llm";
import { recordAiMetric, requestId } from "@/lib/ops";

export const runtime = "edge";

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
    const pendingWalkInPhone = pendingWalkIn ? extractPhoneNumber(recentHistory) ?? undefined : undefined;
    const ruleResult = routeIntent(latest.content, { case_id: input.case_id, pending_walk_in: pendingWalkIn, pending_walk_in_phone: pendingWalkInPhone, walk_in_draft_id: input.walk_in_draft_id, walk_in_draft_status: input.walk_in_draft_status });
    try {
      const modelResult = await streamModel(input.messages, { case_id: input.case_id });
      if (!modelResult) {
        await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "fallback" });
        return Response.json(ruleResult, { headers: { "X-Request-ID": rid } });
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
                const parsed = toolName ? toolArgumentSchemas[toolName].safeParse(part.input) : { success: false };
                if (toolName && parsed.success) toolResponse = { type: "tool_call", tool_call_id: part.toolCallId, tool_name: toolName, arguments: parsed.data, implementation: toolName.startsWith("device.") || toolName.startsWith("police.") ? "simulator" : "business_api" };
              } else if (part.type === "error") {
                send(controller, { type: "error", message: "模型暂时不可用" });
              }
            }
            const looksLikeRefusal = /只能处理酒店|无法为您编写|不能编写|酒店自助入住助手/.test(text);
            // 订单、身份、公安和房卡动作以本地规则为准；模型只能补充话术，不能把安全动作改成普通回复。
            const deterministicSafetyResult = ruleResult.type === "tool_call" || (ruleResult.type === "clarification" && ruleResult.intent !== "general_assistance") ? ruleResult : null;
            const response = deterministicSafetyResult ?? toolResponse ?? (ruleResult.type === "assistant_message" && looksLikeRefusal ? ruleResult : text.trim() ? { type: "assistant_message", message: text.trim() } : ruleResult);
            send(controller, { type: "done", response });
          } catch (error) {
            outcome = "fallback";
            send(controller, { type: "fallback", response: ruleResult, message: error instanceof Error ? error.message : "stream_failed" });
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
    return Response.json(ruleResult, { headers: { "X-Request-ID": rid } });
  } catch {
    await recordAiMetric({ requestId: rid, sessionId: metricSessionId, route: "/api/agent/turn", model, latencyMs: Date.now() - startedAt, outcome: "error" });
    return Response.json({ type: "clarification", message: "我没有安全解析这句话，请换一种说法。", intent: "invalid_input", confidence: 0 }, { status: 400, headers: { "X-Request-ID": rid } });
  }
}
