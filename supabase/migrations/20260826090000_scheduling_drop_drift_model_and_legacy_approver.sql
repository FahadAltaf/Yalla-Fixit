-- =====================================================
-- Migration: Remove the dead FSM-drift model and the legacy approver flag
-- Description: Scheduling cleanup following the phase 1-3 consolidation.
--
--   1. The "changed in FSM / needs review" model is unreachable. When
--      reconcile switched to silently ADOPTING Zoho FSM's scheduled times
--      (rather than flagging a day or entry as drifted), every writer of
--      these fields went away -- the only remaining reference in the
--      codebase set changed_in_fsm_at back to NULL. Nothing could ever set
--      them, so the columns, the 'review_required' sync status and the
--      'published_fsm_changed' version status are all dropped, along with
--      the UI branches that tested for them.
--
--      Per-entry sync state is unaffected: schedule_entries keeps
--      sync_status, last_sync_error, last_synced_at and needs_sync, and
--      fsm_last_modified_marker remains reconcile's comparison baseline.
--
--   2. user_profile.is_schedule_approver is the last remnant of the
--      original single-approver design (BR-002). Approval moved to the
--      SCHEDULING/APPROVE permission plus schedule_versions
--      .requested_approver_id, but the reject route was still gating on
--      this flag -- so a user granted Approve could approve a day and then
--      be refused when rejecting it. The route now uses the permission and
--      the column is dropped.
-- =====================================================

-- 1. Drop the drift columns.
ALTER TABLE public.schedule_entries
  DROP COLUMN IF EXISTS changed_in_fsm_at,
  DROP COLUMN IF EXISTS changed_in_fsm_fields;

-- Narrow sync_status: 'review_required' was only ever reachable via drift.
-- Defensive re-map first so the new constraint can't fail on legacy rows.
UPDATE public.schedule_entries
  SET sync_status = 'synced'
  WHERE sync_status = 'review_required' AND fsm_appointment_id IS NOT NULL;

UPDATE public.schedule_entries
  SET sync_status = 'not_ready'
  WHERE sync_status = 'review_required';

ALTER TABLE public.schedule_entries
  DROP CONSTRAINT IF EXISTS schedule_entries_sync_status_check;

ALTER TABLE public.schedule_entries
  ADD CONSTRAINT schedule_entries_sync_status_check
  CHECK (sync_status IN ('not_ready', 'ready', 'syncing', 'synced', 'failed'));

-- Narrow the version status: 'published_fsm_changed' was only ever reachable
-- via drift, and the UI already rendered it with the "Published" label.
UPDATE public.schedule_versions
  SET status = 'published'
  WHERE status = 'published_fsm_changed';

ALTER TABLE public.schedule_versions
  DROP CONSTRAINT IF EXISTS schedule_versions_status_check;

ALTER TABLE public.schedule_versions
  ADD CONSTRAINT schedule_versions_status_check
  CHECK (status IN (
    'draft', 'pending_approval', 'rejected', 'approved_syncing',
    'published', 'sync_failed', 'partially_synced', 'draft_revision'
  ));

-- 2. Drop the legacy sole-approver flag and its partial unique index.
DROP INDEX IF EXISTS public.idx_user_profile_single_schedule_approver;

ALTER TABLE public.user_profile
  DROP COLUMN IF EXISTS is_schedule_approver;
