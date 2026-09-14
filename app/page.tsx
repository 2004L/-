"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BedDouble, BellRing, Bot, Building2, ChevronRight, CircleCheck, CreditCard, DoorOpen, FileText, KeyRound, Landmark, Mic, MonitorCog, ScanLine, ShieldCheck, Sparkles, UserRoundCheck, Volume2, WalletCards, Wrench } from "lucide-react";

type CaseState = "IDENTITY_READ" | "POLICE_REGISTERING" | "POLICE_REGISTERED" | "PAYMENT_SUCCESS" | "ROOM_ASSIGNED" | "CARD_ISSUED" | "IN_HOUSE";

const FLOW: { state: CaseState; label: string; note: string }[] = [
  { state: "IDENTITY_READ", label: "身份已读取", note: "证件读取成功，订单匹配完成" },
  { state: "POLICE_REGISTERING", label: "公安登记中", note: "广州 Worker 正在提交登记页面" },
  { state: "POLICE_REGISTERED", label: "公安已回执", note: "已取得登记回执号" },
  { state: "PAYMENT_SUCCESS", label: "支付已完成", note: "房费和押金状态已确认" },
  { state: "ROOM_ASSIGNED", label: "房间已分配", note: "1208 房已由 PMS 锁定" },
  { state: "CARD_ISSUED", label: "房卡已制作", note: "两张房卡写入完成" },
  { state: "IN_HOUSE", label: "已入住", note: "入住闭环完成，进入住中服务" },
];

const initialLogs = [
  { time: "20:18:04", actor: "身份证服务", text: "创建身份 token · 证件信息不进入 AI 上下文" },
  { time: "20:18:07", actor: "AI 入住代理", text: "订单匹配，建议办理公安登记并分配高楼层房间" },
  { time: "20:18:10", actor: "广州公安 Worker", text: "浏览器会话可用，已进入住宿登记页面" },
];

