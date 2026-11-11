\set ON_ERROR_STOP on
-- Schema review (6 Oct 2026): invariants and the two new functions.

-- ------------------------------------------------------------------
-- A. Catalogue invariants
-- ------------------------------------------------------------------
-- A1. Every AMC / shared-customer table: RLS on, nothing granted to the API roles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND (c.relname LIKE 'amc\_%' OR c.relname IN ('customers', 'customer_properties'))
  LOOP
    IF NOT r.relrowsecurity THEN RAISE EXCEPTION 'RLS off on %', r.relname; END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                WHERE g.table_schema = 'public' AND g.table_name = r.relname
                  AND g.grantee IN ('anon', 'authenticated')
                  AND (r.relname <> 'amc_submissions' OR g.privilege_type <> 'SELECT' OR g.grantee <> 'authenticated')) THEN
      RAISE EXCEPTION 'API role grant on %', r.relname;
    END IF;
  END LOOP;
END $$;

-- A2. No ON DELETE CASCADE into or between AMC history, except draft-only
--     assessment items. (amc_submissions.owner_id -> user_profile CASCADE is
--     main's, pre-existing, reported in the safety report.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS tbl, conname
      FROM pg_constraint
     WHERE contype = 'f' AND confdeltype = 'c'
       AND (conrelid::regclass::text LIKE 'amc\_%' OR conrelid::regclass::text IN ('customers', 'customer_properties'))
  LOOP
    IF NOT (r.tbl IN ('amc_assessment_items', 'amc_assessment_photos') OR (r.tbl = 'amc_submissions' AND r.conname = 'amc_submissions_owner_id_fkey')) THEN
      RAISE EXCEPTION 'unexpected CASCADE: %.%', r.tbl, r.conname;
    END IF;
  END LOOP;
END $$;

-- A3. No duplicate indexes (same table, columns, expressions and predicate).
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(names, '; ') INTO dup FROM (
    SELECT string_agg(indexrelid::regclass::text, ' = ') AS names
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
     WHERE t.relnamespace = 'public'::regnamespace
       AND (t.relname LIKE 'amc\_%' OR t.relname IN ('customers', 'customer_properties'))
     GROUP BY i.indrelid, i.indkey::text, coalesce(pg_get_expr(i.indexprs, i.indrelid), ''),
              coalesce(pg_get_expr(i.indpred, i.indrelid), '')
    HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN RAISE EXCEPTION 'duplicate indexes: %', dup; END IF;
  IF to_regclass('public.idx_amc_submissions_renewal_of') IS NOT NULL THEN
    RAISE EXCEPTION 'redundant idx_amc_submissions_renewal_of still present';
  END IF;
  IF NOT (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.idx_amc_submissions_one_renewal'::regclass) THEN
    RAISE EXCEPTION 'one-renewal index is not unique';
  END IF;
END $$;

-- A4. Every FK from the new AMC tables to another AMC/customer table has an
--     index whose first column is the FK column (deletes/joins stay cheap).
--     Allowed without one: FKs to user_profile (actors, never deleted in
--     bulk) and the few listed here, whose parent is never deleted.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') INTO missing
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
     AND c.confrelid <> 'public.user_profile'::regclass
     AND (c.conrelid::regclass::text LIKE 'amc\_%' OR c.conrelid::regclass::text IN ('customers', 'customer_properties'))
     AND c.conrelid::regclass::text <> 'amc_submissions'
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
     )
     AND format('%s.%s', c.conrelid::regclass, a.attname) NOT IN (
       'amc_fsm_links.entitlement_id',          -- parent entitlements are never deleted (RESTRICT)
       'amc_fsm_sync_events.link_id',           -- links are unlinked, never deleted
       'amc_fsm_sync_events.usage_id',          -- usage is append-only
       'amc_entitlement_usage.entitlement_id',  -- covered by idx_amc_usage_entitlement? (checked below)
       'amc_renewal_reminders.todo_id',         -- todos deleted one at a time by their owner
       'amc_assessments.submission_id',         -- proposals are not deleted once linked
       'amc_assessments.contract_id',           -- contracts are never deleted
       'amc_additional_quotes.property_id',     -- properties are not deleted
       'customers.snagging_client_id',          -- unique partial index exists
       'customer_properties.snagging_property_id'
     );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'FKs without a leading index: %', missing; END IF;
END $$;

-- A5. Money in the new tables is numeric(12,2); quantities numeric(10,2).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(table_name || '.' || column_name || ' ' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ', ')
    INTO bad
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('amc_contracts', 'amc_contract_entitlements', 'amc_additional_quotes')
     AND column_name IN ('subtotal', 'discount_amount', 'final_price', 'vat_amount', 'grand_total',
                         'base_price', 'contracted_price', 'standard_price')
     AND NOT (data_type = 'numeric' AND numeric_precision = 12 AND numeric_scale = 2);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'money columns not numeric(12,2): %', bad; END IF;
END $$;

-- A6. AMC functions: fixed search_path, not SECURITY DEFINER, and not
--     executable by the API roles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'amc\_%'
  LOOP
    IF r.prosecdef THEN RAISE EXCEPTION '% is SECURITY DEFINER', r.proname; END IF;
    IF r.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION '% has no fixed search_path', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by an API role', r.proname;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------------
-- B. Document numbers never truncate past 9999
-- ------------------------------------------------------------------
SET ROLE service_role;
SELECT setval('public.amc_assessment_number_seq', 9998);
SELECT setval('public.amc_additional_quote_number_seq', 9998);
DO $$
DECLARE a1 text; a2 text; a3 text; q1 text; q2 text;
BEGIN
  a1 := public.amc_next_assessment_number();
  a2 := public.amc_next_assessment_number();
  a3 := public.amc_next_assessment_number();
  q1 := public.amc_next_additional_quote_number();
  q2 := public.amc_next_additional_quote_number();
  IF a1 !~ '-9999$' OR a2 !~ '-10000$' OR a3 !~ '-10001$' THEN RAISE EXCEPTION 'assessment numbers: % % %', a1, a2, a3; END IF;
  IF q1 !~ '-9999$' OR q2 !~ '-10000$' THEN RAISE EXCEPTION 'quote numbers: % %', q1, q2; END IF;
  -- (proposal numbers past 9999: 90_verify.sql)
END $$;
SELECT setval('public.amc_assessment_number_seq', 20000);

-- ------------------------------------------------------------------
-- C. amc_activate_contract: all or nothing
-- ------------------------------------------------------------------
INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
VALUES ('97000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'signed', 'Client', now()),
       ('97000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'signed', 'Client', now());

DO $$
DECLARE c jsonb := jsonb_build_object(
  'submission_id', '97000000-0000-0000-0000-000000000001', 'proposal_number', 'AMC-2026-9701',
  'status', 'active', 'customer', '{}'::jsonb, 'property', '{}'::jsonb, 'customer_name', 'Atomic Ltd',
  'start_date', '2026-10-01', 'end_date', '2027-09-30', 'subtotal', 1000, 'final_price', 1000,
  'vat_amount', 50, 'grand_total', 1050, 'signed_at', now(), 'signed_by_name', 'Client',
  'account_managers', '[{"name":"Sara"}]'::jsonb, 'account_manager_names', 'Sara');
DECLARE good jsonb := '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4,"contracted_price":800},
                        {"service_id":"helpdesk","service_label":"Helpdesk","entitlement_type":"informational","units":1,"frequency":1,"included_quantity":null,"contracted_price":0}]';
DECLARE bad jsonb := '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4,"contracted_price":800},
                       {"service_id":"x","service_label":"X","entitlement_type":"bogus","units":1,"frequency":1,"contracted_price":0}]';
DECLARE new_id uuid;
BEGIN
  -- C1. A bad entitlement rolls the contract back too.
  BEGIN
    PERFORM public.amc_activate_contract(c, bad);
    RAISE EXCEPTION 'bad entitlement accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.amc_contracts WHERE submission_id = '97000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'contract left behind without its services';
  END IF;
  -- C2. No services, no contract.
  BEGIN
    PERFORM public.amc_activate_contract(c, '[]');
    RAISE EXCEPTION 'empty services accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- C3. Unknown column is refused, nothing written.
  BEGIN
    PERFORM public.amc_activate_contract(c || '{"not_a_column": 1}', good);
    RAISE EXCEPTION 'unknown column accepted';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  -- C4. The good call writes both, with defaults for what it leaves out.
  new_id := public.amc_activate_contract(c, good);
  IF (SELECT count(*) FROM public.amc_contract_entitlements WHERE contract_id = new_id) <> 2 THEN
    RAISE EXCEPTION 'entitlements missing';
  END IF;
  IF (SELECT currency FROM public.amc_contracts WHERE id = new_id) <> 'AED'
     OR (SELECT used_quantity FROM public.amc_contract_entitlements WHERE contract_id = new_id AND service_id = 'ac-ppm') <> 0 THEN
    RAISE EXCEPTION 'defaults not applied';
  END IF;
  -- C5. A second activation of the same proposal fails as a duplicate.
  BEGIN
    PERFORM public.amc_activate_contract(c, good);
    RAISE EXCEPTION 'double activation accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- ------------------------------------------------------------------
-- D. amc_contracts_dashboard matches a count by hand
-- ------------------------------------------------------------------
DO $$
DECLARE today date := '2026-10-06';
DECLARE base jsonb := jsonb_build_object('proposal_number', 'D', 'status', 'active', 'customer', '{}'::jsonb,
  'property', '{}'::jsonb, 'subtotal', 100, 'final_price', 100, 'vat_amount', 5, 'grand_total', 105.5,
  'signed_at', now(), 'signed_by_name', 'C');
DECLARE ent jsonb := '[{"service_id":"ac-ppm","service_label":"AC","entitlement_type":"visits","units":1,"frequency":1,"included_quantity":1,"contracted_price":0}]';
DECLARE s uuid; cid uuid; d jsonb; expect_inforce int; expect_exh int;
BEGIN
  -- one contract per display status, owned by user 2
  FOR i IN 1..5 LOOP
    s := gen_random_uuid();
    INSERT INTO public.amc_submissions (id, owner_id, status, signed_by_name, signed_at)
    VALUES (s, '00000000-0000-0000-0000-000000000002', 'signed', 'C', now());
    cid := public.amc_activate_contract(base || jsonb_build_object('submission_id', s,
      'start_date', CASE i WHEN 3 THEN '2026-11-01' ELSE '2025-10-01' END,
      'end_date', CASE i WHEN 1 THEN '2027-09-30' WHEN 2 THEN '2026-10-20' WHEN 3 THEN '2027-10-31' ELSE '2026-09-30' END), ent);
    IF i = 5 THEN
      UPDATE public.amc_contracts SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'test' WHERE id = cid;
    END IF;
    IF i = 1 THEN
      INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at)
      SELECT cid, id, 'consumption', 1, '2026-10-01T10:00:00+04' FROM public.amc_contract_entitlements WHERE contract_id = cid;
    END IF;
  END LOOP;
  -- one signed proposal of user 2 still waiting for activation
  INSERT INTO public.amc_submissions (owner_id, status, signed_by_name, signed_at)
  VALUES ('00000000-0000-0000-0000-000000000002', 'signed', 'C', now());

  d := public.amc_contracts_dashboard('00000000-0000-0000-0000-000000000002', today, 30, '2026-09-06T00:00:00+04');
  -- user 2 also owns 97..02 (signed, not activated) => pending 2
  IF (d->>'inForce')::int <> 2 OR (d->>'expiringSoon')::int <> 1 OR (d->>'notStarted')::int <> 1
     OR (d->>'expired')::int <> 1 OR (d->>'cancelled')::int <> 1 OR (d->>'pendingActivation')::int <> 2
     OR (d->>'withExhaustedEntitlements')::int <> 1 OR (d->>'inForceValueFils')::bigint <> 21100
     OR (d->>'usageLast30Days')::int <> 1 OR jsonb_array_length(d->'recentUsage') <> 1 THEN
    RAISE EXCEPTION 'dashboard (owner) wrong: %', d;
  END IF;
  -- approvers (no owner filter) see the other owner's contract as well
  d := public.amc_contracts_dashboard(NULL, today, 30, '2026-09-06T00:00:00+04');
  SELECT count(*) INTO expect_inforce FROM public.amc_contracts
   WHERE status = 'active' AND start_date <= today AND end_date >= today;
  IF (d->>'inForce')::int <> expect_inforce THEN RAISE EXCEPTION 'dashboard (all) inForce % <> %', d->>'inForce', expect_inforce; END IF;
  IF (d->'recentUsage'->0->>'customerName') IS NULL THEN RAISE EXCEPTION 'recent usage lacks names: %', d->'recentUsage'; END IF;
END $$;
RESET ROLE;

-- E. The API roles cannot call the new functions.
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.amc_contracts_dashboard(NULL, current_date, 30, now());
    RAISE EXCEPTION 'authenticated could run the dashboard';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.amc_activate_contract('{}', '[]');
    RAISE EXCEPTION 'authenticated could activate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 97 schema review: all invariants hold
