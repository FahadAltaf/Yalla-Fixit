-- =====================================================================
-- AMC proposals survive the deletion of the user who created them
--
-- NOT APPLIED. Branch amc-hardening (security phase, 6 Oct 2026).
-- SAFE BEFORE CODE DEPLOY: it only changes what happens when a user
-- profile is deleted. Main never deletes proposals; deleting a user who
-- owns proposals is refused instead of silently deleting them (the new
-- user API says "deactivate instead"; main's user screen shows the
-- database error).
--
-- amc_submissions.owner_id was ON DELETE CASCADE (production, 6 Oct
-- 2026): removing an employee's profile deleted every AMC proposal they
-- had created, signed ones included, and with them the history the
-- contracts were activated from. owner_id stays NOT NULL (the workflow
-- needs an owner), so the safe rule is RESTRICT: a person who owns AMC
-- records is deactivated (is_active = false), not deleted. Every other
-- user reference on the AMC tables is already ON DELETE SET NULL.
-- =====================================================================

ALTER TABLE public.amc_submissions
  DROP CONSTRAINT IF EXISTS amc_submissions_owner_id_fkey;
ALTER TABLE public.amc_submissions
  ADD CONSTRAINT amc_submissions_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE RESTRICT NOT VALID;
/* Existing rows already satisfy it (the old FK held); validated without
   blocking writes for longer than a scan of a small table. */
ALTER TABLE public.amc_submissions VALIDATE CONSTRAINT amc_submissions_owner_id_fkey;

-- ---------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------
--   ALTER TABLE public.amc_submissions DROP CONSTRAINT amc_submissions_owner_id_fkey;
--   ALTER TABLE public.amc_submissions ADD CONSTRAINT amc_submissions_owner_id_fkey
--     FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;
