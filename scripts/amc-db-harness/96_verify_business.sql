\set ON_ERROR_STOP on
SET ROLE service_role;

-- Shared customers: unique business ref (case-insensitive), FSM contact and Snagging bridge.
INSERT INTO public.snagging_clients (id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Client');
INSERT INTO public.customers (id, name, customer_ref, snagging_client_id)
VALUES ('c0000000-0000-0000-0000-000000000001', 'Client', 'YFI1806', 'aaaaaaaa-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.customers (name, customer_ref) VALUES ('Other', 'yfi1806 ');
    RAISE EXCEPTION 'duplicate customer ref was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.customers (name, snagging_client_id) VALUES ('Other', 'aaaaaaaa-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'one snagging client linked to two customers';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.customer_properties (label, unit_type) VALUES ('X', 'castle');
    RAISE EXCEPTION 'unknown unit type was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO public.customer_properties (id, customer_id, label, unit_type, property_category)
VALUES ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Villa 12', 'villa', 'residential');

-- Live link on a contract; the signed snapshot does not follow customer edits.
UPDATE public.amc_contracts
   SET customer_id = 'c0000000-0000-0000-0000-000000000001', property_id = 'd0000000-0000-0000-0000-000000000001',
       customer = '{"customerName":"As signed"}'
 WHERE id = '55555555-5555-5555-5555-555555555555';
UPDATE public.customers SET name = 'Renamed today', phone = '0500000000' WHERE id = 'c0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  IF (SELECT customer->>'customerName' FROM public.amc_contracts WHERE id = '55555555-5555-5555-5555-555555555555') <> 'As signed' THEN
    RAISE EXCEPTION 'the snapshot changed with the customer';
  END IF;
END $$;

-- Checklist seeded; assessments numbered; completed shape enforced.
DO $$ BEGIN IF (SELECT count(*) FROM public.amc_assessment_checklist) < 10 THEN RAISE EXCEPTION 'checklist not seeded'; END IF; END $$;
INSERT INTO public.amc_assessments (id, customer_id, property_id, recommended_service_ids)
VALUES ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '{ac-ppm}');
DO $$ BEGIN IF (SELECT assessment_number FROM public.amc_assessments WHERE id = 'e0000000-0000-0000-0000-000000000001') !~ '^ASM-\d{4}-\d{4,}$' THEN RAISE EXCEPTION 'bad assessment number'; END IF; END $$;
INSERT INTO public.amc_assessment_items (assessment_id, item_key, category_key, category_label, label, result)
VALUES ('e0000000-0000-0000-0000-000000000001', 'ac-cooling', 'air-conditioning', 'Air conditioning', 'Cooling', 'attention');
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_assessments SET status = 'completed' WHERE id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'completed without date was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_assessment_items (assessment_id, item_key, category_key, category_label, label, result)
    VALUES ('e0000000-0000-0000-0000-000000000001', 'x', 'x', 'X', 'X', 'broken');
    RAISE EXCEPTION 'unknown item result was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE public.amc_assessments SET status = 'completed', assessed_on = '2026-10-06', completed_at = now()
 WHERE id = 'e0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    UPDATE public.amc_assessment_items SET result = 'ok' WHERE assessment_id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a completed assessment item was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_assessments SET summary = 'rewritten' WHERE id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a completed assessment was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.amc_assessments WHERE id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'a completed assessment was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
-- Linking the proposal created from it is still allowed.
UPDATE public.amc_assessments SET submission_id = '44444444-4444-4444-4444-444444444444' WHERE id = 'e0000000-0000-0000-0000-000000000001';

-- Discount config: one row, off, needs a rate to be enabled.
DO $$
BEGIN
  IF (SELECT enabled FROM public.amc_additional_service_discount WHERE id = 1) THEN RAISE EXCEPTION 'discount on by default'; END IF;
  BEGIN
    UPDATE public.amc_additional_service_discount SET enabled = true WHERE id = 1;
    RAISE EXCEPTION 'enabled without a rate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_additional_service_discount (id) VALUES (2);
    RAISE EXCEPTION 'a second config row';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Additional quotes: figures add up, calculation frozen, estimate link required to mark linked.
INSERT INTO public.amc_additional_quotes (id, contract_id, service_key, service_label, requested_for, eligibility,
  standard_price, discount_percent, discount_amount, final_price)
VALUES ('f0000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'painting', 'Painting', '2026-10-06',
  'amc_discount_eligible', 1000, 20, 200, 800);
DO $$
BEGIN
  IF (SELECT quote_number FROM public.amc_additional_quotes WHERE id = 'f0000000-0000-0000-0000-000000000001') !~ '^AQ-\d{4}-\d{4,}$' THEN
    RAISE EXCEPTION 'bad quote number';
  END IF;
  BEGIN
    INSERT INTO public.amc_additional_quotes (contract_id, service_key, service_label, requested_for, eligibility,
      standard_price, discount_percent, discount_amount, final_price)
    VALUES ('55555555-5555-5555-5555-555555555555', 'x', 'X', '2026-10-06', 'amc_discount_eligible', 1000, 20, 200, 900);
    RAISE EXCEPTION 'figures that do not add up were allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_additional_quotes SET final_price = 700, discount_amount = 300 WHERE id = 'f0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'the calculation was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_additional_quotes SET status = 'estimate_linked' WHERE id = 'f0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'linked without an estimate number';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE public.amc_additional_quotes SET status = 'estimate_linked', fsm_estimate_number = 'EST-1001'
 WHERE id = 'f0000000-0000-0000-0000-000000000001';

-- Audit accepts the new entity types.
INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type) VALUES ('assessment', gen_random_uuid(), 'assessment_created');
INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type) VALUES ('customer', gen_random_uuid(), 'customer_linked');
INSERT INTO public.amc_audit_events (entity_type, entity_id, event_type) VALUES ('quote', gen_random_uuid(), 'additional_quote_created');
RESET ROLE;
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM public.customers; RAISE EXCEPTION 'authenticated reads customers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.amc_assessments; RAISE EXCEPTION 'authenticated reads assessments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.amc_additional_quotes; RAISE EXCEPTION 'authenticated reads quotes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'BUSINESS OPERATIONS CHECKS PASSED' AS result;
