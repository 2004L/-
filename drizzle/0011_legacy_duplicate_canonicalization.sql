-- Canonicalize duplicate replay sessions after the legacy backfill. The
-- formal reservation row is unique per hotel/order number; active stays win
-- over stale pending projections so admin workflows see the real lifecycle.
UPDATE reservations
SET status = CASE
  WHEN EXISTS (SELECT 1 FROM demo_orders d WHERE d.hotel_id = reservations.hotel_id AND d.order_code = reservations.reservation_no AND d.status IN ('in_house', 'checkin_confirmed')) THEN 2
  WHEN EXISTS (SELECT 1 FROM demo_orders d WHERE d.hotel_id = reservations.hotel_id AND d.order_code = reservations.reservation_no AND d.status = 'checked_out') THEN 3
  WHEN EXISTS (SELECT 1 FROM demo_orders d WHERE d.hotel_id = reservations.hotel_id AND d.order_code = reservations.reservation_no AND d.status = 'cancelled') THEN 4
  WHEN EXISTS (SELECT 1 FROM demo_orders d WHERE d.hotel_id = reservations.hotel_id AND d.order_code = reservations.reservation_no AND d.status = 'awaiting_arrival') THEN 1
  ELSE status
END,
updated_at = CURRENT_TIMESTAMP
WHERE hotel_id IS NOT NULL;
