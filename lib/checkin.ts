import { d1SqlRunner, ensureOrdersSchema } from "@/lib/orders";
import {
  confirmFormalCheckin as confirmCore,
  ensureCheckinOrder as ensureCore,
  holdFormalRoom as holdCore,
  pickSellableRoomWith as pickRoomCore,
  projectCheckinToLegacy as projectCore,
  type CheckinOrderInput,
  type ProjectCheckinInput,
} from "@/lib/checkin-core";

/** D1 adapter for the formal check-in writes used by the guest flow. */
export async function ensureFormalCheckinOrder(input: CheckinOrderInput) {
  await ensureOrdersSchema();
  return ensureCore(d1SqlRunner(), input);
}

export async function holdFormalRoom(input: { tenantId: string; hotelId: string; orderNo: string; roomNumber?: string | null; roomTypeName: string; requestId: string }) {
  return holdCore(d1SqlRunner(), input);
}

export async function confirmFormalCheckin(input: { tenantId: string; hotelId: string; orderNo: string; requestId: string }) {
  return confirmCore(d1SqlRunner(), input);
}

export async function projectCheckinToLegacy(input: ProjectCheckinInput) {
  return projectCore(d1SqlRunner(), input);
}

/** Which room the service would hand to this booking right now, if any. */
export async function pickSellableRoom(input: { hotelId: string; roomTypeId: string }) {
  return pickRoomCore(d1SqlRunner(), input);
}

export type { CheckinOrderInput } from "@/lib/checkin-core";
