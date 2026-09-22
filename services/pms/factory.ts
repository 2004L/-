import type { PmsAdapter } from "@/lib/hotel-core";
import { kamraPms } from "@/services/pms/kamra-adapter";
import { simulatorPms } from "@/services/pms/simulator-adapter";

export function getPmsAdapter(): PmsAdapter {
  const provider = (process.env.PMS_PROVIDER || "simulator").toLowerCase();
  if (provider === "kamra") return kamraPms;
  if (provider === "simulator") return simulatorPms;
  throw new Error(`unsupported_pms_provider:${provider}`);
}
