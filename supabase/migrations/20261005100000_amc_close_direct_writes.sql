-- =====================================================================
-- AMC proposals: no direct writes from browser sessions
--
-- NOT APPLIED. Created on branch amc-hardening (5 Oct 2026); apply only
-- after review, and only as part of the migration reconciliation in
-- docs/database-migration-reconciliation.md.
--
-- Why
-- ---
-- Every AMC write in the portal goes through a server route that checks
-- the caller and the workflow first, then writes with the service-role
-- client (createAdminServerClient): app/api/amc-submissions/** and
-- app/api/amc/[token]. Nothing in the browser, and nothing in the
-- inspector app, writes these tables directly.
--
-- The database still allowed it. The owner policies created in
-- 20260915120000_amc_harden_submissions.sql let an owner INSERT a row in
-- any status and UPDATE any column of their own row, and the approver
-- policy from 20260916100000_amc_approval_flow.sql let an approver change
-- any column while approving. A signed-in user holds their own access
-- token, and the anon key is public (it ships in the inspector app), so a
-- user could PATCH /rest/v1/amc_submissions directly and, for example,
-- set status = 'approved' on their own proposal and then send it to a
-- client, mark it 'signed' with an invented name, or change its price
-- after approval. None of that passes through the approval rules, the
-- audit trail or the pricing checks in the API.
--
-- What this does
-- --------------
--   * Drops the three write policies (owner insert, owner update,
--     approver decide).
--   * Revokes every write privilege on amc_submissions from anon and
--     authenticated. Only the service role (the API) can write.
--   * Keeps the two read policies (owner read, approver read) and the
--     SELECT grant, so RLS still limits what a session could read if a
--     read path ever used the user's own client.
--   * Re-asserts that amc_settings and amc_audit_events are reachable by
--     the service role only (already the case since 20260915130000).
--   * Revokes the proposal-number sequence from anon and authenticated:
--     numbers are drawn by the column default inside service-role
--     inserts, and nobody else should be able to advance it.
--
-- What it does not change
-- -----------------------
-- Creating, saving, submitting, approving, sending back, sending to the
-- client, the client's decision and the signature all run through the
-- service role and keep working exactly as before.
--
-- Rollback (restores the previous access model exactly)
-- -----------------------------------------------------
--   GRANT INSERT, UPDATE, DELETE ON public.amc_submissions TO authenticated;
--   GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.amc_proposal_number_seq
--     TO anon, authenticated;
--   CREATE POLICY "amc_submissions owner insert" ON public.amc_submissions
--     FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
--   CREATE POLICY "amc_submissions owner update" ON public.amc_submissions
--     FOR UPDATE TO authenticated
--     USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
--   (approver decide: see 20260916100000_amc_approval_flow.sql:144-159)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Write policies go. Reads stay governed by RLS.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "amc_submissions owner insert" ON public.amc_submissions;
DROP POLICY IF EXISTS "amc_submissions owner update" ON public.amc_submissions;
DROP POLICY IF EXISTS "amc_submissions approver decide" ON public.amc_submissions;

-- The original open policy must never come back (it was dropped by
-- 20260915120000; re-running 20260721120000 would recreate it).
DROP POLICY IF EXISTS "Allow All on amc_submissions" ON public.amc_submissions;

-- ---------------------------------------------------------------------
-- 2. Privileges: browser roles may read (subject to RLS), never write.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.amc_submissions FROM anon, authenticated;

-- anon had everything revoked in 20260915120000; repeated so this file
-- states the whole model on its own.
REVOKE ALL ON public.amc_submissions FROM anon;

-- ---------------------------------------------------------------------
-- 3. Settings and audit: service role only (unchanged, re-asserted).
--    RLS is on with no policies, so even a stray grant would expose
--    nothing; the revoke makes the intent explicit.
-- ---------------------------------------------------------------------
REVOKE ALL ON public.amc_settings FROM anon, authenticated;
REVOKE ALL ON public.amc_audit_events FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Sequences.
-- ---------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.amc_proposal_number_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.amc_audit_events_id_seq FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Verification (read-only; run by hand after applying)
-- ---------------------------------------------------------------------
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'amc_submissions';
--   -- expect exactly: "amc_submissions owner read" (SELECT),
--   --                 "amc_submissions approver read" (SELECT)
--
-- SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND table_name LIKE 'amc%'
--    AND grantee IN ('anon', 'authenticated')
--  GROUP BY table_name, grantee;
--   -- expect only: authenticated  SELECT  on amc_submissions
