-- A reservation carries one reservation_rooms row per booked room, and the
-- checkout quote sums nightly_rate over those rows. Two writers used to add their
-- own row for the same reservation (the legacy backfill used
-- res-room-<demo order id>, the formal check-in path uses res-room-<order
-- number>), so a one-room booking could hold two rows and the guest was quoted
-- double the room rate. Keep the row that already carries an assigned room, then
-- the lowest id, up to the booked room count; drop the rest.
DELETE FROM reservation_rooms
WHERE id IN (
  SELECT ranked.id FROM (
    SELECT rr.id AS id,
      ROW_NUMBER() OVER (
        PARTITION BY rr.hotel_id, rr.reservation_id
        ORDER BY CASE WHEN rr.room_id IS NULL THEN 1 ELSE 0 END, rr.id
      ) AS rn,
      COALESCE((SELECT r.room_count FROM reservations r WHERE r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id), 1) AS booked_rooms
    FROM reservation_rooms rr
    WHERE rr.reservation_id IS NOT NULL
  ) AS ranked
  WHERE ranked.rn > MAX(1, ranked.booked_rooms)
);