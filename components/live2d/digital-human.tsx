"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Mic, MousePointer2, RefreshCcw, Volume2 } from "lucide-react";
import { getDigitalHumanViewModel } from "./digital-human-state";
import { mountLive2DModel, playLive2DMotion } from "./digital-human-runtime";
import type { DigitalHumanInput, DigitalHumanInputEvent } from "./types";

const MODEL_PATH = "/live2d/models/hotel-agent/model.json";

function newEventId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function DigitalHuman({ input, onInput, audioInputs, selectedAudioDeviceId, onAudioDeviceChange, onToggleComputerUse }: {
  input: DigitalHumanInput;
  onInput: (event: DigitalHumanInputEvent) => void;
  audioInputs: Array<{ deviceId: string; label: string }>;
  selectedAudioDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
  onToggleComputerUse: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const view = useMemo(() => getDigitalHumanViewModel(input), [input]);
  const canvasId = "hotel-digital-human-live2d";

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void mountLive2DModel(canvas, container, MODEL_PATH)
      .then((dispose) => {
        cleanup = dispose;
        if (!disposed) setRuntimeStatus("ready");
      })
      .catch((error) => {
        console.warn("Live2D fallback enabled", error);
        if (!disposed) setRuntimeStatus("fallback");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (runtimeStatus === "ready") playLive2DMotion(view.motion, canvasId);
  }, [runtimeStatus, view.motion]);

  const emit = (event: Omit<DigitalHumanInputEvent, "eventId">) => onInput({ ...event, eventId: newEventId() } as DigitalHumanInputEvent);
  const isBusy = input.phase === "searching" || input.phase === "processing";

  return <aside className="digital-human-card fixed left-2 top-20 z-30 w-[min(30rem,34vw)] overflow-visible text-left md:left-6 md:top-24 lg:left-8 max-md:bottom-3 max-md:top-auto max-md:w-[calc(100vw-1rem)] max-md:max-w-[25rem]">
    <div className="flex items-center justify-between px-2 py-2">
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-md"><span className={`h-2.5 w-2.5 rounded-full ${input.listening ? "bg-[#ff3b30]" : runtimeStatus === "ready" ? "bg-[#34c759]" : "bg-[#ff9500]"}`} /><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#1d1d1f]">酒店 AI 数字人</p><p className="text-[11px] text-[#86868b]">{view.statusLabel}</p></div></div>
      <div className="flex items-center gap-1 rounded-full bg-white/80 p-1 shadow-sm backdrop-blur-md">
        <button type="button" onClick={onToggleComputerUse} className={`rounded-full px-2.5 py-1.5 text-[11px] font-medium ${input.computerUseEnabled ? "bg-[#eaf4ff] text-[#1769aa]" : "text-[#6e6e73] hover:bg-[#f5f5f7]"}`} aria-pressed={input.computerUseEnabled}><MousePointer2 size={12} className="mr-1 inline" />{input.computerUseEnabled ? "AI 操作已开" : "AI 操作"}</button>
        <button type="button" onClick={() => emit({ type: "model_interaction", action: "motion" })} className="rounded-full p-2 text-[#86868b] hover:bg-[#f5f5f7]" aria-label="让数字人打招呼"><RefreshCcw size={15} /></button>
      </div>
    </div>
    <div ref={containerRef} className="relative h-[26rem] overflow-visible md:h-[34rem] lg:h-[39rem]">
      <canvas ref={canvasRef} id={canvasId} className={`absolute inset-0 h-full w-full ${runtimeStatus === "fallback" ? "opacity-0" : "opacity-100"}`} aria-label="Live2D 酒店数字人" />
      {runtimeStatus !== "ready" && <div className="absolute inset-0 grid place-items-center p-8 text-center"><div><div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#dcecff]/90 text-4xl shadow-lg">🤖</div><p className="mt-3 rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium text-[#284b6b] shadow-sm backdrop-blur-md">{runtimeStatus === "loading" ? "数字人加载中…" : "数字人暂不可用，已切换文字/按钮模式"}</p></div></div>}
      <div className="absolute bottom-3 left-2 right-2 rounded-2xl bg-white/85 px-3 py-2.5 shadow-lg backdrop-blur-md"><p className="text-xs leading-5 text-[#31465d]" aria-live="polite">{view.bubble}</p></div>
      {input.listening && <div className="absolute left-2 top-3 flex items-center gap-2 rounded-full bg-[#1d1d1f]/75 px-3 py-1.5 text-[11px] text-white shadow-md"><Mic size={12} /><span>正在听</span><span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/25"><span className="block h-full rounded-full bg-[#64d2ff]" style={{ width: `${Math.max(8, Math.round(input.audioLevel * 100))}%` }} /></span></div>}
    </div>
    <div className="grid grid-cols-3 gap-2 px-2 py-2">
      <button type="button" onClick={() => emit({ type: input.listening ? "voice_stop" : "voice_start" })} disabled={isBusy} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-medium ${input.listening ? "bg-[#ff3b30] text-white" : "bg-[#eaf4ff] text-[#1769aa]"} disabled:opacity-40`}><Mic size={14} />{input.listening ? "结束" : "说话"}</button>
      <button type="button" onClick={() => emit({ type: "cancel", source: "digital_human" })} disabled={!input.canBack} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f5f5f7] px-2 py-2.5 text-xs font-medium text-[#6e6e73] disabled:opacity-40"><ArrowLeft size={14} />上一步 / 后悔</button>
      <button type="button" onClick={() => emit({ type: "confirm", source: "digital_human" })} disabled={!input.canConfirm || isBusy} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#34c759] px-2 py-2.5 text-xs font-medium text-white disabled:opacity-40"><Check size={14} />确认提交</button>
    </div>
    <div className="mx-2 rounded-2xl bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur-md"><label className="flex items-center justify-between gap-3 text-xs text-[#6e6e73]"><span className="shrink-0 font-medium">语音输入设备</span><select value={selectedAudioDeviceId} onChange={(event) => onAudioDeviceChange(event.target.value)} disabled={input.listening || audioInputs.length === 0} className="min-w-0 flex-1 rounded-lg border border-[#d9dfe8] bg-white px-2 py-1.5 text-xs text-[#31465d] outline-none focus:border-[#007aff] disabled:opacity-50" aria-label="数字人语音输入设备"><option value="">{audioInputs.length === 0 ? "正在检测麦克风…" : "系统默认麦克风"}</option>{audioInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label><p className="mt-1 text-[11px] text-[#9a9aa1]">录音前可切换设备，选择会保存在本机</p></div>
    <div className="flex items-center justify-between px-3 pb-2 pt-2 text-[10px] text-[#9a9aa1]"><span>{input.computerUseStatus === "waiting_confirmation" ? "等待用户点击确认" : input.computerUseEnabled ? "AI 可操作当前页面 · 高风险仍需确认" : "数字人输入与传统确认共用同一办理内核"}</span><Volume2 size={12} /></div>
  </aside>;
}
