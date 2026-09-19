import { adminToolArgumentSchemas, adminToolNames, type AdminAssistantResult, type AdminToolName } from "@/lib/admin-tools";
import { llmConfig, type ChatMessage } from "@/lib/llm";

const adminToolDefinitions = adminToolNames.map((toolName) => ({
  type: "function" as const,
  function: {
    name: toolName.replaceAll(".", "_"),
    description: `管理员受控工具 ${toolName}。写操作只能生成确认单或确认已存在确认单，不得绕过权限、弹窗和审计。`,
    parameters: adminToolParameters(toolName),
  },
}));

function adminToolParameters(toolName: AdminToolName) {
  const actionTarget = {
    order_id: { type: "string", minLength: 8 },
    phone_last4: { type: "string", pattern: "^[0-9]{4}$" },
    order_code: { type: "string", minLength: 4, maxLength: 80 },
  };
  if (toolName === "admin.search_guest") return { type: "object", additionalProperties: false, properties: actionTarget };
  if (toolName === "admin.get_room_status") return { type: "object", additionalProperties: false, properties: { room_number: { type: "string", pattern: "^[0-9]{3,5}$" } }, required: ["room_number"] };
  if (toolName === "admin.prepare_room_change") return { type: "object", additionalProperties: false, properties: { order_id: actionTarget.order_id, phone_last4: actionTarget.phone_last4, to_room: { type: "string", pattern: "^[0-9]{3,5}$" }, reason: { type: "string", minLength: 1, maxLength: 200 } }, required: ["to_room", "reason"] };
  if (toolName === "admin.prepare_amount_adjustment") return { type: "object", additionalProperties: false, properties: { ...actionTarget, amount_type: { type: "string", enum: ["room_amount", "deposit_amount", "total_amount"] }, new_amount: { type: "integer", minimum: 0, maximum: 99999 }, reason: { type: "string", minLength: 1, maxLength: 200 } }, required: ["amount_type", "new_amount", "reason"] };
  if (toolName === "admin.prepare_keycard_issue") return { type: "object", additionalProperties: false, properties: { ...actionTarget, room_number: { type: "string", pattern: "^[0-9]{3,5}$" }, reason: { type: "string", minLength: 1, maxLength: 200 } }, required: ["reason"] };
  if (toolName === "admin.prepare_police_submission") return { type: "object", additionalProperties: false, properties: { ...actionTarget, region: { type: "string", enum: ["广州", "珠海"] }, reason: { type: "string", minLength: 1, maxLength: 200 } }, required: ["region", "reason"] };
  if (toolName === "admin.get_audit_records") return { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, action_id: { type: "string", minLength: 8, maxLength: 100 }, event_type: { type: "string", minLength: 3, maxLength: 100 } } };
  return { type: "object", additionalProperties: false, properties: { action_id: { type: "string", minLength: 8, maxLength: 100 }, confirmation: { type: "string", enum: ["CONFIRM"] }, reason: { type: "string", minLength: 1, maxLength: 200 } }, required: toolName.includes("confirm") ? ["action_id", "confirmation"] : ["action_id", "reason"] };
}

function redact(value: string) {
  return value
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证号已隐藏]")
    .replace(/\b1\d{10}\b/g, (phone) => `1** **** ${phone.slice(-4)}`)
    .slice(0, 2000);
}

function fromModelName(name: string): AdminToolName | null {
  return adminToolNames.find((toolName) => toolName.replaceAll(".", "_") === name || toolName === name) ?? null;
}

export async function askAdminModel(messages: ChatMessage[], context?: { pending_action_id?: string }): Promise<AdminAssistantResult | null> {
  const config = llmConfig();
  if (!config.enabled || !config.apiKey || config.apiKey === "TEMP_LLM_API_KEY_REPLACE_ME") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const system = [
      "你是酒店管理后台的 AI Native 管理员助手。",
      "你可以理解自然语言并选择管理员工具，但不能直接写数据库、改金额、发房卡或提交公安。",
      "管理员酒店意图必须优先通过工具规划表达；不要把已理解的酒店操作改写成普通闲聊。缺字段时用自然语言澄清。",
      "所有写操作必须先调用 prepare_* 生成确认单；只有管理员明确说确认执行且存在 pending_action_id 时，才调用 admin.confirm_pending_action。",
      "涉及换房时必须先调用 admin.search_guest 查询并确认唯一订单，再调用 admin.get_room_status 检查目标房间，最后才允许用 order_id 调用 admin.prepare_room_change；不得仅凭手机号后四位直接生成换房确认单。",
      "如果缺少手机号后四位、订单号、目标房号、金额、地区等必要参数，直接用自然语言追问，不要猜。",
      context?.pending_action_id ? `当前已有待确认动作：${context.pending_action_id}` : "当前没有待确认动作。",
    ].join("\n");
    const safeMessages = messages.slice(-20).map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: redact(message.content) }));
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: system }, ...safeMessages], tools: adminToolDefinitions, tool_choice: "auto", temperature: config.temperature, max_tokens: config.maxTokens }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    const rawTool = message?.tool_calls?.[0];
    if (rawTool?.function?.name) {
      const toolName = fromModelName(rawTool.function.name);
      if (!toolName) return null;
      let rawArgs: unknown;
      try { rawArgs = JSON.parse(rawTool.function.arguments ?? "{}"); } catch { return null; }
      const parsed = adminToolArgumentSchemas[toolName].safeParse(rawArgs);
      if (!parsed.success) return null;
      return { type: "tool_call", tool_call_id: rawTool.id ?? crypto.randomUUID(), tool_name: toolName, arguments: parsed.data as Record<string, unknown> };
    }
    if (typeof message?.content === "string" && message.content.trim()) return { type: "assistant_message", message: message.content.trim() };
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type AdminModelStage = "connecting" | "understanding" | "planning" | "responding" | "awaiting_confirmation";

