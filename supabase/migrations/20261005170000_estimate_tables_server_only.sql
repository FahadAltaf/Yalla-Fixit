-- =====================================================================
-- estimate_revisions, estimate_service_items: server-only
--
-- NOT APPLIED. Created on branch amc-hardening (5 Oct 2026). Apply only
-- AFTER the code from the same branch is deployed, as part of
-- docs/amc-hardening-production-runbook.md.
--
-- Why
-- ---
-- Both tables had an "Allow All" policy (FOR ALL TO public USING true) and
-- full grants to anon and authenticated (5 Oct 2026). With the public anon
-- key anyone could read, add, change or delete quotation revisions and the
-- image rows attached to service items. (The live policy on
-- estimate_service_items is named "Allow All on quotation_service_item_images",
-- from before the table was renamed; both names are dropped below.)
--
-- Who still needs them (checked 5 Oct 2026):
--   * app/api/estimates (dashboard mode), app/api/estimates/revision and
--     app/api/estimates/service-item-images: now service role, behind a
--     signed-in Extensions check (same branch).
--   * The public quotation review page reads neither table directly; the
--     get-estimate edge function returns revisions and reads them with
--     SUPABASE_SERVICE_ROLE_KEY (read from production).
--   * No browser, GraphQL or inspector-app access.
--   Storage objects (the images themselves, in the public "uploads"
--   bucket) are not changed here.
--
-- What this does
-- --------------
-- Drops the open policies and revokes all privileges from anon and
-- authenticated. RLS stays on with no policies, so only the service role
-- (which bypasses RLS) can use the tables.
--
-- Rollback
-- --------
--   GRANT ALL ON public.estimate_revisions, public.estimate_service_items
--     TO anon, authenticated;
--   CREATE POLICY "Allow All on estimate_revisions" ON public.estimate_revisions
--     FOR ALL TO public USING (true) WITH CHECK (true);
--   CREATE POLICY "Allow All on quotation_service_item_images"
--     ON public.estimate_service_items
--     FOR ALL TO public USING (true) WITH CHECK (true);
-- =====================================================================

ALTER TABLE public.estimate_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_service_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on estimate_revisions" ON public.estimate_revisions;
DROP POLICY IF EXISTS "Allow All on quotation_service_item_images" ON public.estimate_service_items;
DROP POLICY IF EXISTS "Allow All on estimate_service_items" ON public.estimate_service_items;

REVOKE ALL ON public.estimate_revisions FROM anon, authenticated;
REVOKE ALL ON public.estimate_service_items FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Verification (read-only; run by hand after applying)
-- ---------------------------------------------------------------------
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('estimate_revisions', 'estimate_service_items');
--   -- expect no rows
-- SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND table_name IN ('estimate_revisions', 'estimate_service_items')
--    AND grantee IN ('anon', 'authenticated');
--   -- expect no rows
