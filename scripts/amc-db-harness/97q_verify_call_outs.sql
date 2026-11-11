\set ON_ERROR_STOP on
-- Phase 11 (20261012120000): allowance reservations, call outs, additional works, photos, page permissions.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  e uuid;
  co uuid;
  co2 uuid;
  res uuid;
  res2 uuid;
  used_q numeric;
  held_q numeric;
  aw uuid;
  t text;
  num text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_call_outs', 'amc_additional_works', 'amc_work_photos'] LOOP
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
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 9","unitType":"villa"}', '{"customerName":"CALLOUT"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-CALLOUT', 'status', 'draft',
      'customer', '{"customerName":"CALLOUT"}'::jsonb, 'property', '{"propertyAddress":"Villa 9"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 3000, 'final_price', 3000, 'vat_amount', 150, 'grand_total', 3150, 'template', 'residential'),
    '[{"service_id":"non-emergency","service_label":"Non-emergency call out","entitlement_type":"visits","call_out_class":"non_emergency","units":1,"frequency":2,"included_quantity":2}]'::jsonb);
  UPDATE public.amc_contracts SET status = 'active', signed_at = now(), signed_by_name = 'Sara' WHERE id = c;
  SELECT id INTO e FROM public.amc_contract_entitlements WHERE contract_id = c LIMIT 1;

  -- Numbers come from the database: CO-<year>-0001.
  INSERT INTO public.amc_call_outs (contract_id, entitlement_id, priority, channel, reported_at, issue, coverage)
  VALUES (c, e, 'non_emergency', 'call', now() - interval '10 minutes', 'Kitchen tap leaking', 'covered') RETURNING id, call_out_no INTO co, num;
  IF num !~ '^CO-\d{4}-\d{4,}$' THEN RAISE EXCEPTION 'call out number %', num; END IF;

  -- Booking reserves a unit: reserved goes up, used does not.
  INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, call_out_id)
  VALUES (c, e, 'reserve', 1, now(), 'system', co) RETURNING id INTO res;
  SELECT used_quantity, reserved_quantity INTO used_q, held_q FROM public.amc_contract_entitlements WHERE id = e;
  IF used_q <> 0 OR held_q <> 1 THEN RAISE EXCEPTION 'after reserve: used % reserved %', used_q, held_q; END IF;

  -- A second booking takes the last unit; a third is refused (used + reserved <= included).
  INSERT INTO public.amc_call_outs (contract_id, entitlement_id, priority, channel, reported_at, issue, coverage)
  VALUES (c, e, 'non_emergency', 'email', now(), 'AC noisy', 'covered') RETURNING id INTO co2;
  INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, call_out_id)
  VALUES (c, e, 'reserve', 1, now(), 'system', co2) RETURNING id INTO res2;
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source)
    VALUES (c, e, 'reserve', 1, now(), 'system');
    RAISE EXCEPTION 'a third unit was reserved on an allowance of two';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Completion consumes the reservation: used +1, reserved -1, in one write.
  INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, call_out_id, reservation_id)
  VALUES (c, e, 'consumption', 1, now(), 'system', co, res);
  SELECT used_quantity, reserved_quantity INTO used_q, held_q FROM public.amc_contract_entitlements WHERE id = e;
  IF used_q <> 1 OR held_q <> 1 THEN RAISE EXCEPTION 'after consume: used % reserved %', used_q, held_q; END IF;
  -- A reservation is settled once.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, reservation_id)
    VALUES (c, e, 'release', 1, now(), 'system', res);
    RAISE EXCEPTION 'a consumed reservation was released too';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Cancelling releases: reserved back to 0, whatever quantity the caller sent.
  INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, call_out_id, reservation_id, notes)
  VALUES (c, e, 'release', 5, now(), 'system', co2, res2, 'Cancelled');
  SELECT used_quantity, reserved_quantity INTO used_q, held_q FROM public.amc_contract_entitlements WHERE id = e;
  IF used_q <> 1 OR held_q <> 0 THEN RAISE EXCEPTION 'after release: used % reserved %', used_q, held_q; END IF;
  -- A release names a reservation; a reservation cannot point at another.
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source)
    VALUES (c, e, 'release', 1, now(), 'system');
    RAISE EXCEPTION 'a release without its reservation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_entitlement_usage (contract_id, entitlement_id, kind, quantity, occurred_at, source, reservation_id)
    VALUES (c, e, 'consumption', 1, now(), 'system', (SELECT id FROM public.amc_entitlement_usage WHERE kind = 'consumption' AND entitlement_id = e LIMIT 1));
    RAISE EXCEPTION 'a consumption settled something that is not a reservation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- The ledger stays append-only.
  BEGIN
    UPDATE public.amc_entitlement_usage SET quantity = 2 WHERE id = res;
    RAISE EXCEPTION 'a reservation was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Call out rules: a cancellation says why; attended needs a time after the call; misuse is explained.
  BEGIN
    UPDATE public.amc_call_outs SET status = 'cancelled' WHERE id = co2;
    RAISE EXCEPTION 'cancelled without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_call_outs SET status = 'cancelled', status_reason = 'Client fixed it' WHERE id = co2;
  BEGIN
    UPDATE public.amc_call_outs SET status = 'attended' WHERE id = co;
    RAISE EXCEPTION 'attended without a time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_call_outs SET status = 'attended', attended_at = now() - interval '1 day' WHERE id = co;
    RAISE EXCEPTION 'attended before the call';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_call_outs SET status = 'attended', attended_at = now() WHERE id = co;
  BEGIN
    UPDATE public.amc_call_outs SET misuse_flag = true WHERE id = co;
    RAISE EXCEPTION 'misuse without a note';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_call_outs SET priority = 'urgent' WHERE id = co;
    RAISE EXCEPTION 'an unknown priority';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Additional work: linked to its source; nine statuses; approval needs evidence; invoiced needs a number.
  INSERT INTO public.amc_additional_works (contract_id, source, call_out_id, finding, risk)
  VALUES (c, 'call_out', co, 'Corroded valve under the sink', 'medium') RETURNING id, work_no INTO aw, num;
  IF num !~ '^AW-\d{4}-\d{4,}$' THEN RAISE EXCEPTION 'additional work number %', num; END IF;
  BEGIN
    INSERT INTO public.amc_additional_works (contract_id, source, finding) VALUES (c, 'visit', 'No visit named');
    RAISE EXCEPTION 'a visit source without its visit';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_additional_works SET status = 'quotation_prepared' WHERE id = aw;
    RAISE EXCEPTION 'a quotation without lines';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_additional_works
     SET status = 'shared', quotation_lines = '[{"description":"Valve","kind":"material","quantity":1,"unitPrice":85.5}]', total = 107.73
   WHERE id = aw;
  BEGIN
    UPDATE public.amc_additional_works SET status = 'approved', approved_at = now() WHERE id = aw;
    RAISE EXCEPTION 'approved without evidence';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_additional_works SET status = 'approved', approved_at = now(), approval_evidence = 'Email from the owner' WHERE id = aw;
  UPDATE public.amc_additional_works SET status = 'completed', completed_at = now() WHERE id = aw;
  BEGIN
    UPDATE public.amc_additional_works SET status = 'invoiced' WHERE id = aw;
    RAISE EXCEPTION 'invoiced without a number';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_additional_works SET status = 'invoiced', invoice_number = 'INV-1', invoiced_at = now() WHERE id = aw;
  BEGIN
    UPDATE public.amc_additional_works SET status = 'paid' WHERE id = aw;
    RAISE EXCEPTION 'paid without a date';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_additional_works SET status = 'rejected' WHERE id = aw;
    RAISE EXCEPTION 'rejected without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Photos belong to exactly one record.
  INSERT INTO public.amc_work_photos (call_out_id, kind, storage_path, content_type, byte_size, file_sha256)
  VALUES (co, 'reported', 'call-outs/97q/a.jpg', 'image/jpeg', 10, repeat('a', 64));
  BEGIN
    INSERT INTO public.amc_work_photos (call_out_id, additional_work_id, kind, storage_path, content_type, byte_size, file_sha256)
    VALUES (co, aw, 'finding', 'call-outs/97q/b.jpg', 'image/jpeg', 10, repeat('a', 64));
    RAISE EXCEPTION 'a photo on two records';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A call out with history is kept.
  BEGIN
    DELETE FROM public.amc_call_outs WHERE id = co;
    RAISE EXCEPTION 'a call out with additional work and usage was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
  VALUES (s, 1, 'call_out_acknowledgement', 'whatsapp', '[]', 'prepared'), (s, 1, 'additional_work_quotation', 'email', '[]', 'no_recipient');
