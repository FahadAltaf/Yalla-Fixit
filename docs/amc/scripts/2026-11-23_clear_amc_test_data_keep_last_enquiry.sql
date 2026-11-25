-- Clear the AMC test data, keeping the last enquiry and what belongs to it (23 Nov 2026).
--
-- KEPT
--   * The enquiry named in keep_enquiry (ENQ-2026-0006, the last one) with its follow-ups and history.
--   * Its site visit(s) (ASM-2026-0006): checklist answers, photos, the scope and asset changes, history,
--     notifications, and the inspector's YFI app alert.
--   * Its client (Bert Porter Test) and that client's properties, with their AMC details: client profile,
--     property profile, assets, scope, access rules (gate passes) and property documents.
--   * Everything that is set up rather than tested: AMC configuration and settings, wording, rate card, FSM
--     service mapping, technicians and their skills, and the history of those changes.
--   * Clients and properties themselves are shared with Snagging: no client or property row is deleted.
--
-- REMOVED
--   * Every other enquiry and site visit, every proposal (all 29), every contract (all 3) and everything
--     under them: visits, call outs, additional work, job sheets, photos, payments, instalments, cheques,
--     allowances, signatories, send log, client links, documents, to-dos, notifications and their history.
--   * With clear_other_clients := true (the default): the AMC details (profile, property profile, assets,
--     scope, access rules, contacts, documents) of the OTHER test clients and properties. Their Snagging
--     client and property records stay. Set it to false to keep those AMC details.
--
-- Supabase only: nothing in Zoho FSM is touched. Number counters are NOT reset (the next enquiry is
-- ENQ-2026-0007, the next proposal AMC-2026-0030).
--
-- HOW (Supabase SQL editor, as the owner)
--   1. Run PART 1 (read-only): what stays and how much goes, table by table.
--   2. Run PART 2 as it is (dry_run := true): it deletes inside the transaction, prints the counts, then
--      throws 'DRY RUN' so nothing is kept. Compare with PART 1.
--   3. Set dry_run := false and run PART 2 again. One transaction: if any step fails, nothing changes.
--   4. PART 3 lists the stored files of what was removed, to delete in Storage. Left alone they do no harm.


-- =====================================================================
-- PART 1. Look first (read-only).
-- =====================================================================

WITH keep_e AS (SELECT id, enquiry_number, customer_id, property_id FROM public.amc_enquiries WHERE enquiry_number = 'ENQ-2026-0006'),
keep_a AS (SELECT id, assessment_number FROM public.amc_assessments WHERE enquiry_id IN (SELECT id FROM keep_e)),
keep_c AS (SELECT customer_id AS id FROM keep_e),
keep_p AS (SELECT id FROM public.amc_property_directory WHERE customer_id IN (SELECT id FROM keep_c) UNION SELECT property_id FROM keep_e)
SELECT 'KEEP enquiry' AS what, enquiry_number AS detail FROM keep_e
UNION ALL SELECT 'KEEP site visit', assessment_number FROM keep_a
UNION ALL SELECT 'KEEP client', coalesce((SELECT name FROM public.amc_client_directory d WHERE d.id = keep_c.id), keep_c.id::text) FROM keep_c
UNION ALL SELECT 'KEEP property', coalesce((SELECT label FROM public.amc_property_directory d WHERE d.id = keep_p.id), keep_p.id::text) FROM keep_p
UNION ALL SELECT 'REMOVE enquiries', count(*)::text FROM public.amc_enquiries WHERE id NOT IN (SELECT id FROM keep_e)
UNION ALL SELECT 'REMOVE site visits', count(*)::text FROM public.amc_assessments WHERE id NOT IN (SELECT id FROM keep_a)
UNION ALL SELECT 'REMOVE proposals', count(*)::text FROM public.amc_submissions
UNION ALL SELECT 'REMOVE contracts', count(*)::text FROM public.amc_contracts
UNION ALL SELECT 'REMOVE visits', count(*)::text FROM public.amc_visits
UNION ALL SELECT 'REMOVE call outs', count(*)::text FROM public.amc_call_outs
UNION ALL SELECT 'REMOVE additional work', count(*)::text FROM public.amc_additional_works
UNION ALL SELECT 'REMOVE client AMC details (other clients)', count(*)::text FROM public.amc_client_profiles WHERE client_id NOT IN (SELECT id FROM keep_c)
UNION ALL SELECT 'REMOVE property AMC details (other properties)', count(*)::text FROM public.amc_property_profiles WHERE property_id NOT IN (SELECT id FROM keep_p);


