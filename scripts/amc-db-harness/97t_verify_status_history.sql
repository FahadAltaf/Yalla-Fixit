\set ON_ERROR_STOP on
-- Phase 14 (20261013100000): visits, job sheets, instalments and cheques write their status history.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  s uuid;
  c uuid;
  v uuid;
  js uuid;
  n int;
  p jsonb;
BEGIN
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 8","unitType":"villa"}', '{"customerName":"HISTORY"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-HISTORY', 'status', 'draft',
      'customer', '{"customerName":"HISTORY"}'::jsonb, 'property', '{"propertyAddress":"Villa 8"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 3000, 'final_price', 3000, 'vat_amount', 150, 'grand_total', 3150, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4}]'::jsonb);

  -- A visit: each status change is one history row, from and to; an unrelated update writes none.
  INSERT INTO public.amc_visits (contract_id, visit_no, cycle_start, cycle_end, window_start, window_end, target_date)
  VALUES (c, 1, current_date, current_date + 90, current_date, current_date + 14, current_date + 2) RETURNING id INTO v;
  UPDATE public.amc_visits SET status = 'scheduled' WHERE id = v;
  UPDATE public.amc_visits SET target_date = current_date + 3 WHERE id = v;
  UPDATE public.amc_visits SET status = 'in_progress' WHERE id = v;
  SELECT count(*) INTO n FROM public.amc_audit_events WHERE entity_type = 'visit' AND entity_id = v AND event_type = 'status_changed';
  IF n <> 2 THEN RAISE EXCEPTION 'visit history has % rows, expected 2', n; END IF;
  SELECT payload INTO p FROM public.amc_audit_events WHERE entity_type = 'visit' AND entity_id = v ORDER BY id DESC LIMIT 1;
  IF p->>'from' <> 'scheduled' OR p->>'to' <> 'in_progress' THEN RAISE EXCEPTION 'visit history payload %', p; END IF;

  -- The person who closed it is the actor.
  UPDATE public.amc_visits SET status = 'completed', closed_at = now(), closed_by = owner_id WHERE id = v;
  IF NOT EXISTS (SELECT 1 FROM public.amc_audit_events WHERE entity_type = 'visit' AND entity_id = v AND actor_id = owner_id AND origin = 'portal' AND payload->>'to' = 'completed') THEN
    RAISE EXCEPTION 'the closing supervisor is not the actor';
  END IF;

  -- A job sheet: submitted by, then reviewed by.
  INSERT INTO public.amc_visit_job_sheets (visit_id, contract_id) VALUES (v, c) RETURNING id INTO js;
  UPDATE public.amc_visit_job_sheets
     SET status = 'submitted', submitted_at = now(), submitted_by = owner_id, arrived_at = now() - interval '1 hour', completed_at = now()
   WHERE id = js;
  IF NOT EXISTS (SELECT 1 FROM public.amc_audit_events WHERE entity_type = 'job_sheet' AND entity_id = js AND actor_id = owner_id AND payload->>'to' = 'submitted') THEN
    RAISE EXCEPTION 'the job sheet submission is not in the history';
  END IF;
  UPDATE public.amc_visit_job_sheets SET status = 'returned', review_comment = 'Add the after photo' WHERE id = js;
  IF NOT EXISTS (SELECT 1 FROM public.amc_audit_events WHERE entity_type = 'job_sheet' AND entity_id = js AND payload->>'to' = 'returned' AND justification = 'Add the after photo') THEN
    RAISE EXCEPTION 'the return comment is not the reason';
  END IF;
END $$;
\echo 97t status history: all checks pass
