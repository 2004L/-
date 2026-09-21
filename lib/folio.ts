import { getD1 } from "@/db";
import {
  checkoutStayWith,
  findInHouseStaysWith,
  markRoomCleanWith,
  type CheckoutResult,
  type ListRunner,
  type StayCandidate,
} from "@/lib/checkout-core";
import {
  FOLIOS_DDL,
  ensureFolioForStayWith,
  openFolioWith,
  postChargeWith,
  quoteCheckoutWith,
  settleFolioWith,
  verifyFolioLedger,
  verifyFolioMatchesStay,
  type CheckoutQuote,
  type EnsureFolioResult,
  type FolioRecord,
  type FolioStayCheck,
  type OpenFolioInput,
  type PostChargeInput,
  type SettleFolioInput,
  type SettleFolioResult,
} from "@/lib/settlement-core";
import { d1SqlRunner } from "@/lib/orders";
import type { SqlValue } from "@/lib/orders-core";

export { FOLIO_ERRORS } from "@/lib/settlement-core";
export { CHECKOUT_ERRORS } from "@/lib/checkout-core";
export type { CheckoutQuote, CheckoutResult, EnsureFolioResult, FolioRecord, FolioStayCheck, OpenFolioInput, PostChargeInput, SettleFolioInput, SettleFolioResult, StayCandidate };

/**
 * D1 adapter over the settlement and checkout cores. Every business rule lives
 * in lib/settlement-core.ts / lib/checkout-core.ts so the integration tests run
 * the exact same logic against a real SQLite engine.
 */
export function d1ListRunner(): ListRunner {
  return {
    run: async (sql: string, params: SqlValue[]) => {
      const result = await getD1().prepare(sql).bind(...params).run();
      return { changes: Number(result.meta?.changes ?? 0) };
    },
    first: <T = Record<string, unknown>>(sql: string, params: SqlValue[]) => getD1().prepare(sql).bind(...params).first<T>(),
    all: async <T = Record<string, unknown>>(sql: string, params: SqlValue[]) => {
      const result = await getD1().prepare(sql).bind(...params).all<T>();
      return (result.results ?? []) as T[];
    },
  };
}

export async function ensureFolioSchema() {
  const db = getD1();
  await db.batch(FOLIOS_DDL.map((sql) => db.prepare(sql)));
}

export async function openFolio(input: OpenFolioInput) {
  await ensureFolioSchema();
  return openFolioWith(d1SqlRunner(), input);
}

export async function postFolioCharge(input: PostChargeInput) {
  await ensureFolioSchema();
  return postChargeWith(d1SqlRunner(), input);
}

export async function quoteCheckout(input: { hotelId: string; stayId: string }) {
  await ensureFolioSchema();
  return quoteCheckoutWith(d1SqlRunner(), input);
}

export async function settleFolio(input: SettleFolioInput) {
  await ensureFolioSchema();
  return settleFolioWith(d1SqlRunner(), input);
}

export async function verifyLedger(hotelId: string, folioId: string) {
  await ensureFolioSchema();
  return verifyFolioLedger(d1SqlRunner(), hotelId, folioId);
}

export async function verifyStayFolio(input: { hotelId: string; stayId: string }) {
  await ensureFolioSchema();
  return verifyFolioMatchesStay(d1SqlRunner(), input);
}

export async function checkoutStay(input: { hotelId: string; stayId: string; requestId: string }) {
  return checkoutStayWith(d1SqlRunner(), input);
}

export async function markRoomClean(input: { hotelId: string; roomNumber: string; requestId: string }) {
  return markRoomCleanWith(d1SqlRunner(), input);
}

/** Opens the account for a stay that has none, booking the deposit it was sold with. */
export async function ensureStayFolio(input: { hotelId: string; stayId: string; requestId: string }): Promise<EnsureFolioResult> {
  await ensureFolioSchema();
  return ensureFolioForStayWith(d1SqlRunner(), input);
}

/** In-house guests matching the room they are in plus the phone they booked with. */
export async function findCheckoutCandidates(input: { hotelId: string; phoneLast4: string; roomNumber?: string | null }): Promise<StayCandidate[]> {
  await ensureFolioSchema();
  return findInHouseStaysWith(d1ListRunner(), input);
}

export type CheckoutSettlement = {
  quote: CheckoutQuote;
  checkout: CheckoutResult;
  settlement: SettleFolioResult;
  folioOpened: boolean;
  depositAmount: number;
};

/**
 * The guest-facing checkout: price the stay, end the stay, then settle the
 * account. The quote is recomputed here rather than trusted from the screen, so
 * the amount charged is the amount that is true at the moment of confirmation.
 */
export async function checkoutAndSettle(input: { hotelId: string; stayId: string; requestId: string }): Promise<CheckoutSettlement> {
  await ensureFolioSchema();
  const db = d1SqlRunner();
  const ensured = await ensureFolioForStayWith(db, input);
  const quote = await quoteCheckoutWith(db, input);
  const checkout = await checkoutStayWith(db, input);
  const settlement = await settleFolioWith(db, input);
  return { quote, checkout, settlement, folioOpened: ensured.opened, depositAmount: ensured.depositAmount };
}
