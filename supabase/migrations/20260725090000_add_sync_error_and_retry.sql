-- =====================================================
-- Migration: Per-entry sync error + published-edit support
-- Description: Surfacing WHY an appointment failed to sync, and letting a
--              failed sync be retried (FRD AC-006 / AC-015). Also records
--              the last direct edit pushed to a published appointment
--              (AC-016 / SYNC-019).
-- =====================================================

-- The most recent sync error for an entry, shown in the UI and cleared on a
-- successful (re)sync. schedule_sync_operations keeps the full history; this
-- is the at-a-glance copy the grid and detail dialog read.
ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.schedule_entries.last_sync_error
  IS 'Human-readable reason the last FSM sync attempt failed; NULL once it succeeds (AC-015).';
COMMENT ON COLUMN public.schedule_entries.last_synced_at
  IS 'When this entry was last successfully written to Zoho FSM.';

-- Allow a retry operation type on the sync log so retries are auditable and
-- distinguishable from the first attempt.
ALTER TABLE public.schedule_sync_operations
  DROP CONSTRAINT IF EXISTS schedule_sync_operations_operation_type_check;
ALTER TABLE public.schedule_sync_operations
  ADD CONSTRAINT schedule_sync_operations_operation_type_check
  CHECK (operation_type IN ('create_appointment', 'update_appointment', 'reconcile', 'retry_sync', 'publish_edit'));
