import type { SqlRunner, SqlValue } from "./orders-core.ts";
import { demoOrderReleaseCount, demoOrderReleaseStatement } from "./legacy-projection-core.ts";

/**
 * Retention for completed loops. A closed loop is a stay that has been checked
 * out: the room went back to housekeeping, the folio is settled and the guest is
 * gone. Those records are history and an operator may want them gone. A stay that
 * is still in house, or an account that is still open, is never in this set —
 * every statement below starts from a checked-out stay.
 */
export const RETENTION_RANGES = {
  "3d": 3,
  "7d": 7,
  "30d": 30,
  "180d": 180,
  "365d": 365,
} as const;
export type RetentionRange = keyof typeof RETENTION_RANGES;
export const RETENTION_RANGE_LABELS: Record<RetentionRange, string> = {
  "3d": "近三天",
  "7d": "近七天",
  "30d": "近一个月",
  "180d": "近半年",
  "365d": "近一年",
};

export const RETENTION_ERRORS = {
  RANGE_INVALID: "retention_range_invalid",
  WINDOW_INVALID: "retention_window_invalid",
  REQUEST_INVALID: "retention_request_invalid",
} as const;

const STAY_STATUS_CHECKED_OUT = 3;

export function isRetentionRange(value: unknown): value is RetentionRange {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RETENTION_RANGES, value);
}

/** The window the operator is looking at: [now - days, now]. */
export function retentionWindow(range: RetentionRange, now: Date = new Date()) {
  const days = RETENTION_RANGES[range];
  return {
    range,
    days,
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    end: now.toISOString(),
  };
}

/**
 * One CTE naming the whole closed loop. Repeated inside every statement because a
 * SQLite CTE only scopes the statement it belongs to; it keeps each delete a
 * set operation instead of a hand-built id list, which matters because D1 takes
 * at most 100 bound parameters per statement.
 */
const CLOSED_LOOP_CTE = `WITH closed_stays AS (
    SELECT s.id AS stay_id, s.reservation_id AS reservation_id
    FROM stays s
    WHERE s.hotel_id = ? AND s.status = ? AND s.checked_out_at IS NOT NULL
      AND s.checked_out_at >= ? AND s.checked_out_at <= ?
  ), closed_reservations AS (
    SELECT r.id AS reservation_id, r.reservation_no AS reservation_no
    FROM reservations r WHERE r.hotel_id = ? AND r.id IN (SELECT reservation_id FROM closed_stays)
  ), closed_folios AS (
    SELECT f.id AS folio_id FROM folios f WHERE f.hotel_id = ? AND f.stay_id IN (SELECT stay_id FROM closed_stays)
  )`;

function closedLoopParams(hotelId: string, start: string, end: string): SqlValue[] {
  return [hotelId, STAY_STATUS_CHECKED_OUT, start, end, hotelId, hotelId];
}

export type PurgePreview = {
  range: RetentionRange;
  windowStart: string;
  windowEnd: string;
  stays: number;
  folios: number;
  ledgerEntries: number;
  reservations: number;
  orders: number;
  /** Rooms the purged stays occupied, for the operator to eyeball before confirming. */
  rooms: string[];
  /** Demo copies of those orders that will be handed back to "awaiting arrival". */
  demoOrdersReleased: number;
};

async function count(db: SqlRunner, sql: string, params: SqlValue[]) {
  const row = await db.first<{ c: number }>(sql, params);
  return Number(row?.c ?? 0);
}

/** Read-only: what a purge would remove. Safe to run before any confirmation. */
export async function previewClosedLoopPurge(db: SqlRunner, input: { hotelId: string; range: RetentionRange; now?: Date }): Promise<PurgePreview> {
  if (!input.hotelId) throw new Error(RETENTION_ERRORS.REQUEST_INVALID);
  if (!isRetentionRange(input.range)) throw new Error(RETENTION_ERRORS.RANGE_INVALID);
  const window = retentionWindow(input.range, input.now ?? new Date());
  const p = closedLoopParams(input.hotelId, window.start, window.end);
  const stays = await count(db, `${CLOSED_LOOP_CTE} SELECT COUNT(*) AS c FROM closed_stays`, p);
  const folios = await count(db, `${CLOSED_LOOP_CTE} SELECT COUNT(*) AS c FROM closed_folios`, p);
  const ledgerEntries = await count(db, `${CLOSED_LOOP_CTE} SELECT COUNT(*) AS c FROM ledger_entries e WHERE e.hotel_id = ? AND e.folio_id IN (SELECT folio_id FROM closed_folios)`, [...p, input.hotelId]);
  const reservations = await count(db, `${CLOSED_LOOP_CTE} SELECT COUNT(*) AS c FROM closed_reservations`, p);
  const orders = await count(db, `${CLOSED_LOOP_CTE} SELECT COUNT(*) AS c FROM orders o WHERE o.hotel_id = ? AND o.order_no IN (SELECT reservation_no FROM closed_reservations)`, [...p, input.hotelId]);
  const releaseCount = demoOrderReleaseCount({ hotelId: input.hotelId, checkedOutStayStatus: STAY_STATUS_CHECKED_OUT, windowStart: window.start, windowEnd: window.end });
  const demoOrdersReleased = await count(db, releaseCount.sql, releaseCount.params);
  const roomRow = await db.first<{ rooms: string | null }>(`${CLOSED_LOOP_CTE} SELECT GROUP_CONCAT(room_number, ',') AS rooms FROM (SELECT DISTINCT rm.room_number AS room_number FROM reservation_rooms rr JOIN rooms rm ON rm.id = rr.room_id AND rm.hotel_id = rr.hotel_id WHERE rr.hotel_id = ? AND rr.reservation_id IN (SELECT reservation_id FROM closed_reservations) ORDER BY rm.room_number)`, [...p, input.hotelId]);
  return {
    range: window.range,
    windowStart: window.start,
    windowEnd: window.end,
    stays,
    folios,
    ledgerEntries,
    reservations,
    orders,
    rooms: roomRow?.rooms ? roomRow.rooms.split(",") : [],
    demoOrdersReleased,
  };
}

