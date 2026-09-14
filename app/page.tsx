"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BedDouble, BellRing, Bot, Building2, ChevronRight, CircleCheck, CreditCard, DoorOpen, FileText, KeyRound, Landmark, Mic, MonitorCog, ShieldCheck, Sparkles, UserRoundCheck, Volume2, WalletCards, Wrench } from "lucide-react";

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

type AdapterConfig = {
  provider: string;
  version: string;
  baseUrl: string;
  apiKey: string;
  propertyCode: string;
  hotelName: string;
};

const DEFAULT_ADAPTER: AdapterConfig = {
  provider: "QloApps",
  version: "1.6.1",
  baseUrl: "https://pms.example.local/api",
  apiKey: "TEMP_PMS_API_KEY_REPLACE_ME",
  propertyCode: "GZ-HAOS-001",
  hotelName: "Hotel Agent OS 广州示范店",
};

export default function Home() {
  const [step, setStep] = useState(0);
  const [terminalMode, setTerminalMode] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [logs, setLogs] = useState(initialLogs);
  const [city, setCity] = useState<"广州" | "珠海">("广州");
  const [adapterConfig, setAdapterConfig] = useState<AdapterConfig>(DEFAULT_ADAPTER);
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

  if (!setupComplete) return <AdapterWizard city={city} onCityChange={setCity} onComplete={(config) => { setAdapterConfig(config); setSetupComplete(true); }} />;
  if (adminMode) return <AdminConsole city={city} adapter={adapterConfig} onBack={() => setAdminMode(false)} onReconfigure={() => { setAdminMode(false); setSetupComplete(false); }} />;
  if (terminalMode) return <VoiceTerminal city={city} adapter={adapterConfig} onOpenAdmin={() => setAdminMode(true)} onReconfigure={() => setSetupComplete(false)} />;

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

function AdapterWizard({ city, onCityChange, onComplete }: { city: "广州" | "珠海"; onCityChange: (city: "广州" | "珠海") => void; onComplete: (config: AdapterConfig) => void }) {
  const [stage, setStage] = useState(0);
  const [draft, setDraft] = useState<AdapterConfig>({ ...DEFAULT_ADAPTER, propertyCode: city === "珠海" ? "ZH-HAOS-001" : DEFAULT_ADAPTER.propertyCode, hotelName: `Hotel Agent OS ${city}示范店` });
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<{ label: string; status: string; detail: string }[]>([]);
  const [adapted, setAdapted] = useState(false);

  function update(field: keyof AdapterConfig, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function runChecks() {
    setChecking(true);
    const operations = [
      ["订单查询", "orders", "GET"],
      ["房态查询", "rooms", "GET"],
      ["临时锁房", "hold", "POST"],
      ["入住确认", "checkin", "POST"],
      ["退房确认", "checkout", "POST"],
    ] as const;
    const result = await Promise.all(operations.map(async ([label, operation, method]) => {
      try {
        const response = await fetch(`/api/pms/${operation}`, { method });
        return { label, status: response.ok ? "通过" : "失败", detail: response.ok ? "适配器响应正常" : "请检查接口映射" };
      } catch {
        return { label, status: "待确认", detail: "当前环境无法访问接口" };
      }
    }));
    setChecks(result);
    setChecking(false);
    setStage(2);
  }

  function autoAdapt() {
    setAdapted(true);
    setDraft((current) => ({ ...current, baseUrl: current.baseUrl || DEFAULT_ADAPTER.baseUrl, propertyCode: current.propertyCode || (city === "珠海" ? "ZH-HAOS-001" : DEFAULT_ADAPTER.propertyCode), hotelName: current.hotelName || `Hotel Agent OS ${city}示范店` }));
  }

  return <main className="min-h-screen bg-[#f5f5f7] px-6 py-8 text-[#1d1d1f] md:px-12 md:py-12"><section className="mx-auto max-w-4xl"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold tracking-tight">Hotel Agent OS</p><p className="mt-2 text-sm text-[#6e6e73]">首次启动 · 创建独立酒店实例</p></div><span className="rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm">适配向导 {stage + 1}/3</span></div><div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_.75fr]"><section className="rounded-3xl bg-white p-6 shadow-sm md:p-8"><p className="text-xs font-medium uppercase tracking-[.18em] text-[#86868b]">{stage === 0 ? "创建实例" : stage === 1 ? "填写适配器" : "检测与确认"}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] md:text-4xl">{stage === 0 ? "先把酒店接入。" : stage === 1 ? "填写 PMS 连接信息。" : "确认适配结果。"}</h1><p className="mt-3 text-base leading-7 text-[#6e6e73]">{stage === 0 ? "每个酒店实例都有独立的管理后台、配置和审计记录。" : stage === 1 ? "API Key 先使用临时占位符，接入真实 PMS 前再替换。" : "普通字段可以自动补齐，涉及订单、房态和放行的关键字段需要管理员确认。"}</p>{stage === 0 && <div className="mt-8 space-y-5"><label className="block text-sm font-medium">酒店所在城市<select value={city} onChange={(event) => { const value = event.target.value as "广州" | "珠海"; onCityChange(value); update("propertyCode", value === "珠海" ? "ZH-HAOS-001" : "GZ-HAOS-001"); update("hotelName", `Hotel Agent OS ${value}示范店`); }} className="mt-2 w-full rounded-xl border border-[#d9d9df] bg-white px-3 py-3 text-sm outline-none focus:border-[#007aff]"><option>广州</option><option>珠海</option></select></label><label className="block text-sm font-medium">酒店名称<input value={draft.hotelName} onChange={(event) => update("hotelName", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 text-sm outline-none focus:border-[#007aff]" /></label></div>}{stage === 1 && <div className="mt-8 grid gap-5 sm:grid-cols-2"><label className="text-sm font-medium">PMS<select value={draft.provider} onChange={(event) => update("provider", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] bg-white px-3 py-3 text-sm"><option>QloApps</option><option>Kamra PMS</option><option>inPMS</option><option>自定义 PMS</option></select></label><label className="text-sm font-medium">版本<input value={draft.version} onChange={(event) => update("version", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 text-sm" /></label><label className="text-sm font-medium sm:col-span-2">PMS API 地址<input value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 text-sm" /></label><label className="text-sm font-medium sm:col-span-2">API Key<input value={draft.apiKey} onChange={(event) => update("apiKey", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 font-mono text-xs" /><span className="mt-1 block text-xs text-[#8a6400]">临时占位：替换前不会向外部 PMS 发起真实写入</span></label><label className="text-sm font-medium sm:col-span-2">酒店编码<input value={draft.propertyCode} onChange={(event) => update("propertyCode", event.target.value)} className="mt-2 w-full rounded-xl border border-[#d9d9df] px-3 py-3 font-mono text-sm" /></label></div>}{stage === 2 && <div className="mt-8 space-y-5"><div className="rounded-2xl bg-[#f6f6f8] p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">{draft.provider} {draft.version}</p><span className="rounded-full bg-[#fff1c7] px-2.5 py-1 text-xs text-[#8a6400]">临时占位模式</span></div><p className="mt-2 text-xs text-[#6e6e73]">{draft.baseUrl} · {draft.propertyCode}</p></div><div className="space-y-2">{checks.map((item) => <div key={item.label} className="flex items-center justify-between rounded-xl border border-[#ececf0] px-3 py-3 text-sm"><span>{item.label}</span><span className={item.status === "通过" ? "text-[#248a4d]" : "text-[#8a6400]"}>{item.status} · {item.detail}</span></div>)}</div>{adapted && <div className="rounded-2xl border border-[#bde7d1] bg-[#f1fbf5] p-4 text-sm text-[#248a4d]">已自动补齐普通字段和示范房型映射，关键放行字段仍需管理员在后台确认。</div>}<button onClick={autoAdapt} className="w-full rounded-xl border border-[#d9d9df] bg-white px-4 py-3 text-sm font-medium">自动补齐缺失配置</button></div>}<div className="mt-8 flex justify-between gap-3"><button onClick={() => setStage((value) => Math.max(0, value - 1))} disabled={stage === 0} className="rounded-xl px-4 py-3 text-sm text-[#6e6e73] disabled:opacity-30">上一步</button>{stage < 2 ? <button onClick={() => stage === 0 ? setStage(1) : runChecks()} disabled={checking} className="rounded-xl bg-[#1d1d1f] px-5 py-3 text-sm font-medium text-white">{stage === 0 ? "继续填写适配器" : checking ? "检测中…" : "开始接口检测"}</button> : <button onClick={() => onComplete(draft)} className="rounded-xl bg-[#007aff] px-5 py-3 text-sm font-medium text-white">完成适配，进入系统</button>}</div></section><aside className="space-y-4"><div className="rounded-3xl bg-[#1d1d1f] p-6 text-white"><p className="text-xs uppercase tracking-[.18em] text-[#a1a1a6]">本实例隔离</p><p className="mt-3 text-lg font-medium">独立后台 · 独立密钥 · 独立审计</p><p className="mt-3 text-sm leading-6 text-[#c7c7cc]">后续每个酒店都可以单独配置 PMS、设备、支付规则和人工通知策略。</p></div><div className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-xs uppercase tracking-[.18em] text-[#86868b]">自动适配边界</p><div className="mt-4 space-y-3 text-sm text-[#6e6e73]"><p><span className="mr-2 text-[#248a4d]">●</span>字段名称、房型和房间映射可建议</p><p><span className="mr-2 text-[#248a4d]">●</span>订单来源和手机号匹配可自动检测</p><p><span className="mr-2 text-[#d04a00]">●</span>入住、支付、公安登记不能自动越权</p></div></div></aside></div></section></main>;
}

function AdminConsole({ city, adapter, onBack, onReconfigure }: { city: "广州" | "珠海"; adapter: AdapterConfig; onBack: () => void; onReconfigure: () => void }) {
  const [tab, setTab] = useState<"overview" | "mapping" | "policy" | "security">("overview");
  const [tests, setTests] = useState<Record<string, string>>({});
  const [phoneFirst, setPhoneFirst] = useState(true);
  const [manualGate, setManualGate] = useState(true);
  const interfaces = [["订单查询", "orders", "GET"], ["房态查询", "rooms", "GET"], ["临时锁房", "hold", "POST"], ["入住确认", "checkin", "POST"], ["退房确认", "checkout", "POST"]] as const;
  async function test(operation: string, method: string) {
    try {
      const response = await fetch(`/api/pms/${operation}`, { method });
      setTests((current) => ({ ...current, [operation]: response.ok ? "通过" : "失败" }));
    } catch {
      setTests((current) => ({ ...current, [operation]: "待确认" }));
    }
  }
  return <main className="min-h-screen bg-[#f3f6f8] text-[#102a43]"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d9e2ec] bg-white px-5 py-4 md:px-9"><div><p className="text-sm text-[#627d98]">独立管理后台 / {city}</p><h1 className="mt-1 text-xl font-semibold">{adapter.hotelName}</h1></div><div className="flex items-center gap-2"><span className="rounded-full bg-[#fff1c7] px-3 py-1.5 text-xs text-[#8a6400]">API Key 临时占位</span><button onClick={onBack} className="rounded-lg border border-[#cbd9e5] bg-white px-3 py-2 text-sm">返回语音终端</button></div></header><div className="mx-auto max-w-6xl p-5 md:p-9"><div className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><p className="text-sm text-[#627d98]">当前 PMS</p><p className="mt-2 text-2xl font-semibold">{adapter.provider} {adapter.version}</p><p className="mt-2 text-xs text-[#829ab1]">{adapter.baseUrl}</p></div><div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><p className="text-sm text-[#627d98]">酒店编码</p><p className="mt-2 font-mono text-2xl font-semibold">{adapter.propertyCode}</p><p className="mt-2 text-xs text-[#829ab1]">配置仅属于当前实例</p></div><div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><p className="text-sm text-[#627d98]">适配状态</p><p className="mt-2 text-2xl font-semibold text-[#248a4d]">已完成</p><p className="mt-2 text-xs text-[#829ab1]">真实密钥替换后再启用生产写入</p></div></div><div className="mt-7 flex flex-wrap gap-2 rounded-2xl border border-[#d9e2ec] bg-white p-2 shadow-sm">{([["overview", "接口测试"], ["mapping", "编码映射"], ["policy", "业务规则"], ["security", "设备与安全"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`rounded-xl px-4 py-2.5 text-sm ${tab === value ? "bg-[#0b2942] text-white" : "text-[#486581]"}`}>{label}</button>)}</div>{tab === "overview" && <section className="mt-6 rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-6 py-5"><p className="text-sm text-[#627d98]">连接测试</p><h2 className="mt-1 text-lg font-semibold">首期五个 PMS 接口</h2></div><div className="grid gap-3 p-5 md:grid-cols-2">{interfaces.map(([label, operation, method]) => <div key={operation} className="flex items-center justify-between rounded-xl bg-[#f8fbfd] p-4"><div><p className="font-medium">{label}</p><p className="mt-1 font-mono text-xs text-[#829ab1]">{method} /api/pms/{operation}</p></div><button onClick={() => test(operation, method)} className="rounded-lg border border-[#cbd9e5] bg-white px-3 py-2 text-xs font-medium text-[#1769aa]">{tests[operation] ?? "测试"}</button></div>)}</div></section>}{tab === "mapping" && <section className="mt-6 rounded-2xl border border-[#d9e2ec] bg-white shadow-sm"><div className="border-b border-[#e8eef3] px-6 py-5"><p className="text-sm text-[#627d98]">编码映射</p><h2 className="mt-1 text-lg font-semibold">PMS 与门店执行节点</h2></div><div className="overflow-x-auto p-5"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-[#e8eef3] text-[#627d98]"><th className="px-3 py-3 font-medium">对象</th><th className="px-3 py-3 font-medium">本系统编码</th><th className="px-3 py-3 font-medium">PMS 编码</th><th className="px-3 py-3 font-medium">门锁/设备编码</th></tr></thead><tbody>{[["酒店", adapter.propertyCode, adapter.propertyCode, "NODE-GZ-01"], ["高楼层大床房", "DLX-KING", `${adapter.propertyCode}-DLX-KING`, "LOCK-GZ-KING"], ["1208 房", "1208", `${adapter.propertyCode}-1208`, "A-1208"]].map((row) => <tr key={row[0]} className="border-b border-[#f0f2f4]"><td className="px-3 py-3 font-medium">{row[0]}</td>{row.slice(1).map((value) => <td key={value} className="px-3 py-3 font-mono text-xs text-[#486581]">{value}</td>)}</tr>)}</tbody></table></div></section>}{tab === "policy" && <section className="mt-6 rounded-2xl border border-[#d9e2ec] bg-white p-6 shadow-sm"><p className="text-sm text-[#627d98]">业务规则</p><h2 className="mt-1 text-lg font-semibold">AI 只能建议，固定程序负责放行</h2><div className="mt-6 space-y-4"><label className="flex items-center justify-between rounded-xl bg-[#f8fbfd] p-4 text-sm"><span><span className="block font-medium">手机号优先匹配订单</span><span className="mt-1 block text-xs text-[#829ab1]">美团、抖音、团购和网购订单统一进入匹配队列</span></span><input type="checkbox" checked={phoneFirst} onChange={(event) => setPhoneFirst(event.target.checked)} className="h-5 w-5" /></label><label className="flex items-center justify-between rounded-xl bg-[#f8fbfd] p-4 text-sm"><span><span className="block font-medium">高风险必须人工确认</span><span className="mt-1 block text-xs text-[#829ab1]">身份不一致、支付不明、房态冲突时禁止自动放行</span></span><input type="checkbox" checked={manualGate} onChange={(event) => setManualGate(event.target.checked)} className="h-5 w-5" /></label></div></section>}{tab === "security" && <section className="mt-6 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-[#d9e2ec] bg-white p-5 shadow-sm"><p className="text-sm text-[#627d98]">设备节点</p><div className="mt-4 space-y-3"><Node icon={<UserRoundCheck size={18} />} title="身份证读卡器" detail="HID-02 · 仅在本地读取" status="在线" /><Node icon={<CreditCard size={18} />} title="发卡机" detail="A01 · 等待任务" status="在线" /><Node icon={<MonitorCog size={18} />} title="公安浏览器 Worker" detail="证书与验证码异常转人工" status="在线" /></div></div><div className="rounded-2xl border border-[#f1d6a4] bg-[#fffaf0] p-5 shadow-sm"><p className="text-sm text-[#8a6400]">安全提示</p><p className="mt-3 text-sm leading-6 text-[#6e6e73]">当前 API Key 仍为临时占位。替换真实密钥后，请先在沙盒环境完成五个接口测试，再切换到生产模式。</p><button onClick={onReconfigure} className="mt-4 rounded-lg border border-[#e0bd67] bg-white px-3 py-2 text-sm text-[#8a6400]">重新打开适配向导</button></div></section>}</div></main>;
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

function VoiceTerminal({ city, adapter, onOpenAdmin, onReconfigure }: { city: "广州" | "珠海"; adapter: AdapterConfig; onOpenAdmin: () => void; onReconfigure: () => void }) {
  const flow = TERMINAL_FLOW;
  const [started, setStarted] = useState(false);
  const [flowIndex, setFlowIndex] = useState(-1);
  const [voiceOn, setVoiceOn] = useState(true);
  const [scenario, setScenario] = useState<DemoScenario>("normal");
  const [apiEvents, setApiEvents] = useState<ApiEvent[]>([]);
  const active = flowIndex >= 0 ? flow[flowIndex] : null;
  const spoken = active?.voice ?? "您好，请将您的居民身份证放在读卡器上，我将为您自动办理入住。";
  const blocked = started && (
    (scenario === "leftBehind" && flowIndex === 0) ||
    (scenario === "mismatch" && flowIndex === 2)
  );
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
    if (voiceOn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }
    const eventTimer = window.setTimeout(() => {
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
    }, 0);
    const advanceTimer = !blocked && flowIndex < flow.length - 1
      ? window.setTimeout(() => setFlowIndex((value) => value + 1), 1000)
      : null;
    return () => {
      window.clearTimeout(eventTimer);
      if (advanceTimer !== null) window.clearTimeout(advanceTimer);
    };
  }, [active?.api, blocked, flowIndex, started, voiceOn, spoken, scenario, flow.length]);

  function startDemo() {
    setStarted(true);
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
    setFlowIndex(-1);
    setApiEvents([]);
  }

  function resolveRisk() {
    if (scenario === "leftBehind") {
      setScenario("normal");
      setApiEvents((events) => [...events, { step: 0.5, endpoint: "POST /api/device/id-reader/clear", status: "200", detail: "readerOccupied=false · previousCardRemoved=true" }]);
      setFlowIndex(1);
    } else {
      setApiEvents((events) => [...events, { step: 1.5, endpoint: "POST /api/manual-review/tasks", status: "202", detail: "人工复核工单已创建 · AI 不代替放行" }]);
      setStarted(false);
      setFlowIndex(-1);
    }
  }

  return <main className="min-h-screen bg-[#f5f5f7] px-6 py-7 text-[#1d1d1f] md:px-12 md:py-9">
    <header className="mx-auto flex max-w-6xl items-center justify-between text-sm"><span className="font-semibold tracking-tight">入住</span><div className="flex items-center gap-3"><button onClick={onOpenAdmin} className="hidden rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm sm:inline-flex">管理后台</button><button onClick={onReconfigure} className="hidden rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm sm:inline-flex">重新适配</button><div className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-sm lg:flex">{(["normal", "leftBehind", "mismatch"] as DemoScenario[]).map((item) => <button key={item} onClick={() => { setScenario(item); resetDemo(); }} className={`rounded-full px-3 py-1.5 text-xs ${scenario === item ? "bg-[#1d1d1f] text-white" : "text-[#6e6e73]"}`}>{item === "normal" ? "正常流程" : item === "leftBehind" ? "遗留证件" : "信息不一致"}</button>)}</div><button onClick={() => setVoiceOn((value) => !value)} className="inline-flex items-center gap-2 text-[#6e6e73]"><span className={`h-2 w-2 rounded-full ${voiceOn ? "bg-[#30d158]" : "bg-[#a1a1a6]"}`} />{voiceOn ? "语音开启" : "静音"}</button></div></header>
    <section className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-4xl flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-[#6e6e73]">{city} · AI 自助入住</p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-[#6e6e73] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#30d158]" />本地安全模型 · Qwen3.8-27B（示意） · 敏感字段留在门店节点</div>
      <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#fff8e7] px-3 py-1.5 text-xs text-[#8a6400] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#f5b700]" />PMS 适配器：{adapter.provider} {adapter.version} · API Key 临时占位</div>
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
