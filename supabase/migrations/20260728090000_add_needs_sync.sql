-- =====================================================
-- Migration: Only re-sync entries that changed
-- Description: When a published day is revised, approval re-synced EVERY
--              FSM-backed entry -- including appointments the scheduler never
--              touched. Re-pushing an untouched appointment failed with
--              "Appointment has changed in Zoho FSM since it was last read",
--              because Zoho's own post-create automation had bumped the
--              record's modified time. Fix: mark an entry as needing sync only
--              when it is newly added or actually edited, and skip the rest.
-- =====================================================

ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS needs_sync BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.schedule_entries.needs_sync
  IS 'TRUE when this entry must be (re)written to FSM on approval -- set on add/edit, cleared after a successful sync. An already-synced, untouched appointment stays FALSE and is skipped on revision re-approval.';

-- Backfill: anything already synced to FSM does NOT need re-syncing.
UPDATE public.schedule_entries
  SET needs_sync = FALSE
  WHERE sync_status = 'synced' AND fsm_appointment_id IS NOT NULL;
