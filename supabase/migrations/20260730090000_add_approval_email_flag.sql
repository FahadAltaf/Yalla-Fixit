-- =====================================================
-- Migration: Approval-email recipient flag
-- Description: Approving a schedule is governed by the Approve permission
--              (managers + admins). But the "a day needs approval" email
--              should go to a hand-picked subset, not everyone who can
--              approve. This flag marks exactly who receives that email.
--              Set it TRUE on the account(s) that should be notified.
-- =====================================================

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS receives_schedule_approval_email BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profile.receives_schedule_approval_email
  IS 'When TRUE, this active user receives the "schedule needs approval" email on submission. Independent of the Approve permission.';

CREATE INDEX IF NOT EXISTS idx_user_profile_receives_approval_email
  ON public.user_profile (receives_schedule_approval_email)
  WHERE receives_schedule_approval_email = TRUE;
