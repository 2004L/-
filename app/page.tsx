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

const DEFAULT_ADAPTER: AdapterConfig = {
  provider: "QloApps",
  version: "1.6.1",
  baseUrl: "https://pms.example.local/api",
  apiKey: "TEMP_PMS_API_KEY_REPLACE_ME",
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

async function postDemo<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/demo/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "request_failed");
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
          setAdapter(JSON.parse(storedAdapter) as AdapterConfig);
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
  const recognitionRef = useRef<RecognitionLike | null>(null);

  const activeMessage = useMemo(() => {
    if (phase === "complete") return "入住完成，请带好身份证和房卡";
    if (phase === "processing") return TERMINAL_PROGRESS[Math.min(flowStep, TERMINAL_PROGRESS.length - 1)][0];
    return message;
  }, [flowStep, message, phase]);

  function reset() {
    recognitionRef.current?.stop();
    setLast4("");
    setUtterance("");
    setPhase("idle");
    setMatchedOrder(null);
    setCheckinCase(null);
    setAlternatives([]);
    setIntentTrace(null);
    setFlowStep(0);
    setMessage("您好，今天想办理什么？");
    speak("您好，今天想办理什么？您可以直接说。", voiceEnabled);
  }

  function startListening() {
    const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage("当前浏览器不支持语音识别，您可以直接打字告诉我");
      return;
    }
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

  async function submitUtterance(value = utterance) {
    const normalized = value.trim();
    if (!normalized) return;
    setPhase("searching");
    setMessage("正在理解您的意思");
    try {
      const result = await postDemo<IntentResponse>("interpret", { session_id: sessionId, utterance: normalized });
      setIntentTrace({ label: result.label, confidence: result.confidence, action: result.action });
      if (result.phone_last4) setLast4(result.phone_last4);
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
    try {
      setFlowStep(1);
      let result = await postDemo<{ checkinCase: CheckinCase }>("identity-detected", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      speak("已检测到身份证，正在确认不是上一位客人遗留的证件。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(2);
      result = await postDemo<{ checkinCase: CheckinCase }>("verify-identity", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      speak("身份证已自动读取并核验通过，正在锁定房间。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(3);
      result = await postDemo<{ checkinCase: CheckinCase }>("hold-room", { session_id: sessionId, case_id: checkinCase.id, room_number: "1208" });
      setCheckinCase(result.checkinCase);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(4);
      result = await postDemo<{ checkinCase: CheckinCase }>("browser-start", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      speak("正在广州隔离演示环境中模拟住宿登记。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const completed = await postDemo<{ checkinCase: CheckinCase; receipt: string }>("browser-complete", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(completed.checkinCase);
      setFlowStep(5);
      result = await postDemo<{ checkinCase: CheckinCase }>("confirm-checkin", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      setMatchedOrder((current) => current ? { ...current, status: "checkin_confirmed", room_number: result.checkinCase.room_number } : current);
      speak("入住已确认，自动发卡机正在制作房卡。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(6);
      result = await postDemo<{ checkinCase: CheckinCase }>("keycard-start", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      await new Promise((resolve) => window.setTimeout(resolve, 950));
      result = await postDemo<{ checkinCase: CheckinCase }>("keycard-complete", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      setMatchedOrder((current) => current ? { ...current, status: "in_house", room_number: result.checkinCase.room_number } : current);
      setFlowStep(7);
      speak("房卡已制作完成，请取走房卡和身份证。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      result = await postDemo<{ checkinCase: CheckinCase }>("pickup-confirmed", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      setPhase("complete");
      speak("已确认房卡和身份证取走，自助入住完成。祝您入住愉快。", voiceEnabled);
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("流程已安全暂停，未继续发卡；系统已通知远程维护人员检查日志");
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

      {showEntry && <div className="mt-10 w-full max-w-2xl"><form onSubmit={(event) => { event.preventDefault(); void submitUtterance(); }} className="flex items-center gap-2 rounded-[1.7rem] bg-white p-2 pl-5 shadow-[0_10px_40px_rgba(0,0,0,.07)]"><MessageSquareText size={20} className="shrink-0 text-[#86868b]" /><input value={utterance} onChange={(event) => setUtterance(event.target.value)} disabled={phase === "searching"} maxLength={200} placeholder="例如：我在美团订了房，手机号后四位4821" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-[#a1a1a6]" aria-label="告诉AI您想办理的事情" /><button type="button" onClick={startListening} disabled={listening || phase === "searching"} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-[#ff3b30]" : "bg-[#f2f2f7] text-[#1d1d1f]"} disabled:opacity-50`} aria-label="开始语音交互">{listening ? <LoaderCircle size={19} className="animate-spin text-white" /> : <Mic size={19} />}</button><button type="submit" disabled={!utterance.trim() || phase === "searching"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#007aff] text-white disabled:opacity-30" aria-label="发送"><ArrowUp size={19} /></button></form><div className="mt-4 flex flex-wrap justify-center gap-2">{SAMPLE_UTTERANCES.map((sample) => <button key={sample} onClick={() => { setUtterance(sample); void submitUtterance(sample); }} disabled={phase === "searching"} className="rounded-full border border-[#d9d9df] bg-white/70 px-3 py-2 text-xs text-[#6e6e73] disabled:opacity-40">{sample}</button>)}</div>{intentTrace && <div className="mx-auto mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-[#eaf4ff] px-4 py-2 text-xs text-[#1769aa]"><span>已理解：{intentTrace.label}</span><span className="text-[#7b9bb8]">{Math.round(intentTrace.confidence * 100)}%</span><span className="text-[#7b9bb8]">→ {intentTrace.action}</span></div>}<p className="mt-3 text-xs text-[#86868b]">演示数据：4821 正常 · 1188 重复 · 7366 已入住 · 4402 已取消</p></div>}

      {matchedOrder && (phase === "matched" || phase === "processing" || phase === "complete") && <section className="mt-9 w-full max-w-3xl rounded-[2rem] bg-white p-6 text-left shadow-sm md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">已匹配订单</p><h2 className="mt-2 text-2xl font-semibold">{matchedOrder.source} · {matchedOrder.order_code}</h2></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">手机号 {matchedOrder.phone_masked}</span></div><div className="mt-6 grid grid-cols-2 gap-4 border-y border-[#ededf0] py-5 text-sm md:grid-cols-4"><Info label="入住日期" value={matchedOrder.stay_date} /><Info label="房型" value={matchedOrder.room_type} /><Info label="晚数" value={`${matchedOrder.nights} 晚`} /><Info label="订单状态" value={STATUS_LABELS[matchedOrder.status] ?? matchedOrder.status} /></div>{phase === "matched" && <button onClick={runCheckin} className="mt-6 w-full rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white"><IdCard size={18} className="mr-2 inline" />模拟身份证放入读卡器</button>}{phase === "matched" && <p className="mt-3 text-center text-xs text-[#86868b]">检测到证件后，读卡、核验、登记和发卡将自动完成，无需再次操作。</p>}</section>}

      {phase === "ambiguous" && <RiskCard title="找到多笔待入住订单" text="仅凭手机号后四位无法确认是哪一笔。AI 已停止自动选择，需要工作人员核对完整手机号或订单号。" orders={alternatives} />}
      {phase === "blocked" && <RiskCard title="该订单不能继续自动办理" text={message} orders={alternatives} />}
      {phase === "not_found" && <section className="mt-9 w-full max-w-xl rounded-[2rem] bg-white p-7 shadow-sm"><Database className="mx-auto text-[#007aff]" /><h2 className="mt-4 text-xl font-semibold">线上订单未找到</h2><p className="mt-2 text-sm leading-6 text-[#6e6e73]">如果客人确实是现场到店，可以创建一笔独立的演示现场办理单。</p><button onClick={createWalkIn} className="mt-5 rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">创建现场办理单</button></section>}
      {phase === "error" && <RiskCard title="流程已安全暂停" text={message} orders={[]} />}

      {(phase === "processing" || phase === "complete") && <div className="mt-8 grid w-full gap-5 lg:grid-cols-[1fr_.9fr]">
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
  return <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]"><header className="border-b border-[#d9e2ec] bg-white px-5 py-5 md:px-9"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-[#f3f6f8]" aria-label="返回入住界面"><ArrowLeft size={18} /></button><div><p className="text-sm text-[#627d98]">独立管理后台</p><h1 className="font-semibold">{adapter.hotelName}</h1></div></div><div className="flex gap-2"><button onClick={() => void onRefresh()} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">{loading ? "刷新中…" : "刷新数据"}</button><button onClick={onReconfigure} className="rounded-lg border border-[#cbd9e5] px-3 py-2 text-sm">重新适配</button><button onClick={() => setConfirmReset(true)} className="rounded-lg bg-[#fff1ed] px-3 py-2 text-sm text-[#b63d13]">重置演示数据</button></div></div></header>
    <div className="mx-auto max-w-7xl p-5 md:p-9"><section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#627d98]">商业价值</p><h2 className="mt-1 text-xl font-semibold">四条价值线</h2></div><span className="rounded-full bg-[#e8eef3] px-3 py-1.5 text-xs text-[#627d98]">演示指标 · 生产接入后替换为真实数据</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ValueMetric icon={<TrendingUp size={20} />} label="收益" value="待接 PMS" note="跟踪 RevPAR、ADR 与增值成交" tone="blue" /><ValueMetric icon={<Users size={20} />} label="人力" value={`${estimatedMinutesSaved} 分钟`} note={`已自动完成 ${completedCases} 笔，按每笔节省6分钟估算`} tone="violet" /><ValueMetric icon={<Clock3 size={20} />} label="响应" value="< 3 秒" note="单路首段语音 P95 目标 · 7×24" tone="orange" /><ValueMetric icon={<FileCheck2 size={20} />} label="合规" value={snapshot.cases.length ? "100%" : "待产生"} note={`${snapshot.auditEvents.length} 条脱敏动作记录`} tone="green" /></div></section>
      <section className="mt-7 overflow-hidden rounded-2xl border border-[#cfe0f2] bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eef3] px-5 py-4"><div><p className="text-sm text-[#3b78a8]">AI Native</p><h2 className="mt-1 font-semibold">意图识别与动作对齐审计</h2></div><span className="rounded-full bg-[#eaf4ff] px-3 py-1.5 text-xs text-[#1769aa]">只保留脱敏表达</span></div><div className="divide-y divide-[#edf2f7]">{intentEvents.length ? intentEvents.slice(0, 8).map((event) => <div key={event.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]"><div><p className="text-sm leading-6 text-[#334e68]">{event.detail}</p><p className="mt-1 text-xs text-[#9fb3c8]">顾客表达 → 意图 → 置信度 → 受控业务动作</p></div><span className="font-mono text-xs text-[#829ab1]">#{event.id}</span></div>) : <Empty text="与AI说一句话后，这里会显示脱敏的意图识别和动作对齐记录" />}</div></section>
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
