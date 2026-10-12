\set ON_ERROR_STOP on
-- 20261012100000: AMC per-page permissions backfill. Roles that can use AMC
-- today get View on each new page; roles that cannot get nothing; it adds
-- only, and running it again changes nothing.

INSERT INTO public.roles (id, name) VALUES
  ('97000000-0000-0000-0000-0000000000a1', 'p97o approver'),
  ('97000000-0000-0000-0000-0000000000a2', 'p97o finance'),
  ('97000000-0000-0000-0000-0000000000a3', 'p97o snagging only'),
  ('97000000-0000-0000-0000-0000000000a4', 'p97o amc off');
INSERT INTO public.role_access (role_id, resource, action, enabled) VALUES
  ('97000000-0000-0000-0000-0000000000a1', 'amc', 'approve', true),
  ('97000000-0000-0000-0000-0000000000a2', 'amc_payments', 'view', true),
  ('97000000-0000-0000-0000-0000000000a3', 'snagging', 'view', true),
  ('97000000-0000-0000-0000-0000000000a4', 'amc', 'view', false);

\ir ../../supabase/migrations/20261012100000_amc_per_page_permissions.sql
\ir ../../supabase/migrations/20261012100000_amc_per_page_permissions.sql

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.role_access WHERE role_id = '97000000-0000-0000-0000-0000000000a1' AND action = 'view'
     AND resource IN ('amc_proposals', 'amc_contracts', 'amc_clients', 'amc_site_visits', 'amc_technicians', 'amc_reports', 'amc_fsm_mapping', 'amc_operations_settings');
  IF n <> 8 THEN RAISE EXCEPTION 'an AMC approver got % of the 8 pages', n; END IF;
  SELECT count(*) INTO n FROM public.role_access WHERE role_id = '97000000-0000-0000-0000-0000000000a2' AND resource = 'amc_contracts' AND action = 'view';
  IF n <> 1 THEN RAISE EXCEPTION 'Finance (AMC Payments) did not keep Contracts'; END IF;
  SELECT count(*) INTO n FROM public.role_access WHERE role_id IN ('97000000-0000-0000-0000-0000000000a3', '97000000-0000-0000-0000-0000000000a4') AND resource LIKE 'amc\_%';
  IF n <> 0 THEN RAISE EXCEPTION 'a role without AMC access was given AMC pages (%)', n; END IF;
  -- Additive only: what was there is untouched.
  IF NOT EXISTS (SELECT 1 FROM public.role_access WHERE role_id = '97000000-0000-0000-0000-0000000000a4' AND resource = 'amc' AND enabled = false) THEN
    RAISE EXCEPTION 'an existing row was changed';
  END IF;
END $$;
\echo 97o AMC page permissions: all checks pass
