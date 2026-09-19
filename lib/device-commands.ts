import type { CommandStatus } from "./contracts.ts";
import {
  auditSimulator,
  completeCommand,
  consumeFault,
  createCommand,
  createManualTask,
  ensureSession,
  type CommandRecord,
} from "@/lib/simulator";

export type DeviceTarget = "reader" | "encoder" | "police";

export type DeviceFailure = { status: CommandStatus; code: string; department: string; reason: string; retryable: boolean; result?: unknown };

/**
 * Single fault → outcome table shared by the guest check-in flow and the
 * /api/device/* endpoints, so a fault always produces the same command status,
 * the same manual-task department and the same audit trail.
 */
const FAILURE_TABLE: Record<DeviceTarget, Record<string, DeviceFailure>> = {
  reader: {
    reader_timeout: { status: "UNKNOWN", code: "READ_TIMEOUT", department: "前台", reason: "读卡超时，无法确认是否已读取", retryable: true },
    reader_offline: { status: "MANUAL_REQUIRED", code: "READER_OFFLINE", department: "工程", reason: "读卡器离线", retryable: true },
    duplicate_read: { status: "MANUAL_REQUIRED", code: "DUPLICATE_CARD_EVENT", department: "前台", reason: "检测到重复读卡或上一个人的证件未取走", retryable: false },
    identity_mismatch: { status: "MANUAL_REQUIRED", code: "IDENTITY_ORDER_MISMATCH", department: "前台", reason: "证件身份与订单核验不一致", retryable: false },
  },
  encoder: {
    encoder_offline: { status: "MANUAL_REQUIRED", code: "ENCODER_OFFLINE", department: "工程", reason: "发卡机离线", retryable: true },
    write_failed: { status: "FAILED", code: "CARD_WRITE_FAILED", department: "前台", reason: "房卡写入失败", retryable: true },
    readback_mismatch: { status: "MANUAL_REQUIRED", code: "CARD_READBACK_MISMATCH", department: "前台", reason: "房卡回读与目标房间不一致", retryable: false },
    output_jammed: { status: "MANUAL_REQUIRED", code: "CARD_OUTPUT_JAMMED", department: "工程", reason: "出卡口卡片堵塞", retryable: true },
    card_not_collected: { status: "MANUAL_REQUIRED", code: "CARD_NOT_COLLECTED", department: "前台", reason: "取卡超时，需确认客人是否取走", retryable: false },
    encoder_timeout: { status: "UNKNOWN", code: "ENCODER_TIMEOUT", department: "前台", reason: "发卡命令超时，结果未知", retryable: true },
  },
  police: {
    captcha_required: { status: "MANUAL_REQUIRED", code: "POLICE_CAPTCHA_REQUIRED", department: "前台", reason: "公安页面出现验证码，需人工完成一次", retryable: false },
    system_maintenance: { status: "MANUAL_REQUIRED", code: "POLICE_MAINTENANCE", department: "值班经理", reason: "公安系统维护", retryable: true },
    certificate_error: { status: "MANUAL_REQUIRED", code: "POLICE_CERTIFICATE_ERROR", department: "工程", reason: "浏览器证书异常", retryable: true },
    submission_rejected: { status: "FAILED", code: "POLICE_REJECTED", department: "前台", reason: "公安登记被拒绝", retryable: false },
    receipt_lost: { status: "UNKNOWN", code: "POLICE_RECEIPT_LOST", department: "前台", reason: "提交成功但回执丢失，禁止重复提交", retryable: false, result: { submitted: true, receipt: null } },
    police_timeout: { status: "UNKNOWN", code: "POLICE_TIMEOUT", department: "前台", reason: "公安页面响应超时", retryable: true },
  },
};

export function deviceFailure(target: DeviceTarget, fault: string): DeviceFailure {
  return FAILURE_TABLE[target][fault] ?? { status: "MANUAL_REQUIRED", code: "SIMULATOR_FAULT", department: "前台", reason: `未归类故障：${fault}`, retryable: false };
}

/** A fault always means a human has to take over. */
export function requiresHandoff(failure: DeviceFailure | null) {
  return Boolean(failure);
}

export function checkinCommandKey(caseId: string, step: string) {
  return `checkin:${caseId}:${step}`;
}

export type DeviceCommandOutcome = { record: CommandRecord; created: boolean; failure: DeviceFailure | null; requiresHandoff: boolean };

export async function runDeviceCommand(input: {
  sessionId: string;
  caseId: string;
  target: DeviceTarget;
  operation: string;
  idempotencyKey: string;
  request: unknown;
  successResult: unknown;
  successEvent: string;
  successDetail: string;
  faultEvent: string;
}): Promise<DeviceCommandOutcome> {
  await ensureSession(input.sessionId);
  const created = await createCommand({ sessionId: input.sessionId, caseId: input.caseId, target: input.target, operation: input.operation, idempotencyKey: input.idempotencyKey, request: input.request });
  if (!created.created) {
    const replayFailure = created.record!.error_code ? { status: created.record!.status, code: created.record!.error_code, department: "前台", reason: "重放已存在的失败命令", retryable: Boolean(created.record!.retryable) } : null;
    return { record: created.record!, created: false, failure: replayFailure, requiresHandoff: created.record!.status !== "SUCCEEDED" };
  }
  const fault = await consumeFault(input.sessionId, input.caseId, input.target);
  if (!fault) {
    const record = await completeCommand(created.record!.id, "SUCCEEDED", input.successResult, null, false);
    await auditSimulator(input.sessionId, input.caseId, input.successEvent, input.successDetail);
    return { record: record!, created: true, failure: null, requiresHandoff: false };
  }
  const failure = deviceFailure(input.target, fault);
  const record = await completeCommand(created.record!.id, failure.status, failure.result ?? null, failure.code, failure.retryable);
  await createManualTask(input.sessionId, input.caseId, created.record!.id, failure.department, failure.reason);
  await auditSimulator(input.sessionId, input.caseId, input.faultEvent, `注入故障 ${fault}，已转人工（${failure.department}）`);
  return { record: record!, created: true, failure, requiresHandoff: true };
}

export async function completeDeviceCommand(idempotencyKey: string, status: CommandStatus, result: unknown, errorCode: string | null, retryable: boolean) {
  const { findCommand } = await import("@/lib/simulator");
  const existing = await findCommand(idempotencyKey);
  if (!existing) return null;
  return completeCommand(existing.id, status, result, errorCode, retryable);
}
