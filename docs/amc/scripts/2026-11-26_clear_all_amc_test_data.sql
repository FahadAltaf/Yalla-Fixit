-- Clear ALL AMC test data before the tracker import (26 Nov 2026, the user: "remove all test data in amc").
--
-- REMOVED (nothing kept)
--   * Every enquiry (ENQ-2026-0006, 0007) and site visit, with follow-ups, checklist answers, photos,
--     scope/asset changes and history.
--   * Every proposal (4) and contract (3: AMC-C-2026-0004, 0005, 0006) and everything under them:
--     PPM visits (143), call outs, additional work, job sheets, photos, charges, payments, instalments,
--     cheques, allowances and usage, signatories, amendments, send log, client links, signed documents.
--   * Their documents, to-dos (with the portal to-do they opened), AMC notifications, the YFI app AMC
--     alerts, the AMC entries on the Scheduling board (DEV-489), and their history.
--   * The AMC details of every test client and property: client profile, contacts, property profile,
--     assets, scope, access rules and their documents.
--
-- KEPT
--   * Everything that is set up rather than tested: AMC configuration and settings, notification
--     settings, wording, rate card, FSM service mapping, the site visit checklist, the additional service
--     discount, technicians and their skills, and the history of those changes.
--   * Clients and properties themselves: they are shared with Snagging, so no client or property row is
--     deleted (only their AMC details). PART 1 lists the ones AMC used, if you want to tidy them later.
--   * The daily job's run history (set clear_job_runs := true to clear it too).
--   * Zoho FSM: nothing there is touched.
--
-- NUMBERS: by default the counters carry on (next enquiry ENQ-2026-0008, proposal AMC-2026-0033 ...).
-- Set reset_numbers := true to start every AMC number again at 0001 for go-live. Only do that if no
-- test number was ever given to a real client.
--
-- HOW (Supabase SQL editor, as the owner)
--   1. Run PART 1 (read-only): how much goes, table by table, and the clients AMC used.
--   2. Run PART 2 as it is (dry_run := true): it deletes inside the transaction, prints the counts,
--      then throws 'DRY RUN' so nothing is kept. Compare with PART 1.
--   3. Set dry_run := false and run PART 2 again. One transaction: if any step fails, nothing changes.
--   4. PART 3 lists the stored files of what was removed, to delete in Storage. Left alone they do no harm.
--   5. PART 4 checks: every count 0.


-- =====================================================================
-- PART 1. Look first (read-only).
-- =====================================================================

SELECT 'enquiries' AS what, count(*) AS rows FROM public.amc_enquiries
UNION ALL SELECT 'site visits', count(*) FROM public.amc_assessments
UNION ALL SELECT 'proposals', count(*) FROM public.amc_submissions
UNION ALL SELECT 'contracts', count(*) FROM public.amc_contracts
UNION ALL SELECT 'PPM visits', count(*) FROM public.amc_visits
UNION ALL SELECT 'call outs', count(*) FROM public.amc_call_outs
UNION ALL SELECT 'additional work', count(*) FROM public.amc_additional_works
UNION ALL SELECT 'instalments', count(*) FROM public.amc_instalments
UNION ALL SELECT 'payments', count(*) FROM public.amc_payments
UNION ALL SELECT 'to-dos', count(*) FROM public.amc_todos
UNION ALL SELECT 'notifications', count(*) FROM public.amc_notifications
UNION ALL SELECT 'AMC entries on the Scheduling board', count(*) FROM public.schedule_entries WHERE amc_kind IS NOT NULL
UNION ALL SELECT 'client AMC details', count(*) FROM public.amc_client_profiles
UNION ALL SELECT 'property AMC details', count(*) FROM public.amc_property_profiles
UNION ALL SELECT 'property assets', count(*) FROM public.amc_property_assets
UNION ALL SELECT 'history (not set-up)', count(*) FROM public.amc_audit_events WHERE entity_type NOT IN ('settings', 'config', 'rate_card', 'technician');

