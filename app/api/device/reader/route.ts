import { readerCommandSchema } from "@/lib/contracts";
import { auditSimulator, completeCommand, consumeFault, createCommand, createManualTask, ensureSession, toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = readerCommandSchema.parse(await request.json());
    await ensureSession(input.session_id);
    const created = await createCommand({ sessionId: input.session_id, caseId: input.case_id, target: "reader", operation: input.operation, idempotencyKey: input.idempotency_key, request: input });
    if (!created.created) return Response.json(toResponse(created.record));
    const fault = await consumeFault(input.session_id, input.case_id, "reader");
    if (!fault) {
      const record = await completeCommand(created.record!.id, "SUCCEEDED", { card_present: true, read_verified: true, identity_token: "DEMO-ID-TOKEN" }, null, false);
      await auditSimulator(input.session_id, input.case_id, "READER_READ_SUCCEEDED", "读卡器仿真读取成功；未返回真实身份证字段");
      return Response.json(toResponse(record));
    }
    const table: Record<string, { status: "FAILED" | "UNKNOWN" | "MANUAL_REQUIRED"; code: string; department: string; reason: string; retryable: boolean }> = {
      reader_timeout: { status: "UNKNOWN", code: "READ_TIMEOUT", department: "前台", reason: "读卡超时，无法确认是否已读取", retryable: true },
      reader_offline: { status: "MANUAL_REQUIRED", code: "READER_OFFLINE", department: "工程", reason: "读卡器离线", retryable: true },
      duplicate_read: { status: "MANUAL_REQUIRED", code: "DUPLICATE_CARD_EVENT", department: "前台", reason: "检测到重复读卡或上一个人的证件未取走", retryable: false },
      identity_mismatch: { status: "MANUAL_REQUIRED", code: "IDENTITY_ORDER_MISMATCH", department: "前台", reason: "证件身份与订单核验不一致", retryable: false },
    };
    const failure = table[fault] ?? { status: "MANUAL_REQUIRED" as const, code: "SIMULATOR_FAULT", department: "前台", reason: fault, retryable: false };
    const record = await completeCommand(created.record!.id, failure.status, { card_present: false }, failure.code, failure.retryable);
    await createManualTask(input.session_id, input.case_id, created.record!.id, failure.department, failure.reason);
    await auditSimulator(input.session_id, input.case_id, "READER_FAULT_INJECTED", `注入故障 ${fault}，已转人工`);
    return Response.json(toResponse(record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
