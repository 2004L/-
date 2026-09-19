-- Defect 1: the check-in flow had no explicit "a human must take over" terminal,
-- and an older build left two cases in a status that current code cannot produce.
-- This migration adds the terminal state and retires the orphan rows without
-- losing the original value.

ALTER TABLE checkin_cases ADD COLUMN legacy_status TEXT;

UPDATE checkin_cases
SET legacy_status = status,
    status = 'HANDOFF_REQUIRED',
    hardware_status = CASE WHEN hardware_status IS NULL OR hardware_status = '' THEN 'onsite_team_required' ELSE hardware_status END,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'READY_FOR_ONSITE_HANDOFF';