export default function Home() {
  const [step, setStep] = useState(0);
  const [terminalMode, setTerminalMode] = useState(true);
  const [logs, setLogs] = useState(initialLogs);
  const [city, setCity] = useState<"广州" | "珠海">("广州");
  const [departmentTasks, setDepartmentTasks] = useState([
    { department: "保洁部", title: "退房后清洁任务", detail: "退房事件触发后自动推送房号和优先级", icon: <BedDouble size={18} />, color: "text-[#087f73]" },
    { department: "工程部", title: "门锁与发卡机故障", detail: "设备异常时附带设备编号和错误码", icon: <Wrench size={18} />, color: "text-[#b35c00]" },
    { department: "前台与安全岗", title: "公安页面异常", detail: "验证码、证书异常和系统维护一次性转人工", icon: <ShieldCheck size={18} />, color: "text-[#1769aa]" },
  ]);
  const current = FLOW[step];
  const complete = step === FLOW.length - 1;
  const nextAction = useMemo(() => ({
    IDENTITY_READ: "提交公安登记", POLICE_REGISTERING: "读取公安回执", POLICE_REGISTERED: "确认支付",
    PAYMENT_SUCCESS: "锁定房间", ROOM_ASSIGNED: "制作房卡", CARD_ISSUED: "完成入住", IN_HOUSE: "进入住中服务",
  }[current.state]), [current.state]);

  function advance() {
    if (complete) return;
    const next = FLOW[step + 1];
    setStep((value) => value + 1);
    setLogs((value) => [...value, { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), actor: "AI 入住代理", text: `已执行“${nextAction}” · ${next.note}` }]);
  }

  function dispatchTask(index: number) {
    const item = departmentTasks[index];
    setDepartmentTasks((value) => value.map((task, position) => position === index ? { ...task, detail: "已创建工单，等待部门确认处理" } : task));
    setLogs((value) => [...value, { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), actor: "AI 协同代理", text: `已通知${item.department}：${item.title}` }]);
  }

  if (terminalMode) return <VoiceTerminal city={city} />;

  return (
    <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-[#d9e2ec] bg-[#0b2942] px-5 py-6 text-white lg:flex">
        <div className="flex items-center gap-3 border-b border-white/15 pb-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#23b5a5] text-[#08243c]"><Building2 size={22} /></div>
          <div><p className="font-semibold">Hotel Agent OS</p><p className="text-xs text-[#b8c8d8]">开源无人酒店核心</p></div>
        </div>
        <nav className="mt-7 space-y-2 text-sm">
          {["入住任务", "AI 决策", "门店节点", "审计记录", "适配器"].map((item, index) => (
            <button key={item} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ${index === 0 ? "bg-white/14 font-medium" : "text-[#c5d2de] hover:bg-white/8"}`}>
              {index === 0 ? <DoorOpen size={18} /> : index === 1 ? <Bot size={18} /> : index === 2 ? <MonitorCog size={18} /> : index === 3 ? <FileText size={18} /> : <Sparkles size={18} />}{item}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-[#c5d2de]">
          <div className="mb-2 flex items-center gap-2 text-white"><ShieldCheck size={17} className="text-[#38d9c8]" /> 本地身份隔离</div>
          身份证原始字段只在门店执行节点与公安浏览器 Worker 中使用。
        </div>
      </aside>

      <section className="lg:ml-64">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[#d9e2ec] bg-white px-5 py-4 md:px-9">
          <div><p className="text-sm text-[#627d98]">入住任务 / {city}门店</p><h1 className="text-xl font-semibold">AI 自主入住控制台</h1></div>
          <div className="flex items-center gap-3">
            <button onClick={() => setTerminalMode((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-[#cbd9e5] bg-white px-3 py-2 text-sm font-medium text-[#1769aa] hover:bg-[#edf4fa]"><Volume2 size={16} />{terminalMode ? "返回控制台" : "查看语音终端"}</button>
            <div className="rounded-lg border border-[#d9e2ec] bg-[#f8fbfd] p-1 text-sm">{(["广州", "珠海"] as const).map((name) => <button key={name} onClick={() => setCity(name)} className={`rounded-md px-3 py-1.5 ${city === name ? "bg-[#0b2942] text-white" : "text-[#486581]"}`}>{name}</button>)}</div>
            <div className="hidden items-center gap-2 rounded-full bg-[#e7f7f4] px-3 py-2 text-sm text-[#087f73] sm:flex"><span className="h-2 w-2 rounded-full bg-[#15b8a6]" /> 3 个节点在线</div>
          </div>
        </header>

        {terminalMode ? <VoiceTerminal city={city} /> : <div className="mx-auto max-w-7xl p-5 md:p-9">
          <div className="grid gap-4 md:grid-cols-3">
            <Metric icon={<Bot size={19} />} label="AI 执行中的任务" value="12" note="5 个在公安登记阶段" />
            <Metric icon={<Landmark size={19} />} label="公安浏览器 Worker" value="在线" note={`${city}会话健康，最近回执 18 秒前`} accent="teal" />
            <Metric icon={<KeyRound size={19} />} label="发卡机状态" value="可用" note="设备 A01，空白卡 84 张" accent="blue" />
          </div>

          <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
            <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e8eef3] px-6 py-5">
                <div><p className="text-sm font-medium text-[#627d98]">当前入住任务</p><h2 className="mt-1 text-2xl font-semibold">CI-20260913-0087</h2><p className="mt-2 text-sm text-[#627d98]">订单 HZ-34908 · 客人信息已脱敏 · 计划入住 1 晚</p><p className="mt-2 inline-flex rounded-full bg-[#edf4fa] px-2.5 py-1 text-xs font-medium text-[#1769aa]">首期范围：成年人持有效中国居民身份证</p></div>
                <span className="rounded-full bg-[#e7f7f4] px-3 py-1.5 text-sm font-medium text-[#087f73]">AI 正在处理</span>
              </div>
              <div className="p-6">
                <div className="rounded-xl border border-[#c7e8e3] bg-[#f2fbfa] p-5"><div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-[#d8f3ee] p-2 text-[#087f73]"><Sparkles size={19} /></div><div><p className="font-semibold">AI 当前判断</p><p className="mt-1 text-sm leading-6 text-[#486581]">订单与身份状态匹配，建议先完成公安登记。回执成功后，按会员偏好锁定高楼层大床房，并在支付确认后制作两张房卡。</p></div></div></div>
                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {FLOW.map((item, index) => <div key={item.state} className={`rounded-xl border p-4 ${index < step ? "border-[#b8e7de] bg-[#f0fbf8]" : index === step ? "border-[#23b5a5] bg-white ring-2 ring-[#d8f3ee]" : "border-[#e1e8ed] bg-[#fafcfd]"}`}><div className="flex items-center justify-between"><span className="text-xs font-medium text-[#627d98]">{String(index + 1).padStart(2, "0")}</span>{index < step && <CircleCheck size={16} className="text-[#15a98d]" />}</div><p className="mt-3 font-medium">{item.label}</p><p className="mt-1 text-xs leading-5 text-[#627d98]">{item.note}</p></div>)}
                </div>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0b2942] p-5 text-white">
                  <div><p className="font-medium">下一步：{nextAction}</p><p className="mt-1 text-sm text-[#c5d2de]">通过受控工具执行，结果写入任务状态和审计记录。</p></div>
                  <button onClick={advance} disabled={complete} className="inline-flex items-center gap-2 rounded-lg bg-[#23b5a5] px-4 py-2.5 font-medium text-[#08243c] transition hover:bg-[#38d9c8] disabled:cursor-not-allowed disabled:opacity-60">{complete ? "已完成入住" : "让 AI 执行下一步"}<ChevronRight size={18} /></button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-6 py-5"><p className="text-sm font-medium text-[#627d98]">门店执行节点</p><h2 className="mt-1 text-lg font-semibold">{city}节点状态</h2></div><div className="space-y-4 p-5"><Node icon={<MonitorCog size={18} />} title="公安浏览器 Worker" detail="浏览器会话已授权 · 队列 2" status="在线" /><Node icon={<UserRoundCheck size={18} />} title="身份证读卡器服务" detail="设备 HID-02 · 等待读卡" status="在线" /><Node icon={<CreditCard size={18} />} title="发卡机服务" detail="设备 A01 · 最近写卡成功" status="在线" /><Node icon={<WalletCards size={18} />} title="PMS 与支付适配器" detail="订单、房态与预授权同步" status="在线" /></div></section>
          </div>

          <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <section className="rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="flex items-center justify-between border-b border-[#e8eef3] px-6 py-5"><div><p className="text-sm font-medium text-[#627d98]">任务审计</p><h2 className="mt-1 text-lg font-semibold">AI 与系统操作时间线</h2></div><span className="text-sm text-[#627d98]">所有身份字段均使用 token 引用</span></div><div className="divide-y divide-[#edf2f7]">{logs.map((log, index) => <div className="flex gap-4 px-6 py-4" key={`${log.time}-${index}`}><span className="w-16 pt-0.5 font-mono text-xs text-[#829ab1]">{log.time}</span><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#23b5a5]" /><div><p className="text-sm font-medium">{log.actor}</p><p className="mt-1 text-sm text-[#627d98]">{log.text}</p></div></div>)}</div></section>
            <section className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><div className="flex items-start gap-3 border-b border-[#e8eef3] pb-4"><div className="rounded-lg bg-[#f1ecff] p-2 text-[#6c4cc7]"><BellRing size={19} /></div><div><p className="text-sm font-medium text-[#627d98]">AI 协同处置</p><h2 className="mt-1 text-lg font-semibold">跨部门通知接口</h2></div></div><div className="mt-4 space-y-3">{departmentTasks.map((task, index) => <div key={task.department} className="rounded-xl bg-[#f8fbfd] p-4"><div className="flex gap-3"><div className={`mt-0.5 ${task.color}`}>{task.icon}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{task.department}</p><p className="mt-1 text-sm text-[#486581]">{task.title}</p><p className="mt-1 text-xs leading-5 text-[#829ab1]">{task.detail}</p></div></div><button onClick={() => dispatchTask(index)} className="mt-3 rounded-lg border border-[#cbd9e5] bg-white px-3 py-1.5 text-xs font-medium text-[#1769aa] hover:bg-[#edf4fa]">创建通知工单</button></div>)}</div></section>
          </div>
        </div>}
      </section>
    </main>
  );
}

function Metric({ icon, label, value, note, accent = "navy" }: { icon: React.ReactNode; label: string; value: string; note: string; accent?: "navy" | "teal" | "blue" }) {
  const colors = { navy: "bg-[#e8eef5] text-[#0b2942]", teal: "bg-[#e7f7f4] text-[#087f73]", blue: "bg-[#eaf3ff] text-[#1769aa]" };
  return <div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><div className={`grid h-10 w-10 place-items-center rounded-xl ${colors[accent]}`}>{icon}</div><p className="mt-4 text-sm text-[#627d98]">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-2 text-sm text-[#829ab1]">{note}</p></div>;
}

function Node({ icon, title, detail, status }: { icon: React.ReactNode; title: string; detail: string; status: string }) {
  return <div className="flex items-center gap-3 rounded-xl bg-[#f8fbfd] p-4"><div className="rounded-lg bg-white p-2 text-[#1769aa] shadow-sm">{icon}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-1 truncate text-xs text-[#627d98]">{detail}</p></div><span className="rounded-full bg-[#e7f7f4] px-2 py-1 text-xs text-[#087f73]">{status}</span></div>;
}

type DemoScenario = "normal" | "leftBehind" | "mismatch";

const TERMINAL_FLOW = [
  { label: "读卡触发", api: "POST /api/device/id-reader/events", voice: "检测到身份证，请保持证件放置不动，我先确认读卡器状态。" },
  { label: "订单匹配", api: "POST /api/orders/match", voice: "我正在从美团、抖音、团购和网购订单中优先匹配您的手机号。" },
  { label: "身份核验", api: "POST /api/identity/verify", voice: "已找到订单，现在读取身份证信息并核对实名、有效期和订单归属。" },
  { label: "公安登记", api: "POST /api/public-security/lodging/register", voice: "身份与订单核验通过，正在提交公安住宿登记并等待回执。" },
  { label: "政策决策", api: "POST /api/policy/check", voice: "公安登记已取得回执，我正在根据酒店政策准备押金和房型选项。" },
  { label: "支付与选房", api: "POST /api/payment/authorize + /api/pms/room-lock", voice: "请在微信或支付宝完成入住押金，房型确认后我会继续制卡。" },
  { label: "制作房卡", api: "POST /api/doorlock/keycard/issue", voice: "支付和房态已确认，正在为您制作房卡，请稍候。" },
  { label: "请取房卡", api: "POST /api/checkin/complete", voice: "入住办理完成，请从发卡机取走您的房卡，祝您入住愉快。" },
];

type ApiEvent = { step: number; endpoint: string; status: string; detail: string };

function VoiceTerminal({ city }: { city: "广州" | "珠海" }) {
  const flow = TERMINAL_FLOW;
  const [started, setStarted] = useState(false);
  const [flowIndex, setFlowIndex] = useState(-1);
  const [voiceOn, setVoiceOn] = useState(true);
  const [scenario, setScenario] = useState<DemoScenario>("normal");
  const [blocked, setBlocked] = useState(false);
  const [apiEvents, setApiEvents] = useState<ApiEvent[]>([]);
  const active = flowIndex >= 0 ? flow[flowIndex] : null;
  const spoken = active?.voice ?? "您好，请将您的居民身份证放在读卡器上，我将为您自动办理入住。";
  const blockedReason = scenario === "leftBehind"
    ? "读卡器仍感应到上一位客人的证件，无法确认当前证件归属。"
    : "证件姓名与当前订单实名不一致，已暂停自动办理。";

  const riskChecks = scenario === "leftBehind"
    ? [
      { label: "读卡器空位确认", detail: "上一张证件仍在感应区", state: "blocked" },
      { label: "证件 UID 去重", detail: "等待取走后重新读取", state: "pending" },
      { label: "身份与订单匹配", detail: "尚未执行", state: "pending" },
    ]
    : scenario === "mismatch"
      ? [
        { label: "读卡器空位确认", detail: "通过 · 感应区已清空", state: "ok" },
        { label: "证件 UID 去重", detail: "通过 · 本次会话首次出现", state: "ok" },
        { label: "身份与订单匹配", detail: "姓名不一致，转人工复核", state: "blocked" },
      ]
      : [
        { label: "读卡器空位确认", detail: "通过 · 当前证件已稳定放置", state: "ok" },
        { label: "证件 UID 去重", detail: "通过 · 未发现遗留或重复证件", state: "ok" },
        { label: "身份与订单匹配", detail: "通过 · 订单 CI-20260913-0087", state: "ok" },
      ];

  useEffect(() => {
    if (!started || flowIndex < 0) return;
    if (scenario === "leftBehind" && flowIndex === 0) {
      setBlocked(true);
    }
    if (scenario === "mismatch" && flowIndex === 2) {
      setBlocked(true);
    }
    if (voiceOn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }
    setApiEvents((events) => events.some((event) => event.step === flowIndex)
      ? events
      : [...events, {
        step: flowIndex,
        endpoint: active?.api ?? "POST /api/checkin/session",
        status: scenario === "mismatch" && flowIndex === 2 ? "409" : "200",
        detail: scenario === "leftBehind" && flowIndex === 0
          ? "card.present · readerOccupied=true"
          : scenario === "mismatch" && flowIndex === 2
            ? "identity.orderMatch=false · manualReviewRequired=true"
            : flowIndex === 0
              ? "card.present · readerOccupied=false"
              : "accepted · auditId=CI-20260913-0087",
      }]);
    if (blocked || (scenario === "leftBehind" && flowIndex === 0) || (scenario === "mismatch" && flowIndex === 2)) return;
    if (flowIndex < flow.length - 1) {
      const timer = window.setTimeout(() => setFlowIndex((value) => value + 1), 1000);
      return () => window.clearTimeout(timer);
    }
  }, [active?.api, blocked, flowIndex, started, voiceOn, spoken, scenario, flow.length]);

  function startDemo() {
    setStarted(true);
    setBlocked(false);
    setFlowIndex(0);
    setApiEvents([{
      step: -1,
      endpoint: "POST /api/checkin/session",
      status: "201",
      detail: `session.created · city=${city} · mode=${scenario}`,
    }]);
  }

  function resetDemo() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStarted(false);
    setBlocked(false);
    setFlowIndex(-1);
    setApiEvents([]);
  }

  function resolveRisk() {
    if (scenario === "leftBehind") {
      setBlocked(false);
      setScenario("normal");
      setApiEvents((events) => [...events, { step: 0.5, endpoint: "POST /api/device/id-reader/clear", status: "200", detail: "readerOccupied=false · previousCardRemoved=true" }]);
      setFlowIndex(1);
    } else {
      setApiEvents((events) => [...events, { step: 1.5, endpoint: "POST /api/manual-review/tasks", status: "202", detail: "人工复核工单已创建 · AI 不代替放行" }]);
      setBlocked(false);
      setStarted(false);
      setFlowIndex(-1);
    }
  }

  return <main className="min-h-screen bg-[#f5f5f7] px-6 py-7 text-[#1d1d1f] md:px-12 md:py-9">
    <header className="mx-auto flex max-w-6xl items-center justify-between text-sm"><span className="font-semibold tracking-tight">入住</span><div className="flex items-center gap-4"><div className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-sm sm:flex">{(["normal", "leftBehind", "mismatch"] as DemoScenario[]).map((item) => <button key={item} onClick={() => { setScenario(item); resetDemo(); }} className={`rounded-full px-3 py-1.5 text-xs ${scenario === item ? "bg-[#1d1d1f] text-white" : "text-[#6e6e73]"}`}>{item === "normal" ? "正常流程" : item === "leftBehind" ? "遗留证件" : "信息不一致"}</button>)}</div><button onClick={() => setVoiceOn((value) => !value)} className="inline-flex items-center gap-2 text-[#6e6e73]"><span className={`h-2 w-2 rounded-full ${voiceOn ? "bg-[#30d158]" : "bg-[#a1a1a6]"}`} />{voiceOn ? "语音开启" : "静音"}</button></div></header>
    <section className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-4xl flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-[#6e6e73]">{city} · AI 自助入住</p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />本地安全模型 · Qwen3.8-27B（示意） · 敏感字段留在门店节点</div>
      <h1 className="mt-5 text-5xl font-semibold tracking-[-.06em] md:text-7xl">{blocked ? "请先处理证件。" : "把身份证放上来。"}</h1>
      <p className="mt-4 text-2xl tracking-[-.03em] text-[#6e6e73] md:text-3xl">剩下的，交给 AI。</p>
      <button onClick={started ? resetDemo : startDemo} aria-label={started ? "重新开始演示" : "模拟放置身份证"} className={`mt-14 grid h-28 w-28 place-items-center rounded-full text-white shadow-[0_20px_50px_rgba(0,0,0,.14)] transition ${started ? "bg-[#007aff]" : "bg-[#1d1d1f] hover:scale-105"}`}>{started ? <Volume2 size={39} /> : <Mic size={39} />}</button>
      <p className="mt-6 text-lg font-medium">{blocked ? blockedReason : started ? "AI 正在为您办理" : "点按开始，模拟感应到身份证"}</p>
      <p className="mt-3 max-w-xl text-lg leading-8 text-[#6e6e73]">“{spoken}”</p>
      <div className="mt-10 flex h-8 items-center justify-center gap-1" aria-label="语音播放状态">{[13, 22, 30, 19, 35, 24, 14, 28, 18].map((height, index) => <span key={index} className={`w-1 rounded-full bg-[#007aff] ${started ? "animate-pulse" : "opacity-30"}`} style={{ height: `${height}px`, animationDelay: `${index * 90}ms` }} />)}</div>
      <div className="mt-14 flex max-w-full items-start justify-center gap-0 overflow-x-auto px-2 pb-2">{flow.map((item, index) => { const complete = flowIndex > index; const current = flowIndex === index; return <div key={item.label} className="flex items-center"><div className="w-20 text-center sm:w-28"><div className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-xs ${complete ? "bg-[#1d1d1f] text-white" : current ? "bg-[#007aff] text-white" : "bg-[#d2d2d7] text-[#6e6e73]"}`}>{complete ? <CircleCheck size={15} /> : index + 1}</div><p className={`mt-3 whitespace-nowrap text-xs ${current || complete ? "font-medium text-[#1d1d1f]" : "text-[#86868b]"}`}>{item.label}</p></div>{index < flow.length - 1 && <span className={`mb-6 h-px w-8 sm:w-14 ${complete ? "bg-[#1d1d1f]" : "bg-[#d2d2d7]"}`} />}</div>})}</div>
      <div className="mt-9 grid w-full gap-4 text-left md:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-2xl border border-[#e1e1e6] bg-white/80 p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">后台接口</p><p className="mt-1 text-sm font-medium">每一步都有可追踪的事件</p></div><span className="rounded-full bg-[#e8f7ee] px-2.5 py-1 text-xs text-[#248a4d]">模拟实时</span></div><p className="mt-3 text-xs text-[#86868b]">订单来源：美团 · 抖音 · 团购 · 网购　/　手机号优先匹配</p><div className="mt-3 space-y-2">{(apiEvents.length ? apiEvents.slice(-3) : [{ step: -1, endpoint: "等待身份证事件", status: "—", detail: "检测到 card.present 后自动开始" }]).map((event, index) => <div key={`${event.endpoint}-${index}`} className="rounded-xl bg-[#f6f6f8] px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="truncate font-mono text-[11px] text-[#5f5f66]">{event.endpoint}</span><span className={`font-mono text-[11px] ${event.status === "200" || event.status === "201" ? "text-[#248a4d]" : event.status === "409" ? "text-[#d04a00]" : "text-[#86868b]"}`}>{event.status}</span></div><p className="mt-1 truncate text-xs text-[#86868b]">{event.detail}</p></div>)}</div></section>
        <section className={`rounded-2xl border p-4 shadow-sm ${blocked ? "border-[#f1c7b5] bg-[#fff8f4]" : "border-[#e1e1e6] bg-white/80"}`}><div className="flex items-center gap-2"><div className={`rounded-lg p-1.5 ${blocked ? "bg-[#ffe4d6] text-[#c54b12]" : "bg-[#e8f7ee] text-[#248a4d]"}`}>{blocked ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}</div><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">风险核验</p><p className="mt-1 text-sm font-medium">先核验，再放行</p></div></div><div className="mt-3 space-y-2">{riskChecks.map((check) => <div key={check.label} className="flex items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full ${check.state === "ok" ? "bg-[#30d158]" : check.state === "blocked" ? "bg-[#ff6b35]" : "bg-[#c7c7cc]"}`} /><span className="font-medium">{check.label}</span><span className="truncate text-[#86868b]">{check.detail}</span></div>)}</div>{blocked && <button onClick={resolveRisk} className="mt-3 w-full rounded-xl bg-[#1d1d1f] px-3 py-2.5 text-sm font-medium text-white">{scenario === "leftBehind" ? "确认已取走上一张证件" : "创建人工复核工单"}</button>}</section>
      </div>
      {started && flowIndex === 5 && <div className="mt-4 w-full rounded-2xl border border-[#d9e8ff] bg-[#f7fbff] p-4 text-left shadow-sm"><p className="text-xs font-medium uppercase tracking-[.16em] text-[#6e6e73]">支付与房型选择</p><div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-white px-3 py-2 text-[#1d1d1f] shadow-sm">入住押金 ¥200</span><span className="rounded-full bg-[#eaf3ff] px-3 py-2 font-medium text-[#1769aa]">微信</span><span className="rounded-full bg-[#e8f7ee] px-3 py-2 font-medium text-[#248a4d]">支付宝</span><span className="rounded-full bg-white px-3 py-2 text-[#1d1d1f] shadow-sm">1208 · 高楼层大床房</span></div></div>}
      {started && flowIndex === 6 && <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-[#30d158]" />发卡机 A01：正在制作房卡</div>}
    </section>
    <p className="mx-auto max-w-4xl text-center text-xs text-[#86868b]">演示模式：接口、公安浏览器、支付、PMS 与发卡均为模拟；真实环境由固定业务规则和人工兜底决定是否放行。</p>
  </main>;
}
