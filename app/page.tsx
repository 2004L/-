"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Building2,
  Check,
  CircleCheck,
  Clock3,
  CreditCard,
  Database,
  FileCheck2,
  IdCard,
  LoaderCircle,
  MessageSquareText,
  Mic,
  MonitorCog,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
  Volume2,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { isRoomNumber, parseAmount } from "@/lib/admin-tools";
import { TerminalCheckoutPanel, TerminalModeChooser } from "@/components/terminal-checkout";
import { DigitalHuman } from "@/components/live2d/digital-human";
import { dispatchComputerUseAction } from "@/components/live2d/computer-use-controller";
import type { ComputerUseStatus, DigitalHumanInputEvent } from "@/components/live2d/types";

type AdapterConfig = {
  provider: string;
  version: string;
  baseUrl: string;
  apiKey: string;
  asrWsUrl: string;
  propertyCode: string;
  hotelName: string;
};

type DemoOrder = {
  id: string;
  order_code: string;
  source: string;
  guest_label: string;
  phone_last4: string;
  phone_masked: string;
  stay_date: string;
  nights: number;
  room_count: number;
  room_type: string;
  status: string;
  room_number: string | null;
  updated_at: string;
};

type CheckinCase = {
  id: string;
  order_id: string;
  mode: string;
  status: string;
  phone_last4: string;
  identity_result: string | null;
  room_number: string | null;
  police_receipt: string | null;
  hardware_status: string;
  version: number;
  updated_at: string;
};

type JourneyState = "waiting" | "active" | "done";
type JourneyStep = { label: string; detail: string; state: JourneyState };

type BrowserJob = {
  id: string;
  case_id: string;
  region: string;
  status: string;
  attempt: number;
  receipt: string | null;
  last_error: string | null;
  updated_at: string;
};

type AuditEvent = {
  id: number;
  case_id: string | null;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  detail: string;
  created_at: string;
};

type Snapshot = {
  orders: DemoOrder[];
  cases: CheckinCase[];
  browserJobs: BrowserJob[];
  auditEvents: AuditEvent[];
  manualTasks: ManualTask[];
};

type ManualTask = { id: string; case_id: string; command_id: string | null; department: string; reason: string; status: string; created_at: string };

type AiChainView = {
  workflow: { id: string; intent: string | null; current_step: string | null; status: string; updated_at: string } | null;
  intents: Array<{ raw_text_redacted: string; intent: string; confidence: number | null; source: string; created_at: string }>;
  plans: Array<{ plan_json: string; status: string; created_at: string }>;
  toolCalls: Array<{ tool_name: string; status: string; result_json: string | null; created_at: string; completed_at: string | null }>;
  policyDecisions: Array<{ action: string; risk_level: string; decision: string; reason: string; created_at: string }>;
};

type MatchResponse = {
  outcome: "matched" | "ambiguous" | "not_found" | "already_checked_in" | "checked_out" | "cancelled";
  order?: DemoOrder;
  orders?: DemoOrder[];
  checkinCase?: CheckinCase;
};

type WalkInRoomType = { code: string; name: string; nightly_rate: number; deposit: number; available: number };
type WalkInDraft = { id: string; phone_masked: string; stay_date: string; nights: number; room_count: number; room_type_code: string | null; room_type_name: string | null; nightly_rate: number | null; room_amount: number | null; deposit_amount: number | null; total_amount: number | null; status: string; payment_id: string | null; order_id: string | null };
type WalkInPayment = { id: string; method: string; amount: number; status: string; receipt?: string | null; qr_token?: string };

type IntentResponse = Partial<MatchResponse> & {
  intent: string;
  label: string;
  confidence: number;
  action: string;
  phone_last4?: string;
  assistantMessage: string;
};

type IntentEnvelopeView = { intent: string; intent_class: "hotel" | "general"; entities: Record<string, string | number | null>; missing_fields: string[]; next_action: string; risk: "none" | "low" | "medium" | "high"; requires_confirmation: boolean; confidence: number; source: "model" | "rule_fallback" | "safety_guard" };
type AgentResponse = { type: "tool_call"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; implementation: "business_api" | "simulator"; response_hint?: string; intent_envelope?: IntentEnvelopeView } | { type: "clarification"; message: string; intent: string; confidence: number; intent_envelope?: IntentEnvelopeView } | { type: "assistant_message"; message: string; intent_envelope?: IntentEnvelopeView };

const fullPhoneFromText = (text: string) => text.match(/1[3-9]\d{9}/)?.[0] ?? null;
type AdminResponse = { type: "tool_call"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; response_hint?: string; workflow?: { kind: "room_change"; target_room: string; stage: "guest_search" }; intent_envelope?: IntentEnvelopeView } | { type: "clarification"; message: string; intent: string; confidence: number; intent_envelope?: IntentEnvelopeView } | { type: "assistant_message"; message: string; intent_envelope?: IntentEnvelopeView };
type AgentHistoryMessage = { role: "user" | "assistant" | "tool"; content: string };
type TranscriptEntry = { id: string; role: "user" | "assistant" | "tool"; content: string };

type RecognitionResultEvent = {
  resultIndex?: number;
  results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }>;
};
type RecognitionErrorEvent = { error?: string };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event?: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => RecognitionLike;

type AsrSocketMessage = {
  type: "ready" | "result" | "error";
  text?: string;
  is_final?: boolean;
  language?: string;
  latency_ms?: number;
  audio_chunks?: number;
  audio_bytes?: number;
  audio_duration_ms?: number;
  code?: string;
  message?: string;
  service?: string;
  model?: string;
  device?: string;
  transport?: string;
};

type AudioInputDevice = { deviceId: string; label: string };
type AdminUser = { id: string; hotel_code: string; username: string; display_name: string; role: "owner" | "manager" | "frontdesk" | "housekeeping"; permissions: string[] };

type PendingAdminAction = {
  actionId: string;
  orderId?: string;
  actionType: string;
  title: string;
  riskLevel: string;
  requiredPermission: string;
  phone: string;
  orderCode: string;
  fields: Array<{ label: string; value: string }>;
  impacts: string[];
  confirmLabel: string;
  cancelLabel: string;
  reason: string;
  expiresAt: string;
  fromRoom?: string;
  toRoom?: string;
  amountType?: string;
  newAmount?: number;
};

type AdminConfirmationStatus = "AWAITING_CONFIRMATION" | "EXECUTED" | "CANCELLED" | "EXPIRED" | "CONFLICTED";
type AdminConfirmationCardState = { action: PendingAdminAction; status: AdminConfirmationStatus; error?: string };
type AdminAuditRecord = { id: number; action_id?: string | null; event_type: string; detail: string; username?: string | null; role?: string | null; created_at: string };

type AdminWorkflowStep = "guest_search" | "guest_selection" | "room_check" | "confirmation" | "executing" | "completed" | "blocked";
type AdminWorkflow = {
  kind: "room_change";
  step: AdminWorkflowStep;
  targetRoom: string;
  candidates: Array<Record<string, unknown>>;
  selectedOrder: Record<string, unknown> | null;
  room: { roomNumber: string; status: string; version?: number | null; guest?: Record<string, unknown> | null } | null;
  message: string;
};

type AdminResult =
  | { type: "orders"; orders: Array<Record<string, unknown>> }
  | { type: "room"; roomNumber: string; status: string; version?: number | null }
  | { type: "workflow"; workflow: AdminWorkflow }
  | null;

const RETENTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "3d", label: "近三天" },
  { id: "7d", label: "近七天" },
  { id: "30d", label: "近一个月" },
  { id: "180d", label: "近半年" },
  { id: "365d", label: "近一年" },
];

const SERVICE_NEED_OPTIONS: Array<{ id: string; label: string; tone: string }> = [
  { id: "cleaning", label: "需打扫", tone: "bg-[#fff1e5] text-[#ad5b16]" },
  { id: "maintenance", label: "需维修", tone: "bg-[#fff1ed] text-[#b63d13]" },
  { id: "supplies", label: "需补物品", tone: "bg-[#eaf4ff] text-[#1769aa]" },
  { id: "none", label: "无需服务", tone: "bg-[#e8f7ee] text-[#248a4d]" },
];
const SERVICE_NEED_TONES: Record<string, string> = { cleaning: "bg-[#fff1e5] text-[#ad5b16]", maintenance: "bg-[#fff1ed] text-[#b63d13]", supplies: "bg-[#eaf4ff] text-[#1769aa]", none: "bg-[#e8f7ee] text-[#248a4d]" };
const SERVICE_NEED_NAMES: Record<string, string> = { cleaning: "需要打扫", maintenance: "需要维修", supplies: "需要补物品", none: "无需服务" };

type InHouseGuestRow = {
  stayId: string; roomNumber: string | null; guestNameMasked: string; phoneLast4: string; reservationNo: string;
  checkedInAt: string | null; nights: number; folioStatus: string | null; folioBalance: number;
  consumption: number; serviceNeed: string; serviceNote: string | null;
  serviceReportedBy: string | null; serviceReportedAt: string | null;
};
type DatabaseTableRow = { name: string; rows: number };
type DatabasePreview = { table: string; total: number; columns: string[]; maskedColumns: string[]; rows: Array<Record<string, unknown>>; limit: number; truncated: boolean };

