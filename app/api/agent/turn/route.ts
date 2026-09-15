import { agentTurnSchema, routeIntent } from "@/lib/tools";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = agentTurnSchema.parse(await request.json());
    const latest = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latest) return Response.json({ type: "clarification", message: "请告诉我您想办理什么。", intent: "general_assistance", confidence: 0.5 });
    return Response.json(routeIntent(latest.content, { case_id: input.case_id }));
  } catch {
    return Response.json({ type: "clarification", message: "我没有安全解析这句话，请换一种说法。", intent: "invalid_input", confidence: 0 }, { status: 400 });
  }
}