-- =====================================================================
-- PART 2. Remove (one transaction). Run with dry_run := true first.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  dry_run boolean := true;                       -- << false to keep the removal
  clear_other_clients boolean := true;           -- << false to keep the other test clients' AMC details
  keep_enquiry text := 'ENQ-2026-0006';          -- << the enquiry to keep

  ke uuid[]; ka uuid[]; kc uuid[]; kp uuid[]; kd uuid[]; kasset uuid[];
  keep_ids text[];
  t text; n bigint; total bigint := 0;
  /* Everything under proposals and contracts. None is kept (the kept enquiry has no proposal yet). */
  wipe text[] := ARRAY[
    'amc_client_links', 'amc_visit_checklist_items', 'amc_visit_photos', 'amc_work_photos', 'amc_visit_job_sheets',
    'amc_visit_attempts', 'amc_visit_changes', 'amc_visit_lines', 'amc_visit_charges',
    'amc_additional_quotes', 'amc_additional_works', 'amc_entitlement_usage', 'amc_call_outs', 'amc_visits',
    'amc_contract_entitlements', 'amc_contract_signatories', 'amc_contract_amendments', 'amc_renewal_reminders',
    'amc_payments', 'amc_cheques', 'amc_instalments', 'amc_fsm_sync_events', 'amc_fsm_links',
    'amc_send_log', 'amc_signed_documents', 'amc_approval_steps', 'amc_submission_versions'
  ];
  touched text[];
  guarded text[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO ke FROM public.amc_enquiries WHERE enquiry_number = keep_enquiry;
  IF array_length(ke, 1) IS NULL THEN RAISE EXCEPTION 'Enquiry % not found: nothing done.', keep_enquiry; END IF;
  SELECT coalesce(array_agg(id), '{}') INTO ka FROM public.amc_assessments WHERE enquiry_id = ANY (ke);
  SELECT coalesce(array_agg(DISTINCT customer_id), '{}') INTO kc FROM public.amc_enquiries WHERE id = ANY (ke) AND customer_id IS NOT NULL;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO kp FROM (
    SELECT id AS x FROM public.amc_property_directory WHERE customer_id = ANY (kc)
    UNION SELECT property_id FROM public.amc_enquiries WHERE id = ANY (ke) AND property_id IS NOT NULL
  ) q;
  SELECT coalesce(array_agg(id), '{}') INTO kasset FROM public.amc_property_assets WHERE property_id = ANY (kp);
  /* Documents kept: the kept records', and the kept client's and properties' own (not their contracts'). */
  SELECT coalesce(array_agg(id), '{}') INTO kd FROM public.amc_documents
  WHERE entity_id = ANY (ke || ka || kc || kp);
  keep_ids := (ke || ka || kc || kp || kasset || kd)::text[];
  RAISE NOTICE 'Keeping % enquiry, % site visit(s), % client(s), % propert(ies), % document(s).',
    array_length(ke, 1), coalesce(array_length(ka, 1), 0), coalesce(array_length(kc, 1), 0), coalesce(array_length(kp, 1), 0), coalesce(array_length(kd, 1), 0);

  /* The guards (status, version and audit triggers) off for this transaction only. */
  touched := wipe || ARRAY['amc_contracts', 'amc_submissions', 'amc_assessments', 'amc_enquiries', 'amc_enquiry_follow_ups',
    'amc_site_visit_changes', 'amc_assessment_items', 'amc_assessment_photos', 'amc_communication_log', 'amc_documents',
    'amc_audit_events', 'amc_notifications', 'amc_todos', 'amc_client_profiles', 'amc_property_profiles',
    'amc_property_assets', 'amc_scope_items', 'amc_property_access_rules', 'amc_customer_contacts'];
  SELECT array_agg(x) INTO guarded FROM unnest(touched) AS x WHERE to_regclass('public.' || x) IS NOT NULL;
  FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t); END LOOP;

  /* Files of what goes, for PART 3. */
  CREATE TEMP TABLE IF NOT EXISTS removed_amc_files (from_table text, storage_path text) ON COMMIT PRESERVE ROWS;
  TRUNCATE removed_amc_files;
  FOREACH t IN ARRAY ARRAY['amc_visit_photos', 'amc_work_photos', 'amc_assessment_photos', 'amc_documents'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'storage_path');
    EXECUTE format(
      'INSERT INTO removed_amc_files SELECT %L, storage_path FROM public.%I WHERE storage_path IS NOT NULL AND %s',
      t, t,
      CASE t
        WHEN 'amc_assessment_photos' THEN 'NOT (assessment_id = ANY ($1))'
        WHEN 'amc_documents' THEN 'NOT (id = ANY ($2))'
        ELSE 'true'
      END
    ) USING ka, kd;
  END LOOP;

  /* Links between records that go, so they can be removed in any order. */
  UPDATE public.amc_enquiries SET submission_id = NULL WHERE submission_id IS NOT NULL;
  UPDATE public.amc_assessments SET submission_id = NULL, contract_id = NULL WHERE submission_id IS NOT NULL OR contract_id IS NOT NULL;
  UPDATE public.amc_contracts SET renewed_from_contract_id = NULL WHERE renewed_from_contract_id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'amc_submissions' AND column_name = 'renewal_of_contract_id') THEN
    UPDATE public.amc_submissions SET renewal_of_contract_id = NULL WHERE renewal_of_contract_id IS NOT NULL;
  END IF;

  /* 1. Everything under proposals and contracts. */
  FOREACH t IN ARRAY wipe LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '  %: %', t, n; total := total + n; END IF;
  END LOOP;

  /* 2. The other enquiries' and site visits' own rows. */
  DELETE FROM public.amc_enquiry_follow_ups WHERE NOT (enquiry_id = ANY (ke));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_enquiry_follow_ups: %', n; total := total + n;
  FOREACH t IN ARRAY ARRAY['amc_site_visit_changes', 'amc_assessment_items', 'amc_assessment_photos'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DELETE FROM public.%I WHERE NOT (assessment_id = ANY ($1))', t) USING ka;
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  %: %', t, n; total := total + n;
  END LOOP;
  IF to_regclass('public.amc_communication_log') IS NOT NULL THEN
    DELETE FROM public.amc_communication_log WHERE enquiry_id IS NULL OR NOT (enquiry_id = ANY (ke));
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_communication_log: %', n; total := total + n;
  END IF;

  /* 3. Documents, to-dos, notifications, YFI app alerts and history of what goes. */
  IF clear_other_clients THEN
    DELETE FROM public.amc_documents WHERE NOT (id = ANY (kd));
  ELSE
    /* Only documents of removed records; other clients' and properties' own documents stay. */
    DELETE FROM public.amc_documents WHERE NOT (id = ANY (kd))
      AND entity_id NOT IN (SELECT client_id FROM public.amc_client_profiles UNION SELECT property_id FROM public.amc_property_profiles);
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_documents: %', n; total := total + n;
  DELETE FROM public.todos WHERE id IN (SELECT todo_id FROM public.amc_todos WHERE todo_id IS NOT NULL AND NOT (entity_id::text = ANY (keep_ids)));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  todos (portal): %', n; total := total + n;
  DELETE FROM public.amc_todos WHERE NOT (entity_id::text = ANY (keep_ids));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_todos: %', n; total := total + n;
  DELETE FROM public.amc_notifications WHERE entity_id IS NULL OR NOT (entity_id::text = ANY (keep_ids));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_notifications: %', n; total := total + n;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'snagging_notifications' AND column_name = 'amc_id') THEN
    DELETE FROM public.snagging_notifications WHERE amc_kind IS NOT NULL AND (amc_id IS NULL OR NOT (amc_id::text = ANY (keep_ids)));
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  snagging_notifications (YFI app AMC alerts): %', n; total := total + n;
  END IF;
  /* History: set-up changes (settings, configuration, rate card, technicians) always stay. */
  DELETE FROM public.amc_audit_events
  WHERE NOT (entity_id::text = ANY (keep_ids))
    AND entity_type NOT IN ('settings', 'config', 'rate_card', 'technician')
    AND (clear_other_clients OR entity_type NOT IN ('customer', 'property', 'asset'));
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_audit_events: %', n; total := total + n;

  /* 4. The records themselves. */
  DELETE FROM public.amc_contracts;                       GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_contracts: %', n; total := total + n;
  DELETE FROM public.amc_assessments WHERE NOT (id = ANY (ka)); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_assessments: %', n; total := total + n;
  DELETE FROM public.amc_submissions;                     GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_submissions: %', n; total := total + n;
  DELETE FROM public.amc_enquiries WHERE NOT (id = ANY (ke)); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_enquiries: %', n; total := total + n;

  /* 5. The other test clients' and properties' AMC details (their Snagging records stay). */
  IF clear_other_clients THEN
    DELETE FROM public.amc_scope_items WHERE NOT (property_id = ANY (kp));            GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_scope_items: %', n; total := total + n;
    DELETE FROM public.amc_property_assets WHERE NOT (property_id = ANY (kp));        GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_property_assets: %', n; total := total + n;
    DELETE FROM public.amc_property_access_rules WHERE NOT (property_id = ANY (kp));  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_property_access_rules: %', n; total := total + n;
    DELETE FROM public.amc_property_profiles WHERE NOT (property_id = ANY (kp));      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_property_profiles: %', n; total := total + n;
    DELETE FROM public.amc_customer_contacts WHERE NOT (customer_id = ANY (kc));      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_customer_contacts: %', n; total := total + n;
    DELETE FROM public.amc_client_profiles WHERE NOT (client_id = ANY (kc));          GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_client_profiles: %', n; total := total + n;
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
-- Documents are in the amc-documents bucket; photos in the bucket their page uploads to.
-- Run right after PART 2 with dry_run := false, in the same SQL editor tab.
-- =====================================================================

SELECT from_table, storage_path FROM removed_amc_files ORDER BY 1, 2;


-- =====================================================================
-- PART 4. Check afterwards (read-only): expect 1, 1, 0, 0.
-- =====================================================================
--   select count(*) from public.amc_enquiries;    -- 1 (ENQ-2026-0006)
--   select count(*) from public.amc_assessments;  -- 1 (ASM-2026-0006)
--   select count(*) from public.amc_submissions;  -- 0
--   select count(*) from public.amc_contracts;    -- 0
