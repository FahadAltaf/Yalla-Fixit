\set ON_ERROR_STOP on
-- Phase 10 (20261012110000): job sheet, checklist, photos, line outcomes, closure, remainder, report clock.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  e uuid;
  v uuid;
  v2 uuid;
  l uuid;
  l2 uuid;
  js uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_visit_job_sheets', 'amc_visit_checklist_items', 'amc_visit_photos'] LOOP
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
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 7","unitType":"villa"}', '{"customerName":"SHEET"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-SHEET', 'status', 'draft',
      'customer', '{"customerName":"SHEET"}'::jsonb, 'property', '{"propertyAddress":"Villa 7"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 3000, 'final_price', 3000, 'vat_amount', 150, 'grand_total', 3150, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4}]'::jsonb);
  SELECT id INTO e FROM public.amc_contract_entitlements WHERE contract_id = c LIMIT 1;
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
  VALUES (c, 1, current_date, current_date + 90, current_date, current_date + 14, current_date + 2) RETURNING id INTO v;
  INSERT INTO public.amc_visit_lines (visit_id, contract_id, entitlement_id, service_id, service_label, occurrence,
    home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date)
  VALUES (v, c, e, 'ac-ppm', 'AC PPM', 1, current_date, current_date + 90, current_date, current_date + 14, current_date + 2) RETURNING id INTO l;

  -- A trade not done carries one of the five groups.
  BEGIN
    UPDATE public.amc_visit_lines SET status = 'not_completed' WHERE id = l;
    RAISE EXCEPTION 'not completed without a reason group';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_lines SET status = 'not_completed', outcome_group = 'weather' WHERE id = l;
    RAISE EXCEPTION 'an unknown reason group';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visit_lines SET status = 'not_completed', outcome_group = 'client', outcome_reason = 'Not reachable' WHERE id = l;

  -- One job sheet per visit; submitted means times are recorded; a return says why; closed means reviewed.
  INSERT INTO public.amc_visit_job_sheets (visit_id, contract_id) VALUES (v, c) RETURNING id INTO js;
  BEGIN
    INSERT INTO public.amc_visit_job_sheets (visit_id, contract_id) VALUES (v, c);
    RAISE EXCEPTION 'two job sheets for one visit';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_job_sheets SET status = 'submitted', submitted_at = now() WHERE id = js;
    RAISE EXCEPTION 'submitted without arrival and completion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_job_sheets SET arrived_at = now(), completed_at = now() - interval '1 hour' WHERE id = js;
    RAISE EXCEPTION 'completed before arrival';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_job_sheets SET consumables = '{"item":"gas"}' WHERE id = js;
    RAISE EXCEPTION 'consumables not a list';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visit_job_sheets
     SET status = 'submitted', submitted_at = now(), arrived_at = now() - interval '2 hours', completed_at = now(),
         review_required = true, review_reasons = ARRAY['incomplete_scope']
   WHERE id = js;
  BEGIN
    UPDATE public.amc_visit_job_sheets SET status = 'returned' WHERE id = js;
    RAISE EXCEPTION 'returned without a comment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_job_sheets SET status = 'closed' WHERE id = js;
    RAISE EXCEPTION 'closed without a review';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visit_job_sheets SET status = 'closed', reviewed_at = now() WHERE id = js;

  -- Checklist and photos: known results and kinds; a photo path is stored once.
  INSERT INTO public.amc_visit_checklist_items (job_sheet_id, visit_line_id, label, result) VALUES (js, l, 'Filters cleaned', 'ok');
  BEGIN
    INSERT INTO public.amc_visit_checklist_items (job_sheet_id, label, result) VALUES (js, 'Drain', 'meh');
    RAISE EXCEPTION 'an unknown checklist result';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_visit_photos (job_sheet_id, visit_id, kind, storage_path, content_type, byte_size, file_sha256)
  VALUES (js, v, 'before', 'visits/97p/a.jpg', 'image/jpeg', 100, repeat('a', 64));
  BEGIN
    INSERT INTO public.amc_visit_photos (job_sheet_id, visit_id, kind, storage_path, content_type, byte_size, file_sha256)
    VALUES (js, v, 'after', 'visits/97p/a.jpg', 'image/jpeg', 100, repeat('a', 64));
    RAISE EXCEPTION 'one storage path twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_visit_photos (job_sheet_id, visit_id, kind, storage_path, content_type, byte_size, file_sha256)
    VALUES (js, v, 'selfie', 'visits/97p/b.jpg', 'image/jpeg', 100, repeat('a', 64));
    RAISE EXCEPTION 'an unknown photo kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The remaining trade: a remainder visit, its line a retry of the same occurrence.
  UPDATE public.amc_visits SET status = 'not_completed', closed_at = now(), report_due_at = now() + interval '48 hours' WHERE id = v;
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date, source, remainder_of_visit_id)
  VALUES (c, 2, current_date + 1, current_date + 14, current_date + 1, current_date + 14, current_date + 3, 'remainder', v) RETURNING id INTO v2;
  INSERT INTO public.amc_visit_lines (visit_id, contract_id, entitlement_id, service_id, service_label, occurrence, retry_of_line_id,
    home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date)
  VALUES (v2, c, e, 'ac-ppm', 'AC PPM', 1, l, current_date + 1, current_date + 14, current_date + 1, current_date + 14, current_date + 3) RETURNING id INTO l2;
  BEGIN
    INSERT INTO public.amc_visit_lines (visit_id, contract_id, entitlement_id, service_id, service_label, occurrence,
      home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date)
    VALUES (v2, c, e, 'ac-ppm', 'AC PPM', 1, current_date, current_date + 90, current_date, current_date + 14, current_date + 2);
    RAISE EXCEPTION 'an occurrence planned twice (not as a retry)';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visits SET source = 'magic' WHERE id = v2;
    RAISE EXCEPTION 'an unknown visit source';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A job sheet with photos is kept: the visit cannot be deleted from under it.
  BEGIN
    DELETE FROM public.amc_visits WHERE id = v;
    RAISE EXCEPTION 'a visit with a job sheet was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- The send log takes the service report.
  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
  VALUES (s, 1, 'service_report', 'email', '[]', 'no_recipient');
END $$;
\echo 97p job sheets: all checks pass
