\set ON_ERROR_STOP on
-- Phase 13 (20261012140000): renewal outcome, scheduled termination, amendments, the Renewals page permission.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  other_id uuid;
  s uuid;
  c uuid;
  a uuid;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.amc_contract_amendments'::regclass) THEN
    RAISE EXCEPTION 'amc_contract_amendments has RLS off';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'amc_contract_amendments' AND grantee IN ('anon', 'authenticated')) THEN
    RAISE EXCEPTION 'amc_contract_amendments is granted to a browser role';
  END IF;
  SELECT id INTO other_id FROM public.user_profile WHERE id <> owner_id LIMIT 1;
  IF other_id IS NULL THEN
    other_id := '00000000-0000-0000-0000-000000000097';
    INSERT INTO public.user_profile (id, email, full_name) VALUES (other_id, 'p97s@example.com', 'Approver 97s') ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 5","unitType":"villa"}', '{"customerName":"RENEW"}',
    '{}', '[]', 0, 0, 3000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-RENEW', 'status', 'draft',
      'customer', '{"customerName":"RENEW"}'::jsonb, 'property', '{"propertyAddress":"Villa 5"}'::jsonb,
      'start_date', current_date - 340, 'end_date', current_date + 25,
      'subtotal', 3000, 'final_price', 3000, 'vat_amount', 150, 'grand_total', 3150, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":4,"included_quantity":4}]'::jsonb);

  -- Renewal outcome: known values; Not renewed says why.
  BEGIN
    UPDATE public.amc_contracts SET renewal_outcome = 'maybe' WHERE id = c;
    RAISE EXCEPTION 'an unknown outcome';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contracts SET renewal_outcome = 'not_renewed' WHERE id = c;
    RAISE EXCEPTION 'not renewed without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts SET renewal_outcome = 'under_negotiation', renewal_reminded_at = now(), renewal_activity_at = now() WHERE id = c;

  -- A scheduled termination: effective on or after the notice; a refund is never negative.
  BEGIN
    UPDATE public.amc_contracts SET termination_notice_on = current_date, termination_effective_on = current_date - 1 WHERE id = c;
    RAISE EXCEPTION 'effective before the notice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contracts SET termination_refund = -1 WHERE id = c;
    RAISE EXCEPTION 'a negative refund';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts SET termination_notice_on = current_date, termination_effective_on = current_date + 30, termination_refund = 0 WHERE id = c;

  -- Amendments: known kinds; a reason; decided needs who and when; nobody decides their own; a rejection says why.
  INSERT INTO public.amc_contract_amendments (contract_id, kind, reason, requested_by, effective_on)
  VALUES (c, 'hold', 'Owner abroad', owner_id, current_date) RETURNING id INTO a;
  BEGIN
    INSERT INTO public.amc_contract_amendments (contract_id, kind, reason) VALUES (c, 'upgrade', 'x');
    RAISE EXCEPTION 'an unknown kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.amc_contract_amendments (contract_id, kind, reason) VALUES (c, 'hold', ' ');
    RAISE EXCEPTION 'no reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contract_amendments SET status = 'approved' WHERE id = a;
    RAISE EXCEPTION 'approved without who and when';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contract_amendments SET status = 'approved', decided_by = owner_id, decided_at = now() WHERE id = a;
    RAISE EXCEPTION 'the requester approved their own amendment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contract_amendments SET status = 'rejected', decided_by = other_id, decided_at = now() WHERE id = a;
    RAISE EXCEPTION 'rejected without a comment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contract_amendments SET status = 'approved', decided_by = other_id, decided_at = now() WHERE id = a;
  BEGIN
    UPDATE public.amc_contract_amendments SET status = 'applied' WHERE id = a;
    RAISE EXCEPTION 'applied without a time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contract_amendments SET status = 'applied', applied_at = now(), applied_by = owner_id WHERE id = a;

  -- The contract keeps its amendment history.
  BEGIN
    DELETE FROM public.amc_contracts WHERE id = c;
    RAISE EXCEPTION 'a contract with amendments was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- The Renewals page permission: roles that can use AMC get View; others nothing; additive and safe twice.
INSERT INTO public.roles (id, name) VALUES
  ('97200000-0000-0000-0000-0000000000c1', 'p97s coordinator'),
  ('97200000-0000-0000-0000-0000000000c2', 'p97s snagging only');
INSERT INTO public.role_access (role_id, resource, action, enabled) VALUES
  ('97200000-0000-0000-0000-0000000000c1', 'amc', 'view', true),
  ('97200000-0000-0000-0000-0000000000c2', 'snagging', 'view', true);
\ir ../../supabase/migrations/20261012140000_amc_renewal_outcomes_and_amendments.sql
\ir ../../supabase/migrations/20261012140000_amc_renewal_outcomes_and_amendments.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.role_access WHERE role_id = '97200000-0000-0000-0000-0000000000c1' AND resource = 'amc_renewals' AND action = 'view') THEN
    RAISE EXCEPTION 'an AMC role did not get Renewals';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_access WHERE role_id = '97200000-0000-0000-0000-0000000000c2' AND resource = 'amc_renewals') THEN
    RAISE EXCEPTION 'a role without AMC got Renewals';
  END IF;
END $$;
\echo 97s renewals and amendments: all checks pass
