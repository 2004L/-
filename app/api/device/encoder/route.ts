import { encoderCommandSchema } from "@/lib/contracts";
import { runDeviceCommand } from "@/lib/device-commands";
import { toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = encoderCommandSchema.parse(await request.json());
    const outcome = await runDeviceCommand({
      sessionId: input.session_id,
      caseId: input.case_id,
      target: "encoder",
      operation: input.operation,
      idempotencyKey: input.idempotency_key,
      request: input,
      successResult: { room_number: input.room_number, write_verified: true, readback_verified: true, dispensed: true, collected: false },
      successEvent: "ENCODER_SUCCEEDED",
      successDetail: `房卡仿真写入 ${input.room_number} 并完成回读校验`,
      faultEvent: "ENCODER_FAULT_INJECTED",
    });
    return Response.json(toResponse(outcome.record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
