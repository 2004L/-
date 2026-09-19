import { adminTurnSchema, routeAdminIntent, type AdminAssistantResult } from "@/lib/admin-tools";
import { ensureAdminSchema, getAdminFromRequest, auditAdmin } from "@/lib/admin-auth";
import { askAdminModel, streamAdminModel } from "@/lib/admin-llm";
import { recordAdminAiTurn } from "@/lib/ai-control";
import { requestId } from "@/lib/ops";
import { withIntentEnvelope } from "@/lib/intent-envelope";

export const runtime = "edge";

function enforceRoomChangeWorkflow(result: AdminAssistantResult): AdminAssistantResult {
  if (result.type !== "tool_call" || result.tool_name !== "admin.prepare_room_change") return result;
  const phoneLast4 = typeof result.arguments.phone_last4 === "string" ? result.arguments.phone_last4 : "";
  const targetRoom = typeof result.arguments.to_room === "string" ? result.arguments.to_room : "";
  if (!/^\d{4}$/.test(phoneLast4) || !/^\d{3,5}$/.test(targetRoom) || result.arguments.order_id) return result;
  return {
    type: "tool_call",
    tool_call_id: result.tool_call_id,
    tool_name: "admin.search_guest",
    arguments: { phone_last4: phoneLast4 },
    response_hint: "先展示候选订单并核对当前房间，再检查目标房态和生成换房确认单。",
    workflow: { kind: "room_change", target_room: targetRoom, stage: "guest_search" },
  };
}

function guardModelResult(modelResult: AdminAssistantResult | null, fallbackResult: AdminAssistantResult, pendingActionId?: string): { result: AdminAssistantResult; source: "model" | "rule_fallback" | "safety_guard" } {
  if (!modelResult) return { result: fallbackResult, source: "rule_fallback" };
  const fallbackTool = fallbackResult.type === "tool_call" ? fallbackResult : null;
  const modelTool = modelResult.type === "tool_call" ? modelResult : null;
  // A cancellation/confirmation phrase is a safety-sensitive control action. If the
  // model disagrees with the deterministic guard, prefer the explicit local guard.
  if (pendingActionId && fallbackTool && ["admin.cancel_pending_action", "admin.confirm_pending_action"].includes(fallbackTool.tool_name)) {
    return { result: fallbackTool, source: "safety_guard" };
  }
  if (modelTool && fallbackTool) {
    const criticalFields = ["phone_last4", "from_room", "to_room", "room_number", "new_amount", "amount_type", "region"];
    const conflicts = criticalFields.filter((field) => {
      const modelValue = modelTool.arguments[field];
      const fallbackValue = fallbackTool.arguments[field];
      return modelValue !== undefined && fallbackValue !== undefined && String(modelValue) !== String(fallbackValue);
    });
    if (conflicts.length > 0) {
      return { result: { type: "clarification", message: `我识别到${conflicts.join("、")}存在差异，请核对输入框中的数字后重新发送。`, intent: "critical_field_conflict", confidence: 0.4 }, source: "safety_guard" };
    }
  }
  return { result: modelResult, source: "model" };
}

export async function POST(request: Request) {
  const rid = requestId(request);
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  try {
    const input = adminTurnSchema.parse(await request.json());
    const latest = [...input.messages].reverse().find((item) => item.role === "user");
    if (!latest) return Response.json({ type: "clarification", message: "请说出要查询或办理的管理员事项。", intent: "admin_assistance", confidence: 0.5 });
    const fallbackResult = routeAdminIntent(latest.content, { pending_action_id: input.pending_action_id });
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      const encoder = new TextEncoder();
      const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              send(controller, "start", { request_id: rid, status: "正在连接管理员模型…" });
              const modelResult = await streamAdminModel(input.messages, { pending_action_id: input.pending_action_id }, (event) => {
                if (event.type === "text_delta") send(controller, "text_delta", { text: event.text });
                if (event.type === "status") send(controller, "status", { status: event.status, stage: event.stage });
              });
              const guarded = guardModelResult(modelResult, fallbackResult, input.pending_action_id);
              const result = enforceRoomChangeWorkflow(guarded.result);
              await auditAdmin(auth.user, "ADMIN_INTENT_ROUTED", `管理员意图已对齐：${result.type === "tool_call" ? result.tool_name : result.type}`);
              try { await recordAdminAiTurn({ auth, requestId: rid, conversationId: input.conversation_id, utterance: latest.content, result }); } catch { /* telemetry must not block the safety path */ }
              send(controller, "done", { ok: true, actor: { username: auth.user.username, role: auth.user.role, hotel_id: auth.user.hotel_id }, response: withIntentEnvelope(result, guarded.source) });
            } catch (error) {
              send(controller, "error", { error: error instanceof Error ? error.message : "admin_model_stream_failed" });
            } finally { controller.close(); }
          })();
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Request-ID": rid } });
    }
    const modelResult = await askAdminModel(input.messages, { pending_action_id: input.pending_action_id });
    const guarded = guardModelResult(modelResult, fallbackResult, input.pending_action_id);
    const result = enforceRoomChangeWorkflow(guarded.result);
    await auditAdmin(auth.user, "ADMIN_INTENT_ROUTED", `管理员意图已对齐：${result.type === "tool_call" ? result.tool_name : result.type}`);
    try { await recordAdminAiTurn({ auth, requestId: rid, conversationId: input.conversation_id, utterance: latest.content, result }); } catch { /* AI 控制面记录失败不阻断已存在的工具安全网关 */ }
    return Response.json({ ok: true, actor: { username: auth.user.username, role: auth.user.role, hotel_id: auth.user.hotel_id }, response: withIntentEnvelope(result, guarded.source) }, { headers: { "X-Request-ID": rid } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
