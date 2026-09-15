import { agentTurnSchema, routeIntent } from "@/lib/tools";
import { askModel } from "@/lib/llm";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = agentTurnSchema.parse(await request.json());
    const latest = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latest) return Response.json({ type: "clarification", message: "请告诉我您想办理什么。", intent: "general_assistance", confidence: 0.5 });
    const ruleResult = routeIntent(latest.content, { case_id: input.case_id });
    try {
      const modelResult = await askModel(input.messages, { case_id: input.case_id });
      if (modelResult) {
        // 某些模型仍会把明确的非酒店问题误判为越界；保留模型优先，
        // 但遇到这种拒答时用本地确定性回答兜底，避免页面无响应。
        const looksLikeRefusal = modelResult.type === "assistant_message" && /只能处理酒店|无法为您编写|不能编写|酒店自助入住助手/.test(modelResult.message);
        if (!(ruleResult.type === "assistant_message" && looksLikeRefusal)) return Response.json(modelResult);
        return Response.json(ruleResult);
      }
    } catch (error) {
      console.warn("llm_unavailable_fallback_to_rules", error instanceof Error ? error.message : "unknown");
    }
    return Response.json(ruleResult);
  } catch {
    return Response.json({ type: "clarification", message: "我没有安全解析这句话，请换一种说法。", intent: "invalid_input", confidence: 0 }, { status: 400 });
  }
}
