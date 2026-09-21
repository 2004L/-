import {
  FOLIO_STATUS,
  LEDGER_ENTRY_SIGNS,
  LEDGER_ENTRY_TYPES,
  STAY_STATUS,
  allowedFolioStatusForStay,
  assertFolioTransition,
  type FolioStatus,
  type LedgerEntryType,
  type StayStatus,
} from "./hotel-core.ts";
import type { SqlRunner, SqlValue } from "./orders-core.ts";

/**
 * Guest account and ledger logic. Like orders-core.ts this module never talks to
 * D1 directly: it runs on the SqlRunner port so the exact same code is exercised
 * by the real D1 binding and by the two-connection SQLite test.
 *
 * Sign convention for ledger_entries.amount and folios.balance:
 *   positive -> the guest owes the hotel (charges)
 *   negative -> the hotel owes the guest (deposits and money already received)
 * A folio is settled when the balance reaches exactly zero.
 */

export const FOLIO_ERRORS = {
  NOT_FOUND: "folio_not_found",
  STAY_NOT_FOUND: "folio_stay_not_found",
  STAY_ALREADY_CHECKED_OUT: "stay_already_checked_out",
  CLOSED: "folio_already_closed",
  VERSION_CONFLICT: "folio_version_conflict",
  IDEMPOTENCY_REUSED: "folio_idempotency_key_reused",
  INVALID_AMOUNT: "invalid_ledger_amount",
  ENTRY_INVALID: "invalid_ledger_entry_type",
  REQUEST_INVALID: "folio_request_invalid",
  CREATE_FAILED: "folio_entry_create_failed",
  NOT_BALANCED: "folio_not_balanced",
  RATE_ROWS_MISMATCH: "folio_rate_rows_mismatch",
  PAYMENT_NOT_CAPTURED: "deposit_payment_not_captured",
  REFUND_PENDING: "deposit_refund_pending",
  REFUND_FAILED: "deposit_refund_failed",
} as const;

const MAX_AMOUNT = 99_999_999;

/**
 * Runtime schema bootstrap for the two tables migration 0008 already creates.
 * Kept byte-identical to 0008 on purpose: a second, richer definition here is
 * how a "works locally, missing in the real database" table gets born.
 */
export const FOLIOS_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS folios (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, stay_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', currency TEXT NOT NULL DEFAULT 'CNY', balance INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (hotel_id, stay_id))",
  "CREATE INDEX IF NOT EXISTS folios_hotel_status_idx ON folios(hotel_id, status)",
  "CREATE TABLE IF NOT EXISTS ledger_entries (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, folio_id TEXT NOT NULL, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY', idempotency_key TEXT NOT NULL, reference_type TEXT, reference_id TEXT, created_at TEXT NOT NULL, UNIQUE (hotel_id, idempotency_key))",
  "CREATE INDEX IF NOT EXISTS ledger_entries_hotel_folio_idx ON ledger_entries(hotel_id, folio_id, created_at)",
  "CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, stay_id TEXT NOT NULL, payment_type TEXT NOT NULL, method TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY', status TEXT NOT NULL, idempotency_key TEXT NOT NULL, provider TEXT NOT NULL, provider_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (hotel_id, idempotency_key))",
  "CREATE INDEX IF NOT EXISTS payments_hotel_stay_idx ON payments(hotel_id, stay_id, created_at)",
  "CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, payment_id TEXT NOT NULL, stay_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY', status TEXT NOT NULL, idempotency_key TEXT NOT NULL, provider TEXT NOT NULL, provider_ref TEXT, failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (hotel_id, idempotency_key))",
  "CREATE INDEX IF NOT EXISTS refunds_hotel_stay_idx ON refunds(hotel_id, stay_id, created_at)",
  "CREATE TABLE IF NOT EXISTS checkout_tasks (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, session_id TEXT NOT NULL, stay_id TEXT NOT NULL, request_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (hotel_id, stay_id, request_id))",
  "CREATE INDEX IF NOT EXISTS checkout_tasks_hotel_status_idx ON checkout_tasks(hotel_id, status, updated_at)",
];

export const PAYMENT_STATUS = { PENDING: "pending", CAPTURED: "captured", FAILED: "failed" } as const;
export const REFUND_STATUS = { PENDING: "pending", REFUNDED: "refunded", FAILED: "failed" } as const;

