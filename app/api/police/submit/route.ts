import { policeCommandSchema } from "@/lib/contracts";
import { runDeviceCommand } from "@/lib/device-commands";
import { toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = policeCommandSchema.parse(await request.json());
    const outcome = await runDeviceCommand({
      sessionId: input.session_id,
      caseId: input.case_id,
      target: "police",
      operation: input.operation,
      idempotencyKey: input.idempotency_key,
      request: input,
      successResult: { submitted: true, receipt: `SIM-POLICE-${Date.now().toString().slice(-8)}`, actual_identity_fields_sent: true },
      successEvent: "POLICE_SUBMIT_SUCCEEDED",
      successDetail: "公安登记仿真提交成功并生成回执；真实环境需替换浏览器适配器",
      faultEvent: "POLICE_FAULT_INJECTED",
    });
    return Response.json(toResponse(outcome.record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