-- The clients AMC used (kept; shared with Snagging):
SELECT DISTINCT d.name AS client_kept FROM public.amc_client_directory d
WHERE d.id IN (SELECT customer_id FROM public.amc_enquiries UNION SELECT client_id FROM public.amc_client_profiles);


-- =====================================================================
-- PART 2. Remove (one transaction). Run with dry_run := true first.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  dry_run boolean := true;          -- << false to keep the removal
  reset_numbers boolean := false;   -- << true to start every AMC number again at 0001
  clear_job_runs boolean := false;  -- << true to clear the daily job's run history too

  t text; n bigint; total bigint := 0;
  /* Everything under proposals, contracts, visits and call outs, children first. */
  wipe text[] := ARRAY[
    'amc_client_links', 'amc_visit_checklist_items', 'amc_visit_photos', 'amc_work_photos', 'amc_visit_job_sheets',
    'amc_visit_attempts', 'amc_visit_changes', 'amc_visit_lines', 'amc_visit_charges',
    'amc_additional_quotes', 'amc_additional_works', 'amc_entitlement_usage', 'amc_call_outs', 'amc_visits',
    'amc_contract_entitlements', 'amc_contract_signatories', 'amc_contract_amendments', 'amc_renewal_reminders',
    'amc_payments', 'amc_cheques', 'amc_instalments', 'amc_fsm_sync_events', 'amc_fsm_links',
    'amc_send_log', 'amc_signed_documents', 'amc_approval_steps', 'amc_submission_versions',
    'amc_site_visit_changes', 'amc_assessment_items', 'amc_assessment_photos', 'amc_enquiry_follow_ups',
    'amc_communication_log', 'amc_documents'
  ];
  /* The AMC details of clients and properties (their Snagging rows stay). */
  details text[] := ARRAY['amc_scope_items', 'amc_property_assets', 'amc_property_access_rules', 'amc_property_profiles', 'amc_customer_contacts', 'amc_client_profiles'];
  touched text[];
  guarded text[];
