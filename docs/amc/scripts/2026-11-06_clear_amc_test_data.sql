-- Clear the AMC test data (6 Nov 2026), so AMC can be tested from the start.
-- Supabase only: nothing in Zoho FSM is touched.
--
-- Run in the Supabase SQL editor (as the owner: some AMC tables refuse
-- deletes on purpose, and their guards are switched off only while they are
-- emptied, then on again). Part 2 is one transaction: if any step fails,
-- nothing changes.
--
-- CLEARED (every enquiry, site visit, proposal, contract and what hangs off
-- them):
--   enquiries and follow-ups; site visits with their items and photos;
--   proposals with versions, approval steps, the send log and signed
--   documents; contracts with signatories, allowances, usage, amendments,
--   renewal reminders, instalments, payments and cheques; PPM visits with
--   lines, attempts, changes, job sheets, checklists and photos; call outs;
--   additional work and quotes; AMC client and property profiles (Customer
--   ID, prospect/client, contacts, communication log, assets, scope, access
--   rules); AMC documents (the records; see Part 3 for the files); FSM links
--   and sync events; AMC notifications, AMC to-dos (and their entries in
--   Todos), the scheduled-job run log; the audit trail of all the above.
--   The number counters start again at 1 (proposal, contract, enquiry, site
--   visit, call out, additional work, additional quote).
--
-- KEPT (the set-up, so testing starts from the same rules):
--   AMC configuration (amc_config), AMC settings (wording, clauses, scope of
--   work catalogue, approvers), the rate card and its history, FSM service
--   mapping, technicians and their skills, the site visit checklist,
--   notification switches, the additional-service discount, and the change
--   history of those settings.
--   Clients and properties themselves (snagging_clients/snagging_properties,
--   shared with Snagging) are NOT touched: a prospect added from AMC stays as
--   a client record; it just has no AMC profile any more.
--
-- NOTE: live main also shows AMC proposals; after this its Proposals list is
-- empty too.


-- =====================================================================
-- PART 1. Look first (read-only). Rows in every AMC table, and every
-- proposal with its owner, so you can confirm none of it is real.
-- =====================================================================

SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE 'amc\_%'
ORDER BY table_name;

SELECT s.proposal_number, s.status, s.customer->>'customerName' AS customer, u.full_name AS owner, s.created_at
FROM public.amc_submissions s
LEFT JOIN public.user_profile u ON u.id = s.owner_id
ORDER BY s.created_at;

SELECT count(*) AS amc_todos_in_todos
FROM public.todos
WHERE related_type = 'amc_contract' OR related_type LIKE 'amc\_%';


-- =====================================================================
-- PART 2. Clear (one transaction).
-- =====================================================================

BEGIN;

DO $$
DECLARE
  wanted text[] := ARRAY[
    -- Sales
    'amc_enquiries', 'amc_enquiry_follow_ups',
    'amc_assessments', 'amc_assessment_items', 'amc_assessment_photos',
    'amc_submissions', 'amc_submission_versions', 'amc_approval_steps', 'amc_send_log', 'amc_signed_documents',
    -- Contracts and money
    'amc_contracts', 'amc_contract_signatories', 'amc_contract_entitlements', 'amc_entitlement_usage',
    'amc_contract_amendments', 'amc_renewal_reminders',
    'amc_instalments', 'amc_payments', 'amc_cheques',
    -- Delivery
    'amc_visits', 'amc_visit_lines', 'amc_visit_attempts', 'amc_visit_changes', 'amc_visit_job_sheets',
    'amc_visit_checklist_items', 'amc_visit_photos',
    'amc_call_outs', 'amc_additional_works', 'amc_additional_quotes', 'amc_work_photos',
    -- What AMC keeps about clients and properties
    'amc_client_profiles', 'amc_customer_contacts', 'amc_communication_log',
    'amc_property_profiles', 'amc_property_assets', 'amc_scope_items', 'amc_property_access_rules',
    'amc_documents',
    -- FSM links, alerts, to-dos, job runs
    'amc_fsm_links', 'amc_fsm_sync_events',
    'amc_notifications', 'amc_todos', 'amc_job_runs'
  ];
  present text[];
  t text;
BEGIN
  /* Only the tables this database has (a held migration may not be applied). */
  SELECT array_agg(x) INTO present FROM unnest(wanted) AS x WHERE to_regclass('public.' || x) IS NOT NULL;

  /* 1. The guards off, for this transaction only. */
  FOREACH t IN ARRAY present LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
  ALTER TABLE public.amc_audit_events DISABLE TRIGGER USER;

  /* 2. Empty them together. No CASCADE: if anything outside this list still
        pointed at them, this stops and nothing changes. */
  EXECUTE 'TRUNCATE TABLE ' || (SELECT string_agg(format('public.%I', x), ', ') FROM unnest(present) AS x);

  /* 3. The audit trail of the records just cleared; settings history stays. */
  DELETE FROM public.amc_audit_events
  WHERE entity_type IN (
    'submission', 'contract', 'task', 'visit', 'enquiry', 'call_out', 'quotation', 'quote', 'customer',
    'assessment', 'property', 'amendment', 'instalment', 'asset', 'additional_work', 'token', 'snag',
    'renewal', 'document'
  );

  /* 4. AMC's entries in Todos (their comments and assignees go with them). */
  DELETE FROM public.todos WHERE related_type = 'amc_contract' OR related_type LIKE 'amc\_%';

  /* 5. Numbers start again at 1. */
  FOREACH t IN ARRAY ARRAY[
    'amc_proposal_number_seq', 'amc_contract_number_seq', 'amc_enquiry_number_seq', 'amc_assessment_number_seq',
    'amc_call_out_number_seq', 'amc_additional_work_number_seq', 'amc_additional_quote_number_seq'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH 1', t);
    END IF;
  END LOOP;

  /* 6. The guards back on. */
  FOREACH t IN ARRAY present LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
  ALTER TABLE public.amc_audit_events ENABLE TRIGGER USER;

  RAISE NOTICE 'Cleared % AMC tables.', array_length(present, 1);
END $$;

COMMIT;


-- =====================================================================
-- PART 2 check. Expect 0 rows in every cleared table, the kept tables as
-- before, and no AMC table with a guard left switched off.
-- =====================================================================

SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE 'amc\_%'
ORDER BY table_name;

SELECT c.relname AS table_with_guard_off, tg.tgname
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'amc\_%' AND NOT tg.tgisinternal AND tg.tgenabled = 'D';
-- expect no rows


-- =====================================================================
-- PART 3. The files (Supabase Storage, not SQL).
-- The AMC PDFs, photos and signed scans are in the "amc-documents" bucket,
-- which only AMC uses. Supabase does not let SQL delete storage files, so
-- empty it in the dashboard: Storage > amc-documents > select all > Delete.
-- Left alone they do no harm (nothing points at them any more); they only
-- take space.
-- =====================================================================