export type FolioRecord = {
  id: string;
  tenant_id: string;
  hotel_id: string;
  stay_id: string;
  status: string;
  currency: string;
  balance: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export type LedgerEntryRecord = {
  id: string;
  tenant_id: string;
  hotel_id: string;
  folio_id: string;
  entry_type: string;
  amount: number;
  currency: string;
  idempotency_key: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
};

export type LedgerTotals = Record<LedgerEntryType, number>;

const FOLIO_FIELDS = "id, tenant_id, hotel_id, stay_id, status, currency, balance, version, created_at, updated_at";
const LEDGER_FIELDS = "id, tenant_id, hotel_id, folio_id, entry_type, amount, currency, idempotency_key, reference_type, reference_id, created_at";
const FOLIO_BY_STAY_SQL = `SELECT ${FOLIO_FIELDS} FROM folios WHERE hotel_id = ? AND stay_id = ? LIMIT 1`;
const FOLIO_BY_ID_SQL = `SELECT ${FOLIO_FIELDS} FROM folios WHERE hotel_id = ? AND id = ? LIMIT 1`;
const LEDGER_BY_KEY_SQL = `SELECT ${LEDGER_FIELDS} FROM ledger_entries WHERE hotel_id = ? AND idempotency_key = ? LIMIT 1`;
const PAYMENT_BY_KEY_SQL = "SELECT id, tenant_id, hotel_id, stay_id, payment_type, method, amount, currency, status, idempotency_key, provider, provider_ref, created_at, updated_at FROM payments WHERE hotel_id = ? AND idempotency_key = ? LIMIT 1";
const REFUND_BY_KEY_SQL = "SELECT id, tenant_id, hotel_id, payment_id, stay_id, amount, currency, status, idempotency_key, provider, provider_ref, failure_code, created_at, updated_at FROM refunds WHERE hotel_id = ? AND idempotency_key = ? LIMIT 1";

export type PaymentRecord = { id: string; tenant_id: string; hotel_id: string; stay_id: string; payment_type: string; method: string; amount: number; currency: string; status: string; idempotency_key: string; provider: string; provider_ref: string | null; created_at: string; updated_at: string };
export type RefundRecord = { id: string; tenant_id: string; hotel_id: string; payment_id: string; stay_id: string; amount: number; currency: string; status: string; idempotency_key: string; provider: string; provider_ref: string | null; failure_code: string | null; created_at: string; updated_at: string };

/** Per-type totals in one row, generated from the entry-type catalogue. */
const LEDGER_TOTALS_SQL = `SELECT ${Object.values(LEDGER_ENTRY_TYPES)
  .map((type) => `COALESCE(SUM(CASE WHEN entry_type = '${type}' THEN amount ELSE 0 END), 0) AS ${type}`)
  .join(", ")} FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?`;

/**
 * Deterministic ledger keys. Because each key is derived from the stay, a stay
 * can only ever hold one deposit, one room charge, one settlement and one
 * refund, so a retry or a concurrent caller can never double-charge a guest.
 * The caller's own request id is kept separately in reference_id.
 */
export function folioLedgerKeys(stayId: string) {
  return {
    deposit: `deposit:${stayId}`,
    roomCharge: `room-charge:${stayId}`,
    settlement: `settlement:${stayId}`,
    refund: `refund:${stayId}`,
  };
}

export function folioIdForStay(stayId: string) {
  return `folio-${stayId}`;
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || Math.abs(amount) > MAX_AMOUNT) throw new Error(FOLIO_ERRORS.INVALID_AMOUNT);
}

/** Turns a positive business magnitude into the signed ledger amount. */
export function signedLedgerAmount(entryType: LedgerEntryType, amount: number) {
  const sign = LEDGER_ENTRY_SIGNS[entryType];
  if (sign === undefined) throw new Error(FOLIO_ERRORS.ENTRY_INVALID);
  assertAmount(amount);
  if (sign === 0) return amount;
  if (amount < 0) throw new Error(FOLIO_ERRORS.INVALID_AMOUNT);
  return sign * amount;
}

export async function readFolio(db: SqlRunner, hotelId: string, stayId: string) {
  return db.first<FolioRecord>(FOLIO_BY_STAY_SQL, [hotelId, stayId]);
}

export async function readFolioById(db: SqlRunner, hotelId: string, folioId: string) {
  return db.first<FolioRecord>(FOLIO_BY_ID_SQL, [hotelId, folioId]);
}