BEGIN
  /* The guards (status, version and audit triggers) off for this transaction only. */
  touched := wipe || details || ARRAY['amc_contracts', 'amc_submissions', 'amc_assessments', 'amc_enquiries',
    'amc_audit_events', 'amc_notifications', 'amc_todos'];
  SELECT array_agg(x) INTO guarded FROM unnest(touched) AS x WHERE to_regclass('public.' || x) IS NOT NULL;
  FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t); END LOOP;

  /* Files of what goes, for PART 3. */
  CREATE TEMP TABLE IF NOT EXISTS removed_amc_files (from_table text, storage_path text) ON COMMIT PRESERVE ROWS;
  TRUNCATE removed_amc_files;
  FOREACH t IN ARRAY ARRAY['amc_visit_photos', 'amc_work_photos', 'amc_assessment_photos', 'amc_documents', 'amc_signed_documents'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'storage_path');
    EXECUTE format('INSERT INTO removed_amc_files SELECT %L, storage_path FROM public.%I WHERE storage_path IS NOT NULL', t, t);
  END LOOP;

  /* Links between records that go, so they can be removed in any order. */
  UPDATE public.amc_enquiries SET submission_id = NULL WHERE submission_id IS NOT NULL;
  UPDATE public.amc_assessments SET submission_id = NULL, contract_id = NULL WHERE submission_id IS NOT NULL OR contract_id IS NOT NULL;
  UPDATE public.amc_contracts SET renewed_from_contract_id = NULL WHERE renewed_from_contract_id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'amc_submissions' AND column_name = 'renewal_of_contract_id') THEN
    UPDATE public.amc_submissions SET renewal_of_contract_id = NULL WHERE renewal_of_contract_id IS NOT NULL;
  END IF;

  /* 1. Everything under the records. */
  FOREACH t IN ARRAY wipe LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '  %: %', t, n; total := total + n; END IF;
  END LOOP;

  /* 2. To-dos (and the portal to-do each opened), notifications, YFI app alerts, board entries. */
  DELETE FROM public.todos WHERE id IN (SELECT todo_id FROM public.amc_todos WHERE todo_id IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  todos (portal, opened by AMC): %', n; total := total + n;
  DELETE FROM public.amc_todos;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_todos: %', n; total := total + n;
  DELETE FROM public.amc_notifications;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_notifications: %', n; total := total + n;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'snagging_notifications' AND column_name = 'amc_kind') THEN
    DELETE FROM public.snagging_notifications WHERE amc_kind IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  snagging_notifications (YFI app AMC alerts): %', n; total := total + n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schedule_entries' AND column_name = 'amc_kind') THEN
    /* Their crew rows go with them (ON DELETE CASCADE). Only AMC entries: ordinary schedule entries stay. */
    DELETE FROM public.schedule_entries WHERE amc_kind IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  schedule_entries (AMC on the board): %', n; total := total + n;
  END IF;

  /* 3. History: set-up changes (settings, configuration, rate card, technicians) stay. */
  DELETE FROM public.amc_audit_events WHERE entity_type NOT IN ('settings', 'config', 'rate_card', 'technician');
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_audit_events: %', n; total := total + n;

  /* 4. The records themselves. */
  DELETE FROM public.amc_contracts;   GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_contracts: %', n; total := total + n;
  DELETE FROM public.amc_assessments; GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_assessments: %', n; total := total + n;
  DELETE FROM public.amc_submissions; GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_submissions: %', n; total := total + n;
  DELETE FROM public.amc_enquiries;   GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_enquiries: %', n; total := total + n;

  /* 5. The AMC details of clients and properties. */
  FOREACH t IN ARRAY details LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  %: %', t, n; total := total + n;
  END LOOP;

  /* 6. Optional: the daily job's run history. */
  IF clear_job_runs AND to_regclass('public.amc_job_runs') IS NOT NULL THEN
    DELETE FROM public.amc_job_runs; GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_job_runs: %', n; total := total + n;
  END IF;

  /* 7. Optional: every AMC number from 0001 again. */
  IF reset_numbers THEN
    FOREACH t IN ARRAY ARRAY['amc_enquiry_number_seq', 'amc_assessment_number_seq', 'amc_proposal_number_seq', 'amc_contract_number_seq',
                             'amc_call_out_number_seq', 'amc_additional_work_number_seq', 'amc_additional_quote_number_seq'] LOOP
      CONTINUE WHEN to_regclass('public.' || t) IS NULL;
      EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH 1', t);
      RAISE NOTICE '  % restarted at 1', t;
    END LOOP;
  END IF;

  /* The guards back on. */
  FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t); END LOOP;

  RAISE NOTICE 'Removed % rows in all.', total;
  IF dry_run THEN
    RAISE EXCEPTION 'DRY RUN: nothing was kept. Set dry_run := false to remove these % rows.', total;
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- PART 3. The stored files of what was removed (Supabase Storage, not SQL).
-- Run right after PART 2 with dry_run := false, in the same SQL editor tab.
-- =====================================================================

SELECT from_table, storage_path FROM removed_amc_files ORDER BY 1, 2;


-- =====================================================================
-- PART 4. Check afterwards (read-only): every count 0.
-- =====================================================================
--   select (select count(*) from public.amc_enquiries)   as enquiries,
--          (select count(*) from public.amc_assessments) as site_visits,
--          (select count(*) from public.amc_submissions) as proposals,
--          (select count(*) from public.amc_contracts)   as contracts,
--          (select count(*) from public.amc_visits)      as visits,
--          (select count(*) from public.amc_call_outs)   as call_outs,
--          (select count(*) from public.amc_client_profiles) as client_details,
--          (select count(*) from public.schedule_entries where amc_kind is not null) as board_entries;
