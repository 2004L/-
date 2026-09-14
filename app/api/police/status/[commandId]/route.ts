import { getD1 } from "@/db";
import { toResponse, type CommandRecord } from "@/lib/simulator";

export const runtime = "edge";

export async function GET(_request: Request, context: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await context.params;
  const record = await getD1().prepare("SELECT * FROM external_commands WHERE id = ? AND target = 'police'").bind(commandId).first<CommandRecord>();
  return Response.json(toResponse(record));
}
