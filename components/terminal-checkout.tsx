"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleCheck,
  CreditCard,
  DoorOpen,
  ArrowRight,
  Info,
  IdCard,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

export type TerminalMode = "checkin" | "checkout";

/**
 * Self-contained animation so the entrance does not depend on Tailwind theme
 * edits. Both effects are disabled under prefers-reduced-motion.
 */
const CHOICE_ANIMATION = `
.terminal-choice-sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,.72) 50%, transparent 62%); transform: translateX(-130%); animation: terminal-sheen 4s ease-in-out infinite; }
@keyframes terminal-sheen { 0%, 52% { transform: translateX(-130%); } 88%, 100% { transform: translateX(130%); } }
.terminal-choice-ring { animation: terminal-ring 2.6s ease-in-out infinite; }
@keyframes terminal-ring { 0%, 100% { box-shadow: 0 0 0 0 var(--ring-color); } 50% { box-shadow: 0 0 0 12px transparent; } }
@media (prefers-reduced-motion: reduce) {
  .terminal-choice-sheen { animation: none; opacity: 0; }
  .terminal-choice-ring { animation: none; }
}
`;

type ChoiceDefinition = {
  id: TerminalMode;
  title: string;
  subtitle: string;
  hint: string;
  accent: string;
  Icon: typeof IdCard;
};

const CHOICES: ChoiceDefinition[] = [
  {
    id: "checkin",
    title: "办理入住",
    subtitle: "身份证核验 · 公安登记 · 自动发卡",
    hint: "已有预订，或现场到店办理",
    accent: "#007aff",
    Icon: IdCard,
  },
  {
    id: "checkout",
    title: "退房 / 换房",
    subtitle: "退房结算 · 押金退还 · 前台换房",
    hint: "自助退房，或进入前台换房流程",
    accent: "#34c759",
    Icon: DoorOpen,
  },
];

/** The terminal asks what the guest wants before it asks who the guest is. */
export function TerminalModeChooser({ onChoose }: { onChoose: (mode: TerminalMode) => void }) {
  return (
    <section className="mt-10 w-full max-w-3xl">
      <style>{CHOICE_ANIMATION}</style>
      <p className="animate-in fade-in duration-700 text-center text-xs font-medium uppercase tracking-[.2em] text-[#86868b]">
        请选择要办理的业务
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {CHOICES.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onChoose(choice.id)}
            style={{ animationDelay: `${index * 130}ms` }}
            className="group relative animate-in fade-in slide-in-from-bottom-6 fill-mode-both overflow-hidden rounded-[2rem] border border-[#e5e5ea] bg-white p-7 text-left shadow-[0_10px_40px_rgba(0,0,0,.06)] duration-700 transition hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(0,0,0,.13)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007aff] motion-reduce:transform-none"
          >
            <span className="terminal-choice-sheen" aria-hidden="true" />
            <span
              className="terminal-choice-ring grid h-14 w-14 place-items-center rounded-2xl transition-transform duration-500 group-hover:rotate-3 group-hover:scale-110 motion-reduce:transform-none"
              style={{ background: `${choice.accent}14`, color: choice.accent, ["--ring-color" as string]: `${choice.accent}33` }}
            >
              <choice.Icon size={26} />
            </span>
            <span className="mt-5 block text-2xl font-semibold tracking-tight text-[#1d1d1f]">{choice.title}</span>
            <span className="mt-1.5 block text-sm leading-6 text-[#6e6e73]">{choice.subtitle}</span>
            <span className="mt-5 flex items-center gap-1.5 text-xs font-medium" style={{ color: choice.accent }}>
              {choice.hint}
              <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none">→</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-5 text-center text-xs text-[#86868b]">
        退房暂以「房间号 + 预订手机号后四位」识别在住客人；接入房卡读卡器后可直接插卡识别。
      </p>
    </section>
  );
}

type StayView = {
  stay_id: string;
  reservation_no: string | null;
  guest_name_masked: string;
  phone_last4: string;
  room_number: string | null;
  stay_date: string | null;
  nights: number;
  checked_in_at: string | null;
};

type QuoteView = {
  nights: number;
  roomTotal: number;
  consumptionTotal: number;
  adjustmentTotal: number;
  depositTotal: number;
  settledTotal: number;
  refundedTotal: number;
  payable: number;
  paid: number;
  due: number;
  currency: string;
  folioId: string | null;
  folioStatus: string | null;
  balanced: boolean;
  missingRate: boolean;
  amountMismatch: boolean;
};

