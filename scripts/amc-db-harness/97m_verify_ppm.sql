\set ON_ERROR_STOP on
-- Phase 8 (20261008110000): the PPM schedule -- visits, lines, history.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  e uuid;
  v1 uuid;
  v2 uuid;
  l uuid;
  ch uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_visits', 'amc_visit_lines', 'amc_visit_changes'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 11","unitType":"villa"}', '{"customerName":"PPM"}',
    '{}', '[]', 0, 0, 6000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-PPM', 'status', 'draft',
      'customer', '{"customerName":"PPM"}'::jsonb, 'property', '{"propertyAddress":"Villa 11"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 6000, 'final_price', 6000, 'vat_amount', 300, 'grand_total', 6300, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":6,"included_quantity":6}]'::jsonb);
  SELECT id INTO e FROM public.amc_contract_entitlements WHERE contract_id = c LIMIT 1;

  -- Visits: numbered once per contract; windows in order; a removal says why.
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
  VALUES (c, 1, current_date, current_date + 59, current_date, current_date + 14, current_date + 1) RETURNING id INTO v1;
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
  VALUES (c, 2, current_date + 60, current_date + 119, current_date + 60, current_date + 74, current_date + 61) RETURNING id INTO v2;
  BEGIN
    INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
    VALUES (c, 2, current_date, current_date, current_date, current_date, current_date);
    RAISE EXCEPTION 'two visits with one number';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visits SET window_end = window_start - 1 WHERE id = v1;
    RAISE EXCEPTION 'a window ending before it starts';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visits SET status = 'cancelled' WHERE id = v2;
    RAISE EXCEPTION 'a removal without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visits SET status = 'done' WHERE id = v2;
    RAISE EXCEPTION 'an unknown visit status';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Lines: one occurrence of a service line once; a line keeps its home window.
  INSERT INTO public.amc_visit_lines (visit_id, contract_id, entitlement_id, service_id, service_label, occurrence,
    home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date)
  VALUES (v1, c, e, 'ac-ppm', 'AC PPM', 1, current_date, current_date + 59, current_date, current_date + 14, current_date + 1)
  RETURNING id INTO l;
  BEGIN
    INSERT INTO public.amc_visit_lines (visit_id, contract_id, entitlement_id, service_id, service_label, occurrence,
      home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date)
    VALUES (v2, c, e, 'ac-ppm', 'AC PPM', 1, current_date, current_date, current_date, current_date, current_date);
    RAISE EXCEPTION 'the same occurrence twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_visits WHERE id = v1;
    RAISE EXCEPTION 'a visit with lines was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- History: a reschedule, an addition and a removal say why; rows are kept as written.
  BEGIN
    INSERT INTO public.amc_visit_changes (contract_id, visit_id, change_type, from_date, to_date)
    VALUES (c, v1, 'rescheduled', current_date + 1, current_date + 20);
    RAISE EXCEPTION 'a reschedule without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_visit_changes (contract_id, visit_id, change_type, from_date, to_date, reason)
  VALUES (c, v1, 'rescheduled', current_date + 1, current_date + 20, 'Client travelling') RETURNING id INTO ch;
  INSERT INTO public.amc_visit_changes (contract_id, change_type) VALUES (c, 'confirmed');
  BEGIN
    UPDATE public.amc_visit_changes SET reason = 'edited' WHERE id = ch;
    RAISE EXCEPTION 'history was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_visit_changes WHERE id = ch;
    RAISE EXCEPTION 'history was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The contract: the plan of record names when, and the rule's channels are known ones.
  BEGIN
    UPDATE public.amc_contracts SET ppm_confirmed_by = owner_id WHERE id = c;
    RAISE EXCEPTION 'confirmed by someone, but never';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contracts SET attempt_channels = ARRAY['pigeon'] WHERE id = c;
    RAISE EXCEPTION 'an unknown attempt channel';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts
     SET ppm_confirmed_at = now(), ppm_confirmed_by = owner_id, ppm_window_days = 10,
         attempt_count = 3, attempt_interval_days = 2, attempt_channels = ARRAY['whatsapp', 'call']
   WHERE id = c;

  -- An FSM appointment can name the visit it carries out.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'amc_fsm_links' AND column_name = 'visit_id') THEN
    RAISE EXCEPTION 'amc_fsm_links has no visit_id';
  END IF;
END $$;
\echo 97m PPM schedule: all checks pass
