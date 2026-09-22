#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createHotelApiClient,
  createReadonlyToolHandlers,
  loadMcpConfig,
  readonlyToolCatalog,
} from '../lib/mcp-readonly-tools.mjs';

const config = loadMcpConfig();
const handlers = createReadonlyToolHandlers(config, createHotelApiClient(config));
const server = new McpServer({ name: 'hotel-agent-os', version: '0.1.0' });

const commandInput = { command_id: z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/) };
const phoneInput = { phone_last4: z.string().regex(/^\d{4}$/) };
const workflowInput = { workflow_id: z.string().regex(/^[a-zA-Z0-9:_-]{8,120}$/) };

for (const tool of readonlyToolCatalog) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.commandId ? commandInput : tool.phoneLast4 ? phoneInput : tool.workflowId ? workflowInput : {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await handlers[tool.name](input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error';
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Hotel Agent OS MCP ready for ${config.tenantId}/${config.hotelId}`);
