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
  | { type: "model_interaction"; eventId: string; action: "tap" | "motion" };

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
};
