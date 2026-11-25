-- Remove chosen AMC test records before go-live (DEV-506, 22 Nov 2026).
-- Supabase only: nothing in Zoho FSM is touched. Unlike 2026-11-06_clear_amc_test_data.sql, which empties
-- every AMC table, this removes only the records you name and what hangs off them; real records stay.
--
-- Run in the Supabase SQL editor as the owner (some AMC tables refuse deletes on purpose; their guards are
-- switched off only inside the transaction, then on again).
--
-- HOW
--   1. Put the numbers in the two lists in PART 0 (proposal numbers like AMC-2026-0042, enquiry numbers like
--      ENQ-2026-0007). A proposal takes its contract, the contract's visits, call outs, additional work,
--      payments, allowances, documents, to-dos, notifications and history with it. An enquiry takes its
--      follow-ups, its site visits and every proposal made from it.
--   2. Run PART 1 (read-only): what would go, table by table, and the records named.
--   3. Run PART 2 with dry_run := true: it deletes inside the transaction, prints the counts, then throws
--      'DRY RUN' so nothing is kept. Compare with PART 1.
--   4. Set dry_run := false and run PART 2 again. One transaction: if any step fails, nothing changes.
--   5. PART 3 lists the stored files of the removed documents, to delete in Storage > amc-documents.
--
-- KEPT: AMC configuration and settings, the rate card, FSM service mapping, technicians, every record not
-- named. Clients and properties (shared with Snagging) are not touched. Number counters are NOT reset.


-- =====================================================================
-- PART 0. The records to remove. Edit these two lines (the same in PART 1 and PART 2).
-- =====================================================================
--   proposals: ARRAY['AMC-2026-0042', 'AMC-2026-0043']::text[]
--   enquiries: ARRAY['ENQ-2026-0007']::text[]


-- =====================================================================
-- PART 1. Look first (read-only).
-- =====================================================================

WITH chosen_enquiries AS (
  SELECT id, enquiry_number FROM public.amc_enquiries
  WHERE enquiry_number = ANY (ARRAY[]::text[])                          -- << enquiries
),
chosen_submissions AS (
  SELECT id, proposal_number, status, customer->>'customerName' AS customer FROM public.amc_submissions
  WHERE proposal_number = ANY (ARRAY[]::text[])                         -- << proposals
     OR enquiry_id IN (SELECT id FROM chosen_enquiries)
),
chosen_contracts AS (
  SELECT id, contract_number, status FROM public.amc_contracts WHERE submission_id IN (SELECT id FROM chosen_submissions)
)
SELECT 'enquiry' AS kind, enquiry_number AS number, NULL AS status, NULL AS customer FROM chosen_enquiries
UNION ALL SELECT 'proposal', proposal_number, status, customer FROM chosen_submissions
UNION ALL SELECT 'contract', contract_number, status, NULL FROM chosen_contracts
ORDER BY 1, 2;

-- Contracts that point at a chosen one (a renewal made from it): their link is cleared, they stay.
SELECT c.contract_number AS keeps_but_loses_its_renewal_link, c.renewed_from_contract_id
FROM public.amc_contracts c
WHERE c.renewed_from_contract_id IN (
  SELECT id FROM public.amc_contracts WHERE submission_id IN (
    SELECT id FROM public.amc_submissions WHERE proposal_number = ANY (ARRAY[]::text[])   -- << proposals
  )
);


