"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CircleCheck,
  Database,
  KeyRound,
  LoaderCircle,
  Mic,
  MonitorCog,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

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
  ["身份核验", "模拟读卡与实名核验"],
  ["锁定房间", "调用 PMS 演示接口"],
  ["住宿登记", "隔离浏览器模拟"],
  ["现场交接", "等待工作人员发卡"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  awaiting_arrival: "待入住",
  in_house: "已入住",
  cancelled: "已取消",
  ready_for_hardware: "待现场发卡",
  ORDER_MATCHED: "订单已匹配",
  IDENTITY_VERIFIED: "身份已核验",
  ROOM_HELD: "房间已锁定",
  POLICE_RUNNING: "登记模拟中",
  READY_FOR_ONSITE_HANDOFF: "等待现场发卡",
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

function parseSpokenLast4(value: string) {
  const map: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 幺: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  const normalized = [...value].map((char) => map[char] ?? char).join("");
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
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

type TerminalPhase = "idle" | "confirm" | "searching" | "matched" | "processing" | "ambiguous" | "not_found" | "blocked" | "complete" | "error";

function VoiceTerminal({ sessionId, adapter, snapshot, onRefresh, onOpenAdmin }: { sessionId: string; adapter: AdapterConfig; snapshot: Snapshot; onRefresh: () => Promise<void>; onOpenAdmin: () => void }) {
  const [last4, setLast4] = useState("");
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<DemoOrder | null>(null);
  const [checkinCase, setCheckinCase] = useState<CheckinCase | null>(null);
  const [alternatives, setAlternatives] = useState<DemoOrder[]>([]);
  const [message, setMessage] = useState("说出或输入预订手机号后四位");
  const [flowStep, setFlowStep] = useState(0);
  const recognitionRef = useRef<RecognitionLike | null>(null);

  const activeMessage = useMemo(() => {
    if (phase === "complete") return "登记完成，等待现场人员发卡";
    if (phase === "processing") return TERMINAL_PROGRESS[Math.min(flowStep, TERMINAL_PROGRESS.length - 1)][0];
    return message;
  }, [flowStep, message, phase]);

  function reset() {
    recognitionRef.current?.stop();
    setLast4("");
    setPhase("idle");
    setMatchedOrder(null);
    setCheckinCase(null);
    setAlternatives([]);
    setFlowStep(0);
    setMessage("说出或输入预订手机号后四位");
    speak("您好，请说出或输入预订手机号后四位。", voiceEnabled);
  }

  function changeLast4(value: string) {
    const cleaned = value.replace(/\D/g, "").slice(0, 4);
    setLast4(cleaned);
    if (cleaned.length === 4) {
      setPhase("confirm");
      setMessage(`我听到的是 ${cleaned.split("").join("，")}，请确认后查询。`);
      speak(`我听到的是 ${cleaned.split("").join("，")}，请确认。`, voiceEnabled);
    }
  }

  function startListening() {
    const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage("当前浏览器不支持语音识别，请直接输入四位数字");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => changeLast4(parseSpokenLast4(event.results[0][0].transcript));
    recognition.onerror = () => setMessage("没有听清，请再说一次或直接输入");
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    setMessage("正在听，请说手机号后四位");
    recognition.start();
  }

  async function confirmAndMatch() {
    if (last4.length !== 4) return;
    setPhase("searching");
    setMessage("正在精确匹配订单");
    try {
      const result = await postDemo<MatchResponse>("match", { session_id: sessionId, phone_last4: last4 });
      if (result.outcome === "matched" && result.order && result.checkinCase) {
        setMatchedOrder(result.order);
        setCheckinCase(result.checkinCase);
        setPhase(result.checkinCase.status === "READY_FOR_ONSITE_HANDOFF" ? "complete" : "matched");
        setMessage(`已找到 ${result.order.source} 订单，请核对脱敏信息`);
        speak(`已找到${result.order.source}订单。请核对后，将身份证放在读卡器上。`, voiceEnabled);
      } else if (result.outcome === "ambiguous") {
        setAlternatives(result.orders ?? []);
        setPhase("ambiguous");
        setMessage("找到多笔订单，AI 已暂停自动选择");
        speak("找到多笔订单，我不能替您猜选，请联系工作人员复核。", voiceEnabled);
      } else if (result.outcome === "not_found") {
        setPhase("not_found");
        setMessage("没有找到线上订单，可以创建现场办理单");
      } else {
        setPhase("blocked");
        setAlternatives(result.orders ?? []);
        setMessage(result.outcome === "already_checked_in" ? "该订单已经入住，不能重复办理" : "该订单已经取消，不能继续办理");
      }
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("订单服务暂时不可用，请稍后重试");
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
      setMessage("现场办理单已创建，请模拟放置身份证");
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
      let result = await postDemo<{ checkinCase: CheckinCase }>("verify-identity", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      speak("身份证模拟核验通过，正在锁定房间。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(2);
      result = await postDemo<{ checkinCase: CheckinCase }>("hold-room", { session_id: sessionId, case_id: checkinCase.id, room_number: "1208" });
      setCheckinCase(result.checkinCase);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setFlowStep(3);
      result = await postDemo<{ checkinCase: CheckinCase }>("browser-start", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(result.checkinCase);
      speak("正在广州隔离演示环境中模拟住宿登记。", voiceEnabled);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const completed = await postDemo<{ checkinCase: CheckinCase; receipt: string }>("browser-complete", { session_id: sessionId, case_id: checkinCase.id });
      setCheckinCase(completed.checkinCase);
      setMatchedOrder((current) => current ? { ...current, status: "ready_for_hardware", room_number: completed.checkinCase.room_number } : current);
      setFlowStep(4);
      setPhase("complete");
      speak("登记模拟完成。请等待现场工作人员制作并发放房卡。", voiceEnabled);
      await onRefresh();
    } catch {
      setPhase("error");
      setMessage("流程已安全暂停，未执行后续操作，请工作人员检查日志");
      await onRefresh();
    }
  }

  const showEntry = phase === "idle" || phase === "confirm" || phase === "searching";
  return <main className="min-h-screen bg-[#f5f5f7] px-5 py-6 text-[#1d1d1f] md:px-10">
    <header className="mx-auto flex max-w-6xl items-center justify-between"><div><p className="font-semibold tracking-tight">Hotel Agent OS</p><p className="mt-1 text-xs text-[#86868b]">广州示范店 · 数据库演示环境</p></div><div className="flex items-center gap-2"><button onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Volume2 size={14} className="mr-1 inline" />{voiceEnabled ? "语音开启" : "已静音"}</button><button onClick={onOpenAdmin} className="rounded-full bg-white px-3 py-2 text-xs text-[#6e6e73] shadow-sm"><Settings2 size={14} className="mr-1 inline" />管理后台</button></div></header>
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col items-center justify-center py-12 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />本地小模型交互 · 身份原始字段不进 AI</div>
      <h1 className="mt-7 max-w-4xl text-4xl font-semibold tracking-[-.055em] md:text-6xl">{activeMessage}</h1>
      <p className="mt-4 text-base text-[#86868b]">每一步由固定业务接口执行，AI 只负责交流与编排。</p>

      {showEntry && <div className="mt-10 flex flex-col items-center"><InputOTP maxLength={4} value={last4} onChange={changeLast4} disabled={phase === "searching"}><InputOTPGroup>{[0, 1, 2, 3].map((index) => <InputOTPSlot key={index} index={index} className="h-16 w-14 border-[#d2d2d7] bg-white text-2xl shadow-sm first:rounded-l-2xl last:rounded-r-2xl md:h-20 md:w-20 md:text-3xl" />)}</InputOTPGroup></InputOTP><div className="mt-6 flex gap-3"><button onClick={startListening} disabled={listening || phase === "searching"} className="grid h-12 w-12 place-items-center rounded-full bg-[#1d1d1f] text-white disabled:opacity-50" aria-label="语音输入手机号后四位">{listening ? <LoaderCircle size={20} className="animate-spin" /> : <Mic size={20} />}</button><button onClick={confirmAndMatch} disabled={last4.length !== 4 || phase === "searching"} className="rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white disabled:opacity-35">{phase === "searching" ? "查询中…" : "确认并查询"}</button></div><p className="mt-4 text-xs text-[#86868b]">演示号码：4821 正常 · 1188 重复 · 7366 已入住 · 4402 已取消</p></div>}

      {matchedOrder && (phase === "matched" || phase === "processing" || phase === "complete") && <section className="mt-9 w-full max-w-3xl rounded-[2rem] bg-white p-6 text-left shadow-sm md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">已匹配订单</p><h2 className="mt-2 text-2xl font-semibold">{matchedOrder.source} · {matchedOrder.order_code}</h2></div><span className="rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs text-[#248a4d]">手机号 {matchedOrder.phone_masked}</span></div><div className="mt-6 grid grid-cols-2 gap-4 border-y border-[#ededf0] py-5 text-sm md:grid-cols-4"><Info label="入住日期" value={matchedOrder.stay_date} /><Info label="房型" value={matchedOrder.room_type} /><Info label="晚数" value={`${matchedOrder.nights} 晚`} /><Info label="订单状态" value={STATUS_LABELS[matchedOrder.status] ?? matchedOrder.status} /></div>{phase === "matched" && <button onClick={runCheckin} className="mt-6 w-full rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white"><KeyRound size={18} className="mr-2 inline" />模拟放置身份证并继续</button>}</section>}

      {phase === "ambiguous" && <RiskCard title="找到多笔待入住订单" text="仅凭手机号后四位无法确认是哪一笔。AI 已停止自动选择，需要工作人员核对完整手机号或订单号。" orders={alternatives} />}
      {phase === "blocked" && <RiskCard title="该订单不能继续自动办理" text={message} orders={alternatives} />}
      {phase === "not_found" && <section className="mt-9 w-full max-w-xl rounded-[2rem] bg-white p-7 shadow-sm"><Database className="mx-auto text-[#007aff]" /><h2 className="mt-4 text-xl font-semibold">线上订单未找到</h2><p className="mt-2 text-sm leading-6 text-[#6e6e73]">如果客人确实是现场到店，可以创建一笔独立的演示现场办理单。</p><button onClick={createWalkIn} className="mt-5 rounded-full bg-[#007aff] px-6 py-3 text-sm font-medium text-white">创建现场办理单</button></section>}
      {phase === "error" && <RiskCard title="流程已安全暂停" text={message} orders={[]} />}

      {(phase === "processing" || phase === "complete") && <div className="mt-8 grid w-full gap-5 lg:grid-cols-[1fr_.9fr]">
        <section className="rounded-[2rem] bg-white p-6 text-left shadow-sm"><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">业务状态机</p><div className="mt-5 space-y-3">{TERMINAL_PROGRESS.map(([label, detail], index) => <div key={label} className={`flex items-center gap-3 rounded-2xl p-3 ${index === flowStep ? "bg-[#eef6ff]" : ""}`}><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${index < flowStep || phase === "complete" ? "bg-[#1d1d1f] text-white" : index === flowStep ? "bg-[#007aff] text-white" : "bg-[#e5e5ea] text-[#86868b]"}`}>{index < flowStep || phase === "complete" ? <Check size={15} /> : index + 1}</div><div><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-[#86868b]">{detail}</p></div></div>)}</div></section>
        <section className="overflow-hidden rounded-[2rem] bg-[#15171a] text-left text-white shadow-sm"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></div><span className="text-[11px] text-[#8e8e93]">隔离演示浏览器</span></div><div className="p-6"><MonitorCog className="text-[#64d2ff]" /><p className="mt-5 text-xs uppercase tracking-[.16em] text-[#8e8e93]">模拟公安住宿登记 · 广州</p><h2 className="mt-2 text-xl font-semibold">{flowStep < 3 ? "等待前置核验" : phase === "complete" ? "演示回执已生成" : "正在提交模拟字段"}</h2><div className="mt-5 space-y-3 font-mono text-xs text-[#aeaeb2]"><p>identity_token: DEMO-••••</p><p>room: {checkinCase?.room_number ?? "pending"}</p><p>receipt: {checkinCase?.police_receipt ?? "pending"}</p><p>mode: SIMULATION_ONLY</p></div><p className="mt-6 rounded-xl bg-white/5 p-3 text-xs leading-5 text-[#8e8e93]">未连接真实公安系统；不展示姓名、身份证号或证件照片。</p></div></section>
      </div>}

      {phase === "complete" && <section className="mt-6 w-full max-w-3xl rounded-[2rem] border border-[#bde7cf] bg-[#effaf4] p-6"><CircleCheck className="mx-auto text-[#248a4d]" size={30} /><h2 className="mt-3 text-2xl font-semibold">登记完成，等待现场人员发卡</h2><p className="mt-2 text-sm text-[#52745f]">系统没有模拟“房卡已发出”或“客人已入住”，硬件部署人员完成后续动作。</p></section>}
      {!showEntry && <button onClick={reset} className="mt-7 inline-flex items-center gap-2 text-sm text-[#6e6e73]"><RefreshCcw size={15} />办理下一位</button>}
    </section>
    <footer className="mx-auto max-w-5xl pb-5 text-center text-xs text-[#86868b]">演示系统 · {adapter.provider} 临时适配器 · D1 假订单 {snapshot.orders.length} 笔 · PMS、公安浏览器和硬件均未连接生产环境</footer>
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
    <div className="mx-auto max-w-7xl p-5 md:p-9"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><AdminMetric label="假订单" value={String(snapshot.orders.length)} note="每个浏览器会话独立" /><AdminMetric label="办理任务" value={String(snapshot.cases.length)} note="状态变更写入数据库" /><AdminMetric label="浏览器任务" value={String(snapshot.browserJobs.length)} note="仅隔离模拟" /><AdminMetric label="审计事件" value={String(snapshot.auditEvents.length)} note="倒序显示最近 80 条" /></div>
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

function StatusPill({ value }: { value: string }) {
  const safe = value === "cancelled" || value.includes("BLOCKED");
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${safe ? "bg-[#fff1ed] text-[#b63d13]" : "bg-[#e8f7ee] text-[#248a4d]"}`}>{STATUS_LABELS[value] ?? value}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-7 text-center text-sm text-[#829ab1]">{text}</div>;
}
