import { policeCommandSchema } from "@/lib/contracts";
import { auditSimulator, completeCommand, consumeFault, createCommand, createManualTask, ensureSession, toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = policeCommandSchema.parse(await request.json());
    await ensureSession(input.session_id);
    const created = await createCommand({ sessionId: input.session_id, caseId: input.case_id, target: "police", operation: input.operation, idempotencyKey: input.idempotency_key, request: input });
    if (!created.created) return Response.json(toResponse(created.record));
    const fault = await consumeFault(input.session_id, input.case_id, "police");
    if (!fault) {
      const record = await completeCommand(created.record!.id, "SUCCEEDED", { submitted: true, receipt: `SIM-POLICE-${Date.now().toString().slice(-8)}`, actual_identity_fields_sent: true }, null, false);
      await auditSimulator(input.session_id, input.case_id, "POLICE_SUBMIT_SUCCEEDED", "公安登记仿真提交成功并生成回执；真实环境需替换浏览器适配器");
      return Response.json(toResponse(record));
    }
    const table: Record<string, { status: "FAILED" | "UNKNOWN" | "MANUAL_REQUIRED"; code: string; department: string; reason: string; retryable: boolean; result?: unknown }> = {
      captcha_required: { status: "MANUAL_REQUIRED", code: "POLICE_CAPTCHA_REQUIRED", department: "前台", reason: "公安页面出现验证码，需人工完成一次", retryable: false },
      system_maintenance: { status: "MANUAL_REQUIRED", code: "POLICE_MAINTENANCE", department: "值班经理", reason: "公安系统维护", retryable: true },
      certificate_error: { status: "MANUAL_REQUIRED", code: "POLICE_CERTIFICATE_ERROR", department: "工程", reason: "浏览器证书异常", retryable: true },
      submission_rejected: { status: "FAILED", code: "POLICE_REJECTED", department: "前台", reason: "公安登记被拒绝", retryable: false },
      receipt_lost: { status: "UNKNOWN", code: "POLICE_RECEIPT_LOST", department: "前台", reason: "提交成功但回执丢失，禁止重复提交", retryable: false, result: { submitted: true, receipt: null } },
      police_timeout: { status: "UNKNOWN", code: "POLICE_TIMEOUT", department: "前台", reason: "公安页面响应超时", retryable: true },
    };
    const failure = table[fault] ?? { status: "MANUAL_REQUIRED" as const, code: "SIMULATOR_FAULT", department: "前台", reason: fault, retryable: false };
    const record = await completeCommand(created.record!.id, failure.status, failure.result ?? { submitted: false }, failure.code, failure.retryable);
    await createManualTask(input.session_id, input.case_id, created.record!.id, failure.department, failure.reason);
    await auditSimulator(input.session_id, input.case_id, "POLICE_FAULT_INJECTED", `注入故障 ${fault}，已转人工`);
    return Response.json(toResponse(record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