export async function readLedgerTotals(db: SqlRunner, hotelId: string, folioId: string): Promise<LedgerTotals> {
  const row = (await db.first<Record<string, unknown>>(LEDGER_TOTALS_SQL, [hotelId, folioId])) ?? {};
  const totals = {} as LedgerTotals;
  for (const type of Object.values(LEDGER_ENTRY_TYPES)) totals[type] = Number(row[type] ?? 0);
  return totals;
}

export async function ledgerTotal(db: SqlRunner, hotelId: string, folioId: string) {
  const row = await db.first<{ total: number | null }>("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?", [hotelId, folioId]);
  return Number(row?.total ?? 0);
}

/**
 * folios.balance is a cache of the ledger, never an independent truth. The value
 * is derived inside a single statement so a lost update cannot leave the cache
 * ahead of or behind the entries.
 */
export async function recomputeFolioBalance(db: SqlRunner, hotelId: string, folioId: string) {
  await db.run(
    "UPDATE folios SET balance = (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE hotel_id = ? AND folio_id = ?), updated_at = ? WHERE hotel_id = ? AND id = ?",
    [hotelId, folioId, new Date().toISOString(), hotelId, folioId],
  );
  return ledgerTotal(db, hotelId, folioId);
}

export async function verifyFolioLedger(db: SqlRunner, hotelId: string, folioId: string) {
  const folio = await readFolioById(db, hotelId, folioId);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  const total = await ledgerTotal(db, hotelId, folioId);
  const balance = Number(folio.balance);
  return { balanced: balance === total, balance, ledgerTotal: total, difference: balance - total };
}

export type PostLedgerEntryInput = {
  tenantId: string;
  hotelId: string;
  folioId: string;
  entryType: LedgerEntryType;
  amount: number;
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
};

