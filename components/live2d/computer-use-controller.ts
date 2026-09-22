import type { ComputerUseAction } from "./types";

export type ComputerUseHandlers = {
  focusInput: () => void;
  submitText: (text: string) => void;
  startVoice: (deviceId?: string) => void;
  stopVoice: () => void;
  confirm: () => void;
  back: () => void;
  handoffAdmin: () => void;
};

/**
 * Small, deterministic dispatcher for the AI's in-app computer-use actions.
 * It deliberately has no DOM query, eval, navigation, or OS access. Business
 * mutations remain behind the existing submit/confirm/back handlers.
 */
export function dispatchComputerUseAction(action: ComputerUseAction, handlers: ComputerUseHandlers) {
  switch (action.type) {
    case "focus_input":
      handlers.focusInput();
      return;
    case "submit_text":
      handlers.submitText(action.text);
      return;
    case "start_voice":
      handlers.startVoice(action.deviceId);
      return;
    case "stop_voice":
      handlers.stopVoice();
      return;
    case "confirm":
      handlers.confirm();
      return;
    case "back":
      handlers.back();
      return;
    case "handoff_admin":
      handlers.handoffAdmin();
      return;
  }
}
