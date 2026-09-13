"use client";

import { useMemo, useState } from "react";
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
  const [terminalMode, setTerminalMode] = useState(false);
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
  const [terminalState, setTerminalState] = useState<"welcome" | "reading" | "processing" | "handoff">("welcome");
  const copy = {
    welcome: { eyebrow: "欢迎来到", title: "我来帮您快速办理入住", subtitle: "请准备好您的居民身份证。您也可以点击屏幕选择服务。", action: "开始办理入住", icon: <ScanLine size={18} /> },
    reading: { eyebrow: "身份核验", title: "请将身份证放在读卡区域", subtitle: "读取完成后，我会继续为您核对订单与房间。证件原始信息仅在本机受控服务中处理。", action: "模拟读取完成", icon: <CreditCard size={18} /> },
    processing: { eyebrow: "正在为您办理", title: "登记与订单核验中", subtitle: "请稍候。我会实时告诉您下一步；如遇验证码或设备异常，将立即通知值班人员。", action: "模拟遇到异常", icon: <Sparkles size={18} /> },
    handoff: { eyebrow: "已通知服务人员", title: "请稍候，工作人员正在处理", subtitle: "我已把本次异常和终端编号发送给前台与安全岗，您无需重复描述问题。", action: "重新开始", icon: <BellRing size={18} /> },
  }[terminalState];
  const next = () => setTerminalState((value) => value === "welcome" ? "reading" : value === "reading" ? "processing" : value === "processing" ? "handoff" : "welcome");
  return <div className="min-h-[calc(100vh-5rem)] bg-[#061c31] p-4 md:p-8">
    <div className="mx-auto grid max-w-6xl overflow-hidden rounded-[2rem] border border-white/15 bg-[radial-gradient(circle_at_70%_20%,#147b80_0%,#0a3954_35%,#061c31_72%)] shadow-2xl lg:grid-cols-[1.05fr_.95fr]">
      <div className="relative min-h-[540px] overflow-hidden px-7 pb-7 pt-8 md:px-12 md:pt-12">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(42,221,205,.18),transparent_45%)]" />
        <div className="relative z-10 flex items-center justify-between text-sm text-white/75"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#4ee5d5]" />{city} · 自助服务终端</span><span>Hotel Agent OS</span></div>
        <div className="relative z-10 mt-12 max-w-md"><p className="text-sm tracking-[.28em] text-[#76f2e4]">{copy.eyebrow}</p><h2 className="mt-4 text-4xl font-semibold leading-tight text-white md:text-5xl">{copy.title}</h2><p className="mt-5 max-w-sm text-base leading-7 text-[#c5e5e9]">{copy.subtitle}</p></div>
        <div className="relative z-10 mt-10 flex flex-wrap gap-3"><button onClick={next} className="inline-flex items-center gap-2 rounded-xl bg-[#4ee5d5] px-5 py-3 font-medium text-[#062033] hover:bg-[#8af8ec]">{copy.icon}{copy.action}<ChevronRight size={18} /></button><button className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm text-white hover:bg-white/10"><Mic size={17} />语音说“办理入住”</button></div>
        <div className="relative z-10 mt-14 grid max-w-lg grid-cols-3 gap-3 text-center text-xs text-[#bde5e9]"><TerminalStep active={terminalState !== "welcome"} label="身份证" /><TerminalStep active={terminalState === "processing" || terminalState === "handoff"} label="订单核验" /><TerminalStep active={terminalState === "handoff"} label="人工协助" /></div>
      </div>
      <div className="relative grid min-h-[540px] place-items-center overflow-hidden border-t border-white/10 bg-[#082840]/45 px-7 py-10 lg:border-l lg:border-t-0">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 text-sm text-white/70"><span className="inline-flex items-center gap-2"><Volume2 size={17} className="text-[#76f2e4]" />语音前台在线</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">可随时打断</span></div>
        <div className="relative z-10 w-full max-w-sm text-center"><div className="mx-auto grid h-28 w-28 place-items-center rounded-full border border-[#76f2e4]/35 bg-[#4ee5d5]/15 text-[#76f2e4] shadow-[0_0_0_16px_rgba(78,229,213,.06),0_0_60px_rgba(78,229,213,.20)]"><Volume2 size={42} /></div><p className="mt-9 text-sm tracking-[.24em] text-[#76f2e4]">VOICE FEEDBACK</p><h3 className="mt-3 text-2xl font-semibold text-white">语音引导已开启</h3><p className="mt-3 text-sm leading-7 text-[#c5e5e9]">终端播放当前业务状态与下一步指引；无需形象渲染，也不依赖云端视频生成。</p><div className="mt-8 flex h-10 items-center justify-center gap-1.5" aria-label="语音播放状态">{[18, 32, 23, 40, 28, 18, 34, 22, 38, 20, 29].map((height, index) => <span key={index} className="w-1.5 animate-pulse rounded-full bg-[#76f2e4]" style={{ height: `${height}px`, animationDelay: `${index * 80}ms` }} />)}</div><div className="mt-8 rounded-2xl border border-white/15 bg-[#052038]/80 p-4 text-left backdrop-blur"><p className="text-sm font-medium text-white">正在播报</p><p className="mt-1 text-sm leading-6 text-[#c5e5e9]">“您好，我会一步一步引导您完成入住。”</p></div></div>
      </div>
    </div>
    <p className="mx-auto mt-5 max-w-6xl text-center text-xs leading-5 text-[#9dc3cc]">首版仅使用语音和文字反馈；公安登记、支付和发卡由带回执校验的受控业务工具执行。识别到验证码、证书或设备异常时，终端自动转为人工协助。</p>
  </div>;
}

function TerminalStep({ active, label }: { active: boolean; label: string }) {
  return <div className={`rounded-lg border px-2 py-3 ${active ? "border-[#4ee5d5]/50 bg-[#4ee5d5]/15 text-[#8af8ec]" : "border-white/10 bg-white/5"}`}>{active && <CircleCheck className="mx-auto mb-1" size={15} />}{label}</div>;
}
