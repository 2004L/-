export type DigitalHumanPhase =
  | "idle"
  | "searching"
  | "matched"
  | "processing"
  | "ambiguous"
  | "not_found"
  | "blocked"
  | "complete"
  | "error";

export type DigitalHumanInputEvent =
  | { type: "voice_start"; eventId: string }
  | { type: "voice_stop"; eventId: string }
  | { type: "text_submit"; eventId: string; text: string }
  | { type: "quick_intent"; eventId: string; intent: string; text: string }
  | { type: "confirm"; eventId: string; source: "digital_human" | "physical" }
  | { type: "cancel"; eventId: string; source: "digital_human" | "physical" }
  | { type: "model_interaction"; eventId: string; action: "tap" | "motion" }
  | { type: "computer_use"; eventId: string; action: ComputerUseAction };

/**
 * The page-level computer-use contract. It is intentionally allow-listed:
 * these actions can operate the current hotel flow, but cannot execute
 * arbitrary DOM, browser, or operating-system commands.
 */
export type ComputerUseAction =
  | { type: "focus_input"; target: "utterance" }
  | { type: "submit_text"; text: string }
  | { type: "start_voice"; deviceId?: string }
  | { type: "stop_voice" }
  | { type: "confirm" }
  | { type: "back" }
  | { type: "handoff_admin" };

export type ComputerUseStatus = "idle" | "planning" | "executing" | "waiting_confirmation" | "handoff" | "blocked";

export type DigitalHumanInput = {
  phase: DigitalHumanPhase;
  message: string;
  activeMessage: string;
  listening: boolean;
  audioLevel: number;
  flowStep: number;
  flowError: string | null;
  voiceEnabled: boolean;
  canConfirm: boolean;
  canBack: boolean;
  computerUseEnabled: boolean;
  computerUseStatus: ComputerUseStatus;
};