END $$;

-- The page permissions: roles that can use AMC get View; Visits create/edit carry over; additive; twice is safe.
INSERT INTO public.roles (id, name) VALUES
  ('97100000-0000-0000-0000-0000000000b1', 'p97q coordinator'),
  ('97100000-0000-0000-0000-0000000000b2', 'p97q snagging only');
INSERT INTO public.role_access (role_id, resource, action, enabled) VALUES
  ('97100000-0000-0000-0000-0000000000b1', 'amc_visits', 'view', true),
  ('97100000-0000-0000-0000-0000000000b1', 'amc_visits', 'edit', true),
  ('97100000-0000-0000-0000-0000000000b2', 'snagging', 'view', true);
\ir ../../supabase/migrations/20261012120000_amc_call_outs_additional_work_allowances.sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.role_access WHERE role_id = '97100000-0000-0000-0000-0000000000b1'
     AND resource IN ('amc_call_outs', 'amc_additional_works') AND action IN ('view', 'edit');
  IF n <> 4 THEN RAISE EXCEPTION 'the coordinator got % of 4 grants', n; END IF;
  SELECT count(*) INTO n FROM public.role_access WHERE role_id = '97100000-0000-0000-0000-0000000000b1'
     AND resource IN ('amc_call_outs', 'amc_additional_works') AND action = 'create';
  IF n <> 0 THEN RAISE EXCEPTION 'create was given without Visits create'; END IF;
  SELECT count(*) INTO n FROM public.role_access WHERE role_id = '97100000-0000-0000-0000-0000000000b2' AND resource LIKE 'amc\_%';
  IF n <> 0 THEN RAISE EXCEPTION 'a role without AMC got AMC pages'; END IF;
END $$;
\echo 97q call outs, additional works, allowances: all checks pass