export async function postLedgerEntryWith(db: SqlRunner, input: PostLedgerEntryInput) {
  if (!input.idempotencyKey) throw new Error(FOLIO_ERRORS.REQUEST_INVALID);
  const signed = signedLedgerAmount(input.entryType, input.amount);
  const folio = await readFolioById(db, input.hotelId, input.folioId);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  const existing = await db.first<LedgerEntryRecord>(LEDGER_BY_KEY_SQL, [input.hotelId, input.idempotencyKey]);
  if (existing) return replayEntry(db, existing, input, signed);
  if (folio.status === FOLIO_STATUS.CLOSED) throw new Error(FOLIO_ERRORS.CLOSED);
  const stamp = new Date().toISOString();
  const insert = await db.run(
    `INSERT OR IGNORE INTO ledger_entries (${LEDGER_FIELDS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`led-${crypto.randomUUID()}`, input.tenantId, input.hotelId, input.folioId, input.entryType, signed, folio.currency, input.idempotencyKey, input.referenceType ?? null, input.referenceId ?? null, stamp],
  );
  if (!insert.changes) {
    const raced = await db.first<LedgerEntryRecord>(LEDGER_BY_KEY_SQL, [input.hotelId, input.idempotencyKey]);
    if (raced) return replayEntry(db, raced, input, signed);
    throw new Error(FOLIO_ERRORS.CREATE_FAILED);
  }
  await recomputeFolioBalance(db, input.hotelId, input.folioId);
  const entry = await db.first<LedgerEntryRecord>(LEDGER_BY_KEY_SQL, [input.hotelId, input.idempotencyKey]);
  if (!entry) throw new Error(FOLIO_ERRORS.CREATE_FAILED);
  const current = await readFolioById(db, input.hotelId, input.folioId);
  return { entry, folio: current ?? folio, idempotent: false };
}

/**
 * Replaying the same key is only idempotent when it describes the same entry. A
 * key that suddenly points at a different folio, kind or amount is a client bug
 * and must not be silently accepted.
 */
async function replayEntry(db: SqlRunner, existing: LedgerEntryRecord, input: PostLedgerEntryInput, signed: number) {
  if (existing.folio_id !== input.folioId || existing.entry_type !== input.entryType || Number(existing.amount) !== signed) {
    throw new Error(FOLIO_ERRORS.IDEMPOTENCY_REUSED);
  }
  const folio = await readFolioById(db, input.hotelId, input.folioId);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  return { entry: existing, folio, idempotent: true };
}

export type OpenFolioInput = {
  tenantId: string;
  hotelId: string;
  stayId: string;
  depositAmount: number;
  stayStatus?: StayStatus;
  requestId?: string | null;
  paymentMethod?: string;
};

/** The demo payment adapter returns a captured receipt; a real adapter replaces this function. */
export async function ensureDepositPaymentWith(db: SqlRunner, input: { tenantId: string; hotelId: string; stayId: string; amount: number; requestId: string; method?: string }) {
  if (input.amount <= 0) return null;
  const key = `deposit-payment:${input.stayId}`;
  const existing = await db.first<PaymentRecord>(PAYMENT_BY_KEY_SQL, [input.hotelId, key]);
  if (existing) {
    if (Number(existing.amount) !== input.amount || existing.payment_type !== "deposit") throw new Error(FOLIO_ERRORS.IDEMPOTENCY_REUSED);
    if (existing.status !== PAYMENT_STATUS.CAPTURED) throw new Error(FOLIO_ERRORS.PAYMENT_NOT_CAPTURED);
    return existing;
  }
  const stamp = new Date().toISOString();
  const providerRef = `SIM-PAY-${crypto.randomUUID().slice(0, 8)}`;
  await db.run(
    "INSERT OR IGNORE INTO payments (id, tenant_id, hotel_id, stay_id, payment_type, method, amount, currency, status, idempotency_key, provider, provider_ref, created_at, updated_at) VALUES (?, ?, ?, ?, 'deposit', ?, ?, 'CNY', ?, ?, 'demo', ?, ?, ?)",
    [`pay-${crypto.randomUUID()}`, input.tenantId, input.hotelId, input.stayId, input.method ?? "deposit_simulator", input.amount, PAYMENT_STATUS.CAPTURED, key, providerRef, stamp, stamp],
  );
  const payment = await db.first<PaymentRecord>(PAYMENT_BY_KEY_SQL, [input.hotelId, key]);
  if (!payment || payment.status !== PAYMENT_STATUS.CAPTURED) throw new Error(FOLIO_ERRORS.PAYMENT_NOT_CAPTURED);
  return payment;
}

/** Opens the guest account and books the deposit. Safe to call on every retry. */
export async function openFolioWith(db: SqlRunner, input: OpenFolioInput) {
  if (!input.stayId || !input.tenantId || !input.hotelId) throw new Error(FOLIO_ERRORS.REQUEST_INVALID);
  assertAmount(input.depositAmount);
  if (input.depositAmount < 0) throw new Error(FOLIO_ERRORS.INVALID_AMOUNT);
  if (input.stayStatus === STAY_STATUS.CHECKED_OUT) throw new Error(FOLIO_ERRORS.STAY_ALREADY_CHECKED_OUT);
  const stamp = new Date().toISOString();
  await db.run(
    `INSERT OR IGNORE INTO folios (${FOLIO_FIELDS}) VALUES (?, ?, ?, ?, ?, 'CNY', 0, 1, ?, ?)`,
    [folioIdForStay(input.stayId), input.tenantId, input.hotelId, input.stayId, FOLIO_STATUS.OPEN, stamp, stamp],
  );
  const folio = await readFolio(db, input.hotelId, input.stayId);
  if (!folio) throw new Error(FOLIO_ERRORS.CREATE_FAILED);
  if (input.depositAmount > 0) {
    await ensureDepositPaymentWith(db, { tenantId: input.tenantId, hotelId: input.hotelId, stayId: input.stayId, amount: input.depositAmount, requestId: input.requestId ?? input.stayId, method: input.paymentMethod });
    await postLedgerEntryWith(db, {
      tenantId: input.tenantId,
      hotelId: input.hotelId,
      folioId: folio.id,
      entryType: LEDGER_ENTRY_TYPES.DEPOSIT,
      amount: input.depositAmount,
      idempotencyKey: folioLedgerKeys(input.stayId).deposit,
      referenceType: "stay",
      referenceId: input.requestId ?? input.stayId,
    });
  }
  const current = await readFolio(db, input.hotelId, input.stayId);
  return { folio: current ?? folio, idempotent: Number(folio.version) > 1 || folio.status !== FOLIO_STATUS.OPEN };
}

/** Create a pending refund, then accept the simulated provider callback. */
export async function refundDepositWith(db: SqlRunner, input: { tenantId: string; hotelId: string; stayId: string; amount: number; requestId: string }) {
  assertAmount(input.amount);
  if (input.amount <= 0) throw new Error(FOLIO_ERRORS.INVALID_AMOUNT);
  const payment = await db.first<PaymentRecord>("SELECT id, tenant_id, hotel_id, stay_id, payment_type, method, amount, currency, status, idempotency_key, provider, provider_ref, created_at, updated_at FROM payments WHERE hotel_id = ? AND stay_id = ? AND payment_type = 'deposit' ORDER BY created_at LIMIT 1", [input.hotelId, input.stayId]);
  if (!payment || payment.status !== PAYMENT_STATUS.CAPTURED) throw new Error(FOLIO_ERRORS.PAYMENT_NOT_CAPTURED);
  const key = `deposit-refund:${input.stayId}`;
  const existing = await db.first<RefundRecord>(REFUND_BY_KEY_SQL, [input.hotelId, key]);
  if (existing) {
    if (Number(existing.amount) !== input.amount || existing.payment_id !== payment.id) throw new Error(FOLIO_ERRORS.IDEMPOTENCY_REUSED);
    return existing;
  }
  const stamp = new Date().toISOString();
  await db.run("INSERT OR IGNORE INTO refunds (id, tenant_id, hotel_id, payment_id, stay_id, amount, currency, status, idempotency_key, provider, provider_ref, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, ?, 'demo', NULL, NULL, ?, ?)", [`ref-${crypto.randomUUID()}`, input.tenantId, input.hotelId, payment.id, input.stayId, input.amount, REFUND_STATUS.PENDING, key, stamp, stamp]);
  const pending = await db.first<RefundRecord>(REFUND_BY_KEY_SQL, [input.hotelId, key]);
  if (!pending) throw new Error(FOLIO_ERRORS.REFUND_PENDING);
  // Simulated adapter callback: only this callback transitions pending -> refunded.
  const providerRef = `SIM-REF-${crypto.randomUUID().slice(0, 8)}`;
  await db.run("UPDATE refunds SET status = ?, provider_ref = ?, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?", [REFUND_STATUS.REFUNDED, providerRef, stamp, input.hotelId, pending.id, REFUND_STATUS.PENDING]);
  const completed = await db.first<RefundRecord>(REFUND_BY_KEY_SQL, [input.hotelId, key]);
  if (!completed || completed.status !== REFUND_STATUS.REFUNDED) throw new Error(FOLIO_ERRORS.REFUND_FAILED);
  return completed;
}

export type PostChargeInput = {
  tenantId: string;
  hotelId: string;
  stayId: string;
  amount: number;
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
};

/** In-stay consumption (minibar, laundry, damage) posted to the open folio. */
export async function postChargeWith(db: SqlRunner, input: PostChargeInput) {
  const folio = await readFolio(db, input.hotelId, input.stayId);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  return postLedgerEntryWith(db, {
    tenantId: input.tenantId,
    hotelId: input.hotelId,
    folioId: folio.id,
    entryType: LEDGER_ENTRY_TYPES.CONSUMPTION,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    referenceType: input.referenceType ?? "consumption",
    referenceId: input.referenceId ?? null,
  });
}

export type CheckoutQuote = {
  stayId: string;
  stayStatus: number | null;
  reservationId: string | null;
  folioId: string | null;
  folioStatus: FolioStatus | null;
  currency: string;
  nights: number;
  roomCount: number;
  roomTotal: number;
  consumptionTotal: number;
  adjustmentTotal: number;
  depositTotal: number;
  settledTotal: number;
  refundedTotal: number;
  postedRoomCharge: number;
  payable: number;
  paid: number;
  due: number;
  folioBalance: number;
  ledgerTotal: number;
  reservationAmount: number | null;
  amountMismatch: boolean;
  missingRate: boolean;
  /** Rows in reservation_rooms; must equal roomCount or the rate sum is untrustworthy. */
  rateRows: number;
  rateRowMismatch: boolean;
  balanced: boolean;
  stayFolioCompliant: boolean;
};

type StayRow = {
  stay_id: string;
  stay_status: number;
  reservation_id: string | null;
  nights: number | null;
  room_count: number | null;
  total_amount: number | null;
  currency: string | null;
};

const STAY_QUOTE_SQL = "SELECT s.id AS stay_id, s.status AS stay_status, s.reservation_id AS reservation_id, r.nights AS nights, r.room_count AS room_count, r.total_amount AS total_amount, r.currency AS currency FROM stays s LEFT JOIN reservations r ON r.id = s.reservation_id AND r.hotel_id = s.hotel_id WHERE s.hotel_id = ? AND s.id = ? LIMIT 1";
const RATE_SQL = "SELECT COALESCE(SUM(nightly_rate), 0) AS rate_sum, COUNT(*) AS rows_count, COALESCE(SUM(CASE WHEN nightly_rate IS NULL THEN 1 ELSE 0 END), 0) AS missing_count FROM reservation_rooms WHERE hotel_id = ? AND reservation_id = ?";

/**
 * Checkout quote. Room nights come from reservation_rooms.nightly_rate, never
 * from the legacy reservations.total_amount placeholder, so a stale projection
 * cannot move money. due > 0 means the guest still owes; due < 0 means a refund.
 */
export async function quoteCheckoutWith(db: SqlRunner, input: { hotelId: string; stayId: string }): Promise<CheckoutQuote> {
  const stay = await db.first<StayRow>(STAY_QUOTE_SQL, [input.hotelId, input.stayId]);
  if (!stay) throw new Error(FOLIO_ERRORS.STAY_NOT_FOUND);
  const nights = Number(stay.nights ?? 0);
  const rateRow = stay.reservation_id
    ? await db.first<{ rate_sum: number; rows_count: number; missing_count: number }>(RATE_SQL, [input.hotelId, stay.reservation_id])
    : null;
  const rateSum = Number(rateRow?.rate_sum ?? 0);
  const rateRows = Number(rateRow?.rows_count ?? 0);
  const missingRate = rateRows === 0 || Number(rateRow?.missing_count ?? 0) > 0;
  // A reservation carries one room row per room. Two rows for a one-room booking
  // means a second writer inserted its own, and SUM(nightly_rate) would quietly
  // bill the guest twice; that amount is refused instead of charged.
  const bookedRooms = Number(stay.room_count ?? 0);
  const rateRowMismatch = Boolean(stay.reservation_id) && bookedRooms > 0 && rateRows !== bookedRooms;
  const roomTotal = rateSum * nights;
  const folio = await readFolio(db, input.hotelId, input.stayId);
  const totals = folio ? await readLedgerTotals(db, input.hotelId, folio.id) : null;
  const consumptionTotal = totals?.[LEDGER_ENTRY_TYPES.CONSUMPTION] ?? 0;
  const adjustmentTotal = totals?.[LEDGER_ENTRY_TYPES.ADJUSTMENT] ?? 0;
  const postedRoomCharge = totals?.[LEDGER_ENTRY_TYPES.ROOM_CHARGE] ?? 0;
  const depositTotal = -(totals?.[LEDGER_ENTRY_TYPES.DEPOSIT] ?? 0);
  const settledTotal = -(totals?.[LEDGER_ENTRY_TYPES.SETTLEMENT] ?? 0);
  const refundedTotal = totals?.[LEDGER_ENTRY_TYPES.REFUND] ?? 0;
  const payable = roomTotal + consumptionTotal + adjustmentTotal;
  const paid = depositTotal + settledTotal - refundedTotal;
  const folioBalance = Number(folio?.balance ?? 0);
  const ledgerTotalValue = folio ? await ledgerTotal(db, input.hotelId, folio.id) : 0;
  const stayStatus = Number(stay.stay_status);
  const folioStatus = (folio?.status ?? null) as FolioStatus | null;
  const allowed = allowedFolioStatusForStay(stayStatus as StayStatus);
  return {
    stayId: input.stayId,
    stayStatus,
    reservationId: stay.reservation_id,
    folioId: folio?.id ?? null,
    folioStatus,
    currency: String(folio?.currency ?? stay.currency ?? "CNY"),
    nights,
    roomCount: Number(stay.room_count ?? 0),
    roomTotal,
    consumptionTotal,
    adjustmentTotal,
    depositTotal,
    settledTotal,
    refundedTotal,
    postedRoomCharge,
    payable,
    paid,
    due: payable - paid,
    folioBalance,
    ledgerTotal: ledgerTotalValue,
    reservationAmount: stay.total_amount === null ? null : Number(stay.total_amount),
    amountMismatch: stay.total_amount === null ? false : Number(stay.total_amount) !== payable,
    missingRate,
    rateRows,
    rateRowMismatch,
    balanced: folioBalance === ledgerTotalValue,
    stayFolioCompliant: allowed === null || (folioStatus !== null && allowed.includes(folioStatus)),
  };
}

export type SettleFolioInput = {
  hotelId: string;
  stayId: string;
  requestId: string;
  expectedVersion?: number;
};

export type SettleFolioResult = {
  folio: FolioRecord;
  quote: CheckoutQuote;
  settled: number;
  idempotent: boolean;
  refund?: RefundRecord | null;
};

/**
 * Checkout settlement. The room charge, the settlement/refund and the close are
 * all idempotent by construction, and the close is a compare-and-set so two
 * concurrent callers cannot both finalise the same folio.
 */
export async function settleFolioWith(db: SqlRunner, input: SettleFolioInput): Promise<SettleFolioResult> {
  if (!input.requestId || !input.stayId || !input.hotelId) throw new Error(FOLIO_ERRORS.REQUEST_INVALID);
  const folio = await readFolio(db, input.hotelId, input.stayId);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  const keys = folioLedgerKeys(input.stayId);
  const tenantId = folio.tenant_id;
  if (folio.status === FOLIO_STATUS.CLOSED) {
    return { folio, quote: await quoteCheckoutWith(db, input), settled: 0, idempotent: true };
  }
  const before = await quoteCheckoutWith(db, input);
  if (before.rateRowMismatch) throw new Error(FOLIO_ERRORS.RATE_ROWS_MISMATCH);
  if (before.roomTotal > 0) {
    await postLedgerEntryWith(db, {
      tenantId, hotelId: input.hotelId, folioId: folio.id,
      entryType: LEDGER_ENTRY_TYPES.ROOM_CHARGE, amount: before.roomTotal,
      idempotencyKey: keys.roomCharge, referenceType: "stay", referenceId: input.stayId,
    });
  }
  const quote = await quoteCheckoutWith(db, input);
  let settled = 0;
  let refund: RefundRecord | null = null;
  if (quote.due > 0) {
    await postLedgerEntryWith(db, {
      tenantId, hotelId: input.hotelId, folioId: folio.id,
      entryType: LEDGER_ENTRY_TYPES.SETTLEMENT, amount: quote.due,
      idempotencyKey: keys.settlement, referenceType: "settlement", referenceId: input.requestId,
    });
    settled = quote.due;
  } else if (quote.due < 0) {
    refund = await refundDepositWith(db, { tenantId, hotelId: input.hotelId, stayId: input.stayId, amount: -quote.due, requestId: input.requestId });
    if (refund.status !== REFUND_STATUS.REFUNDED) throw new Error(FOLIO_ERRORS.REFUND_PENDING);
    await postLedgerEntryWith(db, {
      tenantId, hotelId: input.hotelId, folioId: folio.id,
      entryType: LEDGER_ENTRY_TYPES.REFUND, amount: -quote.due,
      idempotencyKey: keys.refund, referenceType: "refund", referenceId: input.requestId,
    });
    settled = quote.due;
  }
  const remaining = await recomputeFolioBalance(db, input.hotelId, folio.id);
  if (remaining !== 0) throw new Error(FOLIO_ERRORS.NOT_BALANCED);
  const closed = await closeFolioWith(db, { hotelId: input.hotelId, folio, expectedVersion: input.expectedVersion });
  return { folio: closed.folio, quote: await quoteCheckoutWith(db, input), settled, idempotent: closed.idempotent, refund };
}

/**
 * open is parked in settling before closed so the in-between state is a real,
 * observable value rather than an unreachable constant. A folio left in settling
 * is a recoverable "money not finished" signal, which is exactly the difference
 * between leaving the room and completing the refund.
 */
async function closeFolioWith(db: SqlRunner, input: { hotelId: string; folio: FolioRecord; expectedVersion?: number }) {
  let current = input.folio;
  if (current.status === FOLIO_STATUS.OPEN) {
    const stamp = new Date().toISOString();
    const params: SqlValue[] = [FOLIO_STATUS.SETTLING, stamp, input.hotelId, current.id, FOLIO_STATUS.OPEN];
    let sql = "UPDATE folios SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?";
    if (input.expectedVersion !== undefined) { sql += " AND version = ?"; params.push(input.expectedVersion); }
    const moved = await db.run(sql, params);
    const after = await readFolioById(db, input.hotelId, current.id);
    if (!after) throw new Error(FOLIO_ERRORS.NOT_FOUND);
    if (!moved.changes && after.status === FOLIO_STATUS.OPEN) throw new Error(FOLIO_ERRORS.VERSION_CONFLICT);
    current = after;
    if (current.status === FOLIO_STATUS.CLOSED) return { folio: current, idempotent: true };
  }
  assertFolioTransition(current.status as FolioStatus, FOLIO_STATUS.CLOSED);
  const stamp = new Date().toISOString();
  // A closed folio never changes again, so its updated_at is the close time.
  const result = await db.run(
    "UPDATE folios SET status = ?, version = version + 1, updated_at = ? WHERE hotel_id = ? AND id = ? AND status = ?",
    [FOLIO_STATUS.CLOSED, stamp, input.hotelId, current.id, FOLIO_STATUS.SETTLING],
  );
  const folio = await readFolioById(db, input.hotelId, current.id);
  if (!folio) throw new Error(FOLIO_ERRORS.NOT_FOUND);
  if (!result.changes) {
    if (folio.status === FOLIO_STATUS.CLOSED) return { folio, idempotent: true };
    throw new Error(FOLIO_ERRORS.VERSION_CONFLICT);
  }
  return { folio, idempotent: false };
}

export type FolioStayCheck = {
  ok: boolean;
  /** Blocking: the account or the stay contradicts itself. */
  issues: string[];
  /** Non-blocking: real data-quality findings that do not break accounting. */
  warnings: string[];
  quote: CheckoutQuote;
};

/**
 * Cross-checks the money facts against the stay facts for one stay. A legacy
 * reservations.total_amount placeholder is reported as a warning rather than a
 * failure: it is a dirty-projection problem, not an unbalanced ledger, and mixing
 * the two would hide real breaks in the noise.
 */
export async function verifyFolioMatchesStay(db: SqlRunner, input: { hotelId: string; stayId: string }): Promise<FolioStayCheck> {
  const quote = await quoteCheckoutWith(db, input);
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!quote.folioId) issues.push("folio_missing");
  if (quote.folioId && !quote.balanced) issues.push("ledger_balance_mismatch");
  if (!quote.stayFolioCompliant) issues.push(`folio_status_not_allowed_for_stay:${quote.folioStatus}`);
  if (quote.folioStatus === FOLIO_STATUS.CLOSED && quote.folioBalance !== 0) issues.push("closed_with_non_zero_balance");
  if (quote.missingRate) issues.push("room_rate_missing");
  if (!quote.missingRate && quote.amountMismatch) warnings.push("legacy_amount_mismatch");
  return { ok: issues.length === 0, issues, warnings, quote };
}

export type EnsureFolioResult = { folio: FolioRecord; opened: boolean; depositAmount: number; stayStatus: number };

/**
 * Reconciliation for stays that started before the ledger existed: if there is
 * no account yet, open one and book the reservation's deposit as a real entry
 * instead of pretending the guest never paid it. Quoting from a missing account
 * would otherwise bill the guest the full room rate a second time.
 */
export async function ensureFolioForStayWith(db: SqlRunner, input: { hotelId: string; stayId: string; requestId: string }): Promise<EnsureFolioResult> {
  const existing = await readFolio(db, input.hotelId, input.stayId);
  if (existing) return { folio: existing, opened: false, depositAmount: 0, stayStatus: 0 };
  const stay = await db.first<{ tenant_id: string; status: number; reservation_id: string | null }>(
    "SELECT tenant_id, status, reservation_id FROM stays WHERE hotel_id = ? AND id = ? LIMIT 1",
    [input.hotelId, input.stayId],
  );
  if (!stay) throw new Error(FOLIO_ERRORS.STAY_NOT_FOUND);
  const stayStatus = Number(stay.status);
  const reservation = stay.reservation_id
    ? await db.first<{ deposit_amount: number | null }>("SELECT deposit_amount FROM reservations WHERE hotel_id = ? AND id = ? LIMIT 1", [input.hotelId, stay.reservation_id])
    : null;
  const depositAmount = Math.max(0, Number(reservation?.deposit_amount ?? 0));
  const opened = await openFolioWith(db, {
    tenantId: stay.tenant_id,
    hotelId: input.hotelId,
    stayId: input.stayId,
    depositAmount,
    stayStatus: stayStatus as StayStatus,
    requestId: input.requestId,
  });
  return { folio: opened.folio, opened: true, depositAmount, stayStatus };
}
