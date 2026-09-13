"use client";

import { useEffect, useMemo, useState } from "react";
import { BedDouble, BellRing, Bot, Building2, ChevronRight, CircleCheck, CreditCard, DoorOpen, FileText, KeyRound, Landmark, Mic, MonitorCog, ScanLine, ShieldCheck, Sparkles, UserRoundCheck, Volume2, WalletCards, Wrench } from "lucide-react";

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

function VoiceTerminal({ city }: { city: "广州" | "珠海" }) {
  const flow = [
    { label: "身份证已读取", detail: "订单匹配完成", voice: "身份证读取完成，正在为您核对入住订单。", icon: <CreditCard size={18} /> },
    { label: "登记信息提交", detail: "模拟公安登记回执", voice: "入住登记信息已提交，正在等待系统确认。", icon: <ShieldCheck size={18} /> },
    { label: "订单与支付核验", detail: "房费状态确认", voice: "订单和支付状态核验完成。", icon: <WalletCards size={18} /> },
    { label: "房间自动分配", detail: "1208 房已锁定", voice: "已为您分配十二零八房。", icon: <BedDouble size={18} /> },
    { label: "制作房卡", detail: "发卡机正在写卡", voice: "正在为您制作房卡，请稍候。", icon: <KeyRound size={18} /> },
    { label: "请取走房卡", detail: "入住办理完成", voice: "入住办理完成，请从发卡机取走您的房卡，祝您入住愉快。", icon: <CircleCheck size={18} /> },
  ];
  const [started, setStarted] = useState(false);
  const [flowIndex, setFlowIndex] = useState(-1);
  const [voiceOn, setVoiceOn] = useState(true);
  const active = flowIndex >= 0 ? flow[flowIndex] : null;
  const spoken = active?.voice ?? "您好，请将您的居民身份证放在读卡器上，我将为您自动办理入住。";

  useEffect(() => {
    if (!started || flowIndex < 0) return;
    if (voiceOn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }
    if (flowIndex < flow.length - 1) {
      const timer = window.setTimeout(() => setFlowIndex((value) => value + 1), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [flowIndex, started, voiceOn, spoken, flow.length]);

  function startDemo() {
    setStarted(true);
    setFlowIndex(0);
  }

  function resetDemo() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStarted(false);
    setFlowIndex(-1);
  }

  return <div className="min-h-[calc(100vh-5rem)] bg-[#07131f] p-3 md:p-7">
    <div className="mx-auto min-h-[calc(100vh-8.5rem)] max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_50%_8%,#153f55_0%,#071923_45%,#07131f_100%)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 text-sm text-[#b7ccd8] md:px-8"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#55e1d0]" />{city} 自助入住终端</span><span>演示模式 · 不连接真实系统</span></div>
      <div className="grid min-h-[calc(100vh-12rem)] lg:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
        <section className="flex flex-col items-center justify-center px-6 py-12 text-center md:px-12">
          <p className="text-sm tracking-[.25em] text-[#73e9dc]">AI 语音前台</p>
          <div className="mt-8 flex h-40 w-40 items-center justify-center rounded-full border border-[#5de9d8]/35 bg-[#5de9d8]/10 text-[#7cf4e5] shadow-[0_0_0_18px_rgba(93,233,216,.05),0_0_90px_rgba(93,233,216,.15)]"><Volume2 size={62} /></div>
          <div className="mt-9 flex h-12 items-center justify-center gap-1.5" aria-label="AI 语音波形">{[16, 29, 42, 24, 36, 48, 30, 18, 39, 26, 44, 20, 34].map((height, index) => <span key={index} className={`w-1.5 rounded-full bg-[#75efe0] ${started ? "animate-pulse" : "opacity-35"}`} style={{ height: `${height}px`, animationDelay: `${index * 70}ms` }} />)}</div>
          <div className="mt-7 max-w-xl"><p className="text-2xl font-semibold leading-9 text-white md:text-3xl">“{spoken}”</p><p className="mt-4 text-base leading-7 text-[#b7ccd8]">{started ? "AI 正在自动执行入住流程，您无需再操作终端。" : "请把身份证放在读卡器上，之后等待系统自动发卡。"}</p></div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3"><button onClick={started ? resetDemo : startDemo} className="inline-flex items-center gap-2 rounded-full bg-[#68eadb] px-6 py-3.5 font-medium text-[#06202b] hover:bg-[#a1fff1]">{started ? <><Mic size={18} />重新演示</> : <><ScanLine size={18} />模拟放置身份证</>}</button><button onClick={() => setVoiceOn((value) => !value)} className="rounded-full border border-white/20 px-5 py-3.5 text-sm text-white hover:bg-white/10">{voiceOn ? "语音已开启" : "语音已静音"}</button></div>
          <p className="mt-6 text-xs text-[#7899aa]">语音由浏览器演示播放；展示流程中的登记、支付与发卡均为模拟状态。</p>
        </section>
        <aside className="border-t border-white/10 bg-[#06121b]/55 p-6 lg:border-l lg:border-t-0 md:p-8"><p className="text-sm tracking-[.18em] text-[#73e9dc]">AI 自动办理进度</p><h2 className="mt-3 text-2xl font-semibold text-white">客人只需读身份证</h2><p className="mt-2 text-sm leading-6 text-[#a9c3d0]">读卡成功后，AI 按固定受控顺序完成后续步骤。</p><div className="mt-8 space-y-3">{flow.map((item, index) => { const done = flowIndex > index; const current = flowIndex === index; return <div key={item.label} className={`flex gap-3 rounded-2xl border p-4 ${done ? "border-[#55e1d0]/35 bg-[#55e1d0]/10" : current ? "border-[#75efe0]/70 bg-white/10" : "border-white/10 bg-white/[.03]"}`}><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${done || current ? "bg-[#55e1d0] text-[#07202a]" : "bg-white/10 text-[#95adba]"}`}>{done ? <CircleCheck size={18} /> : item.icon}</div><div><p className="font-medium text-white">{item.label}</p><p className="mt-1 text-sm text-[#9eb8c5]">{item.detail}</p></div>{current && <span className="ml-auto mt-1 h-2 w-2 animate-pulse rounded-full bg-[#75efe0]" />}</div>})}</div><div className="mt-7 rounded-2xl border border-[#55e1d0]/20 bg-[#55e1d0]/5 p-4 text-sm leading-6 text-[#c1f4ed]"><span className="font-medium">演示边界：</span>不写入真实身份信息，不连接公安、支付、PMS 或发卡设备。</div></aside>
      </div>
    </div>
  </div>;
}
