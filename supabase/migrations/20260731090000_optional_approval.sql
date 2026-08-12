-- =====================================================
-- Migration: Optional approval per day (E1)
-- Description: When a day is submitted the scheduler now chooses WHO should
--              approve it (from the users flagged to receive approval emails),
--              or chooses "no approval" to publish straight to FSM. This
--              records the chosen approver on the version.
-- =====================================================

ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS requested_approver_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.schedule_versions.requested_approver_id
  IS 'The user the submitter asked to approve this day (E1). NULL when submitted with "no approval needed".';
