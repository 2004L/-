import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createHotelApiClient, createReadonlyToolHandlers, loadMcpConfig, readonlyToolCatalog } from "@/lib/mcp-readonly-tools.mjs";

export const runtime = "edge";

function sameToken(actual: string, expected: string) {
  if (!expected || !actual || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function registerTools(server: McpServer, handlers: ReturnType<typeof createReadonlyToolHandlers>) {
  const commandInput = { command_id: z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/) };
  const phoneInput = { phone_last4: z.string().regex(/^\d{4}$/) };
  const workflowInput = { workflow_id: z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/) };
  for (const tool of readonlyToolCatalog) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.commandId ? commandInput : tool.phoneLast4 ? phoneInput : tool.workflowId ? workflowInput : {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input) => {
      try {
        const result = await handlers[tool.name](input);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : "mcp_tool_failed" }) }] };
      }
    });
  }
}

export async function ALL(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedToken = process.env.MCP_SERVICE_TOKEN ?? "";
  const tenantId = request.headers.get("x-tenant-id") ?? "";
  const hotelId = request.headers.get("x-hotel-id") ?? "";
  if (!sameToken(token, expectedToken) || !tenantId || !hotelId) return Response.json({ ok: false, error: "mcp_service_auth_required" }, { status: 401 });
  const config = loadMcpConfig({ MCP_API_BASE_URL: new URL(request.url).origin, MCP_TENANT_ID: tenantId, MCP_HOTEL_ID: hotelId, MCP_ACCESS_TOKEN: token });
  const server = new McpServer({ name: "hotel-agent-os", version: "0.1.0" });
  registerTools(server, createReadonlyToolHandlers(config, createHotelApiClient(config)));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = ALL;
export const POST = ALL;
export const DELETE = ALL;
