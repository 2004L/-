"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type IntentResponse = Partial<MatchResponse> & {
  intent: string;
  label: string;
  confidence: number;
  action: string;
  phone_last4?: string;
  assistantMessage: string;
};

type AgentResponse = { type: "tool_call"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; implementation: "business_api" | "simulator"; response_hint?: string } | { type: "clarification"; message: string; intent: string; confidence: number } | { type: "assistant_message"; message: string };
type AgentHistoryMessage = { role: "user" | "assistant" | "tool"; content: string };
type TranscriptEntry = { id: string; role: "user" | "assistant" | "tool"; content: string };

type RecognitionResultEvent = { results: { 0: { 0: { transcript: string } } } };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
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
  code?: string;
  message?: string;
};

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

type ReconcileResponse = { ok: boolean; current_state: string; current_state_label: string; last_command: { id: string; target: string; operation: string; status: string; error_code: string | null; retryable: boolean } | null; unresolved_external_call: { id: string; target: string; operation: string; status: string; error_code: string | null } | null; invariant_failures: string[]; recommended_action: string };

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

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [view, setView] = useState<"terminal" | "admin">("terminal");
  const [sessionId, setSessionId] = useState("");
  const [adapter, setAdapter] = useState(DEFAULT_ADAPTER);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loadingData, setLoadingData] = useState(false);

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
  if (view === "admin") {
    return <AdminConsole sessionId={sessionId} adapter={adapter} snapshot={snapshot} loading={loadingData} onRefresh={refresh} onBack={() => setView("terminal")} onReconfigure={() => {
      localStorage.removeItem("hotel_setup_complete");
      setSetupComplete(false);
    }} />;
  }
  return <VoiceTerminal sessionId={sessionId} adapter={adapter} snapshot={snapshot} onRefresh={refresh} onOpenAdmin={() => setView("admin")} />;
}

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center bg-[#f5f5f7] text-[#1d1d1f]"><LoaderCircle className="animate-spin" /></main>;
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

const SAMPLE_UTTERANCES = ["我在美团订了房，手机号后四位4821", "我没有预订，想直接入住", "早餐几点开始？", "房卡怎么还没出来？"];

type TerminalPhase = "idle" | "searching" | "matched" | "processing" | "ambiguous" | "not_found" | "blocked" | "complete" | "error";

function VoiceTerminal({ sessionId, adapter, snapshot, onRefresh, onOpenAdmin }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; onRefresh: () => Promise<void>; onOpenAdmin: () => void }) {
  const [last4, setLast4] = useState("");
  const [utterance, setUtterance] = useState("");
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<DemoOrder | null>(null);
  const [checkinCase, setCheckinCase] = useState<CheckinCase | null>(null);
  const [alternatives, setAlternatives] = useState<DemoOrder[]>([]);
  const [message, setMessage] = useState("您好，今天想办理什么？");
  const [intentTrace, setIntentTrace] = useState<Pick<IntentResponse, "label" | "confidence" | "action"> | null>(null);
  const [flowStep, setFlowStep] = useState(0);
  const [flowError, setFlowError] = useState<{ step: FlowStepInfo; code: string; retryable: boolean; status: string; reconciliation?: ReconcileResponse | null } | null>(null);
  const [voiceBackend, setVoiceBackend] = useState<"local" | "browser" | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const asrSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const speechStartedAtRef = useRef(0);
  const localAsrResultRef = useRef(false);
  const conversationRef = useRef<AgentHistoryMessage[]>([]);

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
    setLast4("");
    setUtterance("");
    setPhase("idle");
    setMatchedOrder(null);
    setCheckinCase(null);
    setAlternatives([]);
    setIntentTrace(null);
    setFlowStep(0);
    setFlowError(null);
    conversationRef.current = [];
    setTranscript([]);
    setMessage("您好，今天想办理什么？");
    speak("您好，今天想办理什么？您可以直接说。", voiceEnabled);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (silenceTimerRef.current !== null) window.clearInterval(silenceTimerRef.current);
    silenceTimerRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    const recorder = mediaRecorderRef.current;
    const socket = asrSocketRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      };
      recorder.stop();
    } else if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    asrSocketRef.current = null;
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
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      setUtterance(transcript);
      void submitUtterance(transcript);
    };
    recognition.onerror = () => setMessage("没有听清，您可以换一种说法或直接输入");
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    setMessage("我在听，您直接说就好");
    recognition.start();
  }

  async function startLocalRecognition() {
    if (!adapter.asrWsUrl || typeof WebSocket === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("local_asr_unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    mediaStreamRef.current = stream;
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
    setVoiceBackend("local");
    setListening(true);
    setMessage("本地语音识别已连接，您直接说就好");
    socket.send(JSON.stringify({ type: "start", language: "Chinese", sample_rate: 16000 }));
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size && socket.readyState === WebSocket.OPEN) void event.data.arrayBuffer().then((buffer) => socket.send(buffer));
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
        setUtterance(transcript);
        stopListening();
        void submitUtterance(transcript);
      } else if (payload.type === "error") {
        setMessage(payload.message || "本地语音识别失败，请再说一次");
        stopListening();
      }
    };
    socket.onclose = () => {
      if (!localAsrResultRef.current && mediaRecorderRef.current) setMessage("本地识别服务已断开，请再说一次");
    };
    recorder.start(250);
    speechStartedAtRef.current = Date.now();
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let analyserStarted = false;
    if (AudioContextConstructor) {
      try {
        const audioContext = new AudioContextConstructor();
        audioContextRef.current = audioContext;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let quietSince = 0;
        silenceTimerRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += Math.abs(sample - 128);
          const quiet = energy / samples.length < 2.2;
          if (Date.now() - speechStartedAtRef.current < 700) return;
          if (quiet) quietSince ||= Date.now(); else quietSince = 0;
          if (quietSince && Date.now() - quietSince > 1000) stopListening();
        }, 120);
        analyserStarted = true;
      } catch {
        audioContextRef.current?.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    }
    if (!analyserStarted) {
      // 部分内置浏览器没有或禁用了 AudioContext，仍可录音；达到最长时长后安全收尾。
      silenceTimerRef.current = window.setTimeout(() => stopListening(), 8000);
    }
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
    } catch {
      stopListening();
      setMessage("本地识别未连接，已切换浏览器识别");
      startBrowserRecognition();
    }
  }

  async function submitUtterance(value = utterance) {
    const normalized = value.trim();
    if (!normalized) return;
    setPhase("searching");
    setMessage("正在理解您的意思");
    try {
      recordConversation("user", normalized);
      const messages = conversationRef.current.slice(-24);
      let streamedText = "";
      const agent = await postAgentStream({ session_id: sessionId, case_id: checkinCase?.id, messages }, (delta) => {
        streamedText += delta;
        setMessage(streamedText);
      });
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
      const toolLabel = agent.tool_name === "pms.search_order" ? "查询订单" : agent.tool_name === "hotel.policy_answer" ? "查询门店政策" : agent.tool_name === "device.reader.read_identity" ? "调用读卡器仿真" : agent.tool_name === "device.encoder.read_status" ? "查询发卡机仿真" : "受控业务工具";
      setIntentTrace({ label: toolLabel, confidence: 0.96, action: agent.tool_name });
      let result: IntentResponse;
      if (agent.tool_name === "pms.search_order") {
        const phoneLast4 = String(agent.arguments.phone_last4 ?? "");
        setLast4(phoneLast4);
        result = await postDemo<IntentResponse>("interpret", { session_id: sessionId, utterance: normalized });
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
    }
  }

  async function createWalkIn() {
    setPhase("searching");
    try {
      const result = await postDemo<MatchResponse>("walk-in", { session_id: sessionId, phone_last4: last4 });
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

  async function runCheckin() {
    if (!checkinCase) return;
    setPhase("processing");
    setFlowError(null);
    let activeStep = FLOW_STEPS[1];
    try {
      setFlowStep(1);
      activeStep = FLOW_STEPS[1];
      let result = await postDemo<{ checkinCase: CheckinCase }>("identity-detected", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      speak("已检测到身份证，正在确认不是上一位客人遗留的证件。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(2);
      activeStep = FLOW_STEPS[1];
      await postSimulator("/api/device/reader", { session_id: sessionId, case_id: checkinCase.id, idempotency_key: `reader:${checkinCase.id}`, expected_state: "IDENTITY_READING", device_id: "reader-demo-01", operation: "read_identity" }, activeStep);
      activeStep = FLOW_STEPS[1];
      result = await postDemo<{ checkinCase: CheckinCase }>("verify-identity", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      speak("身份证已自动读取并核验通过，正在锁定房间。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(3);
      activeStep = FLOW_STEPS[2];
      result = await postDemo<{ checkinCase: CheckinCase }>("hold-room", { session_id: sessionId, case_id: checkinCase.id, room_number: "1208" }, activeStep);
      setCheckinCase(result.checkinCase);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(4);
      activeStep = FLOW_STEPS[3];
      await postSimulator("/api/police/submit", { session_id: sessionId, case_id: checkinCase.id, idempotency_key: `police:${checkinCase.id}`, expected_state: "ROOM_HELD", device_id: "police-browser-demo-01", operation: "submit_registration", actual_identity_verified: true, identity_token: "DEMO-ID-TOKEN" }, activeStep);
      activeStep = FLOW_STEPS[3];
      result = await postDemo<{ checkinCase: CheckinCase }>("browser-start", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      speak("正在广州隔离演示环境中模拟住宿登记。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      activeStep = FLOW_STEPS[3];
      const completed = await postDemo<{ checkinCase: CheckinCase; receipt: string }>("browser-complete", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(completed.checkinCase);
      setFlowStep(5);
      activeStep = FLOW_STEPS[4];
      result = await postDemo<{ checkinCase: CheckinCase }>("confirm-checkin", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      setMatchedOrder((current) => current ? { ...current, status: "checkin_confirmed", room_number: result.checkinCase.room_number } : current);
      speak("入住已确认，自动发卡机正在制作房卡。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(6);
      activeStep = FLOW_STEPS[5];
      result = await postDemo<{ checkinCase: CheckinCase }>("keycard-start", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      await new Promise((resolve) => window.setTimeout(resolve, 950));
      activeStep = FLOW_STEPS[5];
      await postSimulator("/api/device/encoder", { session_id: sessionId, case_id: checkinCase.id, idempotency_key: `encoder:${checkinCase.id}`, expected_state: "PMS_CHECKIN_CONFIRMED", device_id: "encoder-demo-01", operation: "issue_keycard", room_number: result.checkinCase.room_number ?? "1208" }, activeStep);
      activeStep = FLOW_STEPS[5];
      result = await postDemo<{ checkinCase: CheckinCase }>("keycard-complete", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      setMatchedOrder((current) => current ? { ...current, status: "in_house", room_number: result.checkinCase.room_number } : current);
      setFlowStep(7);
      speak("房卡已制作完成，请取走房卡和身份证。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      activeStep = FLOW_STEPS[6];
      result = await postDemo<{ checkinCase: CheckinCase }>("pickup-confirmed", { session_id: sessionId, case_id: checkinCase.id }, activeStep);
      setCheckinCase(result.checkinCase);
      setPhase("complete");
      speak("已确认房卡和身份证取走，自助入住完成。祝您入住愉快。", voiceEnabled);
      await onRefresh();
    } catch (error) {
      let reconciliation: ReconcileResponse | null = null;
      try { reconciliation = await postDemo<ReconcileResponse>("reconcile", { session_id: sessionId, case_id: checkinCase.id }); } catch { /* 自查接口本身失败时仍保留原始停点 */ }
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

      {showEntry && <div className="mt-10 w-full max-w-2xl"><form onSubmit={(event) => { event.preventDefault(); void submitUtterance(); }} className="flex items-center gap-2 rounded-[1.7rem] bg-white p-2 pl-5 shadow-[0_10px_40px_rgba(0,0,0,.07)]"><MessageSquareText size={20} className="shrink-0 text-[#86868b]" /><input value={utterance} onChange={(event) => setUtterance(event.target.value)} disabled={phase === "searching"} maxLength={200} placeholder="例如：我在美团订了房，手机号后四位4821" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-[#a1a1a6]" aria-label="告诉AI您想办理的事情" /><button type="button" onClick={startListening} disabled={phase === "searching"} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-[#ff3b30]" : "bg-[#f2f2f7] text-[#1d1d1f]"} disabled:opacity-50`} aria-label={listening ? "停止语音交互" : "开始语音交互"}>{listening ? <X size={19} className="text-white" /> : <Mic size={19} />}</button><button type="submit" disabled={!utterance.trim() || phase === "searching"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#007aff] text-white disabled:opacity-30" aria-label="发送"><ArrowUp size={19} /></button></form><div className="mt-4 flex flex-wrap justify-center gap-2">{SAMPLE_UTTERANCES.map((sample) => <button key={sample} onClick={() => { setUtterance(sample); void submitUtterance(sample); }} disabled={phase === "searching"} className="rounded-full border border-[#d9d9df] bg-white/70 px-3 py-2 text-xs text-[#6e6e73] disabled:opacity-40">{sample}</button>)}</div><p className="mt-3 text-xs text-[#86868b]">{voiceBackend === "local" ? "本地 Qwen3-ASR · 语音只在本机处理" : voiceBackend === "browser" ? "浏览器语音识别备用通道" : "本地 ASR 优先 · 浏览器识别备用"}</p>{intentTrace && <div className="mx-auto mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-[#eaf4ff] px-4 py-2 text-xs text-[#1769aa]"><span>已理解：{intentTrace.label}</span><span className="text-[#7b9bb8]">{Math.round(intentTrace.confidence * 100)}%</span><span className="text-[#7b9bb8]">→ {intentTrace.action}</span></div>}<p className="mt-3 text-xs text-[#86868b]">演示数据：4821 正常 · 1188 重复 · 7366 已入住 · 4402 已取消</p></div>}

      {transcript.length > 0 && <section className="mt-8 w-full max-w-2xl rounded-[2rem] bg-white p-5 text-left shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">完整对话记录</p><span className="text-xs text-[#a1a1a6]">本次会话 · {transcript.length} 条</span></div><div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">{transcript.map((entry) => <div key={entry.id} className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${entry.role === "user" ? "ml-8 bg-[#eaf4ff] text-[#174a72]" : entry.role === "tool" ? "mr-8 bg-[#f5f5f7] text-[#6e6e73]" : "mr-8 bg-[#eefaf2] text-[#245d38]"}`}><p className="mb-1 text-[10px] uppercase tracking-[.14em] opacity-60">{entry.role === "user" ? "您" : entry.role === "tool" ? "系统动作" : "AI"}</p>{entry.content}</div>)}</div></section>}
      {matchedOrder && (phase === "matched" || phase === "processing" || phase === "complete" || phase === "error") && <section className="mt-9 w-full max-w-3xl rounded-[2rem] bg-white p-6 text-left shadow-sm md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">已匹配订单</p><h2 className="mt-2 text-2xl font-semibold">{matchedOrder.source} · {matchedOrder.order_code}</h2></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">手机号 {matchedOrder.phone_masked}</span></div><div className="mt-6 grid grid-cols-2 gap-4 border-y border-[#ededf0] py-5 text-sm md:grid-cols-4"><Info label="入住日期" value={matchedOrder.stay_date} /><Info label="房型" value={matchedOrder.room_type} /><Info label="晚数" value={`${matchedOrder.nights} 晚`} /><Info label="订单状态" value={STATUS_LABELS[matchedOrder.status] ?? matchedOrder.status} /></div>{phase === "matched" && <button onClick={runCheckin} className="mt-6 w-full rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white"><IdCard size={18} className="mr-2 inline" />模拟身份证放入读卡器</button>}{phase === "matched" && <p className="mt-3 text-center text-xs text-[#86868b]">检测到证件后，读卡、核验、登记和发卡将自动完成，无需再次操作。</p>}</section>}

      {phase === "ambiguous" && <RiskCard title="找到多笔待入住订单" text="仅凭手机号后四位无法确认是哪一笔。AI 已停止自动选择，需要工作人员核对完整手机号或订单号。" orders={alternatives} />}
      {phase === "blocked" && <RiskCard title="该订单不能继续自动办理" text={message} orders={alternatives} />}
      {phase === "not_found" && <section className="mt-9 w-full max-w-xl rounded-[2rem] bg-white p-7 shadow-sm"><Database className="mx-auto text-[#007aff]" /><h2 className="mt-4 text-xl font-semibold">线上订单未找到</h2><p className="mt-2 text-sm leading-6 text-[#6e6e73]">如果客人确实是现场到店，可以创建一笔独立的演示现场办理单。</p><button onClick={createWalkIn} className="mt-5 rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">创建现场办理单</button></section>}
      {phase === "error" && <RiskCard title={flowError ? `已停在第 ${flowError.step.number} 步：${flowError.step.label}` : "流程已安全暂停"} text={message} orders={[]} />}

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

function AdminConsole({ sessionId, adapter, snapshot, loading, onRefresh, onBack, onReconfigure }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; loading: boolean; onRefresh: () => Promise<void>; onBack: () => void; onReconfigure: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [faultTarget, setFaultTarget] = useState("reader");
  const [faultType, setFaultType] = useState("reader_timeout");
  const [faults, setFaults] = useState<Array<{ id: string; target: string; fault_type: string; call_count: number; enabled: number }>>([]);
  const [faultMessage, setFaultMessage] = useState("");
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
    void fetch(`/api/simulator/faults?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ faults?: typeof faults }>)
      .then((data) => setFaults(data.faults ?? []));
  }, [sessionId]);
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
  return <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]"><header className="border-b border-[#d9e2ec] bg-white px-5 py-5 md:px-9"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-[#f3f6f8]" aria-label="返回入住界面"><ArrowLeft size={18} /></button><div><p className="text-sm text-[#627d98]">独立管理后台</p><h1 className="font-semibold">{adapter.hotelName}</h1></div></div><div className="flex gap-2"><button onClick={() => void onRefresh()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">{loading ? "刷新中…" : "刷新数据"}</button><button onClick={onReconfigure} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">重新适配</button><button onClick={() => setConfirmReset(true)} className="rounded-lg bg-[#fff1ed] px-3 py-2 text-sm text-[#b63d13]">重置演示数据</button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 md:p-9"><section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#627d98]">商业价值</p><h2 className="mt-1 text-xl font-semibold">四条价值线</h2></div><span className="rounded-full bg-[#e8eef3] px-3 py-1.5 text-xs text-[#627d98]">演示指标 · 生产接入后替换为真实数据</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ValueMetric icon={<TrendingUp size={20} />} label="收益" value="待接 PMS" note="跟踪 RevPAR、ADR 与增值成交" tone="blue" /><ValueMetric icon={<Users size={20} />} label="人力" value={`${estimatedMinutesSaved} 分钟`} note={`已自动完成 ${completedCases} 笔，按每笔节省6分钟估算`} tone="violet" /><ValueMetric icon={<Clock3 size={20} />} label="响应" value="< 3 秒" note="单路首段语音 P95 目标 · 7×24" tone="orange" /><ValueMetric icon={<FileCheck2 size={20} />} label="合规" value={snapshot.cases.length ? "100%" : "待产生"} note={`${snapshot.auditEvents.length} 条脱敏动作记录`} tone="green" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe0f2] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eef3] px-5 py-4"><div><p className="text-sm text-[#3b78a8]">AI Native</p><h2 className="mt-1 font-semibold">意图识别与动作对齐审计</h2></div><span className="rounded-full bg-[#eaf4ff] px-3 py-1.5 text-xs text-[#1769aa]">只保留脱敏表达</span></div><div className="divide-y divide-[#edf2f7]">{intentEvents.length ? intentEvents.slice(0, 8).map((event) => <div key={event.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]"><div><p className="text-sm leading-6 text-[#334e68]">{event.detail}</p><p className="mt-1 text-xs text-[#9fb3c8]">顾客表达 → 意图 → 置信度 → 受控业务动作</p></div><span className="font-mono text-xs text-[#829ab1]">#{event.id}</span></div>) : <Empty text="与AI说一句话后，这里会显示脱敏的意图识别和动作对齐记录" />}</div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#f0d7b7] bg-[#fffaf4] shadow-sm"><div className="border-b border-[#f3e3cd] px-5 py-4"><p className="text-sm text-[#ad6a16]">验收工具</p><h2 className="mt-1 font-semibold">设备与公安仿真器故障开关</h2><p className="mt-1 text-xs leading-5 text-[#8a6a45]">只影响当前会话；每次注入默认只触发一次，失败会自动生成人工任务和审计记录。</p></div><div className="flex flex-wrap items-end gap-3 px-5 py-4"><label className="text-xs text-[#627d98]">目标<select value={faultTarget} onChange={(event) => { const target = event.target.value; setFaultTarget(target); setFaultType(target === "reader" ? "reader_timeout" : target === "encoder" ? "encoder_offline" : "captcha_required"); }} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm"><option value="reader">读卡器</option><option value="encoder">发卡机</option><option value="police">公安浏览器</option></select></label><label className="text-xs text-[#627d98]">故障类型<select value={faultType} onChange={(event) => setFaultType(event.target.value)} className="mt-1 block rounded-lg border border-[#d9e2ec] bg-white px-3 py-2 text-sm">{(faultTarget === "reader" ? ["reader_timeout", "reader_offline", "duplicate_read", "identity_mismatch"] : faultTarget === "encoder" ? ["encoder_offline", "write_failed", "readback_mismatch", "output_jammed", "card_not_collected", "encoder_timeout"] : ["captcha_required", "system_maintenance", "certificate_error", "submission_rejected", "receipt_lost", "police_timeout"]).map((fault) => <option key={fault} value={fault}>{fault}</option>)}</select></label><button onClick={() => void configureFault()} className="rounded-lg bg-[#b66a16] px-4 py-2 text-sm text-white">注入一次</button><button onClick={() => void resetFaults()} className="rounded-lg border border-[#e3c79e] bg-white px-4 py-2 text-sm text-[#8a5b1d]">恢复正常</button>{faultMessage && <span className="text-xs text-[#8a6a45]">{faultMessage}</span>}</div><div className="border-t border-[#f3e3cd] px-5 py-3 text-xs text-[#8a6a45]">{faults.filter((fault) => fault.enabled).length ? faults.filter((fault) => fault.enabled).map((fault) => <span key={fault.id} className="mr-2 inline-flex rounded-full bg-white px-2.5 py-1">{fault.target}/{fault.fault_type} · 已调用 {fault.call_count} 次</span>) : "当前没有启用的故障"}</div></section>
      <section className="mt-7"><p className="text-sm text-[#627d98]">系统运行</p><h2 className="mt-1 text-xl font-semibold">实时业务数据</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><AdminMetric label="假订单" value={String(snapshot.orders.length)} note="每个浏览器会话独立" /><AdminMetric label="办理任务" value={String(snapshot.cases.length)} note="状态变更写入数据库" /><AdminMetric label="浏览器任务" value={String(snapshot.browserJobs.length)} note="仅隔离模拟" /><AdminMetric label="审计事件" value={String(snapshot.auditEvents.length)} note="倒序显示最近 80 条" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">D1 假数据</p><h2 className="mt-1 font-semibold">订单状态与手机号测试集</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[#f8fbfd] text-xs text-[#627d98]"><tr>{["来源", "订单号", "手机号", "日期", "房型", "订单状态", "房间"].map((name) => <th key={name} className="px-5 py-3 font-medium">{name}</th>)}</tr></thead><tbody>{snapshot.orders.map((order) => <tr key={order.id} className="border-t border-[#edf2f7]"><td className="px-5 py-3 font-medium">{order.source}</td><td className="px-5 py-3 font-mono text-xs">{order.order_code}</td><td className="px-5 py-3">{order.phone_masked}</td><td className="px-5 py-3">{order.stay_date}</td><td className="px-5 py-3">{order.room_type}</td><td className="px-5 py-3"><StatusPill value={order.status} /></td><td className="px-5 py-3">{order.room_number ?? "—"}</td></tr>)}</tbody></table></div></section>
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">办理任务</p><h2 className="mt-1 font-semibold">数据库状态机</h2></div><div className="divide-y divide-[#edf2f7]">{snapshot.cases.length ? snapshot.cases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-mono text-xs text-[#627d98]">{item.id.slice(0, 12)}… · v{item.version}</p><p className="mt-1 text-sm">房间 {item.room_number ?? "未锁定"} · 硬件 {item.hardware_status}</p></div><StatusPill value={item.status} /></div>) : <Empty text="尚无办理任务" />}</div></section>
        <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-5 py-4"><p className="text-sm text-[#627d98]">不可篡改式演示记录</p><h2 className="mt-1 font-semibold">最近审计事件</h2></div><div className="max-h-[430px] divide-y divide-[#edf2f7] overflow-y-auto">{snapshot.auditEvents.length ? snapshot.auditEvents.map((event) => <div key={event.id} className="px-5 py-4"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{event.event_type}</p><span className="font-mono text-[10px] text-[#829ab1]">#{event.id}</span></div><p className="mt-1 text-xs leading-5 text-[#627d98]">{event.detail}</p><p className="mt-1 text-[10px] text-[#9fb3c8]">{new Date(event.created_at).toLocaleString("zh-CN")}</p></div>) : <Empty text="尚无审计事件" />}</div></section></div>
    </div>
    {confirmReset && <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="dialog" aria-modal="true" aria-labelledby="reset-title"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#b63d13]">需要确认</p><h2 id="reset-title" className="mt-2 text-xl font-semibold">重置本次演示数据？</h2></div><button onClick={() => setConfirmReset(false)} aria-label="关闭"><X size={19} /></button></div><p className="mt-4 text-sm leading-6 text-[#627d98]">当前浏览器会话的办理任务、浏览器任务和审计记录会被删除，假订单恢复到初始状态。不会影响其他会话。</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setConfirmReset(false)} className="rounded-xl border border-[#cbd9e5] px-4 py-2.5 text-sm">取消</button><button onClick={() => void resetData()} disabled={resetting} className="rounded-xl bg-[#b63d13] px-4 py-2.5 text-sm text-white disabled:opacity-50">{resetting ? "重置中…" : "确认重置"}</button></div></section></div>}
  </main>;
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
