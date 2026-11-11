\set ON_ERROR_STOP on
-- Phase 6 (20261007160000): the contract lifecycle and signatories.

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-000000000001';
  internal_user uuid := '00000000-0000-0000-0000-000000000002';
  s uuid;
  c uuid;
  num text;
  board jsonb;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.amc_contract_signatories'::regclass) THEN
    RAISE EXCEPTION 'amc_contract_signatories has RLS off';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'amc_contract_signatories' AND grantee IN ('anon', 'authenticated')) THEN
    RAISE EXCEPTION 'amc_contract_signatories is granted to a browser role';
  END IF;
  IF EXISTS (SELECT 1 FROM public.amc_contracts WHERE contract_number IS NULL) THEN
    RAISE EXCEPTION 'an existing contract has no number';
  END IF;

  -- A contract from the client's approval: a draft, not yet signed.
  INSERT INTO public.amc_submissions (owner_id, status, property, customer, document_options, services,
    discount_percent, discount_amount, final_price, generated_documents, updated_at)
  VALUES (owner_id, 'proposal_approved', '{"propertyAddress":"Villa 3","unitType":"villa"}', '{"customerName":"LIFECYCLE"}',
    '{}', '[]', 0, 0, 1000, '{}', now()) RETURNING id INTO s;
  c := public.amc_activate_contract(
    jsonb_build_object(
      'submission_id', s, 'proposal_number', 'AMC-TEST-LC', 'status', 'draft',
      'customer', '{"customerName":"LIFECYCLE"}'::jsonb, 'property', '{"propertyAddress":"Villa 3"}'::jsonb,
      'start_date', current_date, 'end_date', current_date + 364,
      'subtotal', 1000, 'final_price', 1000, 'vat_amount', 50, 'grand_total', 1050, 'template', 'residential'),
    '[{"service_id":"ac-ppm","service_label":"AC PPM","entitlement_type":"visits","units":1,"frequency":2,"included_quantity":2}]'::jsonb);
  SELECT contract_number INTO num FROM public.amc_contracts WHERE id = c;
  IF num !~ '^AMC-C-[0-9]{4}-[0-9]{4,}$' THEN RAISE EXCEPTION 'bad contract number %', num; END IF;
  IF (SELECT material_coverage FROM public.amc_contract_entitlements WHERE contract_id = c) <> 'consumables' THEN
    RAISE EXCEPTION 'entitlement terms did not default';
  END IF;

  -- Statuses: the 11, nothing else; signed means signed; hold and termination say why.
  BEGIN
    UPDATE public.amc_contracts SET status = 'paused' WHERE id = c;
    RAISE EXCEPTION 'an unknown status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contracts SET status = 'signed' WHERE id = c;
    RAISE EXCEPTION 'signed without a signature';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts SET status = 'pending_client_signature' WHERE id = c;

  -- Signatories: in order, an internal one is a portal user, signed means dated with a method.
  INSERT INTO public.amc_contract_signatories (contract_id, party, sign_order, name, status) VALUES (c, 'client', 1, 'Sara', 'pending');
  BEGIN
    INSERT INTO public.amc_contract_signatories (contract_id, party, sign_order, name) VALUES (c, 'internal', 2, 'Nobody');
    RAISE EXCEPTION 'an internal signatory without a user was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.amc_contract_signatories (contract_id, party, sign_order, name, user_id) VALUES (c, 'internal', 2, 'Approver', internal_user);
  BEGIN
    INSERT INTO public.amc_contract_signatories (contract_id, party, sign_order, name, user_id) VALUES (c, 'internal', 2, 'Again', internal_user);
    RAISE EXCEPTION 'two signatories in one place';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.amc_contract_signatories SET status = 'signed' WHERE contract_id = c AND sign_order = 1;
    RAISE EXCEPTION 'a signature without a date or method';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contract_signatories SET status = 'signed', signed_at = now(), method = 'link', signed_name = 'Sara' WHERE contract_id = c AND sign_order = 1;
  UPDATE public.amc_contract_signatories SET status = 'signed', signed_at = now(), method = 'portal', signed_name = 'Approver' WHERE contract_id = c AND sign_order = 2;
  UPDATE public.amc_contracts SET status = 'signed', signed_at = now(), signed_by_name = 'Sara', signature_route = 'link' WHERE id = c;

  -- The dashboard counts it as pending activation until it is active.
  board := public.amc_contracts_dashboard(NULL, current_date, 30, now() - interval '30 days');
  IF (board->>'pendingActivation')::int < 1 THEN RAISE EXCEPTION 'a signed contract is not pending activation: %', board; END IF;

  UPDATE public.amc_contracts SET status = 'active', start_date = current_date, end_date = current_date + 364, activated_at = now() WHERE id = c;
  BEGIN
    UPDATE public.amc_contracts SET status = 'on_hold' WHERE id = c;
    RAISE EXCEPTION 'on hold without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.amc_contracts SET status = 'on_hold', status_reason = 'Client travelling' WHERE id = c;
  board := public.amc_contracts_dashboard(NULL, current_date, 30, now() - interval '30 days');
  IF (board->>'onHold')::int < 1 THEN RAISE EXCEPTION 'on hold not counted: %', board; END IF;

  -- The signatures are kept with the contract.
  BEGIN
    DELETE FROM public.amc_contracts WHERE id = c;
    RAISE EXCEPTION 'a contract with signatories was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
\echo 97j contract lifecycle: all checks pass