export type AdminModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "status"; status: string; stage: AdminModelStage }
  | { type: "done"; result: AdminAssistantResult | null; latency_ms?: number };

/**
 * Streaming variant used by the administrator console. It deliberately only
 * streams model text/status; tool execution still happens after the existing
 * schema, permission and confirmation gates have run.
 */
export async function streamAdminModel(
  messages: ChatMessage[],
  context: { pending_action_id?: string } | undefined,
  onEvent: (event: AdminModelStreamEvent) => void,
): Promise<AdminAssistantResult | null> {
  const config = llmConfig();
  if (!config.enabled || !config.apiKey || config.apiKey === "TEMP_LLM_API_KEY_REPLACE_ME") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 20000));
  const startedAt = Date.now();
  try {
    const system = [
      "你是酒店管理后台的 AI Native 管理员助手。",
      "你可以理解自然语言并选择管理员工具，但不能直接写数据库、改金额、发房卡或提交公安。",
      "管理员酒店意图必须优先通过工具规划表达；不要把已理解的酒店操作改写成普通闲聊。缺字段时用自然语言澄清。",
      "所有写操作必须先调用 prepare_* 生成确认单；只有管理员明确说确认执行且存在 pending_action_id 时，才调用 admin.confirm_pending_action。",
      "涉及换房时必须先调用 admin.search_guest 查询并确认唯一订单，再调用 admin.get_room_status 检查目标房间，最后才允许用 order_id 调用 admin.prepare_room_change。",
      "如果缺少手机号后四位、订单号、目标房号、金额、地区等必要参数，直接用自然语言追问，不要猜。",
      context?.pending_action_id ? `当前已有待确认动作：${context.pending_action_id}` : "当前没有待确认动作。",
    ].join("\n");
    const safeMessages = messages.slice(-12).map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: redact(message.content) }));
    onEvent({ type: "status", status: "正在连接管理员模型…", stage: "connecting" });
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: system }, ...safeMessages], tools: adminToolDefinitions, tool_choice: "auto", temperature: config.temperature, max_tokens: Math.min(config.maxTokens, 384), stream: true }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    onEvent({ type: "status", status: "模型已连接，正在理解管理员意图…", stage: "understanding" });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let toolId = "";
    let toolName = "";
    let toolArguments = "";
    let planningSent = false;
    const consume = (line: string) => {
      const value = line.trim();
      if (!value || value === "data: [DONE]") return;
      const raw = value.startsWith("data:") ? value.slice(5).trim() : value;
      try {
        const chunk = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) { text += delta.content; onEvent({ type: "text_delta", text: delta.content }); }
        for (const call of delta?.tool_calls ?? []) {
          if (call.id) toolId = call.id;
          if (call.function?.name) {
            toolName += call.function.name;
            if (!planningSent) {
              planningSent = true;
              onEvent({ type: "status", status: "已理解意图，正在规划工具参数…", stage: "planning" });
            }
          }
          if (call.function?.arguments) toolArguments += call.function.arguments;
        }
      } catch { /* ignore incomplete provider frames */ }
    };
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consume);
    }
    if (buffer.trim()) consume(buffer);
    let result: AdminAssistantResult | null = null;
    if (toolName) {
      const normalizedName = fromModelName(toolName);
      if (normalizedName) {
        try {
          const parsed = adminToolArgumentSchemas[normalizedName].safeParse(JSON.parse(toolArguments || "{}"));
          if (parsed.success) result = { type: "tool_call", tool_call_id: toolId || crypto.randomUUID(), tool_name: normalizedName, arguments: parsed.data as Record<string, unknown> };
        } catch { result = null; }
      }
    } else if (text.trim()) result = { type: "assistant_message", message: text.trim() };
    const latencyMs = Date.now() - startedAt;
    if (result?.type === "tool_call") onEvent({ type: "status", status: "工具计划已完成，等待管理员确认", stage: "awaiting_confirmation" });
    else onEvent({ type: "status", status: "正在组织回复…", stage: "responding" });
    onEvent({ type: "done", result, latency_ms: latencyMs });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