export type PurgeResult = PurgePreview & { requestId: string };

/**
 * Removes the closed loops inside the window the operator confirmed. The window
 * is passed in instead of being recomputed, so what was previewed is what gets
 * deleted even if the confirmation is clicked minutes later.
 */
export async function purgeClosedLoopsWith(db: SqlRunner, input: { hotelId: string; range: RetentionRange; windowStart: string; windowEnd: string; requestId: string }): Promise<PurgeResult> {
  if (!input.hotelId || !input.requestId) throw new Error(RETENTION_ERRORS.REQUEST_INVALID);
  if (!isRetentionRange(input.range)) throw new Error(RETENTION_ERRORS.RANGE_INVALID);
  const start = new Date(input.windowStart).getTime();
  const end = new Date(input.windowEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error(RETENTION_ERRORS.WINDOW_INVALID);

  const preview = await previewClosedLoopPurge(db, { hotelId: input.hotelId, range: input.range, now: new Date(input.windowEnd) });
  const p = closedLoopParams(input.hotelId, input.windowStart, input.windowEnd);
  // Children first, and every statement still sees the stays it selects from:
  // entries -> accounts -> room links -> booking logs -> orders -> bookings -> stays.
  // The demo copy is released while the stays are still readable: after the deletes
  // there is nothing left to mirror from, and the console would keep showing a guest
  // who has already left.
  const release = demoOrderReleaseStatement({ hotelId: input.hotelId, stamp: new Date().toISOString(), checkedOutStayStatus: STAY_STATUS_CHECKED_OUT, windowStart: input.windowStart, windowEnd: input.windowEnd });
  await db.run(release.sql, release.params);

  const statements: Array<[string, SqlValue[]]> = [
    [`${CLOSED_LOOP_CTE} DELETE FROM ledger_entries WHERE hotel_id = ? AND folio_id IN (SELECT folio_id FROM closed_folios)`, [...p, input.hotelId]],
    [`${CLOSED_LOOP_CTE} DELETE FROM folios WHERE hotel_id = ? AND id IN (SELECT folio_id FROM closed_folios)`, [...p, input.hotelId]],
    [`${CLOSED_LOOP_CTE} DELETE FROM reservation_rooms WHERE hotel_id = ? AND reservation_id IN (SELECT reservation_id FROM closed_reservations)`, [...p, input.hotelId]],
    [`${CLOSED_LOOP_CTE} DELETE FROM reservation_status_logs WHERE hotel_id = ? AND reservation_id IN (SELECT reservation_id FROM closed_reservations)`, [...p, input.hotelId]],
    // The order goes only when no booking outside this purge still points at it.
    [`${CLOSED_LOOP_CTE} DELETE FROM orders WHERE hotel_id = ? AND order_no IN (SELECT reservation_no FROM closed_reservations) AND NOT EXISTS (SELECT 1 FROM reservations survivor WHERE survivor.hotel_id = orders.hotel_id AND survivor.reservation_no = orders.order_no AND survivor.id NOT IN (SELECT reservation_id FROM closed_reservations))`, [...p, input.hotelId]],
    [`${CLOSED_LOOP_CTE} DELETE FROM reservations WHERE hotel_id = ? AND id IN (SELECT reservation_id FROM closed_reservations)`, [...p, input.hotelId]],
    [`${CLOSED_LOOP_CTE} DELETE FROM stays WHERE hotel_id = ? AND id IN (SELECT stay_id FROM closed_stays)`, [...p, input.hotelId]],
  ];
  for (const [sql, params] of statements) await db.run(sql, params);
  return { ...preview, requestId: input.requestId };
}