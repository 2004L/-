import { agentTurnSchema, routeIntent, toolArgumentSchemas, toolNames } from "@/lib/tools";
import { streamModel } from "@/lib/llm";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = agentTurnSchema.parse(await request.json());
    const latest = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latest) return Response.json({ type: "clarification", message: "请告诉我您想办理什么。", intent: "general_assistance", confidence: 0.5 });
    const ruleResult = routeIntent(latest.content, { case_id: input.case_id });
    try {
      const modelResult = await streamModel(input.messages, { case_id: input.case_id });
      if (!modelResult) return Response.json(ruleResult);
      const encoder = new TextEncoder();
      const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let text = "";
          let toolResponse: Record<string, unknown> | null = null;
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
            const response = toolResponse ?? (ruleResult.type === "assistant_message" && looksLikeRefusal ? ruleResult : text.trim() ? { type: "assistant_message", message: text.trim() } : ruleResult);
            send(controller, { type: "done", response });
          } catch (error) {
            send(controller, { type: "fallback", response: ruleResult, message: error instanceof Error ? error.message : "stream_failed" });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
    } catch (error) {
      console.warn("llm_unavailable_fallback_to_rules", error instanceof Error ? error.message : "unknown");
    }
    return Response.json(ruleResult);
  } catch {
    return Response.json({ type: "clarification", message: "我没有安全解析这句话，请换一种说法。", intent: "invalid_input", confidence: 0 }, { status: 400 });
  }
}
