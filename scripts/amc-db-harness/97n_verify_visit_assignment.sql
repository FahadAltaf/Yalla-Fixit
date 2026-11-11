\set ON_ERROR_STOP on
-- Phase 9 (20261008120000): technician skills, board placement, confirmation, access.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  v uuid;
  a uuid;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amc_technician_profiles', 'amc_technician_skills', 'amc_visit_attempts'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION '% is granted to a browser role', t;
    END IF;
  END LOOP;

  -- Skills and profile hang off the FSM roster; one row per trade; known levels.
  INSERT INTO public.technician_reference (fsm_resource_id, display_name, shift) VALUES ('T-97N-1', 'Ravi', 'morning');
  INSERT INTO public.amc_technician_profiles (fsm_resource_id, areas, has_vehicle, access_permissions)
  VALUES ('T-97N-1', ARRAY['Arabian Ranches'], true, ARRAY['Emaar security']);
  INSERT INTO public.amc_technician_skills (fsm_resource_id, trade, level, certificate_expires) VALUES ('T-97N-1', 'ac', 'expert', current_date + 365);
  BEGIN
    INSERT INTO public.amc_technician_skills (fsm_resource_id, trade, level) VALUES ('T-97N-1', 'ac', 'trainee');
    RAISE EXCEPTION 'two rows for one trade';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_technician_skills (fsm_resource_id, trade, level) VALUES ('T-97N-1', 'plumbing', 'guru');
    RAISE EXCEPTION 'an unknown level';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_technician_skills (fsm_resource_id, trade) VALUES ('NOBODY', 'ac');
    RAISE EXCEPTION 'a skill for someone not on the roster';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- The roster sync deletes a technician only when nothing points at them; with AMC skills it deactivates instead.
  BEGIN
    DELETE FROM public.technician_reference WHERE fsm_resource_id = 'T-97N-1';
    RAISE EXCEPTION 'a technician with AMC skills was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- A visit on the board: a slot both ends or neither, end after start.
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 12","unitType":"villa"}', '{"customerName":"BOARD"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-BOARD', 'status', 'draft',
      'customer', '{"customerName":"BOARD"}'::jsonb, 'property', '{"propertyAddress":"Villa 12"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 3000, 'final_price', 3000, 'vat_amount', 150, 'grand_total', 3150, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4}]'::jsonb);
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
  VALUES (c, 1, current_date, current_date + 90, current_date, current_date + 14, current_date + 2) RETURNING id INTO v;
  BEGIN
    UPDATE public.amc_visits SET scheduled_start = now() WHERE id = v;
    RAISE EXCEPTION 'a slot with a start and no end';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visits SET scheduled_start = now(), scheduled_end = now() - interval '1 hour' WHERE id = v;
    RAISE EXCEPTION 'a slot ending before it starts';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visits
     SET scheduled_start = now(), scheduled_end = now() + interval '2 hours', technician_ids = ARRAY['T-97N-1'], lead_technician_id = 'T-97N-1', headcount = 1
   WHERE id = v;
  IF NOT EXISTS (SELECT 1 FROM public.amc_visits WHERE technician_ids && ARRAY['T-97N-1'] AND id = v) THEN
    RAISE EXCEPTION 'the crew lookup did not find the visit';
  END IF;

  -- Confirmation: "confirmed" says when; known values only. Access: known statuses only.
  BEGIN
    UPDATE public.amc_visits SET client_confirmation = 'confirmed' WHERE id = v;
    RAISE EXCEPTION 'confirmed without a time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visits SET client_confirmation = 'confirmed', confirmed_at = now(), confirmation_channel = 'whatsapp' WHERE id = v;
  BEGIN
    UPDATE public.amc_visits SET access_status = 'maybe' WHERE id = v;
    RAISE EXCEPTION 'an unknown access status';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_visits SET access_status = 'approved', access_valid_until = current_date + 30 WHERE id = v;

  -- Attempts: numbered once per visit, known channels and outcomes, kept as written.
  INSERT INTO public.amc_visit_attempts (visit_id, attempt_no, channel, outcome) VALUES (v, 1, 'whatsapp', 'message_sent') RETURNING id INTO a;
  BEGIN
    INSERT INTO public.amc_visit_attempts (visit_id, attempt_no, channel, outcome) VALUES (v, 1, 'call', 'no_answer');
    RAISE EXCEPTION 'two attempts with one number';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_visit_attempts (visit_id, attempt_no, channel, outcome) VALUES (v, 2, 'pigeon', 'no_answer');
    RAISE EXCEPTION 'an unknown channel';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_visit_attempts SET outcome = 'confirmed' WHERE id = a;
    RAISE EXCEPTION 'an attempt was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The send log takes the appointment messages.
  INSERT INTO public.amc_send_log (submission_id, version_no, document, channel, recipients, outcome)
  VALUES (s, 1, 'visit_confirmation', 'whatsapp', '[]', 'prepared'), (s, 1, 'visit_reminder', 'email', '[]', 'no_recipient');
END $$;
\echo 97n visit assignment: all checks pass
