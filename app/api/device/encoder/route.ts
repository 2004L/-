import { encoderCommandSchema } from "@/lib/contracts";
import { auditSimulator, completeCommand, consumeFault, createCommand, createManualTask, ensureSession, toResponse } from "@/lib/simulator";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const input = encoderCommandSchema.parse(await request.json());
    await ensureSession(input.session_id);
    const created = await createCommand({ sessionId: input.session_id, caseId: input.case_id, target: "encoder", operation: input.operation, idempotencyKey: input.idempotency_key, request: input });
    if (!created.created) return Response.json(toResponse(created.record));
    const fault = await consumeFault(input.session_id, input.case_id, "encoder");
    if (!fault) {
      const record = await completeCommand(created.record!.id, "SUCCEEDED", { room_number: input.room_number, write_verified: true, readback_verified: true, dispensed: true, collected: false }, null, false);
      await auditSimulator(input.session_id, input.case_id, "ENCODER_SUCCEEDED", `房卡仿真写入 ${input.room_number} 并完成回读校验`);
      return Response.json(toResponse(record));
    }
    const table: Record<string, { status: "FAILED" | "UNKNOWN" | "MANUAL_REQUIRED"; code: string; department: string; reason: string; retryable: boolean }> = {
      encoder_offline: { status: "MANUAL_REQUIRED", code: "ENCODER_OFFLINE", department: "工程", reason: "发卡机离线", retryable: true },
      write_failed: { status: "FAILED", code: "CARD_WRITE_FAILED", department: "前台", reason: "房卡写入失败", retryable: true },
      readback_mismatch: { status: "MANUAL_REQUIRED", code: "CARD_READBACK_MISMATCH", department: "前台", reason: "房卡回读与目标房间不一致", retryable: false },
      output_jammed: { status: "MANUAL_REQUIRED", code: "CARD_OUTPUT_JAMMED", department: "工程", reason: "出卡口卡片堵塞", retryable: true },
      card_not_collected: { status: "MANUAL_REQUIRED", code: "CARD_NOT_COLLECTED", department: "前台", reason: "取卡超时，需确认客人是否取走", retryable: false },
      encoder_timeout: { status: "UNKNOWN", code: "ENCODER_TIMEOUT", department: "前台", reason: "发卡命令超时，结果未知", retryable: true },
    };
    const failure = table[fault] ?? { status: "MANUAL_REQUIRED" as const, code: "SIMULATOR_FAULT", department: "前台", reason: fault, retryable: false };
    const record = await completeCommand(created.record!.id, failure.status, { room_number: input.room_number }, failure.code, failure.retryable);
    await createManualTask(input.session_id, input.case_id, created.record!.id, failure.department, failure.reason);
    await auditSimulator(input.session_id, input.case_id, "ENCODER_FAULT_INJECTED", `注入故障 ${fault}，已转人工`);
    return Response.json(toResponse(record));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}
