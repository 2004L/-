-- Formal deposit payment and refund lifecycle.
-- Ledger entries remain the accounting truth; these tables track provider state.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  stay_id TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS payments_hotel_stay_idx ON payments(hotel_id, stay_id, created_at);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  stay_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (hotel_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS refunds_hotel_stay_idx ON refunds(hotel_id, stay_id, created_at);
