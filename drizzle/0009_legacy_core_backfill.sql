-- Backfill the formal core domain from the existing demo_orders projection.
-- Every statement is idempotent so an interrupted deploy can be resumed.
INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at)
SELECT 'rt-' || hotel_id || '-' || substr(hex(room_type), 1, 16), COALESCE(tenant_id, 'tenant-demo'), hotel_id, 'LEGACY-' || substr(hex(room_type), 1, 16), room_type, NULL, 2, 1, created_at, updated_at
FROM demo_orders WHERE hotel_id IS NOT NULL AND room_type IS NOT NULL GROUP BY hotel_id, room_type;

INSERT OR IGNORE INTO rooms (id, tenant_id, hotel_id, room_type_id, room_number, floor, status, version, pms_room_id, created_at, updated_at)
SELECT 'room-' || hotel_id || '-' || room_number, COALESCE(tenant_id, 'tenant-demo'), hotel_id, 'rt-' || hotel_id || '-' || substr(hex(room_type), 1, 16), room_number, CAST(substr(room_number, 1, length(room_number) - 2) AS INTEGER),
  CASE WHEN EXISTS (SELECT 1 FROM demo_orders occupied WHERE occupied.hotel_id = demo_orders.hotel_id AND occupied.room_number = demo_orders.room_number AND occupied.status IN ('in_house', 'checkin_confirmed')) THEN 3 ELSE 0 END,
  1, NULL, created_at, updated_at
FROM demo_orders WHERE hotel_id IS NOT NULL AND room_number IS NOT NULL GROUP BY hotel_id, room_number;

INSERT OR IGNORE INTO reservations (id, tenant_id, hotel_id, reservation_no, source, external_id, guest_name_masked, phone_last4, phone_hash, status, stay_date, nights, room_count, total_amount, deposit_amount, currency, version, idempotency_key, created_at, updated_at)
SELECT 'res-' || id, COALESCE(tenant_id, 'tenant-demo'), hotel_id, order_code, source, order_code, guest_label, phone_last4, NULL,
  CASE status WHEN 'awaiting_arrival' THEN 1 WHEN 'checkin_confirmed' THEN 2 WHEN 'in_house' THEN 2 WHEN 'checked_out' THEN 3 WHEN 'cancelled' THEN 4 ELSE 0 END,
  stay_date, nights, room_count, total_amount, deposit_amount, 'CNY', 1, 'legacy:' || id, created_at, updated_at
FROM demo_orders WHERE hotel_id IS NOT NULL;

INSERT OR IGNORE INTO reservation_rooms (id, tenant_id, hotel_id, reservation_id, room_type_id, room_id, nightly_rate, status, created_at, updated_at)
SELECT 'res-room-' || id, COALESCE(tenant_id, 'tenant-demo'), hotel_id, 'res-' || id, 'rt-' || hotel_id || '-' || substr(hex(room_type), 1, 16), CASE WHEN room_number IS NULL THEN NULL ELSE 'room-' || hotel_id || '-' || room_number END, room_amount / CASE WHEN nights = 0 THEN 1 ELSE nights END, CASE WHEN room_number IS NULL THEN 0 ELSE 1 END, created_at, updated_at
FROM demo_orders
WHERE hotel_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = 'res-' || demo_orders.id);

INSERT OR IGNORE INTO stays (id, tenant_id, hotel_id, reservation_id, guest_name_masked, phone_last4, identity_token, status, checked_in_at, checked_out_at, version, created_at, updated_at)
SELECT 'stay-' || id, COALESCE(tenant_id, 'tenant-demo'), hotel_id, 'res-' || id, guest_label, phone_last4, NULL,
  CASE WHEN status IN ('in_house', 'checkin_confirmed') THEN 2 WHEN status = 'checked_out' THEN 3 ELSE 0 END,
  CASE WHEN status IN ('in_house', 'checkin_confirmed') THEN updated_at ELSE NULL END,
  CASE WHEN status = 'checked_out' THEN updated_at ELSE NULL END,
  1, created_at, updated_at
FROM demo_orders WHERE hotel_id IS NOT NULL AND status IN ('in_house', 'checkin_confirmed', 'checked_out');

-- When old replay sessions contain the same order number more than once,
-- retain the most progressed usable lifecycle state for the canonical row.
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
