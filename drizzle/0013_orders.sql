-- Commercial orders own money and the commercial lifecycle. Stay facts remain
-- in reservations; demo_orders is a projection fed by the formal tables.
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, hotel_id TEXT NOT NULL, order_no TEXT NOT NULL, source TEXT NOT NULL, external_id TEXT, status INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY', room_amount INTEGER NOT NULL DEFAULT 0, deposit_amount INTEGER NOT NULL DEFAULT 0, total_amount INTEGER NOT NULL DEFAULT 0, paid_amount INTEGER NOT NULL DEFAULT 0, guest_name_masked TEXT, phone_last4 TEXT, reservation_no TEXT, version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS orders_hotel_no_uq ON orders(hotel_id, order_no);
CREATE UNIQUE INDEX IF NOT EXISTS orders_hotel_idempotency_uq ON orders(hotel_id, idempotency_key);
CREATE INDEX IF NOT EXISTS orders_hotel_status_idx ON orders(hotel_id, status, updated_at);
CREATE INDEX IF NOT EXISTS orders_hotel_phone_idx ON orders(hotel_id, phone_last4);

INSERT OR IGNORE INTO orders (id, tenant_id, hotel_id, order_no, source, external_id, status, currency, room_amount, deposit_amount, total_amount, paid_amount, guest_name_masked, phone_last4, reservation_no, version, idempotency_key, created_at, updated_at)
SELECT 'ord-' || id, COALESCE(tenant_id, 'tenant-demo'), COALESCE(hotel_id, 'hotel-gz-demo'), order_code, source, order_code,
  CASE status WHEN 'awaiting_arrival' THEN 1 WHEN 'checkin_confirmed' THEN 1 WHEN 'in_house' THEN 1 WHEN 'checked_out' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,
  'CNY', room_amount, deposit_amount, total_amount, CASE WHEN status = 'cancelled' THEN 0 ELSE total_amount END,
  guest_label, phone_last4, order_code, 1, 'legacy:' || id, created_at, updated_at
FROM demo_orders WHERE hotel_id IS NOT NULL;