function AdminDataPanel() {
  const [guests, setGuests] = useState<InHouseGuestRow[]>([]);
  const [pendingService, setPendingService] = useState(0);
  const [tables, setTables] = useState<DatabaseTableRow[]>([]);
  const [preview, setPreview] = useState<DatabasePreview | null>(null);
  const [status, setStatus] = useState("正在读取在住客人与数据库…");
  const [busy, setBusy] = useState(false);

  const call = useCallback((toolName: string, args: Record<string, unknown>) => callAdminTool<Record<string, unknown>>(toolName, args), []);

  const loadGuests = useCallback(async () => {
    const result = await call("admin.list_in_house_guests", {});
    const list = (result.guests as InHouseGuestRow[] | undefined) ?? [];
    setGuests(list);
    setPendingService(Number(result.pending_service ?? 0));
    return { count: list.length, pending: Number(result.pending_service ?? 0) };
  }, [call]);

  // The two halves need different permissions, so one failing must not blank the other.
  const refresh = useCallback(async () => {
    setBusy(true);
    const problems: string[] = [];
    let guestCount = 0;
    let pending = 0;
    let tableCount = 0;
    try { const result = await loadGuests(); guestCount = result.count; pending = result.pending; }
    catch (error) { problems.push(`在住客人：${error instanceof Error ? error.message : "读取失败"}`); }
    try { const result = await call("admin.get_database_schema", {}); const list = (result.tables as DatabaseTableRow[] | undefined) ?? []; setTables(list); tableCount = list.length; }
    catch (error) { setTables([]); problems.push(`数据库：${error instanceof Error ? error.message : "读取失败"}`); }
    setStatus(problems.length ? problems.join("；") : `在住 ${guestCount} 位客人（${pending} 间房有未完成的服务需求）· 数据库 ${tableCount} 张表`);
    setBusy(false);
  }, [call, loadGuests]);

  // queueMicrotask, not a direct call: refresh() sets state before its first await, and a synchronous setState inside an effect cascades renders.
  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);

  async function updateServiceNeed(roomNumber: string, need: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call("admin.set_room_service_need", { room_number: roomNumber, need });
      const result = await loadGuests();
      setStatus(`房间 ${roomNumber} 已标记为「${SERVICE_NEED_NAMES[need] ?? need}」，当前 ${result.pending} 间房有待办服务`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "更新服务需求失败"); }
    finally { setBusy(false); }
  }

  /** Pull every session's demo copy back in line with the bookings. */
  async function reconcileDemoData() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await call("admin.reconcile_demo_orders", {});
      await loadGuests();
      setStatus(`已把演示界面拉回真账：修正 ${Number(result.updated ?? 0)} 笔假订单（修正前不一致 ${Number(result.drifted_before ?? 0)} 笔）`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "对齐演示数据失败"); }
    finally { setBusy(false); }
  }

  async function openTable(name: string) {
    if (busy) return;
    setBusy(true);
    try {
      setPreview((await call("admin.get_table_rows", { table: name, limit: 20 })) as unknown as DatabasePreview);
      setStatus(`已打开表 ${name}`);
    } catch (error) { setPreview(null); setStatus(error instanceof Error ? error.message : "读取表失败"); }
    finally { setBusy(false); }
  }

  return <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe3d5] bg-[#fbfffc] shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e3f0e7] px-5 py-4">
      <div><p className="text-sm text-[#2f7d4f]">数据</p><h2 className="mt-1 font-semibold">在住客人的房间与是否需要服务</h2><p className="mt-1 text-xs leading-5 text-[#5f7d6a]">上半部分是现在住在店里的客人：房号、脱敏身份、账务和在住消费，以及这间房是否需要服务。下半部分是数据库里真实存在的表，点开可以看前 20 行；凭据类字段一律脱敏，全部只读。</p></div>
      <div className="flex items-center gap-2">{pendingService > 0 && <span className="rounded-full bg-[#fff1e5] px-3 py-1.5 text-xs text-[#ad5b16]">{pendingService} 间房有未完成的服务需求</span>}<button type="button" onClick={() => void reconcileDemoData()} disabled={busy} className="rounded-lg border border-[#bcd9c7] bg-white px-3 py-2 text-sm text-[#2f7d4f] disabled:opacity-40">对齐演示数据</button><button type="button" onClick={() => void refresh()} disabled={busy} className="rounded-lg border border-[#bcd9c7] bg-white px-3 py-2 text-sm text-[#2f7d4f] disabled:opacity-40">{busy ? "读取中…" : "刷新"}</button></div>
    </div>
    <div className="px-5 py-2 text-xs text-[#5f7d6a]">{status}</div>
    <div className="grid gap-3 px-5 pb-4 lg:grid-cols-2">{guests.length ? guests.map((guest) => <article key={guest.stayId} className="rounded-2xl border border-[#e3f0e7] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-lg font-semibold tracking-[-.02em] text-[#102a43]">房间 {guest.roomNumber ?? "未分配"}</p><p className="mt-1 text-xs text-[#627d98]">{guest.guestNameMasked} · 尾号 {guest.phoneLast4} · {guest.reservationNo}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${SERVICE_NEED_TONES[guest.serviceNeed] ?? "bg-[#f2f7fb] text-[#627d98]"}`}>{SERVICE_NEED_NAMES[guest.serviceNeed] ?? guest.serviceNeed}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#627d98] sm:grid-cols-4"><span>入住 {guest.checkedInAt ? new Date(guest.checkedInAt).toLocaleString("zh-CN") : "—"}</span><span>{guest.nights} 晚</span><span>在住消费 ¥{guest.consumption}</span><span className={guest.folioStatus === "open" ? "" : "text-[#248a4d]"}>账务 {guest.folioStatus === "open" ? `¥${guest.folioBalance}` : (guest.folioStatus ?? "未开账")}</span></div>{guest.serviceNeed !== "none" && <p className="mt-2 rounded-lg bg-[#f7fbf8] px-3 py-2 text-xs leading-5 text-[#5f7d6a]">待办：{SERVICE_NEED_NAMES[guest.serviceNeed]}{guest.serviceNote ? ` · ${guest.serviceNote}` : ""}{guest.serviceReportedBy ? ` · 由 ${guest.serviceReportedBy} 于 ${guest.serviceReportedAt ? new Date(guest.serviceReportedAt).toLocaleString("zh-CN") : ""} 标记` : ""}</p>}<div className="mt-3 flex flex-wrap gap-2">{SERVICE_NEED_OPTIONS.map((option) => <button key={option.id} type="button" disabled={busy || guest.serviceNeed === option.id || !guest.roomNumber} onClick={() => void updateServiceNeed(guest.roomNumber as string, option.id)} className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${guest.serviceNeed === option.id ? "bg-[#1d1d1f] text-white" : option.tone}`}>{option.label}</button>)}</div></article>) : <p className="rounded-2xl bg-white px-4 py-6 text-sm text-[#829ab1]">当前没有在住客人。</p>}</div>
    <div className="border-t border-[#e3f0e7] px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-[.14em] text-[#829ab1]">数据库表（点击查看前 20 行）</p>
      <div className="mt-3 flex flex-wrap gap-2">{tables.map((table) => <button key={table.name} type="button" disabled={busy} onClick={() => void openTable(table.name)} className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${preview?.table === table.name ? "bg-[#2f7d4f] text-white" : "border border-[#cfe3d5] bg-white text-[#3f6b53]"}`}>{table.name} · {table.rows}</button>)}</div>
      {preview && <div className="mt-4 overflow-hidden rounded-2xl border border-[#e3f0e7] bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef6f1] px-4 py-3"><div><p className="font-mono text-sm text-[#102a43]">{preview.table}</p><p className="mt-1 text-xs text-[#829ab1]">共 {preview.total} 行，显示前 {preview.rows.length} 行{preview.maskedColumns.length ? ` · 已脱敏：${preview.maskedColumns.join("、")}` : ""}</p></div><button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-[#d9e2ec] px-3 py-1.5 text-xs text-[#627d98]">关闭</button></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-[#f7fbf8] text-[#627d98]"><tr>{preview.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}{preview.maskedColumns.includes(column) ? " 🔒" : ""}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index} className="border-t border-[#eef6f1]">{preview.columns.map((column) => <td key={column} className="max-w-[280px] truncate whitespace-nowrap px-3 py-2 font-mono text-[#334e68]" title={String(row[column] ?? "")}>{row[column] === null || row[column] === undefined ? "—" : String(row[column])}</td>)}</tr>)}</tbody></table></div></div>}
    </div>
  </section>;
}

const KNOWLEDGE_SOURCE_LABELS: Record<string, string> = { policy: "门店政策", faq: "常见问答", sop: "内部流程", ticket: "工单沉淀", manual: "手工录入" };
const KNOWLEDGE_AUTHORITY_LABELS: Record<string, string> = { authoritative: "正式政策", reference: "参考资料", hint: "提示" };
const KNOWLEDGE_AUTHORITY_TONES: Record<string, string> = { authoritative: "bg-[#eaf4ff] text-[#1769aa]", reference: "bg-[#f2f7fb] text-[#627d98]", hint: "bg-[#f7efff] text-[#7b4b9c]" };
const KNOWLEDGE_VISIBILITY_LABELS: Record<string, string> = { guest: "客人可见", staff: "仅员工可见" };
const KNOWLEDGE_STATUS_LABELS: Record<string, string> = { active: "生效中", draft: "草稿", retired: "已停用" };
const KNOWLEDGE_STATUS_TONES: Record<string, string> = { active: "bg-[#e8f7ee] text-[#248a4d]", draft: "bg-[#fff1e5] text-[#ad5b16]", retired: "bg-[#f2f7fb] text-[#627d98]" };
const KNOWLEDGE_SOURCE_OPTIONS = ["policy", "faq", "sop", "ticket", "manual"];
const KNOWLEDGE_AUTHORITY_OPTIONS = ["authoritative", "reference", "hint"];
const KNOWLEDGE_STATUS_OPTIONS = ["active", "draft", "retired"];

type KnowledgeDocumentRow = { documentId: string; title: string; source: string; authority: string; visibility: string; version: number; effectiveFrom: string; effectiveTo: string | null; status: string; chunks: number; updatedAt: string | null };
type KnowledgeDocumentGroup = { documents: KnowledgeDocumentRow[]; active?: number; guest_visible?: number; chunksDetail?: Array<{ content: string; keywords: string | null }> };
type KnowledgeDraftForm = { documentId: string | null; title: string; source: string; authority: string; visibility: string; effectiveFrom: string; effectiveTo: string; status: string; chunksText: string; keywords: string };
type PreparedKnowledgeAction = { action_id: string; title: string; confirm_label: string; cancel_label: string; fields: Array<{ label: string; value: string }>; impacts: string[] };
type KnowledgePreview = { query: string; answer: string | null; needs_handoff: boolean; confidence: number; citations: Array<{ title: string; version: number }>; hits: Array<{ document_id: string; title: string; version: number; coverage: number; pair_matched: boolean }> };

/** 管理端工具的统一入口：错误码在这里翻译成店长看得懂的话。 */
async function callAdminTool<T = Record<string, unknown>>(toolName: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: toolName, arguments: args }) });
  const data = await response.json() as { ok?: boolean; result?: T; error?: string };
  if (!response.ok || !data.ok) throw new Error(data.error === "admin_permission_denied" ? "当前角色没有这个权限" : data.error ?? "读取失败");
  return (data.result ?? {}) as T;
}

/**
 * 政策录入：店长在这里维护门店政策，不用写 SQL，也不用改代码。
 * 两条硬约束写在界面上而不是注释里：写进去的每一行就是客人被答到的那一句；
 * 保存先生成确认单，确认后客人才会问到新版本。
 */
function AdminKnowledgePanel({ canManage }: { canManage: boolean }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentRow[]>([]);
  const [status, setStatus] = useState("正在读取门店政策…");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [form, setForm] = useState<KnowledgeDraftForm | null>(null);
  const [pendingAction, setPendingAction] = useState<PreparedKnowledgeAction | null>(null);
  const [probe, setProbe] = useState("");
  const [preview, setPreview] = useState<KnowledgePreview | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      const result = await callAdminTool<KnowledgeDocumentGroup>("admin.list_knowledge_documents", {});
      const list = result.documents ?? [];
      setDocuments(list);
      setStatus(`共 ${list.length} 份文档 · 生效中 ${Number(result.active ?? 0)} 份（其中客人可见 ${Number(result.guest_visible ?? 0)} 份）`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "读取政策失败"); }
    finally { setBusy(false); }
  }, [canManage]);

  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);

  function blankForm(): KnowledgeDraftForm {
    return { documentId: null, title: "", source: "policy", authority: "authoritative", visibility: "guest", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", status: "active", chunksText: "", keywords: "" };
  }

  async function editDocument(documentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const detail = await callAdminTool<KnowledgeDocumentRow & { chunksDetail: Array<{ content: string; keywords: string | null }> }>("admin.get_knowledge_document", { document_id: documentId });
      const keywordUnion = [...new Set((detail.chunksDetail ?? []).flatMap((chunk) => String(chunk.keywords ?? "").split(/\s+/)))].filter(Boolean).join(" ");
      setForm({ documentId: detail.documentId, title: detail.title, source: detail.source, authority: detail.authority, visibility: detail.visibility, effectiveFrom: detail.effectiveFrom.slice(0, 10), effectiveTo: detail.effectiveTo ? detail.effectiveTo.slice(0, 10) : "", status: detail.status, chunksText: (detail.chunksDetail ?? []).map((chunk) => chunk.content).join("\n"), keywords: keywordUnion });
      setStatus(`正在编辑「${detail.title}」v${detail.version}：改完点保存，系统会先生成确认单。`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "读取文档失败"); }
    finally { setBusy(false); }
  }

  async function prepareSave() {
    if (!form || busy) return;
    setBusy(true); setBusyLabel("正在生成确认单…");
    try {
      const action = await callAdminTool<PreparedKnowledgeAction>("admin.prepare_knowledge_document", {
        ...(form.documentId ? { document_id: form.documentId } : {}),
        title: form.title.trim(), source: form.source, authority: form.authority, visibility: form.visibility,
        effective_from: form.effectiveFrom, ...(form.effectiveTo ? { effective_to: form.effectiveTo } : {}),
        status: form.status, chunks: form.chunksText.split("\n").map((line) => line.trim()).filter(Boolean), keywords: form.keywords.trim(),
        reason: form.documentId ? "店长在政策录入界面改版" : "店长在政策录入界面新建",
      });
      setPendingAction(action);
      setStatus("已生成确认单：确认前不会改动任何政策。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "生成确认单失败"); }
    finally { setBusy(false); setBusyLabel(""); }
  }

  async function prepareStatus(row: KnowledgeDocumentRow, next: string) {
    if (busy) return;
    setBusy(true);
    try {
      const action = await callAdminTool<PreparedKnowledgeAction>("admin.prepare_knowledge_status", { document_id: row.documentId, status: next, reason: `店长在政策录入界面把「${row.title}」改为${KNOWLEDGE_STATUS_LABELS[next] ?? next}` });
      setPendingAction(action);
      setStatus("已生成确认单：确认前不会改动任何政策。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "生成确认单失败"); }
    finally { setBusy(false); }
  }

  async function confirmPending() {
    if (!pendingAction || busy) return;
    setBusy(true); setBusyLabel("正在执行…");
    try {
      await callAdminTool("admin.confirm_pending_action", { action_id: pendingAction.action_id, confirmation: "CONFIRM" });
      setPendingAction(null);
      await refresh();
      setStatus("已发布：客人从现在起问到的就是新版本。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "执行失败"); }
    finally { setBusy(false); setBusyLabel(""); }
  }

  async function cancelPending() {
    if (!pendingAction || busy) return;
    setBusy(true);
    try {
      await callAdminTool("admin.cancel_pending_action", { action_id: pendingAction.action_id, reason: "店长在政策录入界面取消" });
      setPendingAction(null);
      setStatus("已取消，没有改动任何政策。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "取消失败"); }
    finally { setBusy(false); }
  }

  async function runProbe() {
    const query = probe.trim();
    if (!query || busy) return;
    setBusy(true);
    try { setPreview(await callAdminTool<KnowledgePreview>("admin.preview_knowledge_answer", { query, visibility: "guest" })); }
    catch (error) { setPreview(null); setStatus(error instanceof Error ? error.message : "试问失败"); }
    finally { setBusy(false); }
  }

  if (!canManage) return null;

  return <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe0f2] bg-[#f8fbff] shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e2eefb] px-5 py-4">
      <div>
        <p className="text-sm text-[#3b78a8]">门店政策</p>
        <h2 className="mt-1 font-semibold">政策知识库（店长自己维护，不用写 SQL）</h2>
        <p className="mt-1 text-xs leading-5 text-[#5b7c99]">这里写进去的每一行，就是客人问到时会被答到的那一句话。保存先生成确认单，确认后客人问到的立刻是新版本；停用之后客人问不到，会自动转前台，而不是拿一条旧政策糊弄。改版会整篇替换切片，不会半新半旧。</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded-lg border border-[#c6dcf3] bg-white px-3 py-2 text-xs disabled:opacity-40">刷新</button>
        <button type="button" onClick={() => setForm(blankForm())} disabled={busy} className="rounded-lg bg-[#007aff] px-3 py-2 text-xs text-white disabled:opacity-40">新建政策</button>
      </div>
    </div>
    <div className="px-5 py-2 text-xs text-[#5b7c99]">{busyLabel || status}</div>
    <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[.9fr_1.1fr]">
      <div className="grid content-start gap-3">
        {documents.length ? documents.map((row) => <article key={row.documentId} className="rounded-2xl border border-[#dbe9f8] bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate font-medium">{row.title}</p><p className="mt-1 font-mono text-[11px] text-[#829ab1]">{row.documentId}</p></div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${KNOWLEDGE_STATUS_TONES[row.status] ?? "bg-[#f2f7fb] text-[#627d98]"}`}>{KNOWLEDGE_STATUS_LABELS[row.status] ?? row.status}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#5b7c99]">
            <span className={`rounded-full px-2 py-0.5 ${KNOWLEDGE_AUTHORITY_TONES[row.authority] ?? "bg-[#f2f7fb] text-[#627d98]"}`}>{KNOWLEDGE_AUTHORITY_LABELS[row.authority] ?? row.authority}</span>
            <span className={`rounded-full px-2 py-0.5 ${row.visibility === "guest" ? "bg-[#eaf4ff] text-[#1769aa]" : "bg-[#fff1e5] text-[#ad5b16]"}`}>{KNOWLEDGE_VISIBILITY_LABELS[row.visibility] ?? row.visibility}</span>
            <span className="rounded-full bg-[#f2f7fb] px-2 py-0.5">v{row.version}</span>
            <span className="rounded-full bg-[#f2f7fb] px-2 py-0.5">{row.chunks} 条切片</span>
            <span className="rounded-full bg-[#f2f7fb] px-2 py-0.5">生效 {row.effectiveFrom.slice(0, 10)}{row.effectiveTo ? ` 至 ${row.effectiveTo.slice(0, 10)}` : " 起长期"}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void editDocument(row.documentId)} disabled={busy} className="rounded-lg border border-[#c6dcf3] bg-[#f8fbff] px-3 py-1.5 text-xs disabled:opacity-40">编辑</button>
            {row.status === "active"
              ? <button type="button" onClick={() => void prepareStatus(row, "retired")} disabled={busy} className="rounded-lg border border-[#f5c2b0] bg-[#fff1ed] px-3 py-1.5 text-xs text-[#8a3a1f] disabled:opacity-40">停用</button>
              : <button type="button" onClick={() => void prepareStatus(row, "active")} disabled={busy} className="rounded-lg border border-[#cfe3d5] bg-[#fbfffc] px-3 py-1.5 text-xs text-[#2f7d4f] disabled:opacity-40">恢复生效</button>}
          </div>
        </article>) : <p className="rounded-2xl border border-[#dbe9f8] bg-white p-4 text-xs text-[#5b7c99]">还没有政策文档。点右上角「新建政策」，把店里的政策一条条录进来。</p>}
      </div>
      <div className="grid content-start gap-4">
        {form && <form className="rounded-2xl border border-[#dbe9f8] bg-white p-4" onSubmit={(event) => { event.preventDefault(); void prepareSave(); }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{form.documentId ? "编辑政策" : "新建政策"}</p>
            <button type="button" onClick={() => setForm(null)} className="text-xs text-[#627d98]">收起</button>
          </div>
          <label className="mt-3 block text-xs text-[#5b7c99]">标题
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={80} required placeholder="例如：加床与婴儿床" className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43] outline-none focus:border-[#007aff]" />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[#5b7c99]">来源
              <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]">{KNOWLEDGE_SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{KNOWLEDGE_SOURCE_LABELS[option]}</option>)}</select>
            </label>
            <label className="block text-xs text-[#5b7c99]">权威度
              <select value={form.authority} onChange={(event) => setForm({ ...form, authority: event.target.value })} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]">{KNOWLEDGE_AUTHORITY_OPTIONS.map((option) => <option key={option} value={option}>{KNOWLEDGE_AUTHORITY_LABELS[option]}</option>)}</select>
            </label>
            <label className="block text-xs text-[#5b7c99]">可见范围
              <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]"><option value="guest">{KNOWLEDGE_VISIBILITY_LABELS.guest}</option><option value="staff">{KNOWLEDGE_VISIBILITY_LABELS.staff}</option></select>
            </label>
            <label className="block text-xs text-[#5b7c99]">状态
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]">{KNOWLEDGE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{KNOWLEDGE_STATUS_LABELS[option]}</option>)}</select>
            </label>
            <label className="block text-xs text-[#5b7c99]">生效日
              <input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} required className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]" />
            </label>
            <label className="block text-xs text-[#5b7c99]">失效日（可空）
              <input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43]" />
            </label>
          </div>
          <label className="mt-3 block text-xs text-[#5b7c99]">政策要点（一行一条，最多 20 行）
            <textarea rows={6} value={form.chunksText} onChange={(event) => setForm({ ...form, chunksText: event.target.value })} placeholder={"早餐时间是早上七点到十点，地点在二楼餐厅。\n住客凭房卡用餐，无需另外付费。"} className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43] outline-none focus:border-[#007aff]" />
          </label>
          <label className="mt-3 block text-xs text-[#5b7c99]">客人可能用到的其他说法（空格分隔，可空）
            <input value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} maxLength={200} placeholder="例如：车位 停车费 车库 地库" className="mt-1 w-full rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43] outline-none focus:border-[#007aff]" />
          </label>
          <p className="mt-1 text-[11px] leading-5 text-[#829ab1]">检索是按字匹配的：客人说「地库」「车库」而正文写的是「地下一层」，就要把那些说法填在这里；它们和正文一样会被索引。</p>
          {form.visibility === "guest" && <p className="mt-2 rounded-xl bg-[#fff8e7] px-3 py-2 text-[11px] leading-5 text-[#8a6417]">客人可见：这条政策会作为终端上客人看到的答案与出处。涉及加收、赔付、内部底价的内容请改选「仅员工可见」。</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#829ab1]">{form.documentId ? "保存后版本自动 +1" : "保存后为 v1"}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-xs">取消</button>
              <button type="submit" disabled={busy || !form.title.trim() || !form.chunksText.trim()} className="rounded-lg bg-[#007aff] px-3 py-2 text-xs text-white disabled:opacity-40">保存并生成确认单</button>
            </div>
          </div>
        </form>}
        <div className="rounded-2xl border border-[#dbe9f8] bg-white p-4">
          <p className="text-sm font-semibold">试问：客人这么问，系统会答什么</p>
          <div className="mt-2 flex gap-2">
            <input value={probe} onChange={(event) => setProbe(event.target.value)} placeholder="例如：地库怎么走" className="min-w-0 flex-1 rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm text-[#102a43] outline-none focus:border-[#007aff]" aria-label="试问内容" />
            <button type="button" onClick={() => void runProbe()} disabled={busy || !probe.trim()} className="rounded-lg border border-[#c6dcf3] bg-[#f8fbff] px-3 py-2 text-xs disabled:opacity-40">试问</button>
          </div>
          {preview && <div className="mt-3 rounded-xl bg-[#f8fbff] px-3 py-3 text-xs leading-6 text-[#334e68]">
            <p className={preview.needs_handoff ? "font-medium text-[#b63d13]" : "font-medium text-[#248a4d]"}>{preview.needs_handoff ? "查不到 → 转人工（不编政策）" : "命中"}{` · 覆盖率 ${Math.round(preview.confidence * 100)}%`}</p>
            {preview.answer && <p className="mt-1">{preview.answer}</p>}
            {preview.citations.length > 0 && <p className="mt-1 text-[#829ab1]">依据：{preview.citations.map((citation) => `${citation.title} v${citation.version}`).join("、")}</p>}
            {preview.hits.length > 0 && <p className="mt-1 text-[#829ab1]">候选：{preview.hits.map((hit) => `${hit.document_id}（${Math.round(hit.coverage * 100)}%${hit.pair_matched ? " · 字对命中" : ""}）`).join("、")}</p>}
          </div>}
          <p className="mt-2 text-[11px] leading-5 text-[#829ab1]">试问走的是终端同一条检索路径，看到的就是客人会看到的。写政策前先试问，写完后再试问一次，这条政策才算真的被人验证过。</p>
        </div>
      </div>
    </div>
    {pendingAction && <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="dialog" aria-modal="true" aria-labelledby="knowledge-confirm-title">
      <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#3b78a8]">政策变更确认</p><h2 id="knowledge-confirm-title" className="mt-2 text-lg font-semibold">{pendingAction.title}</h2></div>
          <button type="button" onClick={() => void cancelPending()} disabled={busy} aria-label="关闭"><X size={19} /></button>
        </div>
        <div className="mt-4 grid gap-2 rounded-2xl border border-[#e2eefb] bg-[#f8fbff] p-4 text-sm">
          {pendingAction.fields.map((field) => <div key={`${field.label}-${field.value}`} className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs text-[#829ab1]">{field.label}</span><span className="font-medium">{field.value}</span></div>)}
        </div>
        <ul className="mt-3 grid gap-1 text-xs leading-5 text-[#334e68]">{pendingAction.impacts.map((impact) => <li key={impact}>· {impact}</li>)}</ul>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={() => void cancelPending()} disabled={busy} className="rounded-xl border border-[#cbd9e5] px-4 py-2.5 text-sm disabled:opacity-50">{pendingAction.cancel_label || "取消"}</button>
          <button type="button" onClick={() => void confirmPending()} disabled={busy} className="rounded-xl bg-[#007aff] px-4 py-2.5 text-sm text-white disabled:opacity-50">{busy ? "执行中…" : pendingAction.confirm_label || "确认发布"}</button>
        </div>
      </section>
    </div>}
  </section>;
}

const ROOM_STATUS_LABELS: Record<string, string> = { "vacant-clean": "可售", "vacant-dirty": "待清洁", held: "已锁房", occupied: "已占用", "out-of-order": "维修中", unknown: "未知" };
const ROOM_STATUS_TONES: Record<string, string> = { "vacant-clean": "bg-[#e8f7ee] text-[#248a4d]", "vacant-dirty": "bg-[#fff1e5] text-[#ad5b16]", held: "bg-[#eaf4ff] text-[#1769aa]", occupied: "bg-[#fff1ed] text-[#b63d13]", "out-of-order": "bg-[#f2f7fb] text-[#627d98]", unknown: "bg-[#f2f7fb] text-[#627d98]" };

type PipelineStageId = "mic" | "asr" | "model" | "tool" | "confirm";
type PipelineStageStatus = "idle" | "connecting" | "normal" | "timeout" | "failed" | "cancelled";
type PipelineStageState = { id: PipelineStageId; label: string; status: PipelineStageStatus; detail?: string; latencyMs?: number };

const INITIAL_PIPELINE: PipelineStageState[] = [
  { id: "mic", label: "麦克风", status: "idle" },
  { id: "asr", label: "ASR", status: "idle" },
  { id: "model", label: "模型", status: "idle" },
  { id: "tool", label: "工具", status: "idle" },
  { id: "confirm", label: "确认", status: "idle" },
];

type PairingCheckStatus = "pending" | "checking" | "passed" | "warning" | "failed";
type PairingCheck = { id: "context" | "microphone" | "certificate" | "service" | "connection"; label: string; status: PairingCheckStatus; detail: string };

const DEFAULT_ADAPTER: AdapterConfig = {
  provider: "QloApps",
  version: "1.6.1",
  baseUrl: "https://pms.example.local/api",
  apiKey: "TEMP_PMS_API_KEY_REPLACE_ME",
  asrWsUrl: "wss://127.0.0.1:8765/asr",
  propertyCode: "GZ-HAOS-001",
  hotelName: "Hotel Agent OS 广州示范店",
};

const EMPTY_SNAPSHOT: Snapshot = { orders: [], cases: [], browserJobs: [], auditEvents: [], manualTasks: [] };

const TERMINAL_PROGRESS = [
  ["订单匹配", "精确检索数据库"],
  ["证件感应", "排除遗留与重复读卡"],
  ["身份核验", "自动读卡与实名核验"],
  ["锁定房间", "调用 PMS 演示接口"],
  ["住宿登记", "隔离浏览器模拟"],
  ["确认入住", "校验回执并写回 PMS"],
  ["制作房卡", "自动写卡、回读并吐卡"],
  ["取卡确认", "确认身份证与房卡已取走"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  awaiting_arrival: "待入住",
  in_house: "已入住",
  cancelled: "已取消",
  checkin_confirmed: "入住已确认",
  ORDER_MATCHED: "订单已匹配",
  IDENTITY_VERIFIED: "身份已核验",
  ROOM_HELD: "房间已锁定",
  POLICE_RUNNING: "登记模拟中",
  IDENTITY_READING: "正在读取身份证",
  POLICE_COMPLETED: "住宿登记完成",
  PMS_CHECKIN_CONFIRMED: "PMS 已确认入住",
  KEYCARD_WRITING: "正在制作房卡",
  KEYCARD_DISPENSED: "房卡已送达取卡口",
  CHECKIN_COMPLETE: "自助入住完成",
  HANDOFF_REQUIRED: "需要现场人工接手",
};

function createSessionId() {
  return `demo_${crypto.randomUUID().replaceAll("-", "")}`;
}

type FlowStepInfo = { number: number; code: string; label: string; target: string };
const FLOW_STEPS: FlowStepInfo[] = [
  { number: 1, code: "ORDER_MATCH", label: "订单匹配", target: "pms" },
  { number: 2, code: "IDENTITY_READ", label: "证件读取与身份核验", target: "reader" },
  { number: 3, code: "ROOM_HOLD", label: "锁定房间", target: "pms" },
  { number: 4, code: "POLICE_REGISTRATION", label: "公安登记", target: "police" },
  { number: 5, code: "PMS_CHECKIN", label: "确认入住", target: "pms" },
  { number: 6, code: "KEYCARD_ISSUE", label: "制作房卡", target: "encoder" },
  { number: 7, code: "CARD_PICKUP", label: "取卡与取证件确认", target: "encoder" },
];

type ApiErrorPayload = { error?: string; error_code?: string; current_state?: string; expected_next?: string; retryable?: boolean; status?: string; command_id?: string };
class FlowStepError extends Error {
  constructor(public readonly step: FlowStepInfo, public readonly code: string, public readonly retryable: boolean, public readonly status: string, public readonly commandId?: string, public readonly currentState?: string) {
    super(code);
    this.name = "FlowStepError";
  }
}

type ReconcileResponse = { ok: boolean; current_case?: Partial<CheckinCase>; current_state: string; current_state_label: string; last_command: { id: string; target: string; operation: string; status: string; error_code: string | null; retryable: boolean } | null; unresolved_external_call: { id: string; target: string; operation: string; status: string; error_code: string | null } | null; invariant_failures: string[]; recommended_action: string };

async function postDemo<T>(action: string, body: Record<string, unknown>, step?: FlowStepInfo): Promise<T> {
  const response = await fetch(`/api/demo/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    if (step) throw new FlowStepError(step, data.error_code ?? data.error ?? "REQUEST_FAILED", Boolean(data.retryable), data.status ?? `${response.status}`, data.command_id, data.current_state);
    throw new Error(data.error ?? "request_failed");
  }
  return data;
}

async function postAgentStream(body: Record<string, unknown>, onDelta: (delta: string) => void): Promise<AgentResponse> {
  const response = await fetch("/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("agent_turn_failed");
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return (await response.json()) as AgentResponse;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: AgentResponse | null = null;
  const consume = (block: string) => {
    const line = block.split("\n").find((candidate) => candidate.startsWith("data: "));
    if (!line) return;
    const event = JSON.parse(line.slice(6)) as { type: string; delta?: string; response?: AgentResponse };
    if (event.type === "text_delta" && event.delta) onDelta(event.delta);
    if ((event.type === "done" || event.type === "fallback") && event.response) finalResponse = event.response;
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!finalResponse) throw new Error("agent_stream_incomplete");
  return finalResponse;
}

async function postSimulator<T extends { ok?: boolean; status?: string; error_code?: string; retryable?: boolean; command_id?: string }>(path: string, body: Record<string, unknown>, step?: FlowStepInfo): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    if (step) throw new FlowStepError(step, data.error_code ?? data.error ?? "SIMULATOR_REQUEST_FAILED", Boolean(data.retryable), data.status ?? `${response.status}`, data.command_id);
    throw new Error(data.error ?? "simulator_request_failed");
  }
  if (data.status !== "SUCCEEDED") {
    if (step) throw new FlowStepError(step, data.error_code ?? `SIMULATOR_${data.status ?? "FAILED"}`, Boolean(data.retryable), data.status ?? "UNKNOWN", data.command_id);
    throw new Error(data.error_code ?? `simulator_${data.status ?? "failed"}`);
  }
  return data;
}

function speak(text: string, enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function resolveAsrWebSocketUrl(value: string) {
  if (typeof window === "undefined") return value;
  if (window.location.protocol === "https:" && value.startsWith("ws://")) return value.replace(/^ws:\/\//, "wss://");
  return value;
}

function isFillerTranscript(value: string) {
  return /^(嗯+|啊+|呃+|额+|唉+|哦+)[。！!？?，,、\s]*$/u.test(value.trim());
}

function maskJourneyPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  return digits ? `尾号 ${digits.slice(-4)}` : "尚未提供";
}

function GuestJourneyPanel({ steps }: { steps: JourneyStep[] }) {
  const firstActive = steps.findIndex((step) => step.state === "active");
  const activeIndex = firstActive >= 0 ? firstActive : steps.length - 1;
  return <section aria-label="当前办理进度" className="mt-6 w-full max-w-3xl rounded-[1.7rem] border border-[#d8e9f8] bg-white/90 p-4 text-left shadow-sm backdrop-blur-md">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-xs font-semibold uppercase tracking-[.15em] text-[#1769aa]">当前办理进度</p><p className="mt-1 text-sm text-[#4f6478]">手机号、身份证和确认状态会实时同步显示</p></div>
      <span className="rounded-full bg-[#eef6ff] px-3 py-1.5 text-xs font-medium text-[#1769aa]">第 {Math.min(activeIndex + 1, steps.length)} 步</span>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => <div key={step.label} className={`rounded-2xl border p-3 ${step.state === "done" ? "border-[#bde7cf] bg-[#effaf4]" : step.state === "active" ? "border-[#b9d8f4] bg-[#eef6ff]" : "border-[#e5e5ea] bg-[#fafafa]"}`}>
        <div className="flex items-center gap-2"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.state === "done" ? "bg-[#34c759] text-white" : step.state === "active" ? "bg-[#007aff] text-white" : "bg-[#e5e5ea] text-[#86868b]"}`}>{step.state === "done" ? <Check size={14} /> : index + 1}</span><p className="text-sm font-semibold">{step.label}</p></div>
        <p className={`mt-2 text-xs leading-5 ${step.state === "active" ? "text-[#1769aa]" : "text-[#6e6e73]"}`}>{step.detail}</p>
      </div>)}
    </div>
  </section>;
}

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [view, setView] = useState<"terminal" | "admin">("terminal");
  const [sessionId, setSessionId] = useState("");
  const [adapter, setAdapter] = useState(DEFAULT_ADAPTER);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loadingData, setLoadingData] = useState(false);
  const [pairingComplete, setPairingComplete] = useState(false);

  useEffect(() => {
    const storedSession = localStorage.getItem("hotel_demo_session") || createSessionId();
    const storedAdapter = localStorage.getItem("hotel_adapter_config");
    localStorage.setItem("hotel_demo_session", storedSession);
    queueMicrotask(() => {
      setSessionId(storedSession);
      if (storedAdapter) {
        try {
          setAdapter({ ...DEFAULT_ADAPTER, ...(JSON.parse(storedAdapter) as Partial<AdapterConfig>) });
        } catch {
          localStorage.removeItem("hotel_adapter_config");
        }
      }
      setSetupComplete(localStorage.getItem("hotel_setup_complete") === "true");
      setPairingComplete(localStorage.getItem("hotel_pairing_complete") === "true");
      setHydrated(true);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoadingData(true);
    try {
      const response = await fetch(`/api/demo/bootstrap?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("bootstrap_failed");
      const data = (await response.json()) as Snapshot;
      setSnapshot(data);
    } finally {
      setLoadingData(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (setupComplete && sessionId) queueMicrotask(() => void refresh());
  }, [refresh, sessionId, setupComplete]);

  if (!hydrated) return <LoadingScreen />;
  if (!setupComplete) {
    return <AdapterWizard initial={adapter} onComplete={(next) => {
      setAdapter(next);
      setSetupComplete(true);
      localStorage.setItem("hotel_adapter_config", JSON.stringify(next));
      localStorage.setItem("hotel_setup_complete", "true");
    }} />;
  }
  if (!pairingComplete) {
    return <EnvironmentPairing adapter={adapter} onComplete={() => {
      setPairingComplete(true);
      localStorage.setItem("hotel_pairing_complete", "true");
    }} onContinueText={() => {
      setPairingComplete(true);
      localStorage.setItem("hotel_pairing_complete", "true");
    }} />;
  }
  if (view === "admin") {
    return <AdminConsole sessionId={sessionId} adapter={adapter} snapshot={snapshot} loading={loadingData} onRefresh={refresh} onBack={() => setView("terminal")} onPairing={() => {
      localStorage.removeItem("hotel_pairing_complete");
      setPairingComplete(false);
    }} onReconfigure={() => {
      localStorage.removeItem("hotel_setup_complete");
      localStorage.removeItem("hotel_pairing_complete");
      setSetupComplete(false);
      setPairingComplete(false);
    }} />;
  }
  return <VoiceTerminal sessionId={sessionId} adapter={adapter} snapshot={snapshot} onRefresh={refresh} onOpenAdmin={() => setView("admin")} onNewSession={() => {
    const nextSession = createSessionId();
    localStorage.setItem("hotel_demo_session", nextSession);
    setSessionId(nextSession);
    setSnapshot(EMPTY_SNAPSHOT);
  }} />;
}

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center bg-[#f5f5f7] text-[#1d1d1f]"><LoaderCircle className="animate-spin" /></main>;
}

const INITIAL_PAIRING_CHECKS: PairingCheck[] = [
  { id: "context", label: "页面安全环境", status: "pending", detail: "等待检测" },
  { id: "microphone", label: "麦克风权限", status: "pending", detail: "等待检测" },
  { id: "certificate", label: "本地证书信任", status: "pending", detail: "等待 WSS 握手" },
  { id: "service", label: "Qwen ASR 服务", status: "pending", detail: "等待服务回执" },
  { id: "connection", label: "语音连接状态", status: "pending", detail: "等待检测" },
];

function EnvironmentPairing({ adapter, onComplete, onContinueText }: { adapter: AdapterConfig; onComplete: () => void; onContinueText: () => void }) {
  const [checks, setChecks] = useState(INITIAL_PAIRING_CHECKS);
  const [testing, setTesting] = useState(false);
  const [serviceInfo, setServiceInfo] = useState("");
  const updateCheck = (id: PairingCheck["id"], status: PairingCheckStatus, detail: string) => setChecks((current) => current.map((item) => item.id === id ? { ...item, status, detail } : item));

  async function runChecks() {
    setTesting(true);
    setServiceInfo("");
    setChecks(INITIAL_PAIRING_CHECKS.map((item) => ({ ...item, status: "pending", detail: "等待检测" })));

    const secure = typeof window !== "undefined" && window.isSecureContext;
    if (secure) updateCheck("context", "passed", "当前页面可调用受保护的浏览器能力");
    else updateCheck("context", "failed", "当前页面不是安全上下文，请用 HTTPS Chrome/Edge 打开");

    if (!secure || !navigator.mediaDevices?.getUserMedia) {
      updateCheck("microphone", "failed", !secure ? "页面安全环境不满足，无法申请麦克风" : "当前浏览器没有麦克风接口");
    } else {
      updateCheck("microphone", "checking", "正在检查权限（必要时会弹出一次授权）");
      try {
        let permission: PermissionState | "unknown" = "unknown";
        try {
          const permissionStatus = await navigator.permissions?.query({ name: "microphone" as PermissionName });
          permission = permissionStatus?.state ?? "unknown";
        } catch { /* 部分浏览器不提供 microphone 权限查询 */ }
        if (permission === "denied") throw new Error("microphone_denied");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        updateCheck("microphone", "passed", permission === "granted" ? "麦克风已授权" : "麦克风已授权，本次检测未保存录音");
      } catch (error) {
        updateCheck("microphone", "failed", error instanceof Error && error.message === "microphone_denied" ? "麦克风权限被拒绝，请在浏览器地址栏重新允许" : "无法取得麦克风，请确认设备已连接并允许使用");
      }
    }

    updateCheck("certificate", "checking", "正在建立本地 WSS 连接");
    updateCheck("service", "checking", "等待 Qwen ASR 就绪回执");
    updateCheck("connection", "checking", "正在验证连接与来源校验");
    await new Promise<void>((resolve) => {
      if (!adapter.asrWsUrl || typeof WebSocket === "undefined") {
        updateCheck("certificate", "failed", "没有配置本地 WSS 地址");
        updateCheck("service", "failed", "没有可用的 ASR 地址");
        updateCheck("connection", "failed", "语音连接未建立");
        resolve();
        return;
      }
      let settled = false;
      const socket = new WebSocket(resolveAsrWebSocketUrl(adapter.asrWsUrl));
      const finish = () => { if (!settled) { settled = true; window.clearTimeout(timer); socket.close(); resolve(); } };
      const timer = window.setTimeout(() => {
        updateCheck("certificate", "failed", "WSS 握手超时，可能是证书不信任或服务未启动");
        updateCheck("service", "failed", "未收到 Qwen ASR 就绪回执");
        updateCheck("connection", "failed", "无法连接本机 ASR，请确认服务已启动");
        finish();
      }, 3500);
      socket.onopen = () => {
        updateCheck("certificate", "passed", "WSS 握手成功，证书已被当前浏览器接受");
        updateCheck("connection", "checking", "已连接，正在等待服务回执");
        socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
      };
      socket.onmessage = (event) => {
        let payload: AsrSocketMessage;
        try { payload = JSON.parse(String(event.data)) as AsrSocketMessage; } catch { return; }
        if (payload.type === "ready") {
          const info = [payload.model, payload.device, payload.transport?.toUpperCase()].filter(Boolean).join(" · ");
          setServiceInfo(info);
          updateCheck("service", "passed", info ? `服务已就绪 · ${info}` : "服务已就绪");
          updateCheck("connection", "passed", "来源校验通过，语音链路可用");
          finish();
        } else if (payload.type === "error") {
          updateCheck("service", "failed", payload.message || payload.code || "ASR 服务返回错误");
          updateCheck("connection", "failed", "服务拒绝了当前连接");
          finish();
        }
      };
      socket.onerror = () => {
        updateCheck("certificate", "failed", "WSS 连接失败，证书可能未信任或地址不可达");
        updateCheck("service", "failed", "没有收到 ASR 服务回执");
        updateCheck("connection", "failed", "请检查本地服务、证书和来源配置");
        finish();
      };
      socket.onclose = () => { if (!settled) { updateCheck("connection", "failed", "连接提前关闭"); finish(); } };
    });
    setTesting(false);
  }

  const allPassed = checks.every((item) => item.status === "passed");
  return <main className="min-h-screen bg-[#f5f5f7] px-5 py-8 text-[#1d1d1f] md:px-10 md:py-12">
    <section className="mx-auto max-w-4xl">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d1d1f] text-white"><ShieldCheck size={19} /></div><div><p className="font-semibold">Hotel Agent OS</p><p className="text-xs text-[#86868b]">首次启动 · 环境配对</p></div></div>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_.85fr]">
        <section className="rounded-[2rem] bg-white p-6 shadow-sm md:p-9"><p className="text-xs font-medium uppercase tracking-[.18em] text-[#86868b]">环境检测</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.05em] md:text-5xl">让语音先准备好。</h1><p className="mt-4 leading-7 text-[#6e6e73]">只检测当前设备是否能安全连接本地 ASR，不上传录音，也不会读取证书私钥。</p><div className="mt-8 space-y-3">{checks.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-[#ededf0] px-4 py-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.status === "passed" ? "bg-[#e8f7ee] text-[#248a4d]" : item.status === "failed" ? "bg-[#fff0ed] text-[#c54b12]" : item.status === "checking" ? "bg-[#eaf4ff] text-[#1769aa]" : "bg-[#f2f2f7] text-[#86868b]"}`}>{item.status === "passed" ? <CircleCheck size={18} /> : item.status === "failed" ? <AlertTriangle size={18} /> : item.status === "checking" ? <LoaderCircle size={18} className="animate-spin" /> : <Clock3 size={18} />}</div><div className="min-w-0"><p className="font-medium">{item.label}</p><p className="mt-0.5 text-sm text-[#6e6e73]">{item.detail}</p></div></div>)}</div><div className="mt-7 flex flex-wrap gap-3"><button onClick={() => void runChecks()} disabled={testing} className="rounded-full border border-[#d2d2d7] px-5 py-3 text-sm font-medium disabled:opacity-50">{testing ? "检测中…" : "开始检测"}</button>{allPassed ? <button onClick={onComplete} className="rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">进入语音系统</button> : <button onClick={onContinueText} className="rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-medium text-white">继续文字模式</button>}</div><p className="mt-4 text-xs leading-5 text-[#86868b]">语音权限只能由浏览器或酒店安装策略授予。检测失败不会影响订单查询和文字办理。</p></section>
        <aside className="rounded-[2rem] bg-[#1d1d1f] p-7 text-white md:p-9"><Database size={27} className="text-[#64d2ff]" /><h2 className="mt-8 text-2xl font-semibold tracking-[-.03em]">当前配对目标</h2><div className="mt-6 space-y-4 text-sm leading-6 text-[#c7c7cc]"><p><span className="text-[#8e8e93]">酒店：</span>{adapter.hotelName}</p><p><span className="text-[#8e8e93]">PMS：</span>{adapter.provider} {adapter.version}</p><p><span className="text-[#8e8e93]">ASR：</span>{adapter.asrWsUrl}</p>{serviceInfo && <p><span className="text-[#8e8e93]">回执：</span>{serviceInfo}</p>}<p className="border-t border-white/10 pt-4">证书只用于本机 WSS 加密，私钥不会进入网页、数据库或代码仓库。</p></div></aside>
      </div>
    </section>
  </main>;
}

function AdapterWizard({ initial, onComplete }: { initial: AdapterConfig; onComplete: (config: AdapterConfig) => void }) {
  const [draft, setDraft] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  function update(field: keyof AdapterConfig, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  async function testAdapter() {
    setTesting(true);
    try {
      const response = await fetch("/api/pms/ping", { cache: "no-store" });
      if (!response.ok) throw new Error("pms_ping_failed");
      setTested(true);
    } finally {
      setTesting(false);
    }
  }
  return <main className="min-h-screen bg-[#f5f5f7] px-5 py-8 text-[#1d1d1f] md:px-10 md:py-12">
    <section className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d1d1f] text-white"><Building2 size={19} /></div><div><p className="font-semibold">Hotel Agent OS</p><p className="text-xs text-[#86868b]">首次启动 · 独立酒店实例</p></div></div>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-[2rem] bg-white p-6 shadow-sm md:p-9"><p className="text-xs font-medium uppercase tracking-[.18em] text-[#86868b]">适配器</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.05em] md:text-5xl">把酒店接进来。</h1><p className="mt-4 max-w-xl leading-7 text-[#6e6e73]">缺失字段会先采用安全的演示占位值。管理员之后可以在每个酒店独立后台重新配置。</p><div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Field label="PMS 名称" value={draft.provider} onChange={(value) => update("provider", value)} />
          <Field label="版本" value={draft.version} onChange={(value) => update("version", value)} />
          <Field label="API 地址" value={draft.baseUrl} onChange={(value) => update("baseUrl", value)} wide />
          <Field label="酒店编码" value={draft.propertyCode} onChange={(value) => update("propertyCode", value)} />
          <Field label="酒店名称" value={draft.hotelName} onChange={(value) => update("hotelName", value)} />
          <Field label="API Key（临时占位）" value={draft.apiKey} onChange={(value) => update("apiKey", value)} wide secret />
          <Field label="本地 ASR WebSocket 地址" value={draft.asrWsUrl} onChange={(value) => update("asrWsUrl", value)} wide />
        </div><div className="mt-7 flex flex-wrap gap-3"><button onClick={testAdapter} disabled={testing} className="rounded-full border border-[#d2d2d7] px-5 py-3 text-sm font-medium disabled:opacity-50">{testing ? "检测中…" : tested ? "五项接口已通过" : "检测适配器"}</button><button onClick={() => onComplete(draft)} className="rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">进入演示系统</button></div></section>
        <aside className="rounded-[2rem] bg-[#1d1d1f] p-7 text-white md:p-9"><ShieldCheck size={27} className="text-[#64d2ff]" /><h2 className="mt-8 text-2xl font-semibold tracking-[-.03em]">先演示，后接生产。</h2><div className="mt-6 space-y-5 text-sm leading-6 text-[#c7c7cc]"><p>当前 API Key 明确标记为临时占位，不会调用真实 PMS。</p><p>假订单按浏览器会话隔离，敏感身份字段不进入 AI 上下文。</p><p>公安浏览器和房卡硬件只展示受控流程，不执行真实外部操作。</p></div></aside>
      </div>
    </section>
  </main>;
}

function Field({ label, value, onChange, wide = false, secret = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; secret?: boolean }) {
  return <label className={`text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>{label}<input type={secret ? "password" : "text"} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 text-sm font-normal outline-none focus:border-[#007aff]" /></label>;
}

const SAMPLE_UTTERANCES = ["我在平台订了房，帮我查一下订单", "我没有预订，想直接入住", "早餐几点开始？", "房卡怎么还没出来？"];

type TerminalPhase = "idle" | "searching" | "matched" | "processing" | "ambiguous" | "not_found" | "blocked" | "complete" | "error";

function VoiceTerminal({ sessionId, adapter, snapshot, onRefresh, onOpenAdmin, onNewSession }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; onRefresh: () => Promise<void>; onOpenAdmin: () => void; onNewSession: () => void }) {
  const [conversationId, setConversationId] = useState(() => `conv_${crypto.randomUUID().replaceAll("-", "")}`);
  const [last4, setLast4] = useState("");
  const [utterance, setUtterance] = useState("");
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [terminalMode, setTerminalMode] = useState<"choose" | "checkin" | "checkout">("choose");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<DemoOrder | null>(null);
  const [checkinCase, setCheckinCase] = useState<CheckinCase | null>(null);
  const [depositStatus, setDepositStatus] = useState<"captured" | "pending" | "failed" | null>(null);
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<DemoOrder[]>([]);
  const [walkInDraft, setWalkInDraft] = useState<WalkInDraft | null>(null);
  const [pendingWalkInPhone, setPendingWalkInPhone] = useState<string | null>(null);
  const [walkInRoomTypes, setWalkInRoomTypes] = useState<WalkInRoomType[]>([]);
  const [walkInPayment, setWalkInPayment] = useState<WalkInPayment | null>(null);
  const [message, setMessage] = useState("您好，今天想办理什么？");
  const [intentTrace, setIntentTrace] = useState<Pick<IntentResponse, "label" | "confidence" | "action"> | null>(null);
  const [flowStep, setFlowStep] = useState(0);
  const [flowError, setFlowError] = useState<{ step: FlowStepInfo; code: string; retryable: boolean; status: string; reconciliation?: ReconcileResponse | null } | null>(null);
  const [voiceBackend, setVoiceBackend] = useState<"local" | "browser" | "unavailable" | null>(null);
  const [audioCaptureStatus, setAudioCaptureStatus] = useState<"unknown" | "checking" | "ok" | "silent" | "error">("unknown");
  const [audioDeviceLabel, setAudioDeviceLabel] = useState("");
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceFinalizing, setVoiceFinalizing] = useState(false);
  const [continuousConversation, setContinuousConversation] = useState(true);
  const [computerUseEnabled, setComputerUseEnabled] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const asrSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const localAsrResultRef = useRef(false);
  const voiceSubmitRequestedRef = useRef(false);
  const voiceAutoSubmitRef = useRef(false);
  const continuousResumeRef = useRef(false);
  const asrChunkTailRef = useRef(Promise.resolve());
  const asrAudioBytesRef = useRef(0);
  const asrAudioChunksRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMonitorFrameRef = useRef<number | null>(null);
  const audioSignalSeenRef = useRef(false);
  const voiceFinalizationTimerRef = useRef<number | null>(null);
  const browserFinalTranscriptRef = useRef("");
  const browserInterimTranscriptRef = useRef("");
  const submitInFlightRef = useRef<string | null>(null);
  const digitalEventIdsRef = useRef<Set<string>>(new Set());
  const conversationRef = useRef<AgentHistoryMessage[]>([]);
  const conversationGenerationRef = useRef(0);
  const utteranceInputRef = useRef<HTMLInputElement>(null);

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput").map((device, index) => ({ deviceId: device.deviceId, label: device.label || `麦克风 ${index + 1}` }));
    setAudioInputs(inputs);
    if (selectedAudioDeviceId && !inputs.some((device) => device.deviceId === selectedAudioDeviceId)) {
      setSelectedAudioDeviceId("");
      localStorage.removeItem("hotel_audio_input_device");
    }
  }, [selectedAudioDeviceId]);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedAudioDeviceId(localStorage.getItem("hotel_audio_input_device") || "");
      void refreshAudioInputs();
    });
    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => { void refreshAudioInputs(); };
    mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
  }, [refreshAudioInputs]);

  const computerUseStatus = useMemo<ComputerUseStatus>(() => {
    if (!computerUseEnabled) return "idle";
    if (phase === "searching" || phase === "processing") return "executing";
    if (phase === "matched" || phase === "ambiguous") return "waiting_confirmation";
    if (phase === "error" || phase === "blocked") return "blocked";
    return "idle";
  }, [computerUseEnabled, phase]);

  const handleAudioDeviceChange = useCallback((deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);
    if (deviceId) localStorage.setItem("hotel_audio_input_device", deviceId);
    else localStorage.removeItem("hotel_audio_input_device");
  }, []);

  function recordConversation(role: TranscriptEntry["role"], content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    const entry = { id: crypto.randomUUID(), role, content: trimmed };
    setTranscript((current) => [...current, entry].slice(-40));
    conversationRef.current = [...conversationRef.current, { role, content: trimmed }].slice(-24);
  }

  const activeMessage = useMemo(() => {
    if (phase === "complete") return "入住完成，请带好身份证和房卡";
    if (phase === "processing") return TERMINAL_PROGRESS[Math.min(flowStep, TERMINAL_PROGRESS.length - 1)][0];
    return message;
  }, [flowStep, message, phase]);

  function reset() {
    stopListening();
    // A terminal/manual-handoff state belongs to the old browser session. A
    // new guest must not inherit its check-in case, external commands, or
    // simulator faults, so rotate the demo session before starting over.
    onNewSession();
    startNewConversation("办理下一位");
    setLast4("");
    setUtterance("");
    setPhase("idle");
    setMatchedOrder(null);
    setCheckinCase(null);
    setDepositStatus(null);
    setDepositAmount(null);
    setAlternatives([]);
    setWalkInDraft(null);
    setPendingWalkInPhone(null);
    setWalkInRoomTypes([]);
    setWalkInPayment(null);
    setIntentTrace(null);
    setFlowStep(0);
    setFlowError(null);
    setTerminalMode("choose");
    conversationRef.current = [];
    setTranscript([]);
    setMessage("您好，今天想办理什么？");
    speak("您好，今天想办理什么？您可以直接说。", voiceEnabled);
  }

  function startNewConversation(reason: string) {
    conversationGenerationRef.current += 1;
    conversationRef.current = [];
    setConversationId(`conv_${crypto.randomUUID().replaceAll("-", "")}`);
    setUtterance("");
    setIntentTrace(null);
    setTranscript((current) => [...current, { id: crypto.randomUUID(), role: "tool" as const, content: `已开启新的业务对话：${reason}。上一位客人的对话不会用于本次办理。` }].slice(-40));
  }

  function clearVoiceTimer() {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    if (voiceFinalizationTimerRef.current !== null) window.clearTimeout(voiceFinalizationTimerRef.current);
    voiceFinalizationTimerRef.current = null;
  }

  function stopAudioMonitor() {
    if (audioMonitorFrameRef.current !== null) window.cancelAnimationFrame(audioMonitorFrameRef.current);
    audioMonitorFrameRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
    setAudioLevel(0);
  }

  function startAudioMonitor(stream: MediaStream) {
    stopAudioMonitor();
    audioSignalSeenRef.current = false;
    setAudioCaptureStatus("checking");
    const track = stream.getAudioTracks()[0];
    setAudioDeviceLabel(track?.label || "默认麦克风");
    if (track) {
      track.onmute = () => setAudioCaptureStatus("error");
      track.onunmute = () => setAudioCaptureStatus(audioSignalSeenRef.current ? "ok" : "checking");
    }
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const monitor = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      setAudioLevel(Math.min(1, rms * 8));
      if (rms >= 0.015) {
        audioSignalSeenRef.current = true;
        setAudioCaptureStatus("ok");
      }
      audioMonitorFrameRef.current = window.requestAnimationFrame(monitor);
    };
    void context.resume().catch(() => undefined);
    audioMonitorFrameRef.current = window.requestAnimationFrame(monitor);
  }

  function releaseVoiceResources(closeSocket = true) {
    clearVoiceTimer();
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopAudioMonitor();
    const socket = asrSocketRef.current;
    if (closeSocket && socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (closeSocket) asrSocketRef.current = null;
    setListening(false);
  }

  function stopListening() {
    voiceSubmitRequestedRef.current = false;
    voiceAutoSubmitRef.current = false;
    continuousResumeRef.current = false;
    setVoiceFinalizing(false);
    releaseVoiceResources(true);
  }

  function finishBrowserSubmission(autoSubmit = voiceAutoSubmitRef.current) {
    const finalText = [browserFinalTranscriptRef.current, browserInterimTranscriptRef.current].filter(Boolean).join(" ").trim();
    if (finalText) {
      setUtterance(finalText);
      if (autoSubmit) {
        continuousResumeRef.current = continuousConversation;
        setMessage("已听清，正在交给 AI 处理");
      } else {
        setMessage("语音已识别，请检查文字后点击发送");
      }
    } else setMessage("没有听清内容，请再说一次，或直接输入文字");
    voiceSubmitRequestedRef.current = false;
    voiceAutoSubmitRef.current = false;
    setVoiceFinalizing(false);
    releaseVoiceResources(true);
    if (autoSubmit && finalText) void submitUtterance(finalText);
  }

  function finishListeningAndSubmit(autoSubmit = false) {
    if (!listening) {
      if (utterance.trim()) void submitUtterance();
      return;
    }
    if (voiceFinalizing) return;
    voiceSubmitRequestedRef.current = autoSubmit;
    voiceAutoSubmitRef.current = autoSubmit;
    setVoiceFinalizing(true);
    setMessage("正在整理语音内容，请稍候；识别后可先修改文字");
    if (voiceBackend === "browser") {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onend = finishBrowserSubmission;
        recognition.stop();
      } else {
        finishBrowserSubmission();
      }
      return;
    }
    const recorder = mediaRecorderRef.current;
    const socket = asrSocketRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        void asrChunkTailRef.current.then(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "stop", client_audio_chunks: asrAudioChunksRef.current, client_audio_bytes: asrAudioBytesRef.current }));
          }
        });
      };
      recorder.stop();
    } else if (socket?.readyState === WebSocket.OPEN) {
      void asrChunkTailRef.current.then(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "stop", client_audio_chunks: asrAudioChunksRef.current, client_audio_bytes: asrAudioBytesRef.current }));
        }
      });
    } else {
      releaseVoiceResources(true);
      setVoiceFinalizing(false);
      voiceSubmitRequestedRef.current = false;
      voiceAutoSubmitRef.current = false;
      setMessage("本地语音服务没有返回结果，请重试或直接输入文字");
      return;
    }
    // Keep the recorder and stream alive until the final dataavailable chunk
    // has been sent and ASR replies. Stopping tracks here can truncate audio.
    voiceFinalizationTimerRef.current = window.setTimeout(() => {
      const hadText = utterance.trim();
      releaseVoiceResources(true);
      voiceSubmitRequestedRef.current = false;
      voiceAutoSubmitRef.current = false;
      continuousResumeRef.current = false;
      setVoiceFinalizing(false);
      setMessage(hadText ? "语音已整理完成，确认无误后点击发送" : "本地语音识别超时，请重新录音或直接输入文字");
    }, 25000);
  }

  function startBrowserRecognition() {
    const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage("当前浏览器不支持语音识别，您可以直接打字告诉我");
      setListening(false);
      return;
    }
    setVoiceBackend("browser");
    browserFinalTranscriptRef.current = "";
    browserInterimTranscriptRef.current = "";
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const text = event.results[index]?.[0]?.transcript?.trim();
        if (!text) continue;
        if (event.results[index]?.isFinal) finalParts.push(text);
        else interimParts.push(text);
      }
      browserFinalTranscriptRef.current = finalParts.join(" ").trim();
      browserInterimTranscriptRef.current = interimParts.join(" ").trim();
      const combined = [browserFinalTranscriptRef.current, browserInterimTranscriptRef.current].filter(Boolean).join(" ").trim();
      if (combined) setUtterance(combined);
    };
    recognition.onerror = () => {
      if (voiceSubmitRequestedRef.current) finishBrowserSubmission();
      else setMessage("没有听清，您可以继续说，或改用文字输入");
    };
    recognition.onend = () => {
      if (voiceSubmitRequestedRef.current) finishBrowserSubmission();
      else if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch { setMessage("语音通道已结束，请点击发送或重新开始"); }
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    setMessage("我在听，您直接说就好");
    recognition.start();
  }

  async function startLocalRecognition() {
    if (!window.isSecureContext) throw new Error("secure_context_required");
    if (!adapter.asrWsUrl || typeof WebSocket === "undefined") throw new Error("local_asr_unavailable");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("microphone_api_unavailable");
    if (typeof MediaRecorder === "undefined") throw new Error("recorder_api_unavailable");
    const audioConstraints: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (selectedAudioDeviceId) audioConstraints.deviceId = { exact: selectedAudioDeviceId };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (error) {
      if (!selectedAudioDeviceId) throw error;
      // 已记住的设备可能被拔出或被系统重置；自动退回默认设备，并清掉过期选择。
      setSelectedAudioDeviceId("");
      localStorage.removeItem("hotel_audio_input_device");
      setMessage("已选择的麦克风不可用，正在切换系统默认麦克风…");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    mediaStreamRef.current = stream;
    void refreshAudioInputs();
    startAudioMonitor(stream);
    const socket = new WebSocket(resolveAsrWebSocketUrl(adapter.asrWsUrl));
    const opened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("local_asr_timeout")), 3000);
      socket.onopen = () => { window.clearTimeout(timer); resolve(); };
      socket.onerror = () => { window.clearTimeout(timer); reject(new Error("local_asr_socket_error")); };
    });
    try {
      await opened;
    } catch (error) {
      socket.close();
      throw error;
    }
    asrSocketRef.current = socket;
    localAsrResultRef.current = false;
    asrChunkTailRef.current = Promise.resolve();
    asrAudioBytesRef.current = 0;
    asrAudioChunksRef.current = 0;
    setVoiceBackend("local");
    setListening(true);
    setMessage("本地语音识别已连接，您直接说就好");
    socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      // MediaRecorder 的 dataavailable 事件和 arrayBuffer() 是异步的。
      // 所有分片必须按顺序排队，stop 只能在队列清空后发送，否则服务端可能只收到“嗯”这一小段。
      const chunk = event.data;
      asrChunkTailRef.current = asrChunkTailRef.current.then(async () => {
        const buffer = await chunk.arrayBuffer();
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(buffer);
        asrAudioBytesRef.current += buffer.byteLength;
        asrAudioChunksRef.current += 1;
      }).catch(() => undefined);
    };
    recorder.onerror = () => {
      if (!localAsrResultRef.current) {
        setMessage("本地识别暂时不可用，请再说一次");
        stopListening();
      }
    };
    socket.onmessage = (event) => {
      let payload: AsrSocketMessage;
      try { payload = JSON.parse(String(event.data)) as AsrSocketMessage; } catch { return; }
      if (payload.type === "result" && payload.text?.trim()) {
        const isFinal = payload.is_final !== false;
        localAsrResultRef.current = true;
        const transcript = payload.text.trim();
        setUtterance(transcript);
        if (!isFinal) {
          setAudioCaptureStatus(audioSignalSeenRef.current ? "ok" : "silent");
          setMessage("正在识别，临时文字会实时显示在输入框");
          return;
        }
        if (isFillerTranscript(transcript)) {
          voiceSubmitRequestedRef.current = false;
          voiceAutoSubmitRef.current = false;
          continuousResumeRef.current = false;
          setUtterance("");
          setAudioCaptureStatus(audioSignalSeenRef.current ? "ok" : "silent");
          setVoiceFinalizing(false);
          releaseVoiceResources(true);
          setMessage(audioSignalSeenRef.current ? "只识别到很短的回应，请完整说出要办理的事情或直接输入文字" : "没有检测到有效麦克风声音，请检查输入设备后再试");
          return;
        }
        releaseVoiceResources(true);
        setVoiceFinalizing(false);
        if (voiceSubmitRequestedRef.current) {
          voiceSubmitRequestedRef.current = false;
          voiceAutoSubmitRef.current = false;
          continuousResumeRef.current = continuousConversation;
          void submitUtterance(transcript);
        } else {
          setMessage("语音已整理完成，确认无误后点击发送");
        }
      } else if (payload.type === "error") {
        setMessage(payload.message || "本地语音识别失败，请再说一次");
        setVoiceFinalizing(false);
        stopListening();
      }
    };
    socket.onclose = () => {
      if (!localAsrResultRef.current && mediaRecorderRef.current) setMessage("本地识别服务已断开，请再说一次");
    };
    recorder.start(250);
    // 不因短暂安静而中断；仅保留 2 分钟安全上限，避免浏览器长期占用麦克风。
    silenceTimerRef.current = window.setTimeout(() => {
      if (!voiceSubmitRequestedRef.current && mediaRecorderRef.current) {
        const recorder = mediaRecorderRef.current;
        const socket = asrSocketRef.current;
        if (recorder.state !== "inactive") {
          recorder.onstop = () => {
            void asrChunkTailRef.current.then(() => {
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "stop", client_audio_chunks: asrAudioChunksRef.current, client_audio_bytes: asrAudioBytesRef.current }));
              }
            });
          };
          recorder.stop();
        } else if (socket?.readyState === WebSocket.OPEN) {
          void asrChunkTailRef.current.then(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "stop", client_audio_chunks: asrAudioChunksRef.current, client_audio_bytes: asrAudioBytesRef.current }));
            }
          });
        }
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setListening(false);
        setMessage("录音已达到 2 分钟上限，内容已整理，请点击发送");
      }
    }, 120000);
  }

  async function startListening() {
    if (listening) {
      stopListening();
      return;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setListening(true);
    setMessage("正在连接本地语音识别…");
    try {
      await startLocalRecognition();
    } catch (error) {
      stopListening();
      const code = error instanceof Error ? error.message : "";
      const deviceError = error instanceof DOMException ? error.name : "";
      if (deviceError === "NotAllowedError" || deviceError === "PermissionDeniedError") {
        setVoiceBackend("unavailable");
        setAudioCaptureStatus("error");
        setMessage("麦克风权限被拒绝，请在地址栏的锁形图标中允许麦克风后再试");
        return;
      }
      if (deviceError === "NotFoundError" || deviceError === "DevicesNotFoundError") {
        setVoiceBackend("unavailable");
        setAudioCaptureStatus("error");
        setMessage("没有找到麦克风，请检查设备是否插好，并在系统声音设置中选中输入设备");
        return;
      }
      if (deviceError === "NotReadableError" || deviceError === "TrackStartError") {
        setAudioCaptureStatus("error");
        setMessage("麦克风被其他程序占用或无法读取，请关闭占用麦克风的应用后再试");
        return;
      }
      if (code === "secure_context_required") {
        setVoiceBackend("unavailable");
        setMessage("当前预览环境不开放麦克风，请用部署机的 HTTPS Chrome/Edge 访问");
        return;
      }
      if (code === "microphone_api_unavailable") {
        setVoiceBackend("unavailable");
        setMessage("当前浏览器没有麦克风接口，请改用支持麦克风的 Chrome/Edge");
        return;
      }
      if (code === "recorder_api_unavailable") {
        setMessage("当前浏览器不支持本地录音，已切换浏览器识别");
      } else {
        setMessage("本地识别未连接，已切换浏览器识别");
      }
      startBrowserRecognition();
    }
  }

  useEffect(() => {
    if (!continuousConversation || !continuousResumeRef.current || phase !== "idle" || listening || voiceFinalizing) return undefined;
    let timer: number | null = null;
    const resume = () => {
      if (!continuousConversation || !continuousResumeRef.current || phase !== "idle" || listening || voiceFinalizing) return;
      if (window.speechSynthesis?.speaking) {
        timer = window.setTimeout(resume, 350);
        return;
      }
      continuousResumeRef.current = false;
      void startListening();
    };
    timer = window.setTimeout(resume, 650);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [continuousConversation, listening, phase, voiceFinalizing]);

  async function submitUtterance(value = utterance) {
    const normalized = value.trim();
    if (!normalized) return;
    if (/^(嗯+|啊+|呃+|额+|唉+|哦+)[。！!？?，,、\s]*$/u.test(normalized)) {
      setMessage("我只听到一声回应，请把要办理的事情完整说出来，或直接输入文字");
      return;
    }
    // The landing screen is a business chooser, so a clear spoken business
    // intent should move through the same allow-listed UI transition as the
    // visible "办理入住" / "退房" buttons. This is not a business mutation:
    // phone, identity, payment, and final confirmation remain gated below.
    if (computerUseEnabled && terminalMode === "choose") {
      if (/(退房|离店|换房|归还房卡)/u.test(normalized)) {
        setTerminalMode("checkout");
      } else if (/(现场|到店|没有?预订|直接入住|办理入住|入住|预订|订单)/u.test(normalized)) {
        setTerminalMode("checkin");
      }
    }
    // “退房” is a terminal operation, not a policy question. Route it straight
    // to the card-return flow so the guest is not asked about checkout policy.
    if (/(退房|离店|我要走了|准备走了)/u.test(normalized)) {
      recordConversation("user", normalized);
      recordConversation("assistant", "好的，先请把房卡插入收卡器。系统收回房卡后会核对押金并回收房态。");
      setTerminalMode("checkout");
      setPhase("idle");
      setMessage("好的，请先把房卡插入收卡器");
      speak("好的，请先把房卡插入收卡器。收卡后我会核对押金并回收房态。", voiceEnabled);
      return;
    }
    if (submitInFlightRef.current === normalized) return;
    submitInFlightRef.current = normalized;
    const generation = conversationGenerationRef.current;
    setPhase("searching");
    setMessage("正在理解您的意思");
    try {
      recordConversation("user", normalized);
      const messages = conversationRef.current.slice(-24);
      let streamedText = "";
      const agent = await postAgentStream({ session_id: sessionId, conversation_id: conversationId || sessionId, case_id: checkinCase?.id, walk_in_draft_id: walkInDraft?.id, walk_in_draft_status: walkInDraft?.status, pending_walk_in_phone: pendingWalkInPhone ?? undefined, messages }, (delta) => {
        streamedText += delta;
        setMessage(streamedText);
      });
      if (generation !== conversationGenerationRef.current) return;
      if (agent.intent_envelope) setIntentTrace({ label: agent.intent_envelope.intent, confidence: agent.intent_envelope.confidence, action: agent.intent_envelope.next_action });
      if (agent.type === "clarification") {
        recordConversation("assistant", agent.message);
        const detectedPhone = fullPhoneFromText(normalized) ?? fullPhoneFromText(agent.message);
        if (agent.intent_envelope?.requires_confirmation || detectedPhone) {
          if (detectedPhone) setPendingWalkInPhone(detectedPhone);
        }
        setIntentTrace({ label: "需要澄清", confidence: agent.confidence, action: "clarification" });
        setPhase("idle");
        setMessage(agent.message);
        speak(agent.message, voiceEnabled);
        return;
      }
      if (agent.type === "assistant_message") {
        recordConversation("assistant", agent.message);
        setIntentTrace({ label: "模型回答", confidence: 0.9, action: "respond" });
        setPhase("idle");
        setMessage(agent.message);
        speak(agent.message, voiceEnabled);
        return;
      }
      recordConversation("tool", `调用工具：${agent.tool_name}`);
      const toolLabel = agent.tool_name === "pms.start_checkout" ? "进入退房收卡" : agent.tool_name === "pms.search_order" ? "查询订单" : agent.tool_name === "pms.create_walk_in_draft" ? "创建现场办理草稿" : agent.tool_name === "pms.quote_walk_in" ? "查询房态并报价" : agent.tool_name === "payment.create" ? "生成支付页面" : agent.tool_name === "pms.create_walk_in" ? "创建现场办理单" : agent.tool_name === "hotel.policy_answer" ? "查询门店政策" : agent.tool_name === "device.reader.read_identity" ? "调用读卡器仿真" : agent.tool_name === "device.encoder.read_status" ? "查询发卡机仿真" : "受控业务工具";
      setIntentTrace({ label: toolLabel, confidence: 0.96, action: agent.tool_name });
      let result: IntentResponse;
      if (agent.tool_name === "pms.start_checkout") {
        setTerminalMode("checkout");
        setPhase("idle");
        const checkoutMessage = "好的，请先把房卡插入收卡器。收卡成功后您就可以离开，押金和房态由后台继续处理。";
        recordConversation("tool", "已进入退房收卡流程");
        setMessage(checkoutMessage);
        speak(checkoutMessage, voiceEnabled);
        return;
      } else if (agent.tool_name === "pms.search_order") {
        const phoneLast4 = String(agent.arguments.phone_last4 ?? "");
        setLast4(phoneLast4);
        result = await postDemo<IntentResponse>("interpret", { session_id: sessionId, utterance: normalized });
        if (generation !== conversationGenerationRef.current) return;
      } else if (agent.tool_name === "pms.create_walk_in") {
        const phoneLast4 = String(agent.arguments.phone_last4 ?? "").replace(/\D/g, "").slice(-4);
        await createWalkIn(phoneLast4, generation);
        return;
      } else if (agent.tool_name === "pms.create_walk_in_draft") {
        const phoneNumber = String(agent.arguments.phone_number ?? "");
        const draftResult = await postDemo<{ draft: WalkInDraft; room_types: WalkInRoomType[] }>("walk-in-draft", { session_id: sessionId, phone_number: phoneNumber, idempotency_key: `walk-in-draft:${sessionId}:${phoneNumber.slice(-4)}` });
        setPendingWalkInPhone(null);
        setWalkInDraft(draftResult.draft);
        setWalkInRoomTypes(draftResult.room_types ?? []);
        setWalkInPayment(null);
        setPhase("idle");
        const draftMessage = "手机号已确认。请在下方选择房型、入住晚数和房间数，我先给您报价；确认金额并完成支付后，才会创建正式订单。";
        recordConversation("tool", "现场办理草稿已创建，等待房型和报价");
        setMessage(draftMessage);
        speak(draftMessage, voiceEnabled);
        return;
      } else if (agent.tool_name === "pms.quote_walk_in") {
        const draftId = String(agent.arguments.draft_id ?? walkInDraft?.id ?? "");
        const roomTypeCode = String(agent.arguments.room_type_code ?? "");
        const nights = Number(agent.arguments.nights ?? 1);
        const roomCount = Number(agent.arguments.room_count ?? 1);
        const quote = await postDemo<{ draft: WalkInDraft; room_types: WalkInRoomType[] }>("walk-in-quote", { session_id: sessionId, draft_id: draftId, room_type_code: roomTypeCode, nights, room_count: roomCount, idempotency_key: `quote:${draftId}:${roomTypeCode}:${nights}:${roomCount}` });
        setWalkInDraft(quote.draft);
        setWalkInRoomTypes(quote.room_types ?? walkInRoomTypes);
        setPhase("idle");
        const quoteMessage = `报价已生成：${quote.draft.room_type_name}，${quote.draft.nights}晚${quote.draft.room_count}间，房费 ¥${quote.draft.room_amount}，押金 ¥${quote.draft.deposit_amount}，合计 ¥${quote.draft.total_amount}。请确认金额后选择支付方式。`;
        recordConversation("tool", "房型和金额报价已生成，等待客人确认");
        setMessage(quoteMessage);
        speak(quoteMessage, voiceEnabled);
        return;
      } else if (agent.tool_name === "payment.create") {
        const draftId = String(agent.arguments.draft_id ?? walkInDraft?.id ?? "");
        const method = String(agent.arguments.method ?? "wechat");
        const paymentResult = await postDemo<{ draft: WalkInDraft; payment: WalkInPayment }>("walk-in-payment", { session_id: sessionId, draft_id: draftId, method, idempotency_key: `payment:${draftId}` });
        setWalkInDraft(paymentResult.draft);
        setWalkInPayment(paymentResult.payment);
        setPhase("idle");
        const paymentMessage = `已生成${method === "alipay" ? "支付宝" : "微信"}模拟支付页面，应付 ¥${paymentResult.payment.amount}。完成支付后点击下方“模拟支付成功”，系统才会创建订单。`;
        recordConversation("tool", "支付页面已生成，等待支付回执");
        setMessage(paymentMessage);
        speak(paymentMessage, voiceEnabled);
        return;
      } else if (agent.tool_name === "hotel.policy_answer" || agent.tool_name === "hotel.knowledge_search") {
        // 政策话术不在前端拼：由服务端检索当前门店知识库，命中带出处，命中不到转人工。
        const topic = agent.tool_name === "hotel.policy_answer" ? String(agent.arguments.topic ?? "") : "";
        const query = typeof agent.arguments.query === "string" ? agent.arguments.query : "";
        let answer = "这个我暂时没有可靠依据（门店知识库里没查到），已记录并转前台确认。";
        try {
          const lookup = await postDemo<{ query: string; answer: string | null; citations: Array<{ title: string; version: number }>; needs_handoff: boolean; handoff_message: string | null }>("knowledge-search", { session_id: sessionId, topic, query });
          answer = lookup.needs_handoff || !lookup.answer
            ? (lookup.handoff_message ?? answer)
            : `${lookup.answer}${lookup.citations.length ? `\n\n（依据：${lookup.citations.map((citation) => `${citation.title} v${citation.version}`).join("、")}）` : ""}`;
        } catch { /* 知识库不可用时也不编政策，保持明确的转人工话术 */ }
        recordConversation("tool", `门店政策查询完成：${query || topic}`);
        setPhase("idle");
        setMessage(answer);
        speak(answer, voiceEnabled);
        await onRefresh();
        return;      } else if (agent.tool_name === "device.encoder.read_status") {
        const answer = checkinCase ? `当前办理状态是 ${checkinCase.status}，发卡机状态是 ${checkinCase.hardware_status}。我只查询状态，不会重复发卡。` : "目前没有正在办理的入住任务。";
        recordConversation("tool", `发卡机状态查询完成：${checkinCase ? "当前办理中" : "暂无办理任务"}`);
        setPhase("idle");
        setMessage(answer);
        speak(answer, voiceEnabled);
        return;
      } else if (agent.tool_name === "device.reader.read_identity" && checkinCase) {
        await postSimulator("/api/device/reader", { session_id: sessionId, case_id: checkinCase.id, idempotency_key: `reader:${checkinCase.id}`, expected_state: "IDENTITY_READING", device_id: "reader-demo-01", operation: "read_identity" });
        recordConversation("tool", "读卡器仿真成功：已返回演示身份 Token");
        setPhase("matched");
        setMessage("身份证已读取，结果已交给业务流程继续核验。");
        speak("身份证已读取，正在继续核验。", voiceEnabled);
        return;
      } else {
        throw new Error("unsupported_tool");
      }
      recordConversation("tool", `订单查询完成：${result.outcome === "matched" ? "已匹配" : result.outcome === "ambiguous" ? "存在多笔候选" : result.outcome === "not_found" ? "未找到" : "已拦截"}`);
      if (result.outcome === "matched" && result.order && result.checkinCase) {
        setMatchedOrder(result.order);
        setCheckinCase(result.checkinCase);
        setPhase(result.checkinCase.status === "CHECKIN_COMPLETE" ? "complete" : "matched");
        setMessage(`听懂了，已找到 ${result.order.source} 订单`);
        speak(`已找到${result.order.source}订单。请核对后，将身份证放在读卡器上。`, voiceEnabled);
      } else if (result.outcome === "ambiguous") {
        setAlternatives(result.orders ?? []);
        setPhase("ambiguous");
        setMessage("找到多笔订单，AI 已暂停自动选择");
        speak("找到多笔订单，我不能替您猜选，请联系工作人员复核。", voiceEnabled);
      } else if (result.outcome === "not_found") {
        setPhase("not_found");
        setMessage(result.assistantMessage);
        speak(result.assistantMessage, voiceEnabled);
      } else if (result.outcome === "already_checked_in" || result.outcome === "checked_out" || result.outcome === "cancelled") {
        setPhase("blocked");
        setAlternatives(result.orders ?? []);
        setMessage(result.outcome === "already_checked_in"
          ? "该订单已经入住，不能重复办理"
          : result.outcome === "checked_out"
            ? "该订单已经退房，如需再住请重新预订或现场办理"
            : "该订单已经取消，不能继续办理");
      } else {
        setPhase("idle");
        setMessage(result.assistantMessage);
        speak(result.assistantMessage, voiceEnabled);
      }
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("暂时没有理解成功，您的输入已保留，请稍后重试");
    } finally {
      if (submitInFlightRef.current === normalized) submitInFlightRef.current = null;
    }
  }

  async function createWalkIn(phoneOverride = last4, expectedGeneration = conversationGenerationRef.current) {
    const phoneLast4 = phoneOverride.replace(/\D/g, "").slice(-4);
    if (!/^\d{4}$/.test(phoneLast4)) {
      setPhase("idle");
      setMessage("请告诉我手机号后四位，直接说四个数字就行。");
      return;
    }
    setPhase("searching");
    try {
      setLast4(phoneLast4);
      const result = await postDemo<MatchResponse>("walk-in", { session_id: sessionId, phone_last4: phoneLast4, idempotency_key: `walk-in:${sessionId}:${phoneLast4}` });
      if (expectedGeneration !== conversationGenerationRef.current) return;
      if (!result.order || !result.checkinCase) throw new Error("walk_in_failed");
      setMatchedOrder(result.order);
      setCheckinCase(result.checkinCase);
      setPhase("matched");
      setMessage("现场办理单已创建，请将身份证放入读卡器");
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("现场办理单创建失败，请联系工作人员");
    }
  }

  async function quoteWalkIn(roomTypeCode: string) {
    if (!walkInDraft) return;
    setPhase("searching");
    try {
      const quote = await postDemo<{ draft: WalkInDraft; room_types: WalkInRoomType[] }>("walk-in-quote", { session_id: sessionId, draft_id: walkInDraft.id, room_type_code: roomTypeCode, nights: walkInDraft.nights, room_count: walkInDraft.room_count, idempotency_key: `quote:${walkInDraft.id}:${roomTypeCode}:${walkInDraft.nights}:${walkInDraft.room_count}` });
      setWalkInDraft(quote.draft);
      setWalkInRoomTypes(quote.room_types ?? walkInRoomTypes);
      setPhase("idle");
      setMessage(`报价已生成，合计 ¥${quote.draft.total_amount}。请核对金额后选择支付方式。`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "draft_not_found" || reason.includes("invalid_draft_status")) {
        setWalkInDraft(null);
        setWalkInRoomTypes([]);
        setWalkInPayment(null);
        setPhase("idle");
        setMessage("现场办理草稿已失效或已取消，请重新说一次手机号；不会重复创建订单。");
      } else if (reason === "room_not_available") {
        setPhase("idle");
        setMessage("所选房型或房间数当前没有可售余量，请换一个房型或减少房间数。");
      } else if (reason === "invalid_room_type") {
        setPhase("idle");
        setMessage("房型信息已变化，请重新选择当前页面显示的房型。");
      } else {
        setPhase("error");
        setMessage("房型报价接口暂时不可用，请稍后重试；未创建正式订单。");
      }
    }
  }

  async function createWalkInPayment(method: "wechat" | "alipay") {
    if (!walkInDraft) return;
    setPhase("searching");
    try {
      const result = await postDemo<{ draft: WalkInDraft; payment: WalkInPayment }>("walk-in-payment", { session_id: sessionId, draft_id: walkInDraft.id, method, idempotency_key: `payment:${walkInDraft.id}` });
      setWalkInDraft(result.draft);
      setWalkInPayment(result.payment);
      setPhase("idle");
      setMessage(`已生成${method === "wechat" ? "微信" : "支付宝"}模拟支付页面，请完成支付后点击下方按钮。`);
    } catch {
      setPhase("error");
      setMessage("支付页面生成失败，请重新尝试。");
    }
  }

  async function completeWalkInPayment() {
    if (!walkInPayment) return;
    setPhase("searching");
    try {
      const result = await postDemo<{ draft: WalkInDraft; payment: WalkInPayment } & MatchResponse>("walk-in-payment-complete", { session_id: sessionId, payment_id: walkInPayment.id, idempotency_key: `payment-complete:${walkInPayment.id}` });
      if (!result.order || !result.checkinCase) throw new Error("order_not_created");
      setWalkInDraft(null);
      setWalkInPayment(null);
      setWalkInRoomTypes([]);
      setMatchedOrder(result.order);
      setCheckinCase(result.checkinCase);
      setPhase("matched");
      setMessage("支付已确认，现场订单已创建。现在请将身份证放入读卡器，系统会继续核验。");
      recordConversation("tool", "支付成功，正式现场订单已创建并匹配入住流程");
      speak("支付已确认，现场订单已创建。请将身份证放入读卡器。", voiceEnabled);
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("支付回执未确认，系统没有重复创建订单，请稍后重试或联系工作人员。");
    }
  }

  async function runCheckin() {
    if (!checkinCase) return;
    const caseId = checkinCase.id;
    let currentCase = checkinCase;
    const applyCase = (next: CheckinCase) => {
      currentCase = next;
      setCheckinCase(next);
    };
    startNewConversation("身份证办理");
    setPhase("processing");
    setFlowError(null);
    let activeStep = FLOW_STEPS[1];
    try {
      let result: { checkinCase: CheckinCase; deposit_amount?: number; deposit_payment_status?: "captured" | "pending" | "failed" };
      if (currentCase.status === "CHECKIN_COMPLETE") {
        setFlowStep(7);
        setPhase("complete");
        setMessage("这笔订单已经完成入住，不能重复办理。");
        return;
      }
      if (currentCase.status === "ORDER_MATCHED") {
        setFlowStep(1);
        activeStep = FLOW_STEPS[1];
        result = await postDemo("identity-detected", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        speak("已检测到身份证，正在确认不是上一位客人遗留的证件。", voiceEnabled);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      if (currentCase.status === "IDENTITY_READING") {
        setFlowStep(2);
        activeStep = FLOW_STEPS[1];
        await postSimulator("/api/device/reader", { session_id: sessionId, case_id: caseId, idempotency_key: `reader:${caseId}`, expected_state: "IDENTITY_READING", device_id: "reader-demo-01", operation: "read_identity" }, activeStep);
        result = await postDemo("verify-identity", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        speak("身份证已自动读取并核验通过，正在锁定房间。", voiceEnabled);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      if (currentCase.status === "IDENTITY_VERIFIED") {
        setFlowStep(3);
        activeStep = FLOW_STEPS[2];
        // Do not force a demo room number here. 1208 is intentionally occupied
        // in the simulator; the adapter must choose a clean sellable room for
        // the selected room type (and a future PMS will make the same choice).
        result = await postDemo("hold-room", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      if (currentCase.status === "ROOM_HELD") {
        setFlowStep(4);
        activeStep = FLOW_STEPS[3];
        await postSimulator("/api/police/submit", { session_id: sessionId, case_id: caseId, idempotency_key: `police:${caseId}`, expected_state: "ROOM_HELD", device_id: "police-browser-demo-01", operation: "submit_registration", actual_identity_verified: true, identity_token: "DEMO-ID-TOKEN" }, activeStep);
        result = await postDemo("browser-start", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        speak("正在广州隔离演示环境中模拟住宿登记。", voiceEnabled);
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
      if (currentCase.status === "POLICE_RUNNING") {
        setFlowStep(4);
        activeStep = FLOW_STEPS[3];
        speak("正在读取当前住宿登记结果，不会重复提交。", voiceEnabled);
        const completed = await postDemo<{ checkinCase: CheckinCase; receipt: string }>("browser-complete", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(completed.checkinCase);
      }
      if (currentCase.status === "POLICE_COMPLETED") {
        setFlowStep(5);
        activeStep = FLOW_STEPS[4];
        result = await postDemo<{ checkinCase: CheckinCase; deposit_amount?: number; deposit_payment_status?: "captured" | "pending" | "failed" }>("confirm-checkin", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        setDepositStatus(result.deposit_payment_status ?? "pending");
        setDepositAmount(typeof result.deposit_amount === "number" ? result.deposit_amount : null);
        setMatchedOrder((current) => current ? { ...current, status: "checkin_confirmed", room_number: result.checkinCase.room_number } : current);
        speak("入住已确认，自动发卡机正在制作房卡。", voiceEnabled);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      if (currentCase.status === "PMS_CHECKIN_CONFIRMED") {
        setFlowStep(6);
        activeStep = FLOW_STEPS[5];
        result = await postDemo("keycard-start", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        await new Promise((resolve) => window.setTimeout(resolve, 950));
      }
      if (currentCase.status === "KEYCARD_WRITING") {
        setFlowStep(6);
        activeStep = FLOW_STEPS[5];
        await postSimulator("/api/device/encoder", { session_id: sessionId, case_id: caseId, idempotency_key: `encoder:${caseId}`, expected_state: "PMS_CHECKIN_CONFIRMED", device_id: "encoder-demo-01", operation: "issue_keycard", room_number: currentCase.room_number ?? "1208" }, activeStep);
        result = await postDemo("keycard-complete", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
        setMatchedOrder((current) => current ? { ...current, status: "in_house", room_number: result.checkinCase.room_number } : current);
        setFlowStep(7);
        speak("房卡已制作完成，请取走房卡和身份证。", voiceEnabled);
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (currentCase.status === "KEYCARD_DISPENSED") {
        setFlowStep(7);
        activeStep = FLOW_STEPS[6];
        result = await postDemo("pickup-confirmed", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
      }
      if (currentCase.status !== "CHECKIN_COMPLETE") throw new Error(`unhandled_state:${currentCase.status}`);
      setPhase("complete");
      speak("已确认房卡和身份证取走，自助入住完成。祝您入住愉快。", voiceEnabled);
      await onRefresh();
    } catch (error) {
      let reconciliation: ReconcileResponse | null = null;
      try { reconciliation = await postDemo<ReconcileResponse>("reconcile", { session_id: sessionId, case_id: caseId }); } catch { /* 自查接口本身失败时仍保留原始停点 */ }
      if (reconciliation?.current_case) setCheckinCase((current) => current ? { ...current, ...reconciliation.current_case } : current);
      const detail = error instanceof FlowStepError
        ? error
        : new FlowStepError(activeStep, error instanceof Error ? error.message : "UNKNOWN_ERROR", false, "UNKNOWN");
      setFlowError({ step: detail.step, code: detail.code, retryable: detail.retryable, status: detail.status, reconciliation });
      const statusText = detail.status === "UNKNOWN" ? "结果未知，不能自动重试" : detail.retryable ? "可以在确认外部状态后重试" : "需要人工处理";
      const checkText = reconciliation
        ? `自查结果：当前在“${reconciliation.current_state_label}”；${reconciliation.invariant_failures.length ? `发现 ${reconciliation.invariant_failures.join("；")}；` : "内部状态一致；"}${reconciliation.unresolved_external_call ? "存在未确认的外部请求，禁止重复提交；" : "未发现未确认的外部请求；"}`
        : "自查接口暂时不可用，已保持暂停状态。";
      setPhase("error");
      setMessage(`已停在第 ${detail.step.number} 步「${detail.step.label}」：${detail.code}。${statusText}。${checkText}`);
      await onRefresh();
    }
  }

  const goBackOrRegret = useCallback(() => {
    if (!["idle", "matched", "ambiguous", "not_found", "blocked"].includes(phase)) {
      setMessage("当前办理已进入外部设备或结算阶段，不能只改页面伪造撤销；已保留现场状态，请转前台执行真实撤销或补偿。");
      onOpenAdmin();
      return;
    }
    stopListening();
    const returnToPreviousStep = () => {
      startNewConversation("重新开始办理");
      setTerminalMode(terminalMode === "checkout" ? "choose" : "checkin");
      setPhase("idle");
      setUtterance("");
      setMessage("您好，今天想办理什么？");
    };
    if (walkInDraft && ["DRAFT", "QUOTED"].includes(walkInDraft.status)) {
      setMessage("正在取消未支付现场办理草稿，请稍候…");
      void postDemo<{ ok: boolean }>("walk-in-cancel", { session_id: sessionId, draft_id: walkInDraft.id })
        .then(() => {
          setWalkInDraft(null);
          setWalkInRoomTypes([]);
          setWalkInPayment(null);
          setPendingWalkInPhone(null);
          returnToPreviousStep();
        })
        .catch(() => setMessage("未能取消现场办理草稿，系统保留当前状态，请重试或联系前台。"));
      return;
    }
    returnToPreviousStep();
  }, [onOpenAdmin, phase, sessionId, terminalMode, walkInDraft]);

  const commitCurrentAction = useCallback((source: "digital_human" | "physical") => {
    if (phase === "searching" || phase === "processing") return;
    // Both channels intentionally call the existing submit path. The source is
    // only a channel marker at this UI edge; authorization remains in the
    // existing agent/API state machine.
    void submitUtterance("确认");
    if (source === "digital_human") setMessage("已收到数字人确认，正在按原办理流程提交。");
  }, [phase]);

  const handleComputerUseAction = useCallback((action: import("@/components/live2d/types").ComputerUseAction) => {
    if (!computerUseEnabled) return;
    dispatchComputerUseAction(action, {
      focusInput: () => utteranceInputRef.current?.focus(),
      submitText: (text) => { void submitUtterance(text); },
      startVoice: (deviceId) => {
        if (deviceId) handleAudioDeviceChange(deviceId);
        if (!listening) void startListening();
      },
      stopVoice: () => finishListeningAndSubmit(continuousConversation),
      confirm: () => commitCurrentAction("digital_human"),
      back: () => goBackOrRegret(),
      handoffAdmin: () => onOpenAdmin(),
    });
  }, [commitCurrentAction, computerUseEnabled, continuousConversation, finishListeningAndSubmit, goBackOrRegret, handleAudioDeviceChange, listening, onOpenAdmin, startListening, submitUtterance]);

  const handleDigitalHumanInput = useCallback((event: DigitalHumanInputEvent) => {
    if (digitalEventIdsRef.current.has(event.eventId)) return;
    digitalEventIdsRef.current.add(event.eventId);
    if (digitalEventIdsRef.current.size > 100) {
      const oldest = digitalEventIdsRef.current.values().next().value;
      if (oldest) digitalEventIdsRef.current.delete(oldest);
    }
    switch (event.type) {
      case "voice_start":
        if (!listening) void startListening();
        break;
      case "voice_stop":
        finishListeningAndSubmit(continuousConversation);
        break;
      case "text_submit":
      case "quick_intent":
        void submitUtterance(event.text);
        break;
      case "confirm":
        commitCurrentAction(event.source);
        break;
      case "cancel":
        goBackOrRegret();
        break;
      case "model_interaction":
        break;
      case "computer_use":
        handleComputerUseAction(event.action);
        break;
    }
  }, [commitCurrentAction, continuousConversation, finishListeningAndSubmit, goBackOrRegret, handleComputerUseAction, listening, startListening, submitUtterance]);

  const showEntry = (phase === "idle" || phase === "searching") && terminalMode === "checkin";
  const digitalHumanInput = useMemo(() => ({
    phase,
    message,
    activeMessage,
    listening,
    voiceFinalizing,
    continuousConversation,
    audioLevel,
    flowStep,
    flowError: flowError?.code ?? null,
    voiceEnabled,
    canConfirm: terminalMode !== "choose" && !["searching", "processing", "complete", "error"].includes(phase),
    canBack: terminalMode !== "choose" && phase !== "searching",
    computerUseEnabled,
    computerUseStatus,
  }), [activeMessage, audioLevel, computerUseEnabled, computerUseStatus, continuousConversation, flowError?.code, flowStep, listening, message, phase, terminalMode, voiceEnabled, voiceFinalizing]);

  const journeySteps = useMemo<JourneyStep[]>(() => {
    const caseStatus = checkinCase?.status ?? "";
    const phoneReady = Boolean(walkInDraft || matchedOrder || last4);
    const phoneWaitingConfirmation = Boolean(pendingWalkInPhone);
    const identityDone = phase === "complete" || ["IDENTITY_VERIFIED", "ROOM_HELD", "POLICE_RUNNING", "POLICE_COMPLETED", "PMS_CHECKIN_CONFIRMED", "KEYCARD_WRITING", "KEYCARD_DISPENSED", "CHECKIN_COMPLETE"].includes(caseStatus);
    const orderOrRoomDone = Boolean(matchedOrder) || walkInDraft?.status === "ORDER_CREATED";
    const confirmationDone = phase === "complete";
    const confirmationActive = !confirmationDone && (phase === "matched" || (Boolean(walkInDraft?.total_amount) && walkInPayment?.status === "PENDING"));
    const phoneValue = pendingWalkInPhone ?? walkInDraft?.phone_masked ?? matchedOrder?.phone_masked ?? (last4 ? `尾号 ${last4}` : "");
    return [
      {
        label: "手机号",
        state: phoneWaitingConfirmation ? "active" : phoneReady ? "done" : "active",
        detail: phoneWaitingConfirmation ? `已识别 ${maskJourneyPhone(pendingWalkInPhone)} · 等待确认` : phoneReady ? `已确认 ${phoneValue}` : "请说完整手机号或预订手机号后四位",
      },
      {
        label: walkInDraft ? "房型与支付" : "订单匹配",
        state: orderOrRoomDone ? "done" : phoneReady ? "active" : "waiting",
        detail: walkInDraft
          ? walkInDraft.status === "AWAITING_PAYMENT" ? "等待支付完成" : walkInDraft.status === "QUOTED" ? "报价已生成，等待确认" : "请选择房型和入住信息"
          : orderOrRoomDone ? "订单已匹配" : phoneReady ? "正在核对订单" : "手机号确认后开始",
      },
      {
        label: "身份证",
        state: identityDone ? "done" : checkinCase ? "active" : "waiting",
        detail: identityDone ? "身份已核验" : checkinCase ? (phase === "processing" ? "正在读取并核验" : "请放置身份证" ) : "订单确认后进行",
      },
      {
        label: "确认提交",
        state: confirmationDone ? "done" : confirmationActive ? "active" : "waiting",
        detail: confirmationDone ? "入住已完成" : confirmationActive ? "请核对信息后点击确认" : "高风险动作仍需您确认",
      },
    ];
  }, [checkinCase, last4, matchedOrder, pendingWalkInPhone, phase, walkInDraft, walkInPayment?.status]);

  return <main className="min-h-screen bg-[#f5f5f7] px-5 py-6 text-[#1d1d1f] md:px-10">
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3"><div><p className="font-semibold tracking-tight">Hotel Agent OS</p><p className="mt-1 text-xs text-[#86868b]">广州示范店 · 数据库演示环境</p></div><div className="flex items-center gap-2"><nav aria-label="终端业务" className="hidden rounded-full bg-white p-1 shadow-sm sm:flex"><button type="button" onClick={() => setTerminalMode("checkin")} className={`rounded-full px-3 py-1.5 text-xs transition ${terminalMode === "checkin" ? "bg-[#eaf4ff] text-[#1769aa]" : "text-[#6e6e73] hover:bg-[#f5f5f7]"}`}>办理入住</button><button type="button" onClick={() => setTerminalMode("checkout")} className={`rounded-full px-3 py-1.5 text-xs transition ${terminalMode === "checkout" ? "bg-[#effaf4] text-[#248a4d]" : "text-[#6e6e73] hover:bg-[#f5f5f7]"}`}>退房 / 换房</button></nav><button onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Volume2 size={14} className="mr-1 inline" />{voiceEnabled ? "语音开启" : "已静音"}</button><button onClick={onOpenAdmin} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Settings2 size={14} className="mr-1 inline" />管理后台</button></div></header>
    <DigitalHuman input={digitalHumanInput} onInput={handleDigitalHumanInput} audioInputs={audioInputs} selectedAudioDeviceId={selectedAudioDeviceId} onAudioDeviceChange={handleAudioDeviceChange} onToggleComputerUse={() => setComputerUseEnabled((value) => !value)} onToggleContinuousConversation={() => { setContinuousConversation((value) => { const next = !value; if (!next) continuousResumeRef.current = false; return next; }); }} />
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col items-center justify-center py-12 text-center lg:pl-[min(30rem,34vw)]">
      {terminalMode === "choose" ? (<>
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />AI Native 自助终端 · 请先选择业务</div>
        <h1 className="mt-7 max-w-4xl text-4xl font-semibold tracking-[-.055em] md:text-6xl">您好，今天想办理什么？</h1>
        <p className="mt-4 text-base text-[#86868b]">先选业务，再由系统按业务需要逐步索取信息；随时可以返回重选。</p>
        <TerminalModeChooser onChoose={setTerminalMode} />
      </>) : terminalMode === "checkout" ? (<>
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#34c759]" />退房终端 · 先收房卡，再核对押金和房态</div>
        <h1 className="mt-7 max-w-4xl text-4xl font-semibold tracking-[-.055em] md:text-5xl">退房 / 换房</h1>
        <p className="mt-4 text-base text-[#86868b]">退房在终端核对账目并结算；换房由前台确认房态后执行。</p>
        <div className="mt-6 grid w-full max-w-3xl gap-3 text-left sm:grid-cols-2">
          <div className="rounded-2xl border border-[#bde7cf] bg-white p-4 shadow-sm"><p className="text-sm font-semibold text-[#248a4d]">自助退房</p><p className="mt-1 text-xs leading-5 text-[#6e6e73]">先把房卡插入收卡器；收卡成功后再核对押金、结算并把房间转为待清洁。</p></div>
          <button type="button" onClick={onOpenAdmin} className="rounded-2xl border border-[#d8e9f8] bg-white p-4 text-left shadow-sm transition hover:border-[#007aff]"><p className="text-sm font-semibold text-[#1769aa]">需要换房？进入前台流程 →</p><p className="mt-1 text-xs leading-5 text-[#6e6e73]">前台会核对住客、目标房态并生成确认单，确认后才修改数据库。</p></button>
        </div>
        <TerminalCheckoutPanel sessionId={sessionId} onExit={() => setTerminalMode("choose")} onFinished={onRefresh} onOpenFrontdesk={onOpenAdmin} />
      </>) : (<>
      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />AI Native 对话 · 您怎么说都可以</div>
      <h1 className="mt-7 max-w-4xl text-4xl font-semibold tracking-[-.055em] md:text-6xl">{activeMessage}</h1>
      <p className="mt-4 text-base text-[#86868b]">系统理解您的意图，再由受控业务接口完成动作。</p>
      {showEntry && <button onClick={() => setTerminalMode("choose")} className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm transition hover:bg-[#f2f2f7]"><ArrowLeft size={13} />返回选择办理 / 退房</button>}
      {terminalMode === "checkin" && <GuestJourneyPanel steps={journeySteps} />}

      {showEntry && <div className="mt-10 w-full max-w-2xl"><form onSubmit={(event) => { event.preventDefault(); if (listening) finishListeningAndSubmit(); else void submitUtterance(); }} className="flex items-center gap-2 rounded-[1.7rem] bg-white p-2 pl-5 shadow-[0_10px_40px_rgba(0,0,0,.07)]"><MessageSquareText size={20} className="shrink-0 text-[#86868b]" /><input ref={utteranceInputRef} value={utterance} onChange={(event) => setUtterance(event.target.value)} disabled={phase === "searching"} maxLength={200} placeholder="例如：我在平台订了房，帮我查一下订单" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-[#a1a1a6]" aria-label="告诉AI您想办理的事情" /><span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#eef6ff] px-2.5 py-2 text-[11px] text-[#1769aa] sm:flex"><Mic size={13} />数字人语音</span><button type="submit" disabled={(!utterance.trim() && !listening) || phase === "searching"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#007aff] text-white disabled:opacity-30" aria-label={listening ? "结束录音并发送" : "发送"}><ArrowUp size={19} /></button><button type="button" onClick={() => goBackOrRegret()} disabled={phase === "searching"} className="shrink-0 rounded-full bg-[#f2f2f7] px-3 py-2.5 text-sm font-medium text-[#6e6e73] disabled:opacity-40">上一步</button><button type="button" onClick={() => commitCurrentAction("physical")} disabled={phase === "searching"} className="shrink-0 rounded-full bg-[#34c759] px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-40">确认</button></form><div className="mt-4 flex flex-wrap justify-center gap-2">{SAMPLE_UTTERANCES.map((sample) => <button key={sample} onClick={() => { setUtterance(sample); void submitUtterance(sample); }} disabled={phase === "searching" || listening} className="rounded-full border border-[#d9d9df] bg-white/70 px-3 py-2 text-xs text-[#6e6e73] disabled:opacity-40">{sample}</button>)}</div><p className="mt-3 text-xs text-[#86868b]">{voiceBackend === "local" ? "本地 Qwen3-ASR · 由数字人控制，识别后可直接发送" : voiceBackend === "browser" ? "浏览器语音识别备用通道 · 由数字人控制" : voiceBackend === "unavailable" ? "当前环境不支持语音输入 · 可直接打字" : "本地 ASR 优先 · 数字人控制语音输入 · 说完后点击发送"}</p>{audioCaptureStatus !== "unknown" && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[#86868b]"><span>麦克风：{audioCaptureStatus === "checking" ? "等待声音" : audioCaptureStatus === "ok" ? `已采到声音${audioDeviceLabel ? ` · ${audioDeviceLabel}` : ""}` : audioCaptureStatus === "silent" ? "未检测到有效声音" : "检测失败"}</span>{listening && <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e5ea]"><span className={`block h-full rounded-full ${audioCaptureStatus === "ok" ? "bg-[#34c759]" : "bg-[#ff9500]"}`} style={{ width: `${Math.max(4, Math.round(audioLevel * 100))}%` }} /></span>}</div>}{intentTrace && <div className="mx-auto mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-[#eaf4ff] px-4 py-2 text-xs text-[#1769aa]"><span>已理解：{intentTrace.label}</span><span className="text-[#7b9bb8]">{Math.round(intentTrace.confidence * 100)}%</span><span className="text-[#7b9bb8]">→ {intentTrace.action}</span></div>}<p className="mt-3 text-xs text-[#86868b]">演示数据仅用于本地验收，支持任意四位尾号输入</p></div>}

      {walkInDraft && <section className="mt-8 w-full max-w-2xl rounded-[2rem] border border-[#d8e9f8] bg-white p-6 text-left shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#1769aa]">现场办理草稿</p><h2 className="mt-2 text-xl font-semibold">手机号 {walkInDraft.phone_masked}</h2></div><span className="rounded-full bg-[#eaf4ff] px-3 py-1.5 text-xs text-[#1769aa]">{walkInDraft.status === "AWAITING_PAYMENT" ? "等待支付" : walkInDraft.status === "QUOTED" ? "等待确认" : "等待选房"}</span></div><p className="mt-3 text-xs leading-5 text-[#6e6e73]">这是临时草稿。未确认金额并完成支付前，不会创建正式订单，也不会进入身份证、公安或发卡流程。</p>{walkInRoomTypes.length > 0 && <div className="mt-5 grid gap-2">{walkInRoomTypes.map((room) => <button key={room.code} onClick={() => void quoteWalkIn(room.code)} disabled={phase === "searching" || walkInDraft.status === "AWAITING_PAYMENT"} className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm ${walkInDraft.room_type_code === room.code ? "border-[#007aff] bg-[#eef6ff]" : "border-[#e5e5ea] bg-white"}`}><span><span className="font-medium">{room.name}</span><span className="ml-2 text-xs text-[#86868b]">余 {room.available} 间</span></span><span className="text-[#6e6e73]">¥{room.nightly_rate}/晚</span></button>)}</div>}{walkInDraft.room_type_code && <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-[#f5f5f7] p-4 text-sm"><div><p className="text-xs text-[#86868b]">已选房型</p><p className="mt-1 font-medium">{walkInDraft.room_type_name}</p></div><label className="text-xs text-[#86868b]">入住晚数<input type="number" min={1} max={30} value={walkInDraft.nights} disabled={walkInDraft.status === "AWAITING_PAYMENT"} onChange={(event) => setWalkInDraft((current) => current ? { ...current, nights: Math.min(30, Math.max(1, Number(event.target.value) || 1)), status: "DRAFT", total_amount: null, room_amount: null, deposit_amount: null } : current)} className="mt-1 w-full rounded-lg border border-[#d9d9df] bg-white px-2 py-1.5 text-sm" /></label><label className="text-xs text-[#86868b]">房间数<input type="number" min={1} max={4} value={walkInDraft.room_count} disabled={walkInDraft.status === "AWAITING_PAYMENT"} onChange={(event) => setWalkInDraft((current) => current ? { ...current, room_count: Math.min(4, Math.max(1, Number(event.target.value) || 1)), status: "DRAFT", total_amount: null, room_amount: null, deposit_amount: null } : current)} className="mt-1 w-full rounded-lg border border-[#d9d9df] bg-white px-2 py-1.5 text-sm" /></label>{walkInDraft.total_amount !== null && <div className="col-span-2 border-t border-[#e5e5ea] pt-3"><p className="text-xs text-[#86868b]">房费 ¥{walkInDraft.room_amount} + 押金 ¥{walkInDraft.deposit_amount}</p><p className="mt-1 text-lg font-semibold">合计 ¥{walkInDraft.total_amount}</p></div>}</div>}{walkInDraft.status === "QUOTED" && !walkInPayment && <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void createWalkInPayment("wechat")} disabled={phase === "searching"} className="flex-1 rounded-2xl bg-[#07c160] px-4 py-3 text-sm font-medium text-white">生成微信支付</button><button onClick={() => void createWalkInPayment("alipay")} disabled={phase === "searching"} className="flex-1 rounded-2xl bg-[#1677ff] px-4 py-3 text-sm font-medium text-white">生成支付宝支付</button></div>}{walkInPayment && <div className="mt-5 rounded-2xl border border-[#bde7cf] bg-[#effaf4] p-4"><div className="flex items-center justify-between text-sm"><span>{walkInPayment.method === "alipay" ? "支付宝" : "微信"}模拟支付</span><span className="font-semibold">¥{walkInPayment.amount}</span></div><p className="mt-2 font-mono text-xs text-[#52745f]">支付码：{walkInPayment.qr_token ?? "DEMO"}</p><button onClick={() => void completeWalkInPayment()} disabled={phase === "searching" || walkInPayment.status === "PAID"} className="mt-4 w-full rounded-2xl bg-[#1d1d1f] px-4 py-3 text-sm font-medium text-white">模拟支付成功</button></div>}</section>}
      {transcript.length > 0 && <section className="mt-8 w-full max-w-2xl rounded-[2rem] bg-white p-5 text-left shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">完整对话记录</p><span className="text-xs text-[#a1a1a6]">本次会话 · {transcript.length} 条</span></div><div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">{transcript.map((entry) => <div key={entry.id} className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${entry.role === "user" ? "ml-8 bg-[#eaf4ff] text-[#174a72]" : entry.role === "tool" ? "mr-8 bg-[#f5f5f7] text-[#6e6e73]" : "mr-8 bg-[#eefaf2] text-[#245d38]"}`}><p className="mb-1 text-[10px] uppercase tracking-[.14em] opacity-60">{entry.role === "user" ? "您" : entry.role === "tool" ? "系统动作" : "AI"}</p>{entry.content}</div>)}</div></section>}
      {matchedOrder && (phase === "matched" || phase === "processing" || phase === "complete" || phase === "error") && <section className="mt-9 w-full max-w-3xl rounded-[2rem] bg-white p-6 text-left shadow-sm md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">已匹配订单</p><h2 className="mt-2 text-2xl font-semibold">{matchedOrder.source} · {matchedOrder.order_code}</h2></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">手机号 {matchedOrder.phone_masked}</span></div><div className="mt-6 grid grid-cols-2 gap-4 border-y border-[#ededf0] py-5 text-sm md:grid-cols-4"><Info label="入住日期" value={matchedOrder.stay_date} /><Info label="房型" value={matchedOrder.room_type} /><Info label="晚数" value={`${matchedOrder.nights} 晚`} /><Info label="订单状态" value={STATUS_LABELS[matchedOrder.status] ?? matchedOrder.status} /></div>{phase === "matched" && <button onClick={runCheckin} className="mt-6 w-full rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white"><IdCard size={18} className="mr-2 inline" />模拟身份证放入读卡器</button>}{phase === "matched" && <p className="mt-3 text-center text-xs text-[#86868b]">检测到证件后，读卡、核验、登记和发卡将自动完成，无需再次操作。</p>}</section>}

      {phase === "ambiguous" && <RiskCard title="找到多笔待入住订单" text="仅凭手机号后四位无法确认是哪一笔。AI 已停止自动选择，需要工作人员核对完整手机号或订单号。" orders={alternatives} />}
      {phase === "blocked" && <RiskCard title="该订单不能继续自动办理" text={message} orders={alternatives} />}
      {phase === "not_found" && <section className="mt-9 w-full max-w-xl rounded-[2rem] bg-white p-7 shadow-sm"><Database className="mx-auto text-[#007aff]" /><h2 className="mt-4 text-xl font-semibold">线上订单未找到</h2><p className="mt-2 text-sm leading-6 text-[#6e6e73]">如果客人是现场到店，请在输入框中说“我要现场办理”，再提供完整手机号。系统会先生成草稿、报价和支付页，支付确认后才创建正式订单。</p></section>}
      {phase === "error" && <RiskCard title={flowError ? `已停在第 ${flowError.step.number} 步：${flowError.step.label}` : "流程已安全暂停"} text={message} orders={[]} />}
      {phase === "error" && checkinCase && flowError?.reconciliation && !flowError.reconciliation.unresolved_external_call && flowError.reconciliation.recommended_action !== "manual_verify_external" && <button onClick={() => void runCheckin()} className="mt-4 rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">继续当前步骤</button>}

      {(phase === "processing" || phase === "complete" || phase === "error") && <div className="mt-8 grid w-full gap-5 lg:grid-cols-[1fr_.9fr]">
        <section className="rounded-[2rem] bg-white p-6 text-left shadow-sm"><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">业务状态机</p><div className="mt-5 space-y-3">{TERMINAL_PROGRESS.map(([label, detail], index) => <div key={label} className={`flex items-center gap-3 rounded-2xl p-3 ${index === flowStep ? "bg-[#eef6ff]" : ""}`}><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${index < flowStep || phase === "complete" ? "bg-[#1d1d1f] text-white" : index === flowStep ? "bg-[#007aff] text-white" : "bg-[#e5e5ea] text-[#86868b]"}`}>{index < flowStep || phase === "complete" ? <Check size={15} /> : index + 1}</div><div><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-[#86868b]">{detail}</p></div></div>)}</div></section>
        <section className="overflow-hidden rounded-[2rem] bg-[#15171a] text-left text-white shadow-sm"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></div><span className="text-[11px] text-[#8e8e93]">设备与登记回执</span></div><div className="p-6">{flowStep >= 6 ? <CreditCard className="text-[#64d2ff]" /> : <MonitorCog className="text-[#64d2ff]" />}<p className="mt-5 text-xs uppercase tracking-[.16em] text-[#8e8e93]">一体化终端 · 自动设备链路</p><h2 className="mt-2 text-xl font-semibold">{flowStep < 4 ? "等待身份与房态核验" : flowStep < 6 ? "模拟住宿登记与入住确认" : flowStep === 6 ? "自动写卡与回读校验" : phase === "complete" ? "证件与房卡均已取走" : "请取走房卡和身份证"}</h2><div className="mt-5 space-y-3 font-mono text-xs text-[#aeaeb2]"><p>identity: {flowStep >= 2 ? "VERIFIED_TOKEN" : "pending"}</p><p>room: {checkinCase?.room_number ?? "pending"}</p><p>receipt: {checkinCase?.police_receipt ?? "pending"}</p><p>card_machine: {checkinCase?.hardware_status ?? "not_started"}</p><p>deposit: {depositStatus ?? "pending"}{depositAmount !== null ? ` (${depositAmount} CNY)` : ""}</p></div><p className="mt-6 rounded-xl bg-white/5 p-3 text-xs leading-5 text-[#8e8e93]">演示不会连接真实公安或门锁系统；生产由受控设备适配器执行并返回可审计回执。</p></div></section>
      </div>}

      {phase === "complete" && <section className="mt-6 w-full max-w-3xl rounded-[2rem] border border-[#bde7cf] bg-[#effaf4] p-6"><CircleCheck className="mx-auto text-[#248a4d]" size={30} /><h2 className="mt-3 text-2xl font-semibold">自助入住完成</h2><p className="mt-2 text-sm text-[#52745f]">发卡机已完成写卡、回读和吐卡模拟，传感器确认身份证与房卡均已取走。</p><div className="mx-auto mt-5 grid max-w-xl gap-2 text-left sm:grid-cols-2"><div className="rounded-xl bg-white/70 px-3 py-3 text-xs text-[#52745f]"><p className="text-[#7a9b86]">押金状态</p><p className="mt-1 font-medium text-[#248a4d]">{depositStatus === "captured" ? `已收 ¥${depositAmount ?? 0}` : depositStatus === "pending" ? "等待支付回执" : depositStatus === "failed" ? "收款失败，已转人工" : "已由入住系统确认"}</p></div><div className="rounded-xl bg-white/70 px-3 py-3 text-xs text-[#52745f]"><p className="text-[#7a9b86]">账本状态</p><p className="mt-1 font-medium text-[#248a4d]">已建立 · 在住中</p></div></div></section>}
      {!showEntry && <button onClick={reset} className="mt-7 inline-flex items-center gap-2 text-sm text-[#6e6e73]"><RefreshCcw size={15} />办理下一位</button>}
      </>)}
    </section>
    <footer className="mx-auto max-w-5xl pb-5 text-center text-xs text-[#86868b]">演示系统 · {adapter.provider} 临时适配器 · D1 假订单 {snapshot.orders.length} 笔 · 读卡与发卡均为自动化模拟，未连接生产设备</footer>
  </main>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-[#86868b]">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function RiskCard({ title, text, orders }: { title: string; text: string; orders: DemoOrder[] }) {
  return <section className="mt-9 w-full max-w-2xl rounded-[2rem] border border-[#f1c7b5] bg-[#fff8f4] p-7 text-left"><div className="flex items-start gap-3"><div className="rounded-xl bg-[#ffe4d6] p-2 text-[#c54b12]"><AlertTriangle size={20} /></div><div><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-[#765444]">{text}</p></div></div>{orders.length > 0 && <div className="mt-5 space-y-2">{orders.map((order) => <div key={order.id} className="rounded-xl bg-white/80 p-3 text-sm"><span className="font-medium">{order.source}</span><span className="ml-3 text-[#86868b]">{order.order_code} · {order.stay_date} · {STATUS_LABELS[order.status] ?? order.status}</span></div>)}</div>}</section>;
}

function AdminConsole({ sessionId, adapter, snapshot, loading, onRefresh, onBack, onPairing, onReconfigure }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; loading: boolean; onRefresh: () => Promise<void>; onBack: () => void; onPairing: () => void; onReconfigure: () => void }) {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [purgeRange, setPurgeRange] = useState("30d");
  const [resetting, setResetting] = useState(false);
  const [faultTarget, setFaultTarget] = useState("reader");
  const [faultType, setFaultType] = useState("reader_timeout");
  const [faults, setFaults] = useState<Array<{ id: string; target: string; fault_type: string; call_count: number; enabled: number }>>([]);
  const [faultMessage, setFaultMessage] = useState("");
  const [adminUtterance, setAdminUtterance] = useState("");
  const [adminReply, setAdminReply] = useState("管理员模式已就绪。您可以说：查询尾号4821，或把尾号4821换到1306。");
  const [adminResult, setAdminResult] = useState<AdminResult>(null);
  const [adminWorkflow, setAdminWorkflow] = useState<AdminWorkflow | null>(null);
  const [suggestionRoom, setSuggestionRoom] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminVoiceListening, setAdminVoiceListening] = useState(false);
  const [adminVoiceSubmitSignal, setAdminVoiceSubmitSignal] = useState(0);
  const [pendingAdminActionId, setPendingAdminActionId] = useState<string | null>(null);
  const [pendingAdminAction, setPendingAdminAction] = useState<PendingAdminAction | null>(null);
  const [pendingActionDirty, setPendingActionDirty] = useState(false);
  const [confirmActionOpen, setConfirmActionOpen] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [confirmationCard, setConfirmationCard] = useState<AdminConfirmationCardState | null>(null);
  const [auditDetails, setAuditDetails] = useState<AdminAuditRecord[] | null>(null);
  const [auditDetailsBusy, setAuditDetailsBusy] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStageState[]>(() => INITIAL_PIPELINE.map((stage) => ({ ...stage })));
  const [adminVoiceRetrySignal, setAdminVoiceRetrySignal] = useState(0);
  const [aiChain, setAiChain] = useState<AiChainView | null>(null);
  const [aiChainBusy, setAiChainBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/admin/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ user?: AdminUser }> : Promise.reject(new Error("auth_required")))
      .then((data) => setAdminUser(data.user ?? null))
      .catch(() => setAdminUser(null))
      .finally(() => setAuthLoading(false));
  }, []);
  function updatePipelineStage(id: PipelineStageId, patch: Partial<PipelineStageState>) {
    setPipeline((current) => current.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
  }
  function resetCommandPipeline() {
    setPipeline((current) => current.map((stage) => (stage.id === "mic" || stage.id === "asr" ? stage : { id: stage.id, label: stage.label, status: "idle" as const, detail: undefined, latencyMs: undefined })));
  }
  const intentEvents = snapshot.auditEvents.filter((event) => event.event_type.startsWith("INTENT_"));
  const completedCases = snapshot.cases.filter((item) => item.status === "CHECKIN_COMPLETE").length;
  const estimatedMinutesSaved = completedCases * 6;
  const orderStatusData = useMemo(() => Object.entries(snapshot.orders.reduce<Record<string, number>>((counts, order) => { const label = STATUS_LABELS[order.status] ?? order.status; counts[label] = (counts[label] ?? 0) + 1; return counts; }, {})).map(([name, value]) => ({ name, value })), [snapshot.orders]);
  const orderSourceData = useMemo(() => Object.entries(snapshot.orders.reduce<Record<string, number>>((counts, order) => { counts[order.source] = (counts[order.source] ?? 0) + 1; return counts; }, {})).map(([name, value]) => ({ name, value })), [snapshot.orders]);
  const caseStatusData = useMemo(() => Object.entries(snapshot.cases.reduce<Record<string, number>>((counts, item) => { const label = STATUS_LABELS[item.status] ?? item.status; counts[label] = (counts[label] ?? 0) + 1; return counts; }, {})).map(([name, value]) => ({ name, value })), [snapshot.cases]);
  const roomStatusData = useMemo(() => {
    const counts = { "已入住": 0, "待入住": 0, "空闲/未分配": 0 };
    snapshot.orders.forEach((order) => { if (order.status === "in_house") counts["已入住"] += 1; else if (order.status === "awaiting_arrival") counts["待入住"] += 1; else if (!order.room_number) counts["空闲/未分配"] += 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [snapshot.orders]);
  const auditTrendData = useMemo(() => snapshot.auditEvents.slice(0, 10).reverse().map((event, index) => ({ name: `#${event.id}`, value: index + 1 })), [snapshot.auditEvents]);
  async function resetData() {
    setResetting(true);
    try {
      await postDemo("reset", { session_id: sessionId });
      await onRefresh();
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }
  async function loadFaults() {
    const response = await fetch(`/api/simulator/faults?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const data = await response.json() as { faults?: typeof faults };
    setFaults(data.faults ?? []);
  }
  useEffect(() => {
    if (!adminUser) return;
    void fetch(`/api/simulator/faults?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ faults?: typeof faults }>)
      .then((data) => setFaults(data.faults ?? []));
  }, [sessionId, adminUser]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setAuthError("");
    try {
      const response = await fetch("/api/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json() as { user?: AdminUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error ?? "登录失败，请检查账号和口令");
      setAdminUser(data.user);
      setPassword("");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "登录失败"); }
    finally { setLoggingIn(false); }
  }
  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setAdminUser(null);
  }
  async function executePendingAdminAction() {
    if (!pendingAdminAction || adminActionBusy) return;
    setAdminActionBusy(true);
    updatePipelineStage("confirm", { status: "connecting", detail: "正在执行" });
    if (adminWorkflow?.kind === "room_change") setAdminWorkflow((current) => current ? { ...current, step: "executing", message: "正在调用 PMS 执行换房…" } : current);
    try {
      let actionToExecute = pendingAdminAction;
      if (pendingActionDirty) {
        let toolName = "";
        let args: Record<string, unknown> = {};
        if (pendingAdminAction.actionType === "room_change") {
          if (!pendingAdminAction.orderId || !pendingAdminAction.toRoom || !/^\d{3,5}$/.test(pendingAdminAction.toRoom)) throw new Error("请填写有效的目标房间");
          toolName = "admin.prepare_room_change";
          args = { order_id: pendingAdminAction.orderId, to_room: pendingAdminAction.toRoom, reason: "管理员在确认卡编辑后重新生成" };
        } else if (pendingAdminAction.actionType === "amount_adjustment") {
          if (!pendingAdminAction.orderId || !pendingAdminAction.amountType || !Number.isInteger(pendingAdminAction.newAmount)) throw new Error("请填写有效的整数金额");
          toolName = "admin.prepare_amount_adjustment";
          args = { order_id: pendingAdminAction.orderId, amount_type: pendingAdminAction.amountType, new_amount: pendingAdminAction.newAmount, reason: "管理员在确认卡编辑后重新生成" };
        } else throw new Error("该操作暂不支持直接编辑，请取消后重新下达指令");
        updatePipelineStage("tool", { status: "connecting", detail: "正在重新校验编辑后的字段", latencyMs: undefined });
        const prepared = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: toolName, arguments: args }) }, "正在重新校验编辑后的字段", "字段重新校验超时，未执行任何修改");
        const preparedData = await prepared.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
        if (!prepared.ok || !preparedData.ok || !preparedData.result) throw new Error(preparedData.error ?? "编辑后的字段校验失败");
        updatePipelineStage("tool", { status: "normal", detail: "字段重新校验通过" });
        const oldActionId = pendingAdminAction.actionId;
        const nextActionId = setPendingActionFromResult(preparedData.result);
        actionToExecute = { ...pendingAdminAction, actionId: nextActionId };
        setPendingActionDirty(false);
        void fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.cancel_pending_action", arguments: { action_id: oldActionId, reason: "确认卡字段已编辑并生成新确认单" } }) });
      }
      const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.confirm_pending_action", arguments: { action_id: actionToExecute.actionId, confirmation: "CONFIRM" } }) });
      const data = await response.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.ok) {
        const code = data.error ?? "admin_action_failed";
        if (code === "admin_action_expired" || code === "room_change_conflict") {
          const status: AdminConfirmationStatus = code === "admin_action_expired" ? "EXPIRED" : "CONFLICTED";
          const message = code === "admin_action_expired" ? "确认单已过期，请重新生成后再执行。" : "目标房间已被提前占用，未修改任何房态，请刷新后重新生成确认单。";
          setConfirmationCard((current) => current ? { ...current, status, error: message } : current);
          updatePipelineStage("confirm", { status: "failed", detail: message });
          setPendingAdminActionId(null);
          setPendingAdminAction(null);
          setConfirmActionOpen(false);
          if (adminWorkflow?.kind === "room_change") {
            const blocked: AdminWorkflow = { ...adminWorkflow, step: "blocked", message };
            setAdminWorkflow(blocked); setAdminResult({ type: "workflow", workflow: blocked });
          }
          await onRefresh();
          return;
        }
        throw new Error(code);
      }
      const result = data.result ?? {};
      setConfirmActionOpen(false);
      setPendingAdminActionId(null);
      setPendingAdminAction(null);
      setConfirmationCard((current) => current ? { ...current, status: "EXECUTED", error: undefined } : current);
      updatePipelineStage("confirm", { status: "normal", detail: "已执行" });
      setAdminReply(`已执行：${String(result.title ?? pendingAdminAction.title)}。业务系统已更新，操作已写入审计。`);
      if (adminWorkflow?.kind === "room_change") {
        const completed: AdminWorkflow = { ...adminWorkflow, step: "completed", message: "换房已完成，PMS 状态和审计记录已更新。" };
        setAdminWorkflow(completed); setAdminResult({ type: "workflow", workflow: completed });
      }
      await onRefresh();
    } catch (error) {
      setAdminReply(error instanceof Error ? error.message : "执行失败，请转人工核对");
      updatePipelineStage("confirm", { status: "failed", detail: error instanceof Error ? error.message : "执行失败" });
      setConfirmActionOpen(false);
    } finally { setAdminActionBusy(false); }
  }
  async function cancelPendingAdminAction() {
    if (!pendingAdminAction || adminActionBusy) return;
    setAdminActionBusy(true);
    try {
      const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.cancel_pending_action", arguments: { action_id: pendingAdminAction.actionId, reason: "管理员在确认弹窗中取消" } }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "取消失败");
      setConfirmActionOpen(false);
      setPendingAdminActionId(null);
      setPendingAdminAction(null);
      setConfirmationCard((current) => current ? { ...current, status: "CANCELLED", error: undefined } : current);
      updatePipelineStage("confirm", { status: "cancelled", detail: "已取消" });
      setAdminReply("已取消待确认动作，没有修改 PMS、金额、公安或房卡设备。 ");
      if (adminWorkflow?.kind === "room_change") {
        const cancelled: AdminWorkflow = { ...adminWorkflow, step: "blocked", message: "已取消换房，业务数据未修改。" };
        setAdminWorkflow(cancelled); setAdminResult({ type: "workflow", workflow: cancelled });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "admin_action_failed";
      if (message === "admin_action_expired") {
        setConfirmationCard((current) => current ? { ...current, status: "EXPIRED", error: "确认单已过期，请重新生成后再执行。" } : current);
        setPendingAdminActionId(null);
        setPendingAdminAction(null);
      }
      setAdminReply(message === "admin_action_expired" ? "确认单已过期，请重新生成。" : "取消失败，请转人工核对");
      setConfirmActionOpen(false);
    } finally { setAdminActionBusy(false); }
  }
  async function fetchAdminStep(input: RequestInfo | URL, init: RequestInit, runningMessage: string, timeoutMessage: string) {
    const controller = new AbortController();
    const slowNotice = window.setTimeout(() => setAdminReply(`${runningMessage} · 仍在处理，请稍候…`), 3000);
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error(timeoutMessage);
      throw error;
    } finally {
      window.clearTimeout(slowNotice);
      window.clearTimeout(timeout);
    }
  }
  /**
   * Housekeeping confirming a cleaned room. One tap on purpose: the action is
   * reversible and the room state machine already refuses anything but
   * VACANT_DIRTY -> VACANT_CLEAN, so an occupied room cannot be declared clean.
   */
  async function markAdminRoomClean(roomNumber: string) {
    if (adminBusy) return;
    setAdminBusy(true);
    setAdminReply(`正在把房间 ${roomNumber} 标记为已完成打扫…`);
    try {
      const response = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.mark_room_clean", arguments: { room_number: roomNumber } }) }, "正在提交房态清洁", "房态清洁提交超时，结果未确认，请先重新查询房态再决定是否重试");
      const data = await response.json() as { ok?: boolean; result?: { idempotent?: boolean }; error?: string };
      if (!response.ok || !data.ok) {
        const code = data.error ?? "";
        throw new Error(code === "admin_permission_denied" ? "当前角色没有客房清洁权限，只有客房、店长和老板可以把房间改为可售。"
          : code === "formal_core_unavailable" ? "正式房态不可用，无法标记清洁，请检查迁移是否已执行。"
          : code.startsWith("invalid_room_transition") ? `房间 ${roomNumber} 当前不是待清洁状态，不能标记为可售。`
          : code || "房态清洁失败");
      }
      setAdminResult({ type: "room", roomNumber, status: "vacant-clean", version: null });
      setAdminReply(`房间 ${roomNumber} 已打扫完成，房态回到可售${data.result?.idempotent ? "（重复确认，未重复写房态流水）" : ""}。`);
    } catch (error) { setAdminReply(error instanceof Error ? error.message : "房态清洁失败，请转人工核对"); }
    finally { setAdminBusy(false); }
  }
  /**
   * Retention cleanup. The preview *is* the confirmation card: the server freezes
   * the window and the row counts into a pending action, and nothing is deleted
   * until that card is confirmed.
   */
  async function preparePurgeCleanup(range: string) {
    if (adminBusy) return;
    const label = RETENTION_OPTIONS.find((option) => option.id === range)?.label ?? range;
    setAdminBusy(true);
    setAdminReply(`正在统计${label}的已退房记录…`);
    try {
      const response = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.prepare_purge_closed_loops", arguments: { range } }) }, "正在统计将被清理的记录", "统计超时，未生成清理确认单，也没有删除任何记录");
      const data = await response.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.ok || !data.result) {
        const code = data.error ?? "";
        throw new Error(code === "admin_permission_denied" ? "当前角色不能清理历史数据，只有店长和老板可以。" : code || "生成清理确认单失败");
      }
      setPendingActionFromResult(data.result);
      setAdminReply("清理确认单已生成，请核对将删除的数量后再确认；确认前不会删除任何记录。");
    } catch (error) { setAdminReply(error instanceof Error ? error.message : "生成清理确认单失败，未删除任何记录"); }
    finally { setAdminBusy(false); }
  }
  async function fetchAdminStreamStep(text: string): Promise<{ response?: AdminResponse; error?: string }> {
    const controller = new AbortController();
    const started = performance.now();
    let firstTokenAt = 0;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/admin/agent/turn", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ messages: [{ role: "user", content: text }], pending_action_id: pendingAdminActionId ?? undefined }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("管理员流式通道不可用，请重试");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      let streamedText = "";
      let result: { response?: AdminResponse; error?: string } | null = null;
      const consume = (block: string) => {
        let data = "";
        for (const line of block.split("\n")) { if (line.startsWith("event:")) eventName = line.slice(6).trim(); if (line.startsWith("data:")) data += line.slice(5).trim(); }
        if (!data) return;
        try {
          const payload = JSON.parse(data) as { status?: string; text?: string; stage?: string; latency_ms?: number; response?: AdminResponse; error?: string };
          if (eventName === "status" && payload.status) {
            const stage = payload.stage;
            setAdminReply(payload.status);
            updatePipelineStage("model", { status: stage === "awaiting_confirmation" || stage === "responding" ? "normal" : "connecting", detail: payload.status });
          }
          if (eventName === "text_delta" && payload.text) { if (!firstTokenAt) { firstTokenAt = performance.now(); updatePipelineStage("model", { detail: `模型首字 ${Math.round(firstTokenAt - started)}ms` }); } streamedText += payload.text; setAdminReply(streamedText); }
          if (eventName === "done") { result = payload; updatePipelineStage("model", { status: "normal", detail: `模型 ${payload.latency_ms ?? Math.round(performance.now() - started)}ms`, latencyMs: payload.latency_ms ?? Math.round(performance.now() - started) }); }
          if (eventName === "error") { result = { error: payload.error ?? "管理员模型流式失败" }; updatePipelineStage("model", { status: "failed", detail: result.error }); }
        } catch { /* wait for the next complete SSE frame */ }
      };
      while (true) { const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true }); const blocks = buffer.split("\n\n"); buffer = blocks.pop() ?? ""; blocks.forEach(consume); }
      if (buffer.trim()) consume(buffer);
      const totalMs = Math.round(performance.now() - started);
      if (!streamedText) setAdminReply(`模型规划完成 · ${totalMs}ms${firstTokenAt ? ` · 首字 ${Math.round(firstTokenAt - started)}ms` : ""}`);
      const completed = result as { response?: AdminResponse; error?: string } | null;
      if (!completed?.response) throw new Error(completed?.error ?? "管理员意图识别失败");
      return completed;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updatePipelineStage("model", { status: "timeout", detail: "模型理解超时" });
        throw new Error("AI 理解请求超时，本次没有执行任何操作，请重试");
      }
      updatePipelineStage("model", { status: "failed", detail: error instanceof Error ? error.message : "模型理解失败" });
      throw error;
    }
    finally { window.clearTimeout(timeout); }
  }
  function setPendingActionFromResult(toolResult: Record<string, unknown>) {
    const actionId = String(toolResult.action_id ?? "");
    setPendingAdminActionId(actionId || null);
    const guest = toolResult.guest as Record<string, unknown> | undefined;
    const fields = (toolResult.fields as Array<{ label: string; value: string }> | undefined) ?? [];
    const impacts = (toolResult.impacts as string[] | undefined) ?? [];
    const action: PendingAdminAction = { actionId, orderId: toolResult.order_id ? String(toolResult.order_id) : undefined, actionType: String(toolResult.action_type ?? "admin_action"), title: String(toolResult.title ?? "确认执行该操作吗？"), riskLevel: String(toolResult.risk_level ?? "medium"), requiredPermission: String(toolResult.required_permission ?? "admin"), phone: String(guest?.phone ?? "***未知"), orderCode: String(toolResult.order_code ?? ""), fields, impacts, confirmLabel: String(toolResult.confirm_label ?? "确认执行"), cancelLabel: String(toolResult.cancel_label ?? "取消"), reason: String(toolResult.reason ?? "管理员指令"), expiresAt: String(toolResult.expires_at ?? ""), fromRoom: toolResult.from_room ? String(toolResult.from_room) : undefined, toRoom: toolResult.to_room ? String(toolResult.to_room) : undefined, amountType: toolResult.amount_type ? String(toolResult.amount_type) : undefined, newAmount: toolResult.new_amount === undefined ? undefined : Number(toolResult.new_amount) };
    setPendingActionDirty(false);
    setPendingAdminAction(action);
    setConfirmationCard({ action, status: "AWAITING_CONFIRMATION" });
    updatePipelineStage("confirm", { status: "normal", detail: "待确认" });
    return actionId;
  }
  async function loadAiChain() {
    setAiChainBusy(true);
    try {
      const response = await fetch(`/api/admin/ai-chain?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; error?: string } & Partial<AiChainView>;
      if (!response.ok || !data.ok) throw new Error(data.error ?? "AI 决策链读取失败");
      setAiChain({ workflow: data.workflow ?? null, intents: data.intents ?? [], plans: data.plans ?? [], toolCalls: data.toolCalls ?? [], policyDecisions: data.policyDecisions ?? [] });
    } catch (error) {
      setAdminReply(error instanceof Error ? error.message : "AI 决策链读取失败");
    } finally { setAiChainBusy(false); }
  }
  async function loadAuditDetails(actionId: string) {
    setAuditDetailsBusy(true);
    try {
      const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.get_audit_records", arguments: { action_id: actionId, limit: 100 } }) });
      const data = await response.json() as { ok?: boolean; result?: { events?: AdminAuditRecord[] }; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "审计详情读取失败");
      setAuditDetails(data.result?.events ?? []);
    } catch (error) {
      setAdminReply(error instanceof Error ? error.message : "审计详情读取失败");
    } finally { setAuditDetailsBusy(false); }
  }
  function retryConfirmation(action: PendingAdminAction) {
    const last4 = action.phone.replace(/\D/g, "").slice(-4);
    if (action.actionType === "room_change" && last4 && action.toRoom) void submitAdminCommand(`把尾号${last4}换到${action.toRoom}`);
    else setAdminReply("请重新说出完整的管理员指令，系统会重新核对业务状态。");
  }
  async function continueRoomChangeWorkflow(order: Record<string, unknown>, targetRoom: string) {
    const orderId = String(order.id ?? order.order_code ?? "");
    setAdminWorkflow({ kind: "room_change", step: "room_check", targetRoom, candidates: [order], selectedOrder: order, room: null, message: `正在核对目标房间 ${targetRoom}…` });
    setAdminResult({ type: "workflow", workflow: { kind: "room_change", step: "room_check", targetRoom, candidates: [order], selectedOrder: order, room: null, message: `正在核对目标房间 ${targetRoom}…` } });
    setAdminReply(`已选择订单 ${String(order.order_code ?? "")}，正在重新核对房间 ${targetRoom}…`);
    try {
      const roomResponse = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.get_room_status", arguments: { room_number: targetRoom } }) }, "正在核对目标房态", "房态查询超时，未生成换房确认单");
      const roomData = await roomResponse.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!roomResponse.ok || !roomData.ok || !roomData.result) throw new Error(roomData.error ?? "房态核验失败");
      const roomResult = roomData.result;
      const room = { roomNumber: String(roomResult.room_number ?? targetRoom), status: String(roomResult.status ?? "unknown"), version: roomResult.version === null || roomResult.version === undefined ? null : Number(roomResult.version), guest: roomResult.guest as Record<string, unknown> | null | undefined };
      if (room.status !== "vacant-clean") {
        const blocked: AdminWorkflow = { kind: "room_change", step: "blocked", targetRoom, candidates: [order], selectedOrder: order, room, message: `目标房间 ${targetRoom} 当前不可用，已停止换房。` };
        setAdminWorkflow(blocked); setAdminResult({ type: "workflow", workflow: blocked }); setAdminReply(blocked.message); return;
      }
      setAdminWorkflow({ kind: "room_change", step: "confirmation", targetRoom, candidates: [order], selectedOrder: order, room, message: "房态核验通过，正在生成换房确认单…" });
      const prepareResponse = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.prepare_room_change", arguments: { order_id: orderId, to_room: targetRoom, reason: "管理员确认订单后发起换房" } }) }, "正在生成换房确认单", "换房确认单生成超时，未修改任何数据");
      const prepareData = await prepareResponse.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!prepareResponse.ok || !prepareData.ok || !prepareData.result) throw new Error(prepareData.error ?? "换房确认单生成失败");
      const actionId = setPendingActionFromResult(prepareData.result);
      const confirmation: AdminWorkflow = { kind: "room_change", step: "confirmation", targetRoom, candidates: [order], selectedOrder: order, room, message: "确认单已生成，请核对后点击确认修改。" };
      setAdminWorkflow(confirmation); setAdminResult({ type: "workflow", workflow: confirmation });
      setAdminReply(`换房确认单已生成${actionId ? "，请核对后点击“确认修改”" : "，但未返回确认单编号，请重新查询"}。`);
    } catch (error) {
      const failed: AdminWorkflow = { kind: "room_change", step: "blocked", targetRoom, candidates: [order], selectedOrder: order, room: null, message: error instanceof Error ? error.message : "换房流程失败" };
      setAdminWorkflow(failed); setAdminResult({ type: "workflow", workflow: failed }); setAdminReply(failed.message);
    }
  }
  async function selectRoomChangeOrder(order: Record<string, unknown>) {
    if (!adminWorkflow || adminWorkflow.kind !== "room_change" || adminBusy) return;
    setAdminBusy(true);
    try { await continueRoomChangeWorkflow(order, adminWorkflow.targetRoom); } finally { setAdminBusy(false); }
  }
  async function submitAdminCommand(command = adminUtterance, options: { fromVoiceFinal?: boolean } = {}) {
    if (command.startsWith("__select:")) {
      const key = command.slice("__select:".length);
      const order = adminWorkflow?.candidates.find((candidate) => String(candidate.id ?? candidate.order_code) === key);
      if (order) await selectRoomChangeOrder(order);
      return;
    }
    if (command === "__open_confirmation") { if (pendingAdminAction) setConfirmActionOpen(true); return; }
    const text = command.trim();
    if (adminVoiceListening && !options.fromVoiceFinal) {
      setAdminReply("正在结束管理员录音并整理文字；识别结果会先回填输入框，请检查后再点击发送。");
      setAdminVoiceSubmitSignal((value) => value + 1);
      return;
    }
    if (!text || adminBusy) return;
    setAdminBusy(true);
    setAdminResult(null);
    setAdminWorkflow(null);
    setAdminReply("正在理解管理员意图…");
    resetCommandPipeline();
    updatePipelineStage("model", { status: "connecting", detail: "正在理解管理员意图", latencyMs: undefined });
    try {
      const routedData = await fetchAdminStreamStep(text);
      if (!routedData.response) throw new Error(routedData.error ?? "管理员意图识别失败");
      const result = routedData.response;
      if (result.type !== "tool_call") { setAdminReply(result.message); return; }
      setAdminReply(`已理解为“${result.tool_name}”，正在校验权限和业务状态…`);
      const toolStartedAt = performance.now();
      updatePipelineStage("tool", { status: "connecting", detail: "正在校验权限和业务状态", latencyMs: undefined });
      const executed = await fetchAdminStep("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: result.tool_name, arguments: result.arguments }) }, "正在校验权限和业务状态", "工具执行等待超时，结果未确认，请查看审计记录后再处理；系统不会自动重试");
      const executedData = await executed.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!executed.ok || !executedData.ok) throw new Error(executedData.error ?? "管理员工具执行失败");
      const toolLatencyMs = Math.round(performance.now() - toolStartedAt);
      updatePipelineStage("tool", { status: "normal", detail: `工具 ${toolLatencyMs}ms`, latencyMs: toolLatencyMs });
      const toolResult = executedData.result ?? {};
      if (result.tool_name === "admin.search_guest") {
        const orders = (toolResult.orders as Array<Record<string, unknown>> | undefined) ?? [];
        setAdminResult({ type: "orders", orders });
        if (result.workflow?.kind === "room_change") {
          const workflow: AdminWorkflow = { kind: "room_change", step: orders.length === 0 ? "blocked" : orders.length === 1 ? "room_check" : "guest_selection", targetRoom: result.workflow.target_room, candidates: orders, selectedOrder: null, room: null, message: orders.length === 1 ? "已找到唯一订单，正在核对目标房态…" : orders.length > 1 ? "找到多笔订单，请选择要换房的客人。" : "没有找到可换房订单。" };
          setAdminWorkflow(workflow); setAdminResult({ type: "workflow", workflow });
          setAdminReply(workflow.message);
          if (orders.length === 1) await continueRoomChangeWorkflow(orders[0], result.workflow.target_room);
        } else setAdminReply(orders.length ? `已找到 ${orders.length} 笔相关订单，请在下方核对。` : "没有找到符合条件的客人或订单。");
      } else if (result.tool_name === "admin.get_room_status") {
        const roomNumber = String(toolResult.room_number ?? "");
        const roomStatus = String(toolResult.status ?? "unknown");
        setAdminResult({ type: "room", roomNumber, status: roomStatus, version: toolResult.version === null || toolResult.version === undefined ? null : Number(toolResult.version) });
        setAdminReply(roomStatus === "occupied" ? `房间 ${roomNumber} 当前有人入住，已隐藏完整客人信息。` : roomStatus === "vacant-dirty" ? `房间 ${roomNumber} 是待清洁房，打扫完成后才能重新售卖。` : `房间 ${roomNumber} 当前${ROOM_STATUS_LABELS[roomStatus] ?? "空闲"}，可继续核对。`);
      } else if (result.tool_name === "admin.mark_room_clean") {
        const roomNumber = String(toolResult.room_number ?? "");
        setAdminResult({ type: "room", roomNumber, status: Number(toolResult.room_status ?? 0) === 0 ? "vacant-clean" : "vacant-dirty", version: null });
        setAdminReply(`房间 ${roomNumber} 已打扫完成，房态回到可售${toolResult.idempotent ? "（重复确认，未重复写流水）" : ""}。`);
      } else if (result.tool_name.startsWith("admin.prepare_")) {
        setPendingActionFromResult(toolResult);
        if (String(toolResult.action_type ?? "") === "room_change") setAdminWorkflow({ kind: "room_change", step: "confirmation", targetRoom: String(toolResult.to_room ?? ""), candidates: [], selectedOrder: null, room: null, message: "换房确认单已生成，请核对后点击确认修改。" });
        setAdminReply(`${String(toolResult.title ?? "动作确认单")}已生成。请核对无误后说“确认执行”，系统会弹出确认窗口；点击确认前不会修改 PMS、金额、公安或房卡设备。`);
      } else if (result.tool_name === "admin.confirm_pending_action" || result.tool_name === "admin.confirm_room_change") {
        if (!pendingAdminAction) throw new Error("确认单已失效，请重新准备操作");
        setConfirmActionOpen(true);
        setAdminReply("已收到“确认执行”。请在弹窗中核对修改内容，再点击确认或取消。在点击前不会修改任何业务数据。");
      } else if (result.tool_name === "admin.cancel_pending_action" || result.tool_name === "admin.cancel_room_change") { setPendingAdminActionId(null); setPendingAdminAction(null); setAdminReply("已取消待确认动作，没有修改 PMS、金额、公安或房卡设备。"); }
    } catch (error) { setAdminReply(error instanceof Error ? error.message : "管理员操作失败，请转人工核对"); }
    finally { setAdminBusy(false); setAdminUtterance(""); }
  }
  if (authLoading) return <main className="grid min-h-screen place-items-center bg-[#f3f6f8] text-[#627d98]"><LoaderCircle className="animate-spin" /> 正在验证管理员会话…</main>;
  if (!adminUser) return <main className="grid min-h-screen place-items-center bg-[#f3f6f8] p-5 text-[#102a43]"><form onSubmit={login} className="w-full max-w-md rounded-3xl border border-[#d9e2ec] bg-white p-7 shadow-xl"><button type="button" onClick={onBack} className="text-sm text-[#627d98]">← 返回入住终端</button><p className="mt-8 text-sm text-[#627d98]">独立管理后台</p><h1 className="mt-1 text-2xl font-semibold">管理员登录</h1><p className="mt-2 text-sm leading-6 text-[#829ab1]">登录后才能查看后台数据、配置仿真故障和执行管理员工具。会话 8 小时后自动失效。</p><label className="mt-6 block text-sm">账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-2 w-full rounded-xl border border-[#cbd9e5] px-4 py-3 outline-none focus:border-[#007aff]" /></label><label className="mt-4 block text-sm">管理员口令<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="mt-2 w-full rounded-xl border border-[#cbd9e5] px-4 py-3 outline-none focus:border-[#007aff]" /></label>{authError && <p className="mt-3 rounded-xl bg-[#fff1ed] px-3 py-2 text-sm text-[#b63d13]">{authError}</p>}<button disabled={loggingIn} className="mt-6 w-full rounded-xl bg-[#007aff] px-4 py-3 font-medium text-white disabled:opacity-50">{loggingIn ? "验证中…" : "登录管理后台"}</button><p className="mt-4 text-xs leading-5 text-[#829ab1]">演示环境已预置四种角色账号；生产环境请在部署配置中替换口令并关闭演示账号。</p></form></main>;
  async function configureFault() {
    setFaultMessage("");
    const response = await fetch("/api/simulator/faults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, target: faultTarget, fault_type: faultType, trigger_on_call: 1, repeat_count: 1, auto_reset: true }) });
    const data = await response.json() as { ok?: boolean; error?: string };
    setFaultMessage(data.ok ? "已注入一次性故障" : `注入失败：${data.error ?? "未知错误"}`);
    await loadFaults();
  }
  async function resetFaults() {
    await fetch("/api/simulator/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
    setFaultMessage("已恢复正常仿真");
    await loadFaults();
  }
  return <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]"><header className="border-b border-[#d9e2ec] bg-white px-5 py-5 md:px-9"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-[#f3f6f8]" aria-label="返回入住界面"><ArrowLeft size={18} /></button><div><p className="text-sm text-[#627d98]">独立管理后台 · {adminUser.display_name}（{adminUser.role}）</p><h1 className="font-semibold">{adapter.hotelName}</h1></div></div><div className="flex gap-2"><button onClick={() => void onRefresh()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">{loading ? "刷新中…" : "刷新数据"}</button><button onClick={onPairing} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">环境检测</button><button onClick={onReconfigure} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">重新适配</button><button onClick={() => void logout()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">退出登录</button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 md:p-9"><section className="rounded-2xl border border-[#b9d8f4] bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-[#3b78a8]">管理员 AI Native</p><h2 className="mt-1 text-xl font-semibold">语音指令 → 动作确认 → PMS / 设备 / 公安执行</h2><p className="mt-1 text-sm text-[#627d98]">管理员可以自然说话；AI 先生成待确认动作，改库、改金额、发卡、公安提交都必须弹窗核对后才执行。客房说“1208 打扫完成”是唯一例外：它只会把待清洁房改成可售，占用中的房间会被房态机直接拒绝。</p></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">{adminUser.role} · 已认证</span></div><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void submitAdminCommand("查询尾号4821")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">查询尾号 4821</button><button type="button" onClick={() => void submitAdminCommand("查询房态1306")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">查询房态 1306</button><button type="button" onClick={() => void submitAdminCommand("1208 打扫完成")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">标记打扫完成</button><button type="button" onClick={() => void submitAdminCommand("把尾号4821换到1306")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">准备换房</button><button type="button" onClick={() => void submitAdminCommand("把尾号4821的总金额改成680")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">准备改金额</button><button type="button" onClick={() => void submitAdminCommand("给尾号7366重新发房卡")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">准备发卡</button><button type="button" onClick={() => void submitAdminCommand("给尾号7366提交广州公安登记")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">准备公安登记</button>{pendingAdminActionId && pendingAdminAction && <button type="button" onClick={() => setConfirmActionOpen(true)} className="rounded-full bg-[#007aff] px-3 py-2 text-sm text-white">确认执行：{pendingAdminAction.title}</button>}</div><form onSubmit={(event) => { event.preventDefault(); void submitAdminCommand(); }} className="mt-4 flex items-center gap-2"><input value={adminUtterance} onChange={(event) => setAdminUtterance(event.target.value)} placeholder="例如：把尾号4821换到1306，或把尾号4821的总金额改成680" className="min-w-0 flex-1 rounded-xl border border-[#cbd9e5] bg-[#f8fbfd] px-4 py-3 text-sm outline-none focus:border-[#007aff]" aria-label="管理员语音或文字指令" /><AdminVoiceInputControls adapter={adapter} onText={setAdminUtterance} onListeningChange={setAdminVoiceListening} submitSignal={adminVoiceSubmitSignal} retrySignal={adminVoiceRetrySignal} onPipelineStage={(stage, status, detail, latencyMs) => updatePipelineStage(stage, { status, detail, latencyMs })} />{adminVoiceListening && <button type="button" onClick={() => setAdminVoiceSubmitSignal((value) => value + 1)} className="rounded-xl border border-[#cbd9e5] bg-white px-4 py-3 text-sm text-[#102a43]">结束录音</button>}<button type="submit" disabled={adminBusy || !adminUtterance.trim()} className="rounded-xl bg-[#007aff] px-4 py-3 text-sm text-white disabled:opacity-40">{adminBusy ? "处理中…" : "发送"}</button><button type="button" onClick={() => { setAdminUtterance(""); setAdminVoiceRetrySignal((value) => value + 1); }} disabled={adminBusy || adminVoiceListening} className="rounded-xl border border-[#cbd9e5] bg-white px-4 py-3 text-sm text-[#102a43]">重试</button></form><AdminPipeline stages={pipeline} /><AdminResultPanel result={adminResult} status={adminReply} suggestionRoom={suggestionRoom} onSuggestionRoomChange={setSuggestionRoom} onPrepareSuggestion={(command) => void submitAdminCommand(command)} onMarkRoomClean={(roomNumber) => void markAdminRoomClean(roomNumber)} /></section><section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#627d98]">商业价值</p><h2 className="mt-1 text-xl font-semibold">四条价值线</h2></div><span className="rounded-full bg-[#e8eef3] px-3 py-1.5 text-xs text-[#627d98]">演示指标 · 生产接入后替换为真实数据</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ValueMetric icon={<TrendingUp size={20} />} label="收益" value="待接 PMS" note="跟踪 RevPAR、ADR 与增值成交" tone="blue" /><ValueMetric icon={<Users size={20} />} label="人力" value={`${estimatedMinutesSaved} 分钟`} note={`已自动完成 ${completedCases} 笔，按每笔节省6分钟估算`} tone="violet" /><ValueMetric icon={<Clock3 size={20} />} label="响应" value="< 3 秒" note="单路首段语音 P95 目标 · 7×24" tone="orange" /><ValueMetric icon={<FileCheck2 size={20} />} label="合规" value={snapshot.cases.length ? "100%" : "待产生"} note={`${snapshot.auditEvents.length} 条脱敏动作记录`} tone="green" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe0f2] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eef3] px-5 py-4"><div><p className="text-sm text-[#3b78a8]">AI Native</p><h2 className="mt-1 font-semibold">意图识别与动作对齐审计</h2></div><span className="rounded-full bg-[#eaf4ff] px-3 py-1.5 text-xs text-[#1769aa]">只保留脱敏表达</span></div><div className="divide-y divide-[#edf2f7]">{intentEvents.length ? intentEvents.slice(0, 8).map((event) => <div key={event.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]"><div><p className="text-sm leading-6 text-[#334e68]">{event.detail}</p><p className="mt-1 text-xs text-[#9fb3c8]">顾客表达 → 意图 → 置信度 → 受控业务动作</p></div><span className="font-mono text-xs text-[#829ab1]">#{event.id}</span></div>) : <Empty text="与AI说一句话后，这里会显示脱敏的意图识别和动作对齐记录" />}</div></section>
      <AdminDataPanel />
      <AdminKnowledgePanel canManage={adminUser.permissions.includes("admin:manage_knowledge")} />
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#e0d2ea] bg-[#fdfbff] shadow-sm"><div className="border-b border-[#eee1f4] px-5 py-4"><p className="text-sm text-[#7b4b9c]">数据保留</p><h2 className="mt-1 font-semibold">清理已退房的历史闭环</h2><p className="mt-1 text-xs leading-5 text-[#7d6a8a]">只删已退房的闭环（入住记录、账本、分录、预订、订单）；在住的客人、他们的账本和房间当前状态都不会被改动。删除不可撤销，所以先生成确认单，确认单里会列出每一类将被删除的数量。</p></div><div className="flex flex-wrap items-center gap-2 px-5 py-4">{RETENTION_OPTIONS.map((option) => <button key={option.id} type="button" onClick={() => setPurgeRange(option.id)} className={`rounded-full px-3 py-2 text-sm ${purgeRange === option.id ? "bg-[#7b4b9c] text-white" : "border border-[#ddcbe4] bg-white text-[#6b4f7d]"}`}>{option.label}</button>)}<button type="button" disabled={adminBusy} onClick={() => void preparePurgeCleanup(purgeRange)} className="rounded-lg bg-[#7b4b9c] px-4 py-2 text-sm text-white disabled:opacity-40">生成清理确认单</button></div></section>      <section className="mt-7 overflow-hidden rounded-2xl border border-[#f0d7b7] bg-[#fffaf4] shadow-sm"><div className="border-b border-[#f3e3cd] px-5 py-4"><p className="text-sm text-[#ad6a16]">验收工具</p><h2 className="mt-1 font-semibold">设备与公安仿真器故障开关</h2><p className="mt-1 text-xs leading-5 text-[#8a6a45]">只影响当前会话；每次注入默认只触发一次，失败会自动生成人工任务和审计记录。</p></div><div className="flex flex-wrap items-end gap-3 px-5 py-4"><label className="text-xs text-[#627d98]">目标<select value={faultTarget} onChange={(event) => { const target = event.target.value; setFaultTarget(target); setFaultType(target === "reader" ? "reader_timeout" : target === "encoder" ? "encoder_offline" : "captcha_required"); }} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm"><option value="reader">读卡器</option><option value="encoder">发卡机</option><option value="police">公安浏览器</option></select></label><label className="text-xs text-[#627d98]">故障类型<select value={faultType} onChange={(event) => setFaultType(event.target.value)} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm">{(faultTarget === "reader" ? ["reader_timeout", "reader_offline", "duplicate_read", "identity_mismatch"] : faultTarget === "encoder" ? ["encoder_offline", "write_failed", "readback_mismatch", "output_jammed", "card_not_collected", "encoder_timeout"] : ["captcha_required", "system_maintenance", "certificate_error", "submission_rejected", "receipt_lost", "police_timeout"]).map((fault) => <option key={fault} value={fault}>{fault}</option>)}</select></label><button onClick={() => void configureFault()} className="rounded-lg bg-[#b66a16] px-4 py-2 text-sm text-white">注入一次</button><button onClick={() => void resetFaults()} className="rounded-lg border border-[#e3c79e] bg-white px-4 py-2 text-sm text-[#8a5b1d]">恢复正常</button>{faultMessage && <span className="text-xs text-[#8a6a45]">{faultMessage}</span>}</div><div className="border-t border-[#f3e3cd] px-5 py-3 text-xs text-[#8a6a45]">{faults.filter((fault) => fault.enabled).length ? faults.filter((fault) => fault.enabled).map((fault) => <span key={fault.id} className="mr-2 inline-flex rounded-full bg-white px-2.5 py-1">{fault.target}/{fault.fault_type} · 已调用 {fault.call_count} 次</span>) : "当前没有启用的故障"}</div></section>
      <section className="mt-7"><p className="text-sm text-[#627d98]">系统运行</p><h2 className="mt-1 text-xl font-semibold">实时业务数据</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><AdminMetric label="假订单" value={String(snapshot.orders.length)} note="每个浏览器会话独立" /><AdminMetric label="办理任务" value={String(snapshot.cases.length)} note="状态变更写入数据库" /><AdminMetric label="浏览器任务" value={String(snapshot.browserJobs.length)} note="仅隔离模拟" /><AdminMetric label="审计事件" value={String(snapshot.auditEvents.length)} note="倒序显示最近 80 条" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">D1 假数据</p><h2 className="mt-1 font-semibold">订单状态与手机号测试集</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[#f8fbfd] text-xs text-[#627d98]"><tr>{["来源", "订单号", "手机号", "日期", "房型", "订单状态", "房间"].map((name) => <th key={name} className="px-5 py-3 font-medium">{name}</th>)}</tr></thead><tbody>{snapshot.orders.map((order) => <tr key={order.id} className="border-t border-[#edf2f7]"><td className="px-5 py-3 font-medium">{order.source}</td><td className="px-5 py-3 font-mono text-xs">{order.order_code}</td><td className="px-5 py-3">{order.phone_masked}</td><td className="px-5 py-3">{order.stay_date}</td><td className="px-5 py-3">{order.room_type}</td><td className="px-5 py-3"><StatusPill value={order.status} /></td><td className="px-5 py-3">{order.room_number ?? "—"}</td></tr>)}</tbody></table></div></section>
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eef3] px-5 py-4"><div><p className="text-sm text-[#627d98]">AI 决策链回放</p><h2 className="mt-1 font-semibold">表达 → 意图 → 计划 → 策略 → 工具 → 回执</h2></div><button type="button" onClick={() => void loadAiChain()} disabled={aiChainBusy} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm disabled:opacity-50">{aiChainBusy ? "读取中…" : "读取当前会话"}</button></div>{aiChain ? <div className="grid gap-4 p-5 lg:grid-cols-2"><div className="rounded-xl bg-[#f8fbfd] p-4"><p className="text-xs uppercase tracking-[.14em] text-[#829ab1]">理解（意图）</p><div className="mt-2 space-y-2">{aiChain.intents.length ? aiChain.intents.map((item, index) => <div key={`${item.created_at}-${index}`} className="text-xs leading-5"><p className="text-[#334e68]">“{item.raw_text_redacted}”</p><p className="text-[#627d98]">{item.intent} · 置信度 {item.confidence ?? "—"} · {item.source}</p></div>) : <p className="text-xs text-[#829ab1]">暂无记录</p>}</div></div><div className="rounded-xl bg-[#f8fbfd] p-4"><p className="text-xs uppercase tracking-[.14em] text-[#829ab1]">计划与策略</p><div className="mt-2 space-y-2">{aiChain.plans.map((item, index) => <div key={`plan-${item.created_at}-${index}`} className="text-xs leading-5"><p className="text-[#334e68]">{item.status}</p><p className="font-mono text-[10px] text-[#829ab1]">{(item.plan_json ?? "").slice(0, 120)}</p></div>)}{aiChain.policyDecisions.map((item, index) => <div key={`${item.created_at}-${index}`} className="text-xs leading-5"><p className="text-[#334e68]">{item.action} · 风险 {item.risk_level}</p><p className="text-[#627d98]">{item.decision} — {item.reason}</p></div>)}</div></div><div className="rounded-xl bg-[#f8fbfd] p-4"><p className="text-xs uppercase tracking-[.14em] text-[#829ab1]">工具与回执</p><div className="mt-2 space-y-2">{aiChain.toolCalls.length ? aiChain.toolCalls.map((item, index) => <div key={`${item.created_at}-${index}`} className="text-xs leading-5"><p className="text-[#334e68]">{item.tool_name} · <span className={item.status === "SUCCEEDED" ? "text-[#248a4d]" : item.status === "PROPOSED" ? "text-[#1769aa]" : "text-[#b63d13]"}>{item.status}</span></p><p className="font-mono text-[10px] text-[#829ab1]">{item.result_json ? item.result_json.slice(0, 120) : "等待回执"}</p></div>) : <p className="text-xs text-[#829ab1]">暂无工具调用</p>}</div></div><div className="rounded-xl bg-[#f8fbfd] p-4"><p className="text-xs uppercase tracking-[.14em] text-[#829ab1]">工作流</p>{aiChain.workflow ? <div className="mt-2 space-y-1 text-xs leading-5 text-[#627d98]"><p>状态：{aiChain.workflow.status} · 当前步骤：{aiChain.workflow.current_step ?? "—"}</p><p>最后更新：{new Date(aiChain.workflow.updated_at).toLocaleString("zh-CN")}</p><p className="font-mono text-[10px]">{aiChain.workflow.id}</p></div> : <p className="mt-2 text-xs text-[#829ab1]">该会话还没有 AI 记录</p>}</div></div> : <p className="p-5 text-sm text-[#627d98]">点击“读取当前会话”，查看这位客人的完整 AI 决策链。</p>}</section><section className="rounded-2xl border border-[#f3d9c0] bg-white shadow-sm"><div className="border-b border-[#f6e6d5] px-5 py-4"><p className="text-sm text-[#8a5b1d]">人工接管</p><h2 className="mt-1 font-semibold">待处理人工任务</h2></div><div className="divide-y divide-[#fdf1e6]">{snapshot.manualTasks.length ? snapshot.manualTasks.map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-sm font-medium">{task.department} · {task.status === "open" ? "待处理" : task.status}</p><p className="mt-1 text-xs leading-5 text-[#627d98]">{task.reason}</p><p className="mt-1 font-mono text-[10px] text-[#9fb3c8]">命令 {task.command_id ? task.command_id.slice(0, 8) : "—"} · 任务 {task.case_id.slice(0, 8)}</p></div><span className="rounded-full bg-[#fff1e5] px-3 py-1 text-xs text-[#8a5b1d]">{new Date(task.created_at).toLocaleString("zh-CN")}</span></div>) : <Empty text="当前没有待处理的人工任务" />}</div></section><section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">办理任务</p><h2 className="mt-1 font-semibold">数据库状态机</h2></div><div className="divide-y divide-[#edf2f7]">{snapshot.cases.length ? snapshot.cases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-mono text-xs text-[#627d98]">{item.id.slice(0, 12)}… · v{item.version}</p><p className="mt-1 text-sm">房间 {item.room_number ?? "未锁定"} · 硬件 {item.hardware_status}</p></div><StatusPill value={item.status} /></div>) : <Empty text="尚无办理任务" />}</div></section>
        <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">不可篡改式演示记录</p><h2 className="mt-1 font-semibold">最近审计事件</h2></div><div className="max-h-[430px] divide-y divide-[#edf2f7] overflow-y-auto">{snapshot.auditEvents.length ? snapshot.auditEvents.map((event) => <div key={event.id} className="px-5 py-4"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{event.event_type}</p><span className="font-mono text-[10px] text-[#829ab1]">#{event.id}</span></div><p className="mt-1 text-xs leading-5 text-[#627d98]">{event.detail}</p><p className="mt-1 text-[10px] text-[#9fb3c8]">{new Date(event.created_at).toLocaleString("zh-CN")}</p></div>) : <Empty text="尚无审计事件" />}</div></section></div>
    </div>
    {confirmationCard && <AdminConfirmationCardV2 state={confirmationCard} busy={adminActionBusy} onOpen={() => { if (confirmationCard.status === "AWAITING_CONFIRMATION") setConfirmActionOpen(true); }} onCancel={() => { if (pendingAdminAction) void cancelPendingAdminAction(); }} onRetry={() => retryConfirmation(confirmationCard.action)} onAudit={() => void loadAuditDetails(confirmationCard.action.actionId)} onEdit={(action) => { setPendingAdminAction(action); setPendingActionDirty(true); setConfirmationCard((current) => current ? { ...current, action } : current); }} auditBusy={auditDetailsBusy} />}
    {auditDetails && <AdminAuditDetailPanel events={auditDetails} onClose={() => setAuditDetails(null)} />}
    <AlertDialog open={confirmActionOpen} onOpenChange={(open) => { if (!adminActionBusy) setConfirmActionOpen(open); }}>
      <AlertDialogContent className="border-[#cfe0f2] p-0 text-[#102a43]">
        <AlertDialogHeader className="border-b border-[#e8eef3] bg-[#f7fbff] p-6 text-left">
          <p className="text-xs font-medium uppercase tracking-[.16em] text-[#1769aa]">管理员确认</p>
          <AlertDialogTitle className="mt-2 text-xl">{pendingAdminAction?.title ?? "确认执行该操作吗？"}</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[#627d98]">请核对下面的脱敏信息。点击确认后，系统才会调用受控工具；在此之前不会修改任何业务数据。</AlertDialogDescription>
        </AlertDialogHeader>
        {pendingAdminAction && <div className="grid gap-3 p-6 text-sm"><div className="rounded-2xl border border-[#d9e2ec] bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-[#829ab1]">客人手机号</p><p className="mt-1 font-medium">{pendingAdminAction.phone}</p></div><div><p className="text-xs text-[#829ab1]">订单号</p><p className="mt-1 font-mono text-xs">{pendingAdminAction.orderCode || "已匹配订单"}</p></div><div><p className="text-xs text-[#829ab1]">风险等级</p><p className={pendingAdminAction.riskLevel === "high" ? "mt-1 font-semibold text-[#b63d13]" : "mt-1 font-semibold text-[#1769aa]"}>{pendingAdminAction.riskLevel === "high" ? "高" : "中"}</p></div><div><p className="text-xs text-[#829ab1]">需要权限</p><p className="mt-1 font-mono text-xs">{pendingAdminAction.requiredPermission}</p></div>{pendingAdminAction.fields.map((field) => <div key={`${field.label}-${field.value}`}><p className="text-xs text-[#829ab1]">{field.label}</p><p className="mt-1 font-medium">{field.value}</p></div>)}</div></div><div className="rounded-xl bg-[#fff8e7] px-4 py-3 text-xs leading-5 text-[#8a6417]">操作原因：{pendingAdminAction.reason}<br />确认单有效期至：{pendingAdminAction.expiresAt ? new Date(pendingAdminAction.expiresAt).toLocaleString("zh-CN") : "5分钟内"}</div><div className="rounded-xl bg-[#f5f8fb] px-4 py-3 text-xs leading-6 text-[#334e68]">{pendingAdminAction.impacts.length ? pendingAdminAction.impacts.map((impact) => <p key={impact}>· {impact}</p>) : <p>· 系统将执行受控工具并写入管理员审计。</p>}</div></div>}
        <AlertDialogFooter className="border-t border-[#e8eef3] p-6 sm:justify-end"><AlertDialogCancel disabled={adminActionBusy} onClick={(event) => { event.preventDefault(); void cancelPendingAdminAction(); }} className="rounded-xl border-[#cbd9e5]">{pendingAdminAction?.cancelLabel ?? "取消"}</AlertDialogCancel><AlertDialogAction disabled={adminActionBusy} onClick={(event) => { event.preventDefault(); void executePendingAdminAction(); }} className="rounded-xl bg-[#007aff]">{adminActionBusy ? "处理中…" : pendingAdminAction?.confirmLabel ?? "确认执行"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {confirmReset && <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="dialog" aria-modal="true" aria-labelledby="reset-title"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#b63d13]">需要确认</p><h2 id="reset-title" className="mt-2 text-xl font-semibold">重置本次演示数据？</h2></div><button onClick={() => setConfirmReset(false)} aria-label="关闭"><X size={19} /></button></div><p className="mt-4 text-sm leading-6 text-[#627d98]">当前浏览器会话的办理任务、浏览器任务和审计记录会被删除，假订单恢复到初始状态。不会影响其他会话。</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setConfirmReset(false)} className="rounded-xl border border-[#cbd9e5] px-4 py-2.5 text-sm">取消</button><button onClick={() => void resetData()} disabled={resetting} className="rounded-xl bg-[#b63d13] px-4 py-2.5 text-sm text-white disabled:opacity-50">{resetting ? "重置中…" : "确认重置"}</button></div></section></div>}
    <AdminCharts sourceData={orderSourceData} statusData={orderStatusData} roomData={roomStatusData} caseData={caseStatusData} auditData={auditTrendData} result={adminResult} status={adminReply} suggestionRoom={suggestionRoom} onSuggestionRoomChange={setSuggestionRoom} onPrepareSuggestion={(command) => void submitAdminCommand(command)} onMarkRoomClean={(roomNumber) => void markAdminRoomClean(roomNumber)} />
  </main>;
}

function AdminVoiceInputControls({ adapter, onText, onListeningChange, onLatency, submitSignal = 0, retrySignal = 0, onPipelineStage }: { adapter: AdapterConfig; onText: (text: string) => void; onListeningChange?: (listening: boolean) => void; onLatency?: (latencyMs: number) => void; submitSignal?: number; retrySignal?: number; onPipelineStage?: (stage: "mic" | "asr", status: PipelineStageStatus, detail?: string, latencyMs?: number) => void }) {
  const [inputs, setInputs] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => typeof window !== "undefined" ? localStorage.getItem("hotel_admin_audio_input_device") || "" : "");
  const [listening, setListening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [backend, setBackend] = useState<"local" | "browser" | "unavailable" | "connecting">("connecting");
  const [status, setStatus] = useState("正在检查输入设备…");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorFrameRef = useRef<number | null>(null);
  const audioTailRef = useRef(Promise.resolve());
  const resultSeenRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);
  const latestTextRef = useRef("");
  const recordingStartedAtRef = useRef(0);
  const firstResultAtRef = useRef(0);
  const submitAfterStopRef = useRef(false);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setStatus("当前浏览器不支持输入设备枚举"); return; }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const next = devices.filter((device) => device.kind === "audioinput").map((device, index) => ({ deviceId: device.deviceId, label: device.label || `麦克风 ${index + 1}` }));
    setInputs(next);
    if (selectedDeviceId && !next.some((device) => device.deviceId === selectedDeviceId)) {
      setSelectedDeviceId("");
      localStorage.removeItem("hotel_admin_audio_input_device");
    }
    if (!next.length) setStatus("没有检测到麦克风");
    else if (!listening && !stopping) setStatus(`已检测到 ${next.length} 个输入设备`);
  }, [listening, selectedDeviceId, stopping]);
  useEffect(() => {
    queueMicrotask(() => { void refreshDevices(); });
    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => { void refreshDevices(); };
    mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => { mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange); };
  }, [refreshDevices]);
  function stopMonitor() {
    if (monitorFrameRef.current !== null) window.cancelAnimationFrame(monitorFrameRef.current);
    monitorFrameRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
  }
  function monitor(stream: MediaStream) {
    stopMonitor();
    const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    const context = new Constructor();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const centered = (sample - 128) / 128; sum += centered * centered; }
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 8));
      monitorFrameRef.current = window.requestAnimationFrame(loop);
    };
    void context.resume().catch(() => undefined);
    monitorFrameRef.current = window.requestAnimationFrame(loop);
  }
  function release() {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder) recorder.onstop = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopMonitor();
    if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) socketRef.current.close();
    socketRef.current = null;
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    setListening(false);
    setStopping(false);
  }
  function acceptText(text: string, final = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    latestTextRef.current = trimmed;
    onText(trimmed);
    markFirstResult();
    // eslint-disable-next-line react-hooks/purity -- 事件回调中计算语音延迟
    if (final && recordingStartedAtRef.current) { const elapsed = Math.round(Date.now() - recordingStartedAtRef.current); setLatencyMs(elapsed); onLatency?.(elapsed); onPipelineStage?.("asr", "normal", `已识别 ${elapsed}ms`, elapsed); }
  }
  function markFirstResult() {
    if (firstResultAtRef.current || !recordingStartedAtRef.current) return;
    firstResultAtRef.current = Date.now();
    const elapsed = Math.round(firstResultAtRef.current - recordingStartedAtRef.current);
    onPipelineStage?.("asr", "normal", `首字 ${elapsed}ms`, elapsed);
  }
  function maybeSubmitRecognizedText() {
    const text = latestTextRef.current.trim();
    const shouldSubmit = submitAfterStopRef.current;
    submitAfterStopRef.current = false;
    // 语音结果只回填输入框，不自动提交；管理员可以先修正尾号、房号和金额。
    if (shouldSubmit && text) setStatus("语音已识别，请检查文字后点击发送");
    return false;
  }
  function finishRecording(shouldSubmit: boolean) {
    if (stopping) return;
    if (!listening) {
      if (shouldSubmit) maybeSubmitRecognizedText();
      return;
    }
    submitAfterStopRef.current = false;
    setStatus("正在整理管理员语音，完成后请检查文字…");
    if (backend === "browser") {
      setStopping(true);
      recognitionRef.current?.stop?.();
      return;
    }
    const recorder = recorderRef.current;
    const socket = socketRef.current;
    setStopping(true);
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => { void audioTailRef.current.then(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" })); }); };
      recorder.stop();
    } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    // Qwen ASR 服务端需要先解码完整音频，再执行模型推理；3060/CPU fallback
    // 的耗时可能超过几秒。不能像旧逻辑一样 4.5 秒就关闭 socket，否则最终结果会被丢弃。
    stopTimerRef.current = window.setTimeout(() => {
      const hadText = latestTextRef.current.trim();
      if (!hadText) onPipelineStage?.("asr", "timeout", "本地语音识别超时");
      release();
      setStatus(hadText ? "语音已识别，请确认文字后点击发送" : "本地语音识别超时，请重新录音或输入文字");
      if (hadText) maybeSubmitRecognizedText();
      else submitAfterStopRef.current = false;
    }, 25000);
  }
  function startBrowser() {
    const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) { setBackend("unavailable"); setStatus("浏览器不支持语音识别，请直接输入文字"); return; }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    // 管理后台也要和用户端一样支持停顿后继续说；真正结束由“结束并发送”触发。
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let text = "";
      let allFinal = true;
      for (let index = 0; index < event.results.length; index += 1) { const item = event.results[index]; text += item?.[0]?.transcript ?? ""; if (!item?.isFinal) allFinal = false; }
      if (text.trim()) acceptText(text, allFinal);
    };
    recognition.onerror = (event) => {
      const errorCode = String(event?.error || "");
      if (submitAfterStopRef.current) {
        // stop() 后浏览器可能先触发 error 再触发 end；保留提交标记，交给 onend 收尾。
        setStatus("正在整理浏览器语音…");
        return;
      }
      if (["no-speech", "aborted"].includes(errorCode)) {
        setStatus("暂时没有听清，请继续说");
        return;
      }
      setStopping(false);
      setListening(false);
      recognitionRef.current = null;
      setStatus("浏览器备用识别失败，请检查麦克风权限或直接输入文字");
    };
    recognition.onend = () => {
      const hadText = latestTextRef.current.trim();
      if (!submitAfterStopRef.current && recognitionRef.current === recognition) {
        // Edge 会在短暂停顿时结束一次识别；自动续接，避免后台只收到半句话。
        window.setTimeout(() => {
          if (recognitionRef.current !== recognition || submitAfterStopRef.current) return;
          try { recognition.start(); } catch { setStatus("语音通道正在恢复，请继续说"); }
        }, 120);
        return;
      }
      setStopping(false);
      setListening(false);
      if (!maybeSubmitRecognizedText()) setStatus(hadText ? "语音已识别，请确认文字后点击发送" : "没有识别到内容，请重新录音或输入文字");
    };
    recognitionRef.current = recognition;
    setBackend("browser");
    setListening(true);
    setStatus("浏览器备用识别已开启，说完后点击发送");
    recognition.start();
  }
  async function startLocal() {
    if (!window.isSecureContext) throw new Error("secure_context_required");
    if (!adapter.asrWsUrl || typeof WebSocket === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("local_asr_unavailable");
    const audio: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (selectedDeviceId) audio.deviceId = { exact: selectedDeviceId };
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
    catch (error) {
      if (!selectedDeviceId) throw error;
      setSelectedDeviceId("");
      localStorage.removeItem("hotel_admin_audio_input_device");
      setStatus("所选麦克风不可用，正在切换默认设备…");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    streamRef.current = stream;
    monitor(stream);
    onPipelineStage?.("mic", "normal", "麦克风已就绪");
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(resolveAsrWebSocketUrl(adapter.asrWsUrl));
      socketRef.current = socket;
      const timer = window.setTimeout(() => { socket.close(); reject(new Error("local_asr_timeout")); }, 3000);
      socket.onopen = () => { window.clearTimeout(timer); resolve(); };
      socket.onerror = () => { window.clearTimeout(timer); reject(new Error("local_asr_socket_error")); };
    });
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("local_asr_socket_error");
    resultSeenRef.current = false;
    audioTailRef.current = Promise.resolve();
    socket.onmessage = (event) => {
      let payload: AsrSocketMessage;
      try { payload = JSON.parse(String(event.data)) as AsrSocketMessage; } catch { return; }
      if (payload.type === "ready") { setStatus(`本地 Qwen ASR 已就绪${payload.device ? ` · ${payload.device}` : ""}，请说话`); onPipelineStage?.("asr", "normal", "ASR 已就绪"); }
      if (payload.type === "result" && payload.text?.trim()) {
        resultSeenRef.current = true;
        const final = payload.is_final !== false;
        acceptText(payload.text.trim(), final);
        if (final) { release(); if (!maybeSubmitRecognizedText()) setStatus("语音已识别，请确认文字后点击发送"); }
      }
      if (payload.type === "error") { submitAfterStopRef.current = false; setStatus(payload.message || "本地 ASR 返回错误"); onPipelineStage?.("asr", "failed", payload.message || "ASR 返回错误"); release(); }
    };
    socket.onclose = () => { if (!resultSeenRef.current && recorderRef.current) { setStatus("本地 ASR 连接中断，请重试或改用文字"); onPipelineStage?.("asr", "failed", "ASR 连接中断"); setListening(false); } };
    socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const chunk = event.data;
      audioTailRef.current = audioTailRef.current.then(async () => { const buffer = await chunk.arrayBuffer(); if (socket.readyState === WebSocket.OPEN) socket.send(buffer); }).catch(() => undefined);
    };
    recorder.onerror = () => { setStatus("无法读取所选麦克风，请检查设备"); onPipelineStage?.("mic", "failed", "麦克风不可读"); release(); };
    recorder.start(250);
    setBackend("local");
    setListening(true);
  }
  function toggle() {
    if (stopping) return;
    if (listening) {
      submitAfterStopRef.current = false;
      release();
      setStatus("已取消本次管理员语音输入");
      onPipelineStage?.("mic", "cancelled", "已取消录音");
      onPipelineStage?.("asr", "cancelled", "已取消识别");
      return;
    }
    latestTextRef.current = "";
    recordingStartedAtRef.current = performance.now();
    firstResultAtRef.current = 0;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    submitAfterStopRef.current = false;
    setBackend("connecting");
    setStatus("正在连接所选输入设备和本地 ASR…");
    onPipelineStage?.("mic", "connecting", "正在请求麦克风");
    onPipelineStage?.("asr", "connecting", "正在连接本地 ASR");
    void startLocal().catch((error) => { release(); if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) { setBackend("unavailable"); setStatus("麦克风权限被拒绝，请在地址栏允许麦克风"); return; } setStatus("本地 ASR 不可用，已切换浏览器备用识别"); startBrowser(); });
  }
  useEffect(() => { onListeningChange?.(listening); }, [listening, onListeningChange]);
  useEffect(() => {
    if (submitSignal <= 0) return undefined;
    const timer = window.setTimeout(() => finishRecording(false), 0);
    return () => window.clearTimeout(timer);
    // finishRecording 使用当前录音资源句柄，不能放入依赖导致录音过程中重复绑定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitSignal]);
  useEffect(() => {
    if (retrySignal <= 0) return undefined;
    const timer = window.setTimeout(() => {
      latestTextRef.current = "";
      onText("");
      if (!listening) toggle();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrySignal]);
  // release 仅用于组件卸载清理，避免把每次录音状态变化带入订阅依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => release(), []);
  const selectedLabel = inputs.find((device) => device.deviceId === selectedDeviceId)?.label || "系统默认麦克风";
  return <div className="flex flex-wrap items-center gap-2"><select value={selectedDeviceId} onChange={(event) => { const value = event.target.value; setSelectedDeviceId(value); localStorage.setItem("hotel_admin_audio_input_device", value); setStatus(value ? "已选择管理员输入设备" : "已恢复系统默认麦克风"); }} className="max-w-[190px] rounded-xl border border-[#cbd9e5] bg-[#f8fbfd] px-3 py-3 text-xs" aria-label="管理员输入设备"><option value="">系统默认麦克风</option>{inputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select><button type="button" onClick={toggle} disabled={stopping} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-[#ff3b30] text-white" : "bg-[#eef4f9] text-[#102a43]"}`} aria-label={listening ? "取消管理员语音输入" : "开始管理员语音输入"}>{listening ? <X size={18} /> : <Mic size={18} />}</button><span className="min-w-[180px] text-xs text-[#627d98]">{status} · {selectedLabel}{latencyMs !== null && <span className="ml-1 text-[#1769aa]">· {latencyMs}ms</span>}{listening && <span className="ml-2 inline-block h-1.5 w-12 overflow-hidden rounded-full bg-[#e5e5ea] align-middle"><span className="block h-full bg-[#34c759]" style={{ width: `${Math.max(5, Math.round(level * 100))}%` }} /></span>}</span><span className="sr-only">当前语音后端：{backend}</span></div>;
}

function AdminPipeline({ stages }: { stages: PipelineStageState[] }) {
  const dotClass: Record<PipelineStageStatus, string> = {
    idle: "bg-[#cbd9e5]",
    connecting: "animate-pulse bg-[#ff9500]",
    normal: "bg-[#34c759]",
    timeout: "bg-[#ff3b30]",
    failed: "bg-[#ff3b30]",
    cancelled: "bg-[#8e8e93]",
  };
  const statusLabel: Record<PipelineStageStatus, string> = { idle: "未开始", connecting: "连接中", normal: "正常", timeout: "超时", failed: "失败", cancelled: "已取消" };
  return <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#e8eef3] bg-[#f8fbfd] px-4 py-3">{stages.map((stage, index) => <div key={stage.id} className="flex items-center gap-2">{index > 0 && <span className="text-[#cbd9e5]">→</span>}<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm"><span className={`h-2 w-2 rounded-full ${dotClass[stage.status]}`} /><span className="font-medium text-[#334e68]">{stage.label}</span><span className="text-[#627d98]">{stage.detail ?? statusLabel[stage.status]}</span></span></div>)}</div>;
}

type AdminChartDatum = { name: string; value: number };

function AdminConfirmationCardV2({ state, busy, onOpen, onCancel, onRetry, onAudit, onEdit, auditBusy }: { state: AdminConfirmationCardState; busy: boolean; onOpen: () => void; onCancel: () => void; onRetry: () => void; onAudit: () => void; onEdit: (action: PendingAdminAction) => void; auditBusy: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.action.fields);
  const [lastActionId, setLastActionId] = useState(state.action.actionId);
  const [editError, setEditError] = useState("");
  if (lastActionId !== state.action.actionId) {
    setLastActionId(state.action.actionId);
    setDraft(state.action.fields);
    setEditError("");
  }
  useEffect(() => { if (state.status !== "AWAITING_CONFIRMATION") return undefined; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [state.status]);
  const expiresAt = state.action.expiresAt ? new Date(state.action.expiresAt).getTime() : 0;
  const remaining = expiresAt ? Math.max(0, expiresAt - now) : null;
  const locallyExpired = state.status === "AWAITING_CONFIRMATION" && remaining !== null && remaining <= 0;
  const status = locallyExpired ? "EXPIRED" : state.status;
  const labels: Record<AdminConfirmationStatus, string> = { AWAITING_CONFIRMATION: "待确认", EXECUTED: "已执行", CANCELLED: "已取消", EXPIRED: "已过期", CONFLICTED: "房态冲突" };
  const statusClass = status === "EXECUTED" ? "bg-[#effaf4] text-[#248a4d]" : status === "AWAITING_CONFIRMATION" ? "bg-[#eaf4ff] text-[#1769aa]" : "bg-[#fff1ed] text-[#b63d13]";
  function saveEdits() {
    const targetField = draft.find((field) => field.label === "目标房间" || (state.action.actionType !== "room_change" && field.label === "房间"));
    if (targetField && !isRoomNumber(targetField.value)) { setEditError("房号必须是3到5位数字"); return; }
    const amountField = draft.find((field) => field.label.includes("金额") || field.label.includes("房费") || field.label.includes("押金"));
    const amount = amountField ? parseAmount(amountField.value) : null;
    if (amountField && (amount === null || !Number.isInteger(amount) || amount < 0 || amount > 99999)) { setEditError("金额必须是0到99999之间的整数"); return; }
    setEditError("");
    const target = targetField?.value.trim();
    const next: PendingAdminAction = { ...state.action, fields: draft, toRoom: state.action.actionType === "room_change" && target ? target : state.action.toRoom, newAmount: amountField ? (amount ?? state.action.newAmount) : state.action.newAmount };
    onEdit(next); setEditing(false);
  }
  return <section className="fixed bottom-5 right-5 z-40 w-[min(620px,calc(100vw-2.5rem))] rounded-2xl border border-[#b9d8f4] bg-[#fbfdff] p-4 shadow-xl" aria-label="管理员确认单"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-[#829ab1]">管理员确认单</p><h3 className="mt-1 text-base font-semibold text-[#102a43]">{state.action.title}</h3></div><span className={`rounded-full px-3 py-1 text-xs ${statusClass}`}>{labels[status]}</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{[...[{ label: "客人", value: state.action.phone }, { label: "订单号", value: state.action.orderCode || "已匹配订单" }], ...draft].map((field, index) => <label key={`${field.label}-${index}`} className="text-xs text-[#829ab1]">{field.label}{editing && index >= 2 ? <input value={field.value} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index - 2 ? { ...item, value: event.target.value } : item))} className="mt-1 w-full rounded-lg border border-[#cbd9e5] bg-white px-3 py-2 text-sm text-[#334e68] outline-none focus:border-[#007aff]" /> : <span className="mt-1 block font-medium text-[#334e68]">{field.value || "—"}</span>}</label>)}</div>{editError && <p className="mt-2 rounded-lg bg-[#fff1ed] px-3 py-2 text-xs text-[#b63d13]">{editError}</p>}<div className="mt-3 rounded-xl bg-[#f5f8fb] px-3 py-2 text-xs leading-5 text-[#627d98]">{status === "AWAITING_CONFIRMATION" && !locallyExpired ? <>有效期至 {state.action.expiresAt ? new Date(state.action.expiresAt).toLocaleString("zh-CN") : "5分钟内"} · 剩余 {remaining === null ? "—" : `${Math.ceil(remaining / 1000)} 秒`}</> : status === "EXPIRED" ? "确认单已过期，系统不会执行，请重新核对并生成。" : status === "CONFLICTED" ? (state.error ?? "目标房间状态已变化，系统未修改业务数据。") : status === "CANCELLED" ? "已取消确认，业务数据未修改。" : "已执行并写入操作审计。"}</div><div className="mt-3 flex flex-wrap gap-2">{state.action.actionType === "purge_closed_loops" ? null : editing ? <><button type="button" onClick={saveEdits} className="rounded-xl bg-[#007aff] px-3 py-2 text-sm font-medium text-white">保存字段</button><button type="button" onClick={() => { setDraft(state.action.fields); setEditing(false); }} className="rounded-xl border border-[#cbd9e5] px-3 py-2 text-sm">取消编辑</button></> : <button type="button" disabled={busy || status !== "AWAITING_CONFIRMATION" || locallyExpired} onClick={() => setEditing(true)} className="rounded-xl border border-[#007aff] px-3 py-2 text-sm text-[#1769aa] disabled:opacity-40">编辑字段</button>}<button type="button" disabled={busy || status !== "AWAITING_CONFIRMATION" || locallyExpired} onClick={onOpen} className="rounded-xl bg-[#007aff] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">查看并确认</button><button type="button" disabled={busy || status !== "AWAITING_CONFIRMATION" || locallyExpired} onClick={onCancel} className="rounded-xl border border-[#cbd9e5] bg-white px-3 py-2 text-sm text-[#334e68] disabled:opacity-40">取消确认</button>{(status === "EXPIRED" || status === "CONFLICTED") && <button type="button" onClick={onRetry} className="rounded-xl border border-[#007aff] px-3 py-2 text-sm text-[#1769aa]">重新核对并生成</button>}<button type="button" disabled={auditBusy} onClick={onAudit} className="rounded-xl border border-[#cbd9e5] bg-white px-3 py-2 text-sm text-[#334e68]">{auditBusy ? "读取审计…" : "查看审计详情"}</button></div></section>;
}

function AdminAuditDetailPanel({ events, onClose }: { events: AdminAuditRecord[]; onClose: () => void }) {
  return <section className="fixed inset-x-5 bottom-5 z-50 mx-auto max-w-3xl rounded-2xl border border-[#d9e2ec] bg-white p-4 shadow-2xl" aria-label="操作审计详情"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-[#829ab1]">操作审计详情</p><h3 className="mt-1 font-semibold text-[#102a43]">确认单完整时间线</h3></div><button type="button" onClick={onClose} className="rounded-lg border border-[#cbd9e5] px-3 py-1.5 text-xs text-[#627d98]">收起</button></div>{events.length ? <div className="mt-3 max-h-[55vh] divide-y divide-[#edf2f7] overflow-y-auto">{events.map((event) => <div key={event.id} className="grid gap-2 py-3 sm:grid-cols-[150px_1fr_auto]"><span className="text-xs text-[#829ab1]">{new Date(event.created_at).toLocaleString("zh-CN")}</span><div><p className="text-sm font-medium text-[#334e68]">{event.event_type}</p><p className="mt-1 text-xs leading-5 text-[#627d98]">{event.detail}</p></div><span className="text-xs text-[#829ab1]">{event.username ?? "系统"}{event.role ? ` · ${event.role}` : ""}</span></div>)}</div> : <p className="mt-4 rounded-xl bg-[#f5f8fb] px-3 py-3 text-sm text-[#627d98]">该确认单暂时没有审计事件。</p>}</section>;
}

function AdminResultPanel({ result, status, suggestionRoom, onSuggestionRoomChange, onPrepareSuggestion, onMarkRoomClean }: { result: AdminResult; status: string; suggestionRoom: string; onSuggestionRoomChange: (value: string) => void; onPrepareSuggestion: (command: string) => void; onMarkRoomClean: (roomNumber: string) => void }) {
  const orders = result?.type === "orders" ? result.orders : [];
  const firstPhone = orders[0] ? String(orders[0].phone_last4 ?? String(orders[0].phone ?? "").replace(/\D/g, "").slice(-4)) : "";
  const workflow = result?.type === "workflow" ? result.workflow : null;
  const workflowSteps: Array<[AdminWorkflowStep, string]> = [["guest_search", "查找客人"], ["guest_selection", "选择订单"], ["room_check", "核对房态"], ["confirmation", "换房确认"], ["executing", "PMS执行"]];
  const selected = workflow?.selectedOrder;
  return <section className="mt-4 overflow-hidden rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf2f7] px-4 py-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-[#829ab1]">管理员工作流</p><p className="mt-1 text-sm text-[#334e68]">{workflow ? workflow.message : status}</p></div><span className={`rounded-full px-3 py-1 text-xs ${workflow?.step === "blocked" ? "bg-[#fff1ed] text-[#b63d13]" : "bg-[#f2f7fb] text-[#627d98]"}`}>{workflow ? "受控流程 · 脱敏" : "查询结果 · 脱敏"}</span></div>{workflow && <div className="p-4"><div className="grid gap-2 sm:grid-cols-5">{workflowSteps.map(([step, label], index) => { const currentIndex = workflowSteps.findIndex(([value]) => value === workflow.step); const done = workflow.step === "completed" || (currentIndex >= 0 && index < currentIndex); const active = workflow.step === step; return <div key={step} className={`rounded-xl border p-3 ${done ? "border-[#bde7cf] bg-[#effaf4]" : active ? "border-[#b9d8f4] bg-[#eaf4ff]" : "border-[#e8eef3] bg-[#fbfdff]"}`}><div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${done ? "bg-[#34c759] text-white" : active ? "bg-[#007aff] text-white" : "bg-[#e5e5ea] text-[#829ab1]"}`}>{done ? <Check size={13} /> : index + 1}</span><span className="text-xs font-medium">{label}</span></div></div>; })}</div>{workflow.step === "guest_selection" && <div className="mt-4"><p className="text-sm font-medium">尾号 {String(workflow.candidates[0]?.phone_last4 ?? "")} 对应多笔订单，请选择一笔</p><div className="mt-3 grid gap-3 md:grid-cols-2">{workflow.candidates.map((order) => { const phone = String(order.phone ?? order.phone_masked ?? `***${order.phone_last4 ?? ""}`); const key = String(order.id ?? order.order_code); return <article key={key} className="rounded-2xl border border-[#e8eef3] bg-[#fbfdff] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#102a43]">{String(order.source ?? "订单")} · {String(order.order_code ?? "未编号")}</p><p className="mt-1 text-xs text-[#627d98]">手机号 {phone} · 房间 {String(order.room_number ?? "未分配")}</p></div><StatusPill value={String(order.status ?? "未知")} /></div><button type="button" onClick={() => onPrepareSuggestion(`__select:${key}`)} className="mt-4 w-full rounded-xl bg-[#007aff] px-3 py-2.5 text-sm font-medium text-white">选择此订单</button></article>; })}</div></div>}{(workflow.step === "room_check" || workflow.step === "confirmation" || workflow.step === "executing" || workflow.step === "completed") && selected && <div className="mt-4 rounded-2xl border border-[#e8eef3] bg-[#fbfdff] p-4"><div className="grid gap-3 sm:grid-cols-2"><AdminDataField label="客人" value={String(selected.guest_label ?? "已脱敏")} /><AdminDataField label="手机号" value={String(selected.phone ?? selected.phone_masked ?? `***${selected.phone_last4 ?? ""}`)} /><AdminDataField label="当前房间" value={String(selected.room_number ?? "未分配")} /><AdminDataField label="目标房间" value={workflow.targetRoom} /></div>{workflow.room && <div className="mt-4 flex items-center justify-between rounded-xl bg-[#f5f8fb] px-3 py-2 text-sm"><span>目标房态：{workflow.room.status === "vacant-clean" ? "空闲可用" : "不可用"}</span><StatusPill value={workflow.room.status} /></div>}{workflow.step === "confirmation" && <button type="button" onClick={() => onPrepareSuggestion("__open_confirmation")} className="mt-4 w-full rounded-xl bg-[#007aff] px-4 py-3 text-sm font-medium text-white">查看确认单并确认修改</button>}{workflow.step === "completed" && <p className="mt-4 rounded-xl bg-[#effaf4] px-3 py-2 text-sm text-[#248a4d]">换房已完成，数据库与审计记录已更新。</p>}</div>}{workflow.step === "blocked" && <div className="mt-4 rounded-xl bg-[#fff8f4] px-4 py-3 text-sm text-[#765444]">流程已停止：{workflow.message}</div>}</div>}{result?.type === "orders" && <div className="p-4">{orders.length ? <div className="grid gap-3 md:grid-cols-2">{orders.map((order) => { const phone = String(order.phone_masked ?? (order.phone_last4 ? `****${order.phone_last4}` : "***")); return <article key={String(order.id ?? order.order_code)} className="rounded-2xl border border-[#e8eef3] bg-[#fbfdff] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#102a43]">{String(order.source ?? "订单")} · {String(order.order_code ?? "未编号")}</p><p className="mt-1 text-xs text-[#627d98]">客人 {String(order.guest_label ?? "已脱敏")} · 手机号 {phone}</p></div><StatusPill value={String(order.status ?? "未知")} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><AdminDataField label="入住日期" value={String(order.stay_date ?? "—")} /><AdminDataField label="房型" value={String(order.room_type ?? "—")} /><AdminDataField label="房间" value={String(order.room_number ?? "未分配")} /><AdminDataField label="晚数/间数" value={`${String(order.nights ?? "—")} 晚 · ${String(order.room_count ?? "—")} 间`} /></dl></article>; })}</div> : <Empty text="没有找到符合条件的客人或订单" />} {firstPhone && <div className="mt-4 rounded-2xl bg-[#f5f8fb] p-4"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eaf4ff] text-[#1769aa]"><Settings2 size={17} /></div><div><p className="text-sm font-medium text-[#334e68]">可执行建议</p><p className="mt-1 text-xs leading-5 text-[#627d98]">建议只生成受控修改草案，确认弹窗通过后才会调用 PMS，不会直接改库。</p></div></div><div className="mt-3 flex flex-wrap items-center gap-2"><input value={suggestionRoom} onChange={(event) => onSuggestionRoomChange(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="目标房号" className="w-28 rounded-xl border border-[#cbd9e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#007aff]" aria-label="建议目标房号" /><button type="button" disabled={!suggestionRoom.trim()} onClick={() => onPrepareSuggestion(`把尾号${firstPhone}换到${suggestionRoom}`)} className="rounded-xl bg-[#007aff] px-3 py-2 text-xs font-medium text-white disabled:opacity-40">生成换房草案</button><button type="button" onClick={() => onPrepareSuggestion(`把尾号${firstPhone}的总金额改成`)} className="rounded-xl border border-[#cbd9e5] bg-white px-3 py-2 text-xs text-[#334e68]">生成金额草案</button></div></div>}</div>}{result?.type === "room" && <div className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-2xl font-semibold tracking-[-.03em] text-[#102a43]">房间 {result.roomNumber}</p><p className="mt-1 text-sm text-[#627d98]">当前状态：{ROOM_STATUS_LABELS[result.status] ?? "未知"}{result.status === "vacant-dirty" ? " · 打扫完成后才会重新参与售卖" : result.status === "occupied" ? " · 已隐藏完整客人信息" : ""}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs ${ROOM_STATUS_TONES[result.status] ?? "bg-[#f2f7fb] text-[#627d98]"}`}>{ROOM_STATUS_LABELS[result.status] ?? "未知"}</span>{result.status === "vacant-dirty" && <button type="button" onClick={() => onMarkRoomClean(result.roomNumber)} className="rounded-xl bg-[#34c759] px-4 py-2 text-sm font-medium text-white">打扫完成，改为可售</button>}</div></div>}</section>;
}

function AdminDataField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[#829ab1]">{label}</dt><dd className="mt-1 font-medium text-[#334e68]">{value}</dd></div>;
}

function AdminCharts({ sourceData, statusData, roomData, caseData, auditData, result, status, suggestionRoom, onSuggestionRoomChange, onPrepareSuggestion, onMarkRoomClean }: { sourceData: AdminChartDatum[]; statusData: AdminChartDatum[]; roomData: AdminChartDatum[]; caseData: AdminChartDatum[]; auditData: AdminChartDatum[]; result: AdminResult; status: string; suggestionRoom: string; onSuggestionRoomChange: (value: string) => void; onPrepareSuggestion: (command: string) => void; onMarkRoomClean: (roomNumber: string) => void }) {
  return <><AdminResultPanel result={result} status={status} suggestionRoom={suggestionRoom} onSuggestionRoomChange={onSuggestionRoomChange} onPrepareSuggestion={onPrepareSuggestion} onMarkRoomClean={onMarkRoomClean} /><section className="mt-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#627d98]">数据概览</p><h2 className="mt-1 text-xl font-semibold tracking-[-.02em]">让状态一眼看懂</h2></div><span className="rounded-full bg-[#f2f7fb] px-3 py-1.5 text-xs text-[#627d98]">数据来自当前演示会话</span></div><div className="mt-4 grid gap-4 lg:grid-cols-3"><ChartCard title="订单来源" subtitle="不同渠道的订单量"><ResponsiveContainer width="100%" height={220}><BarChart data={sourceData} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}><CartesianGrid vertical={false} stroke="#edf2f7" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#829ab1" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#829ab1" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f5f8fb" }} contentStyle={{ borderRadius: 12, border: "1px solid #d9e2ec", fontSize: 12 }} /><Bar dataKey="value" name="订单数" fill="#007aff" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="订单状态" subtitle="待入住、已入住与取消"><ResponsiveContainer width="100%" height={220}><BarChart data={statusData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 4 }}><CartesianGrid horizontal={false} stroke="#edf2f7" /><XAxis type="number" allowDecimals={false} hide /><YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11, fill: "#627d98" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f5f8fb" }} contentStyle={{ borderRadius: 12, border: "1px solid #d9e2ec", fontSize: 12 }} /><Bar dataKey="value" name="订单数" fill="#34c759" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="房态结构" subtitle="按订单与入住状态汇总"><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={roomData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={3}>{roomData.map((item, index) => <Cell key={item.name} fill={["#34c759", "#ff9500", "#d2d2d7"][index % 3]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d9e2ec", fontSize: 12 }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: "#627d98" }} /></PieChart></ResponsiveContainer></ChartCard></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><ChartCard title="办理任务状态" subtitle="状态机当前分布"><ResponsiveContainer width="100%" height={210}><BarChart data={caseData} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}><CartesianGrid vertical={false} stroke="#edf2f7" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: "#829ab1" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#829ab1" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f5f8fb" }} contentStyle={{ borderRadius: 12, border: "1px solid #d9e2ec", fontSize: 12 }} /><Bar dataKey="value" name="任务数" fill="#af52de" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="审计事件序列" subtitle="最近事件按发生顺序排列"><ResponsiveContainer width="100%" height={210}><LineChart data={auditData} margin={{ top: 12, right: 12, left: -20, bottom: 4 }}><CartesianGrid vertical={false} stroke="#edf2f7" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: "#829ab1" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} hide /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d9e2ec", fontSize: 12 }} /><Line type="monotone" dataKey="value" name="事件" stroke="#ff9500" strokeWidth={3} dot={{ r: 3, fill: "#ff9500" }} /></LineChart></ResponsiveContainer></ChartCard></div></section></>;
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <article className="rounded-2xl border border-[#d9e2ec] bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-[#334e68]">{title}</h3><p className="mt-1 text-xs text-[#829ab1]">{subtitle}</p></div><span className="h-2 w-2 rounded-full bg-[#34c759]" aria-hidden="true" /></div><div className="mt-3">{children}</div></article>;
}

function AdminMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><p className="text-sm text-[#627d98]">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs text-[#829ab1]">{note}</p></div>;
}

function ValueMetric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone: "blue" | "violet" | "orange" | "green" }) {
  const tones = { blue: "bg-[#eaf4ff] text-[#1769aa]", violet: "bg-[#f1edff] text-[#6e55b4]", orange: "bg-[#fff1e5] text-[#ad5b16]", green: "bg-[#e8f7ee] text-[#248a4d]" };
  return <article className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><div className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div><p className="mt-5 text-sm font-medium text-[#627d98]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.03em]">{value}</p><p className="mt-2 text-xs leading-5 text-[#829ab1]">{note}</p></article>;
}

function StatusPill({ value }: { value: string }) {
  const safe = value === "cancelled" || value.includes("BLOCKED");
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${safe ? "bg-[#fff1ed] text-[#b63d13]" : "bg-[#e8f7ee] text-[#248a4d]"}`}>{STATUS_LABELS[value] ?? value}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-7 text-center text-sm text-[#829ab1]">{text}</div>;
}