type CheckoutPhase = "identify" | "quoting" | "quoted" | "settling" | "done" | "needs_followup" | "not_found" | "ambiguous" | "error";

const CHECKOUT_STEPS = ["身份识别", "收回房卡", "账目核对", "结算", "房态回收"] as const;

const ERROR_TEXT: Record<string, string> = {
  invalid_room_number: "房间号格式不正确，请输入 3-5 位数字。",
  invalid_phone_last4: "手机号后四位格式不正确。",
  invalid_stay_id: "入住单编号无效，请重新查询。",
  stay_not_found: "没有找到这笔在住记录，请核对房间号与手机号后四位。",
  folio_not_found: "没有找到该入住单的账本，请到前台办理。",
  stay_status_conflict: "这笔入住单的状态已变化，请到前台核对。",
  room_status_conflict: "房间状态刚刚被其他人改动，请到前台核对。",
  folio_version_conflict: "有另一笔结算正在处理，请稍后重试或到前台办理。",
  folio_not_balanced: "账目未平，已停止自动结算并转前台处理。",
  folio_already_closed: "这笔账已经结清过了。",
  deposit_payment_not_captured: "押金收款没有确认，系统已暂停办理，请到前台核对。",
  deposit_refund_pending: "退房已完成，但押金退款仍在等待支付渠道回执，请保留凭证并到前台查询。",
  deposit_refund_failed: "退房已完成，但押金退款失败，系统已转前台人工处理。",
  internal_error: "系统暂时无法完成操作，请到前台办理。",
};

function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : "internal_error";
  return ERROR_TEXT[code] ?? ERROR_TEXT.internal_error;
}

/** Amounts are rendered the same way the rest of the terminal renders them. */
function amount(value: number) {
  return `¥${Math.abs(value)}`;
}

function MoneyRow({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "credit" | "total" }) {
  return (
    <div className={`flex items-center justify-between py-2 ${tone === "total" ? "border-t border-[#e5e5ea] pt-4 text-lg font-semibold" : "text-sm"}`}>
      <span className={tone === "plain" ? "text-[#6e6e73]" : ""}>{label}</span>
      <span className={tone === "credit" ? "text-[#248a4d]" : ""}>{value}</span>
    </div>
  );
}

