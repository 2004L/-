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
};

type MatchResponse = {
  outcome: "matched" | "ambiguous" | "not_found" | "already_checked_in" | "cancelled";
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

type AgentResponse = { type: "tool_call"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; implementation: "business_api" | "simulator"; response_hint?: string } | { type: "clarification"; message: string; intent: string; confidence: number } | { type: "assistant_message"; message: string };
type AdminResponse = { type: "tool_call"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; response_hint?: string } | { type: "clarification"; message: string; intent: string; confidence: number } | { type: "assistant_message"; message: string };
type AgentHistoryMessage = { role: "user" | "assistant" | "tool"; content: string };
type TranscriptEntry = { id: string; role: "user" | "assistant" | "tool"; content: string };

type RecognitionResultEvent = {
  resultIndex?: number;
  results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }>;
};
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => RecognitionLike;

type AsrSocketMessage = {
  type: "ready" | "result" | "error";
  text?: string;
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

type PendingAdminChange = {
  actionId: string;
  phone: string;
  fromRoom: string;
  toRoom: string;
  orderCode: string;
  reason: string;
  expiresAt: string;
};

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

const EMPTY_SNAPSHOT: Snapshot = { orders: [], cases: [], browserJobs: [], auditEvents: [] };

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
  return <VoiceTerminal sessionId={sessionId} adapter={adapter} snapshot={snapshot} onRefresh={refresh} onOpenAdmin={() => setView("admin")} />;
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
      await Promise.all(["orders", "rooms", "hold", "checkin", "checkout"].map((name) => fetch(`/api/pms/${name}`, { method: name === "orders" || name === "rooms" ? "GET" : "POST" })));
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

function VoiceTerminal({ sessionId, adapter, snapshot, onRefresh, onOpenAdmin }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; onRefresh: () => Promise<void>; onOpenAdmin: () => void }) {
  const [conversationId, setConversationId] = useState(() => `conv_${crypto.randomUUID().replaceAll("-", "")}`);
  const [last4, setLast4] = useState("");
  const [utterance, setUtterance] = useState("");
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<DemoOrder | null>(null);
  const [checkinCase, setCheckinCase] = useState<CheckinCase | null>(null);
  const [alternatives, setAlternatives] = useState<DemoOrder[]>([]);
  const [walkInDraft, setWalkInDraft] = useState<WalkInDraft | null>(null);
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
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const asrSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const localAsrResultRef = useRef(false);
  const voiceSubmitRequestedRef = useRef(false);
  const asrChunkTailRef = useRef(Promise.resolve());
  const asrAudioBytesRef = useRef(0);
  const asrAudioChunksRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMonitorFrameRef = useRef<number | null>(null);
  const audioSignalSeenRef = useRef(false);
  const browserFinalTranscriptRef = useRef("");
  const browserInterimTranscriptRef = useRef("");
  const submitInFlightRef = useRef<string | null>(null);
  const conversationRef = useRef<AgentHistoryMessage[]>([]);
  const conversationGenerationRef = useRef(0);

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
    startNewConversation("办理下一位");
    setLast4("");
    setUtterance("");
    setPhase("idle");
    setMatchedOrder(null);
    setCheckinCase(null);
    setAlternatives([]);
    setWalkInDraft(null);
    setWalkInRoomTypes([]);
    setWalkInPayment(null);
    setIntentTrace(null);
    setFlowStep(0);
    setFlowError(null);
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
    setTranscript((current) => [...current, { id: crypto.randomUUID(), role: "tool", content: `已开启新的业务对话：${reason}。上一位客人的对话不会用于本次办理。` }].slice(-40));
  }

  function clearVoiceTimer() {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
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
    releaseVoiceResources(true);
  }

  function finishBrowserSubmission() {
    const finalText = [browserFinalTranscriptRef.current, browserInterimTranscriptRef.current].filter(Boolean).join(" ").trim();
    if (finalText) setUtterance(finalText);
    voiceSubmitRequestedRef.current = false;
    releaseVoiceResources(true);
    if (finalText) void submitUtterance(finalText);
    else setMessage("没有听清内容，请再说一次，或直接输入文字");
  }

  function finishListeningAndSubmit() {
    if (!listening) {
      if (utterance.trim()) void submitUtterance();
      return;
    }
    voiceSubmitRequestedRef.current = true;
    setMessage("正在整理语音内容，请稍候…");
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
      setMessage("本地语音服务没有返回结果，请重试或直接输入文字");
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setListening(false);
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
      const timer = window.setTimeout(() => reject(new Error("local_asr_timeout")), 1400);
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
        localAsrResultRef.current = true;
        const transcript = payload.text.trim();
        if (isFillerTranscript(transcript)) {
          voiceSubmitRequestedRef.current = false;
          setUtterance("");
          setAudioCaptureStatus(audioSignalSeenRef.current ? "ok" : "silent");
          releaseVoiceResources(true);
          setMessage(audioSignalSeenRef.current ? "只识别到很短的回应，请完整说出要办理的事情或直接输入文字" : "没有检测到有效麦克风声音，请检查输入设备后再试");
          return;
        }
        setUtterance(transcript);
        releaseVoiceResources(true);
        if (voiceSubmitRequestedRef.current) {
          voiceSubmitRequestedRef.current = false;
          void submitUtterance(transcript);
        } else {
          setMessage("语音已整理完成，确认无误后点击发送");
        }
      } else if (payload.type === "error") {
        setMessage(payload.message || "本地语音识别失败，请再说一次");
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

  async function submitUtterance(value = utterance) {
    const normalized = value.trim();
    if (!normalized) return;
    if (/^(嗯+|啊+|呃+|额+|唉+|哦+)[。！!？?，,、\s]*$/u.test(normalized)) {
      setMessage("我只听到一声回应，请把要办理的事情完整说出来，或直接输入文字");
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
      const agent = await postAgentStream({ session_id: sessionId, conversation_id: conversationId || sessionId, case_id: checkinCase?.id, walk_in_draft_id: walkInDraft?.id, walk_in_draft_status: walkInDraft?.status, messages }, (delta) => {
        streamedText += delta;
        setMessage(streamedText);
      });
      if (generation !== conversationGenerationRef.current) return;
      if (agent.type === "clarification") {
        recordConversation("assistant", agent.message);
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
      const toolLabel = agent.tool_name === "pms.search_order" ? "查询订单" : agent.tool_name === "pms.create_walk_in_draft" ? "创建现场办理草稿" : agent.tool_name === "pms.quote_walk_in" ? "查询房态并报价" : agent.tool_name === "payment.create" ? "生成支付页面" : agent.tool_name === "pms.create_walk_in" ? "创建现场办理单" : agent.tool_name === "hotel.policy_answer" ? "查询门店政策" : agent.tool_name === "device.reader.read_identity" ? "调用读卡器仿真" : agent.tool_name === "device.encoder.read_status" ? "查询发卡机仿真" : "受控业务工具";
      setIntentTrace({ label: toolLabel, confidence: 0.96, action: agent.tool_name });
      let result: IntentResponse;
      if (agent.tool_name === "pms.search_order") {
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
      } else if (agent.tool_name === "hotel.policy_answer") {
        const topic = String(agent.arguments.topic ?? "");
        const answer = topic === "breakfast" ? "早餐时间是早上七点到十点。" : topic === "parking" ? "酒店提供停车服务，具体位置和费用以门店政策为准。" : topic === "payment" ? "押金和支付方式以当前酒店政策为准，AI 不会自行修改金额。" : "退房时间以订单和门店政策为准，如需延迟退房我会先查询房态。";
        recordConversation("tool", `门店政策查询完成：${topic}`);
        setPhase("idle");
        setMessage(answer);
        speak(answer, voiceEnabled);
        await onRefresh();
        return;
      } else if (agent.tool_name === "device.encoder.read_status") {
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
      } else if (result.outcome === "already_checked_in" || result.outcome === "cancelled") {
        setPhase("blocked");
        setAlternatives(result.orders ?? []);
        setMessage(result.outcome === "already_checked_in" ? "该订单已经入住，不能重复办理" : "该订单已经取消，不能继续办理");
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
    } catch {
      setPhase("error");
      setMessage("房型报价暂时失败，请重新选择或联系工作人员。");
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
      let result: { checkinCase: CheckinCase };
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
        result = await postDemo("hold-room", { session_id: sessionId, case_id: caseId, room_number: "1208" }, activeStep);
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
        result = await postDemo("confirm-checkin", { session_id: sessionId, case_id: caseId }, activeStep);
        applyCase(result.checkinCase);
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

  const showEntry = phase === "idle" || phase === "searching";
  return <main className="min-h-screen bg-[#f5f5f7] px-5 py-6 text-[#1d1d1f] md:px-10">
    <header className="mx-auto flex max-w-6xl items-center justify-between"><div><p className="font-semibold tracking-tight">Hotel Agent OS</p><p className="mt-1 text-xs text-[#86868b]">广州示范店 · 数据库演示环境</p></div><div className="flex items-center gap-2"><button onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Volume2 size={14} className="mr-1 inline" />{voiceEnabled ? "语音开启" : "已静音"}</button><button onClick={onOpenAdmin} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Settings2 size={14} className="mr-1 inline" />管理后台</button></div></header>
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col items-center justify-center py-12 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />AI Native 对话 · 您怎么说都可以</div>
      <h1 className="mt-7 max-w-4xl text-4xl font-semibold tracking-[-.055em] md:text-6xl">{activeMessage}</h1>
      <p className="mt-4 text-base text-[#86868b]">系统理解您的意图，再由受控业务接口完成动作。</p>

      {showEntry && audioInputs.length > 1 && <label className="mx-auto mt-5 flex w-fit items-center gap-2 text-xs text-[#86868b]">输入设备<select value={selectedAudioDeviceId} onChange={(event) => { setSelectedAudioDeviceId(event.target.value); if (event.target.value) localStorage.setItem("hotel_audio_input_device", event.target.value); else localStorage.removeItem("hotel_audio_input_device"); }} disabled={listening} className="rounded-lg border border-[#d9d9df] bg-white px-2 py-1 text-xs"><option value="">系统默认麦克风</option>{audioInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>}

      {showEntry && <div className="mt-10 w-full max-w-2xl"><form onSubmit={(event) => { event.preventDefault(); if (listening) finishListeningAndSubmit(); else void submitUtterance(); }} className="flex items-center gap-2 rounded-[1.7rem] bg-white p-2 pl-5 shadow-[0_10px_40px_rgba(0,0,0,.07)]"><MessageSquareText size={20} className="shrink-0 text-[#86868b]" /><input value={utterance} onChange={(event) => setUtterance(event.target.value)} disabled={phase === "searching"} maxLength={200} placeholder="例如：我在平台订了房，帮我查一下订单" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-[#a1a1a6]" aria-label="告诉AI您想办理的事情" /><button type="button" onClick={startListening} disabled={phase === "searching"} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-[#ff3b30]" : "bg-[#f2f2f7] text-[#1d1d1f]"} disabled:opacity-50`} aria-label={listening ? "取消语音输入" : "开始语音输入"}>{listening ? <X size={19} className="text-white" /> : <Mic size={19} />}</button><button type="submit" disabled={(!utterance.trim() && !listening) || phase === "searching"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#007aff] text-white disabled:opacity-30" aria-label={listening ? "结束录音并发送" : "发送"}><ArrowUp size={19} /></button></form><div className="mt-4 flex flex-wrap justify-center gap-2">{SAMPLE_UTTERANCES.map((sample) => <button key={sample} onClick={() => { setUtterance(sample); void submitUtterance(sample); }} disabled={phase === "searching" || listening} className="rounded-full border border-[#d9d9df] bg-white/70 px-3 py-2 text-xs text-[#6e6e73] disabled:opacity-40">{sample}</button>)}</div><p className="mt-3 text-xs text-[#86868b]">{voiceBackend === "local" ? "本地 Qwen3-ASR · 说完后点击发送" : voiceBackend === "browser" ? "浏览器语音识别备用通道 · 说完后点击发送" : voiceBackend === "unavailable" ? "当前环境不支持语音输入 · 可直接打字" : "本地 ASR 优先 · 浏览器识别备用 · 说完后点击发送"}</p>{audioCaptureStatus !== "unknown" && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[#86868b]"><span>麦克风：{audioCaptureStatus === "checking" ? "等待声音" : audioCaptureStatus === "ok" ? `已采到声音${audioDeviceLabel ? ` · ${audioDeviceLabel}` : ""}` : audioCaptureStatus === "silent" ? "未检测到有效声音" : "检测失败"}</span>{listening && <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e5ea]"><span className={`block h-full rounded-full ${audioCaptureStatus === "ok" ? "bg-[#34c759]" : "bg-[#ff9500]"}`} style={{ width: `${Math.max(4, Math.round(audioLevel * 100))}%` }} /></span>}</div>}{intentTrace && <div className="mx-auto mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-[#eaf4ff] px-4 py-2 text-xs text-[#1769aa]"><span>已理解：{intentTrace.label}</span><span className="text-[#7b9bb8]">{Math.round(intentTrace.confidence * 100)}%</span><span className="text-[#7b9bb8]">→ {intentTrace.action}</span></div>}<p className="mt-3 text-xs text-[#86868b]">演示数据仅用于本地验收，支持任意四位尾号输入</p></div>}

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
        <section className="overflow-hidden rounded-[2rem] bg-[#15171a] text-left text-white shadow-sm"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></div><span className="text-[11px] text-[#8e8e93]">设备与登记回执</span></div><div className="p-6">{flowStep >= 6 ? <CreditCard className="text-[#64d2ff]" /> : <MonitorCog className="text-[#64d2ff]" />}<p className="mt-5 text-xs uppercase tracking-[.16em] text-[#8e8e93]">一体化终端 · 自动设备链路</p><h2 className="mt-2 text-xl font-semibold">{flowStep < 4 ? "等待身份与房态核验" : flowStep < 6 ? "模拟住宿登记与入住确认" : flowStep === 6 ? "自动写卡与回读校验" : phase === "complete" ? "证件与房卡均已取走" : "请取走房卡和身份证"}</h2><div className="mt-5 space-y-3 font-mono text-xs text-[#aeaeb2]"><p>identity: {flowStep >= 2 ? "VERIFIED_TOKEN" : "pending"}</p><p>room: {checkinCase?.room_number ?? "pending"}</p><p>receipt: {checkinCase?.police_receipt ?? "pending"}</p><p>card_machine: {checkinCase?.hardware_status ?? "not_started"}</p></div><p className="mt-6 rounded-xl bg-white/5 p-3 text-xs leading-5 text-[#8e8e93]">演示不会连接真实公安或门锁系统；生产由受控设备适配器执行并返回可审计回执。</p></div></section>
      </div>}

      {phase === "complete" && <section className="mt-6 w-full max-w-3xl rounded-[2rem] border border-[#bde7cf] bg-[#effaf4] p-6"><CircleCheck className="mx-auto text-[#248a4d]" size={30} /><h2 className="mt-3 text-2xl font-semibold">自助入住完成</h2><p className="mt-2 text-sm text-[#52745f]">发卡机已完成写卡、回读和吐卡模拟，传感器确认身份证与房卡均已取走。</p></section>}
      {!showEntry && <button onClick={reset} className="mt-7 inline-flex items-center gap-2 text-sm text-[#6e6e73]"><RefreshCcw size={15} />办理下一位</button>}
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
  const [username, setUsername] = useState("admin-owner-demo");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [faultTarget, setFaultTarget] = useState("reader");
  const [faultType, setFaultType] = useState("reader_timeout");
  const [faults, setFaults] = useState<Array<{ id: string; target: string; fault_type: string; call_count: number; enabled: number }>>([]);
  const [faultMessage, setFaultMessage] = useState("");
  const [adminUtterance, setAdminUtterance] = useState("");
  const [adminReply, setAdminReply] = useState("管理员模式已就绪。您可以说：查询尾号4821，或把尾号4821换到1306。");
  const [adminBusy, setAdminBusy] = useState(false);
  const [pendingAdminActionId, setPendingAdminActionId] = useState<string | null>(null);
  const [pendingAdminChange, setPendingAdminChange] = useState<PendingAdminChange | null>(null);
  const [confirmChangeOpen, setConfirmChangeOpen] = useState(false);
  const [changeActionBusy, setChangeActionBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/admin/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ user?: AdminUser }> : Promise.reject(new Error("auth_required")))
      .then((data) => setAdminUser(data.user ?? null))
      .catch(() => setAdminUser(null))
      .finally(() => setAuthLoading(false));
  }, []);
  const intentEvents = snapshot.auditEvents.filter((event) => event.event_type.startsWith("INTENT_"));
  const completedCases = snapshot.cases.filter((item) => item.status === "CHECKIN_COMPLETE").length;
  const estimatedMinutesSaved = completedCases * 6;
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
  async function executePendingRoomChange() {
    if (!pendingAdminChange || changeActionBusy) return;
    setChangeActionBusy(true);
    try {
      const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.confirm_room_change", arguments: { action_id: pendingAdminChange.actionId, confirmation: "CONFIRM" } }) });
      const data = await response.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "换房执行失败，请重新核对房态");
      const result = data.result ?? {};
      setConfirmChangeOpen(false);
      setPendingAdminActionId(null);
      setPendingAdminChange(null);
      setAdminReply(`换房已执行：${String(result.from_room)} → ${String(result.to_room)}。PMS 已更新，操作已写入审计。`);
      await onRefresh();
    } catch (error) {
      setAdminReply(error instanceof Error ? error.message : "换房执行失败，请转人工核对");
      setConfirmChangeOpen(false);
    } finally { setChangeActionBusy(false); }
  }
  async function cancelPendingRoomChange() {
    if (!pendingAdminChange || changeActionBusy) return;
    setChangeActionBusy(true);
    try {
      const response = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: "admin.cancel_room_change", arguments: { action_id: pendingAdminChange.actionId, reason: "管理员在确认弹窗中取消" } }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "取消换房失败");
      setConfirmChangeOpen(false);
      setPendingAdminActionId(null);
      setPendingAdminChange(null);
      setAdminReply("已取消待确认换房，没有修改 PMS。");
    } catch (error) {
      setAdminReply(error instanceof Error ? error.message : "取消失败，请转人工核对");
      setConfirmChangeOpen(false);
    } finally { setChangeActionBusy(false); }
  }
  async function submitAdminCommand(command = adminUtterance) {
    const text = command.trim();
    if (!text || adminBusy) return;
    setAdminBusy(true);
    try {
      const routed = await fetch("/api/admin/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: text }], pending_action_id: pendingAdminActionId ?? undefined }) });
      const routedData = await routed.json() as { response?: AdminResponse; error?: string };
      if (!routed.ok || !routedData.response) throw new Error(routedData.error ?? "管理员意图识别失败");
      const result = routedData.response;
      if (result.type !== "tool_call") { setAdminReply(result.message); return; }
      const executed = await fetch("/api/admin/tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool_name: result.tool_name, arguments: result.arguments }) });
      const executedData = await executed.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (!executed.ok || !executedData.ok) throw new Error(executedData.error ?? "管理员工具执行失败");
      const toolResult = executedData.result ?? {};
      if (result.tool_name === "admin.search_guest") {
        const orders = (toolResult.orders as Array<Record<string, unknown>> | undefined) ?? [];
        setAdminReply(orders.length ? orders.map((order) => `找到${String(order.source)}订单 ${String(order.order_code)}：客人${String(order.guest_label)}，手机号尾号${String(order.phone).replace(/^\*+/, "")}，房间${String(order.room_number ?? "未分配")}，状态${String(order.status)}`).join("；") : "没有找到符合条件的客人或订单。");
      } else if (result.tool_name === "admin.get_room_status") {
        setAdminReply(toolResult.status === "occupied" ? `房间 ${String(toolResult.room_number)} 当前有人入住，已隐藏完整客人信息。` : `房间 ${String(toolResult.room_number)} 当前空闲，可继续核对。`);
      } else if (result.tool_name === "admin.prepare_room_change") {
        const actionId = String(toolResult.action_id ?? "");
        setPendingAdminActionId(actionId || null);
        setPendingAdminChange({ actionId, phone: String((toolResult.guest as Record<string, unknown> | undefined)?.phone ?? "***未知"), fromRoom: String(toolResult.from_room ?? ""), toRoom: String(toolResult.to_room ?? ""), orderCode: String(toolResult.order_code ?? ""), reason: String(toolResult.reason ?? "管理员换房请求"), expiresAt: String(toolResult.expires_at ?? "") });
        setAdminReply(`换房方案已生成：客人手机号尾号 ${String((toolResult.guest as Record<string, unknown> | undefined)?.phone ?? "")}，${String(toolResult.from_room)} → ${String(toolResult.to_room)}。请核对无误后说“确认执行”，系统会弹出确认窗口，当前没有修改 PMS。`);
      } else if (result.tool_name === "admin.confirm_room_change") {
        if (!pendingAdminChange) throw new Error("确认单已失效，请重新准备换房");
        setConfirmChangeOpen(true);
        setAdminReply("已收到“确认执行”。请在弹窗中核对修改内容，再点击“确认修改”或“取消”。在点击前不会修改 PMS。");
      } else if (result.tool_name === "admin.cancel_room_change") { setPendingAdminActionId(null); setAdminReply("已取消待确认换房，没有修改 PMS。"); }
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
  return <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]"><header className="border-b border-[#d9e2ec] bg-white px-5 py-5 md:px-9"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-[#f3f6f8]" aria-label="返回入住界面"><ArrowLeft size={18} /></button><div><p className="text-sm text-[#627d98]">独立管理后台 · {adminUser.display_name}（{adminUser.role}）</p><h1 className="font-semibold">{adapter.hotelName}</h1></div></div><div className="flex gap-2"><button onClick={() => void onRefresh()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">{loading ? "刷新中…" : "刷新数据"}</button><button onClick={onPairing} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">环境检测</button><button onClick={onReconfigure} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">重新适配</button>{adminUser.permissions.includes("admin:manage_faults") && <button onClick={() => setConfirmReset(true)} className="rounded-lg bg-[#fff1ed] px-3 py-2 text-sm text-[#b63d13]">重置演示数据</button>}<button onClick={() => void logout()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">退出登录</button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 md:p-9"><section className="rounded-2xl border border-[#b9d8f4] bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-[#3b78a8]">管理员 AI Native</p><h2 className="mt-1 text-xl font-semibold">语音指令 → 工具确认 → PMS 执行</h2><p className="mt-1 text-sm text-[#627d98]">管理员可以自然说话；查询会立即返回，换房等写操作先生成确认单。说“确认执行”只会打开确认窗口，点击“确认修改”后才改 PMS。</p></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">{adminUser.role} · 已认证</span></div><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void submitAdminCommand("查询尾号4821")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">查询尾号 4821</button><button type="button" onClick={() => void submitAdminCommand("查询房态1306")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">查询房态 1306</button><button type="button" onClick={() => void submitAdminCommand("把尾号4821换到1306")} className="rounded-full border border-[#d9e2ec] px-3 py-2 text-sm">准备换房</button>{pendingAdminActionId && pendingAdminChange && <button type="button" onClick={() => setConfirmChangeOpen(true)} className="rounded-full bg-[#007aff] px-3 py-2 text-sm text-white">确认修改 {pendingAdminChange.fromRoom} → {pendingAdminChange.toRoom}</button>}</div><form onSubmit={(event) => { event.preventDefault(); void submitAdminCommand(); }} className="mt-4 flex items-center gap-2"><input value={adminUtterance} onChange={(event) => setAdminUtterance(event.target.value)} placeholder="例如：查一下尾号4821，或者把他换到1306" className="min-w-0 flex-1 rounded-xl border border-[#cbd9e5] bg-[#f8fbfd] px-4 py-3 text-sm outline-none focus:border-[#007aff]" aria-label="管理员语音或文字指令" /><AdminVoiceInputControls adapter={adapter} onText={setAdminUtterance} /><button type="submit" disabled={adminBusy || !adminUtterance.trim()} className="rounded-xl bg-[#007aff] px-4 py-3 text-sm text-white disabled:opacity-40">{adminBusy ? "处理中…" : "发送"}</button></form><div className="mt-4 rounded-xl bg-[#f5f8fb] px-4 py-3 text-sm leading-6 text-[#334e68]">{adminReply}</div></section><section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#627d98]">商业价值</p><h2 className="mt-1 text-xl font-semibold">四条价值线</h2></div><span className="rounded-full bg-[#e8eef3] px-3 py-1.5 text-xs text-[#627d98]">演示指标 · 生产接入后替换为真实数据</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ValueMetric icon={<TrendingUp size={20} />} label="收益" value="待接 PMS" note="跟踪 RevPAR、ADR 与增值成交" tone="blue" /><ValueMetric icon={<Users size={20} />} label="人力" value={`${estimatedMinutesSaved} 分钟`} note={`已自动完成 ${completedCases} 笔，按每笔节省6分钟估算`} tone="violet" /><ValueMetric icon={<Clock3 size={20} />} label="响应" value="< 3 秒" note="单路首段语音 P95 目标 · 7×24" tone="orange" /><ValueMetric icon={<FileCheck2 size={20} />} label="合规" value={snapshot.cases.length ? "100%" : "待产生"} note={`${snapshot.auditEvents.length} 条脱敏动作记录`} tone="green" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe0f2] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eef3] px-5 py-4"><div><p className="text-sm text-[#3b78a8]">AI Native</p><h2 className="mt-1 font-semibold">意图识别与动作对齐审计</h2></div><span className="rounded-full bg-[#eaf4ff] px-3 py-1.5 text-xs text-[#1769aa]">只保留脱敏表达</span></div><div className="divide-y divide-[#edf2f7]">{intentEvents.length ? intentEvents.slice(0, 8).map((event) => <div key={event.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]"><div><p className="text-sm leading-6 text-[#334e68]">{event.detail}</p><p className="mt-1 text-xs text-[#9fb3c8]">顾客表达 → 意图 → 置信度 → 受控业务动作</p></div><span className="font-mono text-xs text-[#829ab1]">#{event.id}</span></div>) : <Empty text="与AI说一句话后，这里会显示脱敏的意图识别和动作对齐记录" />}</div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#f0d7b7] bg-[#fffaf4] shadow-sm"><div className="border-b border-[#f3e3cd] px-5 py-4"><p className="text-sm text-[#ad6a16]">验收工具</p><h2 className="mt-1 font-semibold">设备与公安仿真器故障开关</h2><p className="mt-1 text-xs leading-5 text-[#8a6a45]">只影响当前会话；每次注入默认只触发一次，失败会自动生成人工任务和审计记录。</p></div><div className="flex flex-wrap items-end gap-3 px-5 py-4"><label className="text-xs text-[#627d98]">目标<select value={faultTarget} onChange={(event) => { const target = event.target.value; setFaultTarget(target); setFaultType(target === "reader" ? "reader_timeout" : target === "encoder" ? "encoder_offline" : "captcha_required"); }} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm"><option value="reader">读卡器</option><option value="encoder">发卡机</option><option value="police">公安浏览器</option></select></label><label className="text-xs text-[#627d98]">故障类型<select value={faultType} onChange={(event) => setFaultType(event.target.value)} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm">{(faultTarget === "reader" ? ["reader_timeout", "reader_offline", "duplicate_read", "identity_mismatch"] : faultTarget === "encoder" ? ["encoder_offline", "write_failed", "readback_mismatch", "output_jammed", "card_not_collected", "encoder_timeout"] : ["captcha_required", "system_maintenance", "certificate_error", "submission_rejected", "receipt_lost", "police_timeout"]).map((fault) => <option key={fault} value={fault}>{fault}</option>)}</select></label><button onClick={() => void configureFault()} className="rounded-lg bg-[#b66a16] px-4 py-2 text-sm text-white">注入一次</button><button onClick={() => void resetFaults()} className="rounded-lg border border-[#e3c79e] bg-white px-4 py-2 text-sm text-[#8a5b1d]">恢复正常</button>{faultMessage && <span className="text-xs text-[#8a6a45]">{faultMessage}</span>}</div><div className="border-t border-[#f3e3cd] px-5 py-3 text-xs text-[#8a6a45]">{faults.filter((fault) => fault.enabled).length ? faults.filter((fault) => fault.enabled).map((fault) => <span key={fault.id} className="mr-2 inline-flex rounded-full bg-white px-2.5 py-1">{fault.target}/{fault.fault_type} · 已调用 {fault.call_count} 次</span>) : "当前没有启用的故障"}</div></section>
      <section className="mt-7"><p className="text-sm text-[#627d98]">系统运行</p><h2 className="mt-1 text-xl font-semibold">实时业务数据</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><AdminMetric label="假订单" value={String(snapshot.orders.length)} note="每个浏览器会话独立" /><AdminMetric label="办理任务" value={String(snapshot.cases.length)} note="状态变更写入数据库" /><AdminMetric label="浏览器任务" value={String(snapshot.browserJobs.length)} note="仅隔离模拟" /><AdminMetric label="审计事件" value={String(snapshot.auditEvents.length)} note="倒序显示最近 80 条" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">D1 假数据</p><h2 className="mt-1 font-semibold">订单状态与手机号测试集</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[#f8fbfd] text-xs text-[#627d98]"><tr>{["来源", "订单号", "手机号", "日期", "房型", "订单状态", "房间"].map((name) => <th key={name} className="px-5 py-3 font-medium">{name}</th>)}</tr></thead><tbody>{snapshot.orders.map((order) => <tr key={order.id} className="border-t border-[#edf2f7]"><td className="px-5 py-3 font-medium">{order.source}</td><td className="px-5 py-3 font-mono text-xs">{order.order_code}</td><td className="px-5 py-3">{order.phone_masked}</td><td className="px-5 py-3">{order.stay_date}</td><td className="px-5 py-3">{order.room_type}</td><td className="px-5 py-3"><StatusPill value={order.status} /></td><td className="px-5 py-3">{order.room_number ?? "—"}</td></tr>)}</tbody></table></div></section>
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">办理任务</p><h2 className="mt-1 font-semibold">数据库状态机</h2></div><div className="divide-y divide-[#edf2f7]">{snapshot.cases.length ? snapshot.cases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-mono text-xs text-[#627d98]">{item.id.slice(0, 12)}… · v{item.version}</p><p className="mt-1 text-sm">房间 {item.room_number ?? "未锁定"} · 硬件 {item.hardware_status}</p></div><StatusPill value={item.status} /></div>) : <Empty text="尚无办理任务" />}</div></section>
        <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">不可篡改式演示记录</p><h2 className="mt-1 font-semibold">最近审计事件</h2></div><div className="max-h-[430px] divide-y divide-[#edf2f7] overflow-y-auto">{snapshot.auditEvents.length ? snapshot.auditEvents.map((event) => <div key={event.id} className="px-5 py-4"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{event.event_type}</p><span className="font-mono text-[10px] text-[#829ab1]">#{event.id}</span></div><p className="mt-1 text-xs leading-5 text-[#627d98]">{event.detail}</p><p className="mt-1 text-[10px] text-[#9fb3c8]">{new Date(event.created_at).toLocaleString("zh-CN")}</p></div>) : <Empty text="尚无审计事件" />}</div></section></div>
    </div>
    <AlertDialog open={confirmChangeOpen} onOpenChange={(open) => { if (!changeActionBusy) setConfirmChangeOpen(open); }}>
      <AlertDialogContent className="border-[#cfe0f2] p-0 text-[#102a43]">
        <AlertDialogHeader className="border-b border-[#e8eef3] bg-[#f7fbff] p-6 text-left">
          <p className="text-xs font-medium uppercase tracking-[.16em] text-[#1769aa]">管理员确认</p>
          <AlertDialogTitle className="mt-2 text-xl">确认修改房间吗？</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[#627d98]">请核对下面的脱敏信息。点击“确认修改”后，系统才会调用 PMS 更新房态；在此之前不会修改任何数据。</AlertDialogDescription>
        </AlertDialogHeader>
        {pendingAdminChange && <div className="grid gap-3 p-6 text-sm"><div className="rounded-2xl border border-[#d9e2ec] bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-[#829ab1]">客人手机号</p><p className="mt-1 font-medium">{pendingAdminChange.phone}</p></div><div><p className="text-xs text-[#829ab1]">订单号</p><p className="mt-1 font-mono text-xs">{pendingAdminChange.orderCode || "已匹配订单"}</p></div><div><p className="text-xs text-[#829ab1]">当前房间</p><p className="mt-1 text-lg font-semibold">{pendingAdminChange.fromRoom}</p></div><div><p className="text-xs text-[#829ab1]">目标房间</p><p className="mt-1 text-lg font-semibold text-[#007aff]">{pendingAdminChange.toRoom}</p></div></div></div><div className="rounded-xl bg-[#fff8e7] px-4 py-3 text-xs leading-5 text-[#8a6417]">操作原因：{pendingAdminChange.reason}<br />确认单有效期至：{pendingAdminChange.expiresAt ? new Date(pendingAdminChange.expiresAt).toLocaleString("zh-CN") : "5分钟内"}</div></div>}
        <AlertDialogFooter className="border-t border-[#e8eef3] p-6 sm:justify-end"><AlertDialogCancel disabled={changeActionBusy} onClick={(event) => { event.preventDefault(); void cancelPendingRoomChange(); }} className="rounded-xl border-[#cbd9e5]">取消</AlertDialogCancel><AlertDialogAction disabled={changeActionBusy} onClick={(event) => { event.preventDefault(); void executePendingRoomChange(); }} className="rounded-xl bg-[#007aff]">{changeActionBusy ? "处理中…" : "确认修改"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {confirmReset && <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="dialog" aria-modal="true" aria-labelledby="reset-title"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#b63d13]">需要确认</p><h2 id="reset-title" className="mt-2 text-xl font-semibold">重置本次演示数据？</h2></div><button onClick={() => setConfirmReset(false)} aria-label="关闭"><X size={19} /></button></div><p className="mt-4 text-sm leading-6 text-[#627d98]">当前浏览器会话的办理任务、浏览器任务和审计记录会被删除，假订单恢复到初始状态。不会影响其他会话。</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setConfirmReset(false)} className="rounded-xl border border-[#cbd9e5] px-4 py-2.5 text-sm">取消</button><button onClick={() => void resetData()} disabled={resetting} className="rounded-xl bg-[#b63d13] px-4 py-2.5 text-sm text-white disabled:opacity-50">{resetting ? "重置中…" : "确认重置"}</button></div></section></div>}
  </main>;
}

function AdminVoiceInputControls({ adapter, onText }: { adapter: AdapterConfig; onText: (text: string) => void }) {
  const [inputs, setInputs] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => typeof window !== "undefined" ? localStorage.getItem("hotel_admin_audio_input_device") || "" : "");
  const [listening, setListening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [backend, setBackend] = useState<"local" | "browser" | "unavailable" | "connecting">("connecting");
  const [status, setStatus] = useState("正在检查输入设备…");
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
  function startBrowser() {
    const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) { setBackend("unavailable"); setStatus("浏览器不支持语音识别，请直接输入文字"); return; }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? "").join("").trim();
      if (text) onText(text);
    };
    recognition.onerror = () => { setListening(false); setStatus("浏览器备用识别失败，请直接输入文字"); };
    recognition.onend = () => setListening(false);
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
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(resolveAsrWebSocketUrl(adapter.asrWsUrl));
      socketRef.current = socket;
      const timer = window.setTimeout(() => { socket.close(); reject(new Error("local_asr_timeout")); }, 1800);
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
      if (payload.type === "ready") setStatus(`本地 Qwen ASR 已就绪${payload.device ? ` · ${payload.device}` : ""}，请说话`);
      if (payload.type === "result" && payload.text?.trim()) {
        resultSeenRef.current = true;
        onText(payload.text.trim());
        setStatus("语音已识别，请确认文字后点击发送");
        release();
      }
      if (payload.type === "error") { setStatus(payload.message || "本地 ASR 返回错误"); release(); }
    };
    socket.onclose = () => { if (!resultSeenRef.current && recorderRef.current) { setStatus("本地 ASR 连接中断，请重试或改用文字"); setListening(false); } };
    socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const chunk = event.data;
      audioTailRef.current = audioTailRef.current.then(async () => { const buffer = await chunk.arrayBuffer(); if (socket.readyState === WebSocket.OPEN) socket.send(buffer); }).catch(() => undefined);
    };
    recorder.onerror = () => { setStatus("无法读取所选麦克风，请检查设备"); release(); };
    recorder.start(250);
    setBackend("local");
    setListening(true);
  }
  function toggle() {
    if (stopping) return;
    if (listening) {
      if (backend === "browser") { recognitionRef.current?.stop(); setListening(false); return; }
      const recorder = recorderRef.current;
      const socket = socketRef.current;
      setStopping(true);
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = () => { void audioTailRef.current.then(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" })); }); };
        recorder.stop();
      } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      stopTimerRef.current = window.setTimeout(() => { release(); setStatus("语音已结束，请确认文字后点击发送"); }, 4500);
      return;
    }
    setBackend("connecting");
    setStatus("正在连接所选输入设备和本地 ASR…");
    void startLocal().catch((error) => { release(); if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) { setBackend("unavailable"); setStatus("麦克风权限被拒绝，请在地址栏允许麦克风"); return; } setStatus("本地 ASR 不可用，已切换浏览器备用识别"); startBrowser(); });
  }
  // release 仅用于组件卸载清理，避免把每次录音状态变化带入订阅依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => release(), []);
  const selectedLabel = inputs.find((device) => device.deviceId === selectedDeviceId)?.label || "系统默认麦克风";
  return <div className="flex flex-wrap items-center gap-2"><select value={selectedDeviceId} onChange={(event) => { const value = event.target.value; setSelectedDeviceId(value); localStorage.setItem("hotel_admin_audio_input_device", value); setStatus(value ? "已选择管理员输入设备" : "已恢复系统默认麦克风"); }} className="max-w-[190px] rounded-xl border border-[#cbd9e5] bg-[#f8fbfd] px-3 py-3 text-xs" aria-label="管理员输入设备"><option value="">系统默认麦克风</option>{inputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select><button type="button" onClick={toggle} disabled={stopping} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-[#ff3b30] text-white" : "bg-[#eef4f9] text-[#102a43]"}`} aria-label={listening ? "停止管理员语音输入" : "开始管理员语音输入"}>{listening ? <X size={18} /> : <Mic size={18} />}</button><span className="min-w-[180px] text-xs text-[#627d98]">{status} · {selectedLabel}{listening && <span className="ml-2 inline-block h-1.5 w-12 overflow-hidden rounded-full bg-[#e5e5ea] align-middle"><span className="block h-full bg-[#34c759]" style={{ width: `${Math.max(5, Math.round(level * 100))}%` }} /></span>}</span><span className="sr-only">当前语音后端：{backend}</span></div>;
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
