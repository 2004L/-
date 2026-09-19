import { ensureAdminSchema, getAdminFromRequest, auditAdmin } from "@/lib/admin-auth";
import { isValidWorkflowStep, recordWorkflowStep, transitionWorkflow, type WorkflowStatus } from "@/lib/workflow-engine";

export const runtime = "edge";

const statuses = new Set<WorkflowStatus>(["pending", "running", "awaiting_confirmation", "paused", "completed", "failed", "cancelled"]);

export async function POST(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  await ensureAdminSchema();
  const auth = await getAdminFromRequest(request);
  if (!auth) return Response.json({ ok: false, error: "admin_auth_required" }, { status: 401 });
  const { workflowId } = await context.params;
  const body = await request.json().catch(() => null) as { expected_version?: number; status?: string; current_step?: string; input?: unknown; output?: unknown; error_code?: string } | null;
  if (!body || !Number.isInteger(body.expected_version) || !body.status || !statuses.has(body.status as WorkflowStatus)) return Response.json({ ok: false, error: "invalid_workflow_transition" }, { status: 400 });
  if (body.current_step && !isValidWorkflowStep(body.current_step)) return Response.json({ ok: false, error: "unknown_workflow_step" }, { status: 400 });
  const expectedVersion = body.expected_version as number;
  try {
    const run = await transitionWorkflow({ workflowId, hotelId: auth.user.hotel_id, expectedVersion, status: body.status as WorkflowStatus, currentStep: body.current_step ?? null, lastError: body.error_code ?? null });
    if (body.current_step) await recordWorkflowStep({ workflowId, tenantId: auth.user.tenant_id, hotelId: auth.user.hotel_id, stepKey: body.current_step, status: body.status === "failed" ? "failed" : body.status === "completed" ? "succeeded" : body.status, input: body.input, output: body.output, errorCode: body.error_code ?? null });
    await auditAdmin(auth.user, "ADMIN_WORKFLOW_TRANSITIONED", `工作流 ${workflowId.slice(0, 12)} 已变更为 ${body.status}`);
    return Response.json({ ok: true, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "workflow_transition_failed";
    const status = message === "workflow_version_conflict" ? 409 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
