-- Data governance (defects 3 and 4): one room type per logical type, and one
-- canonical room id. Every statement is idempotent, so this file is safe to
-- re-run and harmless on databases that never had the duplicated rows.
--
-- Canonical room type id: rt-<hotel_id>-<CODE> (CODE from the room-type catalog)
-- Canonical room id:      room-<hotel_id>-<room_number>
--
-- Order matters: references are rewritten before a primary key is renamed.

-- 1. Create canonical room-type rows for catalog codes that exist only under a
--    legacy name (INSERT OR IGNORE yields to a row that already has that code).
INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at)
SELECT 'rt-' || hotel_id || '-STD-KING', tenant_id, hotel_id, 'STD-KING', '标准大床房', NULL, 2, 1, created_at, updated_at
FROM room_types WHERE name = '标准大床房' OR code = 'STD-KING' GROUP BY hotel_id;

INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at)
SELECT 'rt-' || hotel_id || '-DLX-KING', tenant_id, hotel_id, 'DLX-KING', '高级大床房', 'GZ-HAOS-001-DLX-KING', 2, 1, created_at, updated_at
FROM room_types WHERE name IN ('高级大床房', 'DLX-KING') OR code = 'DLX-KING' GROUP BY hotel_id;

INSERT OR IGNORE INTO room_types (id, tenant_id, hotel_id, code, name, pms_code, max_occupancy, active, created_at, updated_at)
SELECT 'rt-' || hotel_id || '-DLX-TWIN', tenant_id, hotel_id, 'DLX-TWIN', '豪华双床房', 'GZ-HAOS-001-DLX-TWIN', 2, 1, created_at, updated_at
FROM room_types WHERE name IN ('豪华双床房', 'DLX-TWIN') OR code = 'DLX-TWIN' GROUP BY hotel_id;

-- 2. Normalize the catalog columns so both writers describe one row the same way.
UPDATE room_types SET name = '标准大床房' WHERE code = 'STD-KING' AND name <> '标准大床房';
UPDATE room_types SET name = '高级大床房' WHERE code = 'DLX-KING' AND name <> '高级大床房';
UPDATE room_types SET name = '豪华双床房' WHERE code = 'DLX-TWIN' AND name <> '豪华双床房';
UPDATE room_types SET pms_code = 'GZ-HAOS-001-DLX-KING' WHERE code = 'DLX-KING' AND (pms_code IS NULL OR pms_code = 'DLX-KING');
UPDATE room_types SET pms_code = 'GZ-HAOS-001-DLX-TWIN' WHERE code = 'DLX-TWIN' AND (pms_code IS NULL OR pms_code = 'DLX-TWIN');

-- 3. Repoint room references onto the canonical room-type id *before* any id is
--    renamed, so the join can still resolve the previously referenced row.
UPDATE rooms SET room_type_id = (
  SELECT 'rt-' || o.hotel_id || '-' || CASE
    WHEN o.code IN ('STD-KING', 'DLX-KING', 'DLX-TWIN') THEN o.code
    WHEN o.name = '标准大床房' THEN 'STD-KING'
    WHEN o.name = '高级大床房' THEN 'DLX-KING'
    WHEN o.name = '豪华双床房' THEN 'DLX-TWIN'
    ELSE o.code END
  FROM room_types o WHERE o.id = rooms.room_type_id)
WHERE room_type_id IN (SELECT id FROM room_types WHERE id <> 'rt-' || hotel_id || '-' || code);

UPDATE reservation_rooms SET room_type_id = (
  SELECT 'rt-' || o.hotel_id || '-' || CASE
    WHEN o.code IN ('STD-KING', 'DLX-KING', 'DLX-TWIN') THEN o.code
    WHEN o.name = '标准大床房' THEN 'STD-KING'
    WHEN o.name = '高级大床房' THEN 'DLX-KING'
    WHEN o.name = '豪华双床房' THEN 'DLX-TWIN'
    ELSE o.code END
  FROM room_types o WHERE o.id = reservation_rooms.room_type_id)
WHERE room_type_id IN (SELECT id FROM room_types WHERE id <> 'rt-' || hotel_id || '-' || code);

-- 4. Rows whose code is already canonical (e.g. pms-rt-*) move to the canonical id.
UPDATE room_types SET id = 'rt-' || hotel_id || '-' || code
WHERE code IN ('STD-KING', 'DLX-KING', 'DLX-TWIN') AND id <> 'rt-' || hotel_id || '-' || code;

-- 5. Drop room-type rows that are neither canonical nor referenced any more.
DELETE FROM room_types
WHERE id <> 'rt-' || hotel_id || '-' || code
  AND id NOT IN (SELECT room_type_id FROM rooms WHERE room_type_id IS NOT NULL)
  AND id NOT IN (SELECT room_type_id FROM reservation_rooms WHERE room_type_id IS NOT NULL);

-- 6. Canonical room id: rewrite children first, then the primary key.
UPDATE reservation_rooms SET room_id = (
  SELECT 'room-' || r.hotel_id || '-' || r.room_number FROM rooms r WHERE r.id = reservation_rooms.room_id)
WHERE room_id IN (SELECT id FROM rooms WHERE id <> 'room-' || hotel_id || '-' || room_number);

UPDATE room_status_logs SET room_id = (
  SELECT 'room-' || r.hotel_id || '-' || r.room_number FROM rooms r WHERE r.id = room_status_logs.room_id)
WHERE room_id IN (SELECT id FROM rooms WHERE id <> 'room-' || hotel_id || '-' || room_number);

UPDATE rooms SET id = 'room-' || hotel_id || '-' || room_number
WHERE id <> 'room-' || hotel_id || '-' || room_number;
