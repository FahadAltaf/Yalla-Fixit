-- =====================================================================
-- AMC Proposals v2 — Phase 0: close the live access-control defect
--
-- Prerequisite work, ahead of the v2 feature phases. Not a v2
-- requirement, but the FRD independently calls it out (§7: "an access
-- rule that lets anyone read or change it directly ... Replace that
-- rule").
--
-- Schema-only and idempotent. No application code depends on it, so it
-- can be applied on its own, immediately, without waiting for Phase 1.
-- =====================================================================

/*
  The table shipped with:

      CREATE POLICY "Allow All on amc_submissions"
      ON public.amc_submissions FOR ALL TO public
      USING (true) WITH CHECK (true);

  The API route scopes every query by owner_id and gates on the AMC
  allowlist, but PostgREST is reachable directly, so none of that
  applied. Verified on 15 Sep: the anon key -- the one shipped to every
  browser -- read all ten rows, each carrying the customer JSONB with
  name, phone, email and both coordination contacts. The policy also
  permitted writes.

  Two changes below. Either alone would close the hole; both together
  mean a future route that forgets to scope by owner still cannot leak
  across users.

  Note on the approver: FR5.3 gives approval rights by role, and FR3.2
  lets the approver see submissions sent for review. That policy is
  deliberately NOT written here -- the AMC resource and the review
  statuses do not exist until Phase 4, and a policy referencing them now
  would either fail or silently match nothing. It is added in the Phase 4
  migration, alongside the things it depends on.
*/

DROP POLICY IF EXISTS "Allow All on amc_submissions" ON public.amc_submissions;

-- Owner-scoped access for any caller arriving with a user JWT.
DROP POLICY IF EXISTS "amc_submissions owner read" ON public.amc_submissions;
CREATE POLICY "amc_submissions owner read"
ON public.amc_submissions FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "amc_submissions owner insert" ON public.amc_submissions;
CREATE POLICY "amc_submissions owner insert"
ON public.amc_submissions FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "amc_submissions owner update" ON public.amc_submissions;
CREATE POLICY "amc_submissions owner update"
ON public.amc_submissions FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

/*
  No policy for `anon`, and the grant is revoked outright.

  Nothing in the app reads this table from the browser: the client calls
  /api/amc-submissions, which uses the service-role client. Service role
  bypasses RLS, so the API is unaffected by everything above -- this
  migration cannot break the module.

  The public client links of FR5.4-5.7 do not change this either. Those
  are served by a route handler that looks the submission up by token
  hash using the service-role client, exactly as the snagging quotation
  link does; the browser never queries this table directly.
*/
REVOKE ALL ON public.amc_submissions FROM anon;


-- ---------------------------------------------------------------------
-- Verification -- expect anon_policies = 0 and total_policies = 3.
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amc_submissions'
      AND 'anon' = ANY(roles))                        AS anon_policies_expect_0,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amc_submissions')
                                                      AS total_policies_expect_3;
