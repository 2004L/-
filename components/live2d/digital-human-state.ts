import type { DigitalHumanInput, DigitalHumanPhase } from "./types";

export type DigitalHumanViewModel = {
  expression: "neutral" | "listening" | "thinking" | "happy" | "warning" | "error";
  motion: string;
  statusLabel: string;
  bubble: string;
};

const PHASE_LABELS: Record<DigitalHumanPhase, string> = {
  idle: "等待办理",
  searching: "理解中",
  matched: "待确认",
  processing: "办理中",
  ambiguous: "需要核对",
  not_found: "未找到订单",
  blocked: "已暂停",
  complete: "办理完成",
  error: "安全暂停",
};

export function getDigitalHumanViewModel(input: DigitalHumanInput): DigitalHumanViewModel {
  const fallback = input.message || input.activeMessage || "您好，我可以帮您办理入住、退房或查询。";
  if (input.listening) {
    return { expression: "listening", motion: "activity", statusLabel: "正在听您说", bubble: "我在听，请说您的需求。" };
  }
  if (input.phase === "searching") {
    return { expression: "thinking", motion: "friend", statusLabel: PHASE_LABELS[input.phase], bubble: fallback };
  }
  if (input.phase === "complete") {
    return { expression: "happy", motion: "happy", statusLabel: PHASE_LABELS[input.phase], bubble: fallback };
  }
  if (input.phase === "ambiguous" || input.phase === "blocked" || input.phase === "error") {
    return { expression: input.phase === "error" ? "error" : "warning", motion: "angry", statusLabel: PHASE_LABELS[input.phase], bubble: fallback };
  }
  if (input.phase === "matched") {
    return { expression: "neutral", motion: "friend", statusLabel: PHASE_LABELS[input.phase], bubble: fallback };
  }
  return { expression: "neutral", motion: "friend", statusLabel: PHASE_LABELS[input.phase], bubble: fallback };
}
