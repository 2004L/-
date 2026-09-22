import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const READ_ONLY_TOOLS = new Set([
  "hotel.integration_status",
  "pms.ping",
  "police.command_status",
  "device.reader_status",
  "device.encoder_status",
  "room.list_status",
  "reservation.search",
  "workflow.get",
  "housekeeping.list_tasks",
]);

export type McpClientConfig = {
  endpoint: string;
  tenantId: string;
  hotelId: string;
  accessToken: string;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

function env(name: string) {
  try { return ((typeof process !== "undefined" ? process.env?.[name] : undefined) ?? "").trim(); } catch { return ""; }
}

export function mcpClientConfigFromEnv(environment: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}) {
  const endpoint = (environment.MCP_SERVER_URL ?? "").trim();
  const tenantId = (environment.MCP_TENANT_ID ?? "").trim();
  const hotelId = (environment.MCP_HOTEL_ID ?? "").trim();
  const accessToken = (environment.MCP_ACCESS_TOKEN ?? environment.MCP_SERVICE_TOKEN ?? "").trim();
  if (!endpoint || !tenantId || !hotelId || !accessToken) return null;
  const parsed = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("mcp_endpoint_must_use_http");
  return { endpoint: parsed.toString(), tenantId, hotelId, accessToken, timeoutMs: 8000, maxAttempts: 2 } satisfies McpClientConfig;
}

export function mcpClientEnabled() {
  return Boolean(env("MCP_SERVER_URL") && env("MCP_TENANT_ID") && env("MCP_HOTEL_ID") && (env("MCP_ACCESS_TOKEN") || env("MCP_SERVICE_TOKEN")));
}

function transient(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  return status === 408 || status === 425 || status === 429 || status >= 500 || error instanceof DOMException && error.name === "TimeoutError";
}

export async function callMcpReadonlyTool(config: McpClientConfig, name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
  if (!READ_ONLY_TOOLS.has(name)) throw new Error("mcp_tool_not_read_only");
  const maxAttempts = Math.max(1, Math.min(3, config.maxAttempts ?? 2));
  const timeoutMs = Math.max(1000, Math.min(15000, config.timeoutMs ?? 8000));
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchWithTimeout = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${config.accessToken}`);
      headers.set("X-Tenant-ID", config.tenantId);
      headers.set("X-Hotel-ID", config.hotelId);
      headers.set("X-MCP-Client", "hotel-agent-os-agent");
      return fetch(input, { ...init, headers, signal: controller.signal });
    };
    const client = new Client({ name: "hotel-agent-os-agent", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), { fetch: fetchWithTimeout });
    try {
      await client.connect(transport);
      return await client.callTool({ name, arguments: args }) as McpToolResult;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || !transient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 100 : 250));
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("mcp_call_failed");
}