-- =====================================================================
-- PART 2. Remove (one transaction). Run with dry_run := true first.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  dry_run boolean := true;                                              -- << false to keep the removal
  proposal_numbers text[] := ARRAY[]::text[];                           -- << proposals
  enquiry_numbers text[] := ARRAY[]::text[];                            -- << enquiries

  e uuid[]; s uuid[]; c uuid[]; v uuid[]; co uuid[]; aw uuid[]; a uuid[]; j uuid[]; d uuid[];
  everything uuid[];
  t text; col text; n bigint; total bigint := 0;
  /* Children first. Each is cleared by whichever of these columns it has. */
  ordered text[] := ARRAY[
    'amc_client_links', 'amc_visit_checklist_items', 'amc_visit_photos', 'amc_work_photos', 'amc_visit_job_sheets',
    'amc_visit_attempts', 'amc_visit_changes', 'amc_visit_lines', 'amc_visit_charges',
    'amc_additional_quotes', 'amc_additional_works', 'amc_call_outs', 'amc_visits',
    'amc_entitlement_usage', 'amc_contract_entitlements', 'amc_contract_signatories', 'amc_contract_amendments',
    'amc_renewal_reminders', 'amc_payments', 'amc_cheques', 'amc_instalments', 'amc_fsm_sync_events', 'amc_fsm_links',
    'amc_send_log', 'amc_signed_documents', 'amc_approval_steps', 'amc_submission_versions',
    'amc_site_visit_changes', 'amc_assessment_items', 'amc_assessment_photos', 'amc_enquiry_follow_ups'
  ];
  keys text[] := ARRAY['job_sheet_id', 'visit_id', 'call_out_id', 'additional_work_id', 'contract_id', 'submission_id', 'assessment_id', 'enquiry_id'];
  guarded text[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO e FROM public.amc_enquiries WHERE enquiry_number = ANY (enquiry_numbers);
  SELECT coalesce(array_agg(id), '{}') INTO s FROM public.amc_submissions WHERE proposal_number = ANY (proposal_numbers) OR enquiry_id = ANY (e);
  SELECT coalesce(array_agg(id), '{}') INTO c FROM public.amc_contracts WHERE submission_id = ANY (s);
  SELECT coalesce(array_agg(id), '{}') INTO v FROM public.amc_visits WHERE contract_id = ANY (c);
  SELECT coalesce(array_agg(id), '{}') INTO co FROM public.amc_call_outs WHERE contract_id = ANY (c);
  SELECT coalesce(array_agg(id), '{}') INTO aw FROM public.amc_additional_works WHERE contract_id = ANY (c);
  SELECT coalesce(array_agg(id), '{}') INTO a FROM public.amc_assessments WHERE enquiry_id = ANY (e) OR submission_id = ANY (s);
  SELECT coalesce(array_agg(id), '{}') INTO j FROM public.amc_visit_job_sheets WHERE visit_id = ANY (v) OR contract_id = ANY (c);
  everything := e || s || c || v || co || aw || a || j;
  IF array_length(s, 1) IS NULL AND array_length(e, 1) IS NULL THEN
    RAISE EXCEPTION 'Nothing named: put the proposal or enquiry numbers in the lists.';
  END IF;
  RAISE NOTICE 'Named: % enquiries, % proposals, % contracts, % visits, % call outs, % additional works, % site visits.',
    coalesce(array_length(e, 1), 0), coalesce(array_length(s, 1), 0), coalesce(array_length(c, 1), 0), coalesce(array_length(v, 1), 0),
    coalesce(array_length(co, 1), 0), coalesce(array_length(aw, 1), 0), coalesce(array_length(a, 1), 0);

  /* The guards off for this transaction only. */
  SELECT array_agg(x) INTO guarded FROM unnest(ordered || ARRAY['amc_contracts', 'amc_submissions', 'amc_assessments', 'amc_enquiries', 'amc_documents', 'amc_audit_events', 'amc_notifications', 'amc_todos']) AS x
  WHERE to_regclass('public.' || x) IS NOT NULL;
  FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t); END LOOP;

  /* Links from records that stay. */
  UPDATE public.amc_contracts SET renewed_from_contract_id = NULL WHERE renewed_from_contract_id = ANY (c) AND NOT (id = ANY (c));
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'amc_submissions' AND column_name = 'renewal_of_contract_id') THEN
    UPDATE public.amc_submissions SET renewal_of_contract_id = NULL WHERE renewal_of_contract_id = ANY (c) AND NOT (id = ANY (s));
  END IF;

  /* 1. The children, deepest first. */
  FOREACH t IN ARRAY ordered LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    FOREACH col IN ARRAY keys LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = col);
      EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', t, col)
        USING CASE col WHEN 'job_sheet_id' THEN j WHEN 'visit_id' THEN v WHEN 'call_out_id' THEN co WHEN 'additional_work_id' THEN aw
                       WHEN 'contract_id' THEN c WHEN 'submission_id' THEN s WHEN 'assessment_id' THEN a ELSE e END;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE '  % (by %): %', t, col, n; total := total + n; END IF;
    END LOOP;
    /* The base records themselves, by their own id. */
    IF t = 'amc_visit_job_sheets' THEN DELETE FROM public.amc_visit_job_sheets WHERE id = ANY (j); END IF;
  END LOOP;

  /* 2. Records kept by kind and id: documents (files listed in PART 3), to-dos, notifications, history. */
  SELECT coalesce(array_agg(id), '{}') INTO d FROM public.amc_documents WHERE entity_id = ANY (everything);
  CREATE TEMP TABLE IF NOT EXISTS removed_amc_files (storage_path text) ON COMMIT PRESERVE ROWS;
  INSERT INTO removed_amc_files SELECT storage_path FROM public.amc_documents WHERE id = ANY (d);
  DELETE FROM public.amc_documents WHERE id = ANY (d);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_documents: %', n; total := total + n;
  DELETE FROM public.todos WHERE id IN (SELECT todo_id FROM public.amc_todos WHERE entity_id = ANY (everything) AND todo_id IS NOT NULL);
  DELETE FROM public.amc_todos WHERE entity_id = ANY (everything);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_todos: %', n; total := total + n;
  DELETE FROM public.amc_notifications WHERE contract_id = ANY (c) OR submission_id = ANY (s) OR entity_id::text = ANY (everything::text[]);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_notifications: %', n; total := total + n;
  DELETE FROM public.amc_audit_events WHERE entity_id::text = ANY (everything::text[]) OR entity_id::text = ANY (d::text[]);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_audit_events: %', n; total := total + n;
  IF to_regclass('public.amc_status_history') IS NOT NULL THEN
    DELETE FROM public.amc_status_history WHERE entity_id::text = ANY (everything::text[]);
  END IF;

  /* 3. The named records, children before parents. */
  DELETE FROM public.amc_contracts WHERE id = ANY (c);       GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_contracts: %', n; total := total + n;
  DELETE FROM public.amc_assessments WHERE id = ANY (a);     GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_assessments: %', n; total := total + n;
  DELETE FROM public.amc_submissions WHERE id = ANY (s);     GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_submissions: %', n; total := total + n;
  DELETE FROM public.amc_enquiries WHERE id = ANY (e);       GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '  amc_enquiries: %', n; total := total + n;

  /* The guards back on. */
  FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t); END LOOP;

  RAISE NOTICE 'Removed % rows in all.', total;
  IF dry_run THEN
    RAISE EXCEPTION 'DRY RUN: nothing was kept. Set dry_run := false to remove these % rows.', total;
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- PART 3. The files of the removed documents (Supabase Storage, not SQL).
-- Delete these paths in Storage > amc-documents. Left alone they do no harm.
-- =====================================================================

SELECT storage_path FROM removed_amc_files ORDER BY 1;
