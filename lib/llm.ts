import { modelToolDefinitions, toolArgumentSchemas, type ToolCall, type ToolName } from "./tools";

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

function envValue(name: string, fallback = "") {
  try { return ((typeof process !== "undefined" ? process.env?.[name] : undefined) ?? fallback).trim(); } catch { return fallback; }
}

export function llmConfig() {
  return {
    enabled: envValue("LLM_ENABLED", "false").toLowerCase() === "true",
    baseUrl: envValue("LLM_BASE_URL", "https://tokenhub.tencentmaas.com/v1").replace(/\/$/, ""),
    model: envValue("LLM_MODEL", "hy3"),
    apiKey: envValue("LLM_API_KEY"),
  };
}

function fromModelName(name: string): ToolName | null {
  const candidate = name.replaceAll("_", ".") as ToolName;
  return candidate in toolArgumentSchemas ? candidate : null;
}

export async function askModel(messages: ChatMessage[], context?: { case_id?: string }) {
  const config = llmConfig();
  if (!config.enabled || !config.apiKey || config.apiKey === "TEMP_LLM_API_KEY_REPLACE_ME") return null;
  const system = "你是酒店自助入住助手。你只能通过提供的受控工具完成业务动作，不能直接访问数据库，不能猜测身份、手机号、金额、房号或公安字段。遇到歧义先澄清；硬件和公安工具当前是 simulator，只能返回仿真结果。";
  const enriched = context?.case_id ? `${system}\n当前办理 case_id：${context.case_id}` : system;
  const response = await fetch(`${config.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: enriched }, ...messages], tools: modelToolDefinitions, tool_choice: "auto", temperature: 0, max_tokens: 300 }), });
  if (!response.ok) throw new Error(`llm_http_${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
  const message = payload.choices?.[0]?.message;
  const rawTool = message?.tool_calls?.[0];
  if (rawTool?.function?.name) {
    const toolName = fromModelName(rawTool.function.name);
    if (!toolName) throw new Error("llm_unknown_tool");
    let rawArgs: unknown;
    try { rawArgs = JSON.parse(rawTool.function.arguments ?? "{}"); } catch { throw new Error("llm_invalid_tool_arguments"); }
    const parsed = toolArgumentSchemas[toolName].safeParse(rawArgs);
    if (!parsed.success) throw new Error("llm_invalid_tool_arguments");
    const implementation = toolName.startsWith("device.") || toolName.startsWith("police.") ? "simulator" : "business_api";
    return { type: "tool_call" as const, tool_call_id: rawTool.id ?? crypto.randomUUID(), tool_name: toolName, arguments: parsed.data as Record<string, unknown>, implementation } satisfies ToolCall;
  }
  if (typeof message?.content === "string" && message.content.trim()) return { type: "assistant_message" as const, message: message.content.trim() };
  return null;
}
