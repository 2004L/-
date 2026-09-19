-- Remove orphan reservation-room projections produced by duplicate legacy order
-- codes. The formal reservation is the source of truth; a link without it is
-- unusable and would make room joins return duplicate/phantom occupants.
DELETE FROM reservation_rooms
WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = reservation_rooms.reservation_id);

CREATE INDEX IF NOT EXISTS reservation_rooms_hotel_room_status_idx
  ON reservation_rooms(hotel_id, room_id, status, updated_at);
