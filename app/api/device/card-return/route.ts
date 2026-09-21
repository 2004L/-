import { z } from "zod";
import { runDeviceCommand } from "@/lib/device-commands";
import { toResponse } from "@/lib/simulator";

export const runtime = "edge";

const requestSchema = z.object({
  session_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  case_id: z.string().min(3).max(120),
  idempotency_key: z.string().min(1).max(120),
  expected_state: z.string().min(1).max(80),
  device_id: z.string().min(1).max(80).default("card-returner-demo-01"),
  room_number: z.string().regex(/^\d{3,5}$/),
}).strict();

/** Simulates the physical return slot: the command succeeds only after the card is stored. */
export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const outcome = await runDeviceCommand({
      sessionId: input.session_id,
      caseId: input.case_id,
      target: "encoder",
      operation: "collect_keycard",
      idempotencyKey: input.idempotency_key,
      request: input,
      successResult: { room_number: input.room_number, card_inserted: true, collected: true, storage_bin: "returner-bin-01", stored_at: new Date().toISOString() },
      successEvent: "KEYCARD_RETURNED",
      successDetail: `收卡器已收纳 ${input.room_number} 房卡并放入 returner-bin-01`,
      faultEvent: "KEYCARD_RETURN_FAULT_INJECTED",
    });
    return Response.json(toResponse(outcome.record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
