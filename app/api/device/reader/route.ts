import { readerCommandSchema } from "@/lib/contracts";
import { runDeviceCommand } from "@/lib/device-commands";
import { toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = readerCommandSchema.parse(await request.json());
    const outcome = await runDeviceCommand({
      sessionId: input.session_id,
      caseId: input.case_id,
      target: "reader",
      operation: input.operation,
      idempotencyKey: input.idempotency_key,
      request: input,
      successResult: { card_present: true, read_verified: true, identity_token: "DEMO-ID-TOKEN" },
      successEvent: "READER_READ_SUCCEEDED",
      successDetail: "读卡器仿真读取成功；未返回真实身份证字段",
      faultEvent: "READER_FAULT_INJECTED",
    });
    return Response.json(toResponse(outcome.record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
