-- =====================================================================
-- password_resets: server-only
--
-- NOT APPLIED. Created on branch amc-hardening (5 Oct 2026). URGENT.
-- Apply only AFTER the code from the same branch is deployed, as part of
-- docs/amc-hardening-production-runbook.md.
--
-- Why
-- ---
-- password_resets holds the one-hour tokens the portal emails for a
-- password reset (modules/auth/auth-actions.ts). It had one policy,
-- "Allow All on Password Resets" (FOR ALL TO public USING true), and anon
-- held every privilege (checked 5 Oct 2026). With the public anon key
-- anyone could request a reset for any user, read the token from this
-- table and set that user's password: account takeover, admins included.
--
-- Who uses it: only requestPasswordReset and resetPassword in
-- modules/auth/auth-actions.ts, which now use the service-role client
-- (same branch). Nothing else, and not the inspector app.
--
-- What this does: drops the open policy and revokes everything from anon
-- and authenticated. RLS stays on with no policies: service role only.
--
-- Rollback
-- --------
--   GRANT ALL ON public.password_resets TO anon, authenticated;
--   CREATE POLICY "Allow All on Password Resets" ON public.password_resets
--     FOR ALL TO public USING (true) WITH CHECK (true);
-- =====================================================================

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on Password Resets" ON public.password_resets;

REVOKE ALL ON public.password_resets FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Verification (read-only; run by hand after applying)
-- ---------------------------------------------------------------------
-- SELECT policyname FROM pg_policies WHERE tablename = 'password_resets';
--   -- expect no rows
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'password_resets' AND grantee IN ('anon', 'authenticated');
--   -- expect no rows