function StepRail({ active }: { active: number }) {
  return (
    <ol className="mt-6 grid gap-2 sm:grid-cols-5">
      {CHECKOUT_STEPS.map((label, index) => (
        <li
          key={label}
          className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs transition-colors duration-500 ${index < active ? "bg-[#1d1d1f] text-white" : index === active ? "bg-[#eef6ff] text-[#007aff]" : "bg-[#f2f2f7] text-[#86868b]"}`}
        >
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${index < active ? "bg-white/20" : index === active ? "bg-[#007aff] text-white" : "bg-[#e5e5ea]"}`}>
            {index < active ? <Check size={11} /> : index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function TerminalCheckoutPanel({
  sessionId,
  onExit,
  onFinished,
  onOpenFrontdesk,
}: {
  sessionId: string;
  onExit: () => void;
  onFinished: () => Promise<void> | void;
  onOpenFrontdesk: () => void;
}) {
  const [activeMode, setActiveMode] = useState<"checkout" | "room_change">("checkout");
  const [phase, setPhase] = useState<CheckoutPhase>("identify");
  const [roomNumber, setRoomNumber] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [stay, setStay] = useState<StayView | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [candidates, setCandidates] = useState<StayView[]>([]);
  const [receipt, setReceipt] = useState<{ settlement: number; folioStatus: string; refundStatus: string | null; refundProviderRef: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardPhase, setCardPhase] = useState<"waiting" | "checking" | "collected" | "failed">("waiting");
  const backgroundSettlementRef = useRef<string | null>(null);
  const [cardStorage, setCardStorage] = useState<string | null>(null);

  const post = useCallback(
    async <T,>(action: string, body: Record<string, unknown>): Promise<T> => {
      const response = await fetch(`/api/demo/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, ...body }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "internal_error");
      return payload as T;
    },
    [sessionId],
  );

  const canLookup = /^\d{3,5}$/.test(roomNumber.trim()) && /^\d{4}$/.test(phoneLast4.trim());
  const roomError = roomNumber.length > 0 && !/^\d{3,5}$/.test(roomNumber.trim()) ? "请输入 3–5 位数字" : "";
  const phoneError = phoneLast4.length > 0 && !/^\d{4}$/.test(phoneLast4.trim()) ? "请输入 4 位数字" : "";

  async function lookup() {
    if (!canLookup) return;
    setError(null);
    setPhase("quoting");
    try {
      const data = await post<{ outcome: string; stay?: StayView; quote?: QuoteView; candidates?: StayView[] }>("checkout-lookup", {
        room_number: roomNumber.trim(),
        phone_last4: phoneLast4.trim(),
      });
      if (data.outcome === "quoted" && data.stay && data.quote) {
        setStay(data.stay);
        setQuote(data.quote);
        setCardPhase("waiting");
        setCardStorage(null);
        setPhase("quoted");
        return;
      }
      setCandidates(data.candidates ?? []);
      setPhase(data.outcome === "ambiguous" ? "ambiguous" : "not_found");
    } catch (caught) {
      setError(errorText(caught));
      setPhase("error");
    }
  }

  async function returnCard() {
    if (!stay?.room_number || cardPhase === "checking" || cardPhase === "collected") return;
    setCardPhase("checking");
    setError(null);
    try {
      const response = await fetch("/api/device/card-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, case_id: stay.stay_id, idempotency_key: `${sessionId}:card-return:${stay.stay_id}`, expected_state: "CHECKED_IN", device_id: "card-returner-demo-01", room_number: stay.room_number }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { storage_bin?: string }; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "card_return_failed");
      setCardStorage(data.result?.storage_bin ?? "returner-bin-01");
      setCardPhase("collected");
      setPhase("done");
      const stayId = stay.stay_id;
      if (backgroundSettlementRef.current !== stayId) {
        backgroundSettlementRef.current = stayId;
        void post<{ outcome: string; settlement?: number; folio_status?: string; refund_status?: string | null; refund_provider_ref?: string | null }>("checkout-confirm", {
          stay_id: stayId,
          request_id: `${sessionId}:${stayId}:checkout:${Date.now()}`,
        }).then((result) => {
          setReceipt({ settlement: result.settlement ?? 0, folioStatus: result.folio_status ?? "closed", refundStatus: result.refund_status ?? null, refundProviderRef: result.refund_provider_ref ?? null });
          void onFinished();
        }).catch(() => {
          // 客人已经完成收卡，结算失败交给后台待处理，不让客人在终端等待。
          void onFinished();
        });
      }
    } catch (caught) {
      setCardPhase("failed");
      setError("没有检测到房卡，请把房卡插入收卡器后重试。" + (caught instanceof Error && caught.message ? `（${caught.message}）` : ""));
    }
  }

  useEffect(() => {
    if (phase !== "done") return;
    const timer = window.setTimeout(() => onExit(), 10000);
    return () => window.clearTimeout(timer);
  }, [onExit, phase]);

  const stepIndex = phase === "identify" || phase === "quoting" || phase === "not_found" || phase === "ambiguous" || phase === "error"
    ? 0
    : phase === "quoted" && cardPhase !== "collected" ? 1 : phase === "quoted" ? 2 : 3;

  return (
    <section className="mt-10 w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <style>{CHOICE_ANIMATION}</style>
      <div className="rounded-[2rem] bg-white p-7 text-left shadow-[0_10px_40px_rgba(0,0,0,.07)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#34c75914] text-[#34c759]">
              <DoorOpen size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">退房 / 换房</h2>
              <p className="mt-0.5 text-xs text-[#86868b]">先选择业务，系统会明确告诉您每一步会发生什么</p>
            </div>
          </div>
          <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-full bg-[#f2f2f7] px-3 py-2 text-xs text-[#6e6e73] transition hover:bg-[#e5e5ea]">
            <X size={13} />返回
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 rounded-2xl bg-[#f5f5f7] p-1" role="tablist" aria-label="退房或换房">
          <button type="button" role="tab" aria-selected={activeMode === "checkout"} onClick={() => setActiveMode("checkout")} className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${activeMode === "checkout" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#86868b]"}`}><DoorOpen size={15} className="mr-1.5 inline" />自助退房</button>
          <button type="button" role="tab" aria-selected={activeMode === "room_change"} onClick={() => setActiveMode("room_change")} className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${activeMode === "room_change" ? "bg-white text-[#1769aa] shadow-sm" : "text-[#86868b]"}`}><RefreshCcw size={15} className="mr-1.5 inline" />申请换房</button>
        </div>

        {activeMode === "room_change" && (
          <div className="mt-6 rounded-2xl border border-[#d8e9f8] bg-[#f7fbff] p-5">
            <div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eaf4ff] text-[#1769aa]"><RefreshCcw size={17} /></div><div><h3 className="font-semibold text-[#173b59]">换房需要前台确认</h3><p className="mt-1 text-sm leading-6 text-[#58738a]">换房会同时释放原房、占用目标房、更新入住记录并重新制作房卡。为避免误换，系统会先核对客人身份和目标房态，再生成确认单。</p></div></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-white px-3 py-3 text-xs text-[#58738a]"><span className="font-semibold text-[#1769aa]">1</span><span className="ml-2">核对住客与当前房间</span></div><div className="rounded-xl bg-white px-3 py-3 text-xs text-[#58738a]"><span className="font-semibold text-[#1769aa]">2</span><span className="ml-2">检查目标房可用性</span></div><div className="rounded-xl bg-white px-3 py-3 text-xs text-[#58738a]"><span className="font-semibold text-[#1769aa]">3</span><span className="ml-2">确认后执行并留痕</span></div></div>
            <button type="button" onClick={onOpenFrontdesk} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1769aa] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-[#125981]">进入前台换房流程 <ArrowRight size={16} /></button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-[#7891a5]"><Info size={13} />不会在本页直接修改房态或房卡</p>
          </div>
        )}

        {activeMode === "checkout" && <StepRail active={phase === "done" ? 4 : stepIndex} />}

        {activeMode === "checkout" && (phase === "identify" || phase === "quoting") && (
          <div className="mt-6 animate-in fade-in duration-500">
            <div className="rounded-2xl bg-[#f7fbff] p-4 text-sm leading-6 text-[#4f6f86]"><p className="font-medium text-[#173b59]">只需要两项信息</p><p className="mt-1">请输入您所住的房间号和预订手机号后四位。系统只查询当前在住记录，两个条件必须同时匹配。</p></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-[#6e6e73]">
                <span className="flex items-center justify-between">房间号 <span className="font-normal text-[#a1a1a6]">例如 1306</span></span>
                <input
                  value={roomNumber}
                  onChange={(event) => setRoomNumber(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  placeholder="1306"
                  className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-lg tracking-[.2em] outline-none focus:border-[#007aff] ${roomError ? "border-[#ffb4ad]" : "border-[#d9d9df]"}`}
                  aria-label="房间号"
                />
                {roomError && <span className="mt-1 block text-xs font-normal text-[#c54b12]">{roomError}</span>}
              </label>
              <label className="text-xs font-medium text-[#6e6e73]">
                <span className="flex items-center justify-between">手机号后四位 <span className="font-normal text-[#a1a1a6]">例如 4821</span></span>
                <input
                  value={phoneLast4}
                  onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="4821"
                  className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-lg tracking-[.2em] outline-none focus:border-[#007aff] ${phoneError ? "border-[#ffb4ad]" : "border-[#d9d9df]"}`}
                  aria-label="手机号后四位"
                />
                {phoneError && <span className="mt-1 block text-xs font-normal text-[#c54b12]">{phoneError}</span>}
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-[#a1a1a6]">演示快速填入：</span><button type="button" onClick={() => { setRoomNumber("1208"); setPhoneLast4("4821"); }} className="rounded-full border border-[#d9e2ec] bg-white px-3 py-1.5 text-xs text-[#627d98]">1208 · 4821</button><button type="button" onClick={() => { setRoomNumber("1306"); setPhoneLast4("6395"); }} className="rounded-full border border-[#d9e2ec] bg-white px-3 py-1.5 text-xs text-[#627d98]">1306 · 6395</button></div>
            <button
              type="button"
              onClick={() => void lookup()}
              disabled={!canLookup || phase === "quoting"}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white transition hover:bg-black disabled:opacity-30"
            >
              {phase === "quoting" ? <><LoaderCircle size={18} className="animate-spin" />正在核对身份与账目…</> : <>查询在住记录并生成报价 <ArrowRight size={16} /></>}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-[#86868b]"><ShieldCheck size={13} />只展示脱敏信息，不会显示完整手机号或证件资料</p>
          </div>
        )}

        {activeMode === "checkout" && phase === "quoted" && stay && quote && (
          <div className="mt-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="grid gap-3 rounded-2xl bg-[#f5f5f7] p-4 text-sm sm:grid-cols-2">
              <div><p className="text-xs text-[#86868b]">客人</p><p className="mt-1 font-medium">{stay.guest_name_masked}</p></div>
              <div><p className="text-xs text-[#86868b]">房间</p><p className="mt-1 font-medium">{stay.room_number ?? "待分配"} · {stay.nights} 晚</p></div>
              <div><p className="text-xs text-[#86868b]">订单号</p><p className="mt-1 font-mono text-xs">{stay.reservation_no ?? "—"}</p></div>
              <div><p className="text-xs text-[#86868b]">入住时间</p><p className="mt-1 text-xs">{stay.checked_in_at ?? "—"}</p></div>
            </div>

            {cardPhase !== "collected" && <div className="mt-5 rounded-2xl border border-[#b9d8f4] bg-[#f7fbff] p-5"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf4ff] text-[#1769aa]"><CreditCard size={19} /></div><div><h3 className="font-semibold text-[#173b59]">先归还房卡</h3><p className="mt-1 text-sm leading-6 text-[#58738a]">请将房卡插入收卡器。收卡器检测到卡片后会自动收纳，确认成功后才能继续退房。</p></div></div><div className="mt-4 flex items-center justify-between rounded-xl bg-white px-3 py-3 text-xs"><span className="text-[#627d98]">收卡器状态</span><span className={`rounded-full px-2.5 py-1 ${cardPhase === "checking" ? "bg-[#fff8e6] text-[#8a6d1f]" : cardPhase === "failed" ? "bg-[#fff2f1] text-[#a13a33]" : "bg-[#f2f7fb] text-[#627d98]"}`}>{cardPhase === "checking" ? "正在检测…" : cardPhase === "failed" ? "未检测到房卡" : "等待插入房卡"}</span></div><button type="button" onClick={() => void returnCard()} disabled={cardPhase === "checking"} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1769aa] px-5 py-3.5 text-sm font-medium text-white disabled:opacity-40">{cardPhase === "checking" ? <><LoaderCircle size={17} className="animate-spin" />正在收卡并核验</> : <>我已插入房卡，开始检测 <ArrowRight size={16} /></>}</button><p className="mt-3 text-center text-xs text-[#7891a5]">未检测到新房卡时，请不要拔出，重新插入后再点检测</p></div>}

            {cardPhase === "collected" && <div className="mt-5 rounded-2xl border border-[#bde7cf] bg-[#effaf4] p-4"><p className="flex items-center gap-2 text-sm font-medium text-[#248a4d]"><Check size={17} />房卡已收回并存入收卡器</p><p className="mt-1 text-xs text-[#52745f]">收纳位置：{cardStorage ?? "returner-bin-01"} · 房卡回收已记录</p></div>}

            <div className="mt-5 rounded-2xl border border-[#e5e5ea] p-5">
              <p className="text-xs font-medium uppercase tracking-[.16em] text-[#86868b]">账单明细</p>
              <div className="mt-3">
                <MoneyRow label={`房费（${quote.nights} 晚 × 房价）`} value={amount(quote.roomTotal)} />
                <MoneyRow label="在住消费" value={amount(quote.consumptionTotal)} />
                {quote.adjustmentTotal !== 0 && <MoneyRow label="人工更正" value={`${quote.adjustmentTotal > 0 ? "+" : "-"}${amount(quote.adjustmentTotal)}`} />}
                <MoneyRow label="押金（入住时已收）" value={`-${amount(quote.depositTotal)}`} tone="credit" />
                {quote.settledTotal !== 0 && <MoneyRow label="已补收" value={`-${amount(quote.settledTotal)}`} tone="credit" />}
                {quote.refundedTotal !== 0 && <MoneyRow label="已退还" value={amount(quote.refundedTotal)} />}
                <MoneyRow
                  label={quote.due > 0 ? "需补收" : quote.due < 0 ? "需退还" : "无需补退"}
                  value={quote.due === 0 ? amount(0) : amount(quote.due)}
                  tone="total"
                />
              </div>
              {(quote.missingRate || quote.amountMismatch) && (
                <p className="mt-4 rounded-xl bg-[#fff8e6] p-3 text-xs leading-5 text-[#8a6d1f]">
                  {quote.missingRate
                    ? "该入住单缺少房价记录，无法自动报价，请到前台办理。"
                    : "订单上的金额是历史占位值，与正式账本不一致；本次结算以房态和房价为准。"}
                </p>
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[#effaf4] p-4 text-xs leading-5 text-[#52745f]"><Check size={15} className="mt-0.5 shrink-0" /><p>房卡已收回，您现在可以离开。押金、账目和房态会在后台继续处理，无需在这里等待。</p></div>
          </div>
        )}

        {phase === "settling" && (
          <div className="mt-8 flex animate-in fade-in flex-col items-center py-6">
            <LoaderCircle className="animate-spin text-[#007aff]" size={30} />
            <p className="mt-4 text-sm font-medium">正在结算并回收房态…</p>
            <p className="mt-1 text-xs text-[#86868b]">房费入账、押金退还或补收、房态转待清洁将依次完成</p>
          </div>
        )}

        {phase === "done" && (
          <div className="mt-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="rounded-[1.5rem] border border-[#bde7cf] bg-[#effaf4] p-6 text-center">
              <CircleCheck className="mx-auto text-[#248a4d]" size={32} />
              <h3 className="mt-3 text-2xl font-semibold">房卡已收回，您可以离开</h3>
              <p className="mt-2 text-sm text-[#52745f]">后台正在处理押金、账目和房态，10 秒后自动结束本次会话。</p>
              <div className="mt-5 grid gap-2 text-left text-xs text-[#52745f] sm:grid-cols-2">
                <p className="flex items-center gap-1.5"><CreditCard size={13} />房卡已进入收卡器收纳</p>
                <p className="flex items-center gap-1.5"><ShieldCheck size={13} />后台结算任务已提交</p>
                <p className="flex items-center gap-1.5"><TrendingUp size={13} />房态将转为待清洁</p>
                <p className="flex items-center gap-1.5"><Check size={13} />无需在终端继续操作</p>
              </div>
              {receipt?.refundStatus === "refunded" && <p className="mt-4 rounded-xl bg-white/70 px-3 py-2 text-xs text-[#52745f]">押金退款回执：{receipt.refundProviderRef ?? "已确认"}</p>}
            </div>
            <button type="button" onClick={onExit} className="mt-5 w-full rounded-2xl bg-[#1d1d1f] px-5 py-4 font-medium text-white transition hover:bg-black">立即结束</button>
          </div>
        )}

        {phase === "needs_followup" && (
          <div className="mt-6 rounded-[1.5rem] border border-[#ffd9a8] bg-[#fff8e6] p-6 text-center animate-in fade-in duration-500">
            <p className="text-lg font-semibold">退房已受理，结算需前台接手</p>
            <p className="mt-2 text-sm leading-6 text-[#8a6d1f]">房间已经释放为待清洁，但账目没有自动结清。请到前台完成补收或退还，系统已记录这笔待处理事项。</p>
            <button type="button" onClick={onExit} className="mt-5 rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-medium text-white">返回首页</button>
          </div>
        )}

        {phase === "not_found" && (
          <div className="mt-6 rounded-[1.5rem] border border-[#e5e5ea] bg-[#f5f5f7] p-6 text-center animate-in fade-in duration-500">
            <p className="text-lg font-semibold">没有找到在住记录</p>
            <p className="mt-2 text-sm leading-6 text-[#6e6e73]">请确认房间号与预订手机号后四位是否与入住时一致。若仍无法查询，请到前台办理。</p>
            <button type="button" onClick={() => { setStay(null); setQuote(null); setPhase("identify"); }} className="mt-5 rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-medium text-white">重新输入</button>
          </div>
        )}

        {phase === "ambiguous" && (
          <div className="mt-6 rounded-[1.5rem] border border-[#ffd9a8] bg-[#fff8e6] p-6 animate-in fade-in duration-500">
            <p className="text-lg font-semibold">匹配到多笔在住记录</p>
            <p className="mt-2 text-sm leading-6 text-[#8a6d1f]">仅凭房间号无法确认是哪一笔，系统已停止自动结算。请到前台核对。</p>
            <ul className="mt-4 space-y-2 text-xs text-[#8a6d1f]">
              {candidates.map((item) => (
                <li key={item.stay_id} className="rounded-xl bg-white/70 px-3 py-2">
                  {item.guest_name_masked} · {item.room_number ?? "—"} · {item.reservation_no ?? "—"}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setPhase("identify")} className="mt-5 rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-medium text-white">重新输入</button>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6 rounded-[1.5rem] border border-[#ffd0cc] bg-[#fff2f1] p-6 text-center animate-in fade-in duration-500">
            <p className="text-lg font-semibold">流程已安全暂停</p>
            <p className="mt-2 text-sm leading-6 text-[#a13a33]">{error}</p>
            <button type="button" onClick={() => { setStay(null); setQuote(null); setPhase("identify"); }} className="mt-5 rounded-full bg-[#1d1d1f] px-6 py-3 text-sm font-medium text-white">重新开始</button>
          </div>
        )}
      </div>
    </section>
  );
}
